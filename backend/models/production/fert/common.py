"""Fertirrigação: constantes, unidade, frota e histórico de movimentações."""
from __future__ import annotations

import sqlite3
import time
from datetime import datetime
from typing import Any

from ....services.fert_dimensioning import DEFAULTS, application_speed, ha_per_hour_from_speed
from ....services.front_identifiers import natural_key, normalize_label
from ....services.operational_shifts import FIELD_TIMEZONE
from ..common import _normalize_unit

FERT_UNITS = ("PPT", "NRD")
FERT_OPERATIONS = frozenset({"509", "524"})
EQUIPMENT_KINDS = {"tractor": "Trator", "truck": "CV"}
FUELS = {"diesel": "Diesel", "gas": "Gás"}
EQUIPMENT_STATUSES = {
    "active": "Operando", "available": "Disponível", "workshop": "Oficina",
    "no_driver": "Sem motorista", "support": "Apoio", "inactive": "Inativo",
}
ALLOCATABLE_STATUSES = frozenset({"active", "available"})
# Bases de carregamento de cada unidade (aba BASE GERAL da planilha).
FERT_BASES = {"PPT": ("USINA", "RAPOSO"), "NRD": ("SANTA CRUZ", "BIÉ", "CASA BRANCA")}
MAX_EQUIPMENT = 300

_EQUIPMENT_SELECT = """SELECT e.*, u.name AS changed_by_name, g.name AS gas_by_name FROM production_fert_equipment e
    LEFT JOIN auth.users u ON u.id=e.status_changed_by
    LEFT JOIN auth.users g ON g.id=e.gas_updated_by"""


def fert_unit(unit_code: Any) -> str:
    unit = _normalize_unit(unit_code)
    if unit not in FERT_UNITS:
        raise ValueError("A fertirrigação está disponível para o Polo SP (PPT e NRD).")
    return unit


def today() -> str:
    return datetime.now(FIELD_TIMEZONE).date().isoformat()


def base_key(name: Any) -> str:
    """Mesma base escrita de jeitos diferentes: "BASE STA CRUZ", "Santa Cruz", "BIE"/"BIÉ"."""
    text = normalize_label(name).upper()
    if text.startswith("BASE "):
        text = text[len("BASE "):]
    return text.replace("STA ", "SANTA ").replace("STO ", "SANTO ").strip()


def parse_front_id(value: Any) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Frente inválida.") from exc
    if isinstance(value, bool) or number <= 0:
        raise ValueError("Frente inválida.")
    return number


def require_unit_front(conn: sqlite3.Connection, front: int, unit: str) -> None:
    if not conn.execute("SELECT 1 FROM production_service_front_units WHERE service_front_id=? AND unit_code=?",
                        (front, unit)).fetchone():
        raise ValueError("Frente não encontrada nesta unidade.")


def front_names(conn: sqlite3.Connection) -> dict[int, str]:
    return dict(conn.execute("SELECT id,name FROM production_service_fronts").fetchall())


def log_event(conn: sqlite3.Connection, unit: str, work_date: str, user_id: int, equipment: dict[str, Any] | None,
              action: str, detail: str) -> None:
    conn.execute(
        """INSERT INTO production_fert_events(unit_code,work_date,equipment_id,prefix,kind,action,detail,created_by,created_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (unit, work_date, equipment["id"] if equipment else None, equipment["prefix"] if equipment else "",
         equipment["kind"] if equipment else "", action, detail[:300], user_id, int(time.time())),
    )


def equipment_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]), "kind": row["kind"], "prefix": row["prefix"],
        "capacity_m3": row["capacity_m3"], "status": row["status"], "notes": row["notes"] or "",
        "status_changed_at": int(row["status_changed_at"] or 0), "status_changed_by": row["changed_by_name"],
        "fuel": row["fuel"] or "diesel", "gas_level_pct": row["gas_level_pct"],
        "gas_updated_at": int(row["gas_updated_at"] or 0), "gas_updated_by": row["gas_by_name"],
    }


def unit_equipment(conn: sqlite3.Connection, unit: str) -> list[dict[str, Any]]:
    items = [equipment_payload(row) for row in conn.execute(f"{_EQUIPMENT_SELECT} WHERE e.unit_code=?", (unit,))]
    items.sort(key=lambda item: (item["kind"], natural_key(item["prefix"])))
    return items


def one_equipment(conn: sqlite3.Connection, equipment_id: int) -> dict[str, Any]:
    return equipment_payload(conn.execute(f"{_EQUIPMENT_SELECT} WHERE e.id=?", (equipment_id,)).fetchone())


def set_status(conn: sqlite3.Connection, item: dict[str, Any], status: str, user_id: int) -> None:
    now = int(time.time())
    conn.execute(
        """UPDATE production_fert_equipment SET status=?,status_changed_by=?,status_changed_at=?,updated_by=?,updated_at=?
           WHERE id=?""",
        (status, user_id, now, user_id, now, item["id"]),
    )
    item["status"] = status


def speed_yield(plan: dict[str, Any], flow: float | None) -> tuple[str, float | None, float | None]:
    """Espaçamento da frente, velocidade de aplicação pela vazão (BASE GERAL) e o ha/hora que
    ela dá (velocidade × entrelinha × seções ÷ 10)."""
    spacing = plan.get("spacing") or "simples"
    speed = application_speed(flow)
    return spacing, speed, ha_per_hour_from_speed(speed, spacing)


def plan_params(plan: dict[str, Any], flow: float | None) -> tuple[dict[str, Any], str, float | None, float | None]:
    """Parâmetros da conta do plano (em branco = padrão), com o ha/hora pela velocidade se escolhido."""
    params = {key: plan.get(key) for key in DEFAULTS}
    spacing, speed, speed_ha_h = speed_yield(plan, flow)
    if plan.get("ha_mode") == "speed" and speed_ha_h is not None:
        params["ha_per_hour"] = speed_ha_h
    return params, spacing, speed, speed_ha_h
