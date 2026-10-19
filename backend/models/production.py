"""Produção Agrícola: permissões por unidade, catálogo e apontamentos diários.

A autorização por unidade é independente da lista pessoal de frentes; cada
atualização diária mantém histórico separado.
"""

from __future__ import annotations

import re
import sqlite3
import time
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from .database import ALLOWED_UNIT_CODES, UNIT_DEFINITIONS
from .storage import auth_connection, connection, validate_actor

MODULE_KEY = "production"
STATUS_STYLE_KEYS = {"active", "wet", "waiting", "stopped"}
DISPLAY_STYLES = {"operation", "front"}


def _normalize_unit(value: Any) -> str:
    unit = str(value or "").strip().upper()
    if unit not in ALLOWED_UNIT_CODES:
        raise ValueError("Unidade inválida para a Produção Agrícola.")
    return unit


def _normalize_work_date(value: Any) -> str:
    text = str(value or "").strip()
    try:
        parsed = date.fromisoformat(text)
    except ValueError as exc:
        raise ValueError("Data do apontamento inválida.") from exc
    if parsed.year < 2000 or parsed.year > 2100:
        raise ValueError("Data do apontamento inválida.")
    return parsed.isoformat()


def _clean_text(value: Any, field: str, max_length: int, *, required: bool = False) -> str:
    text = str(value or "").strip()
    if required and not text:
        raise ValueError(f"Informe {field}.")
    if len(text) > max_length:
        raise ValueError(f"{field.capitalize()} deve ter no máximo {max_length} caracteres.")
    return text


def _normalize_status(value: Any) -> str:
    return _clean_text(value, "o status", 120, required=True)


def _normalize_position(value: Any) -> int:
    try:
        position = int(value if value is not None else 0)
    except (TypeError, ValueError) as exc:
        raise ValueError("Ordem de exibição inválida.") from exc
    if position < 0 or position > 9999:
        raise ValueError("A ordem de exibição deve estar entre 0 e 9999.")
    return position


def normalize_user_access(payload: Any) -> dict[str, Any]:
    """Aceita permissões específicas por unidade e configurações legadas.

    unit_permissions é o formato atual; units + permissions continua válido
    para chamadas antigas. Nunca ampliamos o acesso de um registro existente.
    """
    if payload is None:
        payload = {"enabled": False}
    if not isinstance(payload, dict):
        raise ValueError("Configuração da Produção Agrícola inválida.")
    enabled = payload.get("enabled", True)
    if not isinstance(enabled, bool):
        raise ValueError("Situação do acesso à Produção Agrícola inválida.")
    raw_permissions = payload.get("permissions") or {}
    if not isinstance(raw_permissions, dict):
        raise ValueError("Permissões da Produção Agrícola inválidas.")
    for key in ("fill", "configure", "summary"):
        if key in raw_permissions and not isinstance(raw_permissions[key], bool):
            raise ValueError("Permissões da Produção Agrícola inválidas.")

    per_unit: dict[str, dict[str, bool]] = {}
    if "unit_permissions" in payload:
        items = payload["unit_permissions"]
        if not isinstance(items, dict):
            raise ValueError("Permissões por unidade inválidas.")
        for raw_unit, flags in items.items():
            unit = _normalize_unit(raw_unit)
            if not isinstance(flags, dict) or set(flags) != {"view", "fill", "summary"}:
                raise ValueError(f"Permissões da unidade {unit} inválidas.")
            if any(not isinstance(flags[key], bool) for key in ("view", "fill", "summary")):
                raise ValueError(f"Permissões da unidade {unit} inválidas.")
            if not flags["view"]:
                raise ValueError(f"Libere a consulta antes das operações da unidade {unit}.")
            per_unit[unit] = {"view": True, "fill": flags["fill"], "summary": flags["summary"]}
    else:
        raw_units = payload.get("units") or []
        if not isinstance(raw_units, list):
            raise ValueError("Unidades da Produção Agrícola inválidas.")
        for raw_unit in raw_units:
            unit = _normalize_unit(raw_unit)
            per_unit[unit] = {"view": True, "fill": raw_permissions.get("fill", False),
                              "summary": raw_permissions.get("summary", enabled)}
    if not enabled:
        per_unit.clear()
    if enabled and not per_unit:
        raise ValueError("Adicione pelo menos uma unidade à Produção Agrícola.")
    per_unit = {code: per_unit[code] for code in ALLOWED_UNIT_CODES if code in per_unit}
    configure = enabled and raw_permissions.get("configure", False)
    if configure and set(per_unit) != set(ALLOWED_UNIT_CODES):
        raise ValueError("A configuração global exige acesso às quatro unidades.")
    return {
        "enabled": enabled,
        "permissions": {"view": enabled, "fill": any(p["fill"] for p in per_unit.values()),
                        "configure": configure, "summary": any(p["summary"] for p in per_unit.values())},
        "units": list(per_unit),
        "unit_permissions": per_unit,
    }


