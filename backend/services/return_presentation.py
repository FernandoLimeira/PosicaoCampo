"""Preenche os layouts CTT preparados com conteúdo nativo e editável.

O design foi preparado com Artifact Tool a partir do PPTX fornecido. Em
produção, somente a biblioteca padrão é necessária: nada de Office ou Node.
"""
from copy import deepcopy
from datetime import date
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import posixpath
import re
import textwrap
import xml.etree.ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from ..config import TEMPLATE_DIR

P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
NS = {"p": P, "a": A, "r": R}
for prefix, uri in NS.items():
    ET.register_namespace(prefix, uri)

PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
PRESENTATION_TEMPLATE = TEMPLATE_DIR / "presentations" / "ctt_compact_template.pptx"
MAX_PRESENTATION_SLIDES = 150


def _xml(root, *, package_namespace=None):
    # OPC requires package Relationships/Types elements without a prefix.
    # Do not change ElementTree's process-global namespace map per request.
    data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    if package_namespace:
        match = re.search(rb'xmlns:(\w+)="' + package_namespace.encode() + rb'"', data)
        if match is None:
            return data  # Already serialized with the required default namespace.
        prefix = match.group(1)
        data = data.replace(b"xmlns:" + prefix + b"=", b"xmlns=")
        data = data.replace(b"<" + prefix + b":", b"<").replace(b"</" + prefix + b":", b"</")
    return data


def report_digest(report):
    """Detecta mudança no processamento/layout entre a análise e a exportação."""
    return sha256(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _date(value):
    return date.fromisoformat(value).strftime("%d/%m/%Y")


def _text(value):
    # Uploaded cells and registered names must not produce invalid XML 1.0.
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]", "", str(value))


TABLE_ROWS = 8
MAX_TRACE_PLACEHOLDERS = 6


def default_trace_indices(report):
    """Três retornos de maior intervalo, sem repetir o setor."""
    ordered = sorted(enumerate(report.get("returns", [])),
                     key=lambda pair: (-int(pair[1]["days_out"]), pair[0]))
    result, sectors = [], set()
    for index, item in ordered:
        if item["sector"] not in sectors:
            result.append(index)
            sectors.add(item["sector"])
        if len(result) == 3:
            break
    return result


def _trace_indices(report, selected):
    if selected is None:
        return default_trace_indices(report)
    if not isinstance(selected, list) or len(selected) > MAX_TRACE_PLACEHOLDERS:
        raise ValueError("Selecione no máximo 6 espaços de rastro.")
    if any(isinstance(index, bool) or not isinstance(index, int)
           or index < 0 or index >= len(report.get("returns", [])) for index in selected):
        raise ValueError("Rastro sem retorno correspondente na análise atual.")
    if len(set(selected)) != len(selected):
        raise ValueError("Há espaços de rastro repetidos.")
    return selected


def _short_list(items, limit=8):
    values = [str(item) for item in items]
    visible = ", ".join(values[:limit])
    return visible + (f" (+{len(values) - limit})" if len(values) > limit else "")


def _farm(item):
    reference = item.get("sector_reference") or {}
    if reference.get("status") in {"matched", "multiple_sections"} and reference.get("farm"):
        return reference["farm"]
    return "Cadastro pendente"


def _compact_lines(text, width=39, max_lines=10):
    lines = []
    for paragraph in text.splitlines():
        lines.extend(textwrap.wrap(paragraph, width=width, break_long_words=True) or [""])
    if len(lines) > max_lines:
        lines = lines[:max_lines - 1] + ["Demais detalhes no relatório."]
    return "\n".join(lines)


