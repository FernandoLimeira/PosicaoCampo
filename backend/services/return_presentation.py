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
PRESENTATION_TEMPLATE = TEMPLATE_DIR / "presentations" / "ctt_analise_template.pptx"
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


def _pages(text, *, width=82, lines_per_page=13):
    lines = []
    for paragraph in text.splitlines():
        lines.extend(textwrap.wrap(paragraph, width=width, break_long_words=True,
                                   break_on_hyphens=False, replace_whitespace=False) or [""])
        lines.append("")
    while lines and not lines[-1]:
        lines.pop()
    return ["\n".join(lines[i:i + lines_per_page]) for i in range(0, len(lines), lines_per_page)]


def _plan(report):
    unit = report["unit"]["code"]
    front = report["target_front"]["code"]
    scope = f"{unit} / Frente {front}"
    period = f"{_date(report['period']['start'])} a {_date(report['period']['end'])}"
    footer = f"{scope}    {period}"
    common = {"footer": footer}
    slides = [(1, {
        "cover_scope": scope, "cover_title": "Análise de mudanças\nde área",
        "cover_period": f"{report['unit']['name']}\n{period}",
    }), (9, {**common,
        "kpi1": f"{report['returns_count']} retornos reais\n\n{report['return_sectors_count']} setores distintos",
        "kpi2": f"{report['possible_soil_wet_count']} casos para verificar\n\n{report.get('confirmed_soil_wet_count', 0)} solo úmido confirmado\n\n{report['possible_soil_wet_sectors_count']} setores pendentes",
        "kpi3": f"{report['other_front_periods_count']} de outras frentes\n\n{report['ties_count']} empates\n\n{report['unknown_equipment_count']} sem cadastro",
        "kpi_context": f"{unit} / {report['target_front']['name']}    {report['records']} registros válidos",
    })]
    pages = _pages(report["report"])
    if len(pages) > MAX_PRESENTATION_SLIDES - 3:
        raise ValueError("A apresentação excede 150 slides. Processe uma planilha com período menor.")
    for index, body in enumerate(pages, 1):
        title = "Resumo automático" if len(pages) == 1 else f"Resumo automático ({index}/{len(pages)})"
        slides.append((5, {**common, "summary_title": title, "summary_body": body}))
    for key, title, status in (("returns", "Retornos reais", "return"),
                               ("possible_soil_wet", "Interrupção: verificar", "pending"),
                               ("confirmed_soil_wet", "Solo úmido confirmado", "confirmed")):
        # A separate occurrence slide preserves dates and fleet attribution.
        for item in report.get(key, []):
            if len(slides) >= MAX_PRESENTATION_SLIDES - 1:
                raise ValueError("A apresentação excede 150 slides. Processe uma planilha com período menor.")
            sectors = ", ".join(str(s) for s in item["sectors_during_absence"])
            counts = "; ".join(f"{entry['front']}: {entry['count']}" for entry in item["return_counts"])
            # Large lists continue in the summary layout rather than clipping.
            left = f"Entrada: {_date(item['entry_date'])}\nSaída: {_date(item['exit_date'])}\nReaparecimento: {_date(item['return_date'])}\n\n{item['days_out']} dia(s) fora"
            if status == "pending":
                right = "Sem registro de trabalho da frente em outro setor.\n\nSolo úmido não confirmado pela base de apontamentos. Verificar a causa."
            elif status == "confirmed":
                evidence = item.get("soil_wet_evidence") or {}
                right = (f"Maioria exigida: {evidence.get('majority_required', 0)} de {evidence.get('fleet_size', 0)} equipamentos.\n"
                         f"Dias com maioria: {evidence.get('days_with_majority', 0)}/{evidence.get('days_in_gap', 0)}.\n"
                         "Excluído das mudanças de área pela regra de apontamentos de solo úmido.")
                for day in evidence.get("daily", []):
                    right += f"\n{_date(day['date'])}: {', '.join(map(str, day['equipment']))}; {day['total_hours']} h."
                for sector in evidence.get("sector_evidence", []):
                    right += f"\nSetor de espera {sector['sector']}: {sector['total_hours']} h."
            else:
                right = f"Trabalho nos setores:\n{sectors}\n\nEquipamentos por frente no retorno:\n{counts}"
            for coverage in item.get("other_fronts_in_sector", []):
                right += (f"\n\nNo setor durante a ausência: {coverage['front']}, "
                          f"{_date(coverage['start'])} a {_date(coverage['end'])}, "
                          f"{coverage['min_count']} a {coverage['max_count']} colhedoras.")
            reference = item.get("sector_reference") or {}
            if reference.get("farm"):
                right += f"\n\nFazenda: {reference['farm']}."
            if reference.get("section"):
                right += f"\nSeção: {reference['section']}."
            elif reference.get("status") in {"multiple_sections", "ambiguous", "not_found"}:
                right += "\nSeção/cadastro de setores: verificar."
            wrapped = _pages(right, width=39, lines_per_page=10)
            slides.append((4, {**common, "detail_title": title,
                "detail_left_label": f"Setor {item['sector']}", "detail_right_label": "Atividade no intervalo",
                "detail_left": left, "detail_right": wrapped[0],
                "detail_left_caption": report["target_front"]["name"],
                "detail_right_caption": {"pending": "Causa pendente de verificação", "confirmed": "Confirmado pela regra de apontamentos", "return": "Retorno com atividade em outro setor"}[status],
            }))
            for continuation in wrapped[1:]:
                slides.append((5, {**common, "summary_title": f"Setor {item['sector']}: continuação", "summary_body": continuation}))
    slides.append((10, {"closing_scope": f"{scope}    {period}"}))
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
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def generate_return_presentation(report, *, template_path=None):
    """Gera em memória. Nunca grava bancos, planilhas ou apresentações em disco."""
    if not isinstance(report, dict) or not report.get("report", "").strip():
        raise ValueError("Processe uma análise antes de gerar a apresentação.")
    slides = _plan(report)
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
            for rel in list(slide_rels):
                if rel.get("Type", "").endswith(("/notesSlide", "/slide")):
                    slide_rels.remove(rel)
            result.writestr(f"ppt/slides/_rels/slide{index}.xml.rels", _xml(slide_rels, package_namespace=REL))
            rid = f"rIdGeneratedSlide{index}"
            ET.SubElement(slide_list, f"{{{P}}}sldId", {"id": str(255 + index), f"{{{R}}}id": rid})
            ET.SubElement(rels, f"{{{REL}}}Relationship", {"Id": rid, "Type": R + "/slide", "Target": f"slides/slide{index}.xml"})
            ET.SubElement(content_types, f"{{{CT}}}Override", {"PartName": f"/ppt/slides/slide{index}.xml", "ContentType": "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"})
        result.writestr("ppt/presentation.xml", ET.tostring(presentation, encoding="utf-8", xml_declaration=True))
        result.writestr("ppt/_rels/presentation.xml.rels", _xml(rels, package_namespace=REL))
        result.writestr("[Content_Types].xml", _xml(content_types, package_namespace=CT))
        # Remove stale template slide counts/titles from extended properties.
        app = ET.fromstring(source.read("docProps/app.xml"))
        for child in list(app):
            if child.tag.rsplit("}", 1)[-1] in {"HeadingPairs", "TitlesOfParts"}:
                app.remove(child)
            elif child.tag.rsplit("}", 1)[-1] == "Slides":
                child.text = str(len(slides))
        result.writestr("docProps/app.xml", ET.tostring(app, encoding="utf-8", xml_declaration=True))
    safe_front = re.sub(r"[^A-Za-z0-9_-]", "_", report["target_front"]["code"])
    filename = f"analise-mudancas-area-{report['unit']['code']}-frente-{safe_front}-{report['period']['end']}.pptx"
    return output.getvalue(), filename
