"""Regressões da integração dos apontamentos com a análise e o PowerPoint."""
from datetime import date, datetime, timedelta
from io import BytesIO
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
from zipfile import ZipFile

from backend.services.return_analysis import analyze_return_rows
from backend.services.return_presentation import generate_return_presentation, NS
from backend.services.soil_wet_import import parse_soil_wet_file, _parse_time


SOIL_HEADERS = ("Grupo de equipamento", "Código Equipamento", "Data Hora Local",
                "Hora Inicial", "Hora Final", "Descrição da Operação", "Código da Zona")


def xlsx(rows):
    output = BytesIO()
    xml_rows = []
    for index, row in enumerate(rows, 1):
        cells = []
        for col, value in enumerate(row):
            ref = chr(65 + col) + str(index)
            if isinstance(value, (int, float)):
                cells.append(f'<c r="{ref}"><v>{value}</v></c>')
            else:
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>')
        xml_rows.append(f'<row r="{index}">' + ''.join(cells) + '</row>')
    with ZipFile(output, "w") as archive:
        archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dados" sheetId="1" r:id="rId1"/></sheets></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + ''.join(xml_rows) + '</sheetData></worksheet>')
    return output.getvalue()


def soil_row(day=2, equipment=1001, sector=71, unit="PPT", start="08:00", end="10:00", operation="SOLO ÚMIDO"):
    return (f"{unit} FRENTE 02", equipment, f"2026-10-{day:02d}", start, end, operation, sector)


class SoilWetImportTests(unittest.TestCase):
    def test_xls_date_cells_preserve_midnight_and_time_types(self):
        serial = (date(2026, 10, 2) - date(1899, 12, 30)).days
        values = [SOIL_HEADERS, ("PPT", 1001, serial, 0, 0.5, "SOLO UMIDO", 71)]
        sheet = SimpleNamespace(nrows=2, ncols=7,
            cell=lambda row, col: SimpleNamespace(value=values[row][col],
                ctype=3 if row == 1 and col in (2, 3, 4) else 2 if row == 1 and col in (1, 6) else 1))
        workbook = SimpleNamespace(nsheets=1, datemode=0, sheet_by_index=lambda _: sheet, release_resources=lambda: None)
        xlrd = SimpleNamespace(XL_CELL_DATE=3, XL_CELL_NUMBER=2,
            open_workbook=lambda **_: workbook,
            xldate_as_datetime=lambda number, mode: datetime(1899, 12, 30) + timedelta(days=number))
        with patch.dict("sys.modules", {"xlrd": xlrd}):
            parsed = parse_soil_wet_file(b"xls fixture", "soil.xls")
        self.assertEqual(parsed["records"][0]["date"], "2026-10-02")
        self.assertEqual(parsed["records"][0]["start_time"], "00:00:00")
        self.assertEqual(parsed["records"][0]["duration_seconds"], 43200)

    def test_actual_xlsx_filters_duplicates_and_invalid_rows(self):
        parsed = parse_soil_wet_file(xlsx([
            ("Relatório de apontamentos",), SOIL_HEADERS,
            soil_row(), soil_row(), soil_row(operation="COLHEITA"),
            soil_row(equipment="inválido"), soil_row(equipment=1001.5),
            soil_row(start="09:00", end="09:00"),
            soil_row(day=3, start="23:00", end="01:00"),
        ]), "apontamentos.xlsx")
        self.assertEqual(parsed["detected_unit"], "PPT")
        self.assertEqual(parsed["ignored_non_soil_wet"], 1)
        self.assertEqual(parsed["invalid_rows"], 3)
        self.assertEqual(len(parsed["records"]), 2)
        self.assertEqual([r["duration_seconds"] for r in parsed["records"]], [7200, 7200])
        self.assertEqual(len(parsed["records"][0]["record_key"]), 64)

    def test_excel_serial_date_and_numeric_times_without_styles(self):
        serial = (date(2026, 10, 2) - date(1899, 12, 30)).days
        parsed = parse_soil_wet_file(xlsx([SOIL_HEADERS, ("PPT", 1001, serial, 0, 0.5, "SOLO UMIDO", 71)]), "numeric.xlsx")
        record = parsed["records"][0]
        self.assertEqual(record["date"], "2026-10-02")
        self.assertEqual(record["duration_seconds"], 43200)
        self.assertEqual(_parse_time("0,5").hour, 12)
        for invalid in ("NaN", "-1", "1", "25:00"):
            self.assertIsNone(_parse_time(invalid))

    def test_mixed_units_and_invalid_uploads_rejected(self):
        with self.assertRaisesRegex(ValueError, "mais de uma unidade"):
            parse_soil_wet_file(xlsx([SOIL_HEADERS, soil_row(), soil_row(unit="PST", equipment=1002)]), "mixed.xlsx")
        for content, name in ((b"", "empty.xlsx"), (b"invalid", "bad.xlsx"), (b"invalid", "bad.csv"),
                              (xlsx([SOIL_HEADERS, soil_row(operation="COLHEITA")]), "harvest.xlsx")):
            with self.subTest(name=name), self.assertRaises(ValueError):
                parse_soil_wet_file(content, name)


