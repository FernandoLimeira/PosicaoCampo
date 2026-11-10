"""Posição de Campo: unidades, validação do formulário, versões e histórico.

Também espelha as frentes salvas na Sacarose (``_sync_sacarose_from_position_unit``),
porque a gravação da unidade e o espelhamento precisam da mesma transação.
"""
import json
import math
import re
import sqlite3
import time
from typing import Any

from .constants import ALLOWED_UNIT_CODES, MAX_SECTOR_LENGTH, METRIC_DEFINITIONS, UNIT_DEFINITIONS
from .storage import connection, validate_actor
from ..services.field_status import field_status, field_unit_border
from ..services.front_identifiers import position_front_key, standardize_rain_labels
from ..services.operational_shifts import shift_at, shift_period


class UnitConflictError(Exception):
    def __init__(self, current: dict[str, Any]):
        super().__init__("Esta unidade foi atualizada por outro usuário.")
        self.current = current


_NUMBER_RE = re.compile(r"\s*(-?[\d.,]+)")


def _parse_br_number(text: str) -> float | None:
    """Converte o número no início do texto aceitando formato pt-BR e decimal com ponto.

    "1.234,5" -> 1234.5; "12,5" -> 12.5; "1.5" -> 1.5; "1.234.567" -> 1234567.
    Retorna None quando o texto não começa por um número válido.
    """
    match = _NUMBER_RE.match(text)
    if not match:
        return None
    raw = match.group(1).rstrip(".,")
    if "," in raw and "." in raw:
        if raw.rfind(",") < raw.rfind("."):
            return None
        raw = raw.replace(".", "").replace(",", ".")
    elif raw.count(",") == 1:
        raw = raw.replace(",", ".")
    elif raw.count(",") > 1:
        return None
    elif raw.count(".") > 1:
        raw = raw.replace(".", "")
    try:
        return float(raw)
    except ValueError:
        return None


def _normalize_status(value: Any) -> str:
    return field_status(value)["label"]


def _nonnegative_number(value: Any, field: str) -> int | float:
    if isinstance(value, bool):
        raise ValueError(f"{field} inválido.")
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = str(value or "").strip()
        if text in {"", "-"}:
            number = 0.0
        else:
            parsed = _parse_br_number(text)
            if parsed is None:
                raise ValueError(f"{field} deve ser um número maior ou igual a zero.")
            number = parsed
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"{field} deve ser um número maior ou igual a zero.")
    return int(number) if number.is_integer() else number


def _metric_value_text(value: Any, unit: str) -> str:
    number = _nonnegative_number(value, "Valor do indicador")
    if isinstance(number, int):
        text = str(number)
    else:
        text = f"{number:.6f}".rstrip("0").rstrip(".")
    return f"{text} {unit}"


