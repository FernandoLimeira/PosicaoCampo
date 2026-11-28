"""Fertirrigação: o que vem de fora do plano.

- lançamento do dia de cada frente (setor, seção, status e operação 509/524);
- O.S. do PIMS do setor: vazão (produto em m³), recomendação de produtos, tratos e talhões;
- raio setor × base de carregamento;
- planos gravados (o do dia ou, sem ele, o último salvo de cada frente).
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from typing import Any

from ....services.front_identifiers import natural_key, normalize_label
from .common import FERT_BASES, FERT_OPERATIONS, base_key

_PLAN_META = frozenset({"work_date", "carried", "updated_at", "updated_by", "version"})


def _keys():
    # Import local: service_orders importa o pacote production.
    from ...service_orders import operation_keys, sector_key
    return operation_keys, sector_key


def _fert_keys(value: Any) -> tuple[list[str], bool]:
    """Operações 509/524 do texto e se havia alguma operação (de qualquer tipo)."""
    operation_keys, _ = _keys()
    keys = operation_keys(value)
    return [key for key in keys if key in FERT_OPERATIONS], bool(keys)


def front_operations(entry: dict[str, Any]) -> list[str]:
    """Operações de fertirrigação da frente (509, 524 ou as duas): as lançadas no dia ou, sem
    elas, as operações padrão da frente no cadastro."""
    return list(entry.get("fert_operations") or [])


def _is_fert_group(name: Any) -> bool:
    return "FERTIRRIG" in normalize_label(name).upper()


def fert_items(conn: sqlite3.Connection, unit: str, work_date: str) -> dict[int, dict[str, Any]]:
    """Frentes da fertirrigação, as mesmas da Posição de Campo da Produção: cada item ativo da
    unidade com o último lançamento até o dia (setor, seção, status e operação). Entra a frente que
    lançou 509/524 ou que tem 509/524 como operação padrão. O grupo "Fertirrigação" só puxa a frente
    sem nenhuma operação (lançada ou padrão): a Fert convencional (346/342) fica no mesmo grupo e
    não usa CVs."""
    items = conn.execute(
        """SELECT ui.id AS item_id, ui.service_front_id AS front_id, f.name AS front_name,
                  f.default_operations, g.name AS group_name
           FROM production_user_items ui
           JOIN production_service_fronts f ON f.id=ui.service_front_id
           JOIN production_groups g ON g.id=f.group_id
           WHERE ui.unit_code=? AND ui.is_active=1""",
        (unit,),
    ).fetchall()
    latest = {row["user_item_id"]: dict(row) for row in conn.execute(
        """SELECT entry.* FROM production_daily_entries entry
           JOIN (SELECT user_item_id, MAX(work_date) AS work_date FROM production_daily_entries
                 WHERE unit_code=? AND work_date<=? AND user_item_id IS NOT NULL GROUP BY user_item_id) newest
             ON newest.user_item_id=entry.user_item_id AND newest.work_date=entry.work_date
           WHERE entry.unit_code=?""",
        (unit, work_date, unit),
    )}
    fronts: dict[int, dict[str, Any]] = {}

    def rank(front):
        return front["work_date"], front["updated_at"], front.get("id") or 0

    for item in items:
        entry = latest.get(item["item_id"]) or {}
        launched, launched_any = _fert_keys(entry.get("operation"))
        default, default_any = _fert_keys(item["default_operations"])
        operations = launched or (default if not launched_any else [])
        if not operations and (launched_any or default_any or not _is_fert_group(item["group_name"])):
            continue
        front = {**entry, "item_id": item["item_id"], "service_front_id": item["front_id"],
                 "front_name": item["front_name"], "fert_operations": operations,
                 "sector": entry.get("sector") or "", "work_date": entry.get("work_date") or "",
                 "updated_at": entry.get("updated_at") or 0}
        current = fronts.get(item["front_id"])
        if not current or rank(front) > rank(current):
            fronts[item["front_id"]] = front
    return fronts


def _empty_detail() -> dict[str, Any]:
    return {"order": "", "orders": [], "options": [], "opened_on": "", "flow_m3_ha": None,
            "recommendation": [], "recommendation_key": "", "tratos": "", "plots": []}


class OrderBook:
    """Leitura das O.S. de fertirrigação, com cache por setor/seção/operação/O.S. (o painel e a
    semana pedem o mesmo setor várias vezes na mesma requisição). A base de O.S. é uma só para todas
    as unidades (cada importação substitui a base inteira), como na conferência da Produção.

    Um setor pode ter várias O.S. de fertirrigação abertas, cada uma com seus talhões e sua
    recomendação (como na planilha, onde a O.S. é escolhida por frente). A frente usa a O.S.
    escolhida no plano; sem escolha (ou se ela não está mais aberta), a mais recente da mesma
    operação da frente (509 ou 524) ou, sem ela, de qualquer operação de fertirrigação."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn, self._cache = conn, {}

    def details(self, sector: str, section: str = "", operations: list[str] | tuple[str, ...] = (),
                order: str = "") -> dict[str, Any]:
        _, sector_key = _keys()
        cache_key = (sector_key(sector), sector_key(section), tuple(operations), str(order or "").strip())
        if cache_key not in self._cache:
            self._cache[cache_key] = self._load(sector, section, operations, str(order or "").strip())
        return self._cache[cache_key]

    def _load(self, sector: str, section: str, operations, order: str) -> dict[str, Any]:
        _, sector_key = _keys()
        if not str(sector or "").strip():
            return _empty_detail()  # frente sem setor lançado: nenhuma O.S.
        rows = [row for row in self.conn.execute(
            """SELECT order_number,section,operation_key,plots,opened_on,details_json FROM production_service_orders
               WHERE sector_key=? AND operation_key IN ('509','524')
               ORDER BY opened_on DESC, id DESC""",
            (sector_key(sector),),
        ) if not section or not row["section"] or sector_key(row["section"]) == sector_key(section)]
        same = [row for row in rows if row["operation_key"] in operations]
        rows = same or rows
        options: dict[str, dict[str, Any]] = {}
        for row in rows:
            option = options.setdefault(row["order_number"], {**_empty_detail(), "order": row["order_number"],
                                                              "operation": row["operation_key"],
                                                              "opened_on": row["opened_on"] or "", "_lines": []})
            for plot in (row["plots"] or "").split(","):
                if plot and plot not in option["plots"]:
                    option["plots"].append(plot)
            option["_lines"].extend(json.loads(row["details_json"] or "{}").get("rows", []))
        for option in options.values():
            _apply_components(option, option.pop("_lines"))
            option["plots"].sort(key=natural_key)
            del option["options"], option["orders"]
        if not options:
            return {**_empty_detail(), "missing_order": order}
        chosen = options.get(order) or next(iter(options.values()))
        # O.S. escolhida que não está mais aberta (fechada ou digitada errado): avisa e usa a mais recente.
        return {**chosen, "orders": [chosen["order"], *[number for number in options if number != chosen["order"]]],
                "options": list(options.values()), "missing_order": order if order and order not in options else ""}


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
        detail["recommendation"].append(f"{name} = {amount:g} {unit}")
        if unit == "M3" and detail["flow_m3_ha"] is None:
            detail["flow_m3_ha"] = amount
    detail["recommendation"].sort()
    detail["recommendation_key"] = "|".join(
        f"{normalize_label(name).upper()}={amount:g}{unit}" for name, amount, unit in sorted(components.values()))


