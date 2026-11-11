"""Ordens de Serviço (O.S.) da Produção Agrícola.

As O.S. são importadas por unidade (a importação substitui as O.S. anteriores
da unidade). Cada O.S. tem setor, seção e o código da operação (ex.: 338).

Coluna O.S. de um lançamento:
- com operações escolhidas no popup (uma ou mais, "338, 457"): "OK" se cada
  código tem O.S. no setor;
- sem operação informada: "Sem operação" (o "Ver" continua mostrando as O.S. do setor);
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
from .production import _require_configure as _require_production_configure
from .storage import connection, validate_actor

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


def _order_payload(row: sqlite3.Row, *, full: bool = True) -> dict[str, Any]:
    """Dados da O.S. ``full`` inclui todas as colunas do arquivo (uma linha por talhão);
    o resumo (sem ``rows``/``columns``) basta para tabelas, conferência e sugestões."""
    details = json.loads(row["details_json"] or "{}")
    payload = {
        "id": int(row["id"]), "key": details.get("key", ""), "number": row["order_number"], "sector": row["sector"],
        "section": row["section"], "operation": row["operation"], "operation_name": row["operation_name"],
        "cost_center": row["cost_center"], "plots": [plot for plot in (row["plots"] or "").split(",") if plot],
        "opened_on": row["opened_on"],
    }
    if full:
        payload["columns"] = details.get("columns", [])
        payload["rows"] = details.get("rows", [])
    return payload


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
        _require_access(conn, user_id, unit=unit)
        _require_configure(conn, user_id)
        # Operações novas do arquivo entram no cadastro com a descrição (CCUSTO_TRATOS).
        for row in rows.values():
            code, key, name = row[5], row[6], row[7]
            conn.execute(
                """INSERT INTO production_operations(code,code_key,name,position,is_active,created_by,updated_by,created_at,updated_at)
                   VALUES (?,?,?,0,1,?,?,?,?)
                   ON CONFLICT(code_key) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
                   WHERE production_operations.name=''""",
                (code, key, name, user_id, user_id, now, now),
            )
        removed = conn.execute("DELETE FROM production_service_orders WHERE unit_code=?", (unit,)).rowcount
        conn.executemany(
            """INSERT INTO production_service_orders (
                   unit_code, order_number, sector, sector_key, section, operation, operation_key,
                   operation_name, cost_center, plots, opened_on, details_json, import_file, imported_by, imported_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [row + (_text(filename, 160), user_id, now) for row in rows.values()],
        )
    return {"unit": unit, "imported": len(rows), "removed": removed, "processed_rows": len(records)}


def list_service_orders(user_id: int, unit_code: Any, search: Any = None, *, summary: bool = False) -> dict[str, Any]:
    """O.S. da unidade. A busca é aplicada antes de ler o detalhe de cada O.S.;
    ``summary`` devolve só o resumo (sem as linhas do arquivo)."""
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
    term = normalize_label(search)
    selected = [row for row in rows if not term or term in normalize_label(" ".join(str(row[field] or "") for field in (
        "order_number", "sector", "section", "operation", "operation_name", "cost_center")))]
    orders = [_order_payload(row, full=not summary) for row in selected]
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
    # Cada O.S. é lida uma vez; o lançamento leva só o resumo (o detalhe vem no "Ver").
    summaries: dict[int, dict[str, Any]] = {}

    def summary_of(row: sqlite3.Row) -> dict[str, Any]:
        order_id = int(row["id"])
        if order_id not in summaries:
            summaries[order_id] = _order_payload(row, full=False)
        return summaries[order_id]
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
        complete = bool(wanted) and all(key in covered for key in wanted)
        sector_orders = [{**summary_of(row), "matches": int(row["id"]) in matches} for row in sector_rows]
        sector_orders.sort(key=lambda order: (not order["matches"], natural_key(order["section"]),
                                              natural_key(order["operation"]), natural_key(order["number"])))
        # Sem operação informada não há o que conferir: "Sem operação" (nunca "OK").
        if not wanted:
            sector_orders = [{**order, "matches": False} for order in sector_orders]
        item["service_order"] = {
            "status": "no_operation" if not wanted else ("ok" if complete else "missing"),
            "missing_operations": [key for key in wanted if key not in covered],
            # Todas as O.S. abertas do setor; "matches" marca as que conferem com o lançamento.
            "orders": sector_orders,
        }


