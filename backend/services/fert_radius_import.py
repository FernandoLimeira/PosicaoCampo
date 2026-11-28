"""Importação do raio setor × base de carregamento (aba RAIO da planilha de fertirrigação).

Colunas: SETOR, FAZENDA, MUNICIPIO, BASE CARREGAMENTO e RAIO (km). Um setor pode ter raio para
mais de uma base (ex.: Bié e Santa Cruz); cada par setor + base é guardado separado, e a frente
usa o raio da base escolhida no plano do dia (a planilha pegava sempre a primeira linha).
"""
from __future__ import annotations

from .front_identifiers import normalize_label
from .sector_base_import import MAX_SHARED_STRINGS, MAX_XLSX_COLUMNS, XLSX_LIMITS
from .xlsx_reader import (
    corrupt_file_guard,
    open_archive,
    plain_cell_value,
    read_sheet_rows,
    shared_strings,
    validate_archive,
    workbook_sheets,
)

MAX_RADIUS_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_RADIUS_ROWS = 60_000


def _header(rows):
    for index, row in enumerate(rows[:20]):
        labels = [normalize_label(value).lower() for value in row]
        found = {}
        for col, label in enumerate(labels):
            if label == "setor":
                found.setdefault("sector", col)
            elif label == "fazenda":
                found.setdefault("farm", col)
            elif label.startswith("municipio"):
                found.setdefault("municipality", col)
            elif label.startswith("base"):
                found.setdefault("base", col)
            elif label.startswith("raio"):
                found.setdefault("radius", col)
        if {"sector", "base", "radius"} <= set(found):
            return index, found
    return None, None


def _number(value) -> float | None:
    text = str(value or "").strip().replace(",", ".")
    try:
        number = float(text)
    except ValueError:
        return None
    return number if 0 <= number <= 1000 else None


def _code(value) -> str:
    text = str(value or "").strip()
    return text[:-2] if text.endswith(".0") and text[:-2].isdigit() else text


def parse_radius_rows(rows) -> list[dict]:
    header_index, cols = _header(rows)
    if header_index is None:
        return []
    records = {}
    for row in rows[header_index + 1:]:
        def cell(key):
            index = cols.get(key)
            return row[index] if index is not None and index < len(row) else ""
        sector, base, radius = _code(cell("sector")), str(cell("base") or "").strip(), _number(cell("radius"))
        if not sector or not base or radius is None:
            continue
        records[(sector.upper(), base.upper())] = {
            "sector": sector[:32], "base": base[:60], "radius_km": radius,
            "farm": str(cell("farm") or "").strip()[:120], "municipality": str(cell("municipality") or "").strip()[:80],
        }
    return list(records.values())


def parse_radius_file(file_bytes: bytes, filename: str = "raio.xlsx") -> dict:
    if not file_bytes:
        raise ValueError("Selecione o arquivo com o raio dos setores.")
    if len(file_bytes) > MAX_RADIUS_UPLOAD_BYTES:
        raise ValueError("O arquivo excede o limite de 15 MB. Exporte só a aba RAIO.")
    if not str(filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise ValueError("Envie o raio dos setores em Excel (XLSX ou XLSM).")
    archive = open_archive(file_bytes, "O arquivo enviado não é uma planilha Excel válida.")
    with archive:
        with corrupt_file_guard():
            try:
                validate_archive(archive, XLSX_LIMITS)
            except ValueError as exc:
                raise ValueError(f"{exc} Exporte só a aba RAIO para um arquivo novo.") from exc
            shared = shared_strings(archive, MAX_SHARED_STRINGS)
            sheets = workbook_sheets(archive)
        # A aba RAIO primeiro; depois as demais.
        sheets = sorted(sheets, key=lambda item: normalize_label(item[0]).upper() != "RAIO")
        for sheet_name, sheet_path in sheets:
            if sheet_path not in archive.namelist():
                continue
            with corrupt_file_guard():
                rows = [values for values, _ in read_sheet_rows(
                    archive, sheet_path, lambda cell: plain_cell_value(cell, shared),
                    max_rows=MAX_RADIUS_ROWS, max_columns=MAX_XLSX_COLUMNS, keep_empty_rows=False,
                )]
            records = parse_radius_rows(rows)
            if records:
                return {"records": records, "sheet": sheet_name}
    raise ValueError("Não encontrei uma aba com as colunas SETOR, BASE CARREGAMENTO e RAIO.")
