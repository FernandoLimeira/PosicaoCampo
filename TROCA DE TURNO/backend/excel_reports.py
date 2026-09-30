"""Processamento de relatórios operacionais a partir de arquivos CSV/XLSX.

O módulo usa somente a biblioteca padrão do Python. A classificação de turnos
segue a regra operacional: A 00:00-07:20, B 07:20-15:40 e C 15:40-00:00.
"""
from __future__ import annotations

from collections import defaultdict
import csv
from datetime import date, datetime, time, timedelta
from io import BytesIO, StringIO
from pathlib import PurePosixPath
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET


MAX_EXCEL_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_XLSX_UNCOMPRESSED_BYTES = 96 * 1024 * 1024
MAX_XLSX_ENTRY_BYTES = 48 * 1024 * 1024
MAX_REPORT_ROWS = 100000
MAX_XLSX_COLUMNS = 256
MAX_SHARED_STRINGS = 300000


def _validate_xlsx_archive(archive: zipfile.ZipFile):
    total = 0
    for info in archive.infolist():
        if info.flag_bits & 0x1:
            raise ValueError("Planilhas Excel protegidas por senha não são suportadas.")
        if info.file_size > MAX_XLSX_ENTRY_BYTES:
            raise ValueError("A planilha possui um conteúdo interno grande demais para processar com segurança.")
        total += info.file_size
        if total > MAX_XLSX_UNCOMPRESSED_BYTES:
            raise ValueError("A planilha expandida excede o limite seguro de processamento.")

SHIFT_RANGES = (
    ("A", 0, 7 * 3600 + 20 * 60),
    ("B", 7 * 3600 + 20 * 60, 15 * 3600 + 40 * 60),
    ("C", 15 * 3600 + 40 * 60, 24 * 3600),
)
SHIFT_ORDER = {name: index for index, (name, _, _) in enumerate(SHIFT_RANGES)}

CATEGORY_KEYS = ("productive", "maintenance", "improductive", "climate", "auxiliary", "other")
CATEGORY_LABELS = {
    "productive": "Produtiva",
    "maintenance": "Manutenção",
    "improductive": "Improdutiva",
    "climate": "Climática",
    "auxiliary": "Auxiliar",
    "other": "Outros",
}

HEADER_ALIASES = {
    "unit": ("descricao da unidade", "unidade"),
    "front": ("descricao do grupo de equipamento", "grupo de equipamento", "frente"),
    "equipment_code": ("codigo equipamento", "codigo do equipamento"),
    "equipment_name": ("descricao do equipamento", "equipamento"),
    "operator_code": ("codigo de operador", "codigo do operador"),
    "operator_name": ("nome", "nome do operador", "operador"),
    "local_date": ("data hora local", "data local", "data"),
    "start_time": ("hora inicial", "inicio", "hora inicio"),
    "end_time": ("hora final", "fim", "hora fim"),
    "operation_code": ("codigo da operacao", "codigo operacao"),
    "operation_name": ("descricao da operacao", "operacao"),
    "operation_group": ("descricao do grupo da operacao", "grupo da operacao"),
    "farm": ("descricao da fazenda", "fazenda"),
    "hourmeter_start": ("horimetro/odometro inicial", "horimetro odometro inicial"),
    "hourmeter_end": ("horimetro/odometro final", "horimetro odometro final"),
    "speed": ("velocidade media",),
}

DATE_NUMFMT_IDS = set(range(14, 23)) | {27, 30, 36, 45, 46, 47, 50, 57}
XML_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
XML_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"m": XML_MAIN, "r": XML_REL}


def _norm(value) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.casefold().strip()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()



def _excel_serial_to_datetime(value: float) -> datetime:
    return datetime(1899, 12, 30) + timedelta(days=value)


def _looks_like_date_format(fmt: str) -> bool:
    if not fmt:
        return False
    cleaned = re.sub(r'"[^"]*"', "", fmt.casefold())
    cleaned = re.sub(r"\\.", "", cleaned)
    cleaned = re.sub(r"\[[^\]]+\]", "", cleaned)
    return bool(re.search(r"(^|[^a-z])[dmyhs]+([^a-z]|$)", cleaned))