def _normalize_unit_payload(unit: dict[str, Any], position: int) -> dict[str, Any]:
    if not isinstance(unit, dict):
        raise ValueError("Unidade inválida.")

    code = str(unit.get("code", "")).strip().upper()
    definition = UNIT_DEFINITIONS.get(code)
    if not definition:
        raise ValueError("Unidade inválida.")
    if position != definition["position"]:
        raise ValueError("Posição da unidade inválida.")

    incoming_name = str(unit.get("name", "")).strip()
    if incoming_name and incoming_name.casefold() != definition["name"].casefold():
        raise ValueError("Nome da unidade inválido.")

    raw_rows = unit.get("rows", [])
    if not isinstance(raw_rows, list) or len(raw_rows) > 100:
        raise ValueError("Lista de frentes inválida.")
    rows: list[list[Any]] = []
    for raw_row in raw_rows:
        if not isinstance(raw_row, (list, tuple)) or len(raw_row) < 4:
            raise ValueError("Dados de frente inválidos.")
        front = str(raw_row[0] or "").strip()
        sector = str(raw_row[1] or "").strip()
        if len(front) > 12 or len(sector) > MAX_SECTOR_LENGTH:
            raise ValueError("Frente ou setor excede o tamanho permitido.")
        if not front and not sector:
            continue
        status = _normalize_status(raw_row[3])
        color = field_status(status)["color"]
        atr = str(raw_row[4] if len(raw_row) > 4 and raw_row[4] is not None else "").strip()
        if len(atr) > 12:
            raise ValueError("ATR excede o tamanho permitido.")
        rows.append([front, sector, color, status, atr])

    border = field_unit_border([row[3] for row in rows])

    raw_metrics = unit.get("metrics", [])
    metrics: list[list[str]] = []
    for index, (icon, label, metric_unit, extra) in enumerate(METRIC_DEFINITIONS):
        source = raw_metrics[index] if isinstance(raw_metrics, list) and index < len(raw_metrics) else []
        raw_value = source[2] if isinstance(source, (list, tuple)) and len(source) >= 3 else 0
        metrics.append([icon, label, _metric_value_text(raw_value, metric_unit), extra])

    observation = str(unit.get("observation", "-")).strip() or "-"
    changes = str(unit.get("changes", "-")).strip() or "-"
    if len(observation) > 10_000 or len(changes) > 10_000:
        raise ValueError("Apontamentos excedem o tamanho permitido.")
    observation_period = unit.get("observation_period")
    if observation_period is not None:
        if not isinstance(observation_period, dict):
            raise ValueError("Período da observação inválido.")
        shift_period(observation_period.get("work_date"), observation_period.get("shift"))
        last_note_id = observation_period.get("last_note_id")
        if last_note_id is not None and (isinstance(last_note_id, bool) or not isinstance(last_note_id, int) or not 0 <= last_note_id <= 2**63 - 1):
            raise ValueError("Referência dos acontecimentos inválida.")
        observation_period = {key: observation_period[key] for key in ("work_date", "shift")}
        if last_note_id is not None:
            observation_period["last_note_id"] = last_note_id

    raw_rain = unit.get("rain", [])
    if not isinstance(raw_rain, list) or len(raw_rain) > 100:
        raise ValueError("Dados de precipitação inválidos.")
    rain: list[list[Any]] = []
    for raw_row in raw_rain:
        if not isinstance(raw_row, (list, tuple)) or len(raw_row) < 3:
            raise ValueError("Linha de precipitação inválida.")
        equipment = str(raw_row[0] or "").strip()
        if len(equipment) > 20:
            raise ValueError("Identificação do equipamento excede o tamanho permitido.")
        if not equipment:
            continue
        rain.append([
            equipment,
            _nonnegative_number(raw_row[1], "Chuva do turno"),
            _nonnegative_number(raw_row[2], "Chuva acumulada"),
        ])

    return {
        "code": code,
        "name": definition["name"],
        "border": border,
        "rows": rows,
        "metrics": metrics,
        "observation": observation,
        "changes": changes,
        "rain": standardize_rain_labels(code, rows, rain),
        **({"observation_period": observation_period} if observation_period is not None else {}),
    }


def _standardize_unit_rain(conn: sqlite3.Connection) -> int:
    """Idempotent label migration. Preserve rainfall values and official front IDs."""
    changed = 0
    for row in conn.execute("SELECT code,data_json FROM units WHERE code IN ('PPT','NRD','RBR','PST')").fetchall():
        try:
            unit = json.loads(row["data_json"])
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(unit, dict) or not isinstance(unit.get("rain", []), list):
            continue
        rain = standardize_rain_labels(row["code"], unit.get("rows") or [], unit.get("rain") or [])
        if rain == unit.get("rain", []):
            continue
        unit["rain"] = rain
        conn.execute("UPDATE units SET data_json=?,version=version+1 WHERE code=?",
                     (json.dumps(unit, ensure_ascii=False), row["code"]))
        changed += 1
    return changed


def _seed_missing_units(conn: sqlite3.Connection) -> None:
    """Garante as quatro unidades com posição vazia (versão 1) em bancos novos.

    O painel só permite edição com a versão do servidor; sem a linha, uma
    instalação nova não teria como receber a primeira posição.
    """
    now = int(time.time())
    for code, definition in UNIT_DEFINITIONS.items():
        empty = _normalize_unit_payload({"code": code, "name": definition["name"]}, definition["position"])
        conn.execute(
            """INSERT INTO units (code, name, position, data_json, updated_by, updated_at, version)
               VALUES (?, ?, ?, ?, NULL, ?, 1) ON CONFLICT(code) DO NOTHING""",
            (code, definition["name"], definition["position"], json.dumps(empty, ensure_ascii=False), now),
        )


