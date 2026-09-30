"""Importação da base de setores a partir de planilhas XLSX/XLSM.

A rotina procura preferencialmente uma aba chamada BASE_DADOS e aceita os
cabeçalhos usados no arquivo Informe Sacarose: SETOR, SEÇÃO e DESCRIÇÃO SETOR.
Também reconhece "Fazenda" como descrição para facilitar planilhas equivalentes.
"""
from __future__ import annotations

from io import BytesIO
from pathlib import PurePosixPath
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET

MAX_SECTOR_BASE_UPLOAD_BYTES = 10 * 1024 * 1024
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


def _column_index(cell_ref: str) -> int:
    letters = re.match(r"[A-Z]+", cell_ref or "A")
    value = 0
    for char in (letters.group(0) if letters else "A"):
        value = value * 26 + (ord(char) - 64)
    return value - 1


def _shared_strings(archive: zipfile.ZipFile):
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    values = []
    for si in root.findall("m:si", NS):
        pieces = [node.text or "" for node in si.findall(".//m:t", NS)]
        values.append("".join(pieces))
    return values


def _normalize_target(target: str) -> str:
    target_path = PurePosixPath("xl") / target
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


def _workbook_sheets(archive: zipfile.ZipFile):
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
            sheets.append((name, _normalize_target(target)))
    return sheets


def _cell_value(cell, shared):
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


def _sheet_rows(archive: zipfile.ZipFile, sheet_path: str, shared):
    if sheet_path not in archive.namelist():
        return []
    root = ET.fromstring(archive.read(sheet_path))
    rows = []
    for row_node in root.findall(".//m:sheetData/m:row", NS):
        cells = {}
        max_col = -1
        for cell in row_node.findall("m:c", NS):
            ref = cell.attrib.get("r", "A1")
            col = _column_index(ref)
            max_col = max(max_col, col)
            cells[col] = _cell_value(cell, shared)
        if max_col >= 0:
            rows.append([cells.get(index, "") for index in range(max_col + 1)])
        else:
            rows.append([])
    return rows


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


def parse_sector_base_excel(file_bytes: bytes, filename: str = "base.xlsx") -> list[dict[str, str]]:
    if not file_bytes:
        raise ValueError("Selecione uma planilha para importar.")
    if len(file_bytes) > MAX_SECTOR_BASE_UPLOAD_BYTES:
        raise ValueError("A planilha excede o limite de 10 MB.")
    lower_name = str(filename or "").lower()
    if not (lower_name.endswith(".xlsx") or lower_name.endswith(".xlsm")):
        raise ValueError("Use uma planilha Excel no formato XLSX ou XLSM.")

    try:
        archive = zipfile.ZipFile(BytesIO(file_bytes))
    except zipfile.BadZipFile as exc:
        raise ValueError("O arquivo enviado não é uma planilha Excel válida.") from exc

    with archive:
        required = {"xl/workbook.xml", "xl/_rels/workbook.xml.rels"}
        if not required.issubset(archive.namelist()):
            raise ValueError("Estrutura da planilha Excel inválida ou incompleta.")
        shared = _shared_strings(archive)
        sheets = _workbook_sheets(archive)
        if not sheets:
            raise ValueError("A planilha não possui abas para importar.")

        preferred = sorted(sheets, key=lambda item: 0 if _norm(item[0]) in {"base dados", "base de dados", "base setores", "base de setores"} else 1)
        for _, sheet_path in preferred:
            items = _parse_rows(_sheet_rows(archive, sheet_path, shared))
            if items:
                # Setor é a chave da base; em caso de repetição, preserva a última linha da planilha.
                deduped = {}
                for item in items:
                    deduped[_norm(item["sector"])] = item
                return list(deduped.values())

    raise ValueError("Não encontrei uma aba com as colunas SETOR, SEÇÃO e DESCRIÇÃO SETOR.")
