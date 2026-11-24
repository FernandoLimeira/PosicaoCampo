"""ATR estimado — UPN1 / análises próximas. Dados em memória; valores esperados calculados à mão."""
import random
import unittest
from datetime import datetime
from decimal import Decimal

from backend.services import atr_estimation as atr
from backend.services.operational_shifts import FIELD_TIMEZONE

T = int(datetime(2026, 11, 20, 10, 0, tzinfo=FIELD_TIMEZONE).timestamp())
DAY = "2026-11-20"


def row(release, *, front="05", upn1="U1", moment=T, kg=20000, value=None, unit="PPT", day=DAY):
    return {"unit_code": unit, "release_no": str(release), "front": front, "upn1": upn1,
            "movement_date": day, "scale_out_at": moment, "net_kg": kg, "atr": value}


def run(rows, **kwargs):
    return {result.load.release_no: result for result in atr.estimate_atr(atr.build_loads(rows), **kwargs)}


class ValidationTests(unittest.TestCase):
    def test_null_or_invalid_atr_is_not_an_analysis_and_never_zero(self):
        for value in (None, "", "abc", 0, -5, 1000, float("nan"), float("inf"), True):
            self.assertIsNone(atr.valid_atr(value), value)
        self.assertEqual(atr.valid_atr("127,91"), Decimal("127.91"))
        results = run([row(1, value=None), row(2, value="abc", upn1="")])
        self.assertEqual(results["1"].origin, atr.ORIGIN_NONE)
        self.assertIsNone(results["1"].final_atr)
        self.assertIsNone(results["2"].original_atr)

    def test_zero_weight_counts_the_load_but_not_the_average(self):
        self.assertIsNone(atr.valid_weight(0))
        self.assertIsNone(atr.valid_weight(-10))
        results = list(run([row(1, kg=0, value=200), row(2, kg=30000, value=120)]).values())
        average = atr.weighted_atr(results)
        self.assertEqual((average.loads, average.loads_with_atr), (2, 1))
        self.assertEqual(average.atr, Decimal(120))


class AssignmentTests(unittest.TestCase):
    def test_analyzed_load_keeps_original_atr(self):
        result = run([row(1, value="130.5")])["1"]
        self.assertEqual((result.original_atr, result.estimated_atr, result.final_atr),
                         (Decimal("130.5"), None, Decimal("130.5")))
        self.assertEqual(result.origin, atr.ORIGIN_ANALYZED)

    def test_two_nearest_analyses_weighted_by_inverse_time_distance(self):
        # D1 = 1200 s (ATR 120), D2 = 2400 s (ATR 132): P1 = 2·P2 → (120·2 + 132) ÷ 3 = 124.
        # A análise de 200 (a 6000 s) é a terceira mais próxima e fica de fora.
        results = run([row("A1", moment=T, value=120), row("A2", moment=T + 3600, value=132),
                       row("A3", moment=T + 7200, value=200), row("L", moment=T + 1200)])
        result = results["L"]
        self.assertEqual(result.final_atr, Decimal(124))
        self.assertIsNone(result.original_atr)
        self.assertEqual((result.origin, result.method), (atr.ORIGIN_UPN1, atr.METHOD_TWO_NEAREST))
        self.assertEqual(result.analyses, ("A1", "A2"))

    def test_single_analysis_is_assigned(self):
        result = run([row("A", moment=T, value="125.5"), row("L", moment=T + 999)])["L"]
        self.assertEqual((result.final_atr, result.method), (Decimal("125.5"), atr.METHOD_SINGLE))

    def test_no_upn1_analysis_falls_back_to_front_weighted_mean(self):
        # Frente 05 em outras UPN1: (120·30 t + 140·10 t) ÷ 40 t = 125.
        results = run([row("A", upn1="U2", kg=30000, value=120), row("B", upn1="U3", kg=10000, value=140),
                       row("L", upn1="U9")])
        self.assertEqual(results["L"].final_atr, Decimal(125))
        self.assertEqual((results["L"].origin, results["L"].analyses), (atr.ORIGIN_FRONT, ("A", "B")))

    def test_no_analysis_in_upn1_or_front_is_unavailable(self):
        result = run([row("A", front="07", upn1="U2", value=120), row("L", front="05", upn1="U9")])["L"]
        self.assertEqual((result.origin, result.final_atr, result.estimated_atr), (atr.ORIGIN_NONE, None, None))

    def test_several_upn1_groups_stay_separate(self):
        # A análise da U1 está mais perto no tempo, mas a carga é da U2.
        results = run([row("A", upn1="U1", moment=T + 10, value=120), row("B", upn1="U2", moment=T + 5000, value=150),
                       row("L", upn1="U2", moment=T)])
        self.assertEqual(results["L"].final_atr, Decimal(150))

    def test_upn1_serving_two_fronts_and_front_consolidation(self):
        results = run([row("A", front="05", upn1="U1", moment=T, kg=30000, value=120),
                       row("L", front="07", upn1="U1", moment=T + 60, kg=10000)])
        self.assertEqual((results["L"].origin, results["L"].final_atr), (atr.ORIGIN_UPN1, Decimal(120)))
        fronts = atr.atr_by_front(results.values())
        self.assertEqual((fronts["05"].atr, fronts["07"].atr), (Decimal(120), Decimal(120)))

    def test_same_time_analyses_are_chosen_deterministically(self):
        # Três análises no mesmo horário (100 s da carga): ficam as liberações 1 e 2 → (130 + 120) ÷ 2.
        rows = [row("3", moment=T, value=140), row("2", moment=T, value=120), row("1", moment=T, value=130),
                row("L", moment=T + 100)]
        for order in (rows, list(reversed(rows))):
            result = run(order)["L"]
            self.assertEqual((result.final_atr, result.analyses), (Decimal(125), ("1", "2")))

    def test_analysis_at_the_same_second_uses_minimum_distance_of_one(self):
        self.assertEqual(atr.inverse_distance_weight(0), Decimal(1))
        result = run([row("A", moment=T, value=120), row("B", moment=T + 1, value=130), row("L", moment=T)])["L"]
        self.assertEqual(result.final_atr, Decimal(125))  # P = 1 e 1

    def test_load_without_time_uses_upn1_weighted_mean(self):
        # (120·20 t + 130·30 t) ÷ 50 t = 126, sem inventar horário.
        result = run([row("A", kg=20000, value=120), row("B", moment=T + 50, kg=30000, value=130),
                      row("L", moment=None)])["L"]
        self.assertEqual((result.final_atr, result.method), (Decimal(126), atr.METHOD_UPN1_MEAN))
        self.assertEqual(result.origin, atr.ORIGIN_UPN1)

    def test_operational_day_turnover_separates_analyses(self):
        def day_of(item):
            return datetime.fromtimestamp(item["scale_out_at"], FIELD_TIMEZONE).date().isoformat()

        midnight = int(datetime(2026, 11, 21, 0, 0, tzinfo=FIELD_TIMEZONE).timestamp())
        rows = [row("OLD", moment=midnight - 600, value=150),  # 23:50 do dia anterior
                row("NEW", moment=midnight + 6 * 3600, value=120), row("L", moment=midnight + 600)]
        loads = atr.build_loads(rows, period=day_of)
        result = {item.load.release_no: item for item in atr.estimate_atr(loads)}["L"]
        self.assertEqual((result.final_atr, result.analyses), (Decimal(120), ("NEW",)))

    def test_units_are_not_mixed(self):
        result = run([row("A", unit="NRD", value=150), row("L", unit="PPT")])["L"]
        self.assertEqual(result.origin, atr.ORIGIN_NONE)

    def test_temporal_weight_is_configurable(self):
        equal = run([row("A1", moment=T, value=120), row("A2", moment=T + 3600, value=132),
                     row("L", moment=T + 1200)], weight=lambda _distance: Decimal(1))
        self.assertEqual(equal["L"].final_atr, Decimal(126))

    def test_duplicated_release_counts_once(self):
        results = atr.estimate_atr(atr.build_loads([row(1, value=120), row(1, value=130)]))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].final_atr, Decimal(130))


