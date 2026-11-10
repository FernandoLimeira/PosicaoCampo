"""Usuários, credenciais, sessões e administração de contas (usuarios.db)."""
import re
import sqlite3
import time
from typing import Any

from ..config import MIN_PASSWORD_LENGTH, REMEMBER_SESSION_TTL_SECONDS, SESSION_TTL_SECONDS
from .constants import ALLOWED_ROLES, ALLOWED_UNIT_CODES, ROLE_ADMIN, ROLE_USER
from .module_access import (
    legacy_module_access, module_access_from_conn, normalize_module_access,
    validate_delegated_grants, validate_delegated_target, write_module_access,
)
from .production import (
    decorate_user_payload, detach_user_data_before_delete, normalize_user_access, write_user_access,
)
from .security import hash_password, new_session_token, token_digest, verify_password
from .storage import ALL_USER_REFERENCES, auth_connection, connection

USER_COLUMNS = "id, name, role, is_active, created_at, email, base_unit"
_DUMMY_PASSWORD_HASH = hash_password("__invalid_user_timing_guard__")


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
                base_unit: str = "PPT", email: str = "", is_active: bool = True,
                production_access: Any = None, module_access: Any = None, actor_id: int | None = None) -> dict[str, Any]:
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
    access = normalize_user_access(production_access)
    permissions = normalize_module_access(module_access)
    now = int(time.time())
    with auth_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if actor_id is not None:
            actor = conn.execute("SELECT role FROM users WHERE id=? AND is_active=1", (actor_id,)).fetchone()
            if permissions is None and (not actor or actor["role"] != "admin"):
                raise ValueError("Informe os acessos de cada módulo.")
            validate_delegated_grants(conn, actor_id, permissions or {}, access)
        try:
            cursor = conn.execute(
                "INSERT INTO users (name, password_hash, role, is_active, created_at, email, base_unit) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (cleaned_name, hash_password(password), role, int(is_active), now, email, base_unit),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Este nome de usuário já está cadastrado.") from exc
        user_id = int(cursor.lastrowid)
        if role != ROLE_ADMIN:
            write_user_access(conn, user_id, access, now=now)
            if permissions is None:
                # Cadastro sem acessos informados (só o Administrador pode): grava o
                # padrão legado explicitamente em vez de depender de ausência de registro.
                permissions = legacy_module_access()
            write_module_access(conn, user_id, permissions, now=now)
        row = conn.execute(
            f"SELECT {USER_COLUMNS} FROM users WHERE id = ?",
            (user_id,),
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
        users = [_user_payload(row) for row in rows]
        for payload in users:
            decorate_user_payload(conn, payload)
            payload["module_access"] = module_access_from_conn(conn, payload["id"], role=payload["role"])
    return users


def _editable_user(conn: sqlite3.Connection, user_id: int, current_user_id: int) -> sqlite3.Row:
    if user_id == current_user_id:
        raise ValueError("Você não pode alterar a própria conta por esta tela.")
    row = conn.execute(
        "SELECT id, name, role, is_active FROM users WHERE id = ? AND role <> 'admin'",
        (user_id,),
    ).fetchone()
    if not row:
        raise ValueError("Usuário não encontrado.")
    validate_delegated_target(conn, current_user_id, user_id)
    return row


# Referências anuladas na exclusão, mas fora de check_integrity: bancos antigos
# podem já ter IDs pendentes nelas e isso não deve impedir a inicialização.
EXTRA_USER_REFERENCES = (
    ("production_statuses", "created_by"), ("production_statuses", "updated_by"),
    ("field_front_notes", "resolved_by"),
)


def delete_user(user_id: int, current_user_id: int) -> None:
    # Reproduz o antigo ON DELETE SET NULL sem FKs entre arquivos diferentes.
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _editable_user(conn, user_id, current_user_id)
        detach_user_data_before_delete(conn, user_id)
        for table, column in ALL_USER_REFERENCES + EXTRA_USER_REFERENCES:
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
    password_hash = hash_password(password)
    with auth_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _editable_user(conn, user_id, current_user_id)
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
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
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
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
        if not row:
            return None
        return _user_payload(row)


def delete_session(token: str | None) -> None:
    if not token:
        return
    with auth_connection() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_digest(token),))
