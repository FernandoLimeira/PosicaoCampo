"""Serviço de análise de retornos de setores por layout de colhedoras.

A regra operacional atribui períodos e dias à frente com maior quantidade
de colhedoras distintas cadastradas. A linha do tempo diária identifica
ausências e retornos sem esconder trocas de frente em setores contínuos.
Em empate, a atribuição fica MISTO/EMPATE. Equipamentos sem cadastro são
informados, mas não entram na disputa.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from io import BytesIO
from pathlib import Path
import math
import re
import unicodedata
from typing import Any

from .excel_reports import (
    MAX_EXCEL_UPLOAD_BYTES,
    MAX_REPORT_ROWS,
    MAX_XLSX_COLUMNS,
    _read_xlsx_rows,
)

MAX_RETURN_UPLOAD_BYTES = MAX_EXCEL_UPLOAD_BYTES

HEADER_ALIASES = {
    "date": ("dia", "data", "data operacao", "data operação"),
    "sector": ("setor", "codigo setor", "código setor"),
    "field": ("talhao", "talhão", "talhao colheita", "talhão colheita"),
    "equipment": (
        "colhedora",
        "colhedoras",
        "frota",
        "frotas",
        "codigo equipamento",
        "código equipamento",
        "codigo da colhedora",
        "código da colhedora",
    ),
    "loads": ("cargas", "carga", "quantidade cargas", "qtd cargas"),
    "tons": ("ton", "tons", "tonelada", "toneladas", "ton cana", "ton. cana"),
    "front": ("frente", "grupo", "grupo equipamento", "grupo de equipamento"),
}


def _norm(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.casefold().strip()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _normalize_number(value: Any, *, integer: bool = False) -> int | float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = str(value).strip().replace("\xa0", "").replace(" ", "")
        if not text:
            return None
        if "," in text and "." in text:
            if text.rfind(",") > text.rfind("."):
                text = text.replace(".", "").replace(",", ".")
            else:
                text = text.replace(",", "")
        elif "," in text:
            text = text.replace(",", ".")
        try:
            number = float(text)
        except ValueError:
            match = re.search(r"-?\d+(?:\.\d+)?", text)
            if not match:
                return None
            number = float(match.group(0))
    if not math.isfinite(number):
        return None
    return int(round(number)) if integer else number


def _parse_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if math.isfinite(number) and 1 <= number <= 100000:
            return (datetime(1899, 12, 30) + timedelta(days=number)).date()
    text = str(value or "").strip()
    if not text:
        return None
    # Formato comum da extração SGPA: 2026-04-01-00.00.00.000000
    prefix = re.match(r"^(\d{4}-\d{2}-\d{2})", text)
    if prefix:
        try:
            return datetime.strptime(prefix.group(1), "%Y-%m-%d").date()
        except ValueError:
            pass
    if " " in text:
        text = text.split(" ", 1)[0]
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _read_xls_rows(file_bytes: bytes):
    try:
        import xlrd  # type: ignore
    except ImportError as exc:
        raise ValueError(
            "Para importar .xls, instale as dependências do projeto com: pip install -r requirements.txt"
        ) from exc

    try:
        workbook = xlrd.open_workbook(file_contents=file_bytes, on_demand=True)
    except Exception as exc:
        raise ValueError("O arquivo enviado não é uma planilha XLS válida.") from exc
    try:
        if workbook.nsheets < 1:
            raise ValueError("A planilha não possui abas para processar.")
        sheet = workbook.sheet_by_index(0)
        if sheet.nrows > MAX_REPORT_ROWS:
            raise ValueError(f"A planilha excede o limite de {MAX_REPORT_ROWS} linhas.")
        if sheet.ncols > MAX_XLSX_COLUMNS:
            raise ValueError(f"A planilha excede o limite de {MAX_XLSX_COLUMNS} colunas.")
        rows = []
        for row_index in range(sheet.nrows):
            row = []
            for col_index in range(sheet.ncols):
                cell = sheet.cell(row_index, col_index)
                value = cell.value
                if cell.ctype == xlrd.XL_CELL_DATE:
                    try:
                        dt = xlrd.xldate_as_datetime(value, workbook.datemode)
                        # Preserva o tipo: datas e horas (inclusive meia-noite)
                        # são interpretadas pelo parser da coluna correspondente.
                        value = dt
                    except Exception:
                        pass
                elif cell.ctype == xlrd.XL_CELL_NUMBER and float(value).is_integer():
                    value = str(int(value))
                row.append(value)
            rows.append(row)
        return rows
    finally:
        workbook.release_resources()


def _read_rows(file_bytes: bytes, filename: str):
    suffix = Path(filename or "").suffix.casefold()
    if suffix in {".xlsx", ".xlsm"}:
        return _read_xlsx_rows(file_bytes)
    if suffix == ".xls":
        return _read_xls_rows(file_bytes)
    raise ValueError("Selecione uma planilha .xlsx, .xlsm ou .xls.")


def _header_mapping(headers: list[Any]) -> dict[str, int]:
    normalized = {_norm(header): index for index, header in enumerate(headers) if str(header or "").strip()}
    mapping: dict[str, int] = {}
    for key, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            alias_key = _norm(alias)
            if alias_key in normalized:
                mapping[key] = normalized[alias_key]
                break
    missing = [key for key in ("date", "sector", "equipment") if key not in mapping]
    if missing:
        friendly = {"date": "DIA", "sector": "SETOR", "equipment": "COLHEDORA/FROTA"}
        raise ValueError(
            "Colunas obrigatórias não encontradas: " + ", ".join(friendly[key] for key in missing) + "."
        )
    return mapping


def parse_operational_file(file_bytes: bytes, filename: str) -> list[dict[str, Any]]:
    rows = _read_rows(file_bytes, filename)
    if not rows:
        raise ValueError("A planilha está vazia.")

    header_index = None
    mapping = None
    # Procura o cabeçalho nas primeiras linhas para tolerar títulos acima da tabela.
    for index, row in enumerate(rows[:30]):
        try:
            candidate = _header_mapping(list(row))
        except ValueError:
            continue
        header_index = index
        mapping = candidate
        break
    if header_index is None or mapping is None:
        raise ValueError("Não foi possível localizar um cabeçalho com DIA, SETOR e COLHEDORA/FROTA.")

    parsed: list[dict[str, Any]] = []
    invalid_dates = 0
    for raw in rows[header_index + 1 :]:
        if not raw or not any(str(value or "").strip() for value in raw):
            continue

        def value(key: str):
            index = mapping.get(key)
            return raw[index] if index is not None and index < len(raw) else None

        operation_date = _parse_date(value("date"))
        sector = _normalize_number(value("sector"), integer=True)
        equipment = _normalize_number(value("equipment"), integer=True)
        if operation_date is None:
            invalid_dates += 1
            continue
        if sector is None or equipment is None:
            continue
        field = _normalize_number(value("field"), integer=True)
        loads = _normalize_number(value("loads")) or 0.0
        tons = _normalize_number(value("tons")) or 0.0
        parsed.append(
            {
                "date": operation_date,
                "sector": int(sector),
                "field": int(field) if field is not None else None,
                "equipment": int(equipment),
                "loads": loads,
                "tons": float(tons),
                "source_front": str(value("front") or "").strip(),
            }
        )
        if len(parsed) > MAX_REPORT_ROWS:
            raise ValueError(f"A planilha excede o limite de {MAX_REPORT_ROWS} registros válidos.")

    if not parsed:
        if invalid_dates:
            raise ValueError("Nenhum registro válido foi encontrado. Verifique o formato da coluna DIA.")
        raise ValueError("Nenhum registro válido foi encontrado na planilha.")
    parsed.sort(key=lambda row: (row["date"], row["sector"], row["equipment"]))
    return parsed


def _front_sort_key(code: str):
    text = str(code or "").strip()
    try:
        return (0, int(text))
    except ValueError:
        return (1, text.casefold())


def _front_label(front: dict[str, Any]) -> str:
    return str(front.get("name") or f"Frente {front.get('code', '')}").strip()


def _iso(day: date) -> str:
    return day.isoformat()


def _short_range(start: date, end: date) -> str:
    if start == end:
        return start.strftime("%d/%m")
    if start.year == end.year and start.month == end.month and (end - start).days == 1:
        return f"{start:%d} e {end:%d/%m}"
    return f"{start:%d/%m} a {end:%d/%m}"


def _join_pt(values: list[Any]) -> str:
    items = [str(value) for value in values]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " e " + items[-1]


def _sector_key(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        return str(int(float(text.replace(",", "."))))
    except (TypeError, ValueError):
        return _norm(text)


def _build_sector_reference_index(items: list[dict[str, Any]] | None) -> dict[str, list[dict[str, str]]]:
    index: dict[str, list[dict[str, str]]] = defaultdict(list)
    seen: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for item in items or []:
        key = _sector_key(item.get("sector"))
        if not key:
            continue
        section = str(item.get("section") or "").strip()
        farm = str(item.get("description") or "").strip()
        signature = (_norm(section), _norm(farm))
        if signature in seen[key]:
            continue
        seen[key].add(signature)
        index[key].append({"section": section, "farm": farm})
    return index


def _resolve_sector_reference(
    sector: Any,
    sector_reference_index: dict[str, list[dict[str, str]]],
) -> dict[str, Any]:
    candidates = list(sector_reference_index.get(_sector_key(sector), []))
    if not candidates:
        return {
            "status": "not_found",
            "section": "",
            "sections": [],
            "farm": "",
            "candidates": [],
        }

    sections = sorted(
        {item["section"] for item in candidates if item.get("section")},
        key=lambda value: (0, int(value)) if str(value).isdigit() else (1, str(value).casefold()),
    )
    farms = sorted({item["farm"] for item in candidates if item.get("farm")}, key=str.casefold)

    if len(candidates) == 1:
        return {
            "status": "matched",
            "section": candidates[0].get("section", ""),
            "sections": sections,
            "farm": candidates[0].get("farm", ""),
            "candidates": candidates,
        }

    # Em alguns polos um mesmo setor possui mais de uma seção, mas todas pertencem
    # à mesma fazenda. Nesse caso a fazenda é segura; a seção fica explicitamente
    # sem definição para não adivinhar um dado que a base de colheita não informa.
    if len(farms) == 1:
        return {
            "status": "multiple_sections",
            "section": "",
            "sections": sections,
            "farm": farms[0],
            "candidates": candidates,
        }

    return {
        "status": "ambiguous",
        "section": "",
        "sections": sections,
        "farm": "",
        "candidates": candidates,
    }


def _sector_reference_report_suffix(reference: dict[str, Any] | None) -> str:
    reference = reference or {}
    status = reference.get("status")
    farm = str(reference.get("farm") or "").strip()
    if status in {"matched", "multiple_sections"}:
        return f" (Fazenda {farm})" if farm else ""
    if status == "ambiguous":
        return " (cadastro de setor/fazenda com múltiplas referências — verificar)"
    if status == "not_found":
        return " (setor não encontrado na base de setores/fazendas — verificar)"
    return ""


def _assign_equipment_to_front(
    equipment: set[int] | list[int],
    equipment_owner: dict[int, dict[str, Any]],
    fronts_by_code: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    by_front: dict[str, list[int]] = defaultdict(list)
    unknown: list[int] = []
    for fleet in sorted(set(equipment)):
        owner = equipment_owner.get(fleet)
        if owner:
            by_front[owner["code"]].append(fleet)
        else:
            unknown.append(fleet)

    counts = [
        {
            "code": code,
            "front": fronts_by_code[code]["name"],
            "count": len(fleets),
            "equipment": fleets,
        }
        for code, fleets in by_front.items()
    ]
    counts.sort(key=lambda item: (-item["count"], _front_sort_key(item["code"])))

    assigned_code = ""
    assigned_front = "SEM FRENTE IDENTIFICADA"
    tie = False
    if counts:
        max_count = counts[0]["count"]
        winners = [item for item in counts if item["count"] == max_count]
        if len(winners) == 1:
            assigned_code = winners[0]["code"]
            assigned_front = winners[0]["front"]
        else:
            assigned_front = "MISTO / EMPATE"
            tie = True

    return {
        "assigned_front_code": assigned_code,
        "assigned_front": assigned_front,
        "tie": tie,
        "counts": counts,
        "equipment": sorted(set(equipment)),
        "unknown_equipment": unknown,
    }


def _aggregate_sector_coverage(
    day_assignments: dict[tuple[int, date], dict[str, Any]],
    sector: int,
    gap_start: date,
    gap_end: date,
    target_front_code: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Agrupa quem operou o mesmo setor durante a ausência da frente analisada.

    A leitura é diária para não esconder trocas de frente dentro de um período
    contínuo do setor. Só uma maioria diária exclusiva é atribuída a uma frente;
    empate permanece separado como MISTO/EMPATE.
    """
    relevant = []
    ties = []
    day = gap_start
    while day <= gap_end:
        assignment = day_assignments.get((sector, day))
        if assignment:
            if assignment["tie"]:
                ties.append({
                    "date": _iso(day),
                    "counts": assignment["counts"],
                    "equipment": assignment["equipment"],
                })
            elif assignment["assigned_front_code"] and assignment["assigned_front_code"] != target_front_code:
                relevant.append((day, assignment))
        day += timedelta(days=1)

    blocks: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for operation_date, assignment in relevant:
        code = assignment["assigned_front_code"]
        count_entry = next((item for item in assignment["counts"] if item["code"] == code), None)
        count = int(count_entry["count"]) if count_entry else 0
        fleets = set(count_entry["equipment"] if count_entry else [])

        if (
            current
            and current["code"] == code
            and operation_date == current["_end_date"] + timedelta(days=1)
        ):
            current["_end_date"] = operation_date
            current["end"] = _iso(operation_date)
            current["days"] += 1
            current["min_count"] = min(current["min_count"], count)
            current["max_count"] = max(current["max_count"], count)
            current["equipment_set"].update(fleets)
            continue

        if current:
            current["equipment"] = sorted(current.pop("equipment_set"))
            current.pop("_end_date", None)
            blocks.append(current)

        current = {
            "code": code,
            "front": assignment["assigned_front"],
            "start": _iso(operation_date),
            "end": _iso(operation_date),
            "days": 1,
            "min_count": count,
            "max_count": count,
            "equipment_set": set(fleets),
            "_end_date": operation_date,
        }

    if current:
        current["equipment"] = sorted(current.pop("equipment_set"))
        current.pop("_end_date", None)
        blocks.append(current)

    return blocks, ties


