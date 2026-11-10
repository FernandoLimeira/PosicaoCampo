"""Leitura do arquivo de Ordens de Serviço (O.S.) da Produção Agrícola.

Modelo do arquivo (uma linha por talhão):
``CHAVE | NO_OS | SETOR | SECAO | OPERACAO | TALHAO | CCUSTO | CCUSTO_TRATOS | DT_ABERTURA_OS``

``OPERACAO`` é o código da operação (ex.: 338) e ``CCUSTO_TRATOS`` a sua
descrição (ex.: TRATOS PLANTIO). As linhas da mesma O.S. (NO_OS + SETOR + SECAO
+ OPERACAO) viram uma única O.S. com a lista de talhões. Todas as colunas do
arquivo são mantidas linha a linha (``rows``) para o detalhe da O.S.; linhas
vazias são ignoradas.
"""
from __future__ import annotations

from datetime import datetime

from .front_identifiers import natural_key, normalize_label
from .sector_base_import import MAX_SHARED_STRINGS, MAX_XLSX_COLUMNS, XLSX_LIMITS
from .xlsx_reader import (
    corrupt_file_guard,
    excel_serial_to_datetime,
    open_archive,
    plain_cell_value,
    read_sheet_rows,
    shared_strings,
    validate_archive,
    workbook_sheets,
)

MAX_SERVICE_ORDER_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_SERVICE_ORDER_ROWS = 100_000
MAX_SERVICE_ORDERS = 25_000

# Campo -> cabeçalhos aceitos (comparados sem acento, maiúsculas e pontuação).
HEADER_ALIASES = {
    "key": {"chave"},
    "number": {"no os", "n os", "num os", "numero os", "os", "o s", "ordem de servico"},
    "sector": {"setor", "cod setor", "codigo setor"},
    "section": {"secao", "cod secao", "codigo secao"},
    "operation": {"operacao", "cod operacao", "codigo operacao"},
    "plot": {"talhao", "cod talhao"},
    "cost_center": {"ccusto", "centro custo", "centro de custo"},
    "operation_name": {"ccusto tratos", "descricao operacao", "descricao da operacao"},
    "opened_on": {"dt abertura os", "data abertura os", "data abertura", "dt abertura"},
}
REQUIRED_FIELDS = ("number", "sector", "operation")
FIELD_LABELS = {"number": "NO_OS", "sector": "SETOR", "operation": "OPERACAO"}


def _find_header(rows):
    for row_index, row in enumerate(rows[:30]):
        normalized = [normalize_label(value) for value in row]
        mapping = {}
        for key, aliases in HEADER_ALIASES.items():
            for col_index, value in enumerate(normalized):
                if value in aliases and col_index not in mapping.values():
                    mapping[key] = col_index
                    break
        if all(field in mapping for field in REQUIRED_FIELDS):
            return row_index, mapping
    return None, None


def _cell(row, index):
    if index is None or index >= len(row):
        return ""
    text = str(row[index] or "").strip()
    # Códigos numéricos podem chegar como "338.0".
    return text[:-2] if text.endswith(".0") and text[:-2].isdigit() else text


def _iso_date(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        serial = float(text.replace(",", "."))
    except ValueError:
        for pattern in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y"):
            try:
                return datetime.strptime(text[:10], pattern).date().isoformat()
            except ValueError:
                continue
        return text[:40]
    try:
        return excel_serial_to_datetime(serial).date().isoformat()
    except ValueError:
        return text[:40]


def _parse_rows(rows):
    header_index, mapping = _find_header(rows)
    if header_index is None:
        return [], 0
    header = [str(value or "").strip() for value in rows[header_index]]
    columns = [name for name in header if name]
    date_column = mapping.get("opened_on")
    orders: dict[tuple, dict] = {}
    rows_read = 0
    for row in rows[header_index + 1:]:
        values = {field: _cell(row, mapping.get(field)) for field in HEADER_ALIASES}
        if not values["number"] or not values["sector"] or not values["operation"]:
            continue
        rows_read += 1
        key = (values["number"], values["sector"], values["section"], values["operation"])
        order = orders.setdefault(key, {
            "key": values["key"], "number": values["number"], "sector": values["sector"], "section": values["section"],
            "operation": values["operation"], "operation_name": values["operation_name"],
            "cost_center": values["cost_center"], "opened_on": _iso_date(values["opened_on"]), "plots": [],
            "columns": columns, "rows": [],
        })
        # Linha completa do arquivo (todas as colunas), com a data já convertida.
        order["rows"].append({
            name: (_iso_date(_cell(row, index)) if index == date_column else _cell(row, index))
            for index, name in enumerate(header) if name
        })
        if values["plot"] and values["plot"] not in order["plots"]:
            order["plots"].append(values["plot"])
        for field in ("operation_name", "cost_center"):
            if not order[field] and values[field]:
                order[field] = values[field]
        if not order["opened_on"] and values["opened_on"]:
            order["opened_on"] = _iso_date(values["opened_on"])
    for order in orders.values():
        order["plots"].sort(key=natural_key)
    return list(orders.values()), rows_read


def parse_service_order_file(file_bytes: bytes, filename: str = "ordens.xlsx") -> dict:
    if not file_bytes:
        raise ValueError("Selecione o arquivo de ordens de serviço.")
    if len(file_bytes) > MAX_SERVICE_ORDER_UPLOAD_BYTES:
        raise ValueError("O arquivo excede o limite de 10 MB.")
    if not str(filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise ValueError("Envie as ordens de serviço em Excel (XLSX ou XLSM).")

    archive = open_archive(file_bytes, "O arquivo enviado não é uma planilha Excel válida.")
    with archive:
        with corrupt_file_guard():
            validate_archive(archive, XLSX_LIMITS)
            shared = shared_strings(archive, MAX_SHARED_STRINGS)
            sheets = workbook_sheets(archive)
        for sheet_name, sheet_path in sheets:
            if sheet_path not in archive.namelist():
                continue
            with corrupt_file_guard():
                rows = [values for values, _ in read_sheet_rows(
                    archive, sheet_path, lambda cell: plain_cell_value(cell, shared),
                    max_rows=MAX_SERVICE_ORDER_ROWS, max_columns=MAX_XLSX_COLUMNS, keep_empty_rows=False,
                )]
            records, rows_read = _parse_rows(rows)
            if records:
                if len(records) > MAX_SERVICE_ORDERS:
                    raise ValueError("O arquivo possui ordens de serviço demais para uma única importação.")
                return {"records": records, "sheet": sheet_name, "rows_read": rows_read}

    needed = ", ".join(FIELD_LABELS[field] for field in REQUIRED_FIELDS)
    raise ValueError(f"Não encontrei uma aba com as colunas obrigatórias: {needed}.")
