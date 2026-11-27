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

_SCHEDULE_FIELDS = ("kind", "role_id", "shift", "work_date", "responsible_name", "relief_name",
                    "responsible_whatsapp", "relief_whatsapp")


# DDD de cada unidade: número digitado sem DDD usa o da unidade da escala.
UNIT_AREA_CODES = {"PPT": "18", "NRD": "18", "RBR": "67", "PST": "67"}


def normalize_whatsapp(value: Any, label: str, unit: str | None = None) -> str:
    """WhatsApp opcional: só os dígitos, com o DDI 55 ("(18) 99123-4567" -> "5518991234567").

    Aceita os jeitos comuns de escrever o número:
    - com DDI: "+55 67 99123-4567", "0055 67 99123-4567";
    - com DDD: "(67) 99123-4567", "67991234567", "067 99123-4567" (zero antes do DDD);
    - com código de operadora: "0 15 67 99123-4567", "015 67 99123-4567";
    - sem DDD: "99123-4567" (usa o DDD da unidade);
    - celular antigo, sem o 9: "(67) 9912-3456" vira "(67) 99912-3456".
    Celular tem 9 dígitos começando com 9; fixo tem 8 dígitos começando de 2 a 5.
    """
    digits = "".join(char for char in str(value or "") if char.isdigit())
    if not digits:
        return ""
    if digits.startswith("0055"):        # discagem internacional: 00 + 55 ...
        digits = digits[2:]
    if digits.startswith("55") and len(digits) in (12, 13):
        national = digits[2:]
    else:
        # Um zero antes do DDD ou da operadora; "00" sem o 55 é DDD inválido.
        national = digits[1:] if digits.startswith("0") and not digits.startswith("00") else digits
        if len(national) in (12, 13):    # código de operadora (2 dígitos) + DDD + número
            national = national[2:]
        if len(national) in (8, 9) and unit in UNIT_AREA_CODES:
            national = UNIT_AREA_CODES[unit] + national
    area, local = national[:2], national[2:]
    if len(local) == 8 and local[0] in "6789":  # celular escrito sem o 9 na frente
        local = "9" + local
    valid_area = len(area) == 2 and area[0] != "0" and area[1] != "0"
    valid_local = (len(local) == 9 and local[0] == "9") or (len(local) == 8 and local[0] in "2345")
    if len(national) not in (10, 11) or not valid_area or not valid_local:
        raise ValueError(f"WhatsApp {label} inválido ({value}). Informe com DDD, por exemplo (67) 99123-4567.")
    return "55" + area + local


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
                      r.responsible_whatsapp,r.relief_whatsapp,f.name AS service_name,c.name AS role_name
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
            f"""SELECT service_front_id,{",".join(_SCHEDULE_FIELDS)}
               FROM production_front_responsibilities WHERE unit_code=? AND id=?""", (unit, rule_id),
        ).fetchone()
        # WhatsApp ausente no "previous" (cliente antigo) vale como vazio.
        if not current or current["service_front_id"] != front_id or any(
                current[field] != previous.get(field, "" if field.endswith("whatsapp") else None)
                for field in _SCHEDULE_FIELDS):
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
    whatsapp = normalize_whatsapp(payload.get("responsible_whatsapp"), "do responsável", unit) if name else ""
    relief_whatsapp = normalize_whatsapp(payload.get("relief_whatsapp"), "do folguista", unit) if relief else ""
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
            values = (front_id, role_id, shift, kind, work_date, name, relief, whatsapp, relief_whatsapp, user_id, now, unit)
            try:
                if target_id is None:
                    cursor = conn.execute(
                        """INSERT INTO production_front_responsibilities
                           (service_front_id,role_id,shift,kind,work_date,responsible_name,relief_name,
                            responsible_whatsapp,relief_whatsapp,updated_by,updated_at,unit_code)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""", values,
                    )
                    saved.append(int(cursor.lastrowid))
                else:
                    cursor = conn.execute(
                        """UPDATE production_front_responsibilities SET service_front_id=?,role_id=?,shift=?,kind=?,work_date=?,
                           responsible_name=?,relief_name=?,responsible_whatsapp=?,relief_whatsapp=?,updated_by=?,updated_at=?
                           WHERE unit_code=? AND id=?""",
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
    # WhatsApp por pessoa na unidade (a escala mais recente com número): a mesma pessoa
    # cadastrada em outra escala sem o número também mostra o WhatsApp.
    phones: dict[str, str] = {}
    for row in conn.execute(
        """SELECT responsible_name,responsible_whatsapp,relief_name,relief_whatsapp
           FROM production_front_responsibilities WHERE unit_code=? ORDER BY updated_at,id""", (unit,),
    ):
        for name_field, phone_field in (("responsible_name", "responsible_whatsapp"), ("relief_name", "relief_whatsapp")):
            if row[name_field] and row[phone_field]:
                phones[row[name_field].strip().casefold()] = row[phone_field]
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
        name = row["relief_name"] if cycle_day_off else row["responsible_name"]
        phone = row["relief_whatsapp"] if cycle_day_off else row["responsible_whatsapp"]
        roles[row["role_id"]] = {
            "role_id": row["role_id"], "role_name": row["role_name"], "role_type": row["role_type"],
            "name": name, "whatsapp": (phone or phones.get(name.strip().casefold(), "")) if name else "",
            "day_off": cycle_day_off or row["kind"] == "day_off",
        }
    return {front: {shift: list(roles.values()) for shift, roles in shifts.items()} for front, shifts in assignments.items()}
