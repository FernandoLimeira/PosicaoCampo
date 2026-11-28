"""Dimensionamento das frentes de fertirrigação (Polo SP): CVs (caminhões) por frente.

Mesma conta da planilha "Logística Fertirrigação" (aba PLANEJAMENTO NRD), sem arredondar no
meio do cálculo (o único arredondamento é o nº de caminhões, para cima, como na planilha):

- rendimento (ha/dia) = horas × nº de tratores × ha/hora
  (÷ 3 nos tratos de rua-mãe, plantio e meiosi);
- volume do dia (m³)  = vazão (m³/ha) × rendimento;
- necessidade (CV/h)  = volume do dia ÷ capacidade por viagem (m³) ÷ 24;
- ciclo (h)           = raio ÷ velocidade carregado + raio ÷ velocidade vazio
                        + tempo auxiliar + carregamento + descarregamento;
- viagens por dia     = 24 ÷ ciclo; intervalo de saída (min) = 60 ÷ necessidade;
- CVs necessários     = ⌈necessidade × ciclo⌉.

Diferença para a planilha: lá o tempo de descarregamento é gravado como texto ("0,3") e a soma
do ciclo o ignora; aqui ele entra no ciclo (0,3 h, ou 0,1 h com bate/volta).
"""
from __future__ import annotations

import math
from typing import Any

from .front_identifiers import normalize_label

# Valores da planilha usados quando o planejador não informa outro.
DEFAULTS: dict[str, float] = {
    "hours": 3.7,             # hora trabalhada (plano)
    "ha_per_hour": 6.19,      # hectares por hora por trator (plano)
    "capacity_m3": 53.0,      # capacidade por viagem
    "speed_loaded": 29.7,     # km/h carregado
    "speed_empty": 35.4,      # km/h vazio
    "aux_h": 0.8,             # tempo auxiliar
    "load_h": 0.3,            # tempo de carregamento
    "unload_h": 0.3,          # tempo de descarregamento
    "unload_round_trip_h": 0.1,  # descarregamento com bate/volta
}
# Tratos em que o rendimento da equipe é um terço (planilha, linha 18).
REDUCED_YIELD_TRATOS = ("TRATOS RUA MAE", "TRATOS PLANTIO", "TRATOS MEIOSI")
NUMERIC_LIMITS: dict[str, tuple[float, float]] = {
    "hours": (0, 24), "ha_per_hour": (0, 100), "capacity_m3": (1, 200), "speed_loaded": (1, 120),
    "speed_empty": (1, 120), "aux_h": (0, 24), "load_h": (0, 24), "unload_h": (0, 24),
    "flow_m3_ha": (0, 1000), "radius_km": (0, 1000), "gas_pct_per_trip": (0.1, 100),
}
# CV a gás (biometano): % do tanque gasto por km de raio, ida e volta (planilha, "CONSUMO BIOMETANO %":
# FT.56 49,8 km → 42,3%; FT.57 44,2 km → 37,6%; FT.59 48,1 km → 40,9% = raio × 0,85%).
GAS_PCT_PER_RADIUS_KM = 0.85


def gas_pct_per_trip(radius_km: float | None, override: float | None = None) -> float | None:
    """% do tanque de gás gasto por viagem (ida e volta) na frente."""
    if override is not None:
        return override
    return radius_km * GAS_PCT_PER_RADIUS_KM if radius_km else None


