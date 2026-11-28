"""Fertirrigação do Polo SP: painel, plano da frente, frota (situação e histórico), troca de CV
só com a mesma recomendação, vazão e recomendação da O.S. e raio por base."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import config
from backend.models import database as db
from backend.models import production
from backend.models import service_orders
from backend.models.production import fert
from backend.models.production.fert.sources import save_sector_radius
from backend.models.module_access import write_module_access
from backend.models.storage import auth_connection, connection
from tests.test_service_orders import xlsx

DAY = "2026-11-27"
COLUMNS = ["CD_UNIMED", "QT_RECURSO", "DE_COMPO", "CCUSTO_TRATOS"]


def order(number, sector, products, opened_on="2026-11-20"):
    """O.S. de fertirrigação com os componentes (como o SELECT do PIMS com a recomendação)."""
    return {"number": number, "sector": sector, "operation": "509", "operation_name": "FERTIRRIGACAO LOCALIZADA",
            "plots": ["1", "2"], "opened_on": opened_on, "columns": COLUMNS,
            "rows": [{"CD_UNIMED": unit, "QT_RECURSO": quantity, "DE_COMPO": name, "CCUSTO_TRATOS": "TRATOS SOQUEIRA"}
                     for name, quantity, unit in products]}


SAME = [("FERTILIZANTE LIQUEFERTIL", "35", "M3"), ("FERTILIZANTE FEVL 10.00.06+MIX", "670", "L")]
OTHER = [("FERTILIZANTE LIQUEFERTIL", "30", "M3"), ("FERTILIZANTE FEVL 14.00.00+B,ZN", "340", "L")]


class FertTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        for name, value in {
            "DATA_DIR": root, "AUTH_DB_PATH": root / "usuarios.db",
            "OPERATIONS_DB_PATH": root / "dados.db", "LEGACY_DB_PATH": root / "legacy.db",
        }.items():
            patcher = patch.object(config, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        db.init_db()
        self.admin = db.create_or_update_admin("Admin", "Admin-pass-42")
        self.user = db.create_user(
            "Analista", "Analyst-pass-42", role="analyst", base_unit="NRD",
            production_access={"enabled": True, "permissions": {"fill": True}, "units": ["NRD"]},
        )
        self.viewer = db.create_user(
            "Consulta", "Viewer-pass-42", role="analyst", base_unit="NRD",
            production_access={"enabled": True, "permissions": {"fill": False}, "units": ["NRD"]},
        )
        # Módulo Fertirrigação (tela de Usuários): o analista edita, o consulta só vê.
        self.grant_fert(self.user["id"], edit=True)
        self.grant_fert(self.viewer["id"], edit=False)
        group = production.list_catalog(self.admin["id"], include_inactive=True)["groups"][0]
        self.fronts = [production.save_service_front(self.admin["id"], {
            "name": name, "group_id": group["id"], "display_style": "front", "units": ["NRD"]})
            for name in ("FT.54", "FT.56", "FT.57", "PREPARO 01")]
        self.status = production.list_statuses(self.admin["id"])["statuses"][0]["code"]
        for front, sector, operation in ((self.fronts[0], "3335", "509"), (self.fronts[1], "870", "509"),
                                         (self.fronts[2], "3803", "509"), (self.fronts[3], "4000", "338")):
            production.save_items_sheet(self.user["id"], {"unit_code": "NRD", "work_date": DAY, "rows": [
                {"service_front_id": front["id"], "sector": sector, "status": self.status, "operation": operation}]})
        # FT.54 e FT.57 com a mesma recomendação; FT.56 com outra.
        service_orders.import_service_orders(self.admin["id"], "NRD", [
            order("332553", "3335", SAME), order("330537", "3803", SAME), order("330133", "870", OTHER),
            order("300000", "3335", OTHER, opened_on="2026-10-01"),  # O.S. antiga do setor: não vale
        ])
        with connection() as conn:
            for sector, base, radius, farm in (("3335", "SANTA CRUZ", 42, "EL SHADDAI"), ("870", "BIE", 55.84, "OSCAR ANTUNE"),
                                               ("870", "SANTA CRUZ", 44.98, "OSCAR ANTUNE")):
                save_sector_radius(conn, sector, base, radius, self.admin["id"], farm=farm)

    @staticmethod
    def grant_fert(user_id, *, view=True, edit=False):
        with auth_connection() as conn:
            write_module_access(conn, user_id, {"fert": {"view": view, "edit": edit}})

    def equipment(self, kind, prefix, **extra):
        return fert.save_fert_equipment(self.user["id"], {"unit_code": "NRD", "kind": kind, "prefix": prefix,
                                                          "work_date": DAY, **extra})["id"]

    def plan(self, index, **extra):
        return fert.save_fert_plan(self.user["id"], {"unit_code": "NRD", "work_date": DAY,
                                                     "service_front_id": self.fronts[index]["id"], **extra})

    def overview(self, day=DAY):
        return fert.fert_overview(self.user["id"], "NRD", day)

    def front(self, overview, index):
        return next(item for item in overview["fronts"] if item["service_front_id"] == self.fronts[index]["id"])

    def test_overview_dimensions_the_fert_fronts_like_the_spreadsheet(self):
        tractors = [self.equipment("tractor", prefix) for prefix in ("846", "847", "1056")]
        trucks = [self.equipment("truck", prefix, capacity_m3=53) for prefix in ("612", "615")]
        self.plan(0, params={"unload_h": 0}, tractors=tractors, trucks=trucks)
        overview = self.overview()
        # Só as frentes com operação 509/524 (a PREPARO 01, com 338, fica fora).
        self.assertEqual({item["name"] for item in overview["fronts"]}, {"FT.54", "FT.56", "FT.57"})
        ft54 = self.front(overview, 0)
        self.assertEqual((ft54["flow_m3_ha"], ft54["flow_source"]), (35.0, "O.S."))
        self.assertEqual((ft54["base"], ft54["radius_km"]), ("SANTA CRUZ", 42.0))
        self.assertEqual(ft54["orders"]["tratos"], "TRATOS SOQUEIRA")
        # Recomendação: a da O.S. mais recente do setor.
        self.assertEqual(ft54["orders"]["recommendation"],
                         ["FERTILIZANTE FEVL 10.00.06+MIX = 670 L", "FERTILIZANTE LIQUEFERTIL = 35 M3"])
        self.assertEqual(ft54["orders"]["flow_m3_ha"], 35.0)
        # Mesmos números da planilha (FT.54): 68,709 ha/dia, ciclo 3,7006 h e 7 CVs, com 2 alocados.
        self.assertAlmostEqual(ft54["calc"]["yield_ha"], 68.709, places=9)
        self.assertAlmostEqual(ft54["calc"]["cycle_h"], 3.7005820921075152, places=9)
        self.assertEqual((ft54["calc"]["trucks_needed"], ft54["calc"]["trucks"], ft54["calc"]["balance"]), (7, 2, -5))
        # Bases: as da unidade (com o raio quando a tabela tem) e as do raio importado.
        ft56 = self.front(overview, 1)
        self.assertEqual([(item["base"], item["radius_km"]) for item in ft56["base_options"]],
                         [("SANTA CRUZ", 44.98), ("BIÉ", 55.84), ("CASA BRANCA", None)])
        # Setor com duas bases com raio: não escolhe sozinho (raio pendente).
        self.assertEqual((ft56["base"], ft56["radius_km"], ft56["calc"]["trucks_needed"]), ("", None, None))
        self.assertEqual(overview["totals"]["incomplete"], 2)
        # "BIÉ" com acento é a mesma base "BIE" da tabela de raio.
        self.plan(1, params={"base": "BIÉ", "flow_m3_ha": 30})
        ft56 = self.front(self.overview(), 1)
        self.assertEqual((ft56["radius_km"], ft56["flow_m3_ha"], ft56["flow_source"]), (55.84, 30.0, "plano"))
        # Base sem raio na tabela: raio digitado no plano.
        self.plan(2, params={"base": "CASA BRANCA", "radius_km": 44.2})
        self.assertEqual(self.front(self.overview(), 2)["radius_km"], 44.2)

    def test_cv_moves_only_between_fronts_with_the_same_recommendation(self):
        trucks = [self.equipment("truck", prefix) for prefix in ("612", "615")]
        self.plan(0, trucks=trucks)
        # Mesma recomendação (FT.54 → FT.57): o analista leva o CV direto, sem tirar de lá antes.
        self.assertEqual(self.plan(2, trucks=[trucks[0]])["moved"], 1)
        overview = self.overview()
        self.assertEqual((self.front(overview, 0)["trucks"], self.front(overview, 2)["trucks"]), ([trucks[1]], [trucks[0]]))
        # Recomendação diferente (FT.57 → FT.56): não muda.
        with self.assertRaisesRegex(ValueError, "612 não pode ir da FT.57 para a FT.56: a recomendação é diferente"):
            self.plan(1, trucks=[trucks[0]])
        # Histórico do dia: alocação e troca, com o analista.
        events = [(item["prefix"], item["action"], item["detail"], item["user"]) for item in self.overview()["events"]]
        self.assertIn(("612", "move", "FT.54 → FT.57", "Analista"), events)
        self.assertIn(("615", "allocate", "Alocado na FT.54", "Analista"), events)
        # Situação automática: alocado vira "operando"; ao sair da frente, "disponível".
        status = {item["prefix"]: item["status"] for item in self.overview()["equipment"]}
        self.assertEqual(status, {"612": "active", "615": "active"})
        self.plan(0, trucks=[])
        self.assertEqual({item["prefix"]: item["status"] for item in self.overview()["equipment"]}["615"], "available")

    def test_status_changes_remove_from_the_front_and_carry_over(self):
        trucks = [self.equipment("truck", prefix) for prefix in ("612", "615")]
        workshop = self.equipment("truck", "621", status="workshop", notes="PMEU")
        self.plan(0, trucks=trucks)
        with self.assertRaisesRegex(ValueError, "621 está em oficina"):
            self.plan(0, trucks=trucks + [workshop])
        # Sem plano no dia seguinte, a frente usa o último plano salvo (copiado).
        ft54 = self.front(self.overview("2026-11-28"), 0)
        self.assertEqual((ft54["trucks"], ft54["plan_carried"], ft54["plan_date"]), (trucks, True, DAY))
        # CV que vai para "sem motorista" sai da frente no dia, com registro de quem mudou.
        fert.save_fert_equipment(self.user["id"], {"unit_code": "NRD", "kind": "truck", "prefix": "615",
                                                   "status": "no_driver", "work_date": DAY}, equipment_id=trucks[1])
        overview = self.overview()
        self.assertEqual(self.front(overview, 0)["trucks"], [trucks[0]])
        cv = next(item for item in overview["equipment"] if item["prefix"] == "615")
        self.assertEqual((cv["status"], cv["status_changed_by"], cv["front"]), ("no_driver", "Analista", None))
        self.assertEqual(overview["fleet"]["truck"]["no_driver"], 1)
        details = [item["detail"] for item in overview["events"] if item["prefix"] == "615"]
        self.assertIn("Operando → Sem motorista", details)
        self.assertIn("Saiu da FT.54 (sem motorista)", details)

    def test_gas_cv_level_and_trips(self):
        # CV a gás na FT.54 (raio 42 km): consumo por viagem = 42 × 0,85% = 35,7% do tanque.
        gas = self.equipment("truck", "603", fuel="gas", gas_level_pct="80")
        diesel = self.equipment("truck", "612")
        self.plan(0, trucks=[gas, diesel])
        overview = self.overview()
        ft54 = self.front(overview, 0)
        self.assertAlmostEqual(ft54["gas_pct_per_trip"], 35.7, places=9)
        cvs = {item["prefix"]: item for item in overview["equipment"]}
        self.assertEqual((cvs["603"]["fuel"], cvs["603"]["gas_level_pct"], cvs["603"]["gas_trips"]), ("gas", 80.0, 2))
        self.assertEqual((cvs["612"]["fuel"], cvs["612"]["gas_trips"]), ("diesel", None))
        # O analista atualiza o gás (e só o gás: situação e combustível ficam como estão).
        fert.save_fert_equipment(self.user["id"], {"unit_code": "NRD", "kind": "truck", "prefix": "603",
                                                   "status": "active", "gas_level_pct": "30", "work_date": DAY}, equipment_id=gas)
        overview = self.overview()
        cv = next(item for item in overview["equipment"] if item["prefix"] == "603")
        self.assertEqual((cv["fuel"], cv["gas_level_pct"], cv["gas_trips"], cv["gas_updated_by"]), ("gas", 30.0, 0, "Analista"))
        self.assertIn(("603", "gas", "Gás 80% → 30%"), [(e["prefix"], e["action"], e["detail"]) for e in overview["events"]])
        # Consumo informado no plano (planilha: FT.54 = 39% por viagem) vale no lugar da estimativa.
        self.plan(0, trucks=[gas, diesel], params={"gas_pct_per_trip": 39})
        self.assertEqual(self.front(self.overview(), 0)["gas_pct_per_trip"], 39.0)
        for bad in ("120", "-1", "abc"):
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, "% do tanque"):
                fert.save_fert_equipment(self.user["id"], {"unit_code": "NRD", "kind": "truck", "prefix": "603",
                                                           "gas_level_pct": bad}, equipment_id=gas)

    def test_ha_per_hour_from_application_speed(self):
        # FT.54: vazão 35 m³/ha → 5 km/h (BASE GERAL); simples (1,5 m × 10 seções) → 7,5 ha/h.
        tractors = [self.equipment("tractor", prefix) for prefix in ("846", "847", "1056")]
        self.plan(0, tractors=tractors)
        ft54 = self.front(self.overview(), 0)
        self.assertEqual((ft54["spacing"], ft54["ha_mode"], ft54["application_speed"], ft54["ha_per_hour_speed"]),
                         ("simples", "typed", 5, 7.5))
        self.assertAlmostEqual(ft54["calc"]["yield_ha"], 3.7 * 3 * 6.19, places=9)  # padrão: ha/h digitado
        self.plan(0, tractors=tractors, params={"ha_mode": "speed", "spacing": "combinado"})
        ft54 = self.front(self.overview(), 0)
        self.assertEqual(ft54["ha_per_hour_speed"], 6.0)                             # 2,4 m × 5 seções
        self.assertAlmostEqual(ft54["calc"]["yield_ha"], 3.7 * 3 * 6.0, places=9)
        with self.assertRaisesRegex(ValueError, "Espaçamento"):
            self.plan(0, params={"spacing": "duplo"})

    def test_week_plan_projects_trucks_and_radius(self):
        tractors = [self.equipment("tractor", prefix) for prefix in ("846", "847", "1056")]
        self.plan(0, tractors=tractors, params={"unload_h": 0})
        self.plan(1, params={"base": "SANTA CRUZ", "flow_m3_ha": 30})
        tomorrow = "2026-11-28"
        # Amanhã a FT.54 vai para o setor 870 (base Santa Cruz: 44,98 km); a vazão vem da O.S. (30).
        fert.save_fert_week(self.user["id"], {"unit_code": "NRD", "work_date": tomorrow,
                                              "service_front_id": self.fronts[0]["id"], "sector": "870"})
        week = self.overview()["week"]
        self.assertEqual(week["days"][:2], [DAY, tomorrow])
        self.assertEqual(week["budget_radius_km"], 30.0)
        row = next(item for item in week["rows"] if item["name"] == "FT.54")
        today, next_day = row["cells"][DAY], row["cells"][tomorrow]
        self.assertEqual((today["sector"], today["saved"], today["trucks_needed"]), ("3335", False, 7))  # hoje = o lançado
        self.assertEqual((next_day["sector"], next_day["farm"], next_day["radius_km"], next_day["flow_m3_ha"], next_day["tractors"]),
                         ("870", "OSCAR ANTUNE", 44.98, 30.0, 3))
        # CVs do dia seguinte pela mesma conta (30 m³/ha, 44,98 km, sem descarregamento no plano da frente).
        from backend.services.fert_dimensioning import calculate
        expected = calculate(tractors=3, trucks=0, flow_m3_ha=30, radius_km=44.98, unload_h=0)["trucks_needed"]
        self.assertEqual(next_day["trucks_needed"], expected)
        # Raio planejado de hoje: média dos raios ponderada pela vazão (FT.54 42 km/35; FT.56 44,98 km/30).
        self.assertAlmostEqual(week["totals"][DAY]["planned_radius_km"], (42 * 35 + 44.98 * 30) / 65, places=9)
        self.assertAlmostEqual(week["totals"][DAY]["radius_difference_km"], (42 * 35 + 44.98 * 30) / 65 - 30, places=9)
        fert.save_fert_settings(self.user["id"], {"unit_code": "NRD", "budget_radius_km": "40"})
        self.assertEqual(self.overview()["week"]["budget_radius_km"], 40.0)
        # Setor vazio apaga o dia.
        fert.save_fert_week(self.user["id"], {"unit_code": "NRD", "work_date": tomorrow,
                                              "service_front_id": self.fronts[0]["id"], "sector": ""})
        row = next(item for item in self.overview()["week"]["rows"] if item["name"] == "FT.54")
        self.assertNotIn(tomorrow, row["cells"])
        with self.assertRaisesRegex(ValueError, "tratores"):
            fert.save_fert_week(self.user["id"], {"unit_code": "NRD", "work_date": tomorrow,
                                                  "service_front_id": self.fronts[0]["id"], "sector": "870", "tractors": 99})

    def entry(self, index, sector, operation):
        production.save_items_sheet(self.user["id"], {"unit_code": "NRD", "work_date": DAY, "rows": [
            {"service_front_id": self.fronts[index]["id"], "sector": sector, "status": self.status, "operation": operation}]})

    def test_recommendation_comes_from_the_order_of_the_front_operation(self):
        # Setor 3335 com O.S. 509 e uma 524 mais nova, de outra recomendação.
        newer_524 = {**order("340000", "3335", OTHER, opened_on="2026-11-25"), "operation": "524"}
        service_orders.import_service_orders(self.admin["id"], "NRD", [
            order("332553", "3335", SAME), order("330537", "3803", SAME), order("330133", "870", OTHER), newer_524])
        same = ["FERTILIZANTE FEVL 10.00.06+MIX = 670 L", "FERTILIZANTE LIQUEFERTIL = 35 M3"]
        other = ["FERTILIZANTE FEVL 14.00.00+B,ZN = 340 L", "FERTILIZANTE LIQUEFERTIL = 30 M3"]
        ft54 = self.front(self.overview(), 0)
        self.assertEqual((ft54["orders"]["orders"], ft54["orders"]["recommendation"], ft54["flow_m3_ha"]),
                         (["332553"], same, 35.0))
        # A frente passa a lançar 524: vale a O.S. 524.
        self.entry(0, "3335", "524")
        ft54 = self.front(self.overview(), 0)
        self.assertEqual((ft54["orders"]["orders"], ft54["orders"]["recommendation"], ft54["flow_m3_ha"]),
                         (["340000"], other, 30.0))

    def test_front_out_of_fert_does_not_hold_its_equipment(self):
        truck = self.equipment("truck", "612")
        self.plan(0, trucks=[truck])
        # FT.54 sai da fertirrigação (lançou 338): o CV aparece livre e vai para a FT.56, mesmo com
        # outra recomendação, sem conferência e sem ficar nas duas frentes.
        self.entry(0, "3335", "338")
        self.assertIsNone(next(item for item in self.overview()["equipment"] if item["id"] == truck)["front"])
        self.assertEqual(self.plan(1, trucks=[truck])["moved"], 0)
        self.entry(0, "3335", "509")
        overview = self.overview()
        self.assertEqual((self.front(overview, 0)["trucks"], self.front(overview, 1)["trucks"]), ([], [truck]))

    def test_fronts_come_from_the_field_position(self):
        # Frentes da Posição de Campo: grupo de fertirrigação (sem operação lançada) e operação padrão
        # 509 no cadastro também entram.
        groups = production.list_catalog(self.admin["id"], include_inactive=True)["groups"]
        group = next((item for item in groups if "FERT" in item["name"].upper()), None) or             production.save_group(self.admin["id"], {"name": "Fert NRD", "position": 9})
        by_group = production.save_service_front(self.admin["id"], {
            "name": "FT.60", "group_id": group["id"], "display_style": "front", "units": ["NRD"]})
        other_group = production.list_catalog(self.admin["id"], include_inactive=True)["groups"][0]
        by_default = production.save_service_front(self.admin["id"], {
            "name": "FT.61", "group_id": other_group["id"], "display_style": "front", "units": ["NRD"],
            "default_operations": "509"})
        production.save_items_sheet(self.user["id"], {"unit_code": "NRD", "work_date": DAY, "rows": [
            {"service_front_id": by_group["id"], "sector": "3803", "status": self.status, "operation": ""},
            {"service_front_id": by_default["id"], "sector": "3335", "status": self.status, "operation": ""}]})
        fronts = {item["name"]: item for item in self.overview()["fronts"]}
        self.assertEqual(set(fronts), {"FT.54", "FT.56", "FT.57", "FT.60", "FT.61"})
        self.assertEqual((fronts["FT.60"]["orders"]["orders"], fronts["FT.60"]["flow_m3_ha"]), (["330537"], 35.0))
        self.assertEqual((fronts["FT.61"]["orders"]["orders"][0], fronts["FT.61"]["fert_operations"]), ("332553", ["509"]))

    def test_orders_imported_with_another_unit_selected_still_count(self):
        # A base de O.S. é uma só: importar com PPT selecionado substitui a base de todas as unidades.
        service_orders.import_service_orders(self.admin["id"], "PPT", [order("332553", "3335", SAME)])
        self.assertEqual(self.front(self.overview(), 0)["orders"]["orders"], ["332553"])

    def test_typed_radius_belongs_to_the_sector_and_base(self):
        # Raio digitado no plano fica no setor + base: vale nos próximos dias e a correção atualiza o
        # mesmo setor + base (sem mexer no raio dos outros setores).
        self.plan(2, params={"base": "CASA BRANCA", "radius_km": 44.2})
        self.assertEqual(self.front(self.overview("2026-11-28"), 2)["radius_km"], 44.2)
        self.plan(2, params={"base": "CASA BRANCA", "radius_km": 45})
        overview = self.overview()
        self.assertEqual((self.front(overview, 2)["radius_km"], self.front(overview, 0)["radius_km"]), (45.0, 42.0))
        # A frente que muda de setor não leva o raio do setor anterior.
        self.plan(1, params={"base": "CASA BRANCA", "radius_km": 50})
        self.assertEqual(self.front(self.overview(), 1)["radius_km"], 50.0)
        self.entry(1, "3335", "509")
        ft56 = self.front(self.overview(), 1)
        self.assertEqual((ft56["sector"], ft56["base"], ft56["radius_km"]), ("3335", "CASA BRANCA", None))

    def test_pims_select_file_feeds_the_fert_panel(self):
        # Arquivo com as colunas do docs/select-os-fertirrigacao.sql: uma linha por talhão × componente
        # nas O.S. de fertirrigação, e a O.S. de outra operação sem componentes (colunas vazias).
        from backend.services.service_order_import import parse_service_order_file
        header = ["SECAO", "SETOR", "TALHAO", "NO_OS", "OPERACAO", "DESCRICAO_OPERACAO", "CCUSTO", "CCUSTO_TRATOS",
                  "DT_ABERTURA_OS", "CD_COMPO", "DE_COMPO", "QT_RECURSO", "CD_UNIMED", "RESERVA"]
        rows = [header]
        for plot in ("1", "2"):
            rows += [
                ["3", "3335", plot, "400001", "509", "FERTIRRIGACAO LOCALIZADA", "305121", "TRATOS SOQUEIRA", "27/11/2026",
                 "140517", "FERTILIZANTE LIQUEFERTIL", "33", "M3", "RESERVA 12"],
                ["3", "3335", plot, "400001", "509", "FERTIRRIGACAO LOCALIZADA", "305121", "TRATOS SOQUEIRA", "27/11/2026",
                 "507", "FERTILIZANTE FEVL 14.00.00+MIX", "380", "L", "RESERVA 12"],
            ]
        rows.append(["4", "4000", "7", "400002", "338", "PLANTIO MECANIZADO", "305116", "PLANTIO", "27/11/2026",
                     "", "", "", "", ""])
        parsed = parse_service_order_file(xlsx(rows), "select-pims.xlsx")
        service_orders.import_service_orders(self.admin["id"], "NRD", parsed["records"], filename="select-pims.xlsx")
        ft54 = self.front(self.overview(), 0)
        # A frente passa a usar a O.S. nova sozinha: vazão, recomendação, tratos e talhões.
        self.assertEqual((ft54["orders"]["orders"], ft54["flow_m3_ha"], ft54["flow_source"]), (["400001"], 33.0, "O.S."))
        self.assertEqual(ft54["orders"]["recommendation"],
                         ["FERTILIZANTE FEVL 14.00.00+MIX = 380 L", "FERTILIZANTE LIQUEFERTIL = 33 M3"])
        self.assertEqual((ft54["orders"]["tratos"], ft54["orders"]["plots"]), ("TRATOS SOQUEIRA", ["1", "2"]))
        # A O.S. da outra operação continua importada (conferência da Produção não muda).
        listing = service_orders.list_service_orders(self.admin["id"], "NRD", summary=True)
        self.assertEqual({order["number"] for order in listing["orders"]}, {"400001", "400002"})

    def test_permissions_units_and_validation(self):
        with self.assertRaises(PermissionError):
            fert.save_fert_equipment(self.viewer["id"], {"unit_code": "NRD", "kind": "truck", "prefix": "700"})
        with self.assertRaisesRegex(ValueError, "Polo SP"):
            fert.fert_overview(self.admin["id"], "PST", DAY)
        self.assertEqual(fert.fert_overview(self.viewer["id"], "NRD", DAY)["permissions"], {"edit": False})
        self.equipment("truck", "612")
        with self.assertRaisesRegex(ValueError, "O CV 612 já está cadastrado"):
            self.equipment("truck", "612")
        with self.assertRaisesRegex(ValueError, "Situação inválida"):
            self.equipment("truck", "613", status="voando")
        for bad in ({"trucks": [True]}, {"trucks": "612"}, {"params": {"hours": 99}}, {"params": "x"}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.plan(0, **bad)

    def allocate(self, equipment_id, index=None):
        return fert.allocate_fert_equipment(self.user["id"], {
            "unit_code": "NRD", "work_date": DAY, "equipment_id": equipment_id,
            "service_front_id": None if index is None else self.fronts[index]["id"]})

    def test_dispatch_board_allocates_moves_and_releases(self):
        truck = self.equipment("truck", "612")
        self.plan(0, params={"base": "SANTA CRUZ", "hours": 5, "round_trip": True})
        # Arrastar do "Disponíveis" para a FT.54: aloca sem mexer na base e nos parâmetros da frente.
        self.allocate(truck, 0)
        ft54 = self.front(self.overview(), 0)
        self.assertEqual((ft54["trucks"], ft54["base"], ft54["params"]["hours"], ft54["params"]["round_trip"]),
                         ([truck], "SANTA CRUZ", 5, True))
        # Para a FT.57 (mesma receita) muda de frente; para a FT.56 (outra receita) não.
        self.assertEqual(self.allocate(truck, 2)["moved"], 1)
        with self.assertRaisesRegex(ValueError, "a recomendação é diferente"):
            self.allocate(truck, 1)
        # Arrastar de volta para "Disponíveis" libera o CV.
        self.assertTrue(self.allocate(truck)["released"])
        overview = self.overview()
        item = next(entry for entry in overview["equipment"] if entry["id"] == truck)
        self.assertEqual((self.front(overview, 2)["trucks"], item["front"], item["status"]), ([], None, "available"))
        with self.assertRaisesRegex(ValueError, "já está disponível"):
            self.allocate(truck)
        with self.assertRaisesRegex(ValueError, "não está com fertirrigação"):
            self.allocate(truck, 3)

    def test_front_uses_the_chosen_service_order(self):
        # Setor 3335 com duas O.S. abertas (como na planilha, a O.S. é escolhida por frente): sem
        # escolha vale a mais recente; escolhida, recomendação, vazão, talhões e receita são só dela.
        service_orders.import_service_orders(self.admin["id"], "NRD", [
            order("332553", "3335", SAME), order("330537", "3803", SAME), order("330133", "870", OTHER),
            {**order("300000", "3335", OTHER, opened_on="2026-10-01"), "plots": ["7", "8"]},
        ])
        ft54 = self.front(self.overview(), 0)
        self.assertEqual((ft54["orders"]["order"], ft54["orders"]["orders"], ft54["flow_m3_ha"], ft54["orders"]["plots"]),
                         ("332553", ["332553", "300000"], 35.0, ["1", "2"]))
        self.assertEqual([option["order"] for option in ft54["orders"]["options"]], ["332553", "300000"])
        self.plan(0, params={"base": "SANTA CRUZ", "order_number": "300000"})
        ft54 = self.front(self.overview(), 0)
        self.assertEqual((ft54["orders"]["order"], ft54["flow_m3_ha"], ft54["orders"]["plots"]), ("300000", 30.0, ["7", "8"]))
        self.assertEqual(ft54["orders"]["recommendation"],
                         ["FERTILIZANTE FEVL 14.00.00+B,ZN = 340 L", "FERTILIZANTE LIQUEFERTIL = 30 M3"])
        # A receita da O.S. escolhida vale na troca de CV: agora a FT.54 recebe o CV da FT.56.
        truck = self.equipment("truck", "612")
        self.plan(1, trucks=[truck])
        self.assertEqual(self.allocate(truck, 0)["moved"], 1)
        # O.S. que não está mais aberta: volta para a mais recente.
        self.plan(0, params={"base": "SANTA CRUZ", "order_number": "999999"})
        orders = self.front(self.overview(), 0)["orders"]
        self.assertEqual((orders["order"], orders["missing_order"]), ("332553", "999999"))

    def test_audit_rules(self):
        groups = production.list_catalog(self.admin["id"], include_inactive=True)["groups"]
        fert_group = next(item for item in groups if "FERTIRRIG" in item["name"].upper())
        # Fert convencional (346/342) fica no grupo Fertirrigação, mas não entra no dimensionamento;
        # frente do grupo sem operação nenhuma entra.
        conventional = production.save_service_front(self.admin["id"], {
            "name": "FERT CONV 01", "group_id": fert_group["id"], "display_style": "front", "units": ["NRD"],
            "default_operations": "346, 342"})
        empty = production.save_service_front(self.admin["id"], {
            "name": "FT.70", "group_id": fert_group["id"], "display_style": "front", "units": ["NRD"]})
        production.save_items_sheet(self.user["id"], {"unit_code": "NRD", "work_date": DAY, "rows": [
            {"service_front_id": conventional["id"], "sector": "3335", "status": self.status, "operation": "346"},
            {"service_front_id": empty["id"], "sector": "3803", "status": self.status, "operation": ""}]})
        names = {item["name"] for item in self.overview()["fronts"]}
        self.assertIn("FT.70", names)
        self.assertNotIn("FERT CONV 01", names)
        # O tipo do equipamento não muda depois do cadastro.
        truck = self.equipment("truck", "612")
        with self.assertRaisesRegex(ValueError, "tipo"):
            fert.save_fert_equipment(self.user["id"], {"unit_code": "NRD", "kind": "tractor", "prefix": "612"},
                                     equipment_id=truck)
        # Excluir tira o CV da frente e a frente continua aceitando alocação.
        other = self.equipment("truck", "615")
        self.plan(0, params={"base": "SANTA CRUZ"}, trucks=[truck])
        fert.delete_fert_equipment(self.user["id"], "NRD", truck)
        self.assertEqual(self.front(self.overview(), 0)["trucks"], [])
        self.allocate(other, 0)
        self.assertEqual(self.front(self.overview(), 0)["trucks"], [other])
        # ha/hora pela velocidade não vira "ha/hora digitado" no popup.
        self.plan(0, params={"base": "SANTA CRUZ", "ha_mode": "speed"}, trucks=[other])
        ft54 = self.front(self.overview(), 0)
        self.assertIsNone(ft54["params"]["ha_per_hour"])
        self.assertAlmostEqual(ft54["calc"]["yield_ha"], 3.7 * 0 * 7.5)

    def test_simultaneous_edit_of_the_same_front(self):
        # Dois analistas abrem a FT.54; o primeiro salva; o segundo não sobrescreve sem ver.
        version = self.front(self.overview(), 0)["plan_version"]
        truck = self.equipment("truck", "612")
        self.plan(0, params={"base": "SANTA CRUZ"}, trucks=[truck], version=version)
        with self.assertRaisesRegex(ValueError, "alterada por Analista"):
            self.plan(0, params={"base": "SANTA CRUZ"}, trucks=[], version=version)
        self.assertEqual(self.front(self.overview(), 0)["trucks"], [truck])
        # Com a versão atual (reaberto), grava.
        current = self.front(self.overview(), 0)["plan_version"]
        self.plan(0, params={"base": "SANTA CRUZ"}, trucks=[], version=current)
        # Uma troca de CV feita por outro (arrastar) também muda a versão da frente de origem.
        self.plan(0, params={"base": "SANTA CRUZ"}, trucks=[truck])
        before = self.front(self.overview(), 0)["plan_version"]
        self.allocate(truck)
        self.assertNotEqual(self.front(self.overview(), 0)["plan_version"], before)

    def test_busy_database_answers_try_again(self):
        # Banco ocupado além da espera: aviso para tentar de novo (503), não erro genérico.
        import io
        import sqlite3
        from backend.controllers import application_controller as app
        captured = {}

        def start_response(status, headers):
            captured["status"] = status

        environ = {"REQUEST_METHOD": "GET", "PATH_INFO": "/api/production/fert", "QUERY_STRING": "",
                   "wsgi.input": io.BytesIO(b""), "HTTP_HOST": "localhost", "wsgi.url_scheme": "http"}
        with patch.object(app, "_handle", side_effect=sqlite3.OperationalError("database is locked")):
            body = b"".join(app.application(environ, start_response)).decode("utf-8")
        self.assertTrue(captured["status"].startswith("503"))
        self.assertIn("tente de novo", body)
        with patch.object(app, "_handle", side_effect=sqlite3.OperationalError("no such table: x")):
            with self.assertRaises(sqlite3.OperationalError):
                app.application(environ, start_response)

    def test_fert_module_permission(self):
        # Sem o módulo Fertirrigação, quem tem a Produção Agrícola não entra; Consultar só vê;
        # Editar configura e aloca; a unidade continua a liberada na Produção.
        self.grant_fert(self.user["id"], view=False)
        with self.assertRaisesRegex(PermissionError, "acesso à Fertirrigação"):
            self.overview()
        with self.assertRaisesRegex(PermissionError, "acesso à Fertirrigação"):
            self.equipment("truck", "700")
        self.grant_fert(self.user["id"], edit=False)
        self.assertEqual(self.overview()["permissions"], {"edit": False})
        with self.assertRaisesRegex(PermissionError, "somente para consulta na Fertirrigação"):
            self.plan(0, params={"base": "SANTA CRUZ"})
        self.grant_fert(self.user["id"], edit=True)
        self.assertEqual(self.overview()["permissions"], {"edit": True})
        with self.assertRaisesRegex(PermissionError, "PPT não está liberada"):
            fert.fert_overview(self.user["id"], "PPT", DAY)
        self.assertEqual(fert.fert_overview(self.admin["id"], "NRD", DAY)["permissions"], {"edit": True})

    def test_stale_equipment_table_is_upgraded(self):
        # Banco de uma versão intermediária: frota sem situação/gás. Vazia, é recriada.
        from backend.models import storage
        with connection() as conn:
            conn.execute("DROP TABLE main.production_fert_equipment")
            conn.execute("""CREATE TABLE main.production_fert_equipment (id INTEGER PRIMARY KEY, unit_code TEXT, kind TEXT,
                prefix TEXT, capacity_m3 REAL, status TEXT, notes TEXT, created_by INTEGER, updated_by INTEGER,
                created_at INTEGER, updated_at INTEGER)""")
            storage._reset_stale_fert_tables(conn)
            storage._create_production_tables(conn)
            columns = {row[1] for row in conn.execute("PRAGMA main.table_info(production_fert_equipment)")}
        self.assertTrue({"status_changed_by", "fuel", "gas_level_pct", "gas_updated_at"} <= columns)
        self.equipment("truck", "612", fuel="gas", gas_level_pct=50)

    def test_base_names(self):
        self.assertEqual({fert.base_key(name) for name in ("BASE STA CRUZ", "Santa Cruz", "SANTA CRUZ")}, {"SANTA CRUZ"})
        self.assertEqual(fert.base_key("BIÉ"), fert.base_key("BIE"))

if __name__ == "__main__":
    unittest.main()
