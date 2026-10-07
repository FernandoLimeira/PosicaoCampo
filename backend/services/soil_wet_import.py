"""Importação dos apontamentos climáticos de solo úmido usados na análise de área."""
from __future__ import annotations

from datetime import datetime, time, timedelta
from hashlib import sha256
from pathlib import Path
import math
import re
from typing import Any

from .return_analysis import MAX_RETURN_UPLOAD_BYTES, _normalize_number, _norm, _parse_date, _read_rows

MAX_SOIL_WET_UPLOAD_BYTES = MAX_RETURN_UPLOAD_BYTES

HEADER_ALIASES = {
    "source_front": ("descricao do grupo de equipamento", "descrição do grupo de equipamento", "grupo de equipamento"),
    "equipment": ("codigo equipamento", "código equipamento", "equipamento", "frota", "colhedora"),
    "date": ("data hora local", "data", "dia"),
    "start_time": ("hora inicial", "inicio", "início", "hora inicio", "hora início"),
    "end_time": ("hora final", "fim", "hora fim"),
    "operation_code": ("codigo da operacao", "código da operação", "codigo operacao", "código operação"),
    "operation": ("descricao da operacao", "descrição da operação", "operacao", "operação"),
    "operation_group": ("descricao do grupo da operacao", "descrição do grupo da operação", "grupo da operacao", "grupo da operação"),
    "sector": ("codigo da zona", "código da zona", "zona", "setor", "codigo setor", "código setor"),
    "field": ("codigo do talhao", "código do talhão", "talhao", "talhão"),
    "farm": ("descricao da fazenda", "descrição da fazenda", "fazenda"),
}


def _header_mapping(headers: list[Any]) -> dict[str, int]:
    normalized = {_norm(header): index for index, header in enumerate(headers) if str(header or "").strip()}
    mapping: dict[str, int] = {}
    for key, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            normalized_alias = _norm(alias)
            if normalized_alias in normalized:
                mapping[key] = normalized[normalized_alias]
                break
    required = ("equipment", "date", "start_time", "end_time", "operation")
    missing = [key for key in required if key not in mapping]
    if missing:
        labels = {
            "equipment": "Código Equipamento",
            "date": "Data Hora Local",
            "start_time": "Hora Inicial",
            "end_time": "Hora Final",
            "operation": "Descrição da Operação",
        }
        raise ValueError("Colunas obrigatórias não encontradas: " + ", ".join(labels[key] for key in missing) + ".")
    return mapping


