"""ATR estimado — UPN1 / análises próximas.

Modalidade *estimada* (não é o cálculo oficial do PIMS) para dar ATR às cargas que vieram
sem análise no SELECT da balança. Trabalha só com as cargas já importadas, em memória:

1. Análise válida = carga com ATR informado, numérico, finito e entre 0 e 1000 kg/t.
   ATR nulo, vazio ou inválido não é análise e nunca vira zero. O ATR original nunca é
   substituído.
2. Agrupamento de atribuição: unidade (instância) + período operacional + UPN1
   (``CD_UPNIVEL1``). A frente de transporte só é usada como alternativa.
3. Carga sem análise, com horário, na UPN1 com análises com horário: as duas análises mais
   próximas no tempo, ponderadas pelo inverso da distância em segundos::

       P = 1 / max(D, 1)
       ATR_ESTIMADO = (ATR1·P1 + ATR2·P2) / (P1 + P2)

   Com uma só análise, o ATR dela. Empate de distância: a análise mais antiga e depois a
   menor liberação (ordem determinística).
4. Sem horário (na carga ou nas análises da UPN1): média das análises da UPN1 ponderada
   pelo peso líquido, sem inventar posição no tempo.
5. Sem análise na UPN1 (ou carga sem UPN1): média das análises da mesma frente no mesmo
   período, ponderada pelo peso líquido. Sem análise na frente: ATR indisponível.
6. ATR médio da frente e geral: Σ(ATR_final × peso) ÷ Σ(peso), só com cargas de peso > 0 e
   ATR final disponível. O geral é calculado direto das cargas, nunca pela média das frentes.

Os cálculos usam ``Decimal`` sem arredondar etapas intermediárias; só a apresentação
(``round_atr``) arredonda para 2 casas.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Callable, Iterable, Mapping, Sequence

ORIGIN_ANALYZED = "ANALISADO"
ORIGIN_UPN1 = "ESTIMADO_UPN1"
ORIGIN_FRONT = "ESTIMADO_FRENTE"
ORIGIN_NONE = "SEM_ANALISE"
ORIGINS = (ORIGIN_ANALYZED, ORIGIN_UPN1, ORIGIN_FRONT, ORIGIN_NONE)

# Como a estimativa foi obtida (detalhe da origem, para auditoria).
METHOD_ANALYSIS = "analise_original"
METHOD_TWO_NEAREST = "duas_analises_proximas"
METHOD_SINGLE = "unica_analise"
METHOD_UPN1_MEAN = "media_upn1_sem_horario"
METHOD_FRONT_MEAN = "media_frente"
METHOD_NONE = "sem_analise"

ATR_MIN = Decimal("0")  # exclusivo
ATR_MAX = Decimal("1000")  # exclusivo
NEAREST_ANALYSES = 2
_CENT = Decimal("0.01")

TemporalWeight = Callable[[int], Decimal]


def inverse_distance_weight(distance_seconds: int) -> Decimal:
    """Peso temporal padrão: 1 / max(D, 1), com D em segundos."""
    return Decimal(1) / Decimal(max(abs(int(distance_seconds)), 1))


def _decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = value if isinstance(value, Decimal) else Decimal(str(value).strip().replace(",", "."))
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() else None


def valid_atr(value: Any) -> Decimal | None:
    """ATR analisado válido ou ``None`` (ausente/inválido nunca vira zero)."""
    number = _decimal(value)
    return number if number is not None and ATR_MIN < number < ATR_MAX else None


def valid_weight(value: Any) -> Decimal | None:
    """Peso líquido (kg) que pode ponderar a média: finito e maior que zero."""
    number = _decimal(value)
    return number if number is not None and number > 0 else None


@dataclass(frozen=True)
class AtrLoad:
    """Carga de entrada (cópia imutável: os dados importados não são alterados)."""
    unit_code: str
    release_no: str
    front: str
    upn1: str
    period: str
    moment: int | None
    net_kg: Decimal | None
    atr: Decimal | None

    @property
    def key(self) -> tuple[str, str]:
        return self.unit_code, self.release_no


@dataclass(frozen=True)
class AtrResult:
    load: AtrLoad
    original_atr: Decimal | None
    estimated_atr: Decimal | None
    final_atr: Decimal | None
    origin: str
    method: str
    analyses: tuple[str, ...] = ()


@dataclass(frozen=True)
class AtrAverage:
    weight_kg: Decimal
    atr_x_weight: Decimal
    loads: int
    loads_with_atr: int

    @property
    def atr(self) -> Decimal | None:
        return self.atr_x_weight / self.weight_kg if self.weight_kg > 0 else None


def _field(row: Mapping[str, Any], name: str) -> Any:
    try:
        return row[name]
    except (KeyError, IndexError):
        return None


def build_loads(rows: Iterable[Mapping[str, Any]], *, period: Callable[[Mapping[str, Any]], str] | None = None,
                moment_field: str = "scale_out_at") -> list[AtrLoad]:
    """Cargas a partir das linhas importadas (``field_weighings``). Liberação repetida na
    mesma unidade conta uma vez (vale a última linha)."""
    loads: dict[tuple[str, str], AtrLoad] = {}
    for row in rows:
        unit = str(_field(row, "unit_code") or "").strip().upper()
        release = str(_field(row, "release_no") or "").strip()
        if not unit or not release:
            continue
        moment = _field(row, moment_field)
        loads[(unit, release)] = AtrLoad(
            unit_code=unit, release_no=release,
            front=str(_field(row, "front") or "").strip(),
            upn1=str(_field(row, "upn1") or "").strip(),
            period=str(period(row) if period else (_field(row, "movement_date") or "")).strip(),
            moment=int(moment) if moment is not None else None,
            net_kg=valid_weight(_field(row, "net_kg")),
            atr=valid_atr(_field(row, "atr")),
        )
    return list(loads.values())


def identify_analyses(loads: Iterable[AtrLoad]) -> list[AtrLoad]:
    return [load for load in loads if load.atr is not None]


def upn1_group_key(load: AtrLoad) -> tuple[str, str, str] | None:
    """Carga sem UPN1 não forma grupo (vai direto para a alternativa pela frente)."""
    return (load.unit_code, load.period, load.upn1.casefold()) if load.upn1 else None


def front_group_key(load: AtrLoad) -> tuple[str, str, str] | None:
    return (load.unit_code, load.period, load.front.casefold()) if load.front else None


def group_analyses(loads: Iterable[AtrLoad], key: Callable[[AtrLoad], Any]) -> dict[Any, list[AtrLoad]]:
    groups: dict[Any, list[AtrLoad]] = {}
    for load in identify_analyses(loads):
        group = key(load)
        if group is not None:
            groups.setdefault(group, []).append(load)
    for analyses in groups.values():
        analyses.sort(key=lambda item: (item.moment is None, item.moment or 0, item.release_no))
    return groups


def nearest_analyses(moment: int, analyses: Sequence[AtrLoad], count: int = NEAREST_ANALYSES) -> list[AtrLoad]:
    """Análises com horário mais próximas de ``moment``. Empate: a mais antiga, depois a
    menor liberação."""
    timed = [item for item in analyses if item.moment is not None]
    timed.sort(key=lambda item: (abs(item.moment - moment), item.moment, item.release_no))
    return timed[:count]


def temporal_atr(analyses: Sequence[AtrLoad], moment: int,
                 weight: TemporalWeight = inverse_distance_weight) -> Decimal | None:
    """Média das análises ponderada pela distância no tempo (fórmula configurável)."""
    pairs = [(item.atr, weight(item.moment - moment)) for item in analyses
             if item.atr is not None and item.moment is not None]
    total = sum((p for _, p in pairs), Decimal(0))
    return sum((atr * p for atr, p in pairs), Decimal(0)) / total if total > 0 else None


def weight_mean_atr(analyses: Sequence[AtrLoad]) -> Decimal | None:
    """Média das análises ponderada pelo peso líquido. Se nenhuma análise tiver peso, média
    simples delas (só para estimar uma carga; as médias finais são sempre ponderadas)."""
    valid = [item for item in analyses if item.atr is not None]
    weighed = [item for item in valid if item.net_kg is not None]
    if weighed:
        total = sum((item.net_kg for item in weighed), Decimal(0))
        return sum((item.atr * item.net_kg for item in weighed), Decimal(0)) / total
    return sum((item.atr for item in valid), Decimal(0)) / len(valid) if valid else None


def _ids(analyses: Iterable[AtrLoad]) -> tuple[str, ...]:
    return tuple(item.release_no for item in analyses)


@dataclass(frozen=True)
class AtrContext:
    by_upn1: Mapping[Any, Sequence[AtrLoad]]
    by_front: Mapping[Any, Sequence[AtrLoad]]
    weight: TemporalWeight = inverse_distance_weight

    @classmethod
    def from_loads(cls, loads: Sequence[AtrLoad], weight: TemporalWeight = inverse_distance_weight) -> "AtrContext":
        return cls(group_analyses(loads, upn1_group_key), group_analyses(loads, front_group_key), weight)


def assign_atr(load: AtrLoad, context: AtrContext) -> AtrResult:
    if load.atr is not None:
        return AtrResult(load, load.atr, None, load.atr, ORIGIN_ANALYZED, METHOD_ANALYSIS, (load.release_no,))

    upn1_key = upn1_group_key(load)
    upn1_analyses = context.by_upn1.get(upn1_key, ()) if upn1_key else ()
    if upn1_analyses:
        timed = [item for item in upn1_analyses if item.moment is not None]
        if load.moment is not None and timed:
            chosen = nearest_analyses(load.moment, timed)
            estimated = temporal_atr(chosen, load.moment, context.weight)
            method = METHOD_TWO_NEAREST if len(chosen) > 1 else METHOD_SINGLE
        else:
            # Sem horário na carga (ou nas análises): não inventa a posição no tempo.
            chosen = list(upn1_analyses)
            estimated = weight_mean_atr(chosen)
            method = METHOD_UPN1_MEAN
        if estimated is not None:
            return AtrResult(load, None, estimated, estimated, ORIGIN_UPN1, method, _ids(chosen))

    front_key = front_group_key(load)
    front_analyses = list(context.by_front.get(front_key, ())) if front_key else []
    estimated = weight_mean_atr(front_analyses)
    if estimated is not None:
        return AtrResult(load, None, estimated, estimated, ORIGIN_FRONT, METHOD_FRONT_MEAN, _ids(front_analyses))
    return AtrResult(load, None, None, None, ORIGIN_NONE, METHOD_NONE)


def estimate_atr(loads: Sequence[AtrLoad], weight: TemporalWeight = inverse_distance_weight) -> list[AtrResult]:
    """ATR final de cada carga (mesma ordem de entrada; cargas repetidas contam uma vez)."""
    unique: dict[tuple[str, str], AtrLoad] = {}
    for load in loads:
        unique[load.key] = load
    ordered = list(unique.values())
    context = AtrContext.from_loads(ordered, weight)
    return [assign_atr(load, context) for load in ordered]


def weighted_atr(results: Iterable[AtrResult]) -> AtrAverage:
    """Σ(ATR_final × peso) ÷ Σ(peso): só cargas com peso > 0 e ATR final disponível."""
    weight = sample = Decimal(0)
    loads = with_atr = 0
    for result in results:
        loads += 1
        net = result.load.net_kg
        if result.final_atr is None or net is None:
            continue
        with_atr += 1
        weight += net
        sample += result.final_atr * net
    return AtrAverage(weight, sample, loads, with_atr)


def atr_by_front(results: Iterable[AtrResult]) -> dict[str, AtrAverage]:
    """ATR médio por frente de transporte (onde a carga foi pesada), mesmo quando a
    estimativa individual veio da UPN1."""
    fronts: dict[str, list[AtrResult]] = {}
    for result in results:
        fronts.setdefault(result.load.front, []).append(result)
    return {front: weighted_atr(items) for front, items in fronts.items()}


def overall_atr(results: Iterable[AtrResult]) -> AtrAverage:
    """ATR geral direto das cargas (não é a média das frentes)."""
    return weighted_atr(results)


def origin_counts(results: Iterable[AtrResult]) -> dict[str, int]:
    counts = dict.fromkeys(ORIGINS, 0)
    for result in results:
        counts[result.origin] += 1
    return counts


def round_atr(value: Decimal | None) -> float | None:
    """Arredondamento só na apresentação: 2 casas, meio para cima."""
    return float(value.quantize(_CENT, rounding=ROUND_HALF_UP)) if value is not None else None
