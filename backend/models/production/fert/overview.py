"""Fertirrigação: painel do dia (frentes dimensionadas, frota, recomendações e movimentações)."""
from __future__ import annotations

import sqlite3
from typing import Any

from ....services.fert_dimensioning import (
    DEFAULTS, SPACINGS, calculate, gas_pct_per_trip, gas_trips, totals,
)
from ....services.front_identifiers import natural_key
from ...storage import connection
from ..access import _require_access
from ..common import _normalize_work_date
from .common import (
    ALLOCATABLE_STATUSES, EQUIPMENT_KINDS, EQUIPMENT_STATUSES, base_key, fert_unit, plan_params, unit_equipment,
)
from .sources import OrderBook, base_options, fert_items, front_operations, read_plans, sector_place
from .week import week_plan


def _source(planned: Any, value: Any, fallback: str) -> str:
    return "plano" if planned is not None else (fallback if value is not None else "")


def _front(conn: sqlite3.Connection, unit: str, selected_date: str, front_id: int, entry: dict[str, Any],
           plan: dict[str, Any], orders: dict[str, Any], by_id: dict[int, dict[str, Any]]) -> dict[str, Any]:
    bases = base_options(conn, unit, entry["sector"])
    with_radius = [option for option in bases if option["radius_km"] is not None]
    base = plan.get("base") or (with_radius[0]["base"] if len(with_radius) == 1 else "")
    table_radius = next((option["radius_km"] for option in bases if base_key(option["base"]) == base_key(base)), None)
    flow = plan["flow_m3_ha"] if plan.get("flow_m3_ha") is not None else orders["flow_m3_ha"]
    radius = table_radius  # raio do setor + base (digitado no plano ou importado)
    params, spacing, speed, speed_ha_h = plan_params(plan, flow)
    tractors = [by_id[i] for i in plan.get("tractors", []) if i in by_id and by_id[i]["kind"] == "tractor"]
    trucks = [by_id[i] for i in plan.get("trucks", []) if i in by_id and by_id[i]["kind"] == "truck"]
    working = lambda items: sum(1 for item in items if item["status"] in ALLOCATABLE_STATUSES)  # noqa: E731
    calc = calculate(tractors=working(tractors), trucks=working(trucks), flow_m3_ha=flow, radius_km=radius,
                     tratos=orders["tratos"], round_trip=bool(plan.get("round_trip")), **params)
    return {
        "service_front_id": front_id, "item_id": int(entry["item_id"]), "name": entry["front_name"],
        "sector": entry["sector"], "section": entry.get("section") or "",
        # Fazenda: a do lançamento; sem ela, a do raio do setor ou a da base de setores.
        "farm": entry.get("farm") or (sector_place(conn, entry["sector"], base)["farm"] if entry["sector"] else ""),
        "status": entry.get("status") or "", "operation": entry.get("operation") or "",
        "is_current_day": entry["work_date"] == selected_date,
        "orders": orders, "base_options": bases, "base": base,
        "flow_m3_ha": flow, "flow_source": _source(plan.get("flow_m3_ha"), flow, "O.S."),
        "radius_km": radius, "radius_source": "tabela" if radius is not None else "",
        "params": {**params, "round_trip": bool(plan.get("round_trip")), "gas_pct_per_trip": plan.get("gas_pct_per_trip")},
        "gas_pct_per_trip": gas_pct_per_trip(radius, plan.get("gas_pct_per_trip")),
        "gas_source": "plano" if plan.get("gas_pct_per_trip") is not None else ("raio" if radius else ""),
        "spacing": spacing, "ha_mode": plan.get("ha_mode") or "typed",
        "application_speed": speed, "ha_per_hour_speed": speed_ha_h,
        "tractors": [item["id"] for item in tractors], "trucks": [item["id"] for item in trucks],
        "plan_date": plan.get("work_date"), "plan_carried": bool(plan.get("carried")),
        "plan_updated_by": plan.get("updated_by", ""), "plan_updated_at": plan.get("updated_at", 0),
        "calc": calc,
    }


def _locate(equipment: list[dict[str, Any]], fronts: list[dict[str, Any]]) -> None:
    """Onde está cada equipamento hoje e, no CV a gás, quantas viagens ainda faz no raio da frente."""
    location = {}
    for front in fronts:
        for item_id in front["tractors"] + front["trucks"]:
            location[item_id] = {"front_id": front["service_front_id"], "front": front["name"],
                                 "recommendation": front["orders"]["recommendation"],
                                 "gas_pct_per_trip": front["gas_pct_per_trip"]}
    for item in equipment:
        item["front"] = location.get(item["id"])
        item["gas_trips"] = (gas_trips(item["gas_level_pct"], item["front"]["gas_pct_per_trip"])
                             if item["fuel"] == "gas" and item["front"] else None)


def fert_overview(user_id: int, unit_code: Any, work_date: Any) -> dict[str, Any]:
    """Painel da fertirrigação: frentes, dimensionamento, frota, recomendações e movimentações."""
    unit = fert_unit(unit_code)
    selected_date = _normalize_work_date(work_date)
    with connection() as conn:
        access = _require_access(conn, user_id, unit=unit)
        equipment = unit_equipment(conn, unit)
        by_id = {item["id"]: item for item in equipment}
        plans = read_plans(conn, unit, selected_date)
        book = OrderBook(conn)
        fronts = []
        for front_id, entry in sorted(fert_items(conn, unit, selected_date).items(),
                                      key=lambda pair: natural_key(pair[1]["front_name"])):
            operations = front_operations(entry)
            orders = book.details(entry["sector"], entry.get("section") or "", operations)
            front = _front(conn, unit, selected_date, front_id, entry, plans.get(front_id, {}), orders, by_id)
            front["fert_operations"] = operations
            fronts.append(front)
        _locate(equipment, fronts)
        fleet = {kind: {status: sum(1 for item in equipment if item["kind"] == kind and item["status"] == status)
                        for status in EQUIPMENT_STATUSES} for kind in EQUIPMENT_KINDS}
        events = [dict(row) for row in conn.execute(
            """SELECT ev.prefix,ev.kind,ev.action,ev.detail,ev.created_at,COALESCE(u.name,'') AS user
               FROM production_fert_events ev LEFT JOIN auth.users u ON u.id=ev.created_by
               WHERE ev.unit_code=? AND ev.work_date=? ORDER BY ev.id DESC LIMIT 60""",
            (unit, selected_date),
        )]
        week = week_plan(conn, unit, selected_date, fronts, plans, book)
        radius_count = conn.execute("SELECT COUNT(DISTINCT sector_key), MAX(imported_at) FROM production_fert_radius").fetchone()
    return {
        "unit": unit, "work_date": selected_date, "fronts": fronts, "totals": totals(fronts),
        "equipment": equipment, "fleet": fleet, "events": events, "defaults": DEFAULTS, "week": week,
        "spacings": SPACINGS, "statuses": EQUIPMENT_STATUSES, "allocatable": sorted(ALLOCATABLE_STATUSES),
        "radius": {"sectors": int(radius_count[0] or 0), "imported_at": int(radius_count[1] or 0)},
        "permissions": {"edit": bool(access["can_fill"]), "configure": bool(access["can_configure"])},
    }
