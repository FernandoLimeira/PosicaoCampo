"""Fertirrigação: gravação do plano do dia da frente (base, parâmetros, tratores e CVs).

Equipamento que está em outra frente muda de frente aqui mesmo (o analista não precisa tirar de
lá antes). O CV só muda se a recomendação de produtos das duas frentes for a mesma; trator muda
livre. Frente que não está mais com 509/524 no dia não segura equipamento: ele sai do plano
antigo dela sem conferência (a tela mostra esse equipamento como disponível).
"""
from __future__ import annotations

import sqlite3
from typing import Any

from ....services.fert_dimensioning import SPACINGS, clean_params
from ...storage import connection, validate_actor
from ..access import _require_access
from ..common import _clean_text, _normalize_work_date
from .common import (
    ALLOCATABLE_STATUSES, EQUIPMENT_KINDS, EQUIPMENT_STATUSES, MAX_EQUIPMENT, fert_unit, front_names, log_event,
    parse_front_id, require_unit_front, set_status, unit_equipment,
)
from .sources import OrderBook, fert_items, front_operations, plan_equipment, read_plans, without_equipment, write_plan


def _ids(value: Any, field: str) -> list[int]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_EQUIPMENT:
        raise ValueError(f"Lista de {field} inválida.")
    ids = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, int) or item <= 0:
            raise ValueError(f"Lista de {field} inválida.")
        if item not in ids:
            ids.append(item)
    return ids


def _clean_plan(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Plano inválido.")
    raw = payload.get("params") or {}
    if not isinstance(raw, dict):
        raise ValueError("Parâmetros inválidos.")
    spacing = raw.get("spacing") or "simples"
    ha_mode = raw.get("ha_mode") or "typed"
    if spacing not in SPACINGS or ha_mode not in {"typed", "speed"}:
        raise ValueError("Espaçamento ou modo do ha/hora inválido.")
    stored = {key: value for key, value in clean_params(raw).items() if value is not None}
    stored.update({"base": _clean_text(raw.get("base"), "a base", 60), "round_trip": raw.get("round_trip") is True,
                   "spacing": spacing, "ha_mode": ha_mode,
                   "tractors": _ids(payload.get("tractors"), "tratores"), "trucks": _ids(payload.get("trucks"), "CVs")})
    return {"unit": fert_unit(payload.get("unit_code")), "work_date": _normalize_work_date(payload.get("work_date")),
            "front": parse_front_id(payload.get("service_front_id")), "plan": stored}


class _Move:
    """Conferência da troca de frente de um CV (mesma recomendação de produtos)."""

    def __init__(self, conn: sqlite3.Connection, unit: str, work_date: str, names: dict[int, str]):
        self.items = fert_items(conn, unit, work_date)
        self.book = OrderBook(conn, unit)
        self.names = names

    def recommendation(self, front: int) -> dict[str, Any] | None:
        entry = self.items.get(front)
        if not entry:
            return None
        return self.book.details(entry["sector"], entry.get("section") or "", front_operations(entry))

    def check_truck(self, item: dict[str, Any], owner: int, target: int) -> None:
        mine, theirs = self.recommendation(target), self.recommendation(owner)
        key_mine = (mine or {}).get("recommendation_key", "")
        key_theirs = (theirs or {}).get("recommendation_key", "")
        if not key_mine or not key_theirs:
            raise ValueError(f"CV {item['prefix']} está na {self.names.get(owner, owner)}: sem a recomendação de "
                             "produtos na O.S. das duas frentes não dá para conferir a troca.")
        if key_mine != key_theirs:
            raise ValueError(f"CV {item['prefix']} não pode ir da {self.names.get(owner, owner)} para a "
                             f"{self.names.get(target, target)}: a recomendação é diferente "
                             f"({' + '.join(theirs['recommendation'])} × {' + '.join(mine['recommendation'])}).")


def save_fert_plan(user_id: int, payload: Any) -> dict[str, Any]:
    """Grava o plano do dia da frente, com as trocas de frente e o histórico."""
    clean = _clean_plan(payload)
    unit, work_date, front, stored = clean["unit"], clean["work_date"], clean["front"], clean["plan"]
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_access(conn, user_id, permission="fill", unit=unit)
        validate_actor(conn, user_id)
        require_unit_front(conn, front, unit)
        names = front_names(conn)
        equipment = {item["id"]: item for item in unit_equipment(conn, unit)}
        plans = read_plans(conn, unit, work_date)
        move = _Move(conn, unit, work_date, names)
        previous = set(plan_equipment(plans.get(front, {})))
        taken_from: dict[int, set[int]] = {}
        moved: set[int] = set()
        for ids, kind in ((stored["tractors"], "tractor"), (stored["trucks"], "truck")):
            for item_id in ids:
                item = equipment.get(item_id)
                if not item or item["kind"] != kind:
                    raise ValueError("Equipamento não encontrado na frota da unidade.")
                if item_id not in previous and item["status"] not in ALLOCATABLE_STATUSES:
                    raise ValueError(f"{EQUIPMENT_KINDS[kind]} {item['prefix']} está em "
                                     f"{EQUIPMENT_STATUSES[item['status']].lower()}: mude a situação antes.")
                for owner, plan in plans.items():
                    if owner == front or item_id not in plan_equipment(plan):
                        continue
                    if owner in move.items:  # frente com fertirrigação no dia: troca de frente conferida
                        if kind == "truck":
                            move.check_truck(item, owner, front)
                        moved.add(item_id)
                    taken_from.setdefault(owner, set()).add(item_id)
        # Tira da frente de origem (no plano do dia) o que veio para esta.
        for owner, ids in taken_from.items():
            write_plan(conn, unit, work_date, owner, without_equipment(plans[owner], ids), user_id)
            for item_id in ids & moved:
                log_event(conn, unit, work_date, user_id, equipment[item_id], "move",
                          f"{names.get(owner, owner)} → {names.get(front, front)}")
        selected = set(stored["tractors"]) | set(stored["trucks"])
        for item_id in selected - previous - moved:
            log_event(conn, unit, work_date, user_id, equipment[item_id], "allocate", f"Alocado na {names.get(front, front)}")
        for item_id in previous - selected:
            if item_id in equipment:
                log_event(conn, unit, work_date, user_id, equipment[item_id], "release", f"Saiu da {names.get(front, front)}")
                if equipment[item_id]["status"] == "active":
                    set_status(conn, equipment[item_id], "available", user_id)
        for item_id in selected:
            if equipment[item_id]["status"] == "available":
                set_status(conn, equipment[item_id], "active", user_id)
        write_plan(conn, unit, work_date, front, stored, user_id)
    return {"ok": True, "moved": len(moved)}
