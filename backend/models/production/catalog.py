"""Produção Agrícola: cadastros de status, grupos e frentes/serviços, e a base de setores."""
from __future__ import annotations

import sqlite3
import time
import uuid
from typing import Any

from ...services.front_identifiers import natural_key
from ..storage import connection, validate_actor
from .common import (
    DISPLAY_STYLES,
    STATUS_STYLE_KEYS,
    _clean_text,
    _normalize_operations,
    _normalize_position,
    _normalize_status,
    _normalize_unit,
)
from .access import _require_access, _require_configure


def _status_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "code": row["code"],
        "name": row["name"],
        "style_key": row["style_key"],
        "position": int(row["position"]),
        "is_active": bool(row["is_active"]),
    }


def list_statuses(user_id: int, *, include_inactive: bool = False) -> dict[str, Any]:
    with connection() as conn:
        access = _require_access(conn, user_id)
        where = "" if include_inactive else "WHERE is_active=1"
        rows = conn.execute(
            f"SELECT id,code,name,style_key,position,is_active FROM production_statuses {where} "
            "ORDER BY position,name COLLATE NOCASE"
        ).fetchall()
        return {
            "statuses": [_status_payload(row) for row in rows],
            "archived_statuses": [_status_payload(row) for row in conn.execute(
                "SELECT id,code,name,style_key,position,0 AS is_active "
                "FROM production_status_history ORDER BY position,name COLLATE NOCASE"
            ).fetchall()],
            "can_configure": access["can_configure"],
        }


