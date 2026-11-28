"""Dimensionamento da fertirrigação conferido com a planilha "Logística Fertirrigação - NRD-2026"
(aba PLANEJAMENTO NRD, frentes FT.54, FT.56, FT.57 e FT.59)."""
import unittest

from backend.services.fert_dimensioning import (
    application_speed, calculate, clean_params, ha_per_hour_from_speed, totals,
)

# Entradas da planilha (colunas D, E, F e G).
PLANILHA = {
    "FT.54": {"tractors": 3, "trucks": 2, "flow_m3_ha": 35, "radius_km": 42, "speed_loaded": 29.7},
    "FT.56": {"tractors": 2, "trucks": 4, "flow_m3_ha": 30, "radius_km": 49.8, "speed_loaded": 29.7},
    "FT.57": {"tractors": 3, "trucks": 8, "flow_m3_ha": 30, "radius_km": 44.2, "speed_loaded": 29.4},
    "FT.59": {"tractors": 2, "trucks": 3, "flow_m3_ha": 30, "radius_km": 48.1, "speed_loaded": 29.7},
}
# Resultados da planilha: rendimento (linha 18), CV/h (47), intervalo (46), ciclo (44),
# viagens (45) e caminhões (48). Lá o descarregamento não entra no ciclo (texto "0,3").
ESPERADO = {
    "FT.54": (68.709000000000017, 1.8905778301886798, 31.736328989963873, 3.7005820921075152, 6.4854661787361625, 7),
    "FT.56": (45.806000000000004, 1.0803301886792454, 55.538575732436797, 4.183547337784626, 5.7367583206812869, 5),
    "FT.57": (68.709000000000017, 1.6204952830188681, 37.02571715495786, 3.8519889311656863, 6.2305474986754792, 7),
    "FT.59": (45.806000000000004, 1.0803301886792454, 55.538575732436797, 4.0782856816755118, 5.8848256040121019, 5),
}


class FertDimensioningTests(unittest.TestCase):
    def test_matches_the_spreadsheet_to_the_last_decimal(self):
        for front, inputs in PLANILHA.items():
            with self.subTest(front=front):
                calc = calculate(**inputs, unload_h=0)  # descarregamento fora, como na planilha
                yield_ha, cv_hour, interval, cycle, trips, trucks = ESPERADO[front]
                self.assertAlmostEqual(calc["yield_ha"], yield_ha, places=9)
                self.assertAlmostEqual(calc["cv_per_hour"], cv_hour, places=9)
                self.assertAlmostEqual(calc["interval_min"], interval, places=9)
                self.assertAlmostEqual(calc["cycle_h"], cycle, places=9)
                self.assertAlmostEqual(calc["trips_day"], trips, places=9)
                self.assertEqual(calc["trucks_needed"], trucks)
        # Total do dia na planilha: 24 caminhões necessários e 17 alocados (linhas 48 e 49).
        fronts = [{"flow_m3_ha": item["flow_m3_ha"], "radius_km": item["radius_km"],
                   "calc": calculate(**item, unload_h=0)} for item in PLANILHA.values()]
        summary = totals(fronts)
        self.assertEqual((summary["trucks_needed"], summary["trucks"], summary["balance"]), (24, 17, -7))
        self.assertAlmostEqual(summary["yield_ha"], 229.03000000000006, places=9)  # H18
        self.assertAlmostEqual(summary["flow_m3_ha"], 31.5, places=9)               # H24
        self.assertAlmostEqual(summary["radius_km"], 45.44, places=9)               # H33

    def test_unload_time_enters_the_cycle(self):
        # Com o descarregamento de 0,3 h somado, a FT.54 precisa de 8 CVs (ciclo de 4,0006 h).
        calc = calculate(**PLANILHA["FT.54"])
        self.assertAlmostEqual(calc["cycle_h"], 3.7005820921075152 + 0.3, places=9)
        self.assertEqual((calc["trucks_needed"], calc["balance"]), (8, -6))
        self.assertAlmostEqual(calc["volume_m3"], 35 * 68.709, places=9)
        # Bate/volta: descarregamento de 0,1 h.
        self.assertAlmostEqual(calculate(**PLANILHA["FT.54"], round_trip=True)["cycle_h"], 3.7005820921075152 + 0.1, places=9)

    def test_reduced_yield_tratos_and_missing_data(self):
        calc = calculate(tractors=3, trucks=0, flow_m3_ha=35, radius_km=42, tratos="TRATOS RUA MÃE")
        self.assertTrue(calc["reduced_yield"])
        self.assertAlmostEqual(calc["yield_ha"], 68.709 / 3, places=9)
        missing = calculate(tractors=3, trucks=1, flow_m3_ha=None, radius_km=None)
        self.assertEqual((missing["trucks_needed"], missing["missing"]), (None, ["vazão", "raio"]))
        idle = calculate(tractors=0, trucks=2, flow_m3_ha=30, radius_km=40)
        self.assertEqual((idle["trucks_needed"], idle["balance"], idle["interval_min"]), (0, 2, None))

    def test_application_speed_table_and_ha_per_hour(self):
        # Tabela da BASE GERAL (vazão → velocidade) e a largura de trabalho do espaçamento.
        self.assertEqual([application_speed(flow) for flow in (12, 20, 30, 35, 50)], [9, 8.5, 6, 5, 2])
        self.assertEqual(application_speed(34.6), 5)       # arredonda para o m³ inteiro
        self.assertIsNone(application_speed(11))           # fora da tabela: sem velocidade
        self.assertIsNone(application_speed(None))
        self.assertAlmostEqual(ha_per_hour_from_speed(5, "simples"), 7.5)    # 1,5 m × 10 seções
        self.assertAlmostEqual(ha_per_hour_from_speed(5, "combinado"), 6.0)  # 2,4 m × 5 seções
        self.assertIsNone(ha_per_hour_from_speed(5, "outro"))

    def test_clean_params(self):
        self.assertEqual(clean_params({"hours": "3,5", "radius_km": ""})["hours"], 3.5)
        self.assertIsNone(clean_params({})["radius_km"])
        for bad in ({"hours": 30}, {"hours": True}, {"capacity_m3": "abc"}, {"radius_km": float("nan")}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                clean_params(bad)


if __name__ == "__main__":
    unittest.main()
