"""Sacarose: frentes/setores/seções por unidade, sincronizados com a posição oficial."""
import json
import time
from typing import Any

from .constants import SACAROSE_UNIT_CODES, UNIT_DEFINITIONS
from .sectors import _normalize_sector_code
from .storage import connection, validate_actor
from .units import UnitConflictError, _decode_unit, _history_insert, _normalize_status, _normalize_unit_payload, list_units_payload
from ..services.field_status import field_status
from ..services.front_identifiers import (
    position_front_key as _sacarose_match_key,
    position_front_sort_key as _sacarose_front_key,
)


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

            previous_sacarose = [{
                "front": row["front"], "sector": row["sector"], "section": row["section"],
                "exclude_image": bool(row["exclude_image"]),
            } for row in conn.execute(
                "SELECT front,sector,section,exclude_image FROM sacarose_positions WHERE unit_code=?",
                (code,),
            )]
            previous_sacarose.sort(key=lambda item: _sacarose_front_key(item["front"]))
            sacarose_changed = previous_sacarose != normalized[code]
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
                color = field_status(status)["color"]
                atr = str(match[4] or "").strip() if match and len(match) > 4 else ""
                synced_rows.append([display_front, item["sector"], color, status, atr])

            synced_rows.sort(key=lambda row: _sacarose_front_key(row[0]))
            current_unit["code"] = code
            current_unit["name"] = UNIT_DEFINITIONS[code]["name"]
            current_unit["rows"] = synced_rows
            normalized_unit = _normalize_unit_payload(current_unit, UNIT_DEFINITIONS[code]["position"])
            after_json = json.dumps(normalized_unit, ensure_ascii=False)
            before_json = unit_row["data_json"]

            # The shared version must also protect section/image-only edits.
            # Keep operational history limited to changes in the field position.
            position_changed = after_json != before_json
            if position_changed or sacarose_changed:
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
            if position_changed:
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