def _xlsx_styles(archive: zipfile.ZipFile):
    if "xl/styles.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/styles.xml"))
    num_formats = {}
    num_fmts = root.find(f"{{{XML_MAIN}}}numFmts")
    if num_fmts is not None:
        for item in num_fmts:
            try:
                num_formats[int(item.attrib.get("numFmtId", "0"))] = item.attrib.get("formatCode", "")
            except ValueError:
                continue
    xfs = root.find(f"{{{XML_MAIN}}}cellXfs")
    styles = []
    if xfs is not None:
        for xf in xfs:
            try:
                num_fmt_id = int(xf.attrib.get("numFmtId", "0"))
            except ValueError:
                num_fmt_id = 0
            styles.append((num_fmt_id, num_formats.get(num_fmt_id, "")))
    return styles


def _shared_strings(archive: zipfile.ZipFile):
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    values = []
    for si in root.findall("m:si", NS):
        if len(values) >= MAX_SHARED_STRINGS:
            raise ValueError("A planilha possui textos compartilhados demais para processar com segurança.")
        pieces = [node.text or "" for node in si.findall(".//m:t", NS)]
        values.append("".join(pieces))
    return values


def _first_sheet_path(archive: zipfile.ZipFile):
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    sheets = workbook.find("m:sheets", NS)
    if sheets is None or not list(sheets):
        raise ValueError("A planilha não possui abas para processar.")
    first_sheet = list(sheets)[0]
    rel_id = first_sheet.attrib.get(f"{{{XML_REL}}}id")
    if not rel_id:
        return "xl/worksheets/sheet1.xml"

    rels_path = "xl/_rels/workbook.xml.rels"
    rels = ET.fromstring(archive.read(rels_path))
    target = None
    for rel in rels.findall(f"{{{PKG_REL}}}Relationship"):
        if rel.attrib.get("Id") == rel_id:
            target = rel.attrib.get("Target")
            break
    if not target:
        return "xl/worksheets/sheet1.xml"
    target_path = PurePosixPath("xl") / target
    normalized = str(target_path)
    while "/../" in normalized:
        parts = []
        for part in PurePosixPath(normalized).parts:
            if part == "..":
                if parts:
                    parts.pop()
            elif part != ".":
                parts.append(part)
        normalized = "/".join(parts)
    return normalized


def _column_index(cell_ref: str) -> int:
    letters = re.match(r"[A-Z]+", cell_ref or "A")
    value = 0
    for char in (letters.group(0) if letters else "A"):
        value = value * 26 + (ord(char) - 64)
    return value - 1


def _read_xlsx_rows(file_bytes: bytes):
    try:
        archive = zipfile.ZipFile(BytesIO(file_bytes))
    except zipfile.BadZipFile as exc:
        raise ValueError("O arquivo enviado não é uma planilha XLSX válida.") from exc

    with archive:
        _validate_xlsx_archive(archive)
        required = {"xl/workbook.xml"}
        if not required.issubset(archive.namelist()):
            raise ValueError("Estrutura XLSX inválida ou incompleta.")
        shared = _shared_strings(archive)
        styles = _xlsx_styles(archive)
        sheet_path = _first_sheet_path(archive)
        if sheet_path not in archive.namelist():
            raise ValueError("Não foi possível localizar a primeira aba da planilha.")
        root = ET.fromstring(archive.read(sheet_path))
        rows = []
        for row_node in root.findall(".//m:sheetData/m:row", NS):
            if len(rows) >= MAX_REPORT_ROWS:
                raise ValueError(f"A planilha excede o limite de {MAX_REPORT_ROWS} linhas.")
            cells = {}
            max_col = -1
            for cell in row_node.findall("m:c", NS):
                ref = cell.attrib.get("r", "A1")
                col = _column_index(ref)
                if col >= MAX_XLSX_COLUMNS:
                    raise ValueError(f"A planilha excede o limite de {MAX_XLSX_COLUMNS} colunas.")
                max_col = max(max_col, col)
                cell_type = cell.attrib.get("t", "n")
                style_index = int(cell.attrib.get("s", "0") or 0)
                value_node = cell.find("m:v", NS)
                inline = cell.find("m:is", NS)
                raw = value_node.text if value_node is not None else None

                if cell_type == "s" and raw is not None:
                    try:
                        value = shared[int(raw)]
                    except (ValueError, IndexError):
                        value = raw
                elif cell_type == "inlineStr" and inline is not None:
                    value = "".join(node.text or "" for node in inline.findall(".//m:t", NS))
                elif cell_type == "b":
                    value = raw == "1"
                elif cell_type in {"str", "e"}:
                    value = raw or ""
                elif raw is None:
                    value = ""
                else:
                    try:
                        numeric = float(raw)
                    except ValueError:
                        value = raw
                    else:
                        num_fmt_id, fmt = styles[style_index] if style_index < len(styles) else (0, "")
                        if num_fmt_id in DATE_NUMFMT_IDS or _looks_like_date_format(fmt):
                            dt = _excel_serial_to_datetime(numeric)
                            if numeric < 1:
                                value = dt.strftime("%H:%M:%S")
                            elif abs(numeric - int(numeric)) < 1e-9:
                                value = dt.strftime("%d/%m/%Y")
                            else:
                                value = dt.strftime("%d/%m/%Y %H:%M:%S")
                        elif numeric.is_integer():
                            value = str(int(numeric))
                        else:
                            value = str(numeric)
                cells[col] = value
            if max_col >= 0:
                rows.append([cells.get(index, "") for index in range(max_col + 1)])
    return rows



