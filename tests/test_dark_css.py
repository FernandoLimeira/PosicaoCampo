"""Modo escuro: os arquivos .dark.css precisam acompanhar o CSS claro."""
import re
import unittest
from pathlib import Path

from tools import build_dark_css as dark

ROOT = Path(__file__).resolve().parents[1]


class DarkCssTests(unittest.TestCase):
    def test_dark_css_is_up_to_date(self):
        stale = [dark.dark_path(path).name for path in dark.sources()
                 if not dark.dark_path(path).exists()
                 or dark.dark_path(path).read_text(encoding="utf-8") != dark.build(path)]
        self.assertEqual(stale, [], "Rode: python tools/build_dark_css.py")

    def test_every_stylesheet_link_has_its_dark_version(self):
        for template in (ROOT / "templates").rglob("*.html"):
            text = template.read_text(encoding="utf-8")
            for href in re.findall(r'href="(/css/[^"?]+?)(?<!\.dark)\.css', text):
                self.assertIn(f'{href}.dark.css', text, template.name)
                self.assertIn('media="(prefers-color-scheme: dark)"', text, template.name)

    def test_conversion_rules(self):
        self.assertEqual(dark.convert_value("background", "#fff"), "#2a2a2a")  # cartão: cinza escuro
        self.assertEqual(dark.convert_value("color", "#ffffff"), "#ffffff")  # texto em botão colorido
        light_text = dark.parse_color(dark.convert_value("color", "#253f43"))
        self.assertGreater(min(light_text[:3]), 180)  # texto escuro vira claro
        self.assertEqual(dark.convert_value("box-shadow", "0 2px 4px rgba(0,0,0,.2)"), "0 2px 4px rgba(0,0,0,.2)")
        green = dark.parse_color(dark.convert_value("background", "#2c8764"))
        self.assertGreater(green[1], green[0] + 40)  # botão verde continua verde
        print_rules = dark._render(dark._parse_block("@media print { body { background: #fff; } }")[0])
        self.assertEqual(print_rules, [])  # impressão continua clara


if __name__ == "__main__":
    unittest.main()
