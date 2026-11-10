"""Base de setores (setor + seção + descrição), cadastro manual e importação."""
import re
import time
from typing import Any

from .constants import MAX_SECTOR_LENGTH
from .storage import connection, validate_actor
from ..services.front_identifiers import natural_key


def _normalize_sector_code(value: Any, field: str = "Setor") -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"Informe o {field.lower()}.")
    if len(text) > MAX_SECTOR_LENGTH:
        raise ValueError(f"{field} deve ter no máximo {MAX_SECTOR_LENGTH} caracteres.")
    # Evita códigos vindos do Excel como 71.0 quando o valor é inteiro.
    if re.fullmatch(r"-?\d+\.0+", text):
        text = text.split(".", 1)[0]
    return text


def _normalize_sector_text(value: Any, field: str, max_length: int) -> str:
    text = str(value or "").strip()
    if len(text) > max_length:
        raise ValueError(f"{field} deve ter no máximo {max_length} caracteres.")
    return text


# Ordem natural de setor/seção ("2" antes de "10"); implementação compartilhada.
_sector_sort_key = natural_key


def list_sector_base(search: str | None = None) -> list[dict[str, Any]]:
    params: list[Any] = []
    where = ""
    if search:
        # Escapa curingas: "_1" busca o texto literal, não "qualquer caractere + 1".
        escaped = str(search).strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        term = f"%{escaped}%"
        where = ("WHERE s.sector LIKE ? ESCAPE '\\' OR s.section LIKE ? ESCAPE '\\'"
                 " OR s.description LIKE ? ESCAPE '\\'")
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
            # Renomear para uma seção que já existe sobrescreveria outro cadastro.
            if conn.execute(
                "SELECT 1 FROM sector_base WHERE sector = ? COLLATE NOCASE AND section = ? COLLATE NOCASE",
                (normalized_sector, normalized_section),
            ).fetchone():
                raise ValueError("Já existe este setor com a seção informada.")
            conn.execute(
                "DELETE FROM sector_base WHERE sector = ? COLLATE NOCASE AND section = ? COLLATE NOCASE",
                (normalized_sector, normalized_original_section),
            )
            # Mantém as posições da Sacarose ligadas à seção renomeada.
            conn.execute(
                """UPDATE sacarose_positions SET section = ?
                   WHERE sector = ? COLLATE NOCASE AND section = ? COLLATE NOCASE""",
                (normalized_section, normalized_sector, normalized_original_section),
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

def delete_sector_base_item(sector: Any, section: Any, user_id: int | None = None) -> None:
    normalized_sector = _normalize_sector_code(sector)
    normalized_section = _normalize_sector_text(section, "Seção", 24)
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if user_id is not None:
            validate_actor(conn, user_id)
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