class ReturnAnalysisIntegrationTests(unittest.TestCase):
    layouts = [{"code": "02", "name": "Frente 02", "equipment": [1001, 1002, 1003]},
               {"code": "03", "name": "Frente 03", "equipment": [2001]}]

    def analyze(self, activities, **kwargs):
        rows = [{"date": date(2026, 10, day), "sector": sector, "equipment": fleet}
                for day, sector, fleet in activities]
        return analyze_return_rows(rows, self.layouts, "02", unit_code="PPT", unit_name="Paraguaçu Paulista", **kwargs)

    def evidence(self):
        return parse_soil_wet_file(xlsx([SOIL_HEADERS] + [soil_row(day=day, equipment=fleet)
                                  for day in (2, 3) for fleet in (1001, 1002)]), "solo.xlsx")["records"]

    def test_daily_assignment_detects_return_even_with_continuous_sector_work(self):
        report = self.analyze([(1, 101, 1001), (2, 101, 2001), (2, 202, 1001), (3, 101, 1001)])
        self.assertEqual(report["returns_count"], 1)
        item = report["returns"][0]
        self.assertEqual(item["sectors_during_absence"], [202])
        self.assertEqual(item["other_fronts_in_sector"][0]["code"], "03")
        self.assertEqual(report["returns_with_other_front_in_sector_count"], 1)

    def test_tie_is_not_assigned_to_another_front(self):
        report = self.analyze([(1, 101, 1001), (2, 101, 1001), (2, 101, 2001),
                               (2, 202, 1001), (3, 101, 1001)])
        item = report["returns"][0]
        self.assertEqual(item["other_fronts_in_sector"], [])
        self.assertEqual(len(item["ties_in_sector"]), 1)

    def test_confirmation_requires_majority_each_day_and_uses_layout_not_source_group(self):
        activity = [(1, 101, 1001), (4, 101, 1001)]
        records = self.evidence()
        report = self.analyze(activity, soil_wet_records=records)
        self.assertEqual(report["possible_soil_wet_count"], 0)
        self.assertEqual(report["confirmed_soil_wet_count"], 1)
        evidence = report["confirmed_soil_wet"][0]["soil_wet_evidence"]
        self.assertEqual(evidence["majority_required"], 2)
        self.assertEqual(evidence["days_with_majority"], 2)
        self.assertEqual(evidence["dominant_sector"], 71)
        for insufficient in (records[:2], [r for r in records if r["equipment"] == 1001],
                             [{**r, "equipment": 2001} for r in records],
                             [{**r, "duration_seconds": 0} for r in records]):
            with self.subTest(records=insufficient):
                pending = self.analyze(activity, soil_wet_records=insufficient)
                self.assertEqual(pending["confirmed_soil_wet_count"], 0)
                self.assertEqual(pending["possible_soil_wet_count"], 1)

    def test_soil_wet_does_not_hide_a_real_area_change(self):
        report = self.analyze([(1, 101, 1001), (2, 202, 1001), (4, 101, 1001)], soil_wet_records=self.evidence())
        self.assertEqual(report["returns_count"], 1)
        self.assertEqual(report["confirmed_soil_wet_count"], 0)

    def test_sector_farm_ambiguity_is_not_guessed(self):
        activity = [(1, 101, 1001), (4, 101, 1001)]
        base = [{"sector": "101", "section": "10", "description": "Fazenda A"},
                {"sector": "101", "section": "20", "description": "Fazenda B"}]
        reference = self.analyze(activity, sector_base=base)["possible_soil_wet"][0]["sector_reference"]
        self.assertEqual(reference["status"], "ambiguous")
        self.assertEqual(reference["farm"], "")
        base[1]["description"] = "Fazenda A"
        reference = self.analyze(activity, sector_base=base)["possible_soil_wet"][0]["sector_reference"]
        self.assertEqual(reference["status"], "multiple_sections")
        self.assertEqual(reference["farm"], "Fazenda A")
        self.assertEqual(reference["section"], "")
        reference = self.analyze(activity, sector_base=base[:1])["possible_soil_wet"][0]["sector_reference"]
        self.assertEqual(reference["status"], "matched")

    def test_compact_presentation_preserves_confirmed_soil_wet_evidence_in_notes(self):
        report = self.analyze([(1, 101, 1001), (4, 101, 1001)], soil_wet_records=self.evidence(),
                              sector_base=[{"sector": "101", "section": "10", "description": "Fazenda A"}])
        content, _ = generate_return_presentation(report)
        with ZipFile(BytesIO(content)) as archive:
            text = "\n".join(t.text or "" for name in archive.namelist()
                             if name.startswith("ppt/slides/slide") and name.endswith(".xml")
                             for t in ET.fromstring(archive.read(name)).findall(".//a:t", NS))
            notes = "\n".join(t.text or "" for name in archive.namelist()
                              if name.startswith("ppt/notesSlides/notesSlide") and name.endswith(".xml")
                              for t in ET.fromstring(archive.read(name)).findall(".//a:t", NS))
        self.assertIn("1 solo úmido confirmado", text)
        self.assertIn("0 interrupções pendentes", text)
        for expected in ('"majority_required": 2', '"fleet_size": 3', '"days_with_majority": 2',
                         '"dominant_sector": 71', '"farm": "Fazenda A"', '"section": "10"', '1001', '1002'):
            self.assertIn(expected, notes)
        self.assertNotIn("Causa pendente", text)


if __name__ == "__main__":
    unittest.main()
