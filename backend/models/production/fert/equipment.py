"""Fertirrigação: frota da unidade (cadastro, situação e gás dos CVs)."""
from __future__ import annotations

import sqlite3
import time
from typing import Any

from ....services.fert_dimensioning import clean_params
from ...storage import connection, validate_actor
from ..access import _require_access
from ..common import _clean_text, _normalize_work_date
from .common import (
    ALLOCATABLE_STATUSES, EQUIPMENT_KINDS, EQUIPMENT_STATUSES, FUELS, MAX_EQUIPMENT, fert_unit, front_names,
    log_event, one_equipment, today,
)
from .sources import plan_equipment, read_plans, without_equipment, write_plan

_UNSET = object()


def _gas_level(payload: dict[str, Any]) -> Any:
    """% de gás do tanque: _UNSET quando não veio no envio (mantém o gravado)."""
    if "gas_level_pct" not in payload:
        return _UNSET
    raw = payload.get("gas_level_pct")
    if raw in (None, ""):
        return None
    message = "Informe o gás em % do tanque (0 a 100)."
    if isinstance(raw, bool):
        raise ValueError(message)
    try:
        level = float(str(raw).replace(",", ".").replace("%", ""))
    except (TypeError, ValueError) as exc:
        raise ValueError(message) from exc
    if not 0 <= level <= 100:
        raise ValueError(message)
    return level


