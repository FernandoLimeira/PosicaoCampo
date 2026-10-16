import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import config
from backend.models import database as db
from backend.models import production
from backend.models import storage


class ProductionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        for name, value in {
            "DATA_DIR": root,
            "AUTH_DB_PATH": root / "usuarios.db",
            "OPERATIONS_DB_PATH": root / "dados.db",
            "LEGACY_DB_PATH": root / "legacy.db",
        }.items():
            patcher = patch.object(config, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

        db.init_db()
        self.admin = db.create_or_update_admin("Admin", "Admin-pass-42")
        self.user = db.create_user(
            "Analista",
            "Analyst-pass-42",
            role="analyst",
            base_unit="NRD",
            production_access={
                "enabled": True,
                "permissions": {"fill": True},
                "units": ["NRD", "PPT"],
            },
        )
        self.viewer = db.create_user(
            "Consulta",
            "Viewer-pass-42",
            role="analyst",
            base_unit="NRD",
            production_access={
                "enabled": True,
                "permissions": {"fill": False},
                "units": ["NRD"],
            },
        )
        db.initialize_units(
            [
                {"code": code, "name": definition["name"], "rows": [], "metrics": [], "rain": []}
                for code, definition in db.UNIT_DEFINITIONS.items()
            ],
            self.admin["id"],
        )
        db.save_sector_base_item("3392", "10", "SANTA TEREZINHA", self.admin["id"])
        db.save_sector_base_item("3392", "20", "SANTA TEREZINHA II", self.admin["id"])

    def _group(self, name="Fertirrigação"):
        catalog = production.list_catalog(self.admin["id"], include_inactive=True)
        return next(group for group in catalog["groups"] if group["name"] == name)

    def _front(self, *, name="FRENTE 01 EX", units=None, display_style="front"):
        group = self._group()
        return production.save_service_front(
            self.admin["id"],
            {
                "name": name,
                "group_id": group["id"],
                "display_style": display_style,
                "position": 1,
                "units": units or ["NRD"],
                "is_active": True,
            },
        )

    def test_daily_summary_is_scoped_to_unit_date_and_shared_with_analysts(self):
        empty = production.get_daily_summary(self.user["id"], "NRD", "2026-10-16")
        self.assertIsNone(empty["rain_turn_mm"])
        self.assertEqual(empty["changes"], "")

        saved = production.save_daily_summary(self.user["id"], {
            "unit_code": "NRD", "work_date": "2026-10-16",
            "rain_turn_mm": "3,5", "rain_accumulated_mm": 10,
            "changes": "Frente 54 em teste.\nSem mudanças nas demais frentes.",
        })
        self.assertEqual(saved["rain_turn_mm"], 3.5)
        self.assertEqual(saved["rain_accumulated_mm"], 10)
        self.assertIn("Frente 54", production.get_daily_summary(self.viewer["id"], "NRD", "2026-10-16")["changes"])
        self.assertIsNone(production.get_daily_summary(self.user["id"], "PPT", "2026-10-16")["rain_turn_mm"])
        self.assertIsNone(production.get_daily_summary(self.user["id"], "NRD", "2026-10-15")["rain_turn_mm"])

        viewer_saved = production.save_daily_summary(self.viewer["id"], {
            "unit_code": "NRD", "work_date": "2026-10-16",
            "rain_turn_mm": 4, "rain_accumulated_mm": 10,
            "changes": "Turno atualizado pelo analista da unidade.",
        })
        self.assertEqual(viewer_saved["rain_turn_mm"], 4)
        with self.assertRaises(PermissionError):
            production.get_daily_summary(self.user["id"], "RBR", "2026-10-16")
        with self.assertRaises(PermissionError):
            production.save_daily_summary(self.user["id"], {
                "unit_code": "RBR", "work_date": "2026-10-16"
            })
        with self.assertRaisesRegex(ValueError, "Chuva do turno"):
            production.save_daily_summary(self.user["id"], {
                "unit_code": "NRD", "work_date": "2026-10-16", "rain_turn_mm": "-1"
            })

        db.init_db()
        self.assertEqual(production.get_daily_summary(self.user["id"], "NRD", "2026-10-16")["rain_turn_mm"], 4)

    def test_access_is_unit_scoped_and_catalog_configuration_is_admin_only(self):
        access = production.get_user_access(self.user["id"])
        self.assertTrue(access["enabled"])
        self.assertTrue(access["permissions"]["fill"])
        self.assertEqual(access["units"], ["PPT", "NRD"])

        group = production.save_group(
            self.admin["id"],
            {"name": "Operação Especial", "position": 50, "is_active": True},
        )
        front = production.save_service_front(
            self.admin["id"],
            {
                "name": "FRENTE TESTE",
                "group_id": group["id"],
                "display_style": "front",
                "position": 2,
                "units": ["NRD"],
                "is_active": True,
            },
        )
        nrd = production.list_catalog(self.user["id"], unit_code="NRD")
        visible = [item for item_group in nrd["groups"] for item in item_group["fronts"]]
        self.assertEqual([item["id"] for item in visible], [front["id"]])
        self.assertFalse(nrd["can_configure"])

        ppt = production.list_catalog(self.user["id"], unit_code="PPT")
        self.assertFalse(any(item["id"] == front["id"] for item_group in ppt["groups"] for item in item_group["fronts"]))
        with self.assertRaises(PermissionError):
            production.list_catalog(self.user["id"], unit_code="RBR")
        with self.assertRaises(PermissionError):
            production.save_group(self.user["id"], {"name": "Não pode", "position": 1, "is_active": True})

    def test_admin_can_delete_unused_group_and_front_but_used_catalog_is_protected(self):
        group = production.save_group(
            self.admin["id"],
            {"name": "Grupo temporário", "position": 90, "is_active": True},
        )
        front = production.save_service_front(
            self.admin["id"],
            {
                "name": "FRENTE TEMPORÁRIA",
                "group_id": group["id"],
                "display_style": "front",
                "position": 1,
                "units": ["NRD"],
                "is_active": True,
            },
        )
        with self.assertRaisesRegex(ValueError, "frentes/serviços vinculados"):
            production.delete_group(self.admin["id"], group["id"])

        production.delete_service_front(self.admin["id"], front["id"])
        production.delete_group(self.admin["id"], group["id"])
        catalog = production.list_catalog(self.admin["id"], include_inactive=True)
        self.assertFalse(any(item["id"] == group["id"] for item in catalog["groups"]))

        used_front = self._front(name="FRENTE COM HISTÓRICO")
        production.save_my_item(
            self.user["id"],
            {
                "unit_code": "NRD",
                "service_front_id": used_front["id"],
                "work_date": "2026-10-10",
                "sector": "3392",
                "section": "10",
                "farm": "SANTA TEREZINHA",
                "status": "EM ATIVIDADE",
                "observation": "Registro que deve permanecer",
            },
        )
        with self.assertRaisesRegex(ValueError, "já foi usada em lançamentos"):
            production.delete_service_front(self.admin["id"], used_front["id"])

        with self.assertRaises(PermissionError):
            production.delete_service_front(self.user["id"], used_front["id"])

    def test_personal_front_persists_next_day_and_daily_history_is_not_overwritten(self):
        front = self._front()
        day_one = production.save_my_item(
            self.user["id"],
            {
                "unit_code": "NRD",
                "service_front_id": front["id"],
                "work_date": "2026-10-10",
                "sector": "3392",
                "section": "10",
                "farm": "SANTA TEREZINHA",
                "status": "EM ATIVIDADE",
                "observation": "Primeiro turno",
            },
        )
        item_id = day_one["id"]
        self.assertTrue(day_one["is_current_day"])
        self.assertEqual(day_one["entry"]["status"], "EM ATIVIDADE")

        next_day = production.list_my_items(self.user["id"], "NRD", "2026-10-11")
        self.assertEqual(len(next_day["items"]), 1)
        carried = next_day["items"][0]
        self.assertEqual(carried["id"], item_id)
        self.assertFalse(carried["is_current_day"])
        self.assertEqual(carried["entry"]["work_date"], "2026-10-10")

        updated = production.save_my_item(
            self.user["id"],
            {
                "unit_code": "NRD",
                "service_front_id": front["id"],
                "work_date": "2026-10-11",
                "sector": "3400",
                "section": "",
                "farm": "OUTRA FAZENDA",
                "status": "SOLO ÚMIDO / TESTE",
                "observation": "Atualização do dia seguinte",
            },
            item_id=item_id,
        )
        self.assertTrue(updated["is_current_day"])
        self.assertEqual(updated["entry"]["sector"], "3400")

        with storage.connection() as conn:
            history = conn.execute(
                "SELECT work_date,sector,status,observation FROM production_daily_entries "
                "WHERE user_item_id=? ORDER BY work_date",
                (item_id,),
            ).fetchall()
        self.assertEqual(
            [tuple(row) for row in history],
            [
                ("2026-10-10", "3392", "EM ATIVIDADE", "Primeiro turno"),
                ("2026-10-11", "3400", "SOLO ÚMIDO / TESTE", "Atualização do dia seguinte"),
            ],
        )

        production.remove_my_item(self.user["id"], item_id)
        self.assertEqual(production.list_my_items(self.user["id"], "NRD", "2026-10-12")["items"], [])
        with storage.connection() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM production_daily_entries WHERE user_item_id=?", (item_id,)).fetchone()[0],
                2,
            )

    def test_unit_view_consolidates_items_from_multiple_analysts_without_changing_ownership(self):
        other = db.create_user(
            "Analista 2",
            "Analyst-two-42",
            role="analyst",
            base_unit="NRD",
            production_access={
                "enabled": True,
                "permissions": {"fill": True},
                "units": ["NRD"],
            },
        )
        front_one = self._front(name="FRENTE ANALISTA 1")
        front_two = self._front(name="FRENTE ANALISTA 2")

        production.save_my_item(
            self.user["id"],
            {
                "unit_code": "NRD", "service_front_id": front_one["id"],
                "work_date": "2026-10-13", "sector": "3392", "section": "10",
                "farm": "SANTA TEREZINHA", "status": "EM ATIVIDADE", "observation": "",
            },
        )
        production.save_my_item(
            other["id"],
            {
                "unit_code": "NRD", "service_front_id": front_two["id"],
                "work_date": "2026-10-13", "sector": "3392", "section": "20",
                "farm": "SANTA TEREZINHA II", "status": "EM ATIVIDADE", "observation": "",
            },
        )

        mine = production.list_my_items(self.user["id"], "NRD", "2026-10-13")
        self.assertEqual(mine["scope"], "mine")
        self.assertEqual(len(mine["items"]), 1)
        self.assertTrue(mine["items"][0]["is_own"])

        consolidated = production.list_my_items(self.user["id"], "NRD", "2026-10-13", scope="all")
        self.assertEqual(consolidated["scope"], "all")
        self.assertEqual(len(consolidated["items"]), 2)
        self.assertEqual({item["owner_name"] for item in consolidated["items"]}, {"Analista", "Analista 2"})
        self.assertEqual(sum(bool(item["is_own"]) for item in consolidated["items"]), 1)

        with self.assertRaisesRegex(ValueError, "Visualização"):
            production.list_my_items(self.user["id"], "NRD", "2026-10-13", scope="other")

    def test_sector_base_is_read_only_and_fill_permission_is_enforced(self):
        before = None
        with storage.connection() as conn:
            before = [tuple(row) for row in conn.execute(
                "SELECT sector,section,description,source,updated_by,updated_at FROM sector_base ORDER BY sector,section"
            )]

        options = production.list_sector_options(self.user["id"], "NRD", "3392")
        self.assertEqual(
            options,
            [
                {"sector": "3392", "section": "10", "farm": "SANTA TEREZINHA"},
                {"sector": "3392", "section": "20", "farm": "SANTA TEREZINHA II"},
            ],
        )
        with storage.connection() as conn:
            after = [tuple(row) for row in conn.execute(
                "SELECT sector,section,description,source,updated_by,updated_at FROM sector_base ORDER BY sector,section"
            )]
        self.assertEqual(after, before)

        front = self._front(name="FRENTE CONSULTA")
        with self.assertRaises(PermissionError):
            production.save_my_item(
                self.viewer["id"],
                {
                    "unit_code": "NRD",
                    "service_front_id": front["id"],
                    "work_date": "2026-10-10",
                    "sector": "3392",
                    "status": "EM ATIVIDADE",
                },
            )

    def test_inactive_catalog_item_keeps_saved_history_and_user_deletion_keeps_daily_snapshot(self):
        front = self._front(name="FRENTE HISTÓRICO")
        saved = production.save_my_item(
            self.user["id"],
            {
                "unit_code": "NRD",
                "service_front_id": front["id"],
                "work_date": "2026-10-10",
                "sector": "3392",
                "section": "10",
                "farm": "SANTA TEREZINHA",
                "status": "PARADO / CRÍTICO",
                "observation": "Registro preservado",
            },
        )
        production.save_service_front(
            self.admin["id"],
            {
                **front,
                "group_id": front["group_id"],
                "units": ["NRD"],
                "is_active": False,
            },
            front_id=front["id"],
        )
        carried = production.list_my_items(self.user["id"], "NRD", "2026-10-11")["items"][0]
        self.assertFalse(carried["catalog_active"])
        self.assertEqual(carried["entry"]["service_name"] if "service_name" in carried["entry"] else carried["service_name"], "FRENTE HISTÓRICO")

        db.delete_user(self.user["id"], self.admin["id"])
        with storage.connection() as conn:
            row = conn.execute(
                "SELECT user_item_id,owner_user_id,service_name,group_name,sector,status,observation,created_by,updated_by "
                "FROM production_daily_entries WHERE work_date='2026-10-10'"
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertIsNone(row["user_item_id"])
            self.assertIsNone(row["owner_user_id"])
            self.assertIsNone(row["created_by"])
            self.assertIsNone(row["updated_by"])
            self.assertEqual(row["service_name"], "FRENTE HISTÓRICO")
            self.assertEqual(row["sector"], "3392")
            self.assertEqual(row["status"], "PARADO / CRÍTICO")
            self.assertEqual(row["observation"], "Registro preservado")
            storage.check_integrity(conn)

    def test_status_catalog_is_configurable_and_used_status_is_protected(self):
        defaults = production.list_statuses(self.user["id"])["statuses"]
        self.assertEqual([item["name"] for item in defaults], [
            "Em atividade", "Solo úmido / teste", "Aguardando atividade", "Parado / crítico"
        ])
        with self.assertRaises(PermissionError):
            production.save_status(self.user["id"], {"name": "Teste", "style_key": "active", "position": 9})

        custom = production.save_status(
            self.admin["id"],
            {"name": "Em deslocamento", "style_key": "waiting", "position": 4, "is_active": True},
        )
        self.assertTrue(custom["code"].startswith("CUSTOM-"))
        updated = production.save_status(
            self.admin["id"],
            {"name": "Em deslocamento / trajeto", "style_key": "wet", "position": 5, "is_active": True},
            status_id=custom["id"],
        )
        self.assertEqual(updated["code"], custom["code"])
        self.assertEqual(updated["style_key"], "wet")

        front = self._front(name="FRENTE STATUS")
        production.save_my_item(
            self.user["id"],
            {
                "unit_code": "NRD",
                "service_front_id": front["id"],
                "work_date": "2026-10-10",
                "sector": "3392",
                "status": custom["code"],
            },
        )
        with self.assertRaisesRegex(ValueError, "já foi usado em lançamentos"):
            production.delete_status(self.admin["id"], custom["id"])

        production.save_status(
            self.admin["id"],
            {"name": updated["name"], "style_key": "wet", "position": 5, "is_active": False},
            status_id=custom["id"],
        )
        self.assertNotIn(custom["code"], {
            item["code"] for item in production.list_statuses(self.user["id"])["statuses"]
        })
        historical = production.list_statuses(self.user["id"], include_inactive=True)["statuses"]
        self.assertEqual(next(item for item in historical if item["code"] == custom["code"])["style_key"], "wet")

        unused = production.save_status(
            self.admin["id"],
            {"name": "Temporário", "style_key": "stopped", "position": 99, "is_active": True},
        )
        production.delete_status(self.admin["id"], unused["id"])
        self.assertFalse(any(item["id"] == unused["id"] for item in production.list_statuses(self.admin["id"], include_inactive=True)["statuses"]))

    def test_status_and_front_unit_validation(self):
        front = self._front(name="FRENTE UNIT", units=["NRD"])
        base = {
            "service_front_id": front["id"],
            "work_date": "2026-10-10",
            "sector": "3392",
            "status": "EM ATIVIDADE",
        }
        with self.assertRaisesRegex(ValueError, "não disponível"):
            production.save_my_item(self.user["id"], {**base, "unit_code": "PPT"})
        with self.assertRaisesRegex(ValueError, "status válido"):
            production.save_my_item(self.user["id"], {**base, "unit_code": "NRD", "status": "QUALQUER"})


if __name__ == "__main__":
    unittest.main()