def _plan(report, trace_indices=None):
    unit = report["unit"]["code"]
    front = report["target_front"]["code"]
    scope = f"{unit} / Frente {front}"
    period = f"{_date(report['period']['start'])} a {_date(report['period']['end'])}"
    common = {"footer": f"{scope}    {period}"}
    returns = report.get("returns", [])
    selected_traces = _trace_indices(report, trace_indices)
    ranked = sorted(returns, key=lambda item: -int(item["days_out"]))
    largest = ranked[0] if ranked else None
    context = (f"Maior intervalo: setor {largest['sector']}, {largest['days_out']} dias fora."
               if largest else "Nenhum retorno real identificado no período.")
    # Compact the analysis, not the structural slides of the supplied CTT deck.
    # Source layouts 1/2/3/10 remain mandatory even without returns or traces.
    slides = [
        (1, {"cover_scope": scope, "cover_title": "Análise de mudanças de área",
             "cover_period": period, "_notes": report["report"]}),
        (2, {"section_label": "ANÁLISE OPERACIONAL", "section_title": "Mudanças de área",
             "section_scope": scope, "section_caption": "Análise da frente",
             "_notes": f"{scope}\n{period}"}),
        (3, {"agenda_title": "SUMÁRIO", "agenda_scope": f"Itens a serem discutidos · {scope}",
             "agenda_item1": "Indicadores da análise",
             "agenda_item2": "Retornos de setor" if returns else "Retornos: sem ocorrências",
             "agenda_item3": "Ocupação por outras frentes",
             "agenda_item4": "Paradas e cadastros",
             "agenda_item5": "Rastros selecionados" if selected_traces else "Discussão dos resultados",
             "agenda_context": period, "_notes": report["report"]}),
        (9, {**common,
        "kpi_title": f"{scope}: mudanças de área",
        "label1": "Retornos de setor", "label2": "Paradas e interrupções", "label3": "Outras frentes",
        "caption1": "Com trabalho em outra área", "caption2": "Solo úmido exige apontamentos", "caption3": "Atribuição por equipamentos",
        "kpi1": f"{report['returns_count']} retornos reais\n\n{report['return_sectors_count']} setores distintos",
        "kpi2": f"{report.get('confirmed_soil_wet_count', 0)} solo úmido confirmado\n\n{report['possible_soil_wet_count']} interrupções pendentes",
        "kpi3": f"{report['other_front_periods_count']} períodos de outras frentes\n\n{report['ties_count']} empates",
        "kpi_context": context, "_notes": report["report"],
    })]
    for offset in range(0, len(returns), TABLE_ROWS):
        items = returns[offset:offset + TABLE_ROWS]
        matrix = [["Setor", "Fazenda", "Última colheita", "Retorno", "Dias fora"]]
        for item in items:
            # A single table line keeps the authored row height readable.
            # The unabridged registered name remains in the speaker notes.
            farm = " ".join(_farm(item).split())
            if len(farm) > 27:
                farm = farm[:26].rstrip() + "…"
            matrix.append([str(item["sector"]), farm, _date(item["exit_date"]),
                           _date(item["return_date"]), str(item["days_out"])])
        page = offset // TABLE_ROWS + 1
        total = (len(returns) + TABLE_ROWS - 1) // TABLE_ROWS
        slides.append((5, {**common, "summary_title": f"Retornos de setor ({page}/{total})",
            "table_caption": "Datas completas e setores visitados estão no relatório da análise.",
            "_table": matrix, "_notes": json.dumps(items, ensure_ascii=False, indent=2)}))
    left = ["Maiores intervalos"]
    left.extend(f"Setor {item['sector']}: {item['days_out']} dias fora" for item in ranked[:3])
    coverage = [(item, entry) for item in returns for entry in item.get("other_fronts_in_sector", [])]
    if coverage:
        left.append("Ocupação durante a ausência")
        left.extend(f"Setor {item['sector']}: {entry['front']}, {_date(entry['start'])} a {_date(entry['end'])}"
                    for item, entry in coverage[:2])
    else:
        left.append("Sem outra frente identificada nos setores dos retornos durante a ausência.")
    issues = report.get("sector_reference_issues", [])
    right = [f"{report.get('confirmed_soil_wet_count', 0)} paradas por solo úmido, fora das mudanças de área.",
             f"{report['possible_soil_wet_count']} interrupções pendentes.",
             f"{len(issues)} setores com cadastro a conferir."]
    if issues:
        right.append(_short_list([item["sector"] for item in issues]))
    unknown = report.get("unknown_equipment", [])
    right.append(f"{report['unknown_equipment_count']} equipamentos sem frente cadastrada.")
    if unknown:
        right.append(_short_list(unknown, 5))
    if report["ties_count"]:
        right.append(f"{report['ties_count']} empates, sem atribuição exclusiva.")
    slides.append((4, {**common, "detail_title": "Destaques e conferências",
        "detail_left_label": "Retornos e ocupação", "detail_right_label": "Paradas e qualidade dos dados",
        "detail_left": _compact_lines("\n".join(left)),
        "detail_right": _compact_lines("\n".join(right)),
        "detail_left_caption": "Intervalos entre colheitas, não tempo total de parada",
        "detail_right_caption": "Relatório completo disponível na página da análise",
        "_notes": report["report"] + "\n\n" + json.dumps({
            "possible_soil_wet": report.get("possible_soil_wet", []),
            "confirmed_soil_wet": report.get("confirmed_soil_wet", []),
            "sector_reference_issues": issues, "unknown_equipment": unknown,
        }, ensure_ascii=False, indent=2),
    }))
    for index in selected_traces:
        item = returns[index]
        day = _date(item["return_date"])
        slides.append((11, {**common, "summary_title": f"Rastro de colheita: setor {item['sector']}",
            "trace_context": textwrap.shorten(_farm(item), width=85, placeholder="…") +
                             f"\nÚltima colheita: {_date(item['exit_date'])}    Retorno: {day}",
            "trace_picture": f"Inserir rastro do setor {item['sector']}\nem {day} aqui",
            "trace_caption": "Insira a imagem original no PowerPoint. Preserve a legenda, a escala e o período do mapa.",
            "_notes": json.dumps(item, ensure_ascii=False, indent=2),
        }))
    slides.append((10, {"closing_title": "ENCERRAMENTO", "closing_scope": scope,
                        "_notes": f"{scope}\n{period}\n\n{report['report']}"}))
    if len(slides) > MAX_PRESENTATION_SLIDES:
        raise ValueError("A apresentação excede 150 slides. Processe uma planilha com período menor.")
    for index, (_, values) in enumerate(slides, 1):
        values["page"] = f"{index:02d} / {len(slides):02d}"
    return slides


