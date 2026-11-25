"""Produção Agrícola: permissões por unidade, catálogo e apontamentos diários.

A autorização por unidade é independente da lista pessoal de frentes; cada
atualização diária mantém histórico separado.

Módulos: ``common`` (normalização), ``access`` (permissões), ``catalog`` (status, grupos,
frentes e base de setores), ``responsibilities`` (escala da equipe) e ``entries``
(lançamentos, chuva e resumo do dia). Os nomes continuam disponíveis em
``backend.models.production``.
"""
from .common import (  # noqa: F401
    DISPLAY_STYLES,
    MODULE_KEY,
    STATUS_STYLE_KEYS,
    _ONLY_CODES,
    _clean_text,
    _normalize_operations,
    _normalize_position,
    _normalize_status,
    _normalize_unit,
    _normalize_work_date,
    split_operations,
)
from .access import (  # noqa: F401
    _access_from_conn,
    _can_update_summary,
    _require_access,
    _require_configure,
    _unit_access_from_conn,
    access_summary,
    decorate_user_payload,
    get_user_access,
    normalize_user_access,
    save_user_access,
    write_user_access,
)
from .catalog import (  # noqa: F401
    _catalog_front_for_unit,
    _group_payload,
    _status_payload,
    _validate_status_code,
    delete_group,
    delete_service_front,
    delete_status,
    list_catalog,
    list_sector_base_entries,
    list_sector_options,
    list_statuses,
    save_group,
    save_service_front,
    save_status,
)
from .responsibilities import (  # noqa: F401
    _require_responsibility_edit,
    _responsibility_permissions,
    _scheduled_responsibles,
    delete_responsibility_rule,
    get_responsibility_catalog,
    normalize_whatsapp,
    save_responsibility_role,
    save_responsibility_rule,
    save_responsibility_rules,
    update_responsibility_rules,
)
from .entries import (  # noqa: F401
    PRESERVED_ENTRY_FIELDS,
    _active_front_entries,
    _deactivate_items,
    _entry_payload,
    _keep_previous_fields,
    _normalize_entry_data,
    _normalize_rain,
    _save_my_item,
    _save_my_items,
    _summary_payload,
    detach_user_data_before_delete,
    get_daily_summary,
    get_rain_overview,
    list_my_items,
    remove_my_item,
    save_daily_summary,
    save_items_sheet,
    save_my_item,
    save_my_item_note,
    save_my_items,
)
