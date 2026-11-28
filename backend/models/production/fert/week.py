"""Fertirrigação: planejamento da semana (aba PLANEJAMENTO - SEMANAL) e raio orçado."""
from __future__ import annotations

import sqlite3
import time
from datetime import date, timedelta
from typing import Any

from ....services.fert_dimensioning import calculate, clean_params
from ...storage import connection, validate_actor
from ..access import _require_access
from ..common import _clean_text, _normalize_work_date
from .common import fert_unit, parse_front_id, plan_params, require_unit_front
from .sources import OrderBook, sector_place

WEEK_DAYS = 7
DEFAULT_BUDGET_RADIUS_KM = 30.0
MAX_WEEK_TRACTORS = 20


def _budget_radius(conn: sqlite3.Connection, unit: str) -> float:
    row = conn.execute("SELECT budget_radius_km FROM production_fert_settings WHERE unit_code=?", (unit,)).fetchone()
    return float(row["budget_radius_km"]) if row else DEFAULT_BUDGET_RADIUS_KM


def _cell(front: dict[str, Any], plan: dict[str, Any], row: sqlite3.Row | None, book: OrderBook,
          conn: sqlite3.Connection) -> dict[str, Any]:
    """Um dia da frente: o planejado (setor, vazão, tratores) ou, hoje sem planejamento, o que está
    lançado e planejado na frente."""
    if row is None:
        orders, sector = front["orders"], front["sector"]
        flow, tractors = front["flow_m3_ha"], front["calc"]["tractors"]
        place = {"farm": front["farm"], "radius_km": front["radius_km"], "base": front["base"]}
    else:
        sector = row["sector"]
        orders = book.details(sector, "", front.get("fert_operations", ()))
        flow = row["flow_m3_ha"] if row["flow_m3_ha"] is not None else orders["flow_m3_ha"]
        tractors = row["tractors"] if row["tractors"] is not None else front["calc"]["tractors"]
        place = sector_place(conn, sector, front["base"])
    params, _spacing, speed, _speed_ha_h = plan_params(plan, flow)
    calc = calculate(tractors=tractors, trucks=0, flow_m3_ha=flow, radius_km=place["radius_km"],
                     tratos=orders["tratos"], round_trip=bool(plan.get("round_trip")), **params)
    planned_flow = row is not None and row["flow_m3_ha"] is not None
    return {
        "sector": sector, "farm": place["farm"], "radius_km": place["radius_km"], "base": place["base"],
        "flow_m3_ha": flow, "flow_source": "planejado" if planned_flow else ("O.S." if flow is not None else ""),
        "tractors": tractors, "speed": speed, "saved": row is not None,
        "yield_ha": calc["yield_ha"], "volume_m3": calc["volume_m3"], "trucks_needed": calc["trucks_needed"],
    }


def _day_total(cells: list[dict[str, Any]], budget: float) -> dict[str, Any]:
    """Totais do dia e o raio planejado: média dos raios ponderada pela vazão (como a planilha)."""
    weighted = [(cell["radius_km"], cell["flow_m3_ha"]) for cell in cells
                if cell["radius_km"] is not None and cell["flow_m3_ha"]]
    weight = sum(flow for _, flow in weighted)
    planned = sum(radius * flow for radius, flow in weighted) / weight if weight else None
    needed = [cell["trucks_needed"] for cell in cells if cell["trucks_needed"] is not None]
    return {
        "fronts": len(cells), "trucks_needed": sum(needed) if needed else None,
        "yield_ha": sum(cell["yield_ha"] for cell in cells),
        "volume_m3": sum(cell["volume_m3"] or 0 for cell in cells),
        "planned_radius_km": planned, "radius_difference_km": planned - budget if planned is not None else None,
    }


