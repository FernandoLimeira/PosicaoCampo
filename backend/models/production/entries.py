"""Produção Agrícola: lançamentos diários das frentes, chuva e resumo do dia da unidade."""
from __future__ import annotations

import sqlite3
import time
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any

from ...services.operational_shifts import MS_UNIT_CODES
from ..constants import ALLOWED_UNIT_CODES
from ..storage import connection, validate_actor
from .common import (
    _clean_text,
    _normalize_operations,
    _normalize_status,
    _normalize_unit,
    _normalize_work_date,
)
from .access import _require_access
from .catalog import _catalog_front_for_unit, _sector_options_by_code, _validate_status_code
from .responsibilities import _scheduled_responsibles


def _entry_payload(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": int(row["id"]), "work_date": row["work_date"], "sector": row["sector"] or "",
        "section": row["section"] or "", "farm": row["farm"] or "", "status": row["status"],
        "observation": row["observation"] or "", "changes": row["changes"] or "",
        "operation": row["operation"] if "operation" in row.keys() and row["operation"] else "",
        "updated_at": int(row["updated_at"] or 0),
        "updated_by": row["updated_by"], "updated_by_name": row["updated_by_name"] or "Usuário removido",
    }


def list_my_items(user_id: int, unit_code: Any, work_date: Any, *, scope: str = "mine", with_orders: bool = True) -> dict[str, Any]:
    unit = _normalize_unit(unit_code)
    selected_date = _normalize_work_date(work_date)
    normalized_scope = str(scope or "mine").strip().lower()
    if normalized_scope not in {"mine", "all"}:
        raise ValueError("Visualização da Produção Agrícola inválida.")

    with connection() as conn:
        access = _require_access(conn, user_id, unit=unit)
        filters = ["ui.unit_code=?", "ui.is_active=1"]
        params: list[Any] = [unit]
        if normalized_scope == "mine":
            filters.insert(0, "ui.owner_user_id=?")
            params.insert(0, user_id)

        rows = conn.execute(
            f"""
            SELECT ui.id AS item_id,ui.owner_user_id,ui.service_front_id,ui.sector_group_id,ui.position,
                   f.name AS service_name,f.display_style,f.is_active AS service_active,
                   g.id AS group_id,g.name AS group_name,g.is_active AS group_active,
                   COALESCE(owner.name, 'Usuário removido') AS owner_name
            FROM production_user_items ui
            JOIN production_service_fronts f ON f.id=ui.service_front_id
            JOIN production_groups g ON g.id=f.group_id
            LEFT JOIN auth.users owner ON owner.id=ui.owner_user_id
            WHERE {' AND '.join(filters)}
            ORDER BY g.position,g.id,f.position,f.id,owner.name COLLATE NOCASE,ui.position,ui.id
            """,
            tuple(params),
        ).fetchall()
        latest_entries = {
            row["user_item_id"]: row for row in conn.execute(
                """SELECT entry.*,actor.name AS updated_by_name FROM production_daily_entries entry
                   LEFT JOIN auth.users actor ON actor.id=entry.updated_by
                   JOIN (
                     SELECT user_item_id,MAX(work_date) AS work_date
                     FROM production_daily_entries
                     WHERE unit_code=? AND work_date<=? AND user_item_id IS NOT NULL
                     GROUP BY user_item_id
                   ) newest ON newest.user_item_id=entry.user_item_id
                           AND newest.work_date=entry.work_date
                   WHERE entry.unit_code=?""",
                (unit, selected_date, unit),
            )
        }
        section_options = _sector_options_by_code(conn, (entry["sector"] for entry in latest_entries.values())) if unit not in MS_UNIT_CODES else {}
        responsibles = _scheduled_responsibles(conn, unit, selected_date)
        items = []
        for row in rows:
            latest = latest_entries.get(row["item_id"])
            entry = _entry_payload(latest)
            owner_user_id = int(row["owner_user_id"])
            team = responsibles.get(row["service_front_id"], {})
            items.append({
                "id": int(row["item_id"]), "owner_user_id": owner_user_id,
                "owner_name": row["owner_name"], "is_own": owner_user_id == int(user_id),
                "service_front_id": int(row["service_front_id"]),
                "sector_group_id": row["sector_group_id"],
                "responsibles": {shift: people[0]["name"] for shift, people in team.items() if people[0]["role_type"] == "lead"},
                "responsibility_team": team,
                "service_name": row["service_name"], "display_style": row["display_style"],
                "group_id": int(row["group_id"]), "group_name": row["group_name"],
                "catalog_active": bool(row["service_active"]) and bool(row["group_active"]),
                "entry": entry, "is_current_day": bool(entry and entry["work_date"] == selected_date),
            })
            if entry:
                sections = [option["section"] for option in section_options.get(entry["sector"].casefold(), []) if option["section"]]
                if sections and (entry["section"] or len(sections) > 1) and all(
                    entry["section"].casefold() != section.casefold() for section in sections
                ):
                    items[-1]["section_warning"] = {"saved": entry["section"], "choices": sections}
        # Import local: service_orders importa este módulo.
        if with_orders:
            from ..service_orders import attach_service_order_status
            attach_service_order_status(conn, unit, items)
        return {
            "unit": unit, "work_date": selected_date, "scope": normalized_scope, "items": items,
            "permissions": {"view": True, "fill": bool(access["can_fill"]), "configure": access["can_configure"], "summary": access["can_summary"]},
        }