def save_status(user_id: int, payload: Any, *, status_id: int | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Dados do status inválidos.")
    name = _clean_text(payload.get("name"), "o nome do status", 80, required=True)
    style_key = str(payload.get("style_key") or "waiting").strip().lower()
    if style_key not in STATUS_STYLE_KEYS:
        raise ValueError("Grupo do status inválido.")
    position = _normalize_position(payload.get("position", 0))
    is_active = payload.get("is_active", True)
    if not isinstance(is_active, bool):
        raise ValueError("Situação do status inválida.")
    now = int(time.time())
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_configure(conn, user_id)
        validate_actor(conn, user_id)
        try:
            if status_id is None:
                code = f"CUSTOM-{uuid.uuid4().hex}"
                cursor = conn.execute(
                    """INSERT INTO production_statuses(
                           code,name,style_key,position,is_active,created_by,updated_by,created_at,updated_at
                       ) VALUES (?,?,?,?,?,?,?,?,?)""",
                    (code, name, style_key, position, int(is_active), user_id, user_id, now, now),
                )
                status_id = int(cursor.lastrowid)
            else:
                if not conn.execute("SELECT 1 FROM production_statuses WHERE id=?", (status_id,)).fetchone():
                    raise ValueError("Status não encontrado.")
                conn.execute(
                    """UPDATE production_statuses
                       SET name=?,style_key=?,position=?,is_active=?,updated_by=?,updated_at=? WHERE id=?""",
                    (name, style_key, position, int(is_active), user_id, now, status_id),
                )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Já existe um status com esse nome.") from exc
        row = conn.execute(
            "SELECT id,code,name,style_key,position,is_active FROM production_statuses WHERE id=?",
            (status_id,),
        ).fetchone()
        return _status_payload(row)


def delete_status(user_id: int, status_id: int) -> None:
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_configure(conn, user_id)
        validate_actor(conn, user_id)
        row = conn.execute("SELECT id,code,name FROM production_statuses WHERE id=?", (status_id,)).fetchone()
        if not row:
            raise ValueError("Status não encontrado.")
        remaining = conn.execute("SELECT COUNT(*) FROM production_statuses WHERE id<>? AND is_active=1", (status_id,)).fetchone()[0]
        if int(remaining or 0) < 1:
            raise ValueError("Mantenha ao menos um status disponível para os lançamentos.")
        conn.execute(
            "INSERT INTO production_status_history (id,code,name,style_key,position) "
            "SELECT id,code,name,style_key,position FROM production_statuses WHERE id=?",
            (status_id,),
        )
        conn.execute("DELETE FROM production_statuses WHERE id=?", (status_id,))


def _validate_status_code(conn: sqlite3.Connection, value: Any) -> str:
    code = _normalize_status(value)
    row = conn.execute(
        "SELECT code FROM production_statuses WHERE code=? COLLATE NOCASE AND is_active=1",
        (code,),
    ).fetchone()
    if not row:
        raise ValueError("Selecione um status válido.")
    return row["code"]


def list_catalog(user_id: int, *, unit_code: Any | None = None, include_inactive: bool = False) -> dict[str, Any]:
    unit = _normalize_unit(unit_code) if unit_code is not None else None
    with connection() as conn:
        access = _require_access(conn, user_id, unit=unit)
        if include_inactive and not access["can_configure"]:
            include_inactive = False

        group_where = "" if include_inactive else "WHERE g.is_active=1"
        groups = [
            {
                "id": int(row["id"]), "name": row["name"], "position": int(row["position"]),
                "is_active": bool(row["is_active"]), "fronts": [],
            }
            for row in conn.execute(
                f"SELECT g.id,g.name,g.position,g.is_active FROM production_groups g {group_where} ORDER BY g.position,g.name COLLATE NOCASE"
            ).fetchall()
        ]
        by_group = {item["id"]: item for item in groups}
        if not groups:
            return {"groups": [], "unit": unit, "can_configure": access["can_configure"]}

        params: list[Any] = []
        conditions = []
        if not include_inactive:
            conditions.append("f.is_active=1")
        if unit:
            conditions.append("EXISTS (SELECT 1 FROM production_service_front_units fu WHERE fu.service_front_id=f.id AND fu.unit_code=?)")
            params.append(unit)
        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        rows = conn.execute(
            f"""
            SELECT f.id,f.group_id,f.name,f.display_style,f.position,f.is_active,f.default_operations
            FROM production_service_fronts f
            {where}
            ORDER BY f.position,f.name COLLATE NOCASE
            """,
            params,
        ).fetchall()
        if rows:
            front_ids = [int(row["id"]) for row in rows]
            placeholders = ",".join("?" for _ in front_ids)
            units_by_front: dict[int, list[str]] = {}
            for mapping in conn.execute(
                f"SELECT service_front_id,unit_code FROM production_service_front_units WHERE service_front_id IN ({placeholders}) ORDER BY unit_code",
                front_ids,
            ).fetchall():
                units_by_front.setdefault(int(mapping["service_front_id"]), []).append(mapping["unit_code"])
            for row in rows:
                group = by_group.get(int(row["group_id"]))
                if not group:
                    continue
                group["fronts"].append({
                    "id": int(row["id"]), "group_id": int(row["group_id"]), "name": row["name"],
                    "display_style": row["display_style"], "position": int(row["position"]),
                    "is_active": bool(row["is_active"]), "units": units_by_front.get(int(row["id"]), []),
                    "default_operations": row["default_operations"] or "",
                })
        return {"groups": groups, "unit": unit, "can_configure": access["can_configure"]}


def _group_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": int(row["id"]), "name": row["name"], "position": int(row["position"]), "is_active": bool(row["is_active"])}


def save_group(user_id: int, payload: Any, *, group_id: int | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Dados do grupo inválidos.")
    name = _clean_text(payload.get("name"), "o nome do grupo", 80, required=True)
    position = _normalize_position(payload.get("position", 0))
    is_active = payload.get("is_active", True)
    if not isinstance(is_active, bool):
        raise ValueError("Situação do grupo inválida.")
    now = int(time.time())
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_configure(conn, user_id)
        validate_actor(conn, user_id)
        try:
            if group_id is None:
                cursor = conn.execute(
                    """INSERT INTO production_groups(name,position,is_active,created_by,updated_by,created_at,updated_at)
                       VALUES (?,?,?,?,?,?,?)""",
                    (name, position, int(is_active), user_id, user_id, now, now),
                )
                group_id = int(cursor.lastrowid)
            else:
                if not conn.execute("SELECT 1 FROM production_groups WHERE id=?", (group_id,)).fetchone():
                    raise ValueError("Grupo não encontrado.")
                conn.execute(
                    "UPDATE production_groups SET name=?,position=?,is_active=?,updated_by=?,updated_at=? WHERE id=?",
                    (name, position, int(is_active), user_id, now, group_id),
                )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Já existe um grupo com esse nome.") from exc
        row = conn.execute("SELECT id,name,position,is_active FROM production_groups WHERE id=?", (group_id,)).fetchone()
        return _group_payload(row)


def delete_group(user_id: int, group_id: int) -> None:
    """Apaga somente grupos ainda não vinculados a frentes/serviços.

    Grupos com vínculos não são removidos para evitar exclusões em cascata e
    preservar o histórico operacional.
    """
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_configure(conn, user_id)
        validate_actor(conn, user_id)
        row = conn.execute("SELECT id,name FROM production_groups WHERE id=?", (group_id,)).fetchone()
        if not row:
            raise ValueError("Grupo não encontrado.")
        linked = conn.execute(
            "SELECT COUNT(*) FROM production_service_fronts WHERE group_id=?",
            (group_id,),
        ).fetchone()[0]
        if int(linked or 0) > 0:
            raise ValueError("Não é possível apagar este grupo porque existem frentes/serviços vinculados. Apague ou mova esses itens primeiro.")
        conn.execute("DELETE FROM production_groups WHERE id=?", (group_id,))


def delete_service_front(user_id: int, front_id: int) -> None:
    """Apaga uma frente/serviço somente quando ela nunca foi utilizada.

    Itens já usados permanecem protegidos para que lançamentos históricos não
    percam sua referência de catálogo.
    """
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_configure(conn, user_id)
        validate_actor(conn, user_id)
        row = conn.execute("SELECT id,name FROM production_service_fronts WHERE id=?", (front_id,)).fetchone()
        if not row:
            raise ValueError("Frente/serviço não encontrada.")
        user_items = conn.execute(
            "SELECT COUNT(*) FROM production_user_items WHERE service_front_id=?",
            (front_id,),
        ).fetchone()[0]
        daily_entries = conn.execute(
            "SELECT COUNT(*) FROM production_daily_entries WHERE service_front_id=?",
            (front_id,),
        ).fetchone()[0]
        if int(user_items or 0) > 0 or int(daily_entries or 0) > 0:
            raise ValueError("Não é possível apagar esta frente/serviço porque ela já foi usada em lançamentos. O histórico foi preservado.")
        conn.execute("DELETE FROM production_service_front_units WHERE service_front_id=?", (front_id,))
        conn.execute("UPDATE production_operations SET service_front_id=NULL WHERE service_front_id=?", (front_id,))
        conn.execute("DELETE FROM production_service_fronts WHERE id=?", (front_id,))


def save_service_front(user_id: int, payload: Any, *, front_id: int | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Dados da frente/serviço inválidos.")
    name = _clean_text(payload.get("name"), "o nome da frente/serviço", 80, required=True)
    try:
        group_id = int(payload.get("group_id"))
    except (TypeError, ValueError) as exc:
        raise ValueError("Selecione o grupo da frente/serviço.") from exc
    display_style = str(payload.get("display_style") or "operation").strip().lower()
    if display_style not in DISPLAY_STYLES:
        raise ValueError("Tipo de exibição inválido.")
    position = _normalize_position(payload.get("position", 0))
    # Operações já preenchidas quando a frente é lançada (ex.: Fert convencional: 346, 342).
    default_operations = _normalize_operations(payload.get("default_operations"))
    keep_default_operations = "default_operations" not in payload
    is_active = payload.get("is_active", True)
    if not isinstance(is_active, bool):
        raise ValueError("Situação da frente/serviço inválida.")
    raw_units = payload.get("units") or []
    if not isinstance(raw_units, list):
        raise ValueError("Unidades da frente/serviço inválidas.")
    units = []
    for raw in raw_units:
        unit = _normalize_unit(raw)
        if unit not in units:
            units.append(unit)
    if not units:
        raise ValueError("Selecione ao menos uma unidade para a frente/serviço.")
    now = int(time.time())
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_configure(conn, user_id)
        validate_actor(conn, user_id)
        if not conn.execute("SELECT 1 FROM production_groups WHERE id=?", (group_id,)).fetchone():
            raise ValueError("Grupo não encontrado.")
        linked_existing = False
        existing = conn.execute(
            "SELECT id,is_active FROM production_service_fronts WHERE name=? COLLATE NOCASE",
            (name,),
        ).fetchone() if front_id is None else None
        if existing:
            if not existing["is_active"]:
                raise ValueError("Esta frente está inativa. Reative o cadastro existente antes de vinculá-la.")
            front_id = int(existing["id"])
            current_units = {
                row["unit_code"] for row in conn.execute(
                    "SELECT unit_code FROM production_service_front_units WHERE service_front_id=?", (front_id,),
                )
            }
            new_units = [unit for unit in units if unit not in current_units]
            if not new_units:
                raise ValueError("Esta frente/serviço já está disponível nesta unidade.")
            conn.executemany(
                "INSERT INTO production_service_front_units(service_front_id,unit_code) VALUES (?,?)",
                [(front_id, unit) for unit in new_units],
            )
            linked_existing = True
        if not linked_existing:
            try:
                if front_id is None:
                    cursor = conn.execute(
                        """INSERT INTO production_service_fronts(
                               group_id,name,display_style,position,is_active,default_operations,
                               created_by,updated_by,created_at,updated_at
                           ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                        (group_id, name, display_style, position, int(is_active), default_operations, user_id, user_id, now, now),
                    )
                    front_id = int(cursor.lastrowid)
                else:
                    if not conn.execute("SELECT 1 FROM production_service_fronts WHERE id=?", (front_id,)).fetchone():
                        raise ValueError("Frente/serviço não encontrada.")
                    conn.execute(
                        """UPDATE production_service_fronts
                           SET group_id=?,name=?,display_style=?,position=?,is_active=?,
                               default_operations=CASE WHEN ? THEN default_operations ELSE ? END,
                               updated_by=?,updated_at=? WHERE id=?""",
                        (group_id, name, display_style, position, int(is_active),
                         keep_default_operations, default_operations, user_id, now, front_id),
                    )
            except sqlite3.IntegrityError as exc:
                raise ValueError("Já existe uma frente/serviço com esse nome.") from exc
            current_units = {
                row["unit_code"] for row in conn.execute(
                    "SELECT unit_code FROM production_service_front_units WHERE service_front_id=?", (front_id,),
                )
            }
            removed_units = sorted(current_units - set(units))
            if removed_units:
                in_use = conn.execute(
                    f"""SELECT DISTINCT unit_code FROM production_user_items
                        WHERE service_front_id=? AND is_active=1
                          AND unit_code IN ({",".join("?" for _ in removed_units)})""",
                    (front_id, *removed_units),
                ).fetchall()
                if in_use:
                    blocked = ", ".join(sorted(row["unit_code"] for row in in_use))
                    raise ValueError(
                        f"A frente/serviço possui lançamentos ativos em {blocked}. Remova-os antes de retirar a unidade."
                    )
            conn.execute("DELETE FROM production_service_front_units WHERE service_front_id=?", (front_id,))
            conn.executemany(
                "INSERT INTO production_service_front_units(service_front_id,unit_code) VALUES (?,?)",
                [(front_id, unit) for unit in units],
            )
    catalog = list_catalog(user_id, include_inactive=True)
    result = next(
        front for group in catalog["groups"]
        for front in group["fronts"] if front["id"] == front_id
    )
    return {**result, "linked_existing": True} if linked_existing else result


def list_sector_base_entries(user_id: int, unit_code: Any) -> list[dict[str, str]]:
    """Setores cadastrados (setor, seção e fazenda) para a lista do popup da Produção."""
    unit = _normalize_unit(unit_code)
    with connection() as conn:
        _require_access(conn, user_id, unit=unit)
        rows = conn.execute("SELECT sector,section,description FROM sector_base").fetchall()
    items = [{"sector": row["sector"], "section": row["section"] or "", "farm": row["description"] or ""} for row in rows]
    items.sort(key=lambda item: (natural_key(item["sector"]), natural_key(item["section"])))
    return items


def list_sector_options(user_id: int, unit_code: Any, sector: Any) -> list[dict[str, str]]:
    unit = _normalize_unit(unit_code)
    cleaned_sector = _clean_text(sector, "o setor", 32, required=True)
    with connection() as conn:
        _require_access(conn, user_id, unit=unit)
        return _sector_options_by_code(conn, [cleaned_sector]).get(cleaned_sector.casefold(), [])


def _sector_options_by_code(conn: sqlite3.Connection, sectors) -> dict[str, list[dict[str, str]]]:
    codes = list(dict.fromkeys(sector for sector in sectors if sector))
    options = {}
    for start in range(0, len(codes), 300):
        batch = codes[start:start + 300]
        placeholders = ",".join("?" for _ in batch)
        rows = conn.execute(f"""SELECT sector,section,description FROM sector_base
                                WHERE sector COLLATE NOCASE IN ({placeholders}) ORDER BY section COLLATE NOCASE""", batch)
        for row in rows:
            options.setdefault(row["sector"].casefold(), []).append({
                "sector": row["sector"], "section": row["section"] or "", "farm": row["description"] or "",
            })
    return options


def _catalog_front_for_unit(conn: sqlite3.Connection, front_id: int, unit: str, *, allow_inactive: bool = False) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT f.id,f.group_id,f.name,f.display_style,f.position,f.is_active,g.name AS group_name,g.is_active AS group_active
        FROM production_service_fronts f
        JOIN production_groups g ON g.id=f.group_id
        JOIN production_service_front_units fu ON fu.service_front_id=f.id AND fu.unit_code=?
        WHERE f.id=?
        """,
        (unit, front_id),
    ).fetchone()
    if not row or (not allow_inactive and (not bool(row["is_active"]) or not bool(row["group_active"]))):
        raise ValueError("Frente/serviço não disponível para esta unidade.")
    return row