def week_plan(conn: sqlite3.Connection, unit: str, start: str, fronts: list[dict[str, Any]],
              plans: dict[int, dict[str, Any]], book: OrderBook) -> dict[str, Any]:
    """Setor de cada frente por dia, com CVs, área e volume do dia e o raio planejado × orçado."""
    first = date.fromisoformat(start)
    days = [(first + timedelta(days=offset)).isoformat() for offset in range(WEEK_DAYS)]
    saved = {(row["service_front_id"], row["work_date"]): row for row in conn.execute(
        "SELECT * FROM production_fert_week WHERE unit_code=? AND work_date BETWEEN ? AND ?", (unit, days[0], days[-1]))}
    rows = []
    for front in fronts:
        plan = plans.get(front["service_front_id"], {})
        cells = {}
        for day in days:
            row = saved.get((front["service_front_id"], day))
            if row is not None or day == days[0]:
                cells[day] = _cell(front, plan, row, book, conn)
        rows.append({"service_front_id": front["service_front_id"], "name": front["name"], "cells": cells})
    budget = _budget_radius(conn, unit)
    day_totals = {day: _day_total([row["cells"][day] for row in rows if day in row["cells"]], budget) for day in days}
    return {"days": days, "rows": rows, "totals": day_totals, "budget_radius_km": budget}


def _week_tractors(value: Any) -> int | None:
    if value in (None, ""):
        return None
    message = f"Informe o nº de tratores (0 a {MAX_WEEK_TRACTORS})."
    if isinstance(value, bool):
        raise ValueError(message)
    try:
        tractors = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(message) from exc
    if not 0 <= tractors <= MAX_WEEK_TRACTORS:
        raise ValueError(message)
    return tractors


def save_fert_week(user_id: int, payload: Any) -> dict[str, Any]:
    """Setor de uma frente num dia da semana (setor vazio apaga o dia)."""
    if not isinstance(payload, dict):
        raise ValueError("Planejamento inválido.")
    unit = fert_unit(payload.get("unit_code"))
    work_date = _normalize_work_date(payload.get("work_date"))
    front = parse_front_id(payload.get("service_front_id"))
    sector = _clean_text(payload.get("sector"), "o setor", 32)
    flow = clean_params({"flow_m3_ha": payload.get("flow_m3_ha")})["flow_m3_ha"]
    tractors = _week_tractors(payload.get("tractors"))
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_access(conn, user_id, permission="fill", unit=unit)
        validate_actor(conn, user_id)
        require_unit_front(conn, front, unit)
        if not sector:
            conn.execute("DELETE FROM production_fert_week WHERE unit_code=? AND work_date=? AND service_front_id=?",
                         (unit, work_date, front))
            return {"ok": True}
        conn.execute(
            """INSERT INTO production_fert_week(unit_code,work_date,service_front_id,sector,flow_m3_ha,tractors,updated_by,updated_at)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(unit_code,work_date,service_front_id) DO UPDATE SET sector=excluded.sector,
                 flow_m3_ha=excluded.flow_m3_ha, tractors=excluded.tractors, updated_by=excluded.updated_by,
                 updated_at=excluded.updated_at""",
            (unit, work_date, front, sector, flow, tractors, user_id, int(time.time())),
        )
    return {"ok": True}


def save_fert_settings(user_id: int, payload: Any) -> dict[str, Any]:
    """Raio orçado da unidade (comparado com o raio planejado da semana)."""
    if not isinstance(payload, dict):
        raise ValueError("Configuração inválida.")
    unit = fert_unit(payload.get("unit_code"))
    radius = clean_params({"radius_km": payload.get("budget_radius_km")})["radius_km"]
    if radius is None:
        raise ValueError("Informe o raio orçado em km.")
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_access(conn, user_id, permission="fill", unit=unit)
        validate_actor(conn, user_id)
        conn.execute(
            """INSERT INTO production_fert_settings(unit_code,budget_radius_km,updated_by,updated_at) VALUES (?,?,?,?)
               ON CONFLICT(unit_code) DO UPDATE SET budget_radius_km=excluded.budget_radius_km,
                 updated_by=excluded.updated_by, updated_at=excluded.updated_at""",
            (unit, radius, user_id, int(time.time())),
        )
    return {"ok": True, "budget_radius_km": radius}