def _normalize_rain(value: Any, field: str) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"{field} deve ser um número entre 0 e 9999,9 mm.")
    try:
        amount = Decimal(str(value).strip().replace(",", "."))
    except InvalidOperation as exc:
        raise ValueError(f"{field} deve ser um número entre 0 e 9999,9 mm.") from exc
    if not amount.is_finite() or amount < 0 or amount > Decimal("9999.9") or amount != amount.quantize(Decimal("0.1")):
        raise ValueError(f"{field} deve ser um número entre 0 e 9999,9 mm, com uma casa decimal.")
    return float(amount)


def _summary_payload(row: sqlite3.Row | None, unit: str, work_date: str) -> dict[str, Any]:
    return {
        "unit": unit, "work_date": work_date,
        "rain_turn_mm": row["rain_turn_mm"] if row else None,
        "rain_accumulated_mm": row["rain_accumulated_mm"] if row else None,
        "changes": row["changes"] if row else "",
        "updated_at": int(row["updated_at"]) if row else 0,
    }


def get_rain_overview(user_id: int, work_date: Any) -> dict[str, Any]:
    """Chuva nas 4 unidades (quadro gerencial fixo do painel) e a média das que informaram.
    Fonte: o botão "Informar chuva" da Produção de cada unidade (a média das frentes).
    Vale só a chuva do dia pedido: unidade sem chuva no dia fica "não informada" e fora
    da média (não usa chuva de dias anteriores).
    É visão gerencial: vale para quem acessa a Produção, em qualquer unidade."""
    selected_date = _normalize_work_date(work_date)
    with connection() as conn:
        _require_access(conn, user_id)
        rows = {
            row["unit_code"]: row for row in conn.execute(
                """SELECT unit_code,work_date,rain_turn_mm,rain_accumulated_mm,updated_at
                   FROM production_daily_summaries WHERE work_date=?""",
                (selected_date,),
            )
        }
    units = []
    for code in ALLOWED_UNIT_CODES:
        row = rows.get(code)
        units.append({
            "unit": code,
            "work_date": row["work_date"] if row else None,
            "rain_turn_mm": row["rain_turn_mm"] if row else None,
            "rain_accumulated_mm": row["rain_accumulated_mm"] if row else None,
            "updated_at": int(row["updated_at"]) if row else 0,
        })

    def average(field: str) -> float | None:
        values = [float(item[field]) for item in units if item[field] is not None]
        return round(sum(values) / len(values), 1) if values else None
    return {
        "work_date": selected_date, "units": units,
        "average_turn_mm": average("rain_turn_mm"),
        "average_accumulated_mm": average("rain_accumulated_mm"),
        "informed": sum(1 for item in units if item["rain_turn_mm"] is not None or item["rain_accumulated_mm"] is not None),
    }


def get_daily_summary(user_id: int, unit_code: Any, work_date: Any) -> dict[str, Any]:
    unit = _normalize_unit(unit_code)
    selected_date = _normalize_work_date(work_date)
    with connection() as conn:
        _require_access(conn, user_id, unit=unit)
        row = conn.execute(
            "SELECT * FROM production_daily_summaries WHERE unit_code=? AND work_date=?",
            (unit, selected_date),
        ).fetchone()
        return _summary_payload(row, unit, selected_date)


