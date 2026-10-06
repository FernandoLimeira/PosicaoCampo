import unittest

from backend.services.excel_reports import analyze_excel_report


class ReportUnitTests(unittest.TestCase):
    def report(self, rows):
        header = 'Unidade;Frente;Codigo equipamento;Nome;Data;Hora inicial;Hora final;Operacao;Grupo da operacao\n'
        return analyze_excel_report((header + '\n'.join(row + ';Produtiva' for row in rows)).encode('utf-8'), 'unidades.csv')

    def test_same_operator_front_equipment_and_day_do_not_merge_units(self):
        report = self.report([
            'PPT;01;123;Operador;05/10/2026;08:00;09:00;Colheita',
            'NRD;01;123;Operador;05/10/2026;10:00;12:00;Colheita',
        ])
        rows = report['performance_rows']
        self.assertEqual(len(rows), 2)
        self.assertEqual({row['unit']: row['total'] for row in rows}, {'PPT': 3600, 'NRD': 7200})

    def test_team_membership_uses_days_in_same_unit_not_other_units(self):
        report = self.report([
            'PPT;01;123;Operador;05/10/2026;08:00;09:00;Colheita',
            'NRD;01;123;Operador;06/10/2026;08:00;09:00;Colheita',
            'PPT;01;123;Operador;07/10/2026;08:00;09:00;Colheita',
        ])
        for row in report['performance_rows'] + report['timeline']:
            self.assertEqual(row['team_member'], row['unit'] == 'PPT')
