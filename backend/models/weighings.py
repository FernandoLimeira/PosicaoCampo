"""Pesagem de cana do CTT: importação das cargas da balança e resumo por unidade/frente.

Regras do resumo (data ``work_date``):
- Moagem: peso líquido (QT_LIQUIDO) pelo horário de saída da balança.
  Moagem do dia = cargas com saída da balança e data de movimento no dia.
- Entrega: cargas pelo horário de entrada no pátio. Carga já pesada usa o peso
  líquido; carga ainda no pátio usa o peso médio das cargas pesadas da unidade no dia.
- Referência ("dados até"): horário da última saída da balança no dia, limitado à
  última entrada no pátio (até onde o arquivo está completo). As taxas usam essa
  referência para não diluir quando o arquivo é importado algum tempo depois.
- Turno (t/h): toneladas desde o início do turno da referência ÷ horas decorridas.
- Últimas 3 h (t/h): toneladas nas 3 h até a referência ÷ 3.
- Estoque: cargas que entraram no pátio (nas 24 h até a referência) e ainda não
  tinham saído da balança na referência.
- Todas as unidades (inclusive o Polo MS) usam o mesmo horário e os mesmos turnos.
- Frente de outra unidade: a frente é procurada nas frentes da Posição de Campo de
  cada unidade; se pertence a outra, conta como ATR recebido nesta e apoio daquela.
"""
from __future__ import annotations

import json
import time
from datetime import date, datetime, time as dtime
from typing import Any

from ..services.front_identifiers import front_key, natural_key
from ..services.operational_shifts import FIELD_TIMEZONE, shift_at
from .constants import ALLOWED_UNIT_CODES
from .storage import connection, validate_actor

MAX_WEIGHING_RECORDS = 150_000
STOCK_WINDOW_SECONDS = 24 * 3600
LAST_HOURS = 3

_COLUMNS = (
    "unit_code", "release_no", "movement_date", "truck", "trailer", "front", "sector", "section",
    "net_kg", "atr", "patio_at", "scale_in_at", "scale_out_at",
)


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    number = int(value)
    if not 0 < number < 2 ** 40:
        raise ValueError
    return number


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    number = float(value)
    if number != number or abs(number) > 1e12:
        raise ValueError
    return number


def import_weighings(user_id: int, records: Any, *, filename: str = "") -> dict[str, Any]:
    if not isinstance(records, list) or not records or len(records) > MAX_WEIGHING_RECORDS:
        raise ValueError("Lista de cargas inválida.")
    prepared = []
    for position, item in enumerate(records, start=1):
        try:
            unit = str(item["unit_code"]).strip().upper()
            release = str(item["release_no"]).strip()
            front = str(item["front"]).strip()
            if unit not in ALLOWED_UNIT_CODES or not release or not front:
                raise ValueError
            movement = str(item.get("movement_date") or "").strip()
            if movement:
                date.fromisoformat(movement)
            prepared.append((
                unit, release, movement, str(item.get("truck") or "").strip(), str(item.get("trailer") or "").strip(),
                front, str(item.get("sector") or "").strip(), str(item.get("section") or "").strip(),
                _optional_float(item.get("net_kg")), _optional_float(item.get("atr")),
                _optional_int(item.get("patio_at")), _optional_int(item.get("scale_in_at")),
                _optional_int(item.get("scale_out_at")),
            ))
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise ValueError(f"Carga {position} com dados inválidos.") from exc

    now = int(time.time())
    placeholders = ", ".join("?" for _ in range(len(_COLUMNS) + 3))
    updates = ", ".join(f"{column}=excluded.{column}" for column in _COLUMNS[2:])
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        validate_actor(conn, user_id)
        existing = {
            (row[0], row[1]) for row in conn.execute("SELECT unit_code, release_no FROM field_weighings")
        }
        conn.executemany(
            f"""INSERT INTO field_weighings ({", ".join(_COLUMNS)}, import_file, imported_by, imported_at)
                VALUES ({placeholders})
                ON CONFLICT(unit_code, release_no) DO UPDATE SET {updates},
                    import_file=excluded.import_file, imported_by=excluded.imported_by,
                    imported_at=excluded.imported_at""",
            [values + (str(filename or "")[:200], user_id, now) for values in prepared],
        )
    keys = {(values[0], values[1]) for values in prepared}
    by_unit = {code: 0 for code in ALLOWED_UNIT_CODES}
    for values in prepared:
        by_unit[values[0]] += 1
    dates = sorted({values[2] for values in prepared if values[2]})
    return {
        "imported": len(keys), "created": len(keys - existing), "updated": len(keys & existing),
        "by_unit": by_unit, "dates": dates,
        "pending": sum(1 for values in prepared if values[12] is None),
    }


