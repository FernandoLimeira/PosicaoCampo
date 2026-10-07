from hashlib import sha256
from io import BytesIO
from pathlib import PurePosixPath
import posixpath
from datetime import date
import unittest
import xml.etree.ElementTree as ET
from zipfile import ZipFile

from backend.services.return_analysis import analyze_return_rows
from backend.services.return_presentation import generate_return_presentation, report_digest, PRESENTATION_TEMPLATE, NS
from backend.services.return_presentation import default_trace_indices


def package_text(archive, directory="slides"):
    return "\n".join(t.text or "" for name in archive.namelist()
                     if name.startswith(f"ppt/{directory}/") and name.endswith(".xml")
                     for t in ET.fromstring(archive.read(name)).findall(".//a:t", NS))


def sample_report():
    rows = [
        {"date": date(2026, 10, day), "sector": sector, "equipment": fleet, "tons": 1, "loads": 1}
        for day, sector, fleet in [(1, 101, 1001), (2, 202, 1001), (4, 101, 1001),
                                   (10, 101, 1001), (3, 303, 2001), (3, 404, 3001),
                                   (3, 505, 1001), (3, 505, 2001)]
    ]
    return analyze_return_rows(rows, [
        {"code": "02", "name": "Frente 02", "equipment": [1001]},
        {"code": "03", "name": "Frente 03", "equipment": [2001]},
    ], "02", filename="colheita.xlsx", unit_code="PPT", unit_name="Paraguaçu Paulista")