def gas_trips(level_pct: float | None, per_trip: float | None) -> int | None:
    """Viagens completas que o CV a gás ainda faz com o gás do tanque."""
    if level_pct is None or not per_trip:
        return None
    return int(round(level_pct / per_trip, 9) // 1)


def reduced_yield(tratos: Any) -> bool:
    label = normalize_label(tratos).upper()
    return any(normalize_label(name).upper() in label for name in REDUCED_YIELD_TRATOS)


def calculate(*, tractors: int, trucks: int, flow_m3_ha: float | None, radius_km: float | None,
              tratos: str = "", round_trip: bool = False, **params: float) -> dict[str, Any]:
    """Indicadores de uma frente. Sem vazão ou sem raio, o que depende deles fica ``None``
    (a tela pede o dado em vez de mostrar uma conta errada)."""
    value = {key: float(params[key]) if params.get(key) is not None else DEFAULTS[key] for key in DEFAULTS}
    unload = value["unload_round_trip_h"] if round_trip else value["unload_h"]
    reduced = reduced_yield(tratos)
    yield_ha = value["hours"] * tractors * value["ha_per_hour"] / (3 if reduced else 1)
    result: dict[str, Any] = {
        "tractors": tractors, "trucks": trucks, "yield_ha": yield_ha, "reduced_yield": reduced,
        "unload_h": unload, "volume_m3": None, "cv_per_hour": None, "cycle_h": None, "trips_day": None,
        "interval_min": None, "trucks_needed": None, "balance": None,
        "missing": [name for name, item in (("vazão", flow_m3_ha), ("raio", radius_km)) if item is None],
    }
    if flow_m3_ha is not None:
        volume = flow_m3_ha * yield_ha
        result["volume_m3"] = volume
        result["cv_per_hour"] = volume / value["capacity_m3"] / 24
        if result["cv_per_hour"] > 0:
            result["interval_min"] = 60 / result["cv_per_hour"]
    if radius_km is not None:
        cycle = (radius_km / value["speed_loaded"] + radius_km / value["speed_empty"]
                 + value["aux_h"] + value["load_h"] + unload)
        result["cycle_h"] = cycle
        result["trips_day"] = 24 / cycle if cycle > 0 else None
    if result["cv_per_hour"] is not None and result["cycle_h"] is not None:
        # Tolerância de ponto flutuante: 7,0000000001 caminhões continuam sendo 7.
        needed = math.ceil(round(result["cv_per_hour"] * result["cycle_h"], 9))
        result["trucks_needed"] = needed
        result["balance"] = trucks - needed
    return result


def totals(fronts: list[dict[str, Any]]) -> dict[str, Any]:
    """Totais da unidade: soma de tratores, CVs, ha e m³; vazão e raio ponderados pelo
    rendimento (como a coluna Geral da planilha)."""
    calc = [front["calc"] for front in fronts]

    def total(key):
        values = [item[key] for item in calc if item[key] is not None]
        return sum(values) if values else None

    def weighted(source):
        pairs = [(front[source], front["calc"]["yield_ha"]) for front in fronts
                 if front[source] is not None and front["calc"]["yield_ha"]]
        weight = sum(item for _, item in pairs)
        return sum(value * item for value, item in pairs) / weight if weight else None

    needed = total("trucks_needed")
    trucks = sum(item["trucks"] for item in calc)
    return {
        "fronts": len(fronts), "tractors": sum(item["tractors"] for item in calc), "trucks": trucks,
        "trucks_needed": needed, "balance": trucks - needed if needed is not None else None,
        "yield_ha": total("yield_ha"), "volume_m3": total("volume_m3"), "cv_per_hour": total("cv_per_hour"),
        "flow_m3_ha": weighted("flow_m3_ha"), "radius_km": weighted("radius_km"),
        "incomplete": sum(1 for item in calc if item["trucks_needed"] is None),
    }


def clean_params(payload: Any) -> dict[str, float | None]:
    """Parâmetros enviados pela tela: números dentro dos limites (vazio = valor padrão)."""
    if not isinstance(payload, dict):
        raise ValueError("Parâmetros inválidos.")
    cleaned: dict[str, float | None] = {}
    for key, (low, high) in NUMERIC_LIMITS.items():
        raw = payload.get(key)
        if raw is None or raw == "":
            cleaned[key] = None
            continue
        if isinstance(raw, bool):
            raise ValueError("Parâmetros inválidos.")
        try:
            number = float(str(raw).replace(",", "."))
        except (TypeError, ValueError) as exc:
            raise ValueError("Parâmetros inválidos.") from exc
        if not math.isfinite(number) or not low <= number <= high:
            raise ValueError(f"Valor fora do limite em {key}: use entre {low:g} e {high:g}.")
        cleaned[key] = number
    return cleaned


# ---------------------------------------------------------------------------
# BASE GERAL da planilha: velocidade de aplicação pela vazão e espaçamento do plantio.
# ---------------------------------------------------------------------------
# Vazão (m³/ha) → velocidade média de aplicação (km/h).
APPLICATION_SPEED = {
    12: 9, 13: 9, 14: 9, 15: 8.5, 16: 8.5, 17: 8.5, 18: 8.5, 19: 8.5, 20: 8.5, 21: 8, 22: 8, 23: 8,
    24: 7.5, 25: 7.5, 26: 7.5, 27: 7, 28: 7, 29: 6.5, 30: 6, 31: 6, 32: 5.5, 33: 5.5, 34: 5.5, 35: 5,
    36: 5, 37: 5, 38: 4.5, 39: 4.5, 40: 4, 41: 4, 42: 3.5, 43: 3.5, 44: 3.5, 45: 3.5, 46: 3, 47: 3,
    48: 3, 49: 3, 50: 2,
}
# Espaçamento: entrelinha (m) e nº de seções (linhas aplicadas por passada).
SPACINGS = {"simples": {"spacing_m": 1.5, "sections": 10}, "combinado": {"spacing_m": 2.4, "sections": 5}}


def application_speed(flow_m3_ha: float | None) -> float | None:
    """Velocidade de aplicação da tabela pela vazão (arredondada para o m³ inteiro). Fora da
    tabela (abaixo de 12 ou acima de 50 m³/ha) não há velocidade (a planilha dava #N/D)."""
    if flow_m3_ha is None:
        return None
    return APPLICATION_SPEED.get(int(flow_m3_ha + 0.5))


def ha_per_hour_from_speed(speed_kmh: float | None, spacing: str) -> float | None:
    """ha/hora de um trator: velocidade × largura de trabalho (entrelinha × seções) ÷ 10.
    Ex.: 5 km/h no simples (1,5 m × 10 seções = 15 m) → 7,5 ha/h."""
    layout = SPACINGS.get(spacing)
    if speed_kmh is None or not layout:
        return None
    return speed_kmh * layout["spacing_m"] * layout["sections"] / 10
