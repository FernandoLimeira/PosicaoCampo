from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATE_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
AUTH_DB_PATH = DATA_DIR / "usuarios.db"
OPERATIONS_DB_PATH = DATA_DIR / "dados.db"
# Somente fonte da migração inicial; nunca é utilizado para novas gravações.
LEGACY_DB_PATH = DATA_DIR / "posicao_campo.db"
SESSION_COOKIE = "posicao_campo_session"
SESSION_TTL_SECONDS = 12 * 60 * 60
REMEMBER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
MIN_PASSWORD_LENGTH = 8
MAX_BODY_BYTES = 2 * 1024 * 1024
DB_BUSY_TIMEOUT_MS = 10_000