def base_options(conn: sqlite3.Connection, unit: str, sector: str) -> list[dict[str, Any]]:
    """Bases da unidade e as que já têm raio para o setor, com o raio de cada uma."""
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
    # A fazenda é do setor (não da base): a da linha escolhida ou de qualquer outra do setor.
    farm = (chosen["farm"] if chosen and chosen["farm"] else "") or next((row["farm"] for row in rows if row["farm"]), "")
    if not farm:
        found = conn.execute("SELECT description FROM sector_base WHERE sector=? COLLATE NOCASE LIMIT 1", (sector,)).fetchone()
        farm = found["description"] if found and found["description"] else ""
    return {"farm": farm, "radius_km": chosen["radius_km"] if chosen else None, "base": chosen["base"] if chosen else ""}


def save_sector_radius(conn: sqlite3.Connection, sector: str, base: str, radius_km: float, user_id: int,
                       *, farm: str = "", municipality: str = "") -> None:
    """Raio de um setor até uma base (digitado no plano da frente). A mesma base escrita de
    outro jeito ("BIE"/"BIÉ") atualiza a linha que já existe."""
    _, sector_key = _keys()
    key = sector_key(sector)
    existing = next((row for row in conn.execute(
        "SELECT base, farm, municipality FROM production_fert_radius WHERE sector_key=?", (key,))
        if base_key(row["base"]) == base_key(base)), None)
    if existing:
        conn.execute(
            """UPDATE production_fert_radius SET radius_km=?, farm=?, municipality=?, imported_by=?, imported_at=?
               WHERE sector_key=? AND base=?""",
            (radius_km, farm or existing["farm"] or "", municipality or existing["municipality"] or "",
             user_id, int(time.time()), key, existing["base"]),
        )
        return
    conn.execute(
        """INSERT INTO production_fert_radius(sector_key,sector,farm,municipality,base,radius_km,imported_by,imported_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (key, str(sector).strip()[:32], farm, municipality, str(base).strip()[:60], radius_km, user_id, int(time.time())),
    )


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
            "version": plan_version(row["work_date"], row["params_json"]),
            "carried": row["work_date"] != work_date,
            "updated_at": int(row["updated_at"] or 0), "updated_by": row["updated_by_name"] or "",
        }
    return plans


def plan_version(work_date: str, params_json: str | None) -> str:
    """Versão do plano gravado: muda a cada gravação que altera o plano (data ou conteúdo)."""
    return hashlib.sha256(f"{work_date}|{params_json or ''}".encode()).hexdigest()[:16]


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
