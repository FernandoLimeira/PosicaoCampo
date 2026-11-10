"""Ordens de Serviço (O.S.) da Produção Agrícola.

As O.S. são importadas por unidade (a importação substitui as O.S. anteriores
da unidade). Cada O.S. tem setor, seção e o código da operação (ex.: 338).

Coluna O.S. de um lançamento:
- com operações escolhidas no popup (uma ou mais, "338, 457"): "OK" se cada
  código tem O.S. no setor;
- sem operação escolhida: "OK" se existe qualquer O.S. para o setor;
- "Sem O.S." quando não existe. Quando o lançamento e a O.S. têm seção, ela também precisa coincidir.
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
from typing import Any

from ..services.front_identifiers import natural_key, normalize_label
from .production import _normalize_unit, _require_access
from .storage import connection

MAX_TEXT = 300


def sector_key(value: Any) -> str:
    """Setor/seção/operação comparáveis: "0663", "663" e "663.0" são o mesmo código."""
    text = str(value or "").strip()
    if re.fullmatch(r"\d+(\.0+)?", text):
        return str(int(text.split(".", 1)[0]))
    return normalize_label(text)


def operation_key(value: Any) -> str:
    """O popup grava "338 — TRATOS PLANTIO" ou só "338"; a comparação usa o código."""
    text = str(value or "").strip()
    match = re.match(r"^\s*(\d+)", text)
    return str(int(match.group(1))) if match else normalize_label(text)


def operation_keys(value: Any) -> list[str]:
    """Operações do lançamento: o popup permite várias ("338, 457") com o botão "+"."""
    keys = []
    for part in re.split(r"[,;+]", str(value or "")):
        key = operation_key(part)
        if key and key not in keys:
            keys.append(key)
    return keys


def _text(value: Any, limit: int = MAX_TEXT) -> str:
    return str(value or "").strip()[:limit]


def _order_payload(row: sqlite3.Row) -> dict[str, Any]:
    details = json.loads(row["details_json"] or "{}")
    return {
        "id": int(row["id"]), "key": details.get("key", ""), "number": row["order_number"], "sector": row["sector"],
        "section": row["section"], "operation": row["operation"], "operation_name": row["operation_name"],
        "cost_center": row["cost_center"], "plots": [plot for plot in (row["plots"] or "").split(",") if plot],
        "opened_on": row["opened_on"],
        # Todas as colunas do arquivo, uma linha por talhão.
        "columns": details.get("columns", []), "rows": details.get("rows", []),
    }


def import_service_orders(user_id: int, unit_code: Any, records: list[dict[str, Any]], *, filename: str = "") -> dict[str, Any]:
    unit = _normalize_unit(unit_code)
    if not isinstance(records, list) or not records:
        raise ValueError("Nenhuma ordem de serviço válida foi encontrada no arquivo.")
    rows: dict[tuple[str, str, str, str], tuple] = {}
    for record in records:
        number = _text(record.get("number"), 60)
        sector = _text(record.get("sector"), 32)
        operation = _text(record.get("operation"), 60)
        if not number or not sector or not operation:
            continue
        section = _text(record.get("section"), 32)
        plots = record.get("plots") if isinstance(record.get("plots"), list) else []
        columns = [_text(name, 80) for name in record.get("columns") or [] if _text(name, 80)][:60]
        file_rows = [
            {_text(k, 80): _text(v) for k, v in item.items()}
            for item in (record.get("rows") or [])[:2000] if isinstance(item, dict)
        ]
        key = (number.casefold(), sector_key(sector), sector_key(section), operation_key(operation))
        rows[key] = (
            unit, number, sector, sector_key(sector), section, operation, operation_key(operation),
            _text(record.get("operation_name"), 160), _text(record.get("cost_center"), 60),
            ",".join(_text(plot, 20) for plot in plots if _text(plot, 20))[:2000], _text(record.get("opened_on"), 40),
            json.dumps({"key": _text(record.get("key"), 60), "columns": columns, "rows": file_rows}, ensure_ascii=False),
        )
    if not rows:
        raise ValueError("Nenhuma ordem de serviço válida foi encontrada no arquivo.")
    now = int(time.time())
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        access = _require_access(conn, user_id, unit=unit)
        if not access["can_configure"]:
            raise PermissionError("Somente quem tem a configuração global da Produção pode importar ordens de serviço.")
        removed = conn.execute("DELETE FROM production_service_orders WHERE unit_code=?", (unit,)).rowcount
        conn.executemany(
            """INSERT INTO production_service_orders (
                   unit_code, order_number, sector, sector_key, section, operation, operation_key,
                   operation_name, cost_center, plots, opened_on, details_json, import_file, imported_by, imported_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [row + (_text(filename, 160), user_id, now) for row in rows.values()],
        )
    return {"unit": unit, "imported": len(rows), "removed": removed, "processed_rows": len(records)}