def _clean_equipment(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Equipamento inválido.")
    kind = payload.get("kind")
    if kind not in EQUIPMENT_KINDS:
        raise ValueError("Escolha trator ou CV.")
    status = payload.get("status") or "available"
    if status not in EQUIPMENT_STATUSES:
        raise ValueError("Situação inválida.")
    fuel = payload.get("fuel")
    if fuel is not None and fuel not in FUELS:
        raise ValueError("Combustível inválido.")
    capacity = None
    if kind == "truck" and payload.get("capacity_m3") not in (None, ""):
        capacity = clean_params({"capacity_m3": payload.get("capacity_m3")})["capacity_m3"]
    return {
        "unit": fert_unit(payload.get("unit_code")), "kind": kind, "status": status, "fuel": fuel, "capacity": capacity,
        "prefix": _clean_text(payload.get("prefix"), "o prefixo", 20, required=True),
        "notes": _clean_text(payload.get("notes"), "a observação", 120), "gas": _gas_level(payload),
        "work_date": _normalize_work_date(payload.get("work_date") or today()),
    }


def _create(conn: sqlite3.Connection, data: dict[str, Any], user_id: int, now: int) -> int:
    unit = data["unit"]
    if conn.execute("SELECT COUNT(*) FROM production_fert_equipment WHERE unit_code=?", (unit,)).fetchone()[0] >= MAX_EQUIPMENT:
        raise ValueError("Limite de equipamentos da unidade atingido.")
    fuel = data["fuel"] or "diesel"
    gas = data["gas"] if fuel == "gas" and data["gas"] is not _UNSET else None
    equipment_id = int(conn.execute(
        """INSERT INTO production_fert_equipment(unit_code,kind,prefix,capacity_m3,status,notes,fuel,gas_level_pct,
               gas_updated_by,gas_updated_at,status_changed_by,status_changed_at,created_by,updated_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (unit, data["kind"], data["prefix"], data["capacity"], data["status"], data["notes"], fuel, gas,
         user_id if gas is not None else None, now if gas is not None else None,
         user_id, now, user_id, user_id, now, now),
    ).lastrowid)
    log_event(conn, unit, data["work_date"], user_id, {"id": equipment_id, "prefix": data["prefix"], "kind": data["kind"]},
              "create", f"Cadastrado ({EQUIPMENT_STATUSES[data['status']].lower()})")
    return equipment_id


def _release_from_plans(conn: sqlite3.Connection, unit: str, work_date: str, item: dict[str, Any], status: str,
                        user_id: int) -> None:
    """Equipamento que foi para oficina, sem motorista, apoio ou inativo sai da frente do dia."""
    names = front_names(conn)
    for front, plan in read_plans(conn, unit, work_date).items():
        if item["id"] in plan_equipment(plan):
            write_plan(conn, unit, work_date, front, without_equipment(plan, {item["id"]}), user_id)
            log_event(conn, unit, work_date, user_id, item, "release",
                      f"Saiu da {names.get(front, front)} ({EQUIPMENT_STATUSES[status].lower()})")


def _update(conn: sqlite3.Connection, data: dict[str, Any], equipment_id: int, user_id: int, now: int) -> None:
    unit, status = data["unit"], data["status"]
    before = conn.execute("SELECT * FROM production_fert_equipment WHERE id=? AND unit_code=?",
                          (equipment_id, unit)).fetchone()
    if not before:
        raise ValueError("Equipamento não encontrado nesta unidade.")
    changed = before["status"] != status
    # Sem combustível/gás no envio, mantém o que já estava gravado.
    fuel = data["fuel"] or before["fuel"] or "diesel"
    gas = before["gas_level_pct"] if data["gas"] is _UNSET else data["gas"]
    if fuel != "gas":
        gas = None
    gas_changed = gas != before["gas_level_pct"]
    conn.execute(
        """UPDATE production_fert_equipment SET kind=?,prefix=?,capacity_m3=?,status=?,notes=?,fuel=?,gas_level_pct=?,
               updated_by=?,updated_at=?,
               gas_updated_by=CASE WHEN ? THEN ? ELSE gas_updated_by END,
               gas_updated_at=CASE WHEN ? THEN ? ELSE gas_updated_at END,
               status_changed_by=CASE WHEN ? THEN ? ELSE status_changed_by END,
               status_changed_at=CASE WHEN ? THEN ? ELSE status_changed_at END
           WHERE id=? AND unit_code=?""",
        (data["kind"], data["prefix"], data["capacity"], status, data["notes"], fuel, gas, user_id, now,
         gas_changed, user_id, gas_changed, now, changed, user_id, changed, now, equipment_id, unit),
    )
    item = {"id": equipment_id, "prefix": data["prefix"], "kind": data["kind"]}
    if gas_changed and gas is not None:
        previous = before["gas_level_pct"]
        log_event(conn, unit, data["work_date"], user_id, item, "gas",
                  f"Gás {'' if previous is None else f'{previous:g}% → '}{gas:g}%")
    if changed:
        detail = f"{EQUIPMENT_STATUSES[before['status']]} → {EQUIPMENT_STATUSES[status]}"
        log_event(conn, unit, data["work_date"], user_id, item, "status", f"{detail} · {data['notes']}" if data["notes"] else detail)
        if status not in ALLOCATABLE_STATUSES:
            _release_from_plans(conn, unit, data["work_date"], item, status, user_id)


def save_fert_equipment(user_id: int, payload: Any, *, equipment_id: int | None = None) -> dict[str, Any]:
    """Cadastro e situação do equipamento (com o histórico de quem mudou e quando)."""
    data = _clean_equipment(payload)
    now = int(time.time())
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_access(conn, user_id, permission="fill", unit=data["unit"])
        validate_actor(conn, user_id)
        try:
            if equipment_id is None:
                equipment_id = _create(conn, data, user_id, now)
            else:
                _update(conn, data, equipment_id, user_id, now)
        except sqlite3.IntegrityError as exc:
            raise ValueError(f"O {EQUIPMENT_KINDS[data['kind']]} {data['prefix']} já está cadastrado nesta unidade.") from exc
        return one_equipment(conn, equipment_id)


def delete_fert_equipment(user_id: int, unit_code: Any, equipment_id: int) -> None:
    unit = fert_unit(unit_code)
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_access(conn, user_id, permission="fill", unit=unit)
        validate_actor(conn, user_id)
        row = conn.execute("SELECT * FROM production_fert_equipment WHERE id=? AND unit_code=?",
                           (equipment_id, unit)).fetchone()
        if not row:
            raise ValueError("Equipamento não encontrado nesta unidade.")
        conn.execute("DELETE FROM production_fert_equipment WHERE id=?", (equipment_id,))
        log_event(conn, unit, today(), user_id, {"id": equipment_id, "prefix": row["prefix"], "kind": row["kind"]},
                  "delete", "Excluído da frota")
