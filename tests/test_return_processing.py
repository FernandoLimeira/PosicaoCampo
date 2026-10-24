"""Regressions for indexed analysis and strict operational identifiers."""
from datetime import date, timedelta
from io import BytesIO
import random
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from backend.services.return_analysis import (
    _ActivityIndex, _DatedRecords, _normalize_number,
    _soil_wet_evidence, analyze_return_rows, parse_operational_file,
)


class ReturnProcessingTests(unittest.TestCase):
    def test_range_index_matches_daily_reference(self):
        rng = random.Random(42)
        start = date(2026, 1, 1)
        assignments = {(sector, start + timedelta(days=day)): {"assigned_front_code": "02" if rng.random() < .6 else "05"}
                       for day in range(45) for sector in range(1, 8) if rng.random() < .5}
        index = _ActivityIndex(assignments, "02")
        for _ in range(120):
            first, last = sorted([rng.randrange(-5, 50), rng.randrange(-5, 50)])
            begin, end = start + timedelta(days=first), start + timedelta(days=last)
            excluded = rng.randrange(1, 8)
            expected = sorted({sector for (sector, day), item in assignments.items()
                               if begin <= day <= end and sector != excluded and item["assigned_front_code"] == "02"})
            self.assertEqual(index.sectors_between(begin, end, excluded), expected)
        self.assertEqual(_ActivityIndex({}, "02").sectors_between(start, start, 1), [])

    def test_soil_wet_index_preserves_complete_evidence(self):
        records = [{"equipment": fleet, "date": f"2026-10-{day:02}", "duration_seconds": 3600,
                    "sector": 101, "farm": "Fazenda", "field": 10}
                   for day in range(1, 8) for fleet in (1001, 1002, 5001)]
        begin, end = date(2026, 10, 2), date(2026, 10, 5)
        expected = _soil_wet_evidence(records, 101, begin, end, [1001, 1002])
        index = _DatedRecords(records, {1001, 1002})
        self.assertEqual(_soil_wet_evidence(records, 101, begin, end, [1001, 1002], index), expected)
        self.assertEqual(len(list(index.between(begin, end))), 8)

    def test_analysis_preserves_returns_and_only_queries_indexed_ranges(self):
        rows = [{"date": date(2026, 1, 1) + timedelta(days=i // 5),
                 "sector": i % 10 + 1, "equipment": 1001} for i in range(100)]
        with patch('backend.services.return_analysis._ActivityIndex.sectors_between',
                   autospec=True, side_effect=_ActivityIndex.sectors_between) as query:
            report = analyze_return_rows(rows, [{"code": "02", "name": "Frente 02", "equipment": [1001]}], "02")
        self.assertEqual(report["returns_count"], 90)
        self.assertEqual(query.call_count, 90)
        for item in report["returns"]:
            expected = sorted({row["sector"] for row in rows if row["sector"] != item["sector"]
                               and item["exit_date"] < row["date"].isoformat() < item["return_date"]})
            self.assertEqual(item["sectors_during_absence"], expected)

    def test_integer_codes_never_round_or_extract_digits(self):
        for value in (101.4, "101.4", "frota 1001 erro", "1e3", True, "NaN", "Infinity"):
            self.assertIsNone(_normalize_number(value, integer=True), value)
        for value in (101, 101.0, "101.0", "101,0", "00101"):
            self.assertEqual(_normalize_number(value, integer=True), 101)
        self.assertEqual(_normalize_number("1234567890123456789", integer=True), 1234567890123456789)
        self.assertIsNone(_normalize_number("frota 1001 erro"))

    def test_soil_wet_records_are_indexed_once_for_multiple_interruptions(self):
        rows = [{"date": date(2026, 10, day), "sector": 101, "equipment": 1001} for day in (1, 3, 5, 7)]
        records = [{"date": f"2026-10-{day:02}", "equipment": 1001, "duration_seconds": 3600}
                   for day in (2, 4, 6)]
        original = _DatedRecords.__init__
        with patch('backend.services.return_analysis._DatedRecords.__init__', autospec=True, side_effect=original) as build:
            report = analyze_return_rows(rows, [{"code": "02", "name": "Frente 02", "equipment": [1001]}],
                                         "02", soil_wet_records=records)
        self.assertEqual(build.call_count, 1)
        self.assertEqual(report['confirmed_soil_wet_count'], 3)

    def test_invalid_import_diagnostics_are_bounded_but_keep_total(self):
        rows = [["DIA", "SETOR", "COLHEDORA"]] + [["invalid", 1, 1001]] * 25
        with patch('backend.services.return_analysis._read_rows', return_value=rows):
            with self.assertRaises(ValueError) as error:
                parse_operational_file(b'synthetic', 'dados.xlsx')
        self.assertIn('25 linha(s)', str(error.exception))
        self.assertIn('Mais 5 linha(s)', str(error.exception))
        self.assertNotIn('Linha 22:', str(error.exception))

    def test_import_reports_all_bad_rows_and_rejects_partial_analysis(self):
        rows = [["Título"], ["DIA", "SETOR", "COLHEDORA", "TALHÃO"],
                ["2026-10-01", 101, 1001, 10], ["2026-10-02", 101.4, 1001.4, 10],
                ["data inválida", 101, 1001, 10], ["2026-10-03", -1, "frota 1001 erro", "talhão 2"]]
        with patch('backend.services.return_analysis._read_rows', return_value=rows):
            with self.assertRaises(ValueError) as error:
                parse_operational_file(b'synthetic', 'dados.xlsx')
        for expected in ('3 linha(s) inválida(s)', 'Linha 4', 'Linha 5', 'Linha 6', 'DIA', 'SETOR', 'COLHEDORA/FROTA', 'TALHÃO'):
            self.assertIn(expected, str(error.exception))

    def test_diagnostics_use_actual_xlsx_row_after_blank_rows(self):
        from tests.test_return_analysis_integration import xlsx
        original = xlsx([["DIA", "SETOR", "COLHEDORA"], ["2026-10-01", 101.4, 1001]])
        output = BytesIO()
        with ZipFile(BytesIO(original)) as source, ZipFile(output, 'w') as target:
            for name in source.namelist():
                content = source.read(name)
                if name == 'xl/worksheets/sheet1.xml':
                    content = content.replace(b'<row r="2">', b'<row r="9">')
                target.writestr(name, content)
        with self.assertRaisesRegex(ValueError, 'Linha 9:'):
            parse_operational_file(output.getvalue(), 'dados.xlsx')

    def test_integral_excel_codes_and_blank_optional_fields_remain_valid(self):
        rows = [["DIA", "SETOR", "COLHEDORA", "TALHÃO"], ["2026-10-01", "101.0", "1001,0", ""], []]
        with patch('backend.services.return_analysis._read_rows', return_value=rows):
            result = parse_operational_file(b'synthetic', 'dados.xlsx')
        self.assertEqual((result[0]["sector"], result[0]["equipment"], result[0]["field"]), (101, 1001, None))


if __name__ == '__main__':
    unittest.main()
