"""Produção Agrícola: escala de responsáveis por frente (cargos, ciclos, folgas e substituições)."""
from __future__ import annotations

import sqlite3
import time
from datetime import date
from typing import Any

from ...services.operational_shifts import SHIFT_MINUTES
from ..constants import ALLOWED_UNIT_CODES
from ..storage import DEFAULT_PRODUCTION_RESPONSIBILITY_ROLE_ID, connection, validate_actor
from .common import _clean_text, _normalize_unit, _normalize_work_date
from .access import _require_access
from .catalog import _catalog_front_for_unit

_SCHEDULE_FIELDS = ("kind", "role_id", "shift", "work_date", "responsible_name", "relief_name")


def _responsibility_permissions(access: dict[str, Any]) -> dict[str, bool]:
    configure = access["can_configure"] and set(access["units"]) == set(ALLOWED_UNIT_CODES)
    return {"edit_roles": configure, "edit_schedules": configure}


def _require_responsibility_edit(conn: sqlite3.Connection, user_id: int, action: str, *, unit: str | None = None) -> None:
    if not _responsibility_permissions(_require_access(conn, user_id, unit=unit))[action]:
        raise PermissionError("Você não possui permissão para alterar este cadastro.")


def get_responsibility_catalog(user_id: int, unit_code: Any) -> dict[str, Any]:
    unit = _normalize_unit(unit_code)
    with connection() as conn:
        access = _require_access(conn, user_id, unit=unit)
        roles = [dict(row) for row in conn.execute(
            "SELECT id,name,role_type FROM production_responsibility_roles ORDER BY role_type,id")]
        rules = [dict(row) for row in conn.execute(
            """SELECT r.id,r.service_front_id,r.role_id,r.shift,r.kind,r.work_date,r.responsible_name,r.relief_name,
                      f.name AS service_name,c.name AS role_name
               FROM production_front_responsibilities r
               JOIN production_service_fronts f ON f.id=r.service_front_id
               JOIN production_responsibility_roles c ON c.id=r.role_id
               WHERE r.unit_code=?
               ORDER BY r.work_date DESC,f.name COLLATE NOCASE,r.shift,r.id""",
            (unit,),
        )]
        return {"rules": rules, "roles": roles, "permissions": _responsibility_permissions(access)}


def save_responsibility_role(user_id: int, payload: Any, *, role_id: int | None = None) -> int:
    if not isinstance(payload, dict):
        raise ValueError("Dados do cargo inválidos.")
    name = _clean_text(payload.get("name"), "o nome do cargo", 80, required=True)
    role_type = payload.get("role_type")
    if role_type not in ("lead", "support"):
        raise ValueError("Selecione o tipo de atuação do cargo.")
    values = (name, role_type, user_id, int(time.time()))
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_responsibility_edit(conn, user_id, "edit_roles")
        validate_actor(conn, user_id)
        try:
            if role_id is None:
                cursor = conn.execute("""INSERT INTO production_responsibility_roles(name,role_type,updated_by,updated_at)
                                         VALUES (?,?,?,?)""", values)
                return int(cursor.lastrowid)
            cursor = conn.execute("""UPDATE production_responsibility_roles SET name=?,role_type=?,updated_by=?,updated_at=?
                                     WHERE id=?""", (*values, role_id))
        except sqlite3.IntegrityError as exc:
            raise ValueError("Já existe um cargo com esse nome.") from exc
        if not cursor.rowcount:
            raise ValueError("Cargo não encontrado.")
        return role_id


def save_responsibility_rule(user_id: int, payload: Any, *, rule_id: int | None = None) -> int:
    if not isinstance(payload, dict):
        raise ValueError("Escala inválida.")
    return _save_responsibility_rules(user_id, payload, [payload.get("service_front_id")], rule_id=rule_id)[0]


def save_responsibility_rules(user_id: int, payload: Any) -> list[int]:
    if not isinstance(payload, dict):
        raise ValueError("Escala inválida.")
    fronts = payload.get("service_front_ids")
    if not isinstance(fronts, list) or not fronts:
        raise ValueError("Selecione pelo menos uma frente ou serviço.")
    if any(type(front_id) is not int for front_id in fronts):
        raise ValueError("Frente/serviço inválida.")
    return _save_responsibility_rules(user_id, payload, fronts)


def update_responsibility_rules(user_id: int, payload: Any) -> list[int]:
    if not isinstance(payload, dict):
        raise ValueError("Escala inválida.")
    if "role_id" not in payload:
        raise ValueError("Selecione o cargo.")
    return _save_responsibility_rules(user_id, payload, None)


def _responsibility_update_targets(conn: sqlite3.Connection, unit: str, payload: dict) -> list[tuple[int, int]]:
    targets = payload.get("targets")
    previous = payload.get("previous")
    if not isinstance(targets, list) or not targets or not isinstance(previous, dict):
        raise ValueError("Selecione a escala que deseja alterar.")
    assignments = {}
    for target in targets:
        if not isinstance(target, dict):
            raise ValueError("Vínculo de frente inválido.")
        rule_id, front_id = target.get("id"), target.get("service_front_id")
        if any(type(value) is not int or not 0 < value < 2 ** 62 for value in (rule_id, front_id)) or rule_id in assignments:
            raise ValueError("Vínculo de frente inválido.")
        current = conn.execute(
            """SELECT service_front_id,kind,role_id,shift,work_date,responsible_name,relief_name
               FROM production_front_responsibilities WHERE unit_code=? AND id=?""", (unit, rule_id),
        ).fetchone()
        if not current or current["service_front_id"] != front_id or any(current[field] != previous.get(field) for field in _SCHEDULE_FIELDS):
            raise ValueError("Uma das escalas foi alterada. Atualize o cadastro e abra a escala novamente.")
        assignments[rule_id] = front_id
    return [(front_id, rule_id) for rule_id, front_id in assignments.items()]


