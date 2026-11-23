"""Produção Agrícola: permissões por unidade (consultar, preencher, resumo diário) e configuração global."""
from __future__ import annotations

import sqlite3
import time
from typing import Any

from ..constants import ALLOWED_UNIT_CODES
from ..storage import auth_connection
from .common import MODULE_KEY, _normalize_unit


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
        # Import local: module_access depende deste módulo no nível superior.
        from ..module_access import _validate_manager, validate_delegated_grants
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