class ReturnPresentationTests(unittest.TestCase):
    def test_ctt_structural_slides_always_keep_order_and_original_artwork(self):
        reference = PRESENTATION_TEMPLATE.with_name("apresentacao_ctt.pptx")

        def picture_signatures(archive, slide):
            filename = f"ppt/slides/slide{slide}.xml"
            rels = ET.fromstring(archive.read(f"ppt/slides/_rels/slide{slide}.xml.rels"))
            targets = {rel.get("Id"): rel.get("Target") for rel in rels}
            signatures = []
            for picture in ET.fromstring(archive.read(filename)).findall(".//p:pic", NS):
                embed = picture.find(".//a:blip", NS).get(f"{{{NS['r']}}}embed")
                target = targets[embed]
                path = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("ppt/slides", target))
                transform = picture.find("p:spPr/a:xfrm", NS)
                signatures.append((sha256(archive.read(path)).digest(), ET.tostring(transform)))
            return signatures

        for unit in ("PPT", "NRD", "RBR", "PST"):
            for no_returns, selected in ((False, None), (False, []), (True, [])):
                with self.subTest(unit=unit, no_returns=no_returns, selected=selected):
                    report = sample_report()
                    report["unit"]["code"] = unit
                    if no_returns:
                        report["returns"] = []
                        report["returns_count"] = report["return_sectors_count"] = 0
                    content, _ = generate_return_presentation(report, trace_indices=selected)
                    with ZipFile(BytesIO(content)) as output, ZipFile(reference) as source:
                        count = len(ET.fromstring(output.read("ppt/presentation.xml")).find("p:sldIdLst", NS))
                        def slide_text(number):
                            return "\n".join(t.text or "" for t in ET.fromstring(output.read(f"ppt/slides/slide{number}.xml")).findall(".//a:t", NS))
                        self.assertIn("Análise de mudanças de área", slide_text(1))
                        self.assertIn(f"{unit} / Frente 02", slide_text(1))
                        self.assertIn("ANÁLISE OPERACIONAL", slide_text(2))
                        self.assertIn("SUMÁRIO", slide_text(3))
                        self.assertIn("Itens a serem discutidos", slide_text(3))
                        self.assertIn(f"03 / {count:02d}", slide_text(3))
                        self.assertIn("ENCERRAMENTO", slide_text(count))
                        self.assertIn(f"{unit} / Frente 02", slide_text(count))
                        self.assertIn("Discussão dos resultados" if selected == [] else "Rastros selecionados", slide_text(3))
                        if no_returns:
                            self.assertIn("Retornos: sem ocorrências", slide_text(3))
                        for generated_slide, original_slide in ((1, 1), (2, 2), (3, 3), (count, 10)):
                            self.assertEqual(picture_signatures(output, generated_slide), picture_signatures(source, original_slide))
                        for placeholder in ("NOME DA SEÇÃO", "Título da seção", "Descrição breve", "{{", "00 / 00"):
                            self.assertNotIn(placeholder, package_text(output))

    def test_package_matches_report_preserves_art_and_is_editable(self):
        report = sample_report()
        before = sha256(PRESENTATION_TEMPLATE.read_bytes()).digest()
        content, filename = generate_return_presentation(report)
        self.assertEqual(before, sha256(PRESENTATION_TEMPLATE.read_bytes()).digest())
        self.assertEqual(filename, "analise-mudancas-area-PPT-frente-02-2026-10-10.pptx")
        with ZipFile(BytesIO(content)) as generated, ZipFile(PRESENTATION_TEMPLATE) as template:
            self.assertIsNone(generated.testzip())
            presentation = ET.fromstring(generated.read("ppt/presentation.xml"))
            self.assertEqual(presentation.find("p:sldSz", NS).attrib, {"cx": "12192000", "cy": "6858000"})
            self.assertIn(b'<Types xmlns="', generated.read("[Content_Types].xml"))
            self.assertIn(b'<Relationships xmlns="', generated.read("ppt/_rels/presentation.xml.rels"))
            slide_names = [name for name in generated.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml")]
            self.assertEqual(len(slide_names), 8)
            self.assertEqual(len(slide_names), len(presentation.find("p:sldIdLst", NS)))
            all_text = "\n".join("\n".join(t.text or "" for t in ET.fromstring(generated.read(name)).findall(".//a:t", NS)) for name in slide_names)
            for text in ("PPT / Frente 02", "01/10/2026", "10/10/2026", "04/10/2026", "101", "Retornos de setor", "Destaques e conferências", "interrupções pendentes", "3001", "Inserir rastro do setor 101"):
                self.assertIn(text, all_text)
            self.assertNotIn("{{", all_text)
            self.assertNotIn("Título do slide", all_text)
            self.assertNotIn("Descrição do bloco", all_text)
            self.assertNotIn("NRD", all_text)
            self.assertIn(report["report"], package_text(generated, "notesSlides"))
            for name in template.namelist():
                if name.startswith(("ppt/media/", "ppt/theme/", "ppt/slideMasters/", "ppt/slideLayouts/")):
                    self.assertEqual(generated.read(name), template.read(name), name)
            # Every internal relationship must resolve to an included part.
            for name in generated.namelist():
                if not name.endswith(".rels"):
                    continue
                root = ET.fromstring(generated.read(name))
                base = "" if name == "_rels/.rels" else str(PurePosixPath(name).parent.parent)
                for rel in root:
                    if rel.get("TargetMode") == "External":
                        continue
                    target = rel.get("Target").split("#")[0]
                    resolved = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(base, target))
                    self.assertIn(resolved, generated.namelist(), f"{name}: {target}")

    def test_long_report_remains_complete_in_notes_without_extra_slides(self):
        report = sample_report()
        report["report"] = "\n".join(f"Linha {i}: ocorrência do setor {i}, com acentuação e dados da frente." for i in range(1, 80))
        content, _ = generate_return_presentation(report)
        with ZipFile(BytesIO(content)) as z:
            self.assertEqual(len(ET.fromstring(z.read("ppt/presentation.xml")).find("p:sldIdLst", NS)), 8)
            self.assertNotIn("Linha 79", package_text(z))
            self.assertIn(report["report"], package_text(z, "notesSlides"))

    def test_all_returns_in_native_tables_and_selected_picture_placeholders(self):
        report = sample_report()
        source = report["returns"][0]
        report["returns"] = [{**source, "sector": index % 12 + 1, "days_out": index + 1,
                              "sector_reference": {"status": "matched", "farm": "Fazenda extensa " * 8}}
                             for index in range(14)]
        report["returns_count"] = 14
        report["return_sectors_count"] = 12
        self.assertEqual(default_trace_indices(report), [13, 12, 11])
        content, _ = generate_return_presentation(report)
        with ZipFile(BytesIO(content)) as archive:
            self.assertEqual(len(ET.fromstring(archive.read("ppt/presentation.xml")).find("p:sldIdLst", NS)), 11)
            tables = [ET.fromstring(archive.read(f"ppt/slides/slide{i}.xml")).find(".//a:tbl", NS) for i in (5, 6)]
            rows = [row for table in tables for row in table.findall("a:tr", NS)[1:]]
            self.assertEqual(len(rows), 14)
            self.assertEqual([row.find("a:tc/a:txBody/a:p/a:r/a:t", NS).text for row in rows],
                             [str(item["sector"]) for item in report["returns"]])
            self.assertIn("…", package_text(archive))
            self.assertIn("Fazenda extensa " * 8, package_text(archive, "notesSlides"))
            for slide in (8, 9, 10):
                root = ET.fromstring(archive.read(f"ppt/slides/slide{slide}.xml"))
                self.assertIsNotNone(root.find('.//p:ph[@type="pic"]', NS))
                self.assertIn("04/10/2026", " ".join(t.text or "" for t in root.findall(".//a:t", NS)))
        for selected, expected in (([], 8), ([0], 9), ([2, 0], 10)):
            content, _ = generate_return_presentation(report, trace_indices=selected)
            with ZipFile(BytesIO(content)) as archive:
                self.assertEqual(len(ET.fromstring(archive.read("ppt/presentation.xml")).find("p:sldIdLst", NS)), expected)
                if selected:
                    first = ET.fromstring(archive.read("ppt/slides/slide8.xml"))
                    self.assertIn(f"Inserir rastro do setor {report['returns'][selected[0]]['sector']}",
                                  " ".join(t.text or "" for t in first.findall(".//a:t", NS)))

    def test_invalid_trace_selection_rejected(self):
        report = sample_report()
        for selected in ([0, 0], [-1], [999], [True], ["0"], "0", list(range(7))):
            with self.subTest(selected=selected), self.assertRaises(ValueError):
                generate_return_presentation(report, trace_indices=selected)

    def test_zero_findings_missing_template_and_slide_limit(self):
        report = analyze_return_rows([
            {"date": date(2026, 10, 1), "sector": 101, "equipment": 1001},
        ], [{"code": "02", "name": "Frente 02", "equipment": [1001]}], "02", unit_code="PPT", unit_name="Paraguaçu Paulista")
        content, _ = generate_return_presentation(report)
        with ZipFile(BytesIO(content)) as z:
            self.assertEqual(len(ET.fromstring(z.read("ppt/presentation.xml")).find("p:sldIdLst", NS)), 6)
        with self.assertRaises(FileNotFoundError):
            generate_return_presentation(report, template_path=PRESENTATION_TEMPLATE.with_name("missing.pptx"))
        with self.assertRaises(ValueError):
            generate_return_presentation(None)
        report["returns"] = [sample_report()["returns"][0]] * 1200
        with self.assertRaisesRegex(ValueError, "150 slides"):
            generate_return_presentation(report)

    def test_digest_detects_scope_or_result_changes(self):
        report = sample_report()
        digest = report_digest(report)
        self.assertEqual(len(digest), 64)
        self.assertEqual(report_digest(dict(reversed(list(report.items())))), digest)
        report["unit"]["code"] = "NRD"
        self.assertNotEqual(report_digest(report), digest)

    def test_xml_special_characters_are_escaped_and_invalid_controls_removed(self):
        report = sample_report()
        report["target_front"]["name"] = 'Frente A & B <teste>\x00'
        report["report"] = 'Ocorrência com A & B <teste>\x00, {{texto}} e acentuação.'
        content, _ = generate_return_presentation(report)
        with ZipFile(BytesIO(content)) as z:
            for name in z.namelist():
                if name.startswith(("ppt/slides/slide", "ppt/notesSlides/notesSlide")) and name.endswith(".xml"):
                    ET.fromstring(z.read(name))
                    self.assertNotIn(b"\x00", z.read(name))

    def test_reference_artwork_preserved_in_prepared_template(self):
        source_path = PRESENTATION_TEMPLATE.with_name("apresentacao_ctt.pptx")
        with ZipFile(source_path) as source, ZipFile(PRESENTATION_TEMPLATE) as prepared:
            def images(z):
                return {sha256(z.read(name)).digest() for name in z.namelist() if name.startswith("ppt/media/")}
            self.assertEqual(images(source), images(prepared))


if __name__ == "__main__":
    unittest.main()