def _save_responsibility_rules(user_id: int, payload: dict, front_ids: list | None, *, rule_id: int | None = None) -> list[int]:
    unit = _normalize_unit(payload.get("unit_code"))
    try:
        front_ids = list(dict.fromkeys(int(front_id) for front_id in front_ids)) if front_ids is not None else None
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Selecione a frente/serviço.") from exc
    if any(not 0 < front_id < 2 ** 62 for front_id in (front_ids or [])):
        raise ValueError("Frente/serviço inválida.")
    try:
        role_id = int(payload.get("role_id", DEFAULT_PRODUCTION_RESPONSIBILITY_ROLE_ID))
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Selecione o cargo.") from exc
    if not 0 < role_id < 2 ** 62:
        raise ValueError("Cargo inválido.")
    shift = str(payload.get("shift") or "").strip().upper()
    kind = payload.get("kind")
    if shift not in SHIFT_MINUTES or kind not in ("cycle", "fixed", "replacement", "day_off"):
        raise ValueError("Selecione o turno e o tipo de escala.")
    work_date = _normalize_work_date(payload.get("work_date"))
    name = _clean_text(payload.get("responsible_name"), "o responsável", 80, required=kind != "day_off")
    relief = _clean_text(payload.get("relief_name"), "o folguista", 80) if kind == "cycle" else ""
    if relief and relief.casefold() == name.casefold():
        raise ValueError("Titular e folguista devem ser pessoas diferentes.")
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_responsibility_edit(conn, user_id, "edit_schedules", unit=unit)
        targets = (_responsibility_update_targets(conn, unit, payload) if front_ids is None
                   else [(front_id, rule_id) for front_id in front_ids])
        if rule_id is not None and "role_id" not in payload:
            original = conn.execute("SELECT role_id FROM production_front_responsibilities WHERE unit_code=? AND id=?",
                                    (unit, rule_id)).fetchone()
            if original:
                role_id = original["role_id"]
        if not conn.execute("SELECT 1 FROM production_responsibility_roles WHERE id=?", (role_id,)).fetchone():
            raise ValueError("Cargo não encontrado.")
        saved = []
        now = int(time.time())
        for front_id, target_id in targets:
            front = _catalog_front_for_unit(conn, front_id, unit)
            values = (front_id, role_id, shift, kind, work_date, name, relief, user_id, now, unit)
            try:
                if target_id is None:
                    cursor = conn.execute(
                        """INSERT INTO production_front_responsibilities
                           (service_front_id,role_id,shift,kind,work_date,responsible_name,relief_name,updated_by,updated_at,unit_code)
                           VALUES (?,?,?,?,?,?,?,?,?,?)""", values,
                    )
                    saved.append(int(cursor.lastrowid))
                else:
                    cursor = conn.execute(
                        """UPDATE production_front_responsibilities SET service_front_id=?,role_id=?,shift=?,kind=?,work_date=?,
                           responsible_name=?,relief_name=?,updated_by=?,updated_at=? WHERE unit_code=? AND id=?""",
                        (*values, target_id),
                    )
                    if not cursor.rowcount:
                        raise ValueError("Escala não encontrada nesta unidade.")
                    saved.append(target_id)
            except sqlite3.IntegrityError as exc:
                raise ValueError(f"Já existe uma escala ou exceção do mesmo tipo para {front['name']}, neste cargo, turno e data.") from exc
        return saved


def delete_responsibility_rule(user_id: int, unit_code: Any, rule_id: int) -> None:
    unit = _normalize_unit(unit_code)
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_responsibility_edit(conn, user_id, "edit_schedules", unit=unit)
        if not conn.execute(
            "DELETE FROM production_front_responsibilities WHERE unit_code=? AND id=?", (unit, rule_id)
        ).rowcount:
            raise ValueError("Escala não encontrada nesta unidade.")


def _scheduled_responsibles(conn: sqlite3.Connection, unit: str, work_date: str) -> dict[int, dict[str, list[dict[str, Any]]]]:
    day = date.fromisoformat(work_date)
    assignments: dict[int, dict[str, dict[int, dict[str, Any]]]] = {}
    for row in conn.execute(
        """SELECT r.*,c.name AS role_name,c.role_type FROM production_front_responsibilities r
           JOIN production_service_front_units fu
             ON fu.service_front_id=r.service_front_id AND fu.unit_code=r.unit_code
           JOIN production_responsibility_roles c ON c.id=r.role_id
           WHERE r.unit_code=? AND ((r.kind IN ('cycle','fixed') AND r.work_date<=?)
                                    OR (r.kind IN ('replacement','day_off') AND r.work_date=?))
           ORDER BY c.role_type,c.id,(r.kind IN ('cycle','fixed')),r.work_date DESC""",
        (unit, work_date, work_date),
    ):
        roles = assignments.setdefault(row["service_front_id"], {}).setdefault(row["shift"], {})
        if row["role_id"] in roles:
            continue
        cycle_day_off = row["kind"] == "cycle" and (day - date.fromisoformat(row["work_date"])).days % 6 == 5
        roles[row["role_id"]] = {
            "role_id": row["role_id"], "role_name": row["role_name"], "role_type": row["role_type"],
            "name": row["relief_name"] if cycle_day_off else row["responsible_name"],
            "day_off": cycle_day_off or row["kind"] == "day_off",
        }
    return {front: {shift: list(roles.values()) for shift, roles in shifts.items()} for front, shifts in assignments.items()}
