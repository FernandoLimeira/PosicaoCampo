"""Mudanças de área: layouts de colhedoras por frente e apontamentos de solo úmido."""
import sqlite3
import time
from datetime import date
from typing import Any

from .constants import ALLOWED_UNIT_CODES, UNIT_DEFINITIONS
from .storage import connection, validate_actor


def _seed_return_layouts(conn: sqlite3.Connection) -> None:
    """Carga inicial do layout PPT informado para a análise de retornos."""
    now = int(time.time())
    seed = {
        "02": ("Frente 02", [4300157, 4300155, 4300153, 4300161]),
        "03": ("Frente 03", [4300174, 4300175, 4300264]),
        "04": ("Frente 04", [4300270, 4300269, 4300271]),
        "05": ("Frente 05", [4300162, 4300163, 4300265, 4300266]),
        "06": ("Frente 06", [4300190, 4300267, 4300189, 4300191]),
        "07": ("Frente 07", [4300268, 4300167]),
    }
    for position, (front_code, (front_name, equipments)) in enumerate(seed.items()):
        conn.execute(
            """
            INSERT OR IGNORE INTO return_analysis_fronts (
                unit_code, front_code, front_name, position, updated_by, updated_at
            ) VALUES (?, ?, ?, ?, NULL, ?)
            """,
            ("PPT", front_code, front_name, position, now),
        )
        for equipment in equipments:
            conn.execute(
                """
                INSERT OR IGNORE INTO return_analysis_equipment (
                    unit_code, front_code, equipment, updated_by, updated_at
                ) VALUES (?, ?, ?, NULL, ?)
                """,
                ("PPT", front_code, int(equipment), now),
            )


