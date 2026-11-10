"""Serviço de importação da base de setores a partir de planilhas XLSX/XLSM.

A rotina procura preferencialmente uma aba chamada BASE_DADOS e aceita os
cabeçalhos usados no arquivo Informe Sacarose: SETOR, SEÇÃO e DESCRIÇÃO SETOR.
Também reconhece "Fazenda" como descrição para facilitar planilhas equivalentes.
"""
from __future__ import annotations

from .front_identifiers import normalize_label
from .xlsx_reader import (
    XlsxLimits,
    corrupt_file_guard,
    open_archive,
    plain_cell_value,
    read_sheet_rows,
    shared_strings,
    validate_archive,
    workbook_sheets,
)

MAX_SECTOR_BASE_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_XLSX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
MAX_XLSX_ENTRY_BYTES = 32 * 1024 * 1024
MAX_XLSX_ROWS = 25000
MAX_XLSX_COLUMNS = 256
MAX_SHARED_STRINGS = 200000
XLSX_LIMITS = XlsxLimits(
    max_entry_bytes=MAX_XLSX_ENTRY_BYTES,
    max_uncompressed_bytes=MAX_XLSX_UNCOMPRESSED_BYTES,
    max_rows=MAX_XLSX_ROWS,
    max_columns=MAX_XLSX_COLUMNS,
    max_shared_strings=MAX_SHARED_STRINGS,
)

_norm = normalize_label


def _sheet_rows(archive, sheet_path: str, shared):
    if sheet_path not in archive.namelist():
        return []
    with corrupt_file_guard():
        return [values for values, _ in read_sheet_rows(
            archive, sheet_path, lambda cell: plain_cell_value(cell, shared),
            max_rows=MAX_XLSX_ROWS, max_columns=MAX_XLSX_COLUMNS, keep_empty_rows=True,
        )]


HEADER_ALIASES = {
    "sector": {"setor", "codigo setor", "cod setor", "codigo do setor"},
    "section": {"secao", "codigo secao", "cod secao", "codigo da secao"},
    "description": {
        "descricao setor",
        "descricao do setor",
        "fazenda",
        "descricao fazenda",
        "descricao da fazenda",
        "nome fazenda",
    },
}


def _find_header(rows):
    for row_index, row in enumerate(rows[:30]):
        normalized = [_norm(value) for value in row]
        mapping = {}
        for key, aliases in HEADER_ALIASES.items():
            for col_index, value in enumerate(normalized):
                if value in aliases:
                    mapping[key] = col_index
                    break
        if "sector" in mapping and ("section" in mapping or "description" in mapping):
            return row_index, mapping
    return None, None


def _parse_rows(rows):
    header_index, mapping = _find_header(rows)
    if header_index is None or mapping is None:
        return []

    items = []
    for row in rows[header_index + 1 :]:
        sector_col = mapping["sector"]
        sector = str(row[sector_col] if sector_col < len(row) else "").strip()
        if not sector:
            continue
        section_col = mapping.get("section")
        desc_col = mapping.get("description")
        section = str(row[section_col] if section_col is not None and section_col < len(row) else "").strip()
        description = str(row[desc_col] if desc_col is not None and desc_col < len(row) else "").strip()
        items.append({"sector": sector, "section": section, "description": description})
    return items


def parse_sector_base_excel_details(file_bytes: bytes, filename: str = "base.xlsx") -> dict:
    if not file_bytes:
        raise ValueError("Selecione uma planilha para importar.")
    if len(file_bytes) > MAX_SECTOR_BASE_UPLOAD_BYTES:
        raise ValueError("A planilha excede o limite de 10 MB.")
    lower_name = str(filename or "").lower()
    if not (lower_name.endswith(".xlsx") or lower_name.endswith(".xlsm")):
        raise ValueError("Use uma planilha Excel no formato XLSX ou XLSM.")

    archive = open_archive(file_bytes, "O arquivo enviado não é uma planilha Excel válida.")

    with archive:
        with corrupt_file_guard():
            validate_archive(archive, XLSX_LIMITS)
            required = {"xl/workbook.xml", "xl/_rels/workbook.xml.rels"}
            if not required.issubset(archive.namelist()):
                raise ValueError("Estrutura da planilha Excel inválida ou incompleta.")
            shared = shared_strings(archive, MAX_SHARED_STRINGS)
            sheets = workbook_sheets(archive)
        if not sheets:
            raise ValueError("A planilha não possui abas para importar.")

        preferred_names = {"base dados", "base de dados", "base setores", "base de setores"}
        named_base_sheets = [item for item in sheets if _norm(item[0]) in preferred_names]
        preferred = named_base_sheets or sheets
        all_items: list[dict[str, str]] = []
        seen: dict[tuple[str, str], dict[str, str]] = {}
        rows_read = 0
        duplicate_rows = 0
        conflicts = 0
        conflict_keys: list[str] = []
        matched_sheets: list[str] = []

        for sheet_name, sheet_path in preferred:
            # Lê a aba inteira. Não interrompe por repetição de SETOR e não usa
            # o número do SETOR como critério para encerrar/deduplicar a leitura.
            items = _parse_rows(_sheet_rows(archive, sheet_path, shared))
            if not items:
                continue
            matched_sheets.append(sheet_name)
            rows_read += len(items)
            all_items.extend(items)

            for item in items:
                key = (_norm(item["sector"]), _norm(item.get("section", "")))
                previous = seen.get(key)
                if previous is not None:
                    duplicate_rows += 1
                    if _norm(previous.get("description", "")) != _norm(item.get("description", "")):
                        conflicts += 1
                        label = f'{item["sector"]} / {item.get("section", "") or "sem seção"}'
                        if label not in conflict_keys and len(conflict_keys) < 20:
                            conflict_keys.append(label)
                seen[key] = item

        if all_items:
            return {
                # Entrega TODAS as linhas válidas ao importador. A consolidação
                # acontece depois pela chave correta SETOR + SEÇÃO.
                "items": all_items,
                "rows_read": rows_read,
                "unique_records": len(seen),
                "duplicate_rows": duplicate_rows,
                "conflicts": conflicts,
                "conflict_keys": conflict_keys,
                "matched_sheets": matched_sheets,
            }

    raise ValueError("Não encontrei uma aba com as colunas SETOR, SEÇÃO e DESCRIÇÃO SETOR.")


def parse_sector_base_excel(file_bytes: bytes, filename: str = "base.xlsx") -> list[dict[str, str]]:
    return parse_sector_base_excel_details(file_bytes, filename)["items"]