def _read_csv_rows(file_bytes: bytes):
    decoded = None
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            decoded = file_bytes.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if decoded is None:
        raise ValueError("Não foi possível identificar a codificação do arquivo CSV.")

    sample = decoded[:16384]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ";" if sample.count(";") >= sample.count(",") else ","

    reader = csv.reader(StringIO(decoded), delimiter=delimiter)
    rows = []
    for row in reader:
        if len(rows) >= MAX_REPORT_ROWS:
            raise ValueError(f"O arquivo excede o limite de {MAX_REPORT_ROWS} linhas.")
        if len(row) > MAX_XLSX_COLUMNS:
            raise ValueError(f"O arquivo excede o limite de {MAX_XLSX_COLUMNS} colunas.")
        rows.append([str(value or "").strip() for value in row])
    return rows

def _header_map(headers):
    normalized = {_norm(header): index for index, header in enumerate(headers) if str(header or "").strip()}
    mapping = {}
    for key, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            if alias in normalized:
                mapping[key] = normalized[alias]
                break
    missing = [key for key in ("operator_name", "local_date", "start_time", "end_time", "operation_name", "operation_group") if key not in mapping]
    if missing:
        friendly = {
            "operator_name": "Nome",
            "local_date": "Data Hora Local",
            "start_time": "Hora Inicial",
            "end_time": "Hora Final",
            "operation_name": "Descrição da Operação",
            "operation_group": "Descrição do Grupo da Operação",
        }
        raise ValueError("Colunas obrigatórias não encontradas: " + ", ".join(friendly[item] for item in missing) + ".")
    return mapping


def _parse_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    if not text:
        raise ValueError("Data vazia.")
    if " " in text:
        text = text.split(" ", 1)[0]
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    try:
        numeric = float(text.replace(",", "."))
        return _excel_serial_to_datetime(numeric).date()
    except ValueError as exc:
        raise ValueError(f"Data inválida: {text}") from exc