def _repair_unit_identities(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT id, code, data_json FROM units").fetchall()
    for row in rows:
        code = str(row["code"] or "").strip().upper()
        definition = UNIT_DEFINITIONS.get(code)
        if not definition:
            continue
        payload = row["data_json"]
        try:
            decoded = json.loads(payload)
            if isinstance(decoded, dict):
                decoded["code"] = code
                decoded["name"] = definition["name"]
                payload = json.dumps(decoded, ensure_ascii=False)
        except (json.JSONDecodeError, TypeError):
            pass
        conn.execute(
            "UPDATE units SET name = ?, position = ?, data_json = ? WHERE id = ?",
            (definition["name"], definition["position"], payload, row["id"]),
        )


def _decode_unit(row: sqlite3.Row) -> dict[str, Any] | None:
    try:
        decoded = json.loads(row["data_json"])
        return decoded if isinstance(decoded, dict) else None
    except (json.JSONDecodeError, TypeError):
        return None


def list_units_payload() -> dict[str, Any]:
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT u.code, u.name, u.data_json, u.version, u.updated_at, u.updated_by, users.name AS updated_by_name
            FROM units u
            LEFT JOIN auth.users AS users ON users.id = u.updated_by
            WHERE u.code IN ('PPT', 'NRD', 'RBR', 'PST')
            ORDER BY CASE u.code WHEN 'PPT' THEN 0 WHEN 'NRD' THEN 1 WHEN 'RBR' THEN 2 WHEN 'PST' THEN 3 ELSE 99 END, u.id ASC
            """
        ).fetchall()

    units: list[dict[str, Any]] = []
    meta: dict[str, dict[str, Any]] = {}
    for row in rows:
        unit = _decode_unit(row)
        if not unit:
            continue
        code = str(row["code"] or unit.get("code", "")).strip().upper()
        definition = UNIT_DEFINITIONS.get(code)
        if definition:
            unit["code"] = code
            unit["name"] = definition["name"]
            unit["rain"] = standardize_rain_labels(code, unit.get("rows") or [], unit.get("rain") or [])
        units.append(unit)
        if code:
            meta[code] = {
                "version": int(row["version"] or 1),
                "updated_at": int(row["updated_at"] or 0),
                "updated_by": row["updated_by_name"] or "-",
            }
    return {"units": units, "meta": meta}


def list_unit_versions() -> dict[str, Any]:
    """Somente revisões para sincronização da Sacarose; não expõe dados de campo."""
    with connection() as conn:
        rows = conn.execute("SELECT code,version FROM units WHERE code IN ('PPT','NRD','RBR','PST')").fetchall()
    return {"meta": {row["code"]: {"version": int(row["version"] or 1)} for row in rows}}


def list_units() -> list[dict[str, Any]]:
    return list_units_payload()["units"]


def _history_insert(
    conn: sqlite3.Connection,
    *,
    unit_code: str,
    unit_name: str,
    user_id: int,
    action: str,
    before_json: str | None,
    after_json: str,
    version: int,
    created_at: int,
) -> None:
    conn.execute(
        """
        INSERT INTO unit_history (
            unit_code, unit_name, user_id, action, before_json, after_json, version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (unit_code, unit_name, user_id, action, before_json, after_json, version, created_at),
    )


def initialize_units(units: list[dict[str, Any]], user_id: int) -> dict[str, Any]:
    if not isinstance(units, list) or len(units) != len(ALLOWED_UNIT_CODES):
        raise ValueError("A inicialização exige as quatro unidades.")

    normalized_units = [_normalize_unit_payload(unit, position) for position, unit in enumerate(units)]
    if tuple(unit["code"] for unit in normalized_units) != ALLOWED_UNIT_CODES:
        raise ValueError("Ordem das unidades inválida.")

    now = int(time.time())
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        validate_actor(conn, user_id)
        # Unidades criadas vazias por _seed_missing_units (sem autor, versão 1 e
        # sem histórico) ainda podem receber a primeira posição.
        existing_codes = {
            str(row["code"]).upper()
            for row in conn.execute(
                """SELECT u.code FROM units u
                   WHERE u.code IN ('PPT', 'NRD', 'RBR', 'PST')
                     AND (u.updated_by IS NOT NULL OR u.version > 1
                          OR EXISTS (SELECT 1 FROM unit_history h WHERE h.unit_code = u.code))"""
            ).fetchall()
        }

        for position, unit in enumerate(normalized_units):
            code = unit["code"]
            if code in existing_codes:
                continue
            name = unit["name"]
            payload = json.dumps(unit, ensure_ascii=False)
            conn.execute(
                """
                INSERT INTO units (code, name, position, data_json, updated_by, updated_at, version)
                VALUES (?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(code) DO UPDATE SET
                    name=excluded.name, position=excluded.position, data_json=excluded.data_json,
                    updated_by=excluded.updated_by, updated_at=excluded.updated_at, version=1
                """,
                (code, name, position, payload, user_id, now),
            )
            _history_insert(
                conn,
                unit_code=code,
                unit_name=name,
                user_id=user_id,
                action="criação",
                before_json=None,
                after_json=payload,
                version=1,
                created_at=now,
            )

    return list_units_payload()


def _sync_sacarose_from_position_unit(conn: sqlite3.Connection, unit: dict[str, Any], user_id: int, now: int) -> None:
    """Mantém a posição da Sacarose espelhada quando uma unidade é salva na Posição de Campo."""
    code = str(unit.get("code") or "").strip().upper()
    if code not in ("NRD", "PPT", "RBR", "PST"):
        return

    rows = unit.get("rows") if isinstance(unit.get("rows"), list) else []
    normalized_rows: list[tuple[str, str]] = []
    seen_fronts: set[str] = set()

    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) < 2:
            continue
        front = str(row[0] or "").strip()
        sector = str(row[1] or "").strip()
        if not front or not sector:
            continue
        front_key = position_front_key(front)
        if front_key in seen_fronts:
            continue
        seen_fronts.add(front_key)
        normalized_rows.append((front, sector))

    normalized_rows.sort(key=lambda item: (0, int(item[0])) if item[0].isdecimal() else (1, item[0].casefold()))
    existing_rows = {
        position_front_key(row["front"]): {
            "sector": str(row["sector"] or "").strip(),
            "section": str(row["section"] or "").strip(),
            "exclude_image": bool(row["exclude_image"]),
        }
        for row in conn.execute(
            "SELECT front, sector, section, exclude_image FROM sacarose_positions WHERE unit_code = ?",
            (code,),
        ).fetchall()
    }

    conn.execute("DELETE FROM sacarose_positions WHERE unit_code = ?", (code,))
    for front, sector in normalized_rows:
        existing = existing_rows.get(position_front_key(front)) or {}
        exclude_image = 1 if existing.get("exclude_image", False) else 0
        section = ""

        # Preserva a seção escolhida anteriormente quando a frente continua no mesmo setor.
        if str(existing.get("sector") or "").casefold() == sector.casefold():
            previous_section = str(existing.get("section") or "").strip()
            if previous_section:
                valid = conn.execute(
                    "SELECT 1 FROM sector_base WHERE sector = ? COLLATE NOCASE AND section = ? COLLATE NOCASE LIMIT 1",
                    (sector, previous_section),
                ).fetchone()
                if valid:
                    section = previous_section

        # Para setor com apenas uma seção, a associação é automática.
        if not section:
            section_rows = conn.execute(
                "SELECT section FROM sector_base WHERE sector = ? COLLATE NOCASE ORDER BY section COLLATE NOCASE",
                (sector,),
            ).fetchall()
            if len(section_rows) == 1:
                section = str(section_rows[0]["section"] or "").strip()

        conn.execute(
            """
            INSERT INTO sacarose_positions (unit_code, front, sector, section, exclude_image, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (code, front, sector, section, exclude_image, user_id, now),
        )


def save_unit(
    unit: dict[str, Any],
    position: int,
    user_id: int,
    expected_version: int | None = None,
) -> dict[str, Any]:
    normalized_unit = _normalize_unit_payload(unit, position)
    code = normalized_unit["code"]
    name = normalized_unit["name"]

    now = int(time.time())
    payload = json.dumps(normalized_unit, ensure_ascii=False)
    with connection() as conn:
        # Serializa as gravações antes da leitura da versão para impedir
        # que duas edições concorrentes validem a mesma versão ao mesmo tempo.
        conn.execute("BEGIN IMMEDIATE")
        validate_actor(conn, user_id)
        row = conn.execute(
            """
            SELECT u.data_json, u.version, u.updated_at, users.name AS updated_by_name
            FROM units u
            LEFT JOIN auth.users AS users ON users.id = u.updated_by
            WHERE u.code = ?
            """,
            (code,),
        ).fetchone()

        if row:
            current_version = int(row["version"] or 1)
            if expected_version is not None and expected_version != current_version:
                current_unit = _decode_unit(row) or normalized_unit
                raise UnitConflictError(
                    {
                        "unit": current_unit,
                        "meta": {
                            "version": current_version,
                            "updated_at": int(row["updated_at"] or 0),
                            "updated_by": row["updated_by_name"] or "-",
                        },
                    }
                )
            new_version = current_version + 1
            before_json = row["data_json"]
            conn.execute(
                """
                UPDATE units
                SET name = ?, position = ?, data_json = ?, updated_by = ?, updated_at = ?, version = ?
                WHERE code = ?
                """,
                (name, position, payload, user_id, now, new_version, code),
            )
            action = "atualização"
        else:
            new_version = 1
            before_json = None
            conn.execute(
                """
                INSERT INTO units (code, name, position, data_json, updated_by, updated_at, version)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (code, name, position, payload, user_id, now, new_version),
            )
            action = "criação"

        _sync_sacarose_from_position_unit(conn, normalized_unit, user_id, now)

        _history_insert(
            conn,
            unit_code=code,
            unit_name=name,
            user_id=user_id,
            action=action,
            before_json=before_json,
            after_json=payload,
            version=new_version,
            created_at=now,
        )

        user_name = conn.execute("SELECT name FROM auth.users WHERE id = ?", (user_id,)).fetchone()
        updated_by = user_name["name"] if user_name else "-"

    return {
        "unit": normalized_unit,
        "meta": {"version": new_version, "updated_at": now, "updated_by": updated_by},
    }


