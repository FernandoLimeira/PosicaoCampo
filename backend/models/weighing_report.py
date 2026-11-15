"""Relatório gerencial da balança (Posição de Campo) em Excel.

Abas: Resumo (indicadores das 4 unidades e total), Hora a hora (colunas da aba Chegada),
Turnos (A, B e C), Troca de cana (frentes entregando em outra unidade; o ATR entra na média
da unidade que recebeu) e Frentes (pesagem por frente). Os números são os mesmos da tela e
da imagem: resumo de ``weighing_summary`` (hora atual − 1 h) e frentes/indústria da posição.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from ..services.field_status import field_status
from ..services.operational_shifts import FIELD_TIMEZONE, unit_timezone
from ..services.xlsx_writer import build_xlsx
from .units import _parse_br_number, list_units
from .weighings import weighing_summary

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
SHIFTS = ("A", "B", "C")


def _time(timestamp: int | None, unit_code: str) -> str:
    """Horário local da unidade (Polo MS: uma hora a menos que Brasília)."""
    return datetime.fromtimestamp(timestamp, unit_timezone(unit_code)).strftime("%d/%m/%Y %H:%M") if timestamp else ""


def _diff(a, b):
    return round(a - b, 1) if a is not None and b is not None else None


def _average(values) -> float | None:
    values = [value for value in values if value is not None]
    return round(sum(values) / len(values), 1) if values else None


def _position_indicators(unit: dict[str, Any]) -> dict[str, Any]:
    rows = [row for row in unit.get("rows") or []
            if isinstance(row, list) and (str(row[0] or "").strip() or str(row[1] or "").strip())]
    metrics = unit.get("metrics") or []
    industry = _parse_br_number(str(metrics[0][2])) if metrics and len(metrics[0]) > 2 else None
    return {
        "fronts": len(rows),
        "active": sum(1 for row in rows if len(row) > 3 and field_status(row[3])["group"] == "active"),
        "industry": industry,
    }


def build_weighing_report(work_date: Any = None, at_time: Any = None) -> tuple[bytes, str]:
    summary = weighing_summary(work_date, at_time=at_time)
    positions = {unit.get("code"): _position_indicators(unit) for unit in list_units()}
    day = summary["work_date"]

    header = ["Unidade", "Frentes em atividade", "Frentes", "Indústria (t/h)", "Moagem turno (t/h)", "% da indústria",
              "Entrega turno (t/h)", "Diferença turno (t/h)", "Moagem últ. 3 h (t/h)", "Entrega últ. 3 h (t/h)",
              "Estoque (cargas)", "ATR parcial (kg/t)", "Processado dia (t)", "Cana entregue dia (t)",
              "Projeção moagem (t)", "Projeção entrega (t)", "Turno", "Fechamento até"]
    resumo = [["Relatório gerencial · Balança CTT"], ["Dia", day],
              ["Fechamento", f"às {at_time}" if at_time else "hora atual − 1 h"],
              ["Gerado em", datetime.now(FIELD_TIMEZONE).strftime("%d/%m/%Y %H:%M")], [], header]
    hours_rows = [["Unidade", "Hora", "Turno", "Moagem (t)", "Cargas", "Densidade (t)", "Qtd. CVs", "Cana entregue (t)", "Diferença (t)"]]
    shift_rows = [["Unidade", "Turno", "Horas", "Moagem total (t)", "Entrega total (t)", "Diferença (t)", "Média moagem (t/h)", "Média entrega (t/h)"]]
    front_rows = [["Unidade", "Frente", "Setor", "Seção", "Cargas", "Toneladas", "ATR (kg/t)", "Frente de outra unidade"]]
    totals = {"active": 0, "fronts": 0, "milling": [], "delivery": [], "stock": [], "atr": [], "day": [], "delivery_day": [], "projection": []}
    for unit in summary["units"]:
        code = unit["code"]
        position = positions.get(code, {"fronts": 0, "active": 0, "industry": None})
        has = unit["loads_day"] > 0
        share = (round(unit["milling_shift_tph"] / position["industry"] * 100, 1)
                 if has and position["industry"] and unit["milling_shift_tph"] is not None else None)
        value = lambda key: unit[key] if has else None  # noqa: E731
        resumo.append([code, position["active"], position["fronts"], position["industry"], value("milling_shift_tph"), share,
                       value("delivery_shift_tph"), _diff(value("delivery_shift_tph"), value("milling_shift_tph")),
                       value("milling_last3h_tph"), value("delivery_last3h_tph"), unit["stock_loads"], value("atr"),
                       value("milling_day_t"), value("delivery_day_t"), value("milling_projection_t"), value("delivery_projection_t"),
                       unit["shift"], _time(unit["closed_until"] - 1 if unit["closed_until"] else None, code)])
        totals["active"] += position["active"]
        totals["fronts"] += position["fronts"]
        for key, source in (("milling", "milling_shift_tph"), ("delivery", "delivery_shift_tph"), ("atr", "atr"),
                            ("day", "milling_day_t"), ("delivery_day", "delivery_day_t"), ("projection", "milling_projection_t")):
            if value(source) is not None:
                totals[key].append(value(source))
        totals["stock"].append(unit["stock_loads"])
        for item in unit["hours"]:
            hours_rows.append([code, f"{item['hour']:02d}:00", item["shift"], item["milling_t"], item["loads"], item["density_t"],
                               item["trucks"], item["delivery_t"], _diff(item["delivery_t"], item["milling_t"])])
        for shift in SHIFTS:
            hours = [item for item in unit["hours"] if item["shift"] == shift]
            if not hours:
                continue
            milling = round(sum(item["milling_t"] or 0 for item in hours), 1)
            delivery = round(sum(item["delivery_t"] or 0 for item in hours), 1)
            shift_rows.append([code, shift, len(hours), milling, delivery, _diff(delivery, milling),
                               _average(item["milling_t"] for item in hours), _average(item["delivery_t"] for item in hours)])
        for front in unit["fronts"]:
            front_rows.append([code, front["front"], front["sector"], front["section"], front["loads"], front["tons"], front["atr"],
                               front["home_unit"] if front["external"] else ""])
    resumo.append(["Total", totals["active"], totals["fronts"], None, round(sum(totals["milling"]), 1) if totals["milling"] else None, None,
                   round(sum(totals["delivery"]), 1) if totals["delivery"] else None, None, None, None, sum(totals["stock"]),
                   _average(totals["atr"]) if totals["atr"] else None,
                   round(sum(totals["day"]), 1) if totals["day"] else None, round(sum(totals["delivery_day"]), 1) if totals["delivery_day"] else None,
                   round(sum(totals["projection"]), 1) if totals["projection"] else None, None, None, None])
    resumo.append([])
    resumo.append(["ATR do total: média das unidades com pesagem. % da indústria: moagem do turno ÷ Indústria digitada no Preencher."])

    exchange = [["Frente", "Unidade dona", "Entregou em", "Cargas", "Toneladas", "ATR (kg/t)", "ATR entra na média de"]]
    for item in summary["support"]:
        exchange.append([item["front"], item["from_unit"], item["to_unit"], item["loads"], item["tons"], item["atr"], item["to_unit"]])

    content = build_xlsx([
        ("Resumo", resumo, 6),
        ("Hora a hora", hours_rows, 1),
        ("Turnos", shift_rows, 1),
        ("Troca de cana", exchange, 1),
        ("Frentes", front_rows, 1),
    ])
    suffix = f"-{str(at_time).replace(':', 'h')}" if at_time else ""
    return content, f"Relatorio-gerencial-{day}{suffix}.xlsx"
