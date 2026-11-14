"""Leitura do arquivo de pesagem de cana (balança) do CTT.

Uma linha por carga (caminhão + julieta) que passou pela balança, com as colunas
(a ordem não importa, cabeçalhos comparados sem acento/maiúsculas/pontuação):
``INSTANCIA_ORIGEM | DT_MOVIMENTO | NO_LIBERACAO | CAMINHAO | JULIETA | CD_UPNIVEL1 |
CD_UPNIVEL2 | CD_FREN_TRAN | QT_LIQUIDO | ATR | HR_ENTRADA_PATIO | HR_ENTRADA_BALANCA |
HR_SAIDA_BALANCA``.

``INSTANCIA_ORIGEM`` é a indústria que recebeu a carga (201 PPT, 204 NRD, 402 RBR,
401 PST). No Polo SP o setor vem em ``CD_UPNIVEL2``; no Polo MS o setor vem em
``CD_UPNIVEL1`` e a seção em ``CD_UPNIVEL2``. Carga sem ``HR_SAIDA_BALANCA`` ainda
está no pátio (estoque). ``QT_LIQUIDO`` é o peso líquido em kg.
"""
from __future__ import annotations

from datetime import datetime

from .front_identifiers import normalize_label
from .operational_shifts import FIELD_TIMEZONE
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

MAX_WEIGHING_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_WEIGHING_ROWS = 150_000

# Indústria (instância do sistema de balança) -> unidade.
INSTANCE_UNITS = {"201": "PPT", "204": "NRD", "402": "RBR", "401": "PST"}
SECTION_UNITS = {"RBR", "PST"}

HEADER_ALIASES = {
    "instance": {"instancia origem", "instancia"},
    "movement_date": {"dt movimento", "data movimento"},
    "release": {"no liberacao", "liberacao", "n liberacao"},
    "truck": {"caminhao"},
    "trailer": {"julieta"},
    "level1": {"cd upnivel1", "upnivel1"},
    "level2": {"cd upnivel2", "upnivel2"},
    "front": {"cd fren tran", "frente", "cd frente"},
    "net_kg": {"qt liquido", "peso liquido"},
    "atr": {"atr"},
    "patio_at": {"hr entrada patio"},
    "scale_in_at": {"hr entrada balanca"},
    "scale_out_at": {"hr saida balanca"},
}
REQUIRED_FIELDS = ("instance", "release", "front", "net_kg", "scale_out_at")
FIELD_LABELS = {
    "instance": "INSTANCIA_ORIGEM", "release": "NO_LIBERACAO", "front": "CD_FREN_TRAN",
    "net_kg": "QT_LIQUIDO", "scale_out_at": "HR_SAIDA_BALANCA",
}


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
    return text[:-2] if text.endswith(".0") and text[:-2].isdigit() else text


def _number(value: str) -> float | None:
    text = str(value or "").strip()
    if not text:
        return None
    # "36100", "36.100,5" (Brasil) ou "36100.5" (serial do Excel).
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        number = float(text)
    except ValueError:
        return None
    return number if number == number and abs(number) < 1e12 else None


def _timestamp(value: str) -> int | None:
    """Data/hora do arquivo (texto dd/mm/aaaa hh:mm:ss ou serial do Excel) em epoch, horário de Brasília."""
    text = str(value or "").strip()
    if not text:
        return None
    moment = None
    for pattern in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            moment = datetime.strptime(text, pattern)
            break
        except ValueError:
            continue
    if moment is None:
        try:
            moment = excel_serial_to_datetime(float(text.replace(",", ".")))
        except ValueError:
            return None
    return int(moment.replace(tzinfo=FIELD_TIMEZONE).timestamp())


def _iso_date(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    for pattern in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[:10], pattern).date().isoformat()
        except ValueError:
            continue
    try:
        return excel_serial_to_datetime(float(text.replace(",", "."))).date().isoformat()
    except ValueError:
        return ""


def _parse_rows(rows):
    header_index, mapping = _find_header(rows)
    if header_index is None:
        return None
    records = []
    ignored_units = 0
    ignored_instances: dict[str, int] = {}
    invalid_rows = 0
    for row in rows[header_index + 1:]:
        values = {field: _cell(row, mapping.get(field)) for field in HEADER_ALIASES}
        if not any(values.values()):
            continue
        # "0204", "204.0" ou " 204 " valem como 204.
        instance = values["instance"].strip()
        if instance.replace(".", "", 1).isdigit():
            instance = str(int(float(instance)))
        unit = INSTANCE_UNITS.get(instance)
        if not unit:
            ignored_units += 1
            # Mostrado na importação: instância desconhecida não pode sumir sem aviso.
            code = values["instance"][:20] or "(vazia)"
            ignored_instances[code] = ignored_instances.get(code, 0) + 1
            continue
        release = values["release"][:40]
        front = values["front"][:20]
        if not release or not front:
            invalid_rows += 1
            continue
        out_at = _timestamp(values["scale_out_at"])
        net_kg = _number(values["net_kg"])
        if out_at is not None and (net_kg is None or net_kg < 0):
            invalid_rows += 1
            continue
        atr = _number(values["atr"])
        if unit in SECTION_UNITS:
            sector, section = values["level1"], values["level2"]
        else:
            sector, section = values["level2"], ""
        movement_date = _iso_date(values["movement_date"])
        if not movement_date and out_at is not None:
            movement_date = datetime.fromtimestamp(out_at, FIELD_TIMEZONE).date().isoformat()
        records.append({
            "unit_code": unit, "release_no": release, "movement_date": movement_date,
            "truck": values["truck"][:20], "trailer": values["trailer"][:20],
            "front": front, "sector": sector[:20], "section": section[:20],
            "net_kg": net_kg if out_at is not None else None,
            "atr": atr if atr is not None and 0 < atr < 1000 else None,
            "patio_at": _timestamp(values["patio_at"]), "scale_in_at": _timestamp(values["scale_in_at"]),
            "scale_out_at": out_at,
        })
    return {"records": records, "ignored_units": ignored_units, "invalid_rows": invalid_rows,
            "ignored_instances": dict(sorted(ignored_instances.items(), key=lambda item: -item[1])[:20])}


def parse_weighing_file(file_bytes: bytes, filename: str = "pesagem.xlsx") -> dict:
    if not file_bytes:
        raise ValueError("Selecione o arquivo de pesagem.")
    if len(file_bytes) > MAX_WEIGHING_UPLOAD_BYTES:
        raise ValueError("O arquivo excede o limite de 15 MB.")
    if not str(filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise ValueError("Envie a pesagem em Excel (XLSX ou XLSM).")

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
                    max_rows=MAX_WEIGHING_ROWS, max_columns=MAX_XLSX_COLUMNS, keep_empty_rows=False,
                )]
            parsed = _parse_rows(rows)
            if parsed is not None:
                if not parsed["records"]:
                    raise ValueError("Nenhuma carga das unidades PPT, NRD, RBR ou PST foi encontrada no arquivo.")
                return {**parsed, "sheet": sheet_name}

    needed = ", ".join(FIELD_LABELS[field] for field in REQUIRED_FIELDS)
    raise ValueError(f"Não encontrei uma aba com as colunas obrigatórias: {needed}.")