def _normalize_return_front_code(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("Informe o código da frente.")
    if len(text) > 12:
        raise ValueError("O código da frente deve ter no máximo 12 caracteres.")
    if text.isdigit():
        text = text.zfill(2)
    return text


def _normalize_return_equipment(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("Equipamento inválido.")
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError("Equipamento inválido.") from exc
    if number <= 0 or number > 999_999_999:
        raise ValueError("Equipamento inválido.")
    return number


def list_return_analysis_layouts(unit_code: str | None = None) -> dict[str, Any]:
    requested = str(unit_code or "").strip().upper()
    if requested and requested not in ALLOWED_UNIT_CODES:
        raise ValueError("Unidade inválida.")
    unit_codes = [requested] if requested else list(ALLOWED_UNIT_CODES)

    with connection() as conn:
        front_rows = conn.execute(
            """
            SELECT unit_code, front_code, front_name, position, updated_at
            FROM return_analysis_fronts
            WHERE unit_code IN ({})
            ORDER BY CASE unit_code WHEN 'PPT' THEN 0 WHEN 'NRD' THEN 1 WHEN 'RBR' THEN 2 WHEN 'PST' THEN 3 ELSE 99 END,
                     position ASC, front_code COLLATE NOCASE ASC
            """.format(",".join("?" for _ in unit_codes)),
            unit_codes,
        ).fetchall()
        equipment_rows = conn.execute(
            """
            SELECT unit_code, front_code, equipment
            FROM return_analysis_equipment
            WHERE unit_code IN ({})
            ORDER BY equipment ASC
            """.format(",".join("?" for _ in unit_codes)),
            unit_codes,
        ).fetchall()

    equipment_map: dict[tuple[str, str], list[int]] = {}
    for row in equipment_rows:
        equipment_map.setdefault((row["unit_code"], row["front_code"]), []).append(int(row["equipment"]))

    fronts_map: dict[str, list[dict[str, Any]]] = {code: [] for code in unit_codes}
    for row in front_rows:
        fronts_map.setdefault(row["unit_code"], []).append({
            "code": row["front_code"],
            "name": row["front_name"],
            "equipment": equipment_map.get((row["unit_code"], row["front_code"]), []),
            "updated_at": int(row["updated_at"] or 0),
        })

    units = [
        {
            "code": code,
            "name": UNIT_DEFINITIONS[code]["name"],
            "fronts": fronts_map.get(code, []),
        }
        for code in unit_codes
    ]
    return {"units": units}


def save_return_analysis_layouts(unit_code: Any, fronts: Any, user_id: int) -> dict[str, Any]:
    code = str(unit_code or "").strip().upper()
    if code not in ALLOWED_UNIT_CODES:
        raise ValueError("Unidade inválida.")
    if not isinstance(fronts, list) or len(fronts) > 100:
        raise ValueError("Lista de frentes inválida.")

    normalized: list[dict[str, Any]] = []
    seen_fronts: set[str] = set()
    seen_equipment: dict[int, str] = {}
    for position, raw_front in enumerate(fronts):
        if not isinstance(raw_front, dict):
            raise ValueError("Frente inválida.")
        front_code = _normalize_return_front_code(raw_front.get("code"))
        key = front_code.casefold()
        if key in seen_fronts:
            raise ValueError(f"A frente {front_code} está duplicada.")
        seen_fronts.add(key)
        front_name = str(raw_front.get("name") or f"Frente {front_code}").strip()
        if not front_name or len(front_name) > 80:
            raise ValueError("Nome da frente inválido.")
        raw_equipment = raw_front.get("equipment", [])
        if not isinstance(raw_equipment, list) or len(raw_equipment) > 100:
            raise ValueError(f"Layout da {front_name} inválido.")
        equipments: list[int] = []
        for raw_value in raw_equipment:
            equipment = _normalize_return_equipment(raw_value)
            owner = seen_equipment.get(equipment)
            if owner and owner != front_code:
                raise ValueError(f"A colhedora {equipment} já está cadastrada na frente {owner}.")
            seen_equipment[equipment] = front_code
            if equipment not in equipments:
                equipments.append(equipment)
        normalized.append({
            "code": front_code,
            "name": front_name,
            "equipment": sorted(equipments),
            "position": position,
        })

    now = int(time.time())
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        validate_actor(conn, user_id)
        conn.execute("DELETE FROM return_analysis_equipment WHERE unit_code = ?", (code,))
        conn.execute("DELETE FROM return_analysis_fronts WHERE unit_code = ?", (code,))
        for front in normalized:
            conn.execute(
                """
                INSERT INTO return_analysis_fronts (
                    unit_code, front_code, front_name, position, updated_by, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (code, front["code"], front["name"], front["position"], user_id, now),
            )
            for equipment in front["equipment"]:
                conn.execute(
                    """
                    INSERT INTO return_analysis_equipment (
                        unit_code, front_code, equipment, updated_by, updated_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (code, front["code"], equipment, user_id, now),
                )
    return list_return_analysis_layouts(code)

def get_return_soil_wet_summary(unit_code: Any) -> dict[str, Any]:
    code = str(unit_code or "").strip().upper()
    if code not in ALLOWED_UNIT_CODES:
        raise ValueError("Unidade inválida.")
    with connection() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS records, COUNT(DISTINCT equipment) AS equipments,
                   MIN(operation_date) AS start_date, MAX(operation_date) AS end_date,
                   MAX(updated_at) AS updated_at
            FROM return_analysis_soil_wet
            WHERE unit_code = ?
            """,
            (code,),
        ).fetchone()
    return {
        "unit": code,
        "records": int(row["records"] or 0),
        "equipments": int(row["equipments"] or 0),
        "period": {"start": row["start_date"] or "", "end": row["end_date"] or ""},
        "updated_at": int(row["updated_at"] or 0),
    }


def list_return_soil_wet_records(unit_code: Any) -> list[dict[str, Any]]:
    code = str(unit_code or "").strip().upper()
    if code not in ALLOWED_UNIT_CODES:
        raise ValueError("Unidade inválida.")
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT equipment, operation_date, start_time, end_time, duration_seconds,
                   operation_code, operation_description, operation_group, sector, field, farm
            FROM return_analysis_soil_wet
            WHERE unit_code = ?
            ORDER BY operation_date, equipment, start_time, sector
            """,
            (code,),
        ).fetchall()
    return [
        {
            "equipment": int(row["equipment"]),
            "date": row["operation_date"],
            "start_time": row["start_time"],
            "end_time": row["end_time"],
            "duration_seconds": int(row["duration_seconds"] or 0),
            "operation_code": row["operation_code"] or "",
            "operation": row["operation_description"] or "",
            "operation_group": row["operation_group"] or "",
            "sector": int(row["sector"]) if row["sector"] is not None else None,
            "field": int(row["field"]) if row["field"] is not None else None,
            "farm": row["farm"] or "",
        }
        for row in rows
    ]


def import_return_soil_wet_records(
    unit_code: Any, records: Any, user_id: int, *, filename: str = ""
) -> dict[str, Any]:
    code = str(unit_code or "").strip().upper()
    if code not in ALLOWED_UNIT_CODES:
        raise ValueError("Unidade inválida.")
    if not isinstance(records, list) or len(records) > 200_000:
        raise ValueError("Lista de apontamentos inválida.")

    # Valida tudo antes de abrir a transação: um registro ruim não segura o
    # bloqueio de escrita de dados.db nem vira erro 500 (KeyError/TypeError).
    prepared: list[tuple[str, tuple[Any, ...]]] = []
    for position, item in enumerate(records, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Apontamento {position} inválido.")
        record_key = str(item.get("record_key") or "").strip()
        if not record_key:
            raise ValueError(f"Apontamento {position} sem chave de identificação.")
        try:
            operation_date = str(item["date"])
            date.fromisoformat(operation_date)
            values = (
                str(item.get("source_front") or "").strip(),
                int(item["equipment"]),
                operation_date,
                str(item["start_time"]),
                str(item["end_time"]),
                max(0, int(item.get("duration_seconds") or 0)),
                str(item.get("operation_code") or "").strip(),
                str(item.get("operation") or "SOLO UMIDO").strip(),
                str(item.get("operation_group") or "").strip(),
                int(item["sector"]) if item.get("sector") is not None else None,
                int(item["field"]) if item.get("field") is not None else None,
                str(item.get("farm") or "").strip(),
                str(filename or "").strip(),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"Apontamento {position} com dados inválidos.") from exc
        prepared.append((record_key, values))

    columns = (
        "source_front", "equipment", "operation_date", "start_time", "end_time", "duration_seconds",
        "operation_code", "operation_description", "operation_group", "sector", "field", "farm", "import_file",
    )
    now = int(time.time())
    inserts: list[tuple[Any, ...]] = []
    updates: list[tuple[Any, ...]] = []
    unchanged = 0
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        validate_actor(conn, user_id)
        # Uma leitura da unidade inteira em vez de um SELECT por linha.
        existing = {
            row["record_key"]: tuple(row[column] for column in columns)
            for row in conn.execute(
                f"SELECT record_key, {', '.join(columns)} FROM return_analysis_soil_wet WHERE unit_code = ?",
                (code,),
            )
        }
        for record_key, values in prepared:
            current = existing.get(record_key)
            if current is None:
                inserts.append((code, record_key, *values, user_id, now))
                existing[record_key] = values
            elif current == values:
                unchanged += 1
            else:
                updates.append((*values, user_id, now, code, record_key))
                existing[record_key] = values
        conn.executemany(
            """
            INSERT INTO return_analysis_soil_wet (
                unit_code, record_key, source_front, equipment, operation_date, start_time, end_time,
                duration_seconds, operation_code, operation_description, operation_group, sector, field, farm,
                import_file, updated_by, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            inserts,
        )
        conn.executemany(
            """
            UPDATE return_analysis_soil_wet
            SET source_front=?, equipment=?, operation_date=?, start_time=?, end_time=?, duration_seconds=?,
                operation_code=?, operation_description=?, operation_group=?, sector=?, field=?, farm=?,
                import_file=?, updated_by=?, updated_at=?
            WHERE unit_code=? AND record_key=?
            """,
            updates,
        )
    inserted = len(inserts)
    updated = len(updates)

    return {
        "imported": {
            "received": len(records),
            "inserted": inserted,
            "updated": updated,
            "unchanged": unchanged,
        },
        "summary": get_return_soil_wet_summary(code),
    }
