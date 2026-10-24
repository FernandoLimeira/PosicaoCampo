import unittest
from backend.services.front_identifiers import front_key, standardize_rain_labels


class FrontIdentifierTests(unittest.TestCase):
    def test_old_spellings_share_one_key_and_standard_label(self):
        for spelling in ('F-06', 'FT06', 'FT 06', 'Eq. 6', 'Frente 006', '06'):
            self.assertEqual(front_key(spelling), '6')
            self.assertEqual(standardize_rain_labels('PPT', [['06']], [[spelling, 1, 11]]), [['FT 06', 1, 11]])
        self.assertEqual(standardize_rain_labels('PPT', [], [['FT6A', 1, 11]]), [['FT 06A', 1, 11]])
        self.assertNotEqual(front_key('13A'), front_key('13B'))
        self.assertNotEqual(front_key('1.3'), front_key('13'))

    def test_nrd_legacy_teams_are_mapped_once_without_changing_values(self):
        fronts = [['08'], ['13'], ['15'], ['16'], ['18']]
        rain = [['EQ - 3', 2, 31], ['EQ - 5', 0, 60], ['EQ - 6', 0, 29], ['EQ - 8', 0, 37], ['FT - 8', 2, 44]]
        normalized = standardize_rain_labels('NRD', fronts, rain)
        self.assertEqual([row[0] for row in normalized], ['FT 13', 'FT 15', 'FT 16', 'FT 18', 'FT 08'])
        self.assertEqual([row[1:] for row in normalized], [row[1:] for row in rain])
        self.assertEqual(standardize_rain_labels('NRD', fronts, normalized), normalized)
        self.assertEqual(rain[0][0], 'EQ - 3')

    def test_other_units_never_shift_team_numbers(self):
        for code in ('PPT', 'RBR', 'PST'):
            self.assertEqual(standardize_rain_labels(code, [['13']], [['EQ - 3', 2, 31]]), [['FT 03', 2, 31]])
