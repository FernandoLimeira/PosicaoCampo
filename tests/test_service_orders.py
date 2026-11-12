import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from xml.sax.saxutils import escape
from zipfile import ZipFile

from backend import config
from backend.models import database as db
from backend.models import production
from backend.models import service_orders
from backend.models import storage
from backend.services.service_order_import import parse_service_order_file


def xlsx(rows):
    data = io.BytesIO()
    xml_rows = "".join('<row r="%d">%s</row>' % (number, "".join(
        f'<c r="{chr(65 + index)}{number}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'
        for index, value in enumerate(values))) for number, values in enumerate(rows, 1))
    with ZipFile(data, "w") as archive:
        archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="OS" sheetId="1" r:id="rId1"/></sheets></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + xml_rows + '</sheetData></worksheet>')
    return data.getvalue()


class ServiceOrderTests(unittest.TestCase):
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
            "Analista", "Analyst-pass-42", role="analyst", base_unit="PPT",
            production_access={"enabled": True, "permissions": {"fill": True}, "units": ["PPT"]},
        )
        group = production.list_catalog(self.admin["id"], include_inactive=True)["groups"][0]
        self.front = production.save_service_front(self.admin["id"], {
            "name": "Preparo de solo", "group_id": group["id"], "display_style": "operation",
            "position": 1, "units": ["PPT"], "is_active": True,
        })
        self.status = production.list_statuses(self.admin["id"])["statuses"][0]["code"]

    def _launch(self, sector):
        production.save_my_item(self.user["id"], {
            "unit_code": "PPT", "service_front_id": self.front["id"], "work_date": "2026-11-10",
            "sector": sector, "section": "", "farm": "", "status": self.status,
        })

    HEADER = ["CHAVE", "NO_OS", "SETOR", "SECAO", "OPERACAO", "TALHAO", "CCUSTO", "CCUSTO_TRATOS", "DT_ABERTURA_OS"]

    def test_old_service_order_table_is_upgraded(self):
        # Tabela criada por versões antigas: sem descrição, centro de custo e talhões.
        with storage.connection() as conn:
            conn.execute("DROP TABLE production_service_orders")
            conn.execute("""CREATE TABLE production_service_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT, unit_code TEXT NOT NULL COLLATE NOCASE,
                order_number TEXT NOT NULL, sector TEXT NOT NULL, sector_key TEXT NOT NULL,
                section TEXT NOT NULL DEFAULT '', farm TEXT NOT NULL DEFAULT '', operation TEXT NOT NULL DEFAULT '',
                operation_key TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', opened_on TEXT NOT NULL DEFAULT '',
                closed_on TEXT NOT NULL DEFAULT '', details_json TEXT NOT NULL DEFAULT '{}', import_file TEXT NOT NULL DEFAULT '',
                imported_by INTEGER, imported_at INTEGER NOT NULL)""")
        db.init_db()
        result = service_orders.import_service_orders(self.admin["id"], "PPT", [
            {"number": "1", "sector": "1577", "operation": "457", "operation_name": "TRATOS", "plots": ["1", "2"]},
        ])
        self.assertEqual(result["imported"], 1)
        order = service_orders.list_service_orders(self.admin["id"], "PPT")["orders"][0]
        self.assertEqual((order["operation_name"], order["plots"]), ("TRATOS", ["1", "2"]))

    def test_rain_overview_averages_the_four_units(self):
        production.save_daily_summary(self.admin["id"], {"unit_code": "PPT", "work_date": "2026-11-10",
                                                         "rain_turn_mm": "2", "rain_accumulated_mm": "10"})
        production.save_daily_summary(self.admin["id"], {"unit_code": "PST", "work_date": "2026-11-10",
                                                         "rain_turn_mm": "5", "rain_accumulated_mm": "31"})
        production.save_daily_summary(self.admin["id"], {"unit_code": "NRD", "work_date": "2026-11-09",
                                                         "rain_turn_mm": "50", "rain_accumulated_mm": "50"})  # outro dia
        # Analista com acesso só ao PPT também vê o quadro das 4 unidades.
        rain = production.get_rain_overview(self.user["id"], "2026-11-10")
        self.assertEqual([unit["unit"] for unit in rain["units"]], ["PPT", "NRD", "RBR", "PST"])
        self.assertEqual((rain["average_turn_mm"], rain["average_accumulated_mm"], rain["informed"]), (3.5, 20.5, 2))
        self.assertIsNone(rain["units"][1]["rain_turn_mm"])

    def test_fert_convencional_has_default_operations(self):
        group = production.list_catalog(self.admin["id"], include_inactive=True)["groups"][0]
        fert = production.save_service_front(self.admin["id"], {
            "name": "Fert Convencional", "group_id": group["id"], "position": 3, "units": ["PPT", "PST"], "is_active": True,
        })
        self.assertEqual(fert["default_operations"], "")
        # Migração (servidor com a frente já cadastrada): só a Fert convencional recebe 346, 342.
        with storage.connection() as conn:
            conn.execute("DELETE FROM schema_info WHERE key='production_front_default_operations'")
        db.init_db()
        fronts = {front["name"]: front for group_item in production.list_catalog(self.admin["id"], include_inactive=True)["groups"]
                  for front in group_item["fronts"]}
        self.assertEqual(fronts["Fert Convencional"]["default_operations"], "346, 342")
        self.assertEqual(fronts["Preparo de solo"]["default_operations"], "")
        # Salvar a frente sem o campo mantém o padrão; com o campo, troca.
        payload = {"name": "Fert Convencional", "group_id": group["id"], "position": 3, "units": ["PPT", "PST"], "is_active": True}
        self.assertEqual(production.save_service_front(self.admin["id"], payload, front_id=fert["id"])["default_operations"], "346, 342")
        changed = production.save_service_front(self.admin["id"], {**payload, "default_operations": "342 346 342"}, front_id=fert["id"])
        self.assertEqual(changed["default_operations"], "342, 346")
        # O catálogo da unidade (usado ao lançar) traz o padrão.
        unit_fronts = [front for group_item in production.list_catalog(self.admin["id"], unit_code="PST")["groups"] for front in group_item["fronts"]]
        self.assertEqual([front["default_operations"] for front in unit_fronts if front["id"] == fert["id"]], ["342, 346"])

    def test_polo_ms_ties_operation_to_sector_and_section(self):
        group = production.list_catalog(self.admin["id"], include_inactive=True)["groups"][0]
        front = production.save_service_front(self.admin["id"], {
            "name": "Fertirrigação MS", "group_id": group["id"], "display_style": "operation",
            "position": 2, "units": ["PST", "PPT"], "is_active": True,
        })
        service_orders.import_service_orders(self.admin["id"], "PST", [
            {"number": "329655", "sector": "1", "section": "67626", "operation": "342", "plots": ["5", "8"]},
            {"number": "331116", "sector": "1", "section": "90284", "operation": "348", "plots": ["1"]},
        ])

        def launch(unit, section, operation):
            for item in production.list_my_items(self.admin["id"], unit, "2026-11-10", scope="all")["items"]:
                production.save_items_sheet(self.admin["id"], {"unit_code": unit, "work_date": "2026-11-10", "removed": [item["id"]]})
            production.save_items_sheet(self.admin["id"], {"unit_code": unit, "work_date": "2026-11-10", "rows": [
                {"service_front_id": front["id"], "sector": "1", "section": section, "status": self.status, "operation": operation}]})
            return production.list_my_items(self.admin["id"], unit, "2026-11-10", scope="all")["items"][0]["service_order"]

        # Polo MS: mesma seção confere e o "Ver" mostra só as O.S. dessa seção.
        order = launch("PST", "67626", "342")
        self.assertEqual((order["status"], order["needs_section"]), ("ok", False))
        self.assertEqual([o["number"] for o in order["orders"]], ["329655"])
        # A operação 348 só tem O.S. em outra seção do mesmo setor: não confere.
        self.assertEqual(launch("PST", "67626", "348")["missing_operations"], ["348"])
        # Sem seção, nenhuma O.S. confere e a tela pede a seção.
        order = launch("PST", "", "342")
        self.assertEqual((order["status"], order["needs_section"]), ("missing", True))
        # Polo SP continua conferindo só pelo setor.
        order = launch("PPT", "", "348")
        self.assertEqual((order["status"], order["needs_section"]), ("ok", False))

        # Nome de cada operação: o do cadastro; sem cadastro, o do arquivo de O.S.
        service_orders.save_operation(self.admin["id"], {"code": "999", "name": "OPERAÇÃO DO CADASTRO"})
        order = launch("PST", "67626", "342, 999")
        self.assertEqual(order["missing_operations"], ["999"])
        self.assertEqual(order["operation_names"]["999"], "OPERAÇÃO DO CADASTRO")

    def test_parser_reads_operation_name_column(self):
        # Layout novo: DESCRICAO_OPERACAO é o nome da operação, mesmo depois de CCUSTO_TRATOS.
        parsed = parse_service_order_file(xlsx([
            ["SECAO", "SETOR", "TALHAO", "NO_OS", "OPERACAO", "CCUSTO_TRATOS", "DESCRICAO_OPERACAO", "CCUSTO", "DT_ABERTURA_OS"],
            ["67626", "1", "5", "329655", "342", "TRATOS SOQUEIRA", "FERT ASPERSAO 1 LAMINA", "305121", "46311"],
            ["67626", "1", "8", "329655", "342", "TRATOS SOQUEIRA", "FERT ASPERSAO 1 LAMINA", "305121", "46311"],
            ["90284", "1", "1", "331116", "348", "PREPARO DO SOLO", "ARACAO S/ INSUMO", "305111", "46335"],
            ["", "", "", "", "", "", "", "", ""],
        ]), "Pasta1.xlsx")
        first, second = parsed["records"]
        self.assertEqual((first["number"], first["operation"], first["operation_name"]), ("329655", "342", "FERT ASPERSAO 1 LAMINA"))
        self.assertEqual((first["section"], first["cost_center"], first["plots"]), ("67626", "305121", ["5", "8"]))
        self.assertEqual(second["operation_name"], "ARACAO S/ INSUMO")
        self.assertEqual(first["key"], "")  # CHAVE é opcional

    def test_parser_groups_plots_of_the_same_order(self):
        parsed = parse_service_order_file(xlsx([
            self.HEADER,
            ["4338", "331158", "4", "1", "338", "3", "305116", "PLANTIO MEIOSI", "46335"],
            ["4338", "331158", "4", "1", "338", "10", "305116", "PLANTIO MEIOSI", "46335"],
            ["4338", "331158", "4", "1", "338", "4", "305116", "PLANTIO MEIOSI", "46335"],
            ["1577457", "331200", "1577", "2", "457", "1", "305117", "TRATOS PLANTIO", "46293"],
            ["", "", "", "", "", "", "", "", ""],
        ]), "ordens.xlsx")
        self.assertEqual(parsed["rows_read"], 4)
        first, second = parsed["records"]
        self.assertEqual((first["number"], first["sector"], first["section"], first["operation"]), ("331158", "4", "1", "338"))
        self.assertEqual(first["plots"], ["3", "4", "10"])
        self.assertEqual((first["operation_name"], first["cost_center"], first["opened_on"]), ("PLANTIO MEIOSI", "305116", "2026-11-09"))
        self.assertEqual(second["opened_on"], "2026-09-28")
        # Todas as colunas do arquivo ficam guardadas, uma linha por talhão.
        self.assertEqual(first["columns"], self.HEADER)
        self.assertEqual(len(first["rows"]), 3)
        self.assertEqual(first["rows"][0]["CHAVE"], "4338")
        self.assertEqual(first["rows"][0]["DT_ABERTURA_OS"], "2026-11-09")
        self.assertEqual(first["key"], "4338")
        with self.assertRaisesRegex(ValueError, "colunas obrigatórias"):
            parse_service_order_file(xlsx([["SETOR", "TALHAO"], ["1", "2"]]), "x.xlsx")
        with self.assertRaisesRegex(ValueError, "XLSX"):
            parse_service_order_file(b"<xml/>", "ordens.xml")

    def test_launch_shows_ok_by_sector_and_operation_code(self):
        self._launch("1577")
        items = production.list_my_items(self.user["id"], "PPT", "2026-11-10")["items"]
        self.assertEqual(items[0]["service_order"]["status"], "no_operation")

        with self.assertRaises(PermissionError):
            service_orders.import_service_orders(self.user["id"], "PPT", [{"number": "1", "sector": "1577", "operation": "457"}])

        result = service_orders.import_service_orders(self.admin["id"], "PPT", [
            {"number": "5501", "sector": "01577", "section": "2", "operation": "457", "operation_name": "TRATOS PLANTIO",
             "plots": ["1", "2"]},
            {"number": "5503", "sector": "999", "operation": "338"},
        ], filename="ordens.xlsx")
        self.assertEqual((result["imported"], result["removed"]), (2, 0))
        # Sem operação informada: "Sem operação", mesmo com O.S. no setor (o "Ver" mostra as O.S.).
        order = production.list_my_items(self.user["id"], "PPT", "2026-11-10")["items"][0]["service_order"]
        self.assertEqual(order["status"], "no_operation")
        self.assertEqual(order["orders"][0]["plots"], ["1", "2"])
        self.assertFalse(order["orders"][0]["matches"])

        item_id = production.list_my_items(self.user["id"], "PPT", "2026-11-10")["items"][0]["id"]
        for operation, expected in (("338", "missing"), ("457 — TRATOS PLANTIO", "ok")):
            production.save_items_sheet(self.user["id"], {"unit_code": "PPT", "work_date": "2026-11-10", "rows": [
                {"id": item_id, "service_front_id": self.front["id"], "sector": "1577", "section": "", "status": self.status,
                 "operation": operation}]})
            order = production.list_my_items(self.user["id"], "PPT", "2026-11-10")["items"][0]["service_order"]
            self.assertEqual(order["status"], expected, operation)
            # O detalhe sempre traz todas as O.S. do setor, marcando as que conferem.
            self.assertEqual([(o["number"], o["matches"]) for o in order["orders"]], [("5501", expected == "ok")])

        # Seção diferente da O.S. não confere.
        production.save_items_sheet(self.user["id"], {"unit_code": "PPT", "work_date": "2026-11-10", "rows": [
            {"id": item_id, "service_front_id": self.front["id"], "sector": "1577", "section": "3", "status": self.status,
             "operation": "457"}]})
        self.assertEqual(production.list_my_items(self.user["id"], "PPT", "2026-11-10")["items"][0]["service_order"]["status"], "missing")

        again = service_orders.import_service_orders(self.admin["id"], "PPT", [
            {"number": "6000", "sector": "1577", "operation": "361", "operation_name": "PREPARO DO SOLO"},
        ])
        self.assertEqual(again["removed"], 2)
        listing = service_orders.list_service_orders(self.user["id"], "PPT", "preparo")
        self.assertEqual([item["number"] for item in listing["orders"]], ["6000"])
        self.assertFalse(listing["can_import"])
        with self.assertRaises(PermissionError):
            service_orders.list_service_orders(self.user["id"], "NRD")

        # Base única: a importação feita em outra unidade substitui as O.S. de todas
        # e vale para os lançamentos de PPT.
        other = service_orders.import_service_orders(self.admin["id"], "NRD", [
            {"number": "7000", "sector": "1577", "operation": "457"},
        ])
        self.assertEqual(other["removed"], 1)
        listing = service_orders.list_service_orders(self.user["id"], "PPT")
        self.assertEqual([item["number"] for item in listing["orders"]], ["7000"])
        self.assertEqual(listing["total"], 1)
        production.save_items_sheet(self.user["id"], {"unit_code": "PPT", "work_date": "2026-11-10", "rows": [
            {"id": item_id, "service_front_id": self.front["id"], "sector": "1577", "section": "", "status": self.status,
             "operation": "457"}]})
        self.assertEqual(production.list_my_items(self.user["id"], "PPT", "2026-11-10")["items"][0]["service_order"]["status"], "ok")

    def test_import_route_accepts_xlsx_upload(self):
        from backend.app import application
        file_bytes = xlsx([self.HEADER, ["1577361", "7001", "1577", "1", "361", "1", "305111", "PREPARO DO SOLO", "46335"]])
        boundary = "os-upload"
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="ordens.xlsx"\r\n'
                'Content-Type: application/octet-stream\r\n\r\n').encode() + file_bytes + f'\r\n--{boundary}--\r\n'.encode()
        result = {}

        def start_response(status, headers):
            result["status"] = int(status.split()[0])

        cookie = f"{config.SESSION_COOKIE}={db.create_session(self.admin['id'])}"
        raw = b"".join(application({
            "REQUEST_METHOD": "POST", "PATH_INFO": "/api/production/service-orders/import", "QUERY_STRING": "unit=PPT",
            "CONTENT_TYPE": "multipart/form-data; boundary=" + boundary, "CONTENT_LENGTH": str(len(body)),
            "wsgi.input": io.BytesIO(body), "wsgi.url_scheme": "https", "HTTP_HOST": "test.invalid",
            "REMOTE_ADDR": "127.0.0.1", "HTTP_COOKIE": cookie,
        }, start_response))
        self.assertEqual(result["status"], 200, raw)
        self._launch("1577")
        item_id = production.list_my_items(self.user["id"], "PPT", "2026-11-10")["items"][0]["id"]
        production.save_items_sheet(self.user["id"], {"unit_code": "PPT", "work_date": "2026-11-10", "rows": [
            {"id": item_id, "service_front_id": self.front["id"], "sector": "1577", "status": self.status, "operation": "361"}]})
        item = production.list_my_items(self.user["id"], "PPT", "2026-11-10")["items"][0]
        self.assertEqual(item["service_order"]["status"], "ok")

    def test_popup_sheet_saves_rows_operation_and_removals_atomically(self):
        db.save_sector_base_item("1577", "10", "EDSON BORGES", self.admin["id"])
        service_orders.import_service_orders(self.admin["id"], "PPT", [
            {"number": "8001", "sector": "1577", "section": "10", "operation": "361"},
        ])
        result = production.save_items_sheet(self.user["id"], {
            "unit_code": "PPT", "work_date": "2026-11-10",
            "rows": [
                {"service_front_id": self.front["id"], "sector": "1577", "section": "10", "status": self.status,
                 "operation": "361", "observation": "Ok"},
                {"service_front_id": self.front["id"], "sector": "4702", "section": "", "status": self.status},
            ],
        })
        self.assertEqual(result["saved"], 2)
        items = {item["entry"]["sector"]: item for item in
                 production.list_my_items(self.user["id"], "PPT", "2026-11-10", scope="all")["items"]}
        # Fazenda vem da base de setores; a O.S. confere pela operação informada.
        self.assertEqual(items["1577"]["entry"]["farm"], "EDSON BORGES")
        self.assertEqual(items["1577"]["entry"]["operation"], "361")
        self.assertEqual(items["1577"]["service_order"]["status"], "ok")
        self.assertEqual(items["4702"]["service_order"]["status"], "no_operation")  # sem operação informada

        # Linha sem "operation" mantém a operação anterior; exclusão e edição na mesma gravação.
        production.save_items_sheet(self.user["id"], {
            "unit_code": "PPT", "work_date": "2026-11-11",
            "rows": [{"id": items["1577"]["id"], "service_front_id": self.front["id"], "sector": "1577",
                      "section": "10", "status": self.status}],
            "removed": [items["4702"]["id"]],
        })
        after = production.list_my_items(self.user["id"], "PPT", "2026-11-11", scope="all")["items"]
        self.assertEqual([item["entry"]["sector"] for item in after], ["1577"])
        self.assertEqual(after[0]["entry"]["operation"], "361")

        # Erro em uma linha não grava nada.
        with self.assertRaisesRegex(ValueError, "Linha 2"):
            production.save_items_sheet(self.user["id"], {
                "unit_code": "PPT", "work_date": "2026-11-12",
                "rows": [
                    {"id": after[0]["id"], "service_front_id": self.front["id"], "sector": "1577", "status": self.status},
                    {"service_front_id": self.front["id"], "sector": "", "status": self.status},
                ],
            })
        unchanged = production.list_my_items(self.user["id"], "PPT", "2026-11-12", scope="all")["items"]
        self.assertEqual(unchanged[0]["entry"]["work_date"], "2026-11-11")

    def test_popup_sheet_swaps_sectors_between_rows(self):
        production.save_items_sheet(self.user["id"], {"unit_code": "PPT", "work_date": "2026-11-10", "rows": [
            {"service_front_id": self.front["id"], "sector": "3008", "status": self.status},
            {"service_front_id": self.front["id"], "sector": "3815", "status": self.status},
        ]})
        ids = {item["entry"]["sector"]: item["id"] for item in
               production.list_my_items(self.user["id"], "PPT", "2026-11-10", scope="all")["items"]}
        # A linha 1 recebe o setor que a linha 2 está deixando na mesma gravação.
        production.save_items_sheet(self.user["id"], {"unit_code": "PPT", "work_date": "2026-11-10", "rows": [
            {"id": ids["3008"], "service_front_id": self.front["id"], "sector": "3815", "status": self.status},
            {"id": ids["3815"], "service_front_id": self.front["id"], "sector": "4000", "status": self.status},
        ]})
        after = {item["id"]: item["entry"]["sector"] for item in
                 production.list_my_items(self.user["id"], "PPT", "2026-11-10", scope="all")["items"]}
        self.assertEqual(after, {ids["3008"]: "3815", ids["3815"]: "4000"})
        # Setor de outro lançamento que não muda continua bloqueado.
        with self.assertRaisesRegex(ValueError, "Linha 1: o setor 3815 já está lançado"):
            production.save_items_sheet(self.user["id"], {"unit_code": "PPT", "work_date": "2026-11-10", "rows": [
                {"id": ids["3815"], "service_front_id": self.front["id"], "sector": "3815", "status": self.status}]})

    def test_several_operations_need_an_order_each(self):
        self._launch("4")
        item_id = production.list_my_items(self.user["id"], "PPT", "2026-11-10")["items"][0]["id"]
        service_orders.import_service_orders(self.admin["id"], "PPT", [
            {"number": "330097", "sector": "4", "section": "1", "operation": "457"},
        ])
        production.save_items_sheet(self.user["id"], {"unit_code": "PPT", "work_date": "2026-11-10", "rows": [
            {"id": item_id, "service_front_id": self.front["id"], "sector": "4", "section": "1", "status": self.status,
             "operation": "457, 338, 457"}]})
        item = production.list_my_items(self.user["id"], "PPT", "2026-11-10")["items"][0]
        self.assertEqual(item["entry"]["operation"], "457, 338")
        self.assertEqual(item["service_order"]["status"], "missing")
        self.assertEqual(item["service_order"]["missing_operations"], ["338"])
        service_orders.import_service_orders(self.admin["id"], "PPT", [
            {"number": "330097", "sector": "4", "section": "1", "operation": "457"},
            {"number": "331158", "sector": "4", "section": "1", "operation": "338"},
            {"number": "331999", "sector": "4", "section": "1", "operation": "396"},
        ])
        order = production.list_my_items(self.user["id"], "PPT", "2026-11-10")["items"][0]["service_order"]
        self.assertEqual(order["status"], "ok")
        self.assertEqual({o["number"]: o["matches"] for o in order["orders"]},
                         {"330097": True, "331158": True, "331999": False})

        # Duas operações no mesmo campo, separadas por espaço, "/" ou "-", contam as duas.
        for typed in ("457 338", "457/338", "457 - 396 / 338"):
            production.save_items_sheet(self.user["id"], {"unit_code": "PPT", "work_date": "2026-11-10", "rows": [
                {"id": item_id, "service_front_id": self.front["id"], "sector": "4", "section": "1", "status": self.status,
                 "operation": typed}]})
            item = production.list_my_items(self.user["id"], "PPT", "2026-11-10")["items"][0]
            self.assertEqual(item["entry"]["operation"], ", ".join(typed.replace("/", " ").replace("-", " ").split()), typed)
            self.assertEqual(item["service_order"]["status"], "ok", typed)
        # Código com descrição continua sendo uma operação só.
        self.assertEqual(service_orders.operation_keys("338 — TRATOS PLANTIO, 457"), ["338", "457"])
        self.assertEqual(service_orders.operation_keys("338 999"), ["338", "999"])

    def test_operations_catalog_crud_and_import_fill(self):
        with self.assertRaises(PermissionError):
            service_orders.save_operation(self.user["id"], {"code": "338", "name": "Plantio"})
        created = service_orders.save_operation(self.admin["id"], {
            "code": "0338", "name": "PLANTIO MEIOSI", "service_front_id": self.front["id"], "position": 2})
        self.assertEqual((created["code"], created["front_name"], created["in_use"]), ("0338", "Preparo de solo", False))
        with self.assertRaisesRegex(ValueError, "já está cadastrada"):
            service_orders.save_operation(self.admin["id"], {"code": "338", "name": "Outra"})
        # A importação acrescenta só as operações que faltam, com a descrição do arquivo.
        service_orders.import_service_orders(self.admin["id"], "PPT", [
            {"number": "1", "sector": "4", "operation": "338", "operation_name": "NÃO SOBRESCREVE"},
            {"number": "2", "sector": "4", "operation": "457", "operation_name": "TRATOS PLANTIO"},
        ])
        listing = service_orders.list_operations(self.user["id"])
        self.assertFalse(listing["can_configure"])
        self.assertEqual({item["code"]: item["name"] for item in listing["operations"]},
                         {"0338": "PLANTIO MEIOSI", "457": "TRATOS PLANTIO"})
        # Operação usada em lançamento não é apagada; pode ser inativada.
        self._launch("4")
        item_id = production.list_my_items(self.user["id"], "PPT", "2026-11-10")["items"][0]["id"]
        production.save_items_sheet(self.user["id"], {"unit_code": "PPT", "work_date": "2026-11-10", "rows": [
            {"id": item_id, "service_front_id": self.front["id"], "sector": "4", "status": self.status, "operation": "338"}]})
        with self.assertRaisesRegex(ValueError, "Inative"):
            service_orders.delete_operation(self.admin["id"], created["id"])
        service_orders.save_operation(self.admin["id"], {"code": "338", "name": "PLANTIO MEIOSI", "is_active": False},
                                      operation_id=created["id"])
        self.assertEqual([item["code"] for item in service_orders.list_operations(self.admin["id"])["operations"]], ["457"])
        other = next(item for item in listing["operations"] if item["code"] == "457")
        service_orders.delete_operation(self.admin["id"], other["id"])
        self.assertEqual(service_orders.list_operations(self.admin["id"])["operations"], [])

    def test_saved_sql_queries_can_be_added_updated_and_removed(self):
        sql = "SELECT OHE.NO_OS FROM PA_OS_HE OHE\nWHERE OHE.FG_SITUACAO = 'A'"
        with self.assertRaises(PermissionError):
            service_orders.save_sql_query(self.user["id"], {"name": "O.S.", "sql": sql})
        with self.assertRaisesRegex(ValueError, "Cole o comando SQL"):
            service_orders.save_sql_query(self.admin["id"], {"name": "O.S.", "sql": "   "})
        created = service_orders.save_sql_query(self.admin["id"], {"name": "O.S. abertas", "description": "Polo SP", "sql": sql})
        self.assertEqual((created["name"], created["sql"], created["updated_by"]), ("O.S. abertas", sql, "Admin"))
        updated = service_orders.save_sql_query(self.admin["id"], {"name": "O.S. abertas 2026", "sql": sql + "\nORDER BY 1"},
                                                query_id=created["id"])
        self.assertTrue(updated["sql"].endswith("ORDER BY 1"))
        # Quem só tem acesso à Produção consulta e copia, mas não altera.
        listing = service_orders.list_sql_queries(self.user["id"])
        self.assertEqual([item["name"] for item in listing["queries"]], ["O.S. abertas 2026"])
        self.assertFalse(listing["can_configure"])
        with self.assertRaises(PermissionError):
            service_orders.delete_sql_query(self.user["id"], created["id"])
        service_orders.delete_sql_query(self.admin["id"], created["id"])
        self.assertEqual(service_orders.list_sql_queries(self.admin["id"])["queries"], [])

    def test_audit_payload_summary_and_permission_details(self):
        service_orders.import_service_orders(self.admin["id"], "PPT", [
            {"number": "1", "sector": "4", "operation": "338", "columns": ["A"], "rows": [{"A": "x"}]},
        ])
        self._launch("4")
        order = production.list_my_items(self.user["id"], "PPT", "2026-11-10")["items"][0]["service_order"]["orders"][0]
        # O lançamento leva só o resumo; as linhas do arquivo vêm na consulta de O.S.
        self.assertNotIn("rows", order)
        self.assertEqual(service_orders.list_service_orders(self.user["id"], "PPT")["orders"][0]["rows"], [{"A": "x"}])
        self.assertNotIn("rows", service_orders.list_service_orders(self.user["id"], "PPT", summary=True)["orders"][0])
        # Operação inativa só aparece para quem configura.
        created = service_orders.save_operation(self.admin["id"], {"code": "999", "name": "X", "is_active": False})
        self.assertNotIn("999", [o["code"] for o in service_orders.list_operations(self.user["id"], include_inactive=True)["operations"]])
        self.assertIn("999", [o["code"] for o in service_orders.list_operations(self.admin["id"], include_inactive=True)["operations"]])
        service_orders.delete_operation(self.admin["id"], created["id"])
        with self.assertRaisesRegex(ValueError, "0 e 9999"):
            service_orders.save_sql_query(self.admin["id"], {"name": "Q", "sql": "SELECT 1", "position": 10 ** 30})

    def test_codes_are_compared_without_leading_zeros(self):
        self.assertEqual(service_orders.sector_key("0663"), service_orders.sector_key("663.0"))
        self.assertEqual(service_orders.operation_key("0338 — TRATOS PLANTIO"), "338")
        self.assertEqual(service_orders.operation_key(""), "")


if __name__ == "__main__":
    unittest.main()
