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


def _normalize_drawing_xml(root):
    """Translate the old template's invalid overflow value into actual wrapping.

    OOXML horzOverflow accepts only overflow/clip. Text wrapping belongs to
    bodyPr.wrap, not tcPr.horzOverflow. Keep this guard even after fixing the
    shipped template so old or re-exported templates cannot reintroduce it.
    """
    for element in root.iter():
        if element.tag not in {f"{{{A}}}tcPr", f"{{{A}}}bodyPr"}:
            continue
        value = element.get("horzOverflow")
        if value == "wrap":
            element.attrib.pop("horzOverflow")
            if element.tag == f"{{{A}}}bodyPr":
                element.set("wrap", "square")
        elif value is not None and value not in {"overflow", "clip"}:
            raise RuntimeError("Modelo de apresentação com configuração de texto inválida.")
    for cell in root.findall(".//a:tc", NS):
        body = cell.find("a:txBody/a:bodyPr", NS)
        if body is not None and body.get("wrap") is None:
            body.set("wrap", "square")


def _xml(root, *, package_namespace=None):
    # OPC requires package Relationships/Types elements without a prefix.
    # Do not change ElementTree's process-global namespace map per request.
    _normalize_drawing_xml(root)
    data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    if package_namespace:
        match = re.search(rb'xmlns:(\w+)="' + package_namespace.encode() + rb'"', data)
        if match is None:
            return data  # Already serialized with the required default namespace.
        prefix = match.group(1)
        data = data.replace(b"xmlns:" + prefix + b"=", b"xmlns=")
        data = data.replace(b"<" + prefix + b":", b"<").replace(b"</" + prefix + b":", b"</")
    return data


def _validate_presentation_package(content):
    """Fail closed on common structural defects before returning a download.

    This is a bounded package/compatibility check, not a complete OOXML schema
    validator. Microsoft SDK validation is also covered during development.
    """
    with ZipFile(BytesIO(content)) as package:
        names = package.namelist()
        parts = set(names)
        if len(names) != len(parts):
            raise RuntimeError("Apresentação com arquivos internos duplicados.")
        for name in names:
            if not name.endswith((".xml", ".rels")):
                continue
            root = ET.fromstring(package.read(name))
            if name.endswith(".rels"):
                if root.tag != f"{{{REL}}}Relationships":
                    raise RuntimeError("Apresentação com relações internas inválidas.")
                ids = [entry.get("Id") for entry in root]
                if len(ids) != len(set(ids)):
                    raise RuntimeError("Apresentação com referências internas duplicadas.")
                base = "" if name == "_rels/.rels" else posixpath.dirname(posixpath.dirname(name))
                for entry in root:
                    if entry.get("TargetMode") == "External":
                        continue
                    target = (entry.get("Target") or "").split("#", 1)[0]
                    resolved = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(base, target))
                    if not target or resolved not in parts:
                        raise RuntimeError("Apresentação com referência a arquivo interno ausente.")
            for element in root.iter():
                if element.tag in {f"{{{A}}}tcPr", f"{{{A}}}bodyPr"}:
                    value = element.get("horzOverflow")
                    if value is not None and value not in {"overflow", "clip"}:
                        raise RuntimeError("Apresentação com configuração de texto incompatível.")
            if name.startswith(("ppt/slides/slide", "ppt/notesSlides/notesSlide")):
                ids = [shape.get("id") for shape in root.findall(".//p:cNvPr", NS)]
                if len(ids) != len(set(ids)):
                    raise RuntimeError("Apresentação com identificadores de objetos duplicados.")


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


def _trace_passages(report, sector):
    """Passages within the imported history, separated by real sector returns.

    Soil-wet gaps are kept within a passage rather than invented as new returns.
    """
    events = sorted((item for item in report.get("returns", []) if item["sector"] == sector),
                    key=lambda item: (item["return_date"], item["exit_date"]))
    unique = {item["return_date"]: item for item in events}
    events = list(unique.values())
    if not events:
        return []
    periods = [item for item in report.get("target_activity_periods", []) if item["sector"] == sector]
    first = events[0]
    first_start = min((item["start"] for item in periods),
                      default=first.get("entry_date") or (first.get("field_evidence") or {}).get("previous_start") or first["exit_date"])
    passages = [{"start": first_start, "end": first["exit_date"]}]
    for index, event in enumerate(events):
        end = (events[index + 1]["exit_date"] if index + 1 < len(events)
               else max((item["end"] for item in periods),
                        default=(event.get("field_evidence") or {}).get("return_end") or event["return_date"]))
        passages.append({"start": event["return_date"], "end": end})
    return [dict(number=index, **item) for index, item in enumerate(passages, 1)]