def list_history(limit: int = 100, unit_code: str | None = None) -> list[dict[str, Any]]:
    safe_limit = min(max(int(limit), 1), 300)
    params: list[Any] = []
    where = ""
    if unit_code:
        where = "WHERE h.unit_code = ?"
        params.append(unit_code.strip().upper())
    params.append(safe_limit)

    with connection() as conn:
        rows = conn.execute(
            f"""
            SELECT h.* FROM (
                SELECT p.id, p.unit_code, p.unit_name, p.action, p.version, p.created_at,
                       users.name AS user_name, 'position' AS kind,
                       NULL AS front, NULL AS sector, NULL AS text,
                       NULL AS resolved_at, NULL AS highlighted, p.after_json AS snapshot
                FROM unit_history p
                LEFT JOIN auth.users AS users ON users.id = p.user_id
                UNION ALL
                SELECT n.id, n.unit_code, COALESCE(u.name, n.unit_code),
                       'Acompanhamento da frente', NULL, n.created_at, n.author_name,
                       'front_note', n.front_label, n.sector_snapshot, n.note,
                       n.resolved_at, n.highlighted, NULL
                FROM field_front_notes n
                LEFT JOIN units u ON u.code = n.unit_code
            ) h
            {where}
            ORDER BY h.created_at DESC, h.id DESC, h.kind DESC
            LIMIT ?
            """,
            params,
        ).fetchall()

    result = []
    for row in rows:
        period = shift_at(row['created_at'])
        if row['snapshot']:
            try:
                snapshot = json.loads(row['snapshot'])
                candidate = snapshot.get('observation_period') if isinstance(snapshot, dict) else None
                if isinstance(candidate, dict):
                    shift_period(candidate.get('work_date'), candidate.get('shift'))
                    period = candidate
            except (ValueError, TypeError):
                pass  # Um snapshot legado inválido não deve ocultar o histórico.
        result.append({
            "id": f"front-note:{row['id']}" if row["kind"] == "front_note" else row["id"],
            "unit_code": row["unit_code"],
            "unit_name": row["unit_name"],
            "action": row["action"],
            "version": row["version"],
            "created_at": row["created_at"],
            "user_name": row["user_name"] or "Usuário removido",
            "kind": row["kind"],
            "front": row["front"],
            "sector": row["sector"],
            "text": row["text"],
            "resolved_at": row["resolved_at"],
            "highlighted": bool(row["highlighted"]),
            "shift": period['shift'],
            "work_date": period['work_date'],
        })
    return result
