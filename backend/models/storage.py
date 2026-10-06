"""Conexões separadas e migração transacional do antigo banco único.

O banco legado é lido, nunca atualizado ou removido. Os dois bancos novos
usam journal DELETE: transações de arquivos anexados não são atômicas em WAL.
"""

import sqlite3
import threading
import uuid
from collections import Counter
from contextlib import contextmanager

from .. import config

AUTH_TABLES = ("users", "sessions")
CORE_DATA_TABLES = (
    "units", "unit_history", "sector_base", "sacarose_positions",
    "return_analysis_fronts", "return_analysis_equipment",
)
DATA_TABLES = CORE_DATA_TABLES + ("return_analysis_soil_wet",)
USER_REFERENCES = (
    ("units", "updated_by"), ("unit_history", "user_id"),
    ("sector_base", "updated_by"), ("sacarose_positions", "updated_by"),
    ("return_analysis_fronts", "updated_by"), ("return_analysis_equipment", "updated_by"),
)
OPTIONAL_USER_REFERENCES = (("return_analysis_soil_wet", "updated_by"),)
ALL_USER_REFERENCES = USER_REFERENCES + OPTIONAL_USER_REFERENCES
_INIT_LOCK = threading.Lock()


def _open(path, *, create=False):
    mode = "rwc" if create else "rw"
    conn = sqlite3.connect(
        path.resolve().as_uri() + f"?mode={mode}", uri=True,
        timeout=max(config.DB_BUSY_TIMEOUT_MS / 1000, 1),
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(f"PRAGMA busy_timeout = {config.DB_BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA synchronous = FULL")
    return conn


@contextmanager
def auth_connection():
    """Contas e sessões acessam somente usuarios.db."""
    conn = _open(config.AUTH_DB_PATH)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def connection():
    """Dados em main; auth anexado para identificar autores e excluir contas."""
    conn = _open(config.OPERATIONS_DB_PATH)
    try:
        conn.execute("ATTACH DATABASE ? AS auth", (config.AUTH_DB_PATH.resolve().as_uri() + "?mode=rw",))
        conn.execute("PRAGMA auth.synchronous = FULL")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def validate_actor(conn, user_id):
    if not conn.execute("SELECT 1 FROM auth.users WHERE id = ?", (user_id,)).fetchone():
        raise ValueError("Usuário responsável não encontrado.")


def _tables(conn, schema="main"):
    return {row[0] for row in conn.execute(
        f"SELECT name FROM {schema}.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )}


def _metadata(conn, schema):
    if "schema_info" not in _tables(conn, schema):
        return {}
    return dict(conn.execute(f"SELECT key, value FROM {schema}.schema_info"))


def _validate_pair(conn):
    main, auth = _metadata(conn, "main"), _metadata(conn, "auth")
    if main.get("pair_id") and main.get("pair_id") == auth.get("pair_id"):
        if main.get("schema_version") == auth.get("schema_version") == "1":
            if main.get("store") == "data" and auth.get("store") == "auth":
                data_tables, auth_tables = _tables(conn), _tables(conn, "auth")
                if (set(CORE_DATA_TABLES) <= data_tables and set(AUTH_TABLES) <= auth_tables
                        and not set(AUTH_TABLES) & data_tables and not set(DATA_TABLES) & auth_tables):
                    if any(conn.execute(f"PRAGMA {schema}.journal_mode").fetchone()[0] != "delete"
                           for schema in ("main", "auth")):
                        raise RuntimeError("Os dois bancos devem usar journal DELETE para manter transações conjuntas atômicas.")
                    return True
    if main or auth or _tables(conn) or _tables(conn, "auth"):
        raise RuntimeError(
            "Os dois bancos não formam um par completo e compatível. "
            "Não será criado um banco vazio sobre dados existentes. "
            "Verifique usuarios.db e dados.db juntos."
        )
    return False


def check_integrity(conn):
    for schema in ("main", "auth"):
        result = [row[0] for row in conn.execute(f"PRAGMA {schema}.integrity_check")]
        if result != ["ok"] or conn.execute(f"PRAGMA {schema}.foreign_key_check").fetchall():
            raise RuntimeError(f"Falha de integridade no banco {schema}.")
    for table, column in ALL_USER_REFERENCES:
        if conn.execute(
            f"SELECT 1 FROM main.{table} d LEFT JOIN auth.users u ON u.id=d.{column} "
            f"WHERE d.{column} IS NOT NULL AND u.id IS NULL LIMIT 1"
        ).fetchone():
            raise RuntimeError(f"Referência de usuário inválida em {table}.")


def _copy_table(source, destination, table, schema):
    info = destination.execute(f"PRAGMA {schema}.table_info({table})").fetchall()
    source_columns = {row[1] for row in source.execute(f"PRAGMA table_info({table})")}
    target_columns = {row[1] for row in info}
    if source_columns - target_columns:
        raise RuntimeError(f"Colunas não mapeadas na tabela legada {table}; migração interrompida.")
    columns = [row[1] for row in info if row[1] in source_columns]
    expressions = []
    for column in columns:
        # Mesmos ajustes de compatibilidade que o antigo inicializador aplicava.
        if column in {"section", "exclude_image", "role", "is_active", "version"}:
            default = next(row[4] for row in info if row[1] == column)
            expressions.append(f'COALESCE("{column}", {default})' if default is not None else f'"{column}"')
        else:
            expressions.append(f'"{column}"')
    if not columns:
        raise RuntimeError(f"Tabela legada {table} sem colunas compatíveis.")
    rows = [tuple(row) for row in source.execute(f"SELECT {', '.join(expressions)} FROM {table}")]
    quoted = ", ".join(f'"{column}"' for column in columns)
    destination.executemany(
        f"INSERT INTO {schema}.{table} ({quoted}) VALUES ({', '.join('?' for _ in columns)})", rows,
    )
    copied = [tuple(row) for row in destination.execute(f"SELECT {quoted} FROM {schema}.{table}")]
    if Counter(rows) != Counter(copied):
        raise RuntimeError(f"A conferência dos registros migrados falhou em {table}.")
    # Evita reutilizar IDs já excluídos no banco antigo (AUTOINCREMENT).
    if table in {"users", "sessions", "units", "unit_history"}:
        if source.execute("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").fetchone():
            sequence = source.execute("SELECT seq FROM sqlite_sequence WHERE name=?", (table,)).fetchone()
            if sequence:
                current = destination.execute(f"SELECT seq FROM {schema}.sqlite_sequence WHERE name=?", (table,)).fetchone()
                value = max(int(sequence[0]), int(current[0]) if current else 0)
                destination.execute(f"DELETE FROM {schema}.sqlite_sequence WHERE name=?", (table,))
                destination.execute(f"INSERT INTO {schema}.sqlite_sequence(name, seq) VALUES (?, ?)", (table, value))


def _copy_legacy(conn):
    source = sqlite3.connect(config.LEGACY_DB_PATH.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        source.execute(f"PRAGMA busy_timeout = {config.DB_BUSY_TIMEOUT_MS}")
        source.execute("BEGIN")  # Snapshot consistente de todas as tabelas.
        if source.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise RuntimeError("O banco legado falhou na verificação de integridade.")
        if source.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("O banco legado contém referências inválidas; migração interrompida.")
        tables = _tables(source)
        unknown = tables - set(AUTH_TABLES + DATA_TABLES)
        if unknown or "users" not in tables:
            raise RuntimeError("Estrutura do banco legado não reconhecida; nenhum dado será descartado.")
        for schema, names in (("auth", AUTH_TABLES), ("main", DATA_TABLES)):
            for table in names:
                if table in tables:
                    _copy_table(source, conn, table, schema)
        return "return_analysis_fronts" in tables
    finally:
        source.close()


def initialize_databases():
    """Inicializa/migra uma única vez; recusa pares incompletos e não remigra."""
    with _INIT_LOCK:
        paths = (config.AUTH_DB_PATH, config.OPERATIONS_DB_PATH, config.LEGACY_DB_PATH)
        if len({path.resolve() for path in paths}) != len(paths):
            raise RuntimeError("Os bancos de usuários, dados e legado devem ter caminhos diferentes.")
        for path in paths[:2]:
            path.parent.mkdir(parents=True, exist_ok=True)
        conn = _open(config.OPERATIONS_DB_PATH, create=True)
        try:
            conn.execute("ATTACH DATABASE ? AS auth", (str(config.AUTH_DB_PATH.resolve()),))
            conn.execute("PRAGMA auth.synchronous = FULL")
            # Bloqueia os dois arquivos antes de ler schemas/metadados: outro
            # worker pode estar confirmando a primeira migração neste momento.
            conn.execute("BEGIN IMMEDIATE")
            if _validate_pair(conn):
                _upgrade_user_profile(conn)
                _upgrade_operational_schema(conn)
                check_integrity(conn)
                conn.commit()
                return
            conn.execute("PRAGMA main.journal_mode = DELETE")
            conn.execute("PRAGMA auth.journal_mode = DELETE")
            for statement in SCHEMA_SQL.split(";"):
                if statement.strip():
                    conn.execute(statement)
            legacy_layouts = _copy_legacy(conn) if config.LEGACY_DB_PATH.is_file() else False
            _upgrade_user_profile(conn)
            _upgrade_operational_schema(conn)
            check_integrity(conn)
            pair_id = str(uuid.uuid4())
            for schema, store in (("main", "data"), ("auth", "auth")):
                conn.executemany(f"INSERT INTO {schema}.schema_info(key,value) VALUES (?,?)", (
                    ("pair_id", pair_id), ("schema_version", "1"), ("store", store),
                    ("legacy_migrated", "1" if config.LEGACY_DB_PATH.is_file() else "0"),
                ))
            conn.execute("INSERT INTO main.schema_info(key,value) VALUES ('legacy_return_layouts', ?)", ("1" if legacy_layouts else "0",))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def _upgrade_operational_schema(conn):
    """Migrações aditivas dos dados operacionais sem recriar os bancos existentes."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS main.return_analysis_soil_wet (
            unit_code TEXT NOT NULL,
            record_key TEXT NOT NULL,
            source_front TEXT NOT NULL DEFAULT '',
            equipment INTEGER NOT NULL,
            operation_date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            operation_code TEXT NOT NULL DEFAULT '',
            operation_description TEXT NOT NULL DEFAULT 'SOLO UMIDO',
            operation_group TEXT NOT NULL DEFAULT '',
            sector INTEGER NOT NULL,
            field INTEGER,
            farm TEXT NOT NULL DEFAULT '',
            import_file TEXT NOT NULL DEFAULT '',
            updated_by INTEGER,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (unit_code, record_key)
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS main.idx_return_soil_wet_unit_date ON return_analysis_soil_wet(unit_code, operation_date)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS main.idx_return_soil_wet_unit_sector_date ON return_analysis_soil_wet(unit_code, sector, operation_date)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS main.idx_return_soil_wet_unit_equipment_date ON return_analysis_soil_wet(unit_code, equipment, operation_date)"
    )
    conn.execute(
        "INSERT OR REPLACE INTO main.schema_info(key,value) VALUES ('return_soil_wet_schema_version','1')"
    )


def _upgrade_user_profile(conn):
    """Migração aditiva e idempotente: preserva contas, senhas e sessões."""
    columns = {row[1] for row in conn.execute("PRAGMA auth.table_info(users)")}
    for column, definition in (
        ("email", "TEXT NOT NULL DEFAULT ''"),
        ("base_unit", "TEXT NOT NULL DEFAULT 'PPT'"),
    ):
        if column not in columns:
            conn.execute(f"ALTER TABLE auth.users ADD COLUMN {column} {definition}")
    conn.execute("INSERT OR REPLACE INTO auth.schema_info(key,value) VALUES ('user_profile_version','1')")


# Somente FKs internas ao mesmo arquivo. Referências de autoria são verificadas
# por validate_actor e anuladas na exclusão de usuário dentro de uma transação.
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS main.schema_info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth.schema_info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth.users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    base_unit TEXT NOT NULL DEFAULT 'PPT'
);

CREATE TABLE IF NOT EXISTS auth.sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    data_json TEXT NOT NULL,
    updated_by INTEGER,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS unit_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_code TEXT NOT NULL,
    unit_name TEXT NOT NULL,
    user_id INTEGER,
    action TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sector_base (
    sector TEXT NOT NULL COLLATE NOCASE,
    section TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    updated_by INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (sector, section)
);

CREATE TABLE IF NOT EXISTS sacarose_positions (
    unit_code TEXT NOT NULL,
    front TEXT NOT NULL,
    sector TEXT NOT NULL,
    section TEXT NOT NULL DEFAULT '',
    exclude_image INTEGER NOT NULL DEFAULT 0,
    updated_by INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (unit_code, front)
);

CREATE TABLE IF NOT EXISTS return_analysis_fronts (
    unit_code TEXT NOT NULL,
    front_code TEXT NOT NULL COLLATE NOCASE,
    front_name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    updated_by INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (unit_code, front_code)
);

CREATE TABLE IF NOT EXISTS return_analysis_equipment (
    unit_code TEXT NOT NULL,
    front_code TEXT NOT NULL COLLATE NOCASE,
    equipment INTEGER NOT NULL,
    updated_by INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (unit_code, equipment),
    FOREIGN KEY (unit_code, front_code) REFERENCES return_analysis_fronts(unit_code, front_code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS return_analysis_soil_wet (
    unit_code TEXT NOT NULL,
    record_key TEXT NOT NULL,
    source_front TEXT NOT NULL DEFAULT '',
    equipment INTEGER NOT NULL,
    operation_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    operation_code TEXT NOT NULL DEFAULT '',
    operation_description TEXT NOT NULL DEFAULT 'SOLO UMIDO',
    operation_group TEXT NOT NULL DEFAULT '',
    sector INTEGER NOT NULL,
    field INTEGER,
    farm TEXT NOT NULL DEFAULT '',
    import_file TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (unit_code, record_key)
);

CREATE INDEX IF NOT EXISTS auth.idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_units_position ON units(position);
CREATE INDEX IF NOT EXISTS idx_unit_history_code_created ON unit_history(unit_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sector_base_section ON sector_base(section);
CREATE INDEX IF NOT EXISTS idx_sector_base_description ON sector_base(description);
CREATE INDEX IF NOT EXISTS idx_sacarose_positions_sector ON sacarose_positions(sector);
CREATE INDEX IF NOT EXISTS idx_sacarose_positions_sector_section ON sacarose_positions(sector, section);
CREATE INDEX IF NOT EXISTS idx_return_analysis_fronts_unit_position ON return_analysis_fronts(unit_code, position);
CREATE INDEX IF NOT EXISTS idx_return_analysis_equipment_front ON return_analysis_equipment(unit_code, front_code);
CREATE INDEX IF NOT EXISTS idx_return_soil_wet_unit_date ON return_analysis_soil_wet(unit_code, operation_date);
CREATE INDEX IF NOT EXISTS idx_return_soil_wet_unit_sector_date ON return_analysis_soil_wet(unit_code, sector, operation_date);
CREATE INDEX IF NOT EXISTS idx_return_soil_wet_unit_equipment_date ON return_analysis_soil_wet(unit_code, equipment, operation_date);
"""