def _coverage_report_text(entries: list[dict[str, Any]]) -> str:
    parts = []
    for item in entries:
        start = date.fromisoformat(item["start"])
        end = date.fromisoformat(item["end"])
        period = _short_range(start, end)
        count_text = (
            f"{item['min_count']} colhedora" if item["min_count"] == item["max_count"] == 1
            else f"{item['min_count']} colhedoras" if item["min_count"] == item["max_count"]
            else f"entre {item['min_count']} e {item['max_count']} colhedoras"
        )
        parts.append(f"{item['front']} em {period} ({count_text})")
    return _join_pt(parts)


def _soil_wet_evidence(
    soil_wet_records: list[dict[str, Any]],
    sector: int,
    gap_start: date,
    gap_end: date,
    target_equipment: list[int],
) -> dict[str, Any]:
    """Confirma solo úmido pela maioria das colhedoras da frente em cada dia do intervalo.

    A confirmação é feita no nível da frente: se a maioria dos equipamentos cadastrados
    da frente possui apontamento de SOLO ÚMIDO em cada dia completo da interrupção, a
    parada é considerada comprovada, mesmo quando o apontamento foi lançado em um setor
    vizinho/diferente do setor onde a frente reaparece. O setor do apontamento é mantido
    como evidência para auditoria e o setor dominante é calculado pelo maior número de
    equipamentos distintos por dia, usando horas apontadas como desempate.
    """
    fleet = sorted({int(value) for value in target_equipment})
    fleet_set = set(fleet)
    majority_required = len(fleet) // 2 + 1 if fleet else 0

    daily_equipment: dict[date, set[int]] = defaultdict(set)
    daily_seconds: dict[date, int] = defaultdict(int)
    daily_sector_equipment: dict[date, dict[int, set[int]]] = defaultdict(lambda: defaultdict(set))
    daily_sector_seconds: dict[date, dict[int, int]] = defaultdict(lambda: defaultdict(int))

    for record in soil_wet_records or []:
        try:
            equipment = int(record.get("equipment"))
            record_sector = int(record.get("sector"))
        except (TypeError, ValueError):
            continue
        if equipment not in fleet_set:
            continue
        operation_date = _parse_date(record.get("date"))
        if operation_date is None or operation_date < gap_start or operation_date > gap_end:
            continue
        duration = int(record.get("duration_seconds") or 0)
        if duration <= 0:
            continue

        daily_equipment[operation_date].add(equipment)
        daily_seconds[operation_date] += duration
        daily_sector_equipment[operation_date][record_sector].add(equipment)
        daily_sector_seconds[operation_date][record_sector] += duration

    days_in_gap = max(0, (gap_end - gap_start).days + 1)
    daily: list[dict[str, Any]] = []
    days_with_majority = 0
    peak_count = 0
    union_equipment: set[int] = set()
    sector_equipment_days: dict[int, int] = defaultdict(int)
    sector_seconds: dict[int, int] = defaultdict(int)

    day = gap_start
    while day <= gap_end:
        equipments = sorted(daily_equipment.get(day, set()))
        count = len(equipments)
        peak_count = max(peak_count, count)
        union_equipment.update(equipments)
        has_majority = bool(majority_required and count >= majority_required)
        if has_majority:
            days_with_majority += 1

        sectors_for_day = []
        for record_sector, equipment_set in daily_sector_equipment.get(day, {}).items():
            equipment_count = len(equipment_set)
            seconds = int(daily_sector_seconds.get(day, {}).get(record_sector, 0))
            sector_equipment_days[record_sector] += equipment_count
            sector_seconds[record_sector] += seconds
            sectors_for_day.append({
                "sector": record_sector,
                "equipment_count": equipment_count,
                "equipment": sorted(equipment_set),
                "total_hours": round(seconds / 3600, 2),
            })
        sectors_for_day.sort(key=lambda item: (-item["equipment_count"], -item["total_hours"], item["sector"]))

        daily.append({
            "date": _iso(day),
            "equipment_count": count,
            "equipment": equipments,
            "majority": has_majority,
            "total_hours": round(daily_seconds.get(day, 0) / 3600, 2),
            "sectors": sectors_for_day,
        })
        day += timedelta(days=1)

    ranked_sectors = sorted(
        sector_equipment_days,
        key=lambda item: (-sector_equipment_days[item], -sector_seconds[item], item),
    )
    sector_evidence = [
        {
            "sector": item,
            "equipment_days": sector_equipment_days[item],
            "total_hours": round(sector_seconds[item] / 3600, 2),
            "matches_analyzed_sector": item == int(sector),
        }
        for item in ranked_sectors
    ]
    dominant_sector = ranked_sectors[0] if ranked_sectors else None

    confirmed = bool(days_in_gap and majority_required and days_with_majority == days_in_gap)
    return {
        "confirmed": confirmed,
        "fleet_size": len(fleet),
        "majority_required": majority_required,
        "peak_equipment_count": peak_count,
        "days_in_gap": days_in_gap,
        "days_with_majority": days_with_majority,
        "equipment": sorted(union_equipment),
        "analyzed_sector": int(sector),
        "dominant_sector": dominant_sector,
        "sector_evidence": sector_evidence,
        "daily": daily,
    }


