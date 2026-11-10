"""Fachada de persistência: inicialização dos bancos e reexportação dos modelos.

A implementação vive em módulos por domínio:

- ``constants``   constantes sem dependências (unidades, perfis, limites);
- ``users``       usuários, credenciais, sessões e administração de contas;
- ``units``       posição de campo por unidade, versões e histórico;
- ``sectors``     base de setores;
- ``sacarose``    posições da Sacarose;
- ``returns``     layouts de mudanças de área e apontamentos de solo úmido.

Este módulo mantém os nomes públicos (e alguns privados usados pelos testes)
para que ``from backend.models import database as db`` e ``backend.database``
continuem funcionando. Código novo deve importar do módulo de domínio.
"""
import time

from .constants import (  # noqa: F401
    ALLOWED_ROLES,
    ALLOWED_UNIT_CODES,
    MAX_SECTOR_LENGTH,
    METRIC_DEFINITIONS,
    ROLE_ADMIN,
    ROLE_ANALYST,
    ROLE_COORDINATOR,
    ROLE_USER,
    SACAROSE_UNIT_CODES,
    UNIT_DEFINITIONS,
)
from .module_access import materialize_legacy_module_access
from .returns import (  # noqa: F401
    _normalize_return_equipment,
    _normalize_return_front_code,
    _seed_return_layouts,
    get_return_soil_wet_summary,
    import_return_soil_wet_records,
    list_return_analysis_layouts,
    list_return_soil_wet_records,
    save_return_analysis_layouts,
)
from .sacarose import (  # noqa: F401
    _sacarose_front_key,
    _sacarose_match_key,
    list_sacarose_positions,
    save_sacarose_positions,
)
from .sectors import (  # noqa: F401
    _normalize_sector_code,
    _normalize_sector_text,
    _sector_sort_key,
    delete_sector_base_item,
    import_sector_base_items,
    list_sector_base,
    save_sector_base_item,
)
from .security import hash_password, new_session_token, token_digest, verify_password  # noqa: F401
from .storage import (  # noqa: F401
    ALL_USER_REFERENCES,
    auth_connection,
    connection,
    initialize_databases,
    seed_production_defaults,
    validate_actor,
)
from ..services.field_status import field_status, field_unit_border  # noqa: F401
from ..services.front_identifiers import standardize_rain_labels  # noqa: F401
from ..services.operational_shifts import shift_at, shift_period  # noqa: F401
from .units import (  # noqa: F401
    UnitConflictError,
    _decode_unit,
    _history_insert,
    _metric_value_text,
    _nonnegative_number,
    _normalize_status,
    _normalize_unit_payload,
    _parse_br_number,
    _repair_unit_identities,
    _seed_missing_units,
    _standardize_unit_rain,
    _sync_sacarose_from_position_unit,
    initialize_units,
    list_history,
    list_unit_versions,
    list_units,
    list_units_payload,
    save_unit,
)
from .users import (  # noqa: F401
    EXTRA_USER_REFERENCES,
    USER_COLUMNS,
    _editable_user,
    _user_payload,
    _validate_credentials,
    authenticate_user,
    create_or_update_admin,
    create_session,
    create_user,
    delete_session,
    delete_user,
    get_user_by_session,
    has_admin,
    list_users,
    reset_user_password,
    set_user_active,
)


def init_db() -> None:
    initialize_databases()
    with auth_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("UPDATE users SET role = 'user' WHERE role IS NULL OR role NOT IN ('admin', 'user', 'coordinator', 'analyst')")
        conn.execute("UPDATE users SET is_active = 1 WHERE is_active IS NULL")
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
        conn.execute(
            """DELETE FROM sessions WHERE id != (
                 SELECT latest.id FROM sessions latest WHERE latest.user_id=sessions.user_id
                 ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1
               )"""
        )
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")
        materialize_legacy_module_access(conn)
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _repair_unit_identities(conn)
        _seed_missing_units(conn)
        _standardize_unit_rain(conn)
        seed_production_defaults(conn)
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
