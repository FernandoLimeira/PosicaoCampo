"""Fertirrigação: o que vem de fora do plano.

- lançamento do dia de cada frente (setor, seção, status e operação 509/524);
- O.S. do PIMS do setor: vazão (produto em m³), recomendação de produtos, tratos e talhões;
- raio setor × base de carregamento;
- planos gravados (o do dia ou, sem ele, o último salvo de cada frente).
"""
from __future__ import annotations

import json
import sqlite3
import time
from typing import Any

from ....services.front_identifiers import natural_key, normalize_label
from .common import FERT_BASES, FERT_OPERATIONS, base_key

_PLAN_META = frozenset({"work_date", "carried", "updated_at", "updated_by"})


def _keys():
    # Import local: service_orders importa o pacote production.
    from ...service_orders import operation_keys, sector_key
    return operation_keys, sector_key


def front_operations(entry: dict[str, Any]) -> list[str]:
    """Operações de fertirrigação lançadas na frente (509, 524 ou as duas)."""
    operation_keys, _ = _keys()
    return [key for key in operation_keys(entry.get("operation")) if key in FERT_OPERATIONS]


def fert_items(conn: sqlite3.Connection, unit: str, work_date: str) -> dict[int, dict[str, Any]]:
    """Último lançamento de cada frente com operação 509/524 até o dia (setor, status, operação)."""
    fronts: dict[int, dict[str, Any]] = {}
    for row in conn.execute(
        """SELECT e.*, f.name AS front_name, ui.id AS item_id FROM production_user_items ui
           JOIN production_daily_entries e ON e.id=(
             SELECT latest.id FROM production_daily_entries latest
             WHERE latest.user_item_id=ui.id AND latest.work_date<=?
             ORDER BY latest.work_date DESC, latest.updated_at DESC, latest.id DESC LIMIT 1)
           JOIN production_service_fronts f ON f.id=ui.service_front_id
           WHERE ui.unit_code=? AND ui.is_active=1""",
        (work_date, unit),
    ):
        entry = dict(row)
        if not entry["sector"] or not front_operations(entry):
            continue
        current = fronts.get(int(entry["service_front_id"]))
        key = (entry["work_date"], entry["updated_at"] or 0)
        if not current or key > (current["work_date"], current["updated_at"] or 0):
            fronts[int(entry["service_front_id"])] = entry
    return fronts


class OrderBook:
    """Leitura das O.S. de fertirrigação de uma unidade, com cache por setor/seção/operação
    (o painel e a semana pedem o mesmo setor várias vezes na mesma requisição)."""

    def __init__(self, conn: sqlite3.Connection, unit: str):
        self.conn, self.unit, self._cache = conn, unit, {}

    def details(self, sector: str, section: str = "", operations: list[str] | tuple[str, ...] = ()) -> dict[str, Any]:
        _, sector_key = _keys()
        cache_key = (sector_key(sector), sector_key(section), tuple(operations))
        if cache_key not in self._cache:
            self._cache[cache_key] = self._load(sector, section, operations)
        return self._cache[cache_key]

    def _load(self, sector: str, section: str, operations) -> dict[str, Any]:
        _, sector_key = _keys()
        rows = [row for row in self.conn.execute(
            """SELECT id,order_number,section,operation_key,plots FROM production_service_orders
               WHERE unit_code=? AND sector_key=? AND operation_key IN ('509','524')
               ORDER BY opened_on DESC, id DESC""",
            (self.unit, sector_key(sector)),
        ) if not section or not row["section"] or sector_key(row["section"]) == sector_key(section)]
        # A recomendação é a da O.S. da mesma operação da frente (509 ou 524); sem ela, a de qualquer
        # operação de fertirrigação. Entre as O.S., a mais recente (a que está sendo aplicada).
        same = [row for row in rows if row["operation_key"] in operations]
        rows = same or rows
        detail: dict[str, Any] = {"orders": [], "flow_m3_ha": None, "flow_label": "", "products": [],
                                  "recommendation": [], "recommendation_key": "", "tratos": "", "plots": []}
        plots: list[str] = []
        for row in rows:
            if row["order_number"] not in detail["orders"]:
                detail["orders"].append(row["order_number"])
            for plot in (row["plots"] or "").split(","):
                if plot and plot not in plots:
                    plots.append(plot)
        detail["plots"] = sorted(plots, key=natural_key)
        if rows:
            found = self.conn.execute("SELECT details_json FROM production_service_orders WHERE id=?",
                                      (rows[0]["id"],)).fetchone()
            _apply_components(detail, json.loads(found["details_json"] or "{}").get("rows", []))
        return detail