# ---------------------------------------------------------------------------
# Cadastro de operações (código, descrição e frente/serviço a que pertence).
# ---------------------------------------------------------------------------
def _require_configure(conn: sqlite3.Connection, user_id: int) -> None:
    """Cadastros, consultas e importação de O.S. seguem a regra de configuração da Produção."""
    _require_production_configure(conn, user_id)


def require_service_order_import(user_id: int, unit_code: Any) -> str:
    """Confere a permissão de importar antes de ler o arquivo enviado (evita processar
    planilhas de quem não pode importar)."""
    unit = _normalize_unit(unit_code)
    with connection() as conn:
        _require_access(conn, user_id, unit=unit)
        _require_configure(conn, user_id)
    return unit


def _operations_in_use(conn: sqlite3.Connection) -> set[str]:
    used: set[str] = set()
    for (value,) in conn.execute("SELECT DISTINCT operation FROM production_daily_entries WHERE operation<>''"):
        used.update(operation_keys(value))
    return used


def _operation_payload(row: sqlite3.Row, used: set[str]) -> dict[str, Any]:
    return {
        "id": int(row["id"]), "code": row["code"], "name": row["name"],
        "service_front_id": int(row["service_front_id"]) if row["service_front_id"] is not None else None,
        "front_name": row["front_name"] or "", "position": int(row["position"] or 0),
        "is_active": bool(row["is_active"]), "in_use": row["code_key"] in used,
    }


def list_operations(user_id: int, *, include_inactive: bool = False, usage: bool = True) -> dict[str, Any]:
    with connection() as conn:
        access = _require_access(conn, user_id)
        # Operações inativas só aparecem para quem configura (como no catálogo de frentes).
        include_inactive = include_inactive and bool(access["can_configure"])
        where = "" if include_inactive else "WHERE o.is_active=1"
        rows = conn.execute(
            f"""SELECT o.*, f.name AS front_name FROM production_operations o
                LEFT JOIN production_service_fronts f ON f.id=o.service_front_id {where}""",
        ).fetchall()
        # "Em uso" percorre os lançamentos; quem só precisa da lista (popup) dispensa.
        used = _operations_in_use(conn) if usage else set()
    operations = [_operation_payload(row, used) for row in rows]
    operations.sort(key=lambda item: (item["position"], natural_key(item["code"])))
    return {"operations": operations, "can_configure": bool(access["can_configure"])}