def _front_owners(conn) -> dict[str, str]:
    """Frente (chave normalizada) -> unidade, pelas frentes da Posição de Campo.
    Frente cadastrada em mais de uma unidade fica sem dono (não vira "recebida")."""
    owners: dict[str, set[str]] = {}
    for code, data_json in conn.execute("SELECT code, data_json FROM units"):
        try:
            rows = json.loads(data_json or "{}").get("rows") or []
        except (TypeError, ValueError, AttributeError):
            continue
        for row in rows:
            if isinstance(row, list) and row and str(row[0] or "").strip():
                owners.setdefault(front_key(row[0]), set()).add(str(code).upper())
    return {key: next(iter(units)) for key, units in owners.items() if len(units) == 1}


def _tons(rows) -> float:
    return sum((row["net_kg"] or 0) for row in rows) / 1000


def _weighted_atr(rows) -> float | None:
    weighted = [(row["atr"], row["net_kg"] or 0) for row in rows if row["atr"] is not None and row["net_kg"]]
    total = sum(weight for _, weight in weighted)
    return round(sum(atr * weight for atr, weight in weighted) / total, 2) if total else None


def _round(value: float | None, digits: int = 1) -> float | None:
    return None if value is None else round(value, digits)


def weighing_summary(work_date: Any = None) -> dict[str, Any]:
    if work_date in (None, ""):
        selected = datetime.now(FIELD_TIMEZONE).date()
    else:
        try:
            selected = date.fromisoformat(str(work_date))
        except ValueError as exc:
            raise ValueError("Data da pesagem inválida.") from exc
    day = selected.isoformat()
    day_start = int(datetime.combine(selected, dtime.min, FIELD_TIMEZONE).timestamp())
    with connection() as conn:
        owners = _front_owners(conn)
        weighed = conn.execute(
            "SELECT * FROM field_weighings WHERE scale_out_at IS NOT NULL AND movement_date=?", (day,)
        ).fetchall()
        # Referência = momento em que o arquivo está completo: a última saída da balança,
        # limitada à última entrada no pátio. O SELECT traz as cargas que entraram até um
        # horário; depois dele faltam cargas novas e as taxas ficariam diluídas. Saídas
        # após a referência ficam para a próxima importação.
        last_exit = max((row["scale_out_at"] for row in weighed), default=None)
        last_entry = conn.execute(
            "SELECT MAX(patio_at) FROM field_weighings WHERE patio_at BETWEEN ? AND ?",
            (day_start, day_start + 86399),
        ).fetchone()[0]
        reference = min(value for value in (last_exit, last_entry) if value) if last_exit else None
        weighed = [row for row in weighed if reference and row["scale_out_at"] <= reference]
        # Cargas que entraram no pátio nas 24 h até a referência (pesadas ou não):
        # base da entrega e do estoque.
        reference_end = reference or day_start + 86399
        arrival_rows = conn.execute(
            "SELECT unit_code, patio_at, scale_out_at, net_kg FROM field_weighings WHERE patio_at BETWEEN ? AND ?",
            (reference_end - STOCK_WINDOW_SECONDS, reference_end),
        ).fetchall()
        last_import = conn.execute(
            """SELECT w.import_file, w.imported_at, u.name AS imported_by_name
               FROM field_weighings w LEFT JOIN auth.users u ON u.id=w.imported_by
               ORDER BY w.imported_at DESC LIMIT 1"""
        ).fetchone()

    shift = shift_at(reference) if reference else None
    shift_hours = max((reference - shift["start_at"]) / 3600, 0.25) if shift else None
    last_start = reference - LAST_HOURS * 3600 if reference else None
    units = []
    support = []
    for code in ALLOWED_UNIT_CODES:
        rows = [row for row in weighed if row["unit_code"] == code]
        shift_rows = [row for row in rows if shift and row["scale_out_at"] >= shift["start_at"]]
        recent_rows = [row for row in rows if last_start is not None and row["scale_out_at"] > last_start]
        arrivals = [row for row in arrival_rows if row["unit_code"] == code]
        # Estoque: entrou no pátio e ainda não tinha saído da balança na referência.
        stock = [row for row in arrivals if row["scale_out_at"] is None or row["scale_out_at"] > reference_end]
        # Entrega: carga que entrou no pátio. Já pesada usa o peso real; ainda no pátio
        # usa o peso médio das cargas pesadas da unidade no dia.
        average_kg = sum(row["net_kg"] or 0 for row in rows) / len(rows) if rows else 0

        def delivered_tons(start):
            return sum((row["net_kg"] or 0) if row not in stock else average_kg
                       for row in arrivals if row["patio_at"] >= start) / 1000
        fronts: dict[str, list] = {}
        for row in rows:
            fronts.setdefault(row["front"], []).append(row)
        front_list = []
        for front, front_rows in sorted(fronts.items(), key=lambda item: natural_key(item[0])):
            latest = max(front_rows, key=lambda row: row["scale_out_at"])
            owner = owners.get(front_key(front))
            entry = {
                "front": front, "home_unit": owner or code, "external": bool(owner and owner != code),
                "sector": latest["sector"], "section": latest["section"],
                "loads": len(front_rows), "tons": _round(_tons(front_rows)),
                "shift_tons": _round(_tons([row for row in shift_rows if row["front"] == front])),
                "atr": _weighted_atr(front_rows), "last_at": latest["scale_out_at"],
            }
            front_list.append(entry)
            if entry["external"]:
                support.append({"front": front, "from_unit": owner, "to_unit": code,
                                "loads": entry["loads"], "tons": entry["tons"], "atr": entry["atr"]})
        units.append({
            "code": code,
            "milling_day_t": _round(_tons(rows)),
            "loads_day": len(rows),
            "milling_shift_tph": _round(_tons(shift_rows) / shift_hours) if shift_hours else None,
            "milling_last3h_tph": _round(_tons(recent_rows) / LAST_HOURS) if reference else None,
            "delivery_shift_tph": _round(delivered_tons(shift["start_at"]) / shift_hours) if shift_hours else None,
            "delivery_last3h_tph": _round(delivered_tons(last_start) / LAST_HOURS) if reference else None,
            "stock_loads": len(stock),
            "atr": _weighted_atr(rows),
            "fronts": front_list,
            "received": [front for front in front_list if front["external"]],
        })
    return {
        "work_date": day,
        "reference_at": reference,
        "shift": {"code": shift["shift"], "start_at": shift["start_at"]} if shift else None,
        "units": units,
        "support": support,
        "last_import": dict(last_import) if last_import else None,
    }