def write_user_access(conn: sqlite3.Connection, user_id: int, access: dict[str, Any], *, now: int | None = None) -> None:
    timestamp = int(now if now is not None else time.time())
    permissions = access["permissions"]
    conn.execute(
        """
        INSERT INTO user_module_permissions(user_id,module_key,can_view,can_fill,can_configure,updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id,module_key) DO UPDATE SET
            can_view=excluded.can_view, can_fill=excluded.can_fill,
            can_configure=excluded.can_configure, updated_at=excluded.updated_at
        """,
        (user_id, MODULE_KEY, int(permissions["view"]), int(permissions["fill"]), int(permissions["configure"]), timestamp),
    )
    conn.execute(
        """INSERT INTO user_module_permissions(user_id,module_key,can_view,can_fill,updated_at)
           VALUES (?, 'production_daily_summary', ?, ?, ?) ON CONFLICT(user_id,module_key) DO UPDATE SET
           can_view=excluded.can_view,can_fill=excluded.can_fill,updated_at=excluded.updated_at""",
        (user_id, int(permissions["view"]), int(permissions["summary"]), timestamp),
    )
    conn.execute("DELETE FROM user_module_units WHERE user_id=? AND module_key=?", (user_id, MODULE_KEY))
    for unit, flags in access["unit_permissions"].items():
        conn.execute(
            """INSERT INTO user_module_units(user_id,module_key,unit_code,can_fill,can_summary,updated_at)
               VALUES (?,?,?,?,?,?)""",
            (user_id, MODULE_KEY, unit, int(flags["fill"]), int(flags["summary"]), timestamp),
        )


def _unit_access_from_conn(conn: sqlite3.Connection, user_id: int, *, schema: str = "") -> dict[str, dict[str, bool]]:
    """Colunas NULL significam permissões legadas (herdam as regras globais)."""
    permission = conn.execute(
        f"SELECT can_fill FROM {schema}user_module_permissions WHERE user_id=? AND module_key=?",
        (user_id, MODULE_KEY),
    ).fetchone()
    old_fill = bool(permission and permission["can_fill"])
    old_summary = _can_update_summary(conn, user_id, schema=schema)
    rows = conn.execute(
        f"SELECT unit_code,can_fill,can_summary FROM {schema}user_module_units WHERE user_id=? AND module_key=?",
        (user_id, MODULE_KEY),
    )
    available = {row["unit_code"]: {"view": True,
        "fill": old_fill if row["can_fill"] is None else bool(row["can_fill"]),
        "summary": old_summary if row["can_summary"] is None else bool(row["can_summary"])}
        for row in rows if row["unit_code"] in ALLOWED_UNIT_CODES}
    return {unit: available[unit] for unit in ALLOWED_UNIT_CODES if unit in available}