def save_operation(user_id: int, payload: Any, *, operation_id: int | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Dados da operação inválidos.")
    code = _text(payload.get("code"), 40)
    name = _text(payload.get("name"), 160)
    if not code:
        raise ValueError("Informe o código da operação.")
    if not name:
        raise ValueError("Informe a descrição da operação.")
    key = operation_key(code)
    front_id = payload.get("service_front_id")
    try:
        front_id = int(front_id) if front_id not in (None, "") else None
        position = int(payload.get("position") or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError("Frente ou ordem inválida.") from exc
    if not 0 <= position <= 9999:
        raise ValueError("A ordem deve ficar entre 0 e 9999.")
    is_active = payload.get("is_active", True) is not False
    now = int(time.time())
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_configure(conn, user_id)
        validate_actor(conn, user_id)
        if front_id is not None and not conn.execute(
            "SELECT 1 FROM production_service_fronts WHERE id=?", (front_id,)
        ).fetchone():
            raise ValueError("Frente/serviço não encontrada.")
        duplicate = conn.execute(
            "SELECT id FROM production_operations WHERE code_key=? AND (? IS NULL OR id<>?)",
            (key, operation_id, operation_id),
        ).fetchone()
        if duplicate:
            raise ValueError(f"A operação {code} já está cadastrada.")
        if operation_id is None:
            cursor = conn.execute(
                """INSERT INTO production_operations(code,code_key,name,service_front_id,position,is_active,
                       created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (code, key, name, front_id, position, int(is_active), user_id, user_id, now, now),
            )
            operation_id = int(cursor.lastrowid)
        else:
            cursor = conn.execute(
                """UPDATE production_operations SET code=?,code_key=?,name=?,service_front_id=?,position=?,
                       is_active=?,updated_by=?,updated_at=? WHERE id=?""",
                (code, key, name, front_id, position, int(is_active), user_id, now, operation_id),
            )
            if cursor.rowcount == 0:
                raise ValueError("Operação não encontrada.")
        row = conn.execute(
            """SELECT o.*, f.name AS front_name FROM production_operations o
               LEFT JOIN production_service_fronts f ON f.id=o.service_front_id WHERE o.id=?""",
            (operation_id,),
        ).fetchone()
        return _operation_payload(row, _operations_in_use(conn))


def delete_operation(user_id: int, operation_id: int) -> None:
    """Apaga a operação só quando nenhum lançamento a usa; caso contrário, inative-a."""
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_configure(conn, user_id)
        row = conn.execute("SELECT code,code_key FROM production_operations WHERE id=?", (operation_id,)).fetchone()
        if not row:
            raise ValueError("Operação não encontrada.")
        if row["code_key"] in _operations_in_use(conn):
            raise ValueError(f"A operação {row['code']} já foi usada em lançamentos. Inative-a para preservar o histórico.")
        conn.execute("DELETE FROM production_operations WHERE id=?", (operation_id,))


# ---------------------------------------------------------------------------
# Consultas SQL salvas: o SELECT usado no sistema de origem para gerar o arquivo
# de O.S. Fica guardado aqui para consultar, copiar e editar.
# ---------------------------------------------------------------------------
MAX_SQL_LENGTH = 20_000


def _query_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]), "name": row["name"], "description": row["description"],
        "sql": row["sql_text"], "position": int(row["position"] or 0),
        "updated_at": int(row["updated_at"] or 0), "updated_by": row["updated_by_name"] or "-",
    }


def list_sql_queries(user_id: int) -> dict[str, Any]:
    with connection() as conn:
        access = _require_access(conn, user_id)
        rows = conn.execute(
            """SELECT q.*, u.name AS updated_by_name FROM production_sql_queries q
               LEFT JOIN auth.users u ON u.id=q.updated_by ORDER BY q.position, q.name COLLATE NOCASE""",
        ).fetchall()
    return {"queries": [_query_payload(row) for row in rows], "can_configure": bool(access["can_configure"])}


def save_sql_query(user_id: int, payload: Any, *, query_id: int | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Dados da consulta inválidos.")
    name = _text(payload.get("name"), 120)
    description = _text(payload.get("description"), 300)
    sql = str(payload.get("sql") or "").strip()
    if not name:
        raise ValueError("Informe o nome da consulta.")
    if not sql:
        raise ValueError("Cole o comando SQL da consulta.")
    if len(sql) > MAX_SQL_LENGTH:
        raise ValueError("O comando SQL deve ter no máximo 20.000 caracteres.")
    try:
        position = int(payload.get("position") or 0)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Ordem inválida.") from exc
    if not 0 <= position <= 9999:
        raise ValueError("A ordem deve ficar entre 0 e 9999.")
    now = int(time.time())
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_configure(conn, user_id)
        validate_actor(conn, user_id)
        if query_id is None:
            query_id = int(conn.execute(
                """INSERT INTO production_sql_queries(name,description,sql_text,position,created_by,updated_by,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (name, description, sql, position, user_id, user_id, now, now),
            ).lastrowid)
        elif conn.execute(
            """UPDATE production_sql_queries SET name=?,description=?,sql_text=?,position=?,updated_by=?,updated_at=?
               WHERE id=?""",
            (name, description, sql, position, user_id, now, query_id),
        ).rowcount == 0:
            raise ValueError("Consulta não encontrada.")
        row = conn.execute(
            """SELECT q.*, u.name AS updated_by_name FROM production_sql_queries q
               LEFT JOIN auth.users u ON u.id=q.updated_by WHERE q.id=?""",
            (query_id,),
        ).fetchone()
        return _query_payload(row)


def delete_sql_query(user_id: int, query_id: int) -> None:
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_configure(conn, user_id)
        if conn.execute("DELETE FROM production_sql_queries WHERE id=?", (query_id,)).rowcount == 0:
            raise ValueError("Consulta não encontrada.")