def analyze_return_rows(
    rows: list[dict[str, Any]],
    layouts: list[dict[str, Any]],
    target_front_code: str,
    *,
    min_gap_days: int = 1,
    filename: str = "",
    unit_code: str = "",
    unit_name: str = "",
    soil_wet_records: list[dict[str, Any]] | None = None,
    sector_base: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    min_gap_days = max(1, min(int(min_gap_days or 1), 3650))
    normalized_target = str(target_front_code or "").strip()
    sector_reference_index = _build_sector_reference_index(sector_base)
    fronts = []
    for front in layouts:
        code = str(front.get("code") or "").strip()
        name = str(front.get("name") or f"Frente {code}").strip()
        equipments = sorted({int(value) for value in front.get("equipment", [])})
        fronts.append({"code": code, "name": name, "equipment": equipments})
    fronts.sort(key=lambda front: _front_sort_key(front["code"]))
    fronts_by_code = {front["code"]: front for front in fronts}
    target = next((front for front in fronts if front["code"] == normalized_target), None)
    if not target:
        raise ValueError("A frente selecionada não possui layout cadastrado nesta unidade.")
    if not target["equipment"]:
        raise ValueError("A frente selecionada não possui equipamentos cadastrados no layout.")

    equipment_owner: dict[int, dict[str, Any]] = {}
    duplicates: dict[int, set[str]] = defaultdict(set)
    for front in fronts:
        for equipment in front["equipment"]:
            previous = equipment_owner.get(equipment)
            if previous and previous["code"] != front["code"]:
                duplicates[equipment].update({previous["code"], front["code"]})
            equipment_owner[equipment] = front
    if duplicates:
        details = "; ".join(f"{equipment}: {', '.join(sorted(codes))}" for equipment, codes in sorted(duplicates.items()))
        raise ValueError("Há equipamentos cadastrados em mais de uma frente: " + details)

    day_sector: dict[tuple[int, date], dict[str, Any]] = {}
    for row in rows:
        key = (row["sector"], row["date"])
        aggregate = day_sector.setdefault(key, {"equipment": set(), "tons": 0.0, "loads": 0.0})
        aggregate["equipment"].add(row["equipment"])
        aggregate["tons"] += float(row.get("tons") or 0)
        aggregate["loads"] += float(row.get("loads") or 0)

    day_assignments: dict[tuple[int, date], dict[str, Any]] = {}
    for key, aggregate in day_sector.items():
        day_assignments[key] = _assign_equipment_to_front(
            aggregate["equipment"], equipment_owner, fronts_by_code
        )

    sector_dates: dict[int, list[date]] = defaultdict(list)
    for sector, operation_date in day_sector:
        sector_dates[sector].append(operation_date)

    periods: list[dict[str, Any]] = []
    for sector in sorted(sector_dates):
        dates = sorted(set(sector_dates[sector]))
        blocks: list[list[date]] = []
        current: list[date] = []
        for operation_date in dates:
            if not current or (operation_date - current[-1]).days == 1:
                current.append(operation_date)
            else:
                blocks.append(current)
                current = [operation_date]
        if current:
            blocks.append(current)

        for block in blocks:
            equipment: set[int] = set()
            tons = 0.0
            loads = 0.0
            for operation_date in block:
                aggregate = day_sector[(sector, operation_date)]
                equipment.update(aggregate["equipment"])
                tons += aggregate["tons"]
                loads += aggregate["loads"]

            assignment = _assign_equipment_to_front(equipment, equipment_owner, fronts_by_code)

            periods.append(
                {
                    "sector": sector,
                    "sector_reference": _resolve_sector_reference(sector, sector_reference_index),
                    "start": _iso(block[0]),
                    "end": _iso(block[-1]),
                    "days": len(block),
                    **assignment,
                    "tons": round(tons, 2),
                    "loads": int(loads) if float(loads).is_integer() else round(loads, 2),
                }
            )

    periods.sort(key=lambda item: (item["start"], item["sector"]))

    # A linha do tempo da frente analisada é construída pela atribuição diária.
    # Isso evita perder uma troca A -> outra frente -> A quando o setor continuou
    # sendo colhido todos os dias por equipes diferentes. Dias consecutivos em que
    # a frente analisada mantém a maioria formam um único bloco de continuidade.
    target_by_sector: dict[int, list[dict[str, Any]]] = defaultdict(list)
    target_activity_periods: list[dict[str, Any]] = []
    target_dates_by_sector: dict[int, list[date]] = defaultdict(list)
    for (sector, operation_date), assignment in day_assignments.items():
        if assignment["assigned_front_code"] == normalized_target:
            target_dates_by_sector[sector].append(operation_date)

    for sector, dates in target_dates_by_sector.items():
        ordered_dates = sorted(set(dates))
        blocks: list[list[date]] = []
        current: list[date] = []
        for operation_date in ordered_dates:
            if not current or (operation_date - current[-1]).days == 1:
                current.append(operation_date)
            else:
                blocks.append(current)
                current = [operation_date]
        if current:
            blocks.append(current)

        for block in blocks:
            first_assignment = day_assignments[(sector, block[0])]
            equipment: set[int] = set()
            for operation_date in block:
                equipment.update(day_assignments[(sector, operation_date)]["equipment"])
            period = {
                "sector": sector,
                "sector_reference": _resolve_sector_reference(sector, sector_reference_index),
                "start": _iso(block[0]),
                "end": _iso(block[-1]),
                "days": len(block),
                "assigned_front_code": normalized_target,
                "assigned_front": target["name"],
                "counts": first_assignment["counts"],
                "equipment": sorted(equipment),
            }
            target_by_sector[sector].append(period)
            target_activity_periods.append(period)

    target_activity_periods.sort(key=lambda item: (item["start"], item["sector"]))
    for items in target_by_sector.values():
        items.sort(key=lambda item: item["start"])

    returns: list[dict[str, Any]] = []
    possible_soil_wet: list[dict[str, Any]] = []
    confirmed_soil_wet: list[dict[str, Any]] = []
    for sector, items in target_by_sector.items():
        for index in range(1, len(items)):
            previous = items[index - 1]
            returned = items[index]
            previous_end = date.fromisoformat(previous["end"])
            return_start = date.fromisoformat(returned["start"])
            days_out = (return_start - previous_end).days - 1
            if days_out < min_gap_days:
                continue
            gap_start = previous_end + timedelta(days=1)
            gap_end = return_start - timedelta(days=1)
            sectors_between = sorted(
                {
                    period["sector"]
                    for period in target_activity_periods
                    if period["sector"] != sector
                    and date.fromisoformat(period["end"]) >= gap_start
                    and date.fromisoformat(period["start"]) <= gap_end
                }
            )
            other_fronts_in_sector, ties_in_sector = _aggregate_sector_coverage(
                day_assignments, sector, gap_start, gap_end, normalized_target
            )
            occurrence = {
                "front": target["name"],
                "sector": sector,
                "sector_reference": _resolve_sector_reference(sector, sector_reference_index),
                "entry_date": previous["start"],
                "exit_date": previous["end"],
                "return_date": returned["start"],
                "days_out": days_out,
                "sectors_during_absence": sectors_between,
                "other_fronts_in_sector": other_fronts_in_sector,
                "ties_in_sector": ties_in_sector,
                "return_counts": returned["counts"],
                "return_equipment": returned["equipment"],
            }
            # Só existe retorno real quando há evidência de que a frente trabalhou
            # em outro setor durante o intervalo. Sem qualquer atividade da frente
            # no intervalo, o caso fica pendente para verificação de possível parada
            # por solo úmido, em vez de ser contado automaticamente como retorno.
            if sectors_between:
                returns.append(occurrence)
            else:
                evidence = _soil_wet_evidence(
                    soil_wet_records or [], sector, gap_start, gap_end, target["equipment"]
                )
                occurrence["soil_wet_evidence"] = evidence
                if evidence["confirmed"]:
                    confirmed_soil_wet.append(occurrence)
                else:
                    possible_soil_wet.append(occurrence)
    returns.sort(key=lambda item: (item["return_date"], item["sector"]))
    possible_soil_wet.sort(key=lambda item: (item["return_date"], item["sector"]))
    confirmed_soil_wet.sort(key=lambda item: (item["return_date"], item["sector"]))

    other_front_periods = [
        item for item in periods
        if item["assigned_front_code"] and item["assigned_front_code"] != normalized_target
    ]
    tie_periods = [item for item in periods if item["tie"]]
    unknown_equipment = sorted({fleet for period in periods for fleet in period["unknown_equipment"]})

    report_lines: list[str] = []
    report_lines.append(f"1. Foram identificados {len(returns)} retornos reais de setor")
    if returns:
        report_lines.append(
            f"2. Os retornos ocorreram nos setores {_join_pt([item['sector'] for item in returns])}."
        )
    else:
        report_lines.append("2. Não foram identificados setores com retorno real.")
    line_number = 3

    for item in returns:
        sectors_between = item["sectors_during_absence"]
        location_text = (
            f"no setor {sectors_between[0]}"
            if len(sectors_between) == 1
            else f"nos setores {_join_pt(sectors_between)}"
        )
        coverage = item["other_fronts_in_sector"]
        if coverage:
            sector_activity = (
                f" Durante a ausência, o próprio setor {item['sector']} também foi trabalhado por "
                f"{_coverage_report_text(coverage)}."
            )
        else:
            sector_activity = (
                f" Não foi identificada outra frente trabalhando no setor {item['sector']} durante essa ausência."
            )
        sector_suffix = _sector_reference_report_suffix(item.get("sector_reference"))
        report_lines.append(
            f"{line_number}. No retorno ao setor {item['sector']}{sector_suffix}, a {target['name']} ficou "
            f"{item['days_out']} {'dia' if item['days_out'] == 1 else 'dias'} fora e, nesse intervalo, "
            f"trabalhou {location_text}.{sector_activity}"
        )
        line_number += 1

    # Somente as paradas CONFIRMADAS por solo úmido ficam fora do resumo automático.
    # Interrupções ainda não comprovadas e períodos de outras frentes permanecem
    # visíveis porque ajudam a explicar o que aconteceu no setor durante a ausência.
    for item in possible_soil_wet:
        coverage = item["other_fronts_in_sector"]
        if coverage:
            verification = (
                f" Durante a ausência, o setor {item['sector']} foi trabalhado por "
                f"{_coverage_report_text(coverage)}."
            )
        else:
            verification = (
                " Não foi identificada outra frente no setor nesse intervalo; verificar parada operacional "
                "ou ausência de apontamento."
            )
        evidence = item.get("soil_wet_evidence") or {}
        if soil_wet_records:
            soil_note = (
                f" Solo úmido não foi comprovado pela maioria dos equipamentos: máximo de "
                f"{evidence.get('peak_equipment_count', 0)} de {evidence.get('fleet_size', len(target['equipment']))} "
                f"equipamentos, com maioria em {evidence.get('days_with_majority', 0)} de "
                f"{evidence.get('days_in_gap', item['days_out'])} dias do intervalo."
            )
        else:
            soil_note = " Base de apontamentos de solo úmido não disponível para confirmação."
        sector_suffix = _sector_reference_report_suffix(item.get("sector_reference"))
        report_lines.append(
            f"{line_number}. No setor {item['sector']}{sector_suffix}, a {target['name']} ficou "
            f"{item['days_out']} {'dia' if item['days_out'] == 1 else 'dias'} sem registro de trabalho em outro setor "
            f"antes de reaparecer no mesmo setor. Interrupção sem deslocamento comprovado.{verification}{soil_note}"
        )
        line_number += 1

    for item in other_front_periods:
        counts = [f"{entry['front']} com {entry['count']}" for entry in item["counts"]]
        period_text = _short_range(date.fromisoformat(item["start"]), date.fromisoformat(item["end"]))
        sector_suffix = _sector_reference_report_suffix(item.get("sector_reference"))
        if len(counts) > 1:
            report_lines.append(
                f"{line_number}. No setor {item['sector']}{sector_suffix} em {period_text}, havia equipamentos de várias frentes: "
                f"{_join_pt(counts)}. Pela regra de maior quantidade, a operação foi atribuída à {item['assigned_front']}."
            )
        else:
            report_lines.append(
                f"{line_number}. O setor {item['sector']}{sector_suffix}, em {period_text}, não foi considerado da {target['name']}: "
                f"havia {counts[0] if counts else item['assigned_front']}, então o período foi atribuído à {item['assigned_front']}."
            )
        line_number += 1

    sector_reference_issues = []
    for sector in sorted(sector_dates):
        reference = _resolve_sector_reference(sector, sector_reference_index)
        if reference.get("status") != "matched":
            sector_reference_issues.append({"sector": sector, **reference})

    if sector_reference_issues:
        issue_labels = []
        for issue in sector_reference_issues:
            status = issue.get("status")
            if status == "multiple_sections":
                farm = str(issue.get("farm") or "").strip()
                issue_labels.append(f"{issue['sector']} ({'Fazenda ' + farm if farm else 'múltiplas referências'})")
            elif status == "ambiguous":
                issue_labels.append(f"{issue['sector']} (cadastro ambíguo)")
            else:
                issue_labels.append(f"{issue['sector']} (não cadastrado)")
        report_lines.append(
            f"{line_number}. Conferência da base de setores/fazendas: {_join_pt(issue_labels)}. "
            "Nenhuma referência ambígua foi escolhida automaticamente."
        )
        line_number += 1

    if tie_periods:
        report_lines.append(
            f"{line_number}. Foram encontrados {len(tie_periods)} {'período' if len(tie_periods) == 1 else 'períodos'} com empate na maior quantidade de equipamentos; "
            "esses períodos não foram atribuídos a uma única frente."
        )
        line_number += 1
    if unknown_equipment:
        report_lines.append(
            f"{line_number}. Equipamentos sem frente cadastrada: {', '.join(str(value) for value in unknown_equipment)}. "
            "Eles foram informados, mas não entraram na disputa entre as frentes."
        )

    start_date = min(row["date"] for row in rows)
    end_date = max(row["date"] for row in rows)
    return {
        "file": filename,
        "records": len(rows),
        "period": {"start": _iso(start_date), "end": _iso(end_date)},
        "unit": {"code": unit_code, "name": unit_name or unit_code},
        "target_front": {"code": target["code"], "name": target["name"]},
        "min_gap_days": min_gap_days,
        "returns_count": len(returns),
        "return_sectors_count": len({item["sector"] for item in returns}),
        "possible_soil_wet_count": len(possible_soil_wet),
        "possible_soil_wet_sectors_count": len({item["sector"] for item in possible_soil_wet}),
        "confirmed_soil_wet_count": len(confirmed_soil_wet),
        "confirmed_soil_wet_sectors_count": len({item["sector"] for item in confirmed_soil_wet}),
        "soil_wet_base_used": bool(soil_wet_records),
        "returns_with_other_front_in_sector_count": sum(1 for item in returns if item["other_fronts_in_sector"]),
        "interruptions_with_other_front_in_sector_count": sum(1 for item in possible_soil_wet if item["other_fronts_in_sector"]),
        "other_front_periods_count": len(other_front_periods),
        "ties_count": len(tie_periods),
        "unknown_equipment_count": len(unknown_equipment),
        "unknown_equipment": unknown_equipment,
        "sector_reference_issues_count": len(sector_reference_issues),
        "sector_reference_issues": sector_reference_issues,
        "returns": returns,
        "possible_soil_wet": possible_soil_wet,
        "confirmed_soil_wet": confirmed_soil_wet,
        "other_front_periods": other_front_periods,
        "tie_periods": tie_periods,
        "periods": periods,
        "report": "\n".join(report_lines),
    }


def analyze_return_file(
    file_bytes: bytes,
    filename: str,
    layouts: list[dict[str, Any]],
    target_front_code: str,
    *,
    min_gap_days: int = 1,
    unit_code: str = "",
    unit_name: str = "",
    soil_wet_records: list[dict[str, Any]] | None = None,
    sector_base: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if not file_bytes:
        raise ValueError("Selecione uma planilha para processar.")
    if len(file_bytes) > MAX_RETURN_UPLOAD_BYTES:
        raise ValueError("A planilha excede o limite de 10 MB.")
    rows = parse_operational_file(file_bytes, filename)
    return analyze_return_rows(
        rows,
        layouts,
        target_front_code,
        min_gap_days=min_gap_days,
        filename=filename,
        unit_code=unit_code,
        unit_name=unit_name,
        soil_wet_records=soil_wet_records,
        sector_base=sector_base,
    )
