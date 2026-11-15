"""Gerador mínimo de planilhas .xlsx (Office Open XML), sem dependências externas.

Cada aba recebe uma lista de linhas; a primeira linha da tabela vai em negrito (cabeçalho).
Números viram células numéricas (somam no Excel); textos vão como texto embutido.
"""
from __future__ import annotations

import io
import re
import zipfile
from xml.sax.saxutils import escape

_INVALID_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_SHEET_NAME = re.compile(r"[\[\]:*?/\\]")

_CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    '{sheets}</Types>'
)
_ROOT_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    '</Relationships>'
)
# Estilos: 0 = normal, 1 = negrito (cabeçalho), 2 = número com 1 casa, 3 = número com 2 casas.
_STYLES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.0"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>'
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
    '</styleSheet>'
)


def _column(index: int) -> str:
    name = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def _cell(ref: str, value, bold: bool) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, bool):
        value = "Sim" if value else "Não"
    if isinstance(value, (int, float)) and not bold:
        style = 0 if isinstance(value, int) else (3 if round(value, 1) != value else 2)
        return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'
    text = escape(_INVALID_XML.sub("", str(value)))
    style = ' s="1"' if bold else ""
    return f'<c r="{ref}" t="inlineStr"{style}><is><t xml:space="preserve">{text}</t></is></c>'


def _sheet_xml(rows: list[list], header_row: int) -> str:
    widths: dict[int, int] = {}
    body = []
    for row_index, row in enumerate(rows, 1):
        cells = []
        for col_index, value in enumerate(row):
            widths[col_index] = min(60, max(widths.get(col_index, 8), len(str(value if value is not None else "")) + 2))
            cells.append(_cell(f"{_column(col_index)}{row_index}", value, row_index == header_row))
        body.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    cols = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in sorted(widths.items()))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f'{f"<cols>{cols}</cols>" if cols else ""}<sheetData>{"".join(body)}</sheetData></worksheet>')


def build_xlsx(sheets: list[tuple[str, list[list], int]]) -> bytes:
    """sheets: (nome da aba, linhas, número da linha de cabeçalho em negrito)."""
    data = io.BytesIO()
    names = []
    for name, _, _ in sheets:
        clean = _SHEET_NAME.sub(" ", str(name)).strip()[:31] or f"Aba {len(names) + 1}"
        names.append(clean)
    with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", _CONTENT_TYPES.format(sheets="".join(
            f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            for i in range(1, len(sheets) + 1))))
        archive.writestr("_rels/.rels", _ROOT_RELS)
        archive.writestr("xl/workbook.xml",
                         '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                         '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                         'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                         + "".join(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>' for i, name in enumerate(names, 1))
                         + "</sheets></workbook>")
        archive.writestr("xl/_rels/workbook.xml.rels",
                         '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                         '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                         + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
                                   for i in range(1, len(sheets) + 1))
                         + f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                         + "</Relationships>")
        archive.writestr("xl/styles.xml", _STYLES)
        for i, (_, rows, header_row) in enumerate(sheets, 1):
            archive.writestr(f"xl/worksheets/sheet{i}.xml", _sheet_xml(rows, header_row))
    return data.getvalue()
