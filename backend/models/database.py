import json
import math
import re
import sqlite3
import time
from typing import Any

from ..config import MIN_PASSWORD_LENGTH, REMEMBER_SESSION_TTL_SECONDS, SESSION_TTL_SECONDS
from .storage import USER_REFERENCES, auth_connection, connection, initialize_databases, validate_actor
from .security import hash_password, new_session_token, token_digest, verify_password


class UnitConflictError(Exception):
    def __init__(self, current: dict[str, Any]):
        super().__init__("Esta unidade foi atualizada por outro usuário.")
        self.current = current


ALLOWED_UNIT_CODES = ("PPT", "NRD", "RBR", "PST")
UNIT_DEFINITIONS = {
    "PPT": {"name": "PARAGUAÇU PAULISTA", "position": 0},
    "NRD": {"name": "NARANDIBA", "position": 1},
    "RBR": {"name": "RIO BRILHANTE", "position": 2},
    "PST": {"name": "PASSA TEMPO", "position": 3},
}
METRIC_DEFINITIONS = (
    ("🏭", "INDÚSTRIA", "TN/H", ""),
    ("⚙️", "MOAGEM TURNO", "TN/H", ""),
    ("🚚", "ENTREGA TURNO", "TN/H", ""),
    ("⬡", "ESTOQUE", "CARGAS", "stock"),
    ("⚙️", "MOAGEM ÚLTIMAS 3H", "TN/H", ""),
    ("🚚", "ENTREGA ÚLTIMAS 3H", "TN/H", ""),
)
ROLE_ADMIN = "admin"
ROLE_USER = "user"
ROLE_COORDINATOR = "coordinator"
ROLE_ANALYST = "analyst"
ALLOWED_ROLES = {ROLE_ADMIN, ROLE_USER, ROLE_COORDINATOR, ROLE_ANALYST}
USER_COLUMNS = "id, name, role, is_active, created_at, email, base_unit"
_NUMBER_RE = re.compile(r"-?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?")
_DUMMY_PASSWORD_HASH = hash_password("__invalid_user_timing_guard__")


def _normalize_status(value: Any) -> str:
    status = str(value or "").strip().upper()
    if "SOLO ÚMIDO" in status:
        return "SOLO ÚMIDO"
    if status == "EM ATIVIDADE":
        return "EM ATIVIDADE"
    return "MUDANÇA"


def _nonnegative_number(value: Any, field: str) -> int | float:
    if isinstance(value, bool):
        raise ValueError(f"{field} inválido.")
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        match = _NUMBER_RE.search(str(value or "").replace(",", "."))
        number = float(match.group(0)) if match else 0.0
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
        if len(front) > 12 or len(sector) > 16:
            raise ValueError("Frente ou setor excede o tamanho permitido.")
        if not front and not sector:
            continue
        status = _normalize_status(raw_row[3])
        color = "green" if status == "EM ATIVIDADE" else "yellow"
        rows.append([front, sector, color, status])

    statuses = [row[3] for row in rows]
    if not statuses or all(status == "EM ATIVIDADE" for status in statuses):
        border = "active"
    elif all(status == "SOLO ÚMIDO" for status in statuses):
        border = "critical"
    else:
        border = "attention"

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
        "rain": rain,
    }


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

def init_db() -> None:
    initialize_databases()
    with auth_connection() as conn:
        conn.execute("UPDATE users SET role = 'user' WHERE role IS NULL OR role NOT IN ('admin', 'user', 'coordinator', 'analyst')")
        conn.execute("UPDATE users SET is_active = 1 WHERE is_active IS NULL")
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _repair_unit_identities(conn)
        conn.execute(
            """
            UPDATE sacarose_positions
            SET section = (SELECT b.section FROM sector_base b
                           WHERE b.sector = sacarose_positions.sector COLLATE NOCASE LIMIT 1)
            WHERE COALESCE(section, '') = ''
              AND 1 = (SELECT COUNT(*) FROM sector_base b2
                       WHERE b2.sector = sacarose_positions.sector COLLATE NOCASE)
            """
        )
        initialized = conn.execute("SELECT value FROM schema_info WHERE key='return_layouts_initialized'").fetchone()
        if not initialized:
            migrated = conn.execute("SELECT value FROM schema_info WHERE key='legacy_return_layouts'").fetchone()
            if not migrated or migrated[0] != "1":
                _seed_return_layouts(conn)
            conn.execute("INSERT INTO schema_info(key,value) VALUES ('return_layouts_initialized','1')")