def _parse_time(value: Any) -> time | None:
    if isinstance(value, datetime):
        return value.time().replace(microsecond=0)
    if isinstance(value, time):
        return value.replace(microsecond=0)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if math.isfinite(number) and 0 <= number < 1:
            total_seconds = min(86399, max(0, int(round(number * 86400))))
            return time(total_seconds // 3600, (total_seconds % 3600) // 60, total_seconds % 60)
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%H:%M:%S", "%H:%M", "%H:%M:%S.%f"):
        try:
            return datetime.strptime(text, fmt).time().replace(microsecond=0)
        except ValueError:
            continue
    # O leitor interno devolve células numéricas sem estilo como texto.
    try:
        number = float(text.replace(",", "."))
    except ValueError:
        return None
    if math.isfinite(number) and 0 <= number < 1:
        return _parse_time(number)
    return None


def _detect_unit(source_front: str) -> str:
    normalized = _norm(source_front).upper()
    for code in ("PPT", "NRD", "RBR", "PST"):
        if re.search(rf"(?:^|\s){code}(?:\s|$)", normalized):
            return code
    return ""


def _duration_seconds(operation_date, start: time, end: time) -> int:
    begin = datetime.combine(operation_date, start)
    finish = datetime.combine(operation_date, end)
    if finish < begin:
        finish += timedelta(days=1)
    return max(0, int((finish - begin).total_seconds()))


def parse_soil_wet_file(file_bytes: bytes, filename: str) -> dict[str, Any]:
    if not file_bytes:
        raise ValueError("Selecione a planilha de apontamentos de solo úmido.")
    if len(file_bytes) > MAX_SOIL_WET_UPLOAD_BYTES:
        raise ValueError("A planilha de apontamentos excede o limite de 10 MB.")

    rows = _read_rows(file_bytes, filename)
    if not rows:
        raise ValueError("A planilha de apontamentos está vazia.")

    header_index = None
    mapping = None
    for index, row in enumerate(rows[:30]):
        try:
            candidate = _header_mapping(list(row))
        except ValueError:
            continue
        header_index = index
        mapping = candidate
        break
    if header_index is None or mapping is None:
        raise ValueError("Não foi possível localizar o cabeçalho da base de apontamentos de solo úmido.")

    parsed: list[dict[str, Any]] = []
    ignored_non_soil_wet = 0
    invalid_rows = 0
    detected_units: set[str] = set()
    seen_keys: set[str] = set()

    for raw in rows[header_index + 1:]:
        if not raw or not any(str(value or "").strip() for value in raw):
            continue

        def value(key: str):
            column = mapping.get(key)
            return raw[column] if column is not None and column < len(raw) else None

        operation = str(value("operation") or "").strip()
        if "solo umido" not in _norm(operation):
            ignored_non_soil_wet += 1
            continue

        raw_date = value("date")
        if isinstance(raw_date, str) and re.fullmatch(r"\d+(?:[.,]\d+)?", raw_date.strip()):
            raw_date = float(raw_date.strip().replace(",", "."))
        operation_date = _parse_date(raw_date)
        start_time = _parse_time(value("start_time"))
        end_time = _parse_time(value("end_time"))
        equipment = _normalize_number(value("equipment"))
        sector = _normalize_number(value("sector")) if "sector" in mapping else None
        field = _normalize_number(value("field"))
        if operation_date is None or start_time is None or end_time is None or equipment is None:
            invalid_rows += 1
            continue
        if equipment <= 0 or not float(equipment).is_integer():
            invalid_rows += 1
            continue
        if sector is not None and (sector <= 0 or not float(sector).is_integer()):
            invalid_rows += 1
            continue
        if field is not None and (field < 0 or not float(field).is_integer()):
            invalid_rows += 1
            continue
        duration_seconds = _duration_seconds(operation_date, start_time, end_time)
        if duration_seconds <= 0:
            invalid_rows += 1
            continue

        source_front = str(value("source_front") or "").strip()
        detected_unit = _detect_unit(source_front)
        if detected_unit:
            detected_units.add(detected_unit)

        operation_code = str(value("operation_code") or "").strip()
        operation_group = str(value("operation_group") or "").strip()
        farm = str(value("farm") or "").strip()
        field_value = int(field) if field is not None else None
        sector_value = int(sector) if sector is not None else None
        key_source = "|".join([
            str(int(equipment)),
            operation_date.isoformat(),
            start_time.strftime("%H:%M:%S"),
            _norm(operation_code or operation),
            "" if sector_value is None else str(sector_value),
            "" if field_value is None else str(field_value),
            _norm(farm) if sector_value is None else "",
        ])
        record_key = sha256(key_source.encode("utf-8")).hexdigest()
        if record_key in seen_keys:
            continue
        seen_keys.add(record_key)
        parsed.append({
            "record_key": record_key,
            "source_front": source_front,
            "equipment": int(equipment),
            "date": operation_date.isoformat(),
            "start_time": start_time.strftime("%H:%M:%S"),
            "end_time": end_time.strftime("%H:%M:%S"),
            "duration_seconds": duration_seconds,
            "operation_code": operation_code,
            "operation": operation,
            "operation_group": operation_group,
            "sector": sector_value,
            "field": field_value,
            "farm": farm,
        })

    if not parsed:
        if ignored_non_soil_wet:
            raise ValueError("Nenhum apontamento de SOLO ÚMIDO foi encontrado na planilha.")
        raise ValueError("Nenhum apontamento válido foi encontrado na planilha.")
    if len(detected_units) > 1:
        raise ValueError("A planilha contém apontamentos de mais de uma unidade: " + ", ".join(sorted(detected_units)) + ".")

    parsed.sort(key=lambda item: (item["date"], item["equipment"], item["start_time"], item["sector"] or -1))
    return {
        "records": parsed,
        "detected_unit": next(iter(detected_units), ""),
        "ignored_non_soil_wet": ignored_non_soil_wet,
        "invalid_rows": invalid_rows,
        "filename": Path(filename or "apontamentos.xlsx").name,
    }