# Consultas SQL da Entrega CTT: o SELECT que gera o Excel de pesagem no sistema de
# origem. O comando é só guardado aqui (para copiar), nunca executado.
MAX_QUERY_SQL_LENGTH = 20_000


def _query_payload(row) -> dict[str, Any]:
    return {
        "id": int(row["id"]), "name": row["name"], "sql": row["sql_text"], "position": int(row["position"]),
        "updated_at": int(row["updated_at"] or 0), "updated_by": row["updated_by_name"] or "-",
    }


_QUERY_SELECT = """SELECT q.*, u.name AS updated_by_name FROM field_sql_queries q
                   LEFT JOIN auth.users u ON u.id=q.updated_by"""


def list_delivery_queries() -> list[dict[str, Any]]:
    with connection() as conn:
        rows = conn.execute(f"{_QUERY_SELECT} ORDER BY q.position, q.name COLLATE NOCASE").fetchall()
    return [_query_payload(row) for row in rows]


def save_delivery_query(user_id: int, payload: Any, *, query_id: int | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Dados da consulta inválidos.")
    name = " ".join(str(payload.get("name") or "").split())[:120]
    sql = str(payload.get("sql") or "").strip()
    if not name:
        raise ValueError("Informe o nome da consulta.")
    if not sql:
        raise ValueError("Cole o comando SQL da consulta.")
    if len(sql) > MAX_QUERY_SQL_LENGTH:
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
        validate_actor(conn, user_id)
        if query_id is None:
            query_id = int(conn.execute(
                """INSERT INTO field_sql_queries(name,sql_text,position,created_by,updated_by,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (name, sql, position, user_id, user_id, now, now),
            ).lastrowid)
        elif conn.execute(
            "UPDATE field_sql_queries SET name=?,sql_text=?,position=?,updated_by=?,updated_at=? WHERE id=?",
            (name, sql, position, user_id, now, query_id),
        ).rowcount == 0:
            raise ValueError("Consulta não encontrada.")
        return _query_payload(conn.execute(f"{_QUERY_SELECT} WHERE q.id=?", (query_id,)).fetchone())


def delete_delivery_query(query_id: int) -> None:
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("DELETE FROM field_sql_queries WHERE id=?", (query_id,)).rowcount == 0:
            raise ValueError("Consulta não encontrada.")