def _fill_slide(data, values):
    root = ET.fromstring(data)
    for shape in root.findall(".//p:sp", NS):
        name = shape.find("p:nvSpPr/p:cNvPr", NS)
        if name is None or not name.get("name", "").startswith("ctt:"):
            continue
        key = name.get("name")[4:]
        if key == "trace_picture":
            # Preserve the tool-authored frame and text, but explicitly identify
            # its native picture role. The template exporter may serialize a
            # named placeholder with only the default content index.
            properties = shape.find("p:nvSpPr/p:nvPr", NS)
            placeholder = properties.find("p:ph", NS)
            if placeholder is None:
                placeholder = ET.SubElement(properties, f"{{{P}}}ph")
            placeholder.set("type", "pic")
            placeholder.set("idx", "20")
        if key not in values:
            if any((t.text or "") == "{{" + key + "}}" for t in shape.findall(".//a:t", NS)):
                raise RuntimeError("Modelo de apresentação com campos não preenchidos.")
            continue  # Fixed title/label/caption already authored in the template.
        body = shape.find("p:txBody", NS)
        prototype = body.find("a:p", NS)
        run = prototype.find("a:r", NS)
        for paragraph in list(body.findall("a:p", NS)):
            body.remove(paragraph)
        for line in _text(values[key]).split("\n"):
            paragraph = deepcopy(prototype)
            for child in list(paragraph):
                if child.tag != f"{{{A}}}pPr":
                    paragraph.remove(child)
            new_run = deepcopy(run) if run is not None else ET.Element(f"{{{A}}}r")
            text = new_run.find(f"{{{A}}}t")
            if text is None:
                text = ET.SubElement(new_run, f"{{{A}}}t")
            text.text = line
            paragraph.append(new_run)
            body.append(paragraph)
    matrix = values.get("_table")
    if matrix:
        frame = root.find(".//p:graphicFrame", NS)
        table = frame.find(".//a:tbl", NS)
        original_rows = table.findall("a:tr", NS)
        for row in original_rows:
            table.remove(row)
        for index, cells in enumerate(matrix):
            row = deepcopy(original_rows[0 if index == 0 else 1 if index % 2 else 2])
            for cell, value in zip(row.findall("a:tc", NS), cells):
                _fill_body(cell.find("a:txBody", NS), value)
            table.append(row)
        # Remove unused blank rows and keep the authored row height/font size.
        frame.find("p:xfrm/a:ext", NS).set("cy", str(sum(int(row.get("h")) for row in table.findall("a:tr", NS))))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _fill_body(body, text):
    prototype = body.find("a:p", NS)
    run = prototype.find("a:r", NS)
    for paragraph in list(body.findall("a:p", NS)):
        body.remove(paragraph)
    for line in _text(text).split("\n"):
        paragraph = deepcopy(prototype)
        for child in list(paragraph):
            if child.tag != f"{{{A}}}pPr":
                paragraph.remove(child)
        new_run = deepcopy(run) if run is not None else ET.Element(f"{{{A}}}r")
        node = new_run.find("a:t", NS)
        if node is None:
            node = ET.SubElement(new_run, f"{{{A}}}t")
        node.text = line
        paragraph.append(new_run)
        body.append(paragraph)