def list_service_orders(user_id: int, unit_code: Any, search: Any = None) -> dict[str, Any]:
    unit = _normalize_unit(unit_code)
    with connection() as conn:
        access = _require_access(conn, user_id, unit=unit)
        rows = conn.execute("SELECT * FROM production_service_orders WHERE unit_code=?", (unit,)).fetchall()
        last = conn.execute(
            """SELECT o.import_file, o.imported_at, COALESCE(u.name, 'Usuário removido') AS imported_by_name
               FROM production_service_orders o LEFT JOIN auth.users u ON u.id=o.imported_by
               WHERE o.unit_code=? ORDER BY o.imported_at DESC LIMIT 1""",
            (unit,),
        ).fetchone()
    orders = [_order_payload(row) for row in rows]
    term = normalize_label(search)
    if term:
        orders = [order for order in orders if term in normalize_label(" ".join([
            order["number"], order["sector"], order["section"], order["operation"],
            order["operation_name"], order["cost_center"]]))]
    orders.sort(key=lambda order: (natural_key(order["sector"]), natural_key(order["section"]),
                                   natural_key(order["operation"]), natural_key(order["number"])))
    return {
        "unit": unit, "orders": orders, "total": len(rows),
        "last_import": {
            "file": last["import_file"], "imported_at": int(last["imported_at"]),
            "imported_by": last["imported_by_name"],
        } if last else None,
        "can_import": bool(access["can_configure"]),
    }


def order_matches_entry(order: sqlite3.Row | dict, entry: dict[str, Any]) -> bool:
    if sector_key(order["sector"]) != sector_key(entry.get("sector")):
        return False
    section = sector_key(entry.get("section"))
    if section and order["section"] and sector_key(order["section"]) != section:
        return False
    wanted = operation_keys(entry.get("operation"))
    return not wanted or operation_key(order["operation"]) in wanted


def attach_service_order_status(conn: sqlite3.Connection, unit: str, items: list[dict[str, Any]]) -> None:
    """Acrescenta ``service_order`` a cada lançamento: ok, missing ou no_sector."""
    by_sector: dict[str, list[sqlite3.Row]] = {}
    for row in conn.execute("SELECT * FROM production_service_orders WHERE unit_code=?", (unit,)):
        by_sector.setdefault(row["sector_key"], []).append(row)
    for item in items:
        entry = item.get("entry") or {}
        if not entry.get("sector"):
            item["service_order"] = {"status": "no_sector", "orders": []}
            continue
        sector_rows = by_sector.get(sector_key(entry["sector"]), [])
        matching_rows = [row for row in sector_rows if order_matches_entry(row, entry)]
        matches = {int(row["id"]) for row in matching_rows}
        # Com várias operações, todas precisam ter O.S. no setor para ficar "OK".
        wanted = operation_keys(entry.get("operation"))
        covered = {operation_key(row["operation"]) for row in matching_rows}
        complete = bool(matches) and all(key in covered for key in wanted)
        sector_orders = [{**_order_payload(row), "matches": int(row["id"]) in matches} for row in sector_rows]
        sector_orders.sort(key=lambda order: (not order["matches"], natural_key(order["section"]),
                                              natural_key(order["operation"]), natural_key(order["number"])))
        item["service_order"] = {
            "status": "ok" if complete else "missing",
            "missing_operations": [key for key in wanted if key not in covered],
            # Todas as O.S. abertas do setor; "matches" marca as que conferem com o lançamento.
            "orders": sector_orders,
        }