def _validate_credentials(name: str, password: str) -> tuple[str, str]:
    cleaned_name = name.strip()
    if not cleaned_name:
        raise ValueError("Informe o nome do usuário.")
    if password == "":
        raise ValueError("Informe a senha.")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"A senha deve ter pelo menos {MIN_PASSWORD_LENGTH} caracteres.")
    if len(cleaned_name) > 80:
        raise ValueError("O nome do usuário deve ter no máximo 80 caracteres.")
    if len(password) > 256:
        raise ValueError("A senha deve ter no máximo 256 caracteres.")
    return cleaned_name, password


def _user_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "role": row["role"] if row["role"] in ALLOWED_ROLES else ROLE_USER,
        "is_active": bool(row["is_active"]),
        "created_at": int(row["created_at"] or 0),
        "email": row["email"] or "",
        "base_unit": row["base_unit"] if row["base_unit"] in ALLOWED_UNIT_CODES else "PPT",
    }


def create_user(name: str, password: str, *, role: str = ROLE_USER,
                base_unit: str = "PPT", email: str = "", is_active: bool = True) -> dict[str, Any]:
    cleaned_name, password = _validate_credentials(name, password)
    if not isinstance(role, str) or role not in ALLOWED_ROLES:
        raise ValueError("Nível de acesso inválido.")
    if not isinstance(base_unit, str) or base_unit not in ALLOWED_UNIT_CODES:
        raise ValueError("Unidade base inválida.")
    if not isinstance(is_active, bool):
        raise ValueError("Situação do usuário inválida.")
    if not isinstance(email, str):
        raise ValueError("E-mail inválido.")
    email = email.strip()
    if len(email) > 254 or (email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email)):
        raise ValueError("Informe um e-mail válido (máximo de 254 caracteres).")
    now = int(time.time())
    with auth_connection() as conn:
        try:
            cursor = conn.execute(
                "INSERT INTO users (name, password_hash, role, is_active, created_at, email, base_unit) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (cleaned_name, hash_password(password), role, int(is_active), now, email, base_unit),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Este nome de usuário já está cadastrado.") from exc
        row = conn.execute(
            f"SELECT {USER_COLUMNS} FROM users WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
    return _user_payload(row)


def create_or_update_admin(name: str, password: str) -> dict[str, Any]:
    cleaned_name, password = _validate_credentials(name, password)
    password_hash = hash_password(password)
    now = int(time.time())
    with auth_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing_target = conn.execute(
            "SELECT id FROM users WHERE name = ? COLLATE NOCASE",
            (cleaned_name,),
        ).fetchone()
        if existing_target:
            user_id = int(existing_target["id"])
        else:
            cursor = conn.execute(
                "INSERT INTO users (name, password_hash, role, is_active, created_at) VALUES (?, ?, 'user', 1, ?)",
                (cleaned_name, password_hash, now),
            )
            user_id = int(cursor.lastrowid)

        # O utilitário recupera esta conta, sem rebaixar outros administradores.
        conn.execute(
            "UPDATE users SET name = ?, password_hash = ?, role = 'admin', is_active = 1 WHERE id = ?",
            (cleaned_name, password_hash, user_id),
        )

        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

        result = conn.execute(
            f"SELECT {USER_COLUMNS} FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    return _user_payload(result)

def has_admin() -> bool:
    with auth_connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1"
        ).fetchone()
    return bool(row)


def list_users(current_user_id: int) -> list[dict[str, Any]]:
    with auth_connection() as conn:
        rows = conn.execute(
            f"SELECT {USER_COLUMNS} FROM users WHERE role <> 'admin' OR id = ? "
            "ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, name COLLATE NOCASE ASC, id ASC",
            (current_user_id,),
        ).fetchall()
    return [_user_payload(row) for row in rows]


def _editable_user(conn: sqlite3.Connection, user_id: int, current_user_id: int) -> sqlite3.Row:
    if user_id == current_user_id:
        raise ValueError("Você não pode alterar a própria conta por esta tela.")
    row = conn.execute(
        "SELECT id, name, role, is_active FROM users WHERE id = ? AND role <> 'admin'",
        (user_id,),
    ).fetchone()
    if not row:
        raise ValueError("Usuário não encontrado.")
    return row


def delete_user(user_id: int, current_user_id: int) -> None:
    # Reproduz o antigo ON DELETE SET NULL sem FKs entre arquivos diferentes.
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _editable_user(conn, user_id, current_user_id)
        for table, column in USER_REFERENCES:
            conn.execute(f"UPDATE main.{table} SET {column}=NULL WHERE {column}=?", (user_id,))
        conn.execute("DELETE FROM auth.users WHERE id = ?", (user_id,))


def set_user_active(user_id: int, is_active: bool, current_user_id: int) -> dict[str, Any]:
    if not isinstance(is_active, bool):
        raise ValueError("Situação do usuário inválida.")
    with auth_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _editable_user(conn, user_id, current_user_id)
        active_value = 1 if is_active else 0
        conn.execute("UPDATE users SET is_active = ? WHERE id = ?", (active_value, user_id))
        if not is_active:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        row = conn.execute(
            f"SELECT {USER_COLUMNS} FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    return _user_payload(row)


def reset_user_password(user_id: int, password: str, current_user_id: int) -> None:
    if password == "":
        raise ValueError("Informe a nova senha.")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"A senha deve ter pelo menos {MIN_PASSWORD_LENGTH} caracteres.")
    if len(password) > 256:
        raise ValueError("A senha deve ter no máximo 256 caracteres.")
    with auth_connection() as conn:
        _editable_user(conn, user_id, current_user_id)
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), user_id))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def authenticate_user(name: str, password: str) -> dict[str, Any] | None:
    cleaned_name = str(name or "").strip()
    password = str(password or "")
    if not cleaned_name or len(cleaned_name) > 80 or len(password) > 256:
        return None

    with auth_connection() as conn:
        row = conn.execute(
            f"SELECT {USER_COLUMNS}, password_hash FROM users WHERE name = ? COLLATE NOCASE",
            (cleaned_name,),
        ).fetchone()

    if not row:
        verify_password(password, _DUMMY_PASSWORD_HASH)
        return None

    password_ok = verify_password(password, row["password_hash"])
    if not bool(row["is_active"]) or not password_ok:
        return None
    return _user_payload(row)


