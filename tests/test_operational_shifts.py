import unittest
from datetime import datetime

from backend.services.operational_shifts import shift_at, shift_period


class OperationalShiftTests(unittest.TestCase):
    def test_boundaries_use_brasilia_and_do_not_overlap(self):
        for utc, expected_date, expected_shift in (
            ('2026-10-22T02:59:59+00:00', '2026-10-21', 'C'),
            ('2026-10-22T03:00:00+00:00', '2026-10-22', 'A'),
            ('2026-10-22T10:19:59+00:00', '2026-10-22', 'A'),
            ('2026-10-22T10:20:00+00:00', '2026-10-22', 'B'),
            ('2026-10-22T18:39:59+00:00', '2026-10-22', 'B'),
            ('2026-10-22T18:40:00+00:00', '2026-10-22', 'C'),
            ('2026-10-23T02:59:59+00:00', '2026-10-22', 'C'),
            ('2026-10-23T03:00:00+00:00', '2026-10-23', 'A'),
        ):
            with self.subTest(utc=utc):
                timestamp = int(datetime.fromisoformat(utc).timestamp())
                period = shift_at(timestamp)
                self.assertEqual((period['work_date'], period['shift']), (expected_date, expected_shift))
                self.assertLessEqual(period['start_at'], timestamp)
                self.assertGreater(period['end_at'], timestamp)
        periods = [shift_period('2026-10-22', shift) for shift in 'ABC']
        self.assertEqual(periods[0][1], periods[1][0])
        self.assertEqual(periods[1][1], periods[2][0])
        self.assertEqual(periods[2][1], shift_period('2026-10-23', 'A')[0])

    def test_invalid_period_is_rejected(self):
        for day, shift in (('2026-02-30', 'A'), ('22/10/2026', 'A'), ('2026-10-22', 'D'), (None, None)):
            with self.subTest(day=day, shift=shift), self.assertRaises(ValueError):
                shift_period(day, shift)


if __name__ == '__main__':
    unittest.main()
