"""Leitor XLSX compartilhado (somente biblioteca padrão).

Usado pelo relatório de produtividade (``excel_reports``, que também atende a
análise de retornos e o solo úmido) e pela importação da base de setores
(``sector_base_import``). Cada chamador informa os próprios limites por
``XlsxLimits`` e escolhe a conversão de célula:

- ``typed_cell_value``: números com formato de data viram texto dd/mm/aaaa
  (com hora quando houver), booleanos viram ``True``/``False``;
- ``plain_cell_value``: valor bruto como texto, booleanos ``"1"``/``"0"``.

As abas são lidas em streaming (``ET.iterparse`` + ``elem.clear()``), de modo
que os limites de linhas/colunas são aplicados durante a leitura, sem montar a
árvore XML inteira em memória. Arquivos corrompidos (XML inválido, partes
ausentes, ZIP/CRC inválido) viram ``ValueError`` com mensagem amigável quando
a leitura ocorre dentro de ``corrupt_file_guard()``.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import PurePosixPath
import math
import re
import struct
import zipfile
import zlib
import xml.etree.ElementTree as ET

XML_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
XML_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"m": XML_MAIN, "r": XML_REL}

_ROW_TAG = f"{{{XML_MAIN}}}row"
_CELL_TAG = f"{{{XML_MAIN}}}c"
_SHEET_DATA_TAG = f"{{{XML_MAIN}}}sheetData"
_SHARED_ITEM_TAG = f"{{{XML_MAIN}}}si"
_TEXT_TAG = f"{{{XML_MAIN}}}t"

DATE_NUMFMT_IDS = set(range(14, 23)) | {27, 30, 36, 45, 46, 47, 50, 57}
# Faixa de seriais aceita pelo Excel (01/01/1900 a 31/12/9999).
EXCEL_SERIAL_MAX = 2958465

CORRUPT_FILE_MESSAGE = "Não foi possível ler a planilha: o arquivo está corrompido ou incompleto."
_CORRUPT_FILE_ERRORS = (ET.ParseError, KeyError, zipfile.BadZipFile, zlib.error, struct.error, EOFError)


@dataclass(frozen=True)
class XlsxLimits:
    max_entry_bytes: int
    max_uncompressed_bytes: int
    max_rows: int
    max_columns: int
    max_shared_strings: int


@contextmanager
def corrupt_file_guard():
    """Converte falhas de leitura de pacote/XML em ``ValueError`` amigável."""
    try:
        yield
    except _CORRUPT_FILE_ERRORS as exc:
        raise ValueError(CORRUPT_FILE_MESSAGE) from exc


def open_archive(file_bytes: bytes, invalid_message: str) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(BytesIO(file_bytes))
    except zipfile.BadZipFile as exc:
        raise ValueError(invalid_message) from exc


def validate_archive(archive: zipfile.ZipFile, limits: XlsxLimits) -> None:
    total = 0
    for info in archive.infolist():
        if info.flag_bits & 0x1:
            raise ValueError("Planilhas Excel protegidas por senha não são suportadas.")
        if info.file_size > limits.max_entry_bytes:
            raise ValueError("A planilha possui um conteúdo interno grande demais para processar com segurança.")
        total += info.file_size
        if total > limits.max_uncompressed_bytes:
            raise ValueError("A planilha expandida excede o limite seguro de processamento.")


def column_index(cell_ref: str) -> int:
    letters = re.match(r"[A-Z]+", cell_ref or "A")
    value = 0
    for char in (letters.group(0) if letters else "A"):
        value = value * 26 + (ord(char) - 64)
    return value - 1


def shared_strings(archive: zipfile.ZipFile, max_shared_strings: int) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    values: list[str] = []
    stack: list[ET.Element] = []
    with archive.open("xl/sharedStrings.xml") as stream:
        for event, elem in ET.iterparse(stream, events=("start", "end")):
            if event == "start":
                stack.append(elem)
                continue
            stack.pop()
            # Somente <si> filhos diretos da raiz, como em root.findall("m:si").
            if elem.tag != _SHARED_ITEM_TAG or len(stack) != 1:
                continue
            if len(values) >= max_shared_strings:
                raise ValueError("A planilha possui textos compartilhados demais para processar com segurança.")
            values.append("".join(node.text or "" for node in elem.iter(_TEXT_TAG)))
            elem.clear()
            stack[0].remove(elem)
    return values


def cell_styles(archive: zipfile.ZipFile) -> list[tuple[int, str]]:
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


def normalize_target(target: str) -> str:
    # O OPC permite alvo absoluto a partir da raiz do pacote ("/xl/...").
    target_path = PurePosixPath(target.lstrip("/")) if target.startswith("/") else PurePosixPath("xl") / target
    parts: list[str] = []
    for part in target_path.parts:
        if part in ("", "."):
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)


def workbook_sheets(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    """Todas as abas com relacionamento válido, na ordem do workbook: (nome, caminho)."""
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    relationships = {
        rel.attrib.get("Id"): rel.attrib.get("Target")
        for rel in rels.findall(f"{{{PKG_REL}}}Relationship")
    }
    sheets = []
    sheet_root = workbook.find("m:sheets", NS)
    if sheet_root is None:
        return sheets
    for sheet in list(sheet_root):
        name = sheet.attrib.get("name", "")
        rel_id = sheet.attrib.get(f"{{{XML_REL}}}id")
        target = relationships.get(rel_id)
        if target:
            sheets.append((name, normalize_target(target)))
    return sheets


def first_sheet_path(archive: zipfile.ZipFile) -> str:
    """Caminho da primeira aba; usa ``xl/worksheets/sheet1.xml`` sem relacionamento."""
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    sheets = workbook.find("m:sheets", NS)
    if sheets is None or not list(sheets):
        raise ValueError("A planilha não possui abas para processar.")
    first_sheet = list(sheets)[0]
    rel_id = first_sheet.attrib.get(f"{{{XML_REL}}}id")
    if not rel_id:
        return "xl/worksheets/sheet1.xml"

    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    target = None
    for rel in rels.findall(f"{{{PKG_REL}}}Relationship"):
        if rel.attrib.get("Id") == rel_id:
            target = rel.attrib.get("Target")
            break
    if not target:
        return "xl/worksheets/sheet1.xml"
    return normalize_target(target)


def excel_serial_to_datetime(value: float) -> datetime:
    if not math.isfinite(value) or not 0 <= value <= EXCEL_SERIAL_MAX:
        raise ValueError(f"Data serial fora da faixa do Excel: {value}")
    return datetime(1899, 12, 30) + timedelta(days=value)


def looks_like_date_format(fmt: str) -> bool:
    if not fmt:
        return False
    cleaned = re.sub(r'"[^"]*"', "", fmt.casefold())
    cleaned = re.sub(r"\\.", "", cleaned)
    cleaned = re.sub(r"\[[^\]]+\]", "", cleaned)
    return bool(re.search(r"(^|[^a-z])[dmyhs]+([^a-z]|$)", cleaned))


def typed_cell_value(cell, shared: list[str], styles: list[tuple[int, str]]):
    """Conversão do relatório: datas formatadas como texto pt-BR e booleanos reais."""
    cell_type = cell.attrib.get("t", "n")
    try:
        style_index = int(cell.attrib.get("s", "0") or 0)
    except ValueError:
        style_index = 0
    value_node = cell.find("m:v", NS)
    inline = cell.find("m:is", NS)
    raw = value_node.text if value_node is not None else None

    if cell_type == "s" and raw is not None:
        try:
            return shared[int(raw)]
        except (ValueError, IndexError):
            return raw
    if cell_type == "inlineStr" and inline is not None:
        return "".join(node.text or "" for node in inline.findall(".//m:t", NS))
    if cell_type == "b":
        return raw == "1"
    if cell_type in {"str", "e"}:
        return raw or ""
    if raw is None:
        return ""
    try:
        numeric = float(raw)
    except ValueError:
        return raw
    num_fmt_id, fmt = styles[style_index] if style_index < len(styles) else (0, "")
    is_date = num_fmt_id in DATE_NUMFMT_IDS or looks_like_date_format(fmt)
    if is_date and not (math.isfinite(numeric) and 0 <= numeric <= EXCEL_SERIAL_MAX):
        return raw
    if is_date:
        dt = excel_serial_to_datetime(numeric)
        if numeric < 1:
            return dt.strftime("%H:%M:%S")
        if abs(numeric - int(numeric)) < 1e-9:
            return dt.strftime("%d/%m/%Y")
        return dt.strftime("%d/%m/%Y %H:%M:%S")
    if numeric.is_integer():
        return str(int(numeric))
    return str(numeric)


def plain_cell_value(cell, shared: list[str]) -> str:
    """Conversão simples: valores como texto e booleanos ``"1"``/``"0"``."""
    cell_type = cell.attrib.get("t", "n")
    value_node = cell.find("m:v", NS)
    inline = cell.find("m:is", NS)
    raw = value_node.text if value_node is not None else None
    if cell_type == "s" and raw is not None:
        try:
            return shared[int(raw)]
        except (ValueError, IndexError):
            return raw
    if cell_type == "inlineStr" and inline is not None:
        return "".join(node.text or "" for node in inline.findall(".//m:t", NS))
    if cell_type == "b":
        return "1" if raw == "1" else "0"
    if raw is None:
        return ""
    if cell_type in {"str", "e"}:
        return raw
    try:
        number = float(raw)
    except ValueError:
        return raw
    if number.is_integer():
        return str(int(number))
    return str(number)


def read_sheet_rows(
    archive: zipfile.ZipFile,
    sheet_path: str,
    cell_value,
    *,
    max_rows: int,
    max_columns: int,
    keep_empty_rows: bool,
) -> list[tuple[list, str | None]]:
    """Lê as linhas de ``sheetData`` em streaming.

    Retorna ``(valores, atributo r da linha)``. ``max_rows`` conta as linhas
    retornadas; com ``keep_empty_rows=False`` linhas sem células são omitidas.
    ``cell_value(cell)`` converte cada ``<c>``. Células sem ``r`` ocupam a
    próxima coluna, como permite o SpreadsheetML.
    """
    rows: list[tuple[list, str | None]] = []
    stack: list[ET.Element] = []
    with archive.open(sheet_path) as stream:
        for event, elem in ET.iterparse(stream, events=("start", "end")):
            if event == "start":
                stack.append(elem)
                continue
            stack.pop()
            if elem.tag != _ROW_TAG or not stack or stack[-1].tag != _SHEET_DATA_TAG:
                continue
            if len(rows) >= max_rows:
                raise ValueError(f"A planilha excede o limite de {max_rows} linhas.")
            cells = {}
            max_col = -1
            for cell in elem.findall(_CELL_TAG):
                ref = cell.attrib.get("r")
                col = column_index(ref) if ref else max_col + 1
                if col >= max_columns:
                    raise ValueError(f"A planilha excede o limite de {max_columns} colunas.")
                max_col = max(max_col, col)
                cells[col] = cell_value(cell)
            if max_col >= 0 or keep_empty_rows:
                rows.append(([cells.get(index, "") for index in range(max_col + 1)], elem.get("r")))
            elem.clear()
            stack[-1].remove(elem)
    return rows