def create_session(user_id: int, *, remember_me: bool = False, replace_token: str | None = None) -> str:
    if not isinstance(remember_me, bool):
        raise ValueError("Lembrar de mim deve ser verdadeiro ou falso.")
    token = new_session_token()
    now = int(time.time())
    lifetime = REMEMBER_SESSION_TTL_SECONDS if remember_me else SESSION_TTL_SECONDS
    with auth_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if not conn.execute("SELECT 1 FROM users WHERE id = ? AND is_active = 1", (user_id,)).fetchone():
            raise ValueError("Conta indisponível para autenticação.")
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        if replace_token:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_digest(replace_token),))
        conn.execute(
            "INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (user_id, token_digest(token), now + lifetime, now),
        )
    return token


def get_user_by_session(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    now = int(time.time())
    digest = token_digest(token)
    with auth_connection() as conn:
        row = conn.execute(
            """
            SELECT users.id, users.name, users.role, users.is_active, users.created_at, users.email, users.base_unit
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.is_active = 1
            """,
            (digest, now),
        ).fetchone()
    return _user_payload(row) if row else None


def delete_session(token: str | None) -> None:
    if not token:
        return
    with auth_connection() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_digest(token),))


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
        units.append(unit)
        if code:
            meta[code] = {
                "version": int(row["version"] or 1),
                "updated_at": int(row["updated_at"] or 0),
                "updated_by": row["updated_by_name"] or "-",
            }
    return {"units": units, "meta": meta}


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
        existing_codes = {
            str(row["code"]).upper()
            for row in conn.execute("SELECT code FROM units WHERE code IN ('PPT', 'NRD', 'RBR', 'PST')").fetchall()
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
        front_key = str(int(front)) if front.isdigit() else front.casefold()
        if front_key in seen_fronts:
            continue
        seen_fronts.add(front_key)
        normalized_rows.append((front, sector))

    normalized_rows.sort(key=lambda item: (0, int(item[0])) if item[0].isdigit() else (1, item[0].casefold()))
    existing_rows = {
        _sacarose_match_key(row["front"]): {
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
        existing = existing_rows.get(_sacarose_match_key(front)) or {}
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
            SELECT h.id, h.unit_code, h.unit_name, h.action, h.version, h.created_at,
                   users.name AS user_name
            FROM unit_history h
            LEFT JOIN auth.users AS users ON users.id = h.user_id
            {where}
            ORDER BY h.created_at DESC, h.id DESC
            LIMIT ?
            """,
            params,
        ).fetchall()

    return [
        {
            "id": row["id"],
            "unit_code": row["unit_code"],
            "unit_name": row["unit_name"],
            "action": row["action"],
            "version": row["version"],
            "created_at": row["created_at"],
            "user_name": row["user_name"] or "Usuário removido",
        }
        for row in rows
    ]



def _normalize_sector_code(value: Any, field: str = "Setor") -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"Informe o {field.lower()}.")
    if len(text) > 24:
        raise ValueError(f"{field} deve ter no máximo 24 caracteres.")
    # Evita códigos vindos do Excel como 71.0 quando o valor é inteiro.
    if re.fullmatch(r"-?\d+\.0+", text):
        text = text.split(".", 1)[0]
    return text


def _normalize_sector_text(value: Any, field: str, max_length: int) -> str:
    text = str(value or "").strip()
    if len(text) > max_length:
        raise ValueError(f"{field} deve ter no máximo {max_length} caracteres.")
    return text


def _sector_sort_key(value: str) -> tuple:
    pieces = re.split(r"(\d+)", str(value or "").casefold())
    return tuple(int(piece) if piece.isdigit() else piece for piece in pieces)


def list_sector_base(search: str | None = None) -> list[dict[str, Any]]:
    params: list[Any] = []
    where = ""
    if search:
        term = f"%{str(search).strip()}%"
        where = "WHERE s.sector LIKE ? OR s.section LIKE ? OR s.description LIKE ?"
        params.extend([term, term, term])

    with connection() as conn:
        rows = conn.execute(
            f"""
            SELECT s.sector, s.section, s.description, s.source, s.updated_at,
                   users.name AS updated_by_name
            FROM sector_base s
            LEFT JOIN auth.users AS users ON users.id = s.updated_by
            {where}
            """,
            params,
        ).fetchall()

    items = [
        {
            "sector": row["sector"],
            "section": row["section"],
            "description": row["description"],
            "source": row["source"],
            "updated_at": int(row["updated_at"] or 0),
            "updated_by": row["updated_by_name"] or "-",
        }
        for row in rows
    ]
    items.sort(key=lambda item: (_sector_sort_key(item["sector"]), _sector_sort_key(item["section"])))
    return items


def save_sector_base_item(
    sector: Any,
    section: Any,
    description: Any,
    user_id: int,
    *,
    source: str = "manual",
    original_section: Any | None = None,
) -> dict[str, Any]:
    normalized_sector = _normalize_sector_code(sector)
    normalized_section = _normalize_sector_text(section, "Seção", 24)
    normalized_description = _normalize_sector_text(description, "Descrição do setor", 160)
    normalized_source = "excel" if source == "excel" else "manual"
    normalized_original_section = (
        _normalize_sector_text(original_section, "Seção original", 24)
        if original_section is not None
        else None
    )
    now = int(time.time())

    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        validate_actor(conn, user_id)
        if normalized_original_section is not None and normalized_original_section.casefold() != normalized_section.casefold():
            conn.execute(
                "DELETE FROM sector_base WHERE sector = ? COLLATE NOCASE AND section = ? COLLATE NOCASE",
                (normalized_sector, normalized_original_section),
            )
        conn.execute(
            """
            INSERT INTO sector_base (sector, section, description, source, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(sector, section) DO UPDATE SET
                description = excluded.description,
                source = excluded.source,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
            """,
            (normalized_sector, normalized_section, normalized_description, normalized_source, user_id, now),
        )
        row = conn.execute(
            """
            SELECT s.sector, s.section, s.description, s.source, s.updated_at,
                   users.name AS updated_by_name
            FROM sector_base s
            LEFT JOIN auth.users AS users ON users.id = s.updated_by
            WHERE s.sector = ? COLLATE NOCASE AND s.section = ? COLLATE NOCASE
            """,
            (normalized_sector, normalized_section),
        ).fetchone()

    return {
        "sector": row["sector"],
        "section": row["section"],
        "description": row["description"],
        "source": row["source"],
        "updated_at": int(row["updated_at"] or 0),
        "updated_by": row["updated_by_name"] or "-",
    }

def import_sector_base_items(items: list[dict[str, Any]], user_id: int) -> dict[str, int]:
    if not isinstance(items, list) or not items:
        raise ValueError("Nenhum setor válido foi encontrado na planilha.")
    if len(items) > 25_000:
        raise ValueError("A planilha possui setores demais para uma única importação.")

    normalized: dict[tuple[str, str], tuple[str, str, str]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        sector = _normalize_sector_code(item.get("sector"))
        section = _normalize_sector_text(item.get("section"), "Seção", 24)
        description = _normalize_sector_text(item.get("description"), "Descrição do setor", 160)
        normalized[(sector.casefold(), section.casefold())] = (sector, section, description)

    if not normalized:
        raise ValueError("Nenhum setor válido foi encontrado na planilha.")

    now = int(time.time())
    created = 0
    updated = 0
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        validate_actor(conn, user_id)
        for sector, section, description in normalized.values():
            exists = conn.execute(
                "SELECT 1 FROM sector_base WHERE sector = ? COLLATE NOCASE AND section = ? COLLATE NOCASE",
                (sector, section),
            ).fetchone()
            if exists:
                updated += 1
            else:
                created += 1
            conn.execute(
                """
                INSERT INTO sector_base (sector, section, description, source, updated_by, updated_at)
                VALUES (?, ?, ?, 'excel', ?, ?)
                ON CONFLICT(sector, section) DO UPDATE SET
                    description = excluded.description,
                    source = 'excel',
                    updated_by = excluded.updated_by,
                    updated_at = excluded.updated_at
                """,
                (sector, section, description, user_id, now),
            )

    return {
        "total": len(normalized),
        "processed_rows": len(items),
        "created": created,
        "updated": updated,
    }

def delete_sector_base_item(sector: Any, section: Any) -> None:
    normalized_sector = _normalize_sector_code(sector)
    normalized_section = _normalize_sector_text(section, "Seção", 24)
    with connection() as conn:
        cursor = conn.execute(
            """
            DELETE FROM sector_base
            WHERE sector = ? COLLATE NOCASE
              AND section = ? COLLATE NOCASE
            """,
            (normalized_sector, normalized_section),
        )
        if cursor.rowcount <= 0:
            raise ValueError("Setor não encontrado com essa mesma seção.")


SACAROSE_UNIT_CODES = ("NRD", "PPT", "RBR", "PST")

def _sacarose_front_key(value: Any) -> tuple[int, Any]:
    text = str(value or "").strip()
    if text.isdigit():
        return (0, int(text))
    return (1, _sector_sort_key(text))

def _sacarose_match_key(value: Any) -> str:
    text = str(value or "").strip()
    if text.isdigit():
        return str(int(text))
    return text.casefold()

def list_sacarose_positions() -> dict[str, list[dict[str, Any]]]:
    result = {code: [] for code in SACAROSE_UNIT_CODES}
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT p.unit_code, p.front, p.sector, p.section, p.exclude_image, p.updated_at,
                   COALESCE(b.description, '') AS description,
                   users.name AS updated_by_name
            FROM sacarose_positions p
            LEFT JOIN sector_base b
              ON b.sector = p.sector COLLATE NOCASE
             AND b.section = p.section COLLATE NOCASE
            LEFT JOIN auth.users AS users ON users.id = p.updated_by
            WHERE p.unit_code IN ('NRD', 'PPT', 'RBR', 'PST')
            """
        ).fetchall()

    for row in rows:
        code = str(row["unit_code"] or "").upper()
        if code not in result:
            continue
        result[code].append({
            "front": row["front"],
            "sector": row["sector"],
            "section": row["section"],
            "description": row["description"],
            "exclude_image": bool(row["exclude_image"]),
            "updated_at": int(row["updated_at"] or 0),
            "updated_by": row["updated_by_name"] or "-",
        })

    for code in result:
        result[code].sort(key=lambda item: _sacarose_front_key(item["front"]))
    return result

def save_sacarose_positions(
    payload: Any,
    user_id: int,
    expected_versions: Any = None,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Dados da Sacarose inválidos.")

    provided_codes = [code for code in SACAROSE_UNIT_CODES if code in payload]
    if not provided_codes:
        raise ValueError("Nenhuma unidade foi informada para a Sacarose.")

    if expected_versions is None:
        expected_versions = {}
    if not isinstance(expected_versions, dict):
        raise ValueError("Versões esperadas inválidas.")

    normalized: dict[str, list[dict[str, Any]]] = {}
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        validate_actor(conn, user_id)
        known_sectors: dict[str, list[tuple[str, str]]] = {}
        for row in conn.execute(
            "SELECT sector, section FROM sector_base ORDER BY sector COLLATE NOCASE, section COLLATE NOCASE"
        ).fetchall():
            canonical_sector = str(row["sector"] or "").strip()
            canonical_section = str(row["section"] or "").strip()
            known_sectors.setdefault(canonical_sector.casefold(), []).append((canonical_sector, canonical_section))

        for code in provided_codes:
            raw_rows = payload.get(code)
            if not isinstance(raw_rows, list) or len(raw_rows) > 100:
                raise ValueError(f"Lista da Sacarose {code} inválida.")

            seen_fronts: set[str] = set()
            normalized_rows: list[dict[str, Any]] = []
            for raw in raw_rows:
                if not isinstance(raw, dict):
                    raise ValueError(f"Linha da Sacarose {code} inválida.")
                front = str(raw.get("front") or "").strip()
                sector = _normalize_sector_code(raw.get("sector"))
                if not front:
                    raise ValueError(f"Informe a frente em {code}.")
                if len(front) > 12:
                    raise ValueError(f"Frente {front} excede o tamanho permitido.")

                front_key = _sacarose_match_key(front)
                if front_key in seen_fronts:
                    raise ValueError(f"A frente {front} está repetida em {code}.")
                seen_fronts.add(front_key)

                sector_options = known_sectors.get(sector.casefold()) or []
                if not sector_options:
                    raise ValueError(f"Setor {sector} de {code} não foi encontrado na Base de Setores.")

                requested_section = str(raw.get("section") or "").strip()
                selected_pair: tuple[str, str] | None = None
                if requested_section:
                    requested_key = requested_section.casefold()
                    selected_pair = next(
                        (pair for pair in sector_options if pair[1].casefold() == requested_key),
                        None,
                    )
                    if not selected_pair:
                        raise ValueError(
                            f"A seção {requested_section} não pertence ao setor {sector} em {code}."
                        )
                elif len(sector_options) == 1:
                    selected_pair = sector_options[0]
                elif code in ("RBR", "PST"):
                    raise ValueError(f"Selecione a seção do setor {sector} em {code}.")
                else:
                    # Mantém compatibilidade das unidades antigas, que não exigiam escolha de seção.
                    selected_pair = sector_options[0]

                canonical_sector, canonical_section = selected_pair
                normalized_rows.append({
                    "front": front,
                    "sector": canonical_sector,
                    "section": canonical_section,
                    "exclude_image": bool(raw.get("exclude_image", False)),
                })

            normalized_rows.sort(key=lambda item: _sacarose_front_key(item["front"]))
            normalized[code] = normalized_rows

        now = int(time.time())

        for code in provided_codes:
            unit_row = conn.execute(
                """
                SELECT u.id, u.code, u.name, u.position, u.data_json, u.version,
                       u.updated_at, users.name AS updated_by_name
                FROM units u
                LEFT JOIN auth.users AS users ON users.id = u.updated_by
                WHERE u.code = ?
                """,
                (code,),
            ).fetchone()
            if not unit_row:
                raise ValueError(f"Unidade {code} ainda não foi inicializada.")

            expected_raw = expected_versions.get(code)
            expected_version = int(expected_raw) if expected_raw is not None else None
            current_version = int(unit_row["version"] or 1)
            if expected_version is not None and expected_version != current_version:
                current_unit = _decode_unit(unit_row) or {}
                raise UnitConflictError({
                    "unit": current_unit,
                    "meta": {
                        "version": current_version,
                        "updated_at": int(unit_row["updated_at"] or 0),
                        "updated_by": unit_row["updated_by_name"] or "-",
                    },
                })

            conn.execute("DELETE FROM sacarose_positions WHERE unit_code = ?", (code,))
            for item in normalized[code]:
                conn.execute(
                    """
                    INSERT INTO sacarose_positions (unit_code, front, sector, section, exclude_image, updated_by, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        code,
                        item["front"],
                        item["sector"],
                        item["section"],
                        1 if item["exclude_image"] else 0,
                        user_id,
                        now,
                    ),
                )

            current_unit = _decode_unit(unit_row) or {}
            current_rows = current_unit.get("rows") if isinstance(current_unit.get("rows"), list) else []
            row_by_front: dict[str, list[Any]] = {}
            for row in current_rows:
                if isinstance(row, (list, tuple)) and len(row) >= 4:
                    row_by_front[_sacarose_match_key(row[0])] = list(row)

            synced_rows: list[list[Any]] = []
            for item in normalized[code]:
                match = row_by_front.get(_sacarose_match_key(item["front"]))
                if match:
                    display_front = str(match[0] or item["front"]).strip() or item["front"]
                    status = _normalize_status(match[3])
                else:
                    display_front = item["front"]
                    status = "EM ATIVIDADE"
                color = "green" if status == "EM ATIVIDADE" else "yellow"
                synced_rows.append([display_front, item["sector"], color, status])

            synced_rows.sort(key=lambda row: _sacarose_front_key(row[0]))
            current_unit["code"] = code
            current_unit["name"] = UNIT_DEFINITIONS[code]["name"]
            current_unit["rows"] = synced_rows
            normalized_unit = _normalize_unit_payload(current_unit, UNIT_DEFINITIONS[code]["position"])
            after_json = json.dumps(normalized_unit, ensure_ascii=False)
            before_json = unit_row["data_json"]

            # Só cria nova versão/histórico quando Frente/Setor realmente mudarem.
            if after_json != before_json:
                new_version = current_version + 1
                conn.execute(
                    """
                    UPDATE units
                    SET name = ?, position = ?, data_json = ?, updated_by = ?, updated_at = ?, version = ?
                    WHERE code = ?
                    """,
                    (
                        normalized_unit["name"],
                        UNIT_DEFINITIONS[code]["position"],
                        after_json,
                        user_id,
                        now,
                        new_version,
                        code,
                    ),
                )
                _history_insert(
                    conn,
                    unit_code=code,
                    unit_name=normalized_unit["name"],
                    user_id=user_id,
                    action="sincronização Sacarose",
                    before_json=before_json,
                    after_json=after_json,
                    version=new_version,
                    created_at=now,
                )

    return {
        "sacarose": list_sacarose_positions(),
        **list_units_payload(),
    }