def _notes(source, slide_filename, slide_rels, text, index):
    rel = next((rel for rel in slide_rels if rel.get("Type", "").endswith("/notesSlide")), None)
    if rel is None:
        raise RuntimeError("Modelo compacto sem campos de notas.")
    target = rel.get("Target")
    name = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(slide_filename), target))
    root = ET.fromstring(source.read(name))
    for shape in root.findall(".//p:sp", NS):
        ph = shape.find("p:nvSpPr/p:nvPr/p:ph", NS)
        if ph is not None and ph.get("type") == "body":
            _fill_body(shape.find("p:txBody", NS), text)
    rel_name = posixpath.dirname(name) + "/_rels/" + posixpath.basename(name) + ".rels"
    rels = ET.fromstring(source.read(rel_name))
    for relationship in rels:
        if relationship.get("Type", "").endswith("/slide"):
            relationship.set("Target", f"../slides/slide{index}.xml")
    return _xml(root), _xml(rels, package_namespace=REL)


def generate_return_presentation(report, *, template_path=None, trace_indices=None):
    """Gera em memória. Nunca grava bancos, planilhas ou apresentações em disco."""
    if not isinstance(report, dict) or not report.get("report", "").strip():
        raise ValueError("Processe uma análise antes de gerar a apresentação.")
    slides = _plan(report, trace_indices)
    path = Path(template_path or PRESENTATION_TEMPLATE)
    output = BytesIO()
    with ZipFile(path) as source, ZipFile(output, "w", ZIP_DEFLATED) as result:
        presentation = ET.fromstring(source.read("ppt/presentation.xml"))
        rels = ET.fromstring(source.read("ppt/_rels/presentation.xml.rels"))
        rel_targets = {r.get("Id"): r.get("Target") for r in rels}
        original_ids = list(presentation.find("p:sldIdLst", NS))
        targets = [rel_targets[s.get(f"{{{R}}}id")] for s in original_ids]
        sources = [target.lstrip("/") if target.startswith("/")
                   else posixpath.normpath(posixpath.join("ppt", target)) for target in targets]
        slide_list = presentation.find("p:sldIdLst", NS)
        slide_list.clear()
        for rel in list(rels):
            if rel.get("Type", "").endswith("/slide"):
                rels.remove(rel)
        content_types = ET.fromstring(source.read("[Content_Types].xml"))
        for child in list(content_types):
            if child.get("PartName", "").startswith(("/ppt/slides/", "/ppt/notesSlides/")):
                content_types.remove(child)
        for entry in source.infolist():
            if entry.filename.startswith(("ppt/slides/", "ppt/notesSlides/")) or entry.filename in {
                "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "[Content_Types].xml", "docProps/app.xml",
            }:
                continue
            result.writestr(entry, source.read(entry.filename))
        for index, (template_number, values) in enumerate(slides, 1):
            filename = sources[template_number - 1]
            result.writestr(f"ppt/slides/slide{index}.xml", _fill_slide(source.read(filename), values))
            relation_path = str(Path(filename).parent).replace("\\", "/") + "/_rels/" + filename.rsplit("/", 1)[-1] + ".rels"
            slide_rels = ET.fromstring(source.read(relation_path))
            notes, notes_rels = _notes(source, filename, slide_rels, values.get("_notes", ""), index)
            result.writestr(f"ppt/notesSlides/notesSlide{index}.xml", notes)
            result.writestr(f"ppt/notesSlides/_rels/notesSlide{index}.xml.rels", notes_rels)
            for rel in list(slide_rels):
                if rel.get("Type", "").endswith(("/notesSlide", "/slide")):
                    slide_rels.remove(rel)
            ET.SubElement(slide_rels, f"{{{REL}}}Relationship", {
                "Id": "rIdCompactNotes", "Type": R + "/notesSlide", "Target": f"../notesSlides/notesSlide{index}.xml",
            })
            result.writestr(f"ppt/slides/_rels/slide{index}.xml.rels", _xml(slide_rels, package_namespace=REL))
            rid = f"rIdGeneratedSlide{index}"
            ET.SubElement(slide_list, f"{{{P}}}sldId", {"id": str(255 + index), f"{{{R}}}id": rid})
            ET.SubElement(rels, f"{{{REL}}}Relationship", {"Id": rid, "Type": R + "/slide", "Target": f"slides/slide{index}.xml"})
            ET.SubElement(content_types, f"{{{CT}}}Override", {"PartName": f"/ppt/slides/slide{index}.xml", "ContentType": "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"})
            ET.SubElement(content_types, f"{{{CT}}}Override", {"PartName": f"/ppt/notesSlides/notesSlide{index}.xml", "ContentType": "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"})
        result.writestr("ppt/presentation.xml", ET.tostring(presentation, encoding="utf-8", xml_declaration=True))
        result.writestr("ppt/_rels/presentation.xml.rels", _xml(rels, package_namespace=REL))
        result.writestr("[Content_Types].xml", _xml(content_types, package_namespace=CT))
        # Remove stale template slide counts/titles from extended properties.
        app = ET.fromstring(source.read("docProps/app.xml"))
        for child in list(app):
            if child.tag.rsplit("}", 1)[-1] in {"HeadingPairs", "TitlesOfParts"}:
                app.remove(child)
            elif child.tag.rsplit("}", 1)[-1] in {"Slides", "Notes"}:
                child.text = str(len(slides))
        result.writestr("docProps/app.xml", ET.tostring(app, encoding="utf-8", xml_declaration=True))
    safe_front = re.sub(r"[^A-Za-z0-9_-]", "_", report["target_front"]["code"])
    filename = f"analise-mudancas-area-{report['unit']['code']}-frente-{safe_front}-{report['period']['end']}.pptx"
    return output.getvalue(), filename