def _passage_label(passage):
    number = passage["number"]
    label = {1: "Primeira passagem", 2: "Segunda passagem", 3: "Terceira passagem"}.get(number, f"{number}ª passagem")
    period = (_date(passage["start"]) if passage["start"] == passage["end"]
              else f"{_date(passage['start'])} a {_date(passage['end'])}")
    return f"{label}\n{period}"


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
    ranked = sorted(returns, key=lambda item: int(item["days_out"]))
    smallest = min(returns, key=lambda item: int(item["days_out"])) if returns else None
    context = (f"Menor intervalo: setor {smallest['sector']}, {smallest['days_out']} dias fora."
               if smallest else "Nenhum retorno real identificado no período.")
    coverage = [(item, entry) for item in returns for entry in item.get("other_fronts_in_sector", [])]
    covered_sectors = {item["sector"] for item, _ in coverage}
    if coverage:
        count = len(covered_sectors)
        presence = [f"{count} " + ("setor já iniciado recebeu" if count == 1 else "setores já iniciados receberam") +
                    " outra frente durante a ausência."]
        presence.extend(f"Setor {item['sector']}: {entry['front']}, {_date(entry['start'])} a {_date(entry['end'])}"
                        for item, entry in coverage[:2])
    else:
        presence = ["Nenhuma outra frente identificada nos setores já iniciados durante a ausência da frente analisada."]
    # Compact the analysis, not the structural slides of the supplied CTT deck.
    # Source layouts 1/2/3/10 remain mandatory even without returns or traces.
    slides = [
        (1, {"cover_scope": f"Unidade {(report['unit'].get('name') or unit).title()}",
             "cover_title": "Análise de Recorrência de Setores",
             "cover_period": "Retornos da frente aos setores após atuação em outras áreas.\n" + period,
             "_notes": report["report"]}),
        (2, {"section_label": "ANÁLISE OPERACIONAL", "section_title": "Motivação do trabalho",
             "section_scope": "Identificar os retornos das frentes a setores já trabalhados, "
                              "evidenciando a importância de concluir a colheita da área "
                              "antes do deslocamento para um novo setor.",
             "section_caption": scope,
             "_notes": f"{scope}\n{period}"}),
        (3, {"agenda_title": "SUMÁRIO", "agenda_scope": f"Itens a serem discutidos · {scope}",
             "agenda_item1": "Indicadores da análise",
             "agenda_item2": "Retornos de setor" if returns else "Retornos: sem ocorrências",
             "agenda_item3": "Ocupação por outras frentes",
             "agenda_item4": "Paradas e cadastros",
             "agenda_item5": "Rastros selecionados" if selected_traces else "Discussão dos resultados",
             "agenda_context": period, "_notes": report["report"]}),
        # Reuse the original two-block CTT layout, without an empty middle topic.
        (4, {**common,
        "detail_title": f"{scope}: mudanças de área",
        "detail_left_label": "Retornos de setor",
        "detail_right_label": "Outra frente em área já iniciada",
        "detail_left": _compact_lines(f"{report['returns_count']} retornos reais\n\n"
                                      f"{report['return_sectors_count']} setores distintos\n\n{context}"),
        "detail_right": _compact_lines("\n".join(presence)),
        "detail_left_caption": "Com trabalho em outra área",
        "detail_right_caption": "Atuação no mesmo setor durante a ausência da frente analisada",
        "_notes": report["report"],
    })]
    for offset in range(0, len(returns), TABLE_ROWS):
        items = returns[offset:offset + TABLE_ROWS]
        matrix = [["Setor", "Fazenda", "Última colheita", "Retorno", "Dias fora", "Talhões no retorno"]]
        for item in items:
            # A single table line keeps the authored row height readable.
            # The unabridged registered name remains in the speaker notes.
            farm = " ".join(_farm(item).split())
            if len(farm) > 19:
                farm = farm[:18].rstrip() + "…"
            field_label = {"same": "Mesmos talhões", "different": "Talhões diferentes",
                           "mixed": "Comuns e diferentes", "incomplete": "Dados parciais",
                           "unavailable": "Não informado"}.get((item.get("field_evidence") or {}).get("status"), "Não informado")
            matrix.append([str(item["sector"]), farm, _date(item["exit_date"]),
                           _date(item["return_date"]), str(item["days_out"]), field_label])
        page = offset // TABLE_ROWS + 1
        total = (len(returns) + TABLE_ROWS - 1) // TABLE_ROWS
        slides.append((5, {**common, "summary_title": f"Retornos de setor ({page}/{total})",
            "table_caption": "Talhões: última permanência × retorno da frente. Dados parciais não permitem conclusão completa.",
            "_table": matrix, "_notes": json.dumps(items, ensure_ascii=False, indent=2)}))
    left = ["Menores intervalos"]
    left.extend(f"Setor {item['sector']}: {item['days_out']} dias fora" for item in ranked[:3])
    if coverage:
        left.append("Outra frente colheu na área já iniciada")
        # Prioritize explicit source-front/layout crossovers, not a presumed authorization.
        highlighted = sorted(coverage, key=lambda pair: not bool(pair[1].get("credited_target_evidence")))
        for item, entry in highlighted[:2]:
            left.append(f"Setor {item['sector']}: {entry['front']}, {_date(entry['start'])} a {_date(entry['end'])}.")
            left.append(f"Equipamentos do layout: {_short_list(entry.get('equipment', []), 4) or 'ver notas'}.")
            credited = entry.get("credited_target_evidence", [])
            if credited:
                left.append(f"Entrada registrada para {report['target_front']['name']}, "
                            f"com equipamentos de {entry['front']}.")
            else:
                left.append("Sem comprovação de entrada registrada para a frente analisada.")
    else:
        left.append("Sem outra frente identificada nos setores dos retornos durante a ausência.")
    issues = report.get("sector_reference_issues", [])
    unknown = report.get("unknown_equipment", [])
    slides.append((12, {**common, "detail_title": "Destaques e conferências",
        "detail_left_label": "Retornos e ocupação",
        "detail_left": _compact_lines("\n".join(left), width=100, max_lines=11),
        "detail_left_caption": "Frente informada na base × equipamentos dos layouts. "
                               "O cruzamento não comprova autorização nem conclusão da área.",
        "_notes": report["report"] + "\n\n" + json.dumps({
            "other_front_occupation": [dict(sector=item["sector"], **entry) for item, entry in coverage],
            "possible_soil_wet": report.get("possible_soil_wet", []),
            "confirmed_soil_wet": report.get("confirmed_soil_wet", []),
            "sector_reference_issues": issues, "unknown_equipment": unknown,
        }, ensure_ascii=False, indent=2),
    }))
    trace_sectors = set()
    for index in selected_traces:
        item = returns[index]
        sector = item["sector"]
        if sector in trace_sectors:
            continue
        trace_sectors.add(sector)
        passages = _trace_passages(report, sector)
        for offset in range(0, len(passages), 3):
            compared = passages[offset:offset + 3]
            # A fourth/seventh passage retains the preceding image for comparison.
            if len(compared) == 1:
                compared = [passages[offset - 1], *compared]
            values = {**common, "summary_title": f"Rastros de colheita: setor {sector}",
                "trace_context": textwrap.shorten(_farm(item), width=85, placeholder="…") +
                                 f"\n{report['target_front']['name']} · Passagens no período analisado",
                "trace_caption": "Insira os rastros nos espaços lado a lado. Preserve a legenda, a escala e o período do mapa.",
                "_notes": json.dumps({"sector": sector, "passages": compared,
                    "returns": [event for event in returns if event["sector"] == sector]}, ensure_ascii=False, indent=2)}
            for slot, passage in enumerate(compared, 1):
                values[f"trace_passage_{slot}"] = _passage_label(passage)
                values[f"trace_picture_{slot}"] = f"Inserir rastro do setor {sector}\n{passage['number']}ª passagem aqui"
            slides.append((13 if len(compared) == 3 else 11, values))
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
        if key == "trace_picture" or re.fullmatch(r"trace_picture_[1-3]", key):
            # Preserve the tool-authored frame and text, but explicitly identify
            # its native picture role. The template exporter may serialize a
            # named placeholder with only the default content index.
            properties = shape.find("p:nvSpPr/p:nvPr", NS)
            placeholder = properties.find("p:ph", NS)
            if placeholder is None:
                placeholder = ET.SubElement(properties, f"{{{P}}}ph")
            placeholder.set("type", "pic")
            slot = int(key.rsplit("_", 1)[-1]) if key != "trace_picture" else 0
            placeholder.set("idx", str(20 + slot))
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
    return _xml(root)


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
    content = output.getvalue()
    _validate_presentation_package(content)
    return content, filename
