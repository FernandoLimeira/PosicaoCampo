import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from xml.sax.saxutils import escape
from zipfile import ZipFile

from backend import config
from backend.models import database as db
from backend.models import module_access
from backend.models import weighings
from backend.models.units import initialize_units
from backend.services.weighing_import import parse_weighing_file

HEADER = ["INSTANCIA_ORIGEM", "DT_MOVIMENTO", "NO_LIBERACAO", "CAMINHAO", "JULIETA", "CD_UPNIVEL1",
          "CD_UPNIVEL2", "CD_FREN_TRAN", "QT_LIQUIDO", "ATR", "HR_ENTRADA_PATIO", "HR_ENTRADA_BALANCA",
          "HR_SAIDA_BALANCA", "CD_USUARIO_ENTR"]


def xlsx(rows):
    data = io.BytesIO()
    xml_rows = "".join('<row r="%d">%s</row>' % (number, "".join(
        f'<c r="{chr(65 + index)}{number}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'
        for index, value in enumerate(values))) for number, values in enumerate(rows, 1))
    with ZipFile(data, "w") as archive:
        archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Pesagem" sheetId="1" r:id="rId1"/></sheets></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + xml_rows + '</sheetData></worksheet>')
    return data.getvalue()


def load(instance, release, front, level1, level2, kg, out, atr="", patio="14/11/2026 08:00:00"):
    return [instance, "14/11/2026" if out else "", release, "4100586", "4401225", level1, level2, front,
            kg, atr, patio, patio, out, "****"]