class AverageTests(unittest.TestCase):
    def rows(self):
        return [row("1", front="05", kg=30000, value=120), row("2", front="05", kg=10000, value=140),
                row("3", front="07", upn1="U7", kg=10000, value=100), row("4", front="07", upn1="", kg=5000)]

    def test_front_average_is_weighted_by_tonnage(self):
        fronts = atr.atr_by_front(run(self.rows()).values())
        # (120·30 + 140·10) ÷ 40 = 125 (a média simples seria 130).
        self.assertEqual(fronts["05"].atr, Decimal(125))
        # Carga 4 sem UPN1 → média da frente 07 = 100.
        self.assertEqual(fronts["07"].atr, Decimal(100))
        self.assertEqual(fronts["07"].weight_kg, Decimal(15000))

    def test_overall_atr_comes_from_loads_not_front_means(self):
        # (120·30 + 140·10 + 100·10 + 100·5) ÷ 55 = 6500 ÷ 55 = 118,1818…
        overall = atr.overall_atr(run(self.rows()).values())
        self.assertEqual(overall.atr, Decimal(6500) / Decimal(55))
        self.assertEqual(atr.round_atr(overall.atr), 118.18)
        self.assertNotEqual(atr.round_atr(overall.atr), 112.5)  # média simples das frentes

    def test_rounding_only_on_presentation(self):
        # (120·2 + 121) ÷ 3 = 120,333…: o valor interno não é arredondado.
        result = run([row("A1", moment=T, value=120), row("A2", moment=T + 3600, value=121),
                      row("L", moment=T + 1200)])["L"]
        self.assertLess(abs(result.final_atr - Decimal(361) / Decimal(3)), Decimal("1e-20"))
        self.assertNotEqual(result.final_atr, Decimal("120.33"))
        self.assertEqual(atr.round_atr(result.final_atr), 120.33)
        self.assertEqual(atr.round_atr(Decimal("124.345")), 124.35)
        self.assertEqual(atr.round_atr(Decimal("124.3449")), 124.34)
        self.assertIsNone(atr.round_atr(None))

    def test_repeated_runs_give_the_same_result(self):
        rows = self.rows() + [row("L1", moment=T + 30), row("L2", moment=None), row("L3", upn1="U5")]
        first = {item.load.release_no: (item.final_atr, item.origin, item.analyses) for item in run(rows).values()}
        for seed in range(5):
            shuffled = rows[:]
            random.Random(seed).shuffle(shuffled)
            again = {item.load.release_no: (item.final_atr, item.origin, item.analyses) for item in run(shuffled).values()}
            self.assertEqual(again, first)
        self.assertEqual(atr.origin_counts(run(rows).values()),
                         {atr.ORIGIN_ANALYZED: 3, atr.ORIGIN_UPN1: 2, atr.ORIGIN_FRONT: 2, atr.ORIGIN_NONE: 0})


if __name__ == "__main__":
    unittest.main()