def _parse_time(value):
    if isinstance(value, datetime):
        return value.time().replace(microsecond=0)
    if isinstance(value, time):
        return value.replace(microsecond=0)
    if isinstance(value, (int, float)):
        seconds = round((float(value) % 1) * 86400) % 86400
        return time(seconds // 3600, (seconds % 3600) // 60, seconds % 60)
    text = str(value or "").strip()
    if not text:
        raise ValueError("Horário vazio.")
    if " " in text:
        text = text.rsplit(" ", 1)[-1]
    for fmt in ("%H:%M:%S", "%H:%M", "%H:%M:%S.%f"):
        try:
            return datetime.strptime(text, fmt).time().replace(microsecond=0)
        except ValueError:
            pass
    try:
        numeric = float(text.replace(",", "."))
        seconds = round((numeric % 1) * 86400) % 86400
        return time(seconds // 3600, (seconds % 3600) // 60, seconds % 60)
    except ValueError as exc:
        raise ValueError(f"Horário inválido: {text}") from exc


def _category(group, operation):
    group_norm = _norm(group)
    operation_norm = _norm(operation)
    combined = f"{group_norm} {operation_norm}"

    if any(token in combined for token in ("manutenc", "corretiv", "preventiv", "oficina", "reparo")):
        return "maintenance"
    if "improdut" in group_norm:
        return "improductive"
    if any(token in group_norm for token in ("produtiv", "producao")):
        return "productive"
    if any(token in group_norm for token in ("climatic", "clima")):
        return "climate"
    if any(token in group_norm for token in ("auxiliar", "apoio")):
        return "auxiliary"
    return "other"


def _row_value(row, mapping, key, default=""):
    index = mapping.get(key)
    if index is None or index >= len(row):
        return default
    return row[index]


def _shift_for_second(second_of_day: int):
    for name, start, end in SHIFT_RANGES:
        if start <= second_of_day < end:
            return name
    return "C"


def _split_by_shift(start: datetime, end: datetime):
    cursor = start
    while cursor < end:
        seconds = cursor.hour * 3600 + cursor.minute * 60 + cursor.second
        shift = _shift_for_second(seconds)
        _, _, shift_end_sec = next(item for item in SHIFT_RANGES if item[0] == shift)
        day_start = datetime.combine(cursor.date(), time.min)
        boundary = day_start + timedelta(seconds=shift_end_sec)
        if shift_end_sec == 86400:
            boundary = day_start + timedelta(days=1)
        segment_end = min(end, boundary)
        duration = max(0.0, (segment_end - cursor).total_seconds())
        if duration:
            yield shift, cursor, segment_end, duration
        cursor = segment_end


def _empty_totals():
    totals = {key: 0.0 for key in CATEGORY_KEYS}
    totals["total"] = 0.0
    return totals


def _add_duration(target, category, seconds):
    target["total"] += seconds
    target[category] += seconds


def _percent(part, total):
    return round((part / total * 100) if total else 0.0, 1)


def _duration_payload(totals):
    payload = {key: int(round(totals.get(key, 0))) for key in ("total",) + CATEGORY_KEYS}
    payload["utilization_pct"] = _percent(payload["productive"], payload["total"])
    controllable_base = max(0, payload["total"] - payload["climate"])
    payload["utilization_without_climate_pct"] = _percent(payload["productive"], controllable_base)
    payload["recoverable_loss"] = payload["maintenance"] + payload["improductive"]
    return payload


def _top_operation(operations):
    if not operations:
        return {"name": "-", "seconds": 0}
    name, seconds = max(operations.items(), key=lambda item: item[1])
    return {"name": name, "seconds": int(round(seconds))}



def _iso_week_key(day: date) -> str:
    iso = day.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _fleet_payload(seconds_by_equipment, equipment_names):
    items = []
    for code, seconds in sorted(seconds_by_equipment.items(), key=lambda item: (-item[1], item[0])):
        name = equipment_names.get(code, "")
        items.append({
            "code": code,
            "name": name,
            "label": f"{code} · {name}" if code and name else (code or name or "SEM FROTA"),
            "seconds": int(round(seconds)),
        })
    return items


def _front_operator_payload(operator):
    predominant_shift = max(
        operator["shift_seconds"],
        key=lambda shift: (operator["shift_seconds"][shift], -SHIFT_ORDER[shift]),
    )
    weekly = []
    qualifying_weeks = 0
    for week_key in sorted(operator["week_days"]):
        days = sorted(operator["week_days"][week_key])
        is_team_member = len(days) >= 2
        if is_team_member:
            qualifying_weeks += 1
        weekly.append({
            "week": week_key,
            "days": days,
            "days_count": len(days),
            "team_member": is_team_member,
        })
    team_member = qualifying_weeks > 0
    fleet = _fleet_payload(operator["equipment_seconds"], operator["equipment_names"])
    return {
        "code": operator["code"],
        "name": operator["name"],
        "predominant_shift": predominant_shift,
        "equipments": [item["code"] for item in fleet if item["code"]],
        "fleet": fleet,
        "primary_equipment": fleet[0] if fleet else None,
        "events": operator["events"],
        "days_worked": len(operator["days"]),
        "weeks": weekly,
        "qualifying_weeks": qualifying_weeks,
        "team_member": team_member,
        "team_status": "Equipe" if team_member else "Apoio eventual",
        "main_operation": _top_operation(operator["operations"]),
        "is_generic": "generico" in _norm(operator["name"]) or operator["code"] == "99999",
        **_duration_payload(operator["totals"]),
    }


def analyze_excel_report(file_bytes: bytes, filename: str = "dados.csv"):
    if not file_bytes:
        raise ValueError("Selecione um arquivo CSV ou Excel para processar.")
    if len(file_bytes) > MAX_EXCEL_UPLOAD_BYTES:
        raise ValueError("O arquivo excede o limite de 10 MB.")

    normalized_filename = str(filename or "").strip().casefold()
    if normalized_filename.endswith(".csv"):
        rows = _read_csv_rows(file_bytes)
    elif normalized_filename.endswith((".xlsx", ".xlsm")):
        rows = _read_xlsx_rows(file_bytes)
    else:
        raise ValueError("Envie um arquivo CSV, .xlsx ou .xlsm. O formato .xls antigo não é suportado.")
    rows = [row for row in rows if any(str(value or "").strip() for value in row)]
    if len(rows) < 2:
        raise ValueError("A planilha não possui registros para analisar.")

    headers = rows[0]
    mapping = _header_map(headers)

    overall = _empty_totals()
    shifts = {name: _empty_totals() for name, _, _ in SHIFT_RANGES}
    shift_operators = {name: set() for name, _, _ in SHIFT_RANGES}
    operators = {}
    front_data = {}
    performance_data = {}
    timeline = []
    operation_totals = defaultdict(float)
    operation_categories = {}
    units = set()
    fronts = set()
    equipments = set()
    equipment_catalog = {}
    dates = set()
    invalid_rows = 0
    valid_records = 0
    unclassified = set()

    for row_index, row in enumerate(rows[1:], start=2):
        operator_name = str(_row_value(row, mapping, "operator_name", "")).strip()
        if not operator_name:
            invalid_rows += 1
            continue
        try:
            work_date = _parse_date(_row_value(row, mapping, "local_date"))
            start_time = _parse_time(_row_value(row, mapping, "start_time"))
            end_time = _parse_time(_row_value(row, mapping, "end_time"))
        except ValueError:
            invalid_rows += 1
            continue

        start = datetime.combine(work_date, start_time)
        end = datetime.combine(work_date, end_time)
        if end < start:
            end += timedelta(days=1)
        if end == start:
            invalid_rows += 1
            continue

        operation_name = str(_row_value(row, mapping, "operation_name", "Sem descrição")).strip() or "Sem descrição"
        operation_group = str(_row_value(row, mapping, "operation_group", "")).strip()
        category = _category(operation_group, operation_name)
        if category == "other":
            unclassified.add(operation_name)

        operator_code = str(_row_value(row, mapping, "operator_code", "")).strip()
        equipment_code = str(_row_value(row, mapping, "equipment_code", "")).strip()
        equipment_name = str(_row_value(row, mapping, "equipment_name", "")).strip()
        equipment_key = equipment_code or equipment_name or "SEM FROTA"
        unit = str(_row_value(row, mapping, "unit", "")).strip()
        front = str(_row_value(row, mapping, "front", "")).strip() or "SEM FRENTE"
        farm = str(_row_value(row, mapping, "farm", "")).strip()
        speed = str(_row_value(row, mapping, "speed", "")).strip()
        hourmeter_start = str(_row_value(row, mapping, "hourmeter_start", "")).strip()
        hourmeter_end = str(_row_value(row, mapping, "hourmeter_end", "")).strip()

        if unit:
            units.add(unit)
        fronts.add(front)
        if equipment_key != "SEM FROTA":
            equipments.add(equipment_key)
            equipment_catalog[equipment_key] = {
                "code": equipment_code,
                "name": equipment_name,
                "label": f"{equipment_code} · {equipment_name}" if equipment_code and equipment_name else equipment_key,
            }
        dates.add(work_date.isoformat())

        operator_key = f"{operator_code}|{operator_name}" if operator_code else operator_name
        if operator_key not in operators:
            operators[operator_key] = {
                "code": operator_code,
                "name": operator_name,
                "totals": _empty_totals(),
                "shift_seconds": {name: 0.0 for name, _, _ in SHIFT_RANGES},
                "shift_totals": {name: _empty_totals() for name, _, _ in SHIFT_RANGES},
                "equipment_seconds": defaultdict(float),
                "equipment_names": {},
                "shift_equipment_seconds": {name: defaultdict(float) for name, _, _ in SHIFT_RANGES},
                "operations": defaultdict(float),
                "events": 0,
            }
        operator = operators[operator_key]
        operator["events"] += 1
        operator["equipment_names"][equipment_key] = equipment_name

        if front not in front_data:
            front_data[front] = {
                "name": front,
                "totals": _empty_totals(),
                "shifts": {name: _empty_totals() for name, _, _ in SHIFT_RANGES},
                "shift_operators": {name: set() for name, _, _ in SHIFT_RANGES},
                "operators": {},
                "equipments": set(),
                "units": set(),
                "records": 0,
            }
        front_item = front_data[front]
        front_item["records"] += 1
        if unit:
            front_item["units"].add(unit)
        if equipment_key != "SEM FROTA":
            front_item["equipments"].add(equipment_key)
        if operator_key not in front_item["operators"]:
            front_item["operators"][operator_key] = {
                "key": operator_key,
                "code": operator_code,
                "name": operator_name,
                "totals": _empty_totals(),
                "shift_seconds": {name: 0.0 for name, _, _ in SHIFT_RANGES},
                "shift_totals": {name: _empty_totals() for name, _, _ in SHIFT_RANGES},
                "equipment_seconds": defaultdict(float),
                "equipment_names": {},
                "shift_equipment_seconds": {name: defaultdict(float) for name, _, _ in SHIFT_RANGES},
                "operations": defaultdict(float),
                "events": 0,
                "days": set(),
                "week_days": defaultdict(set),
            }
        front_operator = front_item["operators"][operator_key]
        front_operator["events"] += 1
        front_operator["equipment_names"][equipment_key] = equipment_name

        valid_records += 1
        for shift, segment_start, segment_end, duration in _split_by_shift(start, end):
            segment_day = segment_start.date()
            segment_date_iso = segment_day.isoformat()
            week_key = _iso_week_key(segment_day)
            dates.add(segment_date_iso)

            _add_duration(overall, category, duration)
            _add_duration(shifts[shift], category, duration)
            _add_duration(operator["totals"], category, duration)
            _add_duration(operator["shift_totals"][shift], category, duration)
            operator["shift_seconds"][shift] += duration
            operator["equipment_seconds"][equipment_key] += duration
            operator["shift_equipment_seconds"][shift][equipment_key] += duration
            operator["operations"][operation_name] += duration
            operation_totals[operation_name] += duration
            operation_categories[operation_name] = category
            shift_operators[shift].add(operator_key)

            _add_duration(front_item["totals"], category, duration)
            _add_duration(front_item["shifts"][shift], category, duration)
            front_item["shift_operators"][shift].add(operator_key)
            _add_duration(front_operator["totals"], category, duration)
            _add_duration(front_operator["shift_totals"][shift], category, duration)
            front_operator["shift_seconds"][shift] += duration
            front_operator["equipment_seconds"][equipment_key] += duration
            front_operator["shift_equipment_seconds"][shift][equipment_key] += duration
            front_operator["operations"][operation_name] += duration
            front_operator["days"].add(segment_date_iso)
            front_operator["week_days"][week_key].add(segment_date_iso)

            performance_key = (front, operator_key, shift, equipment_key, segment_date_iso)
            if performance_key not in performance_data:
                performance_data[performance_key] = {
                    "front": front,
                    "operator_key": operator_key,
                    "code": operator_code,
                    "name": operator_name,
                    "shift": shift,
                    "equipment_code": equipment_code,
                    "equipment_name": equipment_name,
                    "equipment_key": equipment_key,
                    "date": segment_date_iso,
                    "week": week_key,
                    "unit": unit,
                    "totals": _empty_totals(),
                    "operations": defaultdict(float),
                    "farms": set(),
                    "segments": 0,
                }
            performance_item = performance_data[performance_key]
            _add_duration(performance_item["totals"], category, duration)
            performance_item["operations"][operation_name] += duration
            if farm:
                performance_item["farms"].add(farm)
            performance_item["segments"] += 1

            timeline.append({
                "row": row_index,
                "front": front,
                "unit": unit,
                "operator_key": operator_key,
                "operator_code": operator_code,
                "operator_name": operator_name,
                "shift": shift,
                "date": segment_date_iso,
                "week": week_key,
                "start": segment_start.isoformat(timespec="seconds"),
                "end": segment_end.isoformat(timespec="seconds"),
                "seconds": int(round(duration)),
                "equipment_code": equipment_code,
                "equipment_name": equipment_name,
                "equipment_key": equipment_key,
                "operation": operation_name,
                "operation_group": operation_group,
                "category": category,
                "category_label": CATEGORY_LABELS[category],
                "farm": farm,
                "speed": speed,
                "hourmeter_start": hourmeter_start,
                "hourmeter_end": hourmeter_end,
            })

    if valid_records == 0:
        raise ValueError("Nenhum registro válido foi encontrado na planilha.")

    operator_rows = []
    operator_shift_rows = []
    for operator in operators.values():
        predominant_shift = max(
            operator["shift_seconds"],
            key=lambda shift: (operator["shift_seconds"][shift], -SHIFT_ORDER[shift]),
        )
        fleet = _fleet_payload(operator["equipment_seconds"], operator["equipment_names"])
        total_payload = _duration_payload(operator["totals"])
        operator_rows.append({
            "code": operator["code"],
            "name": operator["name"],
            "predominant_shift": predominant_shift,
            "equipments": [item["code"] for item in fleet if item["code"]],
            "fleet": fleet,
            "primary_equipment": fleet[0] if fleet else None,
            "events": operator["events"],
            "main_operation": _top_operation(operator["operations"]),
            "is_generic": "generico" in _norm(operator["name"]) or operator["code"] == "99999",
            **total_payload,
        })
        for shift, _, _ in SHIFT_RANGES:
            if operator["shift_totals"][shift]["total"] <= 0:
                continue
            shift_fleet = _fleet_payload(operator["shift_equipment_seconds"][shift], operator["equipment_names"])
            operator_shift_rows.append({
                "code": operator["code"],
                "name": operator["name"],
                "shift": shift,
                "predominant_shift": predominant_shift,
                "equipments": [item["code"] for item in shift_fleet if item["code"]],
                "fleet": shift_fleet,
                "primary_equipment": shift_fleet[0] if shift_fleet else None,
                **_duration_payload(operator["shift_totals"][shift]),
            })

    operator_rows.sort(key=lambda item: (-item["productive"], -item["utilization_pct"], item["name"]))
    operator_shift_rows.sort(key=lambda item: (SHIFT_ORDER[item["shift"]], item["name"]))

    shift_rows = []
    for shift, _, _ in SHIFT_RANGES:
        shift_rows.append({
            "shift": shift,
            "operators": len(shift_operators[shift]),
            **_duration_payload(shifts[shift]),
        })

    front_rows = []
    front_operator_rows = []
    front_shift_rows = []
    team_week_lookup = {}
    for front_name, front_item in sorted(front_data.items(), key=lambda item: item[0]):
        operator_payloads = []
        for operator_key, operator_item in front_item["operators"].items():
            payload = _front_operator_payload(operator_item)
            payload["operator_key"] = operator_key
            operator_payloads.append(payload)
            for week in payload["weeks"]:
                team_week_lookup[(front_name, operator_key, week["week"])] = bool(week["team_member"])
        operator_payloads.sort(key=lambda item: (not item["team_member"], -item["productive"], -item["utilization_pct"], item["name"]))
        team_members = [item for item in operator_payloads if item["team_member"] and not item["is_generic"]]
        occasional = [item for item in operator_payloads if not item["team_member"] and not item["is_generic"]]

        front_summary = {
            "front": front_name,
            "records": front_item["records"],
            "units": sorted(front_item["units"]),
            "equipments": sorted(front_item["equipments"]),
            "operators_count": len(operator_payloads),
            "team_members_count": len(team_members),
            "occasional_operators_count": len(occasional),
            **_duration_payload(front_item["totals"]),
        }
        front_rows.append(front_summary)

        for operator_payload in operator_payloads:
            front_operator_rows.append({
                "front": front_name,
                **operator_payload,
            })

        for shift, _, _ in SHIFT_RANGES:
            shift_payload = _duration_payload(front_item["shifts"][shift])
            if shift_payload["total"] <= 0:
                continue
            front_shift_rows.append({
                "front": front_name,
                "shift": shift,
                "operators": len(front_item["shift_operators"][shift]),
                **shift_payload,
            })

    front_rows.sort(key=lambda item: (-item["productive"], -item["utilization_pct"], item["front"]))
    front_operator_rows.sort(key=lambda item: (item["front"], not item["team_member"], item["name"]))
    front_shift_rows.sort(key=lambda item: (item["front"], SHIFT_ORDER[item["shift"]]))

    performance_rows = []
    for performance_item in performance_data.values():
        team_member = team_week_lookup.get(
            (performance_item["front"], performance_item["operator_key"], performance_item["week"]),
            False,
        )
        performance_rows.append({
            "front": performance_item["front"],
            "unit": performance_item["unit"],
            "operator_key": performance_item["operator_key"],
            "code": performance_item["code"],
            "name": performance_item["name"],
            "shift": performance_item["shift"],
            "date": performance_item["date"],
            "week": performance_item["week"],
            "equipment_code": performance_item["equipment_code"],
            "equipment_name": performance_item["equipment_name"],
            "equipment_key": performance_item["equipment_key"],
            "equipment_label": (
                f'{performance_item["equipment_code"]} · {performance_item["equipment_name"]}'
                if performance_item["equipment_code"] and performance_item["equipment_name"]
                else performance_item["equipment_key"]
            ),
            "team_member": team_member,
            "team_status": "Equipe" if team_member else "Apoio eventual",
            "is_generic": "generico" in _norm(performance_item["name"]) or performance_item["code"] == "99999",
            "segments": performance_item["segments"],
            "farms": sorted(performance_item["farms"]),
            "main_operation": _top_operation(performance_item["operations"]),
            **_duration_payload(performance_item["totals"]),
        })

    performance_rows.sort(
        key=lambda item: (
            item["front"],
            item["date"],
            SHIFT_ORDER[item["shift"]],
            item["name"],
            item["equipment_key"],
        )
    )

    for event in timeline:
        team_member = team_week_lookup.get((event["front"], event["operator_key"], event["week"]), False)
        event["team_member"] = team_member
        event["team_status"] = "Equipe" if team_member else "Apoio eventual"
        event["is_generic"] = "generico" in _norm(event["operator_name"]) or event["operator_code"] == "99999"
    timeline.sort(key=lambda item: (item["start"], item["front"], item["operator_name"]))

    operation_rows = [
        {
            "operation": operation,
            "category": category,
            "category_label": CATEGORY_LABELS[category],
            "seconds": int(round(seconds)),
        }
        for operation, seconds in sorted(operation_totals.items(), key=lambda item: (-item[1], item[0]))
        for category in [operation_categories.get(operation, "other")]
    ]

    ranked_operators = [item for item in operator_rows if not item["is_generic"]]
    productive_candidates = [item for item in ranked_operators if item["productive"] > 0]
    maintenance_candidates = [item for item in ranked_operators if item["maintenance"] > 0]
    opportunity_candidates = [item for item in ranked_operators if item["recoverable_loss"] > 0]
    productive_shifts = [item for item in shift_rows if item["productive"] > 0]
    productive_fronts = [item for item in front_rows if item["productive"] > 0]

    insights = {
        "top_productive_operator": max(productive_candidates, key=lambda item: (item["productive"], item["utilization_pct"]), default=None),
        "best_utilization_operator": max(productive_candidates, key=lambda item: (item["utilization_without_climate_pct"], item["productive"]), default=None),
        "most_maintenance_operator": max(maintenance_candidates, key=lambda item: item["maintenance"], default=None),
        "largest_opportunity_operator": max(opportunity_candidates, key=lambda item: item["recoverable_loss"], default=None),
        "best_productive_shift": max(productive_shifts, key=lambda item: (item["utilization_without_climate_pct"], item["productive"]), default=None),
        "best_productive_front": max(productive_fronts, key=lambda item: (item["utilization_without_climate_pct"], item["productive"]), default=None),
    }

    sorted_dates = sorted(dates)
    fleets = sorted(equipment_catalog.values(), key=lambda item: (item["code"], item["name"]))
    return {
        "file": filename,
        "records": valid_records,
        "invalid_rows": invalid_rows,
        "operators_count": len(operators),
        "equipments_count": len(equipment_catalog),
        "units": sorted(units),
        "fronts": sorted(fronts),
        "fleets": fleets,
        "dates": sorted_dates,
        "period": {
            "start": sorted_dates[0] if sorted_dates else None,
            "end": sorted_dates[-1] if sorted_dates else None,
        },
        "shift_rules": {
            "A": "00:00 às 07:20",
            "B": "07:20 às 15:40",
            "C": "15:40 às 00:00",
        },
        "team_rule": {
            "minimum_days_per_front_per_week": 2,
            "description": "O operador só compõe a equipe da frente quando trabalha nela em pelo menos 2 dias distintos da mesma semana ISO (segunda a domingo). Com apenas 1 dia na semana, fica como apoio eventual.",
        },
        "comparison_rule": {
            "metric": "utilization_without_climate_pct",
            "description": "A comparação principal de produtividade usa o aproveitamento sem clima (horas produtivas divididas pelo tempo analisado menos o impacto climático). Manutenção e improdutividade permanecem visíveis separadamente para contextualizar o resultado.",
        },
        "summary": _duration_payload(overall),
        "shifts": shift_rows,
        "operators": operator_rows,
        "operator_shifts": operator_shift_rows,
        "front_summaries": front_rows,
        "front_operators": front_operator_rows,
        "front_shifts": front_shift_rows,
        "performance_rows": performance_rows,
        "timeline": timeline,
        "operations": operation_rows,
        "unclassified_operations": sorted(unclassified),
        "insights": insights,
    }