def _apply_components(detail: dict[str, Any], lines: list[dict[str, Any]]) -> None:
    """Componentes da O.S. (uma linha por talhão × componente): produto, quantidade e unidade."""
    components: dict[str, tuple[str, float, str]] = {}
    for line in lines:
        unit = str(line.get("CD_UNIMED", "")).strip().upper()
        name = str(line.get("DE_COMPO", "")).strip()
        quantity = str(line.get("QT_RECURSO", "")).strip().replace(",", ".")
        if not detail["tratos"] and line.get("CCUSTO_TRATOS"):
            detail["tratos"] = str(line["CCUSTO_TRATOS"]).strip()
        try:
            amount = float(quantity)
        except ValueError:
            continue
        if name and unit:
            components.setdefault(normalize_label(name).upper(), (name, amount, unit))
    for name, amount, unit in components.values():
        label = f"{name} = {amount:g} {unit}"
        detail["recommendation"].append(label)
        if unit == "M3" and detail["flow_m3_ha"] is None:
            detail["flow_m3_ha"], detail["flow_label"] = amount, name
        elif unit != "M3":
            detail["products"].append(label)
    detail["recommendation"].sort()
    detail["recommendation_key"] = "|".join(
        f"{normalize_label(name).upper()}={amount:g}{unit}" for name, amount, unit in sorted(components.values()))


def base_options(conn: sqlite3.Connection, unit: str, sector: str) -> list[dict[str, Any]]:
    """Bases da unidade e as do raio importado para o setor, com o raio de cada uma."""
    _, sector_key = _keys()
    rows = conn.execute("SELECT base,radius_km FROM production_fert_radius WHERE sector_key=?",
                        (sector_key(sector),)).fetchall()
    radius = {base_key(row["base"]): row["radius_km"] for row in rows}
    names = {base_key(name): name for name in FERT_BASES.get(unit, ())}
    for row in rows:
        names.setdefault(base_key(row["base"]), row["base"])
    options = [{"base": name, "radius_km": radius.get(key)} for key, name in names.items()]
    options.sort(key=lambda item: (item["radius_km"] is None, item["radius_km"] or 0, item["base"]))
    return options


def sector_place(conn: sqlite3.Connection, sector: str, base: str) -> dict[str, Any]:
    """Fazenda e raio de um setor para a base da frente (sem a base na tabela, o menor raio)."""
    _, sector_key = _keys()
    rows = conn.execute("SELECT base,radius_km,farm FROM production_fert_radius WHERE sector_key=? ORDER BY radius_km",
                        (sector_key(sector),)).fetchall()
    chosen = next((row for row in rows if base_key(row["base"]) == base_key(base)), rows[0] if rows else None)
    farm = chosen["farm"] if chosen and chosen["farm"] else ""
    if not farm:
        found = conn.execute("SELECT description FROM sector_base WHERE sector=? COLLATE NOCASE LIMIT 1", (sector,)).fetchone()
        farm = found["description"] if found and found["description"] else ""
    return {"farm": farm, "radius_km": chosen["radius_km"] if chosen else None, "base": chosen["base"] if chosen else ""}


def read_plans(conn: sqlite3.Connection, unit: str, work_date: str) -> dict[int, dict[str, Any]]:
    """Plano do dia de cada frente ou, sem ele, o último salvo (marcado como copiado)."""
    plans: dict[int, dict[str, Any]] = {}
    for row in conn.execute(
        """SELECT p.*, u.name AS updated_by_name FROM production_fert_plans p
           JOIN (SELECT service_front_id, MAX(work_date) AS work_date FROM production_fert_plans
                 WHERE unit_code=? AND work_date<=? GROUP BY service_front_id) latest
             ON latest.service_front_id=p.service_front_id AND latest.work_date=p.work_date
           LEFT JOIN auth.users u ON u.id=p.updated_by
           WHERE p.unit_code=?""",
        (unit, work_date, unit),
    ):
        plans[int(row["service_front_id"])] = {
            **json.loads(row["params_json"] or "{}"), "work_date": row["work_date"],
            "carried": row["work_date"] != work_date,
            "updated_at": int(row["updated_at"] or 0), "updated_by": row["updated_by_name"] or "",
        }
    return plans


def write_plan(conn: sqlite3.Connection, unit: str, work_date: str, front: int, plan: dict[str, Any],
               user_id: int) -> None:
    stored = {key: value for key, value in plan.items() if key not in _PLAN_META and value is not None}
    conn.execute(
        """INSERT INTO production_fert_plans(unit_code,work_date,service_front_id,params_json,updated_by,updated_at)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(unit_code,work_date,service_front_id) DO UPDATE SET
             params_json=excluded.params_json, updated_by=excluded.updated_by, updated_at=excluded.updated_at""",
        (unit, work_date, front, json.dumps(stored), user_id, int(time.time())),
    )


def plan_equipment(plan: dict[str, Any]) -> list[int]:
    return list(plan.get("tractors", [])) + list(plan.get("trucks", []))


def without_equipment(plan: dict[str, Any], ids: set[int]) -> dict[str, Any]:
    result = dict(plan)
    result["tractors"] = [i for i in plan.get("tractors", []) if i not in ids]
    result["trucks"] = [i for i in plan.get("trucks", []) if i not in ids]
    return result