def save_daily_summary(user_id: int, payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Dados do resumo diário inválidos.")
    unit = _normalize_unit(payload.get("unit_code"))
    selected_date = _normalize_work_date(payload.get("work_date"))
    rain_turn = _normalize_rain(payload.get("rain_turn_mm"), "Chuva do turno")
    rain_accumulated = _normalize_rain(payload.get("rain_accumulated_mm"), "Chuva acumulada")
    # Só sobrescreve o que foi enviado: salvar apenas as mudanças não apaga a chuva.
    rain_turn_provided = "rain_turn_mm" in payload
    rain_accumulated_provided = "rain_accumulated_mm" in payload
    changes_provided = "changes" in payload
    changes = _clean_text(payload.get("changes"), "as mudanças", 2000)
    now = int(time.time())
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_access(conn, user_id, permission="summary", unit=unit)
        validate_actor(conn, user_id)
        conn.execute(
            """INSERT INTO production_daily_summaries(
                unit_code,work_date,rain_turn_mm,rain_accumulated_mm,changes,updated_by,updated_at
            ) VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(unit_code,work_date) DO UPDATE SET
                rain_turn_mm=CASE WHEN ? THEN excluded.rain_turn_mm ELSE production_daily_summaries.rain_turn_mm END,
                rain_accumulated_mm=CASE WHEN ? THEN excluded.rain_accumulated_mm
                                         ELSE production_daily_summaries.rain_accumulated_mm END,
                changes=CASE WHEN ? THEN excluded.changes ELSE production_daily_summaries.changes END,
                updated_by=excluded.updated_by,updated_at=excluded.updated_at""",
            (unit, selected_date, rain_turn, rain_accumulated, changes, user_id, now,
             rain_turn_provided, rain_accumulated_provided, changes_provided),
        )
        row = conn.execute(
            "SELECT * FROM production_daily_summaries WHERE unit_code=? AND work_date=?",
            (unit, selected_date),
        ).fetchone()
        return _summary_payload(row, unit, selected_date)


def _normalize_entry_data(payload: dict[str, Any]) -> dict[str, str]:
    return {
        "work_date": _normalize_work_date(payload.get("work_date")),
        "sector": _clean_text(payload.get("sector"), "o setor", 32, required=True),
        "section": _clean_text(payload.get("section"), "a seção", 32),
        "farm": _clean_text(payload.get("farm"), "a fazenda", 160),
        "status": _normalize_status(payload.get("status")),
        "observation": _clean_text(payload.get("observation"), "a observação", 2000),
        "changes": _clean_text(payload.get("changes"), "as mudanças", 2000),
        "operation": _normalize_operations(payload.get("operation")),
    }


def _apply_registered_section(entry: dict[str, str], options: list[dict[str, str]]) -> None:
    sections = [option for option in options if option["section"]]
    if not sections:
        return
    previous = entry["section"].casefold()
    selected = sections[0] if len(sections) == 1 else next(
        (option for option in sections if option["section"].casefold() == previous), None
    )
    if selected is None:
        raise ValueError(f"Confirme a seção do setor {entry['sector']} no Cadastro de Setores.")
    entry["section"] = selected["section"]
    if selected["farm"] and (not entry["farm"] or (previous and previous != selected["section"].casefold())):
        entry["farm"] = selected["farm"]


def _active_front_entries(conn: sqlite3.Connection, unit: str, front_id: int, work_date: str | None = None):
    return conn.execute(
        """SELECT ui.id,ui.sector_group_id,e.sector FROM production_user_items ui
           JOIN production_daily_entries e ON e.id=(
             SELECT latest.id FROM production_daily_entries latest
             WHERE latest.user_item_id=ui.id AND (? IS NULL OR latest.work_date<=?)
             ORDER BY latest.work_date DESC,latest.id DESC LIMIT 1
           )
           WHERE ui.unit_code=? AND ui.service_front_id=? AND ui.is_active=1
           ORDER BY e.work_date DESC,e.updated_at DESC,e.id DESC""",
        (work_date, work_date, unit, front_id),
    ).fetchall()


def _deactivate_items(conn: sqlite3.Connection, item_ids: list[int], now: int, work_date: str | None = None) -> None:
    conn.executemany(
        """UPDATE production_user_items SET is_active=0,updated_at=? WHERE id=?
           AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM production_daily_entries
                                        WHERE user_item_id=? AND work_date>?))""",
        [(now, item_id, work_date, item_id, work_date) for item_id in item_ids],
    )


def save_my_item(user_id: int, payload: Any, *, item_id: int | None = None) -> dict[str, Any]:
    return _save_my_items(user_id, payload, [payload], item_id=item_id)[0]


def save_my_item_note(user_id: int, item_id: int, payload: Any) -> bool:
    if not isinstance(payload, dict) or payload.get("field") not in ("observation", "changes"):
        raise ValueError("Anotação inválida.")
    field = payload["field"]
    unit = _normalize_unit(payload.get("unit_code"))
    work_date = _normalize_work_date(payload.get("work_date"))
    if not isinstance(payload.get("expected"), str) or not isinstance(payload.get("value"), str):
        raise ValueError("Informe o texto da anotação.")
    value = _clean_text(payload["value"], "a anotação", 2000)
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_access(conn, user_id, permission="fill", unit=unit)
        item = conn.execute("""SELECT e.*, ui.service_front_id AS current_front_id
                               FROM production_user_items ui
                               JOIN production_daily_entries e ON e.user_item_id=ui.id AND e.unit_code=ui.unit_code
                               WHERE ui.id=? AND ui.unit_code=? AND ui.is_active=1 AND e.work_date<=?
                               ORDER BY e.work_date DESC LIMIT 1""", (item_id, unit, work_date)).fetchone()
        if not item:
            raise ValueError("Lançamento da frente não encontrado nesta unidade.")
        if (item[field] or "") != payload["expected"]:
            return False
        if (item[field] or "") != value:
            front_id = item["current_front_id"]
            front = _catalog_front_for_unit(conn, front_id, unit, allow_inactive=True)
            entry = {**dict(item), "work_date": work_date, field: value}
            _save_my_item(conn, user_id, unit, front_id, front, entry, int(time.time()), item_id=item_id)
        return True


def save_my_items(user_id: int, payload: Any, *, item_id: int | None = None) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise ValueError("Dados dos setores inválidos.")
    sectors = payload.get("sectors")
    if not isinstance(sectors, list) or not 1 <= len(sectors) <= 100:
        raise ValueError("Informe entre 1 e 100 setores por lançamento.")
    return _save_my_items(user_id, payload, sectors, item_id=item_id, edit_sectors=True)


def _sector_item_ids(values: Any) -> set[int]:
    if not isinstance(values, list) or len(values) > 100 or any(type(value) is not int or value <= 0 for value in values):
        raise ValueError("Lançamentos de setores inválidos.")
    return set(values)


def _save_my_items(
    user_id: int, payload: Any, sectors: list[Any], *, item_id: int | None = None, edit_sectors: bool = False,
) -> list[dict[str, Any]]:
    """Grava um ou vários setores na mesma transação, preservando o histórico individual."""
    if not isinstance(payload, dict):
        raise ValueError("Dados do apontamento inválidos.")
    explicit_sectors = edit_sectors and "removed_sector_ids" in payload
    removed_ids = _sector_item_ids(payload["removed_sector_ids"]) if explicit_sectors else set()
    if explicit_sectors and item_id is None:
        raise ValueError("Selecione a frente que deseja editar.")
    unit = _normalize_unit(payload.get("unit_code"))
    try:
        front_id = int(payload.get("service_front_id"))
    except (TypeError, ValueError) as exc:
        raise ValueError("Selecione a frente/serviço.") from exc
    entries = []
    seen = set()
    for sector in sectors:
        if not isinstance(sector, dict):
            raise ValueError("Dados do setor inválidos.")
        entry = _normalize_entry_data({**sector, "work_date": payload.get("work_date")})
        key = entry["sector"].upper()
        if key in seen:
            raise ValueError(f"O setor {entry['sector']} está repetido nesta frente.")
        seen.add(key)
        entries.append(entry)
    now = int(time.time())
    item_ids = []
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_access(conn, user_id, permission="fill", unit=unit)
        validate_actor(conn, user_id)
        front = _catalog_front_for_unit(conn, front_id, unit, allow_inactive=item_id is not None and len(entries) == 1)
        section_options = _sector_options_by_code(conn, (entry["sector"] for entry in entries)) if unit not in MS_UNIT_CODES else {}
        existing = _active_front_entries(conn, unit, front_id, entries[0]["work_date"])
        by_id = {row["id"]: row for row in existing}
        edited = by_id.get(item_id)
        previous_group = edited["sector_group_id"] if edited else None
        if explicit_sectors:
            linked_ids = {row["id"] for row in existing if row["id"] == item_id
                          or (previous_group and row["sector_group_id"] == previous_group)}
            retained_ids = _sector_item_ids([source["id"] for source in sectors if "id" in source])
            if not edited or (retained_ids & removed_ids) or (retained_ids | removed_ids) != linked_ids:
                raise ValueError("O vínculo dos setores mudou. Reabra a frente para editar.")
        existing_sectors = {}
        for row in existing:
            if row["id"] in removed_ids:
                continue
            existing_sectors.setdefault(row["sector"].strip().upper(), []).append(row["id"])
        for index, (entry, source) in enumerate(zip(entries, sectors)):
            entry["status"] = _validate_status_code(conn, entry["status"])
            _apply_registered_section(entry, section_options.get(entry["sector"].casefold(), []))
            matching_ids = existing_sectors.get(entry["sector"].upper(), [])
            target_id = item_id if index == 0 and not explicit_sectors else None
            if explicit_sectors:
                target_id = source.get("id")
            elif item_id is not None and index > 0 and source.get("id") is not None:
                linked = by_id.get(source["id"]) if type(source["id"]) is int else None
                if not previous_group or not linked or linked["sector_group_id"] != previous_group or linked["id"] == item_id:
                    raise ValueError("O vínculo dos setores mudou. Reabra a frente para editar.")
                target_id = linked["id"]
            if item_id is not None and target_id is None:
                # Uma linha adicionada à edição pode vincular um setor já lançado separadamente.
                target_id = next((candidate for candidate in matching_ids if candidate != item_id
                                  and not by_id[candidate]["sector_group_id"]), None)
            if item_id is not None and matching_ids and target_id not in matching_ids:
                raise ValueError(f"O setor {entry['sector']} já está cadastrado nesta frente. Edite o lançamento existente.")
            if target_id in item_ids:
                raise ValueError("O mesmo lançamento foi informado mais de uma vez.")
            target_id = target_id if item_id is not None else next(iter(matching_ids), None)
            _keep_previous_fields(conn, target_id, entry, source)
            if target_id is None and "operation" not in source and "default_operation" in source:
                entry["operation"] = _normalize_operations(source["default_operation"])
            saved_id = _save_my_item(conn, user_id, unit, front_id, front, entry, now, item_id=target_id)
            item_ids.append(saved_id)
            # Personal copies left by older releases must not remain as active positions.
            # Keep all entries, and never retire a copy with a later work date.
            duplicate_ids = [candidate for candidate in matching_ids if candidate != saved_id]
            _deactivate_items(conn, duplicate_ids, now, entry["work_date"])
        if edit_sectors and (item_id is not None or len(item_ids) > 1):
            if previous_group:
                conn.execute("""UPDATE production_user_items SET sector_group_id=NULL
                                WHERE unit_code=? AND service_front_id=? AND sector_group_id=?""",
                             (unit, front_id, previous_group))
            group_id = (previous_group or uuid.uuid4().hex) if len(item_ids) > 1 else None
            conn.executemany("UPDATE production_user_items SET sector_group_id=? WHERE id=?",
                             [(group_id, saved_id) for saved_id in item_ids])
        _deactivate_items(conn, list(removed_ids), now)
    result = list_my_items(user_id, unit, entries[0]["work_date"], scope="all", with_orders=False)
    by_id = {item["id"]: item for item in result["items"]}
    return [by_id[saved_id] for saved_id in item_ids]


PRESERVED_ENTRY_FIELDS = ("observation", "changes", "operation")


def _keep_previous_fields(conn: sqlite3.Connection, target_id: int | None, entry: dict[str, str], source: dict) -> None:
    """Campos não enviados mantêm o valor do último registro do lançamento."""
    missing = [field for field in PRESERVED_ENTRY_FIELDS if field not in source]
    if target_id is None or not missing:
        return
    previous = conn.execute(
        """SELECT observation,changes,operation FROM production_daily_entries
           WHERE user_item_id=? AND work_date<=? ORDER BY work_date DESC,id DESC LIMIT 1""",
        (target_id, entry["work_date"]),
    ).fetchone()
    if previous:
        for field in missing:
            entry[field] = previous[field] or ""


def save_items_sheet(user_id: int, payload: Any) -> dict[str, Any]:
    """Grava a planilha do popup (várias frentes da unidade) numa única transação.

    ``rows`` traz só as linhas novas ou alteradas; ``removed`` os lançamentos excluídos.
    Linha sem fazenda usa a fazenda da base de setores (setor + seção).
    """
    if not isinstance(payload, dict):
        raise ValueError("Dados da atualização inválidos.")
    unit = _normalize_unit(payload.get("unit_code"))
    work_date = _normalize_work_date(payload.get("work_date"))
    rows = payload.get("rows") or []
    removed = payload.get("removed") or []
    if not isinstance(rows, list) or not isinstance(removed, list) or len(rows) > 300 or len(removed) > 300:
        raise ValueError("Dados da atualização inválidos.")
    if not rows and not removed:
        raise ValueError("Nenhuma alteração para salvar.")
    try:
        removed_ids = {int(value) for value in removed}
    except (TypeError, ValueError) as exc:
        raise ValueError("Lançamento removido inválido.") from exc

    prepared = []
    seen = set()
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            raise ValueError(f"Linha {index}: dados inválidos.")
        try:
            front_id = int(row.get("service_front_id"))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Linha {index}: selecione a frente.") from exc
        try:
            entry = _normalize_entry_data({**row, "work_date": work_date})
        except ValueError as exc:
            raise ValueError(f"Linha {index}: {exc}") from exc
        item_id = row.get("id")
        if isinstance(item_id, bool) or not isinstance(item_id, (int, str, type(None))):
            raise ValueError(f"Linha {index}: lançamento inválido.")
        item_id = int(item_id) if item_id not in (None, "") else None
        if item_id in removed_ids:
            raise ValueError(f"Linha {index}: o lançamento foi marcado para exclusão.")
        key = (front_id, entry["sector"].upper())
        if key in seen:
            raise ValueError(f"Linha {index}: o setor {entry['sector']} está repetido para a mesma frente.")
        seen.add(key)
        prepared.append((index, front_id, item_id, entry, row))

    # Lançamentos reescritos nesta gravação não contam pelo setor antigo: trocar o setor
    # entre linhas (A recebe o setor de B, B muda) não depende da ordem das linhas.
    # O setor novo de cada um já foi conferido acima contra as demais linhas.
    rewritten_ids = {item_id for _, _, item_id, _, _ in prepared if item_id is not None}
    now = int(time.time())
    saved_ids = []
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_access(conn, user_id, permission="fill", unit=unit)
        validate_actor(conn, user_id)
        section_options = _sector_options_by_code(conn, (entry["sector"] for _, _, _, entry, _ in prepared)) if unit not in MS_UNIT_CODES else {}
        for item_id in removed_ids:
            item = conn.execute(
                "SELECT unit_code FROM production_user_items WHERE id=? AND is_active=1", (item_id,),
            ).fetchone()
            if not item or item["unit_code"] != unit:
                raise ValueError("Lançamento removido não encontrado nesta unidade.")
            _deactivate_items(conn, [item_id], now)
        for index, front_id, item_id, entry, source in prepared:
            try:
                front = _catalog_front_for_unit(conn, front_id, unit, allow_inactive=item_id is not None)
                entry["status"] = _validate_status_code(conn, entry["status"])
                _apply_registered_section(entry, section_options.get(entry["sector"].casefold(), []))
            except ValueError as exc:
                raise ValueError(f"Linha {index}: {exc}") from exc
            matching_ids = [row["id"] for row in _active_front_entries(conn, unit, front_id, work_date)
                            if row["sector"].strip().upper() == entry["sector"].upper() and row["id"] not in removed_ids
                            and (row["id"] == item_id or row["id"] not in rewritten_ids)]
            if item_id is not None and matching_ids and item_id not in matching_ids:
                raise ValueError(f"Linha {index}: o setor {entry['sector']} já está lançado nesta frente.")
            target_id = item_id if item_id is not None else next(iter(matching_ids), None)
            _keep_previous_fields(conn, target_id, entry, source)
            if not entry["farm"]:
                base = conn.execute(
                    """SELECT description FROM sector_base WHERE sector=? COLLATE NOCASE
                       ORDER BY (section=? COLLATE NOCASE) DESC, section COLLATE NOCASE LIMIT 1""",
                    (entry["sector"], entry["section"]),
                ).fetchone()
                entry["farm"] = (base["description"] if base else "") or ""
            saved_ids.append(_save_my_item(conn, user_id, unit, front_id, front, entry, now, item_id=target_id))
    return {"saved": len(saved_ids), "removed": len(removed_ids), "item_ids": saved_ids}


def _save_my_item(
    conn: sqlite3.Connection, user_id: int, unit: str, front_id: int,
    front: sqlite3.Row, entry: dict[str, str], now: int, *, item_id: int | None = None,
) -> int:
    owner_id = user_id
    if item_id is None:
        position = conn.execute(
            "SELECT COALESCE(MAX(position),-1)+1 FROM production_user_items WHERE owner_user_id=? AND unit_code=? AND is_active=1",
            (user_id, unit),
        ).fetchone()[0]
        cursor = conn.execute(
            """INSERT INTO production_user_items(owner_user_id,unit_code,service_front_id,position,is_active,created_at,updated_at)
               VALUES (?,?,?,?,1,?,?)""",
            (user_id, unit, front_id, int(position or 0), now, now),
        )
        item_id = int(cursor.lastrowid)
    else:
        item = conn.execute(
            "SELECT id,unit_code,owner_user_id FROM production_user_items WHERE id=? AND is_active=1",
            (item_id,),
        ).fetchone()
        if not item:
            raise ValueError("Lançamento da frente não encontrado.")
        _require_access(conn, user_id, permission="fill", unit=item["unit_code"])
        owner_id = item["owner_user_id"]
        if item["unit_code"] != unit:
            raise ValueError("A unidade de uma frente já salva não pode ser alterada. Remova e adicione novamente.")
        conn.execute(
            """UPDATE production_user_items
               SET sector_group_id=CASE WHEN service_front_id=? THEN sector_group_id END,service_front_id=?,updated_at=?
               WHERE id=?""",
            (front_id, front_id, now, item_id),
        )

    conn.execute(
        """
        INSERT INTO production_daily_entries(
            work_date,user_item_id,owner_user_id,unit_code,service_front_id,service_name,group_name,display_style,
            sector,section,farm,status,observation,changes,operation,created_by,updated_by,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(work_date,user_item_id) DO UPDATE SET
            unit_code=excluded.unit_code,
            service_front_id=excluded.service_front_id, service_name=excluded.service_name,
            group_name=excluded.group_name, display_style=excluded.display_style,
            sector=excluded.sector, section=excluded.section, farm=excluded.farm,
            status=excluded.status, observation=excluded.observation, changes=excluded.changes,
            operation=excluded.operation,
            updated_by=excluded.updated_by, updated_at=excluded.updated_at
        """,
        (
            entry["work_date"], item_id, owner_id, unit, front_id, front["name"], front["group_name"], front["display_style"],
            entry["sector"], entry["section"], entry["farm"], entry["status"], entry["observation"], entry["changes"],
            entry.get("operation", ""), user_id, user_id, now, now,
        ),
    )
    return item_id


def remove_my_item(user_id: int, item_id: int, *, entire_front: bool = False, expected_ids: Any = None) -> None:
    now = int(time.time())
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        item = conn.execute(
            "SELECT id,unit_code,service_front_id,sector_group_id FROM production_user_items WHERE id=? AND is_active=1",
            (item_id,),
        ).fetchone()
        if not item:
            raise ValueError("Lançamento da frente não encontrado.")
        _require_access(conn, user_id, permission="fill", unit=item["unit_code"])
        entries = _active_front_entries(conn, item["unit_code"], item["service_front_id"])
        if entire_front:
            group_id = item["sector_group_id"]
            linked_ids = {entry["id"] for entry in entries if group_id and entry["sector_group_id"] == group_id}
            linked_ids.add(item_id)
            if _sector_item_ids(expected_ids) != linked_ids:
                raise ValueError("O vínculo dos setores mudou. Reabra a frente para removê-la.")
            _deactivate_items(conn, list(linked_ids), now)
            return
        target = next((entry for entry in entries if entry["id"] == item_id), None)
        item_ids = [entry["id"] for entry in entries if target and entry["sector"].strip().upper() == target["sector"].strip().upper()]
        _deactivate_items(conn, item_ids or [item_id], now)


def detach_user_data_before_delete(conn: sqlite3.Connection, user_id: int) -> None:
    """Preserva o histórico e remove somente a lista pessoal do usuário excluído."""
    conn.execute("UPDATE production_daily_entries SET owner_user_id=NULL WHERE owner_user_id=?", (user_id,))
    conn.execute("DELETE FROM production_user_items WHERE owner_user_id=?", (user_id,))