class WeighingTests(unittest.TestCase):
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
        fronts = {"PPT": ["02", "05"], "NRD": ["19", "20"], "RBR": ["402", "411"], "PST": ["401", "404"]}
        initialize_units([{"code": code, "rows": [[front, "", "", "EM ATIVIDADE", ""] for front in fronts[code]]}
                          for code in ("PPT", "NRD", "RBR", "PST")], self.admin["id"])

    def file(self):
        return xlsx([HEADER,
            # PPT: frente própria 05 (setor no nível 2) e frente 19 da NRD (recebida).
            load("201", "1", "5", "361", "1173", "36000", "14/11/2026 13:00:00", atr="120"),
            load("201", "2", "5", "361", "1173", "34000", "14/11/2026 15:00:00", atr="130"),
            load("201", "3", "19", "300", "3432", "30000", "14/11/2026 15:30:00", atr="127,91"),
            load("201", "4", "5", "361", "1173", "", ""),  # no pátio
            # PST: setor no nível 1 e seção no nível 2; frente 402 é da RBR.
            load("401", "5", "404", "90428", "1", "32000", "14/11/2026 15:20:00"),
            load("401", "6", "402", "67742", "2", "31000", "14/11/2026 15:35:00"),
            load("999", "7", "1", "1", "1", "1000", "14/11/2026 15:00:00"),  # indústria desconhecida
        ])

    def test_parse_maps_instances_sector_and_section(self):
        parsed = parse_weighing_file(self.file(), "Pasta1.xlsx")
        records = {record["release_no"]: record for record in parsed["records"]}
        self.assertEqual(parsed["ignored_units"], 1)
        self.assertEqual(records["1"]["unit_code"], "PPT")
        self.assertEqual((records["1"]["sector"], records["1"]["section"]), ("1173", ""))
        self.assertEqual(records["5"]["unit_code"], "PST")
        self.assertEqual((records["5"]["sector"], records["5"]["section"]), ("90428", "1"))
        self.assertEqual(records["3"]["atr"], 127.91)
        self.assertIsNone(records["4"]["scale_out_at"])
        self.assertIsNone(records["4"]["net_kg"])
        self.assertEqual(records["1"]["movement_date"], "2026-11-14")

    def test_parse_rejects_missing_columns(self):
        with self.assertRaisesRegex(ValueError, "HR_SAIDA_BALANCA"):
            parse_weighing_file(xlsx([["INSTANCIA_ORIGEM", "NO_LIBERACAO", "CD_FREN_TRAN", "QT_LIQUIDO"]]), "a.xlsx")
        with self.assertRaisesRegex(ValueError, "Excel"):
            parse_weighing_file(b"abc", "a.csv")

    def test_import_upserts_by_release(self):
        records = parse_weighing_file(self.file(), "a.xlsx")["records"]
        first = weighings.import_weighings(self.admin["id"], records, filename="a.xlsx")
        self.assertEqual((first["created"], first["updated"], first["pending"]), (6, 0, 1))
        # A carga que estava no pátio foi pesada no arquivo seguinte: atualiza, não duplica.
        pending = next(record for record in records if record["release_no"] == "4")
        pending.update(scale_out_at=pending["patio_at"] + 7 * 3600, net_kg=35000.0, movement_date="2026-11-14")
        second = weighings.import_weighings(self.admin["id"], [pending], filename="b.xlsx")
        self.assertEqual((second["created"], second["updated"], second["pending"]), (0, 1, 0))

    def test_summary_rates_stock_and_external_fronts(self):
        weighings.import_weighings(self.admin["id"], parse_weighing_file(self.file(), "a.xlsx")["records"])
        summary = weighings.weighing_summary("2026-11-14")
        units = {unit["code"]: unit for unit in summary["units"]}
        ppt, pst = units["PPT"], units["PST"]
        # Referência: última carga pesada (15:35) -> turno B desde 07:20.
        self.assertEqual(summary["shift"]["code"], "B")
        self.assertEqual(ppt["milling_day_t"], 100.0)
        self.assertEqual(ppt["loads_day"], 3)
        self.assertEqual(ppt["stock_loads"], 1)
        # Moagem pela saída da balança. Últimas 3 h (12:35-15:35): 36 + 34 + 30 t / 3 h.
        self.assertEqual(ppt["milling_last3h_tph"], 33.3)
        # Turno B: 100 t em 8h15 (07:20-15:35).
        self.assertEqual(ppt["milling_shift_tph"], round(100 / 8.25, 1))
        # Entrega pela entrada no pátio (08:00): entrou no turno B, mas não nas últimas 3 h.
        self.assertEqual(ppt["delivery_shift_tph"], round(100 / 8.25, 1))
        self.assertEqual(ppt["delivery_last3h_tph"], 0)
        # ATR ponderado pelo peso.
        self.assertEqual(ppt["atr"], round((120 * 36 + 130 * 34 + 127.91 * 30) / 100, 2))
        fronts = {front["front"]: front for front in ppt["fronts"]}
        self.assertEqual(fronts["5"]["sector"], "1173")
        self.assertFalse(fronts["5"]["external"])
        self.assertTrue(fronts["19"]["external"])
        self.assertEqual(fronts["19"]["home_unit"], "NRD")
        self.assertEqual([front["front"] for front in ppt["received"]], ["19"])
        self.assertEqual([front["front"] for front in pst["received"]], ["402"])
        self.assertEqual(units["RBR"]["milling_day_t"], 0)
        support = {(item["front"], item["from_unit"], item["to_unit"]) for item in summary["support"]}
        self.assertEqual(support, {("19", "NRD", "PPT"), ("402", "RBR", "PST")})
        self.assertEqual(summary["last_import"]["imported_by_name"], "Admin")

    def test_summary_without_data(self):
        summary = weighings.weighing_summary("2026-11-13")
        self.assertIsNone(summary["reference_at"])
        self.assertTrue(all(unit["milling_day_t"] == 0 and unit["milling_shift_tph"] is None
                            for unit in summary["units"]))
        with self.assertRaisesRegex(ValueError, "Data"):
            weighings.weighing_summary("14/11/2026")

    def test_permissions(self):
        self.assertEqual(module_access.required_permission("/api/weighings/import", "POST"), (("dashboard",), "edit"))
        self.assertEqual(module_access.required_permission("/api/weighings/summary", "GET"),
                         (("dashboard", "emission"), "view"))


if __name__ == "__main__":
    unittest.main()