def _access_from_conn(conn: sqlite3.Connection, user_id: int, *, role: str | None = None) -> dict[str, Any]:
    if role is None:
        row = conn.execute("SELECT role FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise ValueError("Usuário não encontrado.")
        role = row["role"]
    if role == "admin":
        return {
            "enabled": True,
            "admin": True,
            "permissions": {"view": True, "fill": True, "configure": True, "summary": True},
            "units": list(ALLOWED_UNIT_CODES),
            "unit_permissions": {unit: {"view": True, "fill": True, "summary": True} for unit in ALLOWED_UNIT_CODES},
        }
    permission = conn.execute(
        "SELECT can_view,can_configure FROM user_module_permissions WHERE user_id=? AND module_key=?",
        (user_id, MODULE_KEY),
    ).fetchone()
    enabled = bool(permission and permission["can_view"])
    per_unit = _unit_access_from_conn(conn, user_id) if enabled else {}
    return {
        "enabled": enabled,
        "admin": False,
        "permissions": {"view": enabled, "fill": any(p["fill"] for p in per_unit.values()),
                        "configure": bool(enabled and permission and permission["can_configure"]),
                        "summary": any(p["summary"] for p in per_unit.values())},
        "units": list(per_unit),
        "unit_permissions": per_unit,
    }


def get_user_access(user_id: int) -> dict[str, Any]:
    with auth_connection() as conn:
        return _access_from_conn(conn, user_id)


def save_user_access(user_id: int, payload: Any, *, actor_id: int) -> dict[str, Any]:
    access = normalize_user_access(payload)
    with auth_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        from .module_access import _validate_manager, validate_delegated_grants
        _validate_manager(conn, user_id, actor_id)
        target = conn.execute("SELECT role FROM users WHERE id=?", (user_id,)).fetchone()
        # O endpoint legado altera somente a Produção, não outros módulos.
        validate_delegated_grants(conn, actor_id, {}, access)
        write_user_access(conn, user_id, access)
        return _access_from_conn(conn, user_id, role=target["role"])


def access_summary(access: dict[str, Any]) -> str:
    if not access.get("enabled"):
        return "Produção Agrícola: sem acesso"
    units = ", ".join(access.get("units") or []) or "sem unidades"
    suffix = " · preenchimento liberado" if access.get("permissions", {}).get("fill") else " · somente consulta"
    return f"Produção Agrícola: {units}{suffix}"


def decorate_user_payload(conn: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    access = _access_from_conn(conn, int(payload["id"]), role=str(payload.get("role") or ""))
    payload["production_access"] = access
    payload["access_summary"] = access_summary(access)
    return payload


def _require_access(conn: sqlite3.Connection, user_id: int, *, permission: str = "view", unit: str | None = None) -> dict[str, Any]:
    row = conn.execute("SELECT id,role,is_active FROM auth.users WHERE id=?", (user_id,)).fetchone()
    if not row or not bool(row["is_active"]):
        raise PermissionError("Autenticação necessária.")
    if row["role"] == "admin":
        return {"role": "admin", "units": list(ALLOWED_UNIT_CODES), "can_fill": True,
                "can_summary": True, "can_configure": True}
    permission_row = conn.execute(
        "SELECT can_view,can_configure FROM auth.user_module_permissions WHERE user_id=? AND module_key=?",
        (user_id, MODULE_KEY),
    ).fetchone()
    if not permission_row or not bool(permission_row["can_view"]):
        raise PermissionError("Você não possui acesso à Produção Agrícola.")
    per_unit = _unit_access_from_conn(conn, user_id, schema="auth.")
    if unit is not None and unit not in per_unit:
        raise PermissionError(f"A unidade {unit} não está liberada para este usuário.")
    selected = per_unit.get(unit) if unit else None
    can_fill = selected["fill"] if selected else any(p["fill"] for p in per_unit.values())
    can_summary = selected["summary"] if selected else any(p["summary"] for p in per_unit.values())
    if permission == "fill" and not can_fill:
        raise PermissionError("Você possui acesso somente para consulta nesta unidade da Produção Agrícola.")
    if permission == "summary" and not can_summary:
        raise PermissionError("Você não possui permissão para atualizar o resumo diário desta unidade.")
    return {"role": row["role"], "units": list(per_unit), "can_fill": can_fill,
            "can_summary": can_summary, "can_configure": bool(permission_row["can_configure"])}


def _can_update_summary(conn: sqlite3.Connection, user_id: int, *, schema: str = "") -> bool:
    row = conn.execute(
        f"SELECT can_fill FROM {schema}user_module_permissions WHERE user_id=? AND module_key='production_daily_summary'",
        (user_id,),
    ).fetchone()
    return bool(row["can_fill"]) if row is not None else True  # legado mantido


def _require_configure(conn: sqlite3.Connection, user_id: int) -> None:
    access = _require_access(conn, user_id)
    if not access["can_configure"] or set(access["units"]) != set(ALLOWED_UNIT_CODES):
        raise PermissionError("A configuração da Produção Agrícola requer permissão global e todas as unidades.")


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
            "can_configure": access["can_configure"],
        }


def save_status(user_id: int, payload: Any, *, status_id: int | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Dados do status inválidos.")
    name = _clean_text(payload.get("name"), "o nome do status", 80, required=True)
    style_key = str(payload.get("style_key") or "waiting").strip().lower()
    if style_key not in STATUS_STYLE_KEYS:
        raise ValueError("Cor do status inválida.")
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
        used = conn.execute(
            "SELECT COUNT(*) FROM production_daily_entries WHERE status=? COLLATE NOCASE",
            (row["code"],),
        ).fetchone()[0]
        if int(used or 0) > 0:
            raise ValueError("Não é possível apagar este status porque ele já foi usado em lançamentos. O histórico foi preservado.")
        remaining = conn.execute("SELECT COUNT(*) FROM production_statuses WHERE id<>? AND is_active=1", (status_id,)).fetchone()[0]
        if int(remaining or 0) < 1:
            raise ValueError("Mantenha ao menos um status disponível para os lançamentos.")
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
            SELECT f.id,f.group_id,f.name,f.display_style,f.position,f.is_active
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
                               group_id,name,display_style,position,is_active,created_by,updated_by,created_at,updated_at
                           ) VALUES (?,?,?,?,?,?,?,?,?)""",
                        (group_id, name, display_style, position, int(is_active), user_id, user_id, now, now),
                    )
                    front_id = int(cursor.lastrowid)
                else:
                    if not conn.execute("SELECT 1 FROM production_service_fronts WHERE id=?", (front_id,)).fetchone():
                        raise ValueError("Frente/serviço não encontrada.")
                    conn.execute(
                        """UPDATE production_service_fronts
                           SET group_id=?,name=?,display_style=?,position=?,is_active=?,updated_by=?,updated_at=? WHERE id=?""",
                        (group_id, name, display_style, position, int(is_active), user_id, now, front_id),
                    )
            except sqlite3.IntegrityError as exc:
                raise ValueError("Já existe uma frente/serviço com esse nome.") from exc
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


def list_sector_options(user_id: int, unit_code: Any, sector: Any) -> list[dict[str, str]]:
    unit = _normalize_unit(unit_code)
    cleaned_sector = _clean_text(sector, "o setor", 32, required=True)
    with connection() as conn:
        _require_access(conn, user_id, unit=unit)
        rows = conn.execute(
            """SELECT sector,section,description FROM sector_base
               WHERE sector=? COLLATE NOCASE ORDER BY section COLLATE NOCASE""",
            (cleaned_sector,),
        ).fetchall()
        return [
            {"sector": row["sector"], "section": row["section"] or "", "farm": row["description"] or ""}
            for row in rows
        ]


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


def _entry_payload(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": int(row["id"]), "work_date": row["work_date"], "sector": row["sector"] or "",
        "section": row["section"] or "", "farm": row["farm"] or "", "status": row["status"],
        "observation": row["observation"] or "", "changes": row["changes"] or "",
        "updated_at": int(row["updated_at"] or 0),
        "updated_by": row["updated_by"], "updated_by_name": row["updated_by_name"] or "Usuário removido",
    }


def list_my_items(user_id: int, unit_code: Any, work_date: Any, *, scope: str = "mine") -> dict[str, Any]:
    unit = _normalize_unit(unit_code)
    selected_date = _normalize_work_date(work_date)
    normalized_scope = str(scope or "mine").strip().lower()
    if normalized_scope not in {"mine", "all"}:
        raise ValueError("Visualização da Produção Agrícola inválida.")

    with connection() as conn:
        access = _require_access(conn, user_id, unit=unit)
        filters = ["ui.unit_code=?", "ui.is_active=1"]
        params: list[Any] = [unit]
        if normalized_scope == "mine":
            filters.insert(0, "ui.owner_user_id=?")
            params.insert(0, user_id)

        rows = conn.execute(
            f"""
            SELECT ui.id AS item_id,ui.owner_user_id,ui.service_front_id,ui.position,
                   f.name AS service_name,f.display_style,f.is_active AS service_active,
                   g.id AS group_id,g.name AS group_name,g.is_active AS group_active,
                   COALESCE(owner.name, 'Usuário removido') AS owner_name
            FROM production_user_items ui
            JOIN production_service_fronts f ON f.id=ui.service_front_id
            JOIN production_groups g ON g.id=f.group_id
            LEFT JOIN auth.users owner ON owner.id=ui.owner_user_id
            WHERE {' AND '.join(filters)}
            ORDER BY g.position,g.id,f.position,f.id,owner.name COLLATE NOCASE,ui.position,ui.id
            """,
            tuple(params),
        ).fetchall()
        latest_entries = {
            row["user_item_id"]: row for row in conn.execute(
                """SELECT entry.*,actor.name AS updated_by_name FROM production_daily_entries entry
                   LEFT JOIN auth.users actor ON actor.id=entry.updated_by
                   JOIN (
                     SELECT user_item_id,MAX(work_date) AS work_date
                     FROM production_daily_entries
                     WHERE unit_code=? AND work_date<=? AND user_item_id IS NOT NULL
                     GROUP BY user_item_id
                   ) newest ON newest.user_item_id=entry.user_item_id
                           AND newest.work_date=entry.work_date
                   WHERE entry.unit_code=?""",
                (unit, selected_date, unit),
            )
        }
        items = []
        for row in rows:
            latest = latest_entries.get(row["item_id"])
            entry = _entry_payload(latest)
            owner_user_id = int(row["owner_user_id"])
            items.append({
                "id": int(row["item_id"]), "owner_user_id": owner_user_id,
                "owner_name": row["owner_name"], "is_own": owner_user_id == int(user_id),
                "service_front_id": int(row["service_front_id"]),
                "service_name": row["service_name"], "display_style": row["display_style"],
                "group_id": int(row["group_id"]), "group_name": row["group_name"],
                "catalog_active": bool(row["service_active"]) and bool(row["group_active"]),
                "entry": entry, "is_current_day": bool(entry and entry["work_date"] == selected_date),
            })
        return {
            "unit": unit, "work_date": selected_date, "scope": normalized_scope, "items": items,
            "permissions": {"view": True, "fill": bool(access["can_fill"]), "configure": access["can_configure"], "summary": access["can_summary"]},
        }


def _normalize_rain(value: Any, field: str) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"{field} deve ser um número entre 0 e 9999,9 mm.")
    try:
        amount = Decimal(str(value).strip().replace(",", "."))
    except InvalidOperation as exc:
        raise ValueError(f"{field} deve ser um número entre 0 e 9999,9 mm.") from exc
    if not amount.is_finite() or amount < 0 or amount > Decimal("9999.9") or amount != amount.quantize(Decimal("0.1")):
        raise ValueError(f"{field} deve ser um número entre 0 e 9999,9 mm, com uma casa decimal.")
    return float(amount)


def _summary_payload(row: sqlite3.Row | None, unit: str, work_date: str) -> dict[str, Any]:
    return {
        "unit": unit, "work_date": work_date,
        "rain_turn_mm": row["rain_turn_mm"] if row else None,
        "rain_accumulated_mm": row["rain_accumulated_mm"] if row else None,
        "changes": row["changes"] if row else "",
        "updated_at": int(row["updated_at"]) if row else 0,
    }


def get_daily_summary(user_id: int, unit_code: Any, work_date: Any) -> dict[str, Any]:
    unit = _normalize_unit(unit_code)
    selected_date = _normalize_work_date(work_date)
    with connection() as conn:
        _require_access(conn, user_id, unit=unit)
        row = conn.execute(
            "SELECT * FROM production_daily_summaries WHERE unit_code=? AND work_date=?",
            (unit, selected_date),
        ).fetchone()
        return _summary_payload(row, unit, selected_date)


def save_daily_summary(user_id: int, payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Dados do resumo diário inválidos.")
    unit = _normalize_unit(payload.get("unit_code"))
    selected_date = _normalize_work_date(payload.get("work_date"))
    rain_turn = _normalize_rain(payload.get("rain_turn_mm"), "Chuva do turno")
    rain_accumulated = _normalize_rain(payload.get("rain_accumulated_mm"), "Chuva acumulada")
    changes_provided = "changes" in payload
    changes = _clean_text(payload.get("changes"), "as mudanças", 2000)
    now = int(time.time())
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_access(conn, user_id, permission="summary", unit=unit)
        validate_actor(conn, user_id)
        conn.execute(
            """INSERT INTO production_daily_summaries(
                unit_code,work_date,rain_turn_mm,rain_accumulated_mm,changes,updated_by,updated_at
            ) VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(unit_code,work_date) DO UPDATE SET
                rain_turn_mm=excluded.rain_turn_mm,
                rain_accumulated_mm=excluded.rain_accumulated_mm,
                changes=CASE WHEN ? THEN excluded.changes ELSE production_daily_summaries.changes END,
                updated_by=excluded.updated_by,updated_at=excluded.updated_at""",
            (unit, selected_date, rain_turn, rain_accumulated, changes, user_id, now, changes_provided),
        )
        row = conn.execute(
            "SELECT * FROM production_daily_summaries WHERE unit_code=? AND work_date=?",
            (unit, selected_date),
        ).fetchone()
        return _summary_payload(row, unit, selected_date)


def _normalize_entry_data(payload: dict[str, Any]) -> dict[str, str]:
    return {
        "work_date": _normalize_work_date(payload.get("work_date")),
        "sector": _clean_text(payload.get("sector"), "o setor", 32, required=True),
        "section": _clean_text(payload.get("section"), "a seção", 32),
        "farm": _clean_text(payload.get("farm"), "a fazenda", 160),
        "status": _normalize_status(payload.get("status")),
        "observation": _clean_text(payload.get("observation"), "a observação", 2000),
        "changes": _clean_text(payload.get("changes"), "as mudanças", 2000),
    }


def _active_front_entries(conn: sqlite3.Connection, unit: str, front_id: int, work_date: str | None = None):
    return conn.execute(
        """SELECT ui.id,e.sector FROM production_user_items ui
           JOIN production_daily_entries e ON e.id=(
             SELECT latest.id FROM production_daily_entries latest
             WHERE latest.user_item_id=ui.id AND (? IS NULL OR latest.work_date<=?)
             ORDER BY latest.work_date DESC,latest.id DESC LIMIT 1
           )
           WHERE ui.unit_code=? AND ui.service_front_id=? AND ui.is_active=1
           ORDER BY e.work_date DESC,e.updated_at DESC,e.id DESC""",
        (work_date, work_date, unit, front_id),
    ).fetchall()


def _deactivate_items(conn: sqlite3.Connection, item_ids: list[int], now: int, work_date: str | None = None) -> None:
    conn.executemany(
        """UPDATE production_user_items SET is_active=0,updated_at=? WHERE id=?
           AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM production_daily_entries
                                        WHERE user_item_id=? AND work_date>?))""",
        [(now, item_id, work_date, item_id, work_date) for item_id in item_ids],
    )


def save_my_item(user_id: int, payload: Any, *, item_id: int | None = None) -> dict[str, Any]:
    return _save_my_items(user_id, payload, [payload], item_id=item_id)[0]


def save_my_items(user_id: int, payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise ValueError("Dados dos setores inválidos.")
    sectors = payload.get("sectors")
    if not isinstance(sectors, list) or not 1 <= len(sectors) <= 100:
        raise ValueError("Informe entre 1 e 100 setores por lançamento.")
    return _save_my_items(user_id, payload, sectors)


def _save_my_items(user_id: int, payload: Any, sectors: list[Any], *, item_id: int | None = None) -> list[dict[str, Any]]:
    """Grava um ou vários setores na mesma transação, preservando o histórico individual."""
    if not isinstance(payload, dict):
        raise ValueError("Dados do apontamento inválidos.")
    unit = _normalize_unit(payload.get("unit_code"))
    try:
        front_id = int(payload.get("service_front_id"))
    except (TypeError, ValueError) as exc:
        raise ValueError("Selecione a frente/serviço.") from exc
    entries = []
    seen = set()
    for sector in sectors:
        if not isinstance(sector, dict):
            raise ValueError("Dados do setor inválidos.")
        entry = _normalize_entry_data({**sector, "work_date": payload.get("work_date")})
        key = entry["sector"].upper()
        if key in seen:
            raise ValueError(f"O setor {entry['sector']} está repetido nesta frente.")
        seen.add(key)
        entries.append(entry)
    now = int(time.time())
    item_ids = []
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_access(conn, user_id, permission="fill", unit=unit)
        validate_actor(conn, user_id)
        front = _catalog_front_for_unit(conn, front_id, unit, allow_inactive=item_id is not None)
        existing = _active_front_entries(conn, unit, front_id, entries[0]["work_date"])
        existing_sectors = {}
        for row in existing:
            existing_sectors.setdefault(row["sector"].strip().upper(), []).append(row["id"])
        for entry, source in zip(entries, sectors):
            entry["status"] = _validate_status_code(conn, entry["status"])
            matching_ids = existing_sectors.get(entry["sector"].upper(), [])
            if item_id is not None and matching_ids and item_id not in matching_ids:
                raise ValueError(f"O setor {entry['sector']} já está cadastrado nesta frente. Edite o lançamento existente.")
            target_id = item_id if item_id is not None else next(iter(matching_ids), None)
            if target_id is not None and any(field not in source for field in ("observation", "changes")):
                previous = conn.execute(
                    """SELECT observation,changes FROM production_daily_entries
                       WHERE user_item_id=? AND work_date<=? ORDER BY work_date DESC,id DESC LIMIT 1""",
                    (target_id, entry["work_date"]),
                ).fetchone()
                if previous:
                    for field in ("observation", "changes"):
                        if field not in source:
                            entry[field] = previous[field] or ""
            saved_id = _save_my_item(conn, user_id, unit, front_id, front, entry, now, item_id=target_id)
            item_ids.append(saved_id)
            # Personal copies left by older releases must not remain as active positions.
            # Keep all entries, and never retire a copy with a later work date.
            duplicate_ids = [candidate for candidate in matching_ids if candidate != saved_id]
            _deactivate_items(conn, duplicate_ids, now, entry["work_date"])
    result = list_my_items(user_id, unit, entries[0]["work_date"], scope="all")
    by_id = {item["id"]: item for item in result["items"]}
    return [by_id[saved_id] for saved_id in item_ids]


def _save_my_item(
    conn: sqlite3.Connection, user_id: int, unit: str, front_id: int,
    front: sqlite3.Row, entry: dict[str, str], now: int, *, item_id: int | None = None,
) -> int:
    owner_id = user_id
    if item_id is None:
        position = conn.execute(
            "SELECT COALESCE(MAX(position),-1)+1 FROM production_user_items WHERE owner_user_id=? AND unit_code=? AND is_active=1",
            (user_id, unit),
        ).fetchone()[0]
        cursor = conn.execute(
            """INSERT INTO production_user_items(owner_user_id,unit_code,service_front_id,position,is_active,created_at,updated_at)
               VALUES (?,?,?,?,1,?,?)""",
            (user_id, unit, front_id, int(position or 0), now, now),
        )
        item_id = int(cursor.lastrowid)
    else:
        item = conn.execute(
            "SELECT id,unit_code,owner_user_id FROM production_user_items WHERE id=? AND is_active=1",
            (item_id,),
        ).fetchone()
        if not item:
            raise ValueError("Lançamento da frente não encontrado.")
        _require_access(conn, user_id, permission="fill", unit=item["unit_code"])
        owner_id = item["owner_user_id"]
        if item["unit_code"] != unit:
            raise ValueError("A unidade de uma frente já salva não pode ser alterada. Remova e adicione novamente.")
        conn.execute(
            "UPDATE production_user_items SET service_front_id=?,updated_at=? WHERE id=?",
            (front_id, now, item_id),
        )

    conn.execute(
        """
        INSERT INTO production_daily_entries(
            work_date,user_item_id,owner_user_id,unit_code,service_front_id,service_name,group_name,display_style,
            sector,section,farm,status,observation,changes,created_by,updated_by,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(work_date,user_item_id) DO UPDATE SET
            unit_code=excluded.unit_code,
            service_front_id=excluded.service_front_id, service_name=excluded.service_name,
            group_name=excluded.group_name, display_style=excluded.display_style,
            sector=excluded.sector, section=excluded.section, farm=excluded.farm,
            status=excluded.status, observation=excluded.observation, changes=excluded.changes,
            updated_by=excluded.updated_by, updated_at=excluded.updated_at
        """,
        (
            entry["work_date"], item_id, owner_id, unit, front_id, front["name"], front["group_name"], front["display_style"],
            entry["sector"], entry["section"], entry["farm"], entry["status"], entry["observation"], entry["changes"],
            user_id, user_id, now, now,
        ),
    )
    return item_id


def remove_my_item(user_id: int, item_id: int) -> None:
    now = int(time.time())
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        item = conn.execute(
            "SELECT id,unit_code,service_front_id FROM production_user_items WHERE id=? AND is_active=1",
            (item_id,),
        ).fetchone()
        if not item:
            raise ValueError("Lançamento da frente não encontrado.")
        _require_access(conn, user_id, permission="fill", unit=item["unit_code"])
        entries = _active_front_entries(conn, item["unit_code"], item["service_front_id"])
        target = next((entry for entry in entries if entry["id"] == item_id), None)
        item_ids = [entry["id"] for entry in entries if target and entry["sector"].strip().upper() == target["sector"].strip().upper()]
        _deactivate_items(conn, item_ids or [item_id], now)


def detach_user_data_before_delete(conn: sqlite3.Connection, user_id: int) -> None:
    """Preserva o histórico e remove somente a lista pessoal do usuário excluído."""
    conn.execute("UPDATE production_daily_entries SET owner_user_id=NULL WHERE owner_user_id=?", (user_id,))
    conn.execute("DELETE FROM production_user_items WHERE owner_user_id=?", (user_id,))
