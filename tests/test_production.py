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
        rain_only = production.save_daily_summary(self.viewer["id"], {
            "unit_code": "NRD", "work_date": "2026-10-16",
            "rain_turn_mm": 5, "rain_accumulated_mm": 11,
        })
        self.assertEqual(rain_only["changes"], viewer_saved["changes"])
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
        self.assertEqual(production.get_daily_summary(self.user["id"], "NRD", "2026-10-16")["rain_turn_mm"], 5)

    def test_daily_summary_and_global_catalog_permissions_are_independent(self):
        from backend.models.production import get_user_access, save_user_access
        # A conta de consulta pode preencher o resumo sem editar frentes (regra antiga).
        self.assertTrue(get_user_access(self.viewer["id"])["permissions"]["summary"])
        self.assertFalse(get_user_access(self.viewer["id"])["permissions"]["fill"])
        save_user_access(self.viewer["id"], {
            "enabled": True, "permissions": {"fill": False, "summary": False}, "units": ["NRD"],
        }, actor_id=self.admin["id"])
        with self.assertRaisesRegex(PermissionError, "resumo diário"):
            production.save_daily_summary(self.viewer["id"], {
                "unit_code": "NRD", "work_date": "2026-10-16", "changes": "Não autorizado"
            })
        self.assertEqual(production.get_daily_summary(self.viewer["id"], "NRD", "2026-10-16")["changes"], "")
        save_user_access(self.viewer["id"], {
            "enabled": True,
            "permissions": {"fill": False, "summary": False, "configure": True},
            "units": ["PPT", "NRD", "RBR", "PST"],
        }, actor_id=self.admin["id"])
        self.assertTrue(production.list_catalog(self.viewer["id"], unit_code="NRD")["can_configure"])
        production.save_group(self.viewer["id"], {"name": "Grupo autorizado", "position": 100})
        with self.assertRaisesRegex(ValueError, "quatro unidades"):
            save_user_access(self.viewer["id"], {
                "enabled": True, "permissions": {"configure": True}, "units": ["NRD"],
            }, actor_id=self.admin["id"])

    def test_different_actions_per_unit_and_legacy_access_are_preserved(self):
        from backend.models.production import get_user_access, save_user_access
        # Contas anteriores à migração têm o comportamento herdado por unidade.
        with storage.auth_connection() as conn:
            conn.execute("UPDATE user_module_units SET can_fill=NULL,can_summary=NULL WHERE user_id=?", (self.user["id"],))
        db.init_db()  # migração repetida não deve sobrescrever acessos.
        self.assertTrue(get_user_access(self.user["id"])["unit_permissions"]["PPT"]["fill"])
        self.assertTrue(get_user_access(self.user["id"])["unit_permissions"]["NRD"]["fill"])

        access = save_user_access(self.user["id"], {
            "enabled": True, "permissions": {"configure": False},
            "unit_permissions": {
                "PPT": {"view": True, "fill": True, "summary": False},
                "NRD": {"view": True, "fill": False, "summary": True},
                "RBR": {"view": True, "fill": False, "summary": False},
            }
        }, actor_id=self.admin["id"])
        self.assertEqual(access["units"], ["PPT", "NRD", "RBR"])
        self.assertTrue(access["unit_permissions"]["PPT"]["fill"])
        self.assertFalse(access["unit_permissions"]["NRD"]["fill"])
        self.assertTrue(access["unit_permissions"]["NRD"]["summary"])
        self.assertFalse(access["unit_permissions"]["PPT"]["summary"])
        self.assertEqual(production.list_my_items(self.user["id"], "NRD", "2026-10-16")["permissions"]["fill"], False)
        with storage.connection() as conn:
            with self.assertRaisesRegex(PermissionError, "somente para consulta"):
                production._require_access(conn, self.user["id"], permission="fill", unit="NRD")
            with self.assertRaisesRegex(PermissionError, "resumo diário"):
                production._require_access(conn, self.user["id"], permission="summary", unit="PPT")
            with self.assertRaisesRegex(PermissionError, "resumo diário"):
                production._require_access(conn, self.user["id"], permission="summary", unit="RBR")
            production._require_access(conn, self.user["id"], permission="fill", unit="PPT")
            production._require_access(conn, self.user["id"], permission="summary", unit="NRD")
        # Reabrir base não pode reativar operação negada.
        db.init_db()
        self.assertFalse(get_user_access(self.user["id"])["unit_permissions"]["NRD"]["fill"])
        for bad in (
            {"view": False, "fill": True, "summary": False},
            {"view": True, "fill": 1, "summary": False},
        ):
            with self.assertRaises(ValueError):
                save_user_access(self.user["id"], {
                    "enabled": True, "unit_permissions": {"PPT": bad}
                }, actor_id=self.admin["id"])

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
                "farm": "SANTA TEREZINHA", "status": "EM ATIVIDADE",
                "observation": "A mesma observação", "changes": "Mudança do analista 1",
            },
        )
        production.save_my_item(
            other["id"],
            {
                "unit_code": "NRD", "service_front_id": front_two["id"],
                "work_date": "2026-10-13", "sector": "3392", "section": "20",
                "farm": "SANTA TEREZINHA II", "status": "EM ATIVIDADE",
                "observation": "A mesma observação", "changes": "Mudança do analista 2",
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
        self.assertEqual({item["entry"]["changes"] for item in consolidated["items"]}, {
            "Mudança do analista 1", "Mudança do analista 2",
        })
        self.assertEqual([item["entry"]["observation"] for item in consolidated["items"]],
                         ["A mesma observação", "A mesma observação"])

        with self.assertRaisesRegex(ValueError, "Visualização"):
            production.list_my_items(self.user["id"], "NRD", "2026-10-13", scope="other")

    def test_multiple_sectors_are_saved_together_with_individual_statuses_and_retries(self):
        front = self._front(units=["NRD", "PPT"])
        payload = {"unit_code": "NRD", "service_front_id": front["id"], "work_date": "2026-10-19",
                   "sectors": [{"sector": "3392", "section": "10", "farm": "FAZENDA A", "status": "EM ATIVIDADE"},
                               {"sector": "3400", "section": "20", "farm": "FAZENDA B", "status": "SOLO ÚMIDO / TESTE"}]}
        items = production.save_my_items(self.user["id"], payload)
        self.assertEqual([item["entry"]["sector"] for item in items], ["3392", "3400"])
        self.assertEqual([item["entry"]["status"] for item in items], ["EM ATIVIDADE", "SOLO ÚMIDO / TESTE"])
        retried = production.save_my_items(self.user["id"], payload)
        self.assertEqual([item["id"] for item in retried], [item["id"] for item in items])
        ppt = production.save_my_items(self.user["id"], {**payload, "unit_code": "PPT"})
        self.assertTrue(set(item["id"] for item in ppt).isdisjoint(item["id"] for item in items))
        self.assertEqual(len(production.list_my_items(self.user["id"], "NRD", "2026-10-19", scope="all")["items"]), 2)

    def test_multiple_sectors_roll_back_existing_update_and_new_insert_on_invalid_status(self):
        front = self._front()
        base = {"unit_code": "NRD", "service_front_id": front["id"], "work_date": "2026-10-19"}
        original = production.save_my_item(self.user["id"], {**base, "sector": "3392", "status": "EM ATIVIDADE"})
        with self.assertRaises(ValueError):
            production.save_my_items(self.user["id"], {**base, "sectors": [
                {"sector": "3392", "status": "SOLO ÚMIDO / TESTE"},
                {"sector": "3400", "status": "EM ATIVIDADE"},
                {"sector": "3500", "status": "STATUS INVÁLIDO"}]})
        items = production.list_my_items(self.user["id"], "NRD", "2026-10-19")["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], original["id"])
        self.assertEqual(items[0]["entry"]["status"], "EM ATIVIDADE")

    def test_multiple_sectors_reject_duplicates_and_invalid_batches(self):
        front = self._front()
        base = {"unit_code": "NRD", "service_front_id": front["id"], "work_date": "2026-10-19"}
        for sectors in ([], None, {}, [None], [{"sector": "A1", "status": "EM ATIVIDADE"},
                                                {"sector": " a1 ", "status": "SOLO ÚMIDO / TESTE"}],
                        [{"sector": str(index), "status": "EM ATIVIDADE"} for index in range(101)]):
            with self.subTest(sectors=sectors), self.assertRaises(ValueError):
                production.save_my_items(self.user["id"], {**base, "sectors": sectors})
        self.assertEqual(production.list_my_items(self.user["id"], "NRD", "2026-10-19")["items"], [])

    def test_other_analyst_updates_existing_item_preserving_authorship_notes_and_history(self):
        front = self._front()
        base = {"unit_code": "NRD", "service_front_id": front["id"], "work_date": "2026-10-18"}
        original = production.save_my_item(self.admin["id"], {**base, "sector": "3392", "status": "EM ATIVIDADE",
            "observation": "Observação existente", "changes": "Mudança existente"})
        updated = production.save_my_item(self.user["id"], {**base, "sector": "3392", "status": "SOLO ÚMIDO / TESTE"}, item_id=original["id"])
        self.assertEqual(updated["id"], original["id"])
        self.assertEqual(updated["owner_user_id"], self.admin["id"])
        self.assertEqual(updated["entry"]["updated_by"], self.user["id"])
        self.assertEqual(updated["entry"]["updated_by_name"], "Analista")
        self.assertEqual(updated["entry"]["observation"], "Observação existente")
        next_day = production.save_my_items(self.user["id"], {**base, "work_date": "2026-10-19", "sectors": [
            {"sector": "3392", "status": "EM ATIVIDADE"}]})[0]
        self.assertEqual(next_day["id"], original["id"])
        self.assertEqual(next_day["entry"]["changes"], "Mudança existente")
        with storage.connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM production_user_items").fetchone()[0], 1)
            rows = conn.execute("SELECT work_date,created_by,updated_by FROM production_daily_entries ORDER BY work_date").fetchall()
        self.assertEqual([tuple(row) for row in rows], [("2026-10-18", self.admin["id"], self.user["id"]),
                                                     ("2026-10-19", self.user["id"], self.user["id"])])
        with self.assertRaises(PermissionError):
            production.save_my_item(self.viewer["id"], {**base, "sector": "3392", "status": "EM ATIVIDADE"}, item_id=original["id"])

    def test_status_update_reconciles_legacy_duplicates_without_losing_other_sectors(self):
        front = self._front(name="Sulcação", display_style="operation")
        base = {"unit_code": "NRD", "service_front_id": front["id"], "work_date": "2026-10-19"}
        original = production.save_my_item(self.admin["id"], {**base, "sector": "3392", "status": "EM ATIVIDADE"})
        other_sector = production.save_my_item(self.admin["id"], {**base, "sector": "3400", "status": "EM ATIVIDADE"})
        # Earlier releases created a personal copy when another analyst updated the same sector.
        with storage.connection() as conn:
            duplicate_id = conn.execute(
                """INSERT INTO production_user_items(owner_user_id,unit_code,service_front_id,position,is_active,created_at,updated_at)
                   VALUES (?,?,?,2,1,1,1)""", (self.user["id"], "NRD", front["id"]),
            ).lastrowid
            conn.execute(
                """INSERT INTO production_daily_entries(work_date,user_item_id,owner_user_id,unit_code,service_front_id,
                   service_name,group_name,display_style,sector,status,created_by,updated_by,created_at,updated_at)
                   SELECT work_date,?,?,unit_code,service_front_id,service_name,group_name,display_style,sector,
                          'SOLO ÚMIDO / TESTE',?,?,created_at,updated_at+1
                   FROM production_daily_entries WHERE user_item_id=?""",
                (duplicate_id, self.user["id"], self.user["id"], self.user["id"], original["id"]),
            )
        # A tab opened before the other analyst's save still edits the original item ID.
        for actor in (self.user, self.admin, self.user):
            updated = production.save_my_item(actor["id"], {**base, "sector": "3392", "status": "PARADO / CRÍTICO"}, item_id=original["id"])
            self.assertEqual(updated["id"], original["id"])
        items = production.list_my_items(self.user["id"], "NRD", base["work_date"], scope="all")["items"]
        self.assertEqual({item["id"] for item in items}, {original["id"], other_sector["id"]})
        self.assertEqual(next(item for item in items if item["id"] == original["id"])["entry"]["status"], "PARADO / CRÍTICO")
        with storage.connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM production_user_items").fetchone()[0], 3)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM production_daily_entries WHERE user_item_id=?", (duplicate_id,)).fetchone()[0], 1)
            conn.execute("UPDATE production_user_items SET is_active=1 WHERE id=?", (duplicate_id,))
        production.remove_my_item(self.user["id"], original["id"])
        remaining = production.list_my_items(self.user["id"], "NRD", base["work_date"], scope="all")["items"]
        self.assertEqual([item["id"] for item in remaining], [other_sector["id"]])
        with storage.connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM production_daily_entries").fetchone()[0], 3)

    def test_remove_other_analysts_item_requires_fill_access_to_its_unit(self):
        front = self._front(units=["NRD", "RBR"])
        base = {"service_front_id": front["id"], "work_date": "2026-10-19", "sector": "3392", "status": "EM ATIVIDADE"}
        nrd = production.save_my_item(self.admin["id"], {**base, "unit_code": "NRD"})
        rbr = production.save_my_item(self.admin["id"], {**base, "unit_code": "RBR"})
        with self.assertRaises(PermissionError):
            production.remove_my_item(self.viewer["id"], nrd["id"])
        with self.assertRaises(PermissionError):
            production.remove_my_item(self.user["id"], rbr["id"])
        production.remove_my_item(self.user["id"], nrd["id"])
        self.assertEqual(production.list_my_items(self.user["id"], "NRD", base["work_date"], scope="all")["items"], [])
        self.assertEqual(len(production.list_my_items(self.admin["id"], "RBR", base["work_date"], scope="all")["items"]), 1)
        with storage.connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM production_daily_entries").fetchone()[0], 2)

    def test_edit_cannot_merge_two_sectors_or_change_another_units_item(self):
        front = self._front(units=["NRD", "PPT"])
        base = {"unit_code": "NRD", "service_front_id": front["id"], "work_date": "2026-10-19"}
        items = production.save_my_items(self.user["id"], {**base, "sectors": [
            {"sector": "3392", "status": "EM ATIVIDADE"}, {"sector": "3400", "status": "EM ATIVIDADE"}]})
        with self.assertRaisesRegex(ValueError, "já está cadastrado"):
            production.save_my_item(self.user["id"], {**base, "sector": "3400", "status": "EM ATIVIDADE"}, item_id=items[0]["id"])
        with self.assertRaisesRegex(ValueError, "unidade"):
            production.save_my_item(self.user["id"], {**base, "unit_code": "PPT", "sector": "3392", "status": "EM ATIVIDADE"}, item_id=items[0]["id"])

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

        linked = production.save_service_front(self.admin["id"], {
            "name": "frente unit", "group_id": front["group_id"],
            "display_style": "front", "position": 0, "units": ["PPT"],
        })
        self.assertEqual(linked["id"], front["id"])
        self.assertTrue(linked["linked_existing"])
        self.assertEqual(set(linked["units"]), {"NRD", "PPT"})
        nrd = production.save_my_item(self.user["id"], {**base, "unit_code": "NRD"})
        ppt = production.save_my_item(self.user["id"], {
            **base, "unit_code": "PPT", "sector": "4200", "status": "SOLO ÚMIDO / TESTE",
        })
        self.assertNotEqual(nrd["id"], ppt["id"])
        self.assertEqual(production.list_my_items(self.user["id"], "NRD", "2026-10-10")["items"][0]["entry"]["sector"], "3392")
        self.assertEqual(production.list_my_items(self.user["id"], "PPT", "2026-10-10")["items"][0]["entry"]["sector"], "4200")
        with self.assertRaisesRegex(ValueError, "já está disponível"):
            production.save_service_front(self.admin["id"], {
                "name": "FRENTE UNIT", "group_id": front["group_id"],
                "display_style": "front", "units": ["PPT"],
            })


if __name__ == "__main__":
    unittest.main()
