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
            self.assertGreaterEqual(len(slide_names), 6)
            self.assertEqual(len(slide_names), len(presentation.find("p:sldIdLst", NS)))
            all_text = "\n".join("\n".join(t.text or "" for t in ET.fromstring(generated.read(name)).findall(".//a:t", NS)) for name in slide_names)
            for text in ("PPT / Frente 02", "01/10/2026", "10/10/2026", "04/10/2026", "101", "Resumo automático", "Possível parada por solo úmido", "Frente 03", "3001"):
                self.assertIn(text, all_text)
            self.assertNotIn("{{", all_text)
            self.assertNotIn("Título do slide", all_text)
            self.assertNotIn("Descrição do bloco", all_text)
            self.assertNotIn("NRD", all_text)
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

    def test_summary_paginates_without_discarding_text(self):
        report = sample_report()
        report["report"] = "\n".join(f"Linha {i}: ocorrência do setor {i}, com acentuação e dados da frente." for i in range(1, 80))
        content, _ = generate_return_presentation(report)
        with ZipFile(BytesIO(content)) as z:
            bodies = []
            for name in z.namelist():
                if name.startswith("ppt/slides/slide") and name.endswith(".xml"):
                    root = ET.fromstring(z.read(name))
                    for shape in root.findall(".//p:sp", NS):
                        if shape.find("p:nvSpPr/p:cNvPr", NS).get("name") == "ctt:summary_body":
                            bodies.append("\n".join(t.text or "" for t in shape.findall(".//a:t", NS)))
            self.assertGreater(len(bodies), 1)
            self.assertEqual(" ".join("\n".join(bodies).split()), " ".join(report["report"].split()))

    def test_zero_findings_missing_template_and_slide_limit(self):
        report = analyze_return_rows([
            {"date": date(2026, 10, 1), "sector": 101, "equipment": 1001},
        ], [{"code": "02", "name": "Frente 02", "equipment": [1001]}], "02", unit_code="PPT", unit_name="Paraguaçu Paulista")
        content, _ = generate_return_presentation(report)
        with ZipFile(BytesIO(content)) as z:
            self.assertEqual(len(ET.fromstring(z.read("ppt/presentation.xml")).find("p:sldIdLst", NS)), 4)
        with self.assertRaises(FileNotFoundError):
            generate_return_presentation(report, template_path=PRESENTATION_TEMPLATE.with_name("missing.pptx"))
        with self.assertRaises(ValueError):
            generate_return_presentation(None)
        report["report"] = "Longa ocorrência " * 20000
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
                if name.startswith("ppt/slides/slide") and name.endswith(".xml"):
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
