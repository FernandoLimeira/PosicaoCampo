import importlib
import io
import json
import re
import time
import tempfile
import unittest
from html.parser import HTMLParser
from http.cookies import SimpleCookie
from pathlib import Path
from unittest.mock import patch

from backend import config


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.assets = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if tag == "script" and "src" in attrs:
            self.assets.append(attrs["src"].split("?", 1)[0])
        if tag == "link" and attrs.get("rel") == "stylesheet":
            self.assets.append(attrs["href"].split("?", 1)[0])
        if tag == "img" and attrs.get("src", "").startswith("/"):
            self.assets.append(attrs["src"].split("?", 1)[0])


class PageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        root = Path(cls.temporary.name)
        cls.patches = []
        # Patch before importing the WSGI entry, which initializes the database.
        for module in (config,):
            for name, value in {
                "DATA_DIR": root, "AUTH_DB_PATH": root / "usuarios.db",
                "OPERATIONS_DB_PATH": root / "dados.db", "LEGACY_DB_PATH": root / "legacy.db",
            }.items():
                p = patch.object(module, name, value)
                p.start()
                cls.patches.append(p)
        cls.db = importlib.import_module("backend.models.database")
        cls.application = staticmethod(importlib.import_module("backend.app").application)
        cls.db.init_db()
        cls.admin = cls.db.create_or_update_admin("TestAdmin", "Test-password-42")
        cls.member = cls.db.create_user("TestOperator", "Test-password-42")
        cls.cookies = {
            role: f"{config.SESSION_COOKIE}={cls.db.create_session(user['id'])}"
            for role, user in (("admin", cls.admin), ("member", cls.member))
        }
        cls.db.initialize_units([
            {"code": code, "name": definition["name"], "rows": [], "metrics": [], "rain": []}
            for code, definition in cls.db.UNIT_DEFINITIONS.items()
        ], cls.admin["id"])
        cls.db.save_sector_base_item("101", "10", "FAZENDA TESTE", cls.admin["id"])
        cls.db.save_sector_base_item("101", "20", "FAZENDA SEGUNDA", cls.admin["id"])

    @classmethod
    def tearDownClass(cls):
        for p in reversed(cls.patches):
            p.stop()
        cls.temporary.cleanup()

    def request(self, path, *, role=None, method="GET", body=None, cookie=None, overrides=None):
        result = {}

        def start_response(status, headers):
            result["status"] = int(status.split()[0])
            result["headers"] = dict(headers)

        payload = json.dumps(body or {}).encode() if method != "GET" else b""
        environ = {
            "REQUEST_METHOD": method, "PATH_INFO": path, "QUERY_STRING": "",
            "CONTENT_TYPE": "application/json", "CONTENT_LENGTH": str(len(payload)),
            "wsgi.input": io.BytesIO(payload), "wsgi.url_scheme": "https",
            "HTTP_HOST": "test.invalid", "REMOTE_ADDR": "127.0.0.1",
        }
        if role:
            environ["HTTP_COOKIE"] = self.cookies[role]
        if cookie is not None:
            environ["HTTP_COOKIE"] = cookie
        environ.update(overrides or {})
        raw_body = b"".join(self.application(environ, start_response))
        content_type = result["headers"].get("Content-Type", "")
        binary = content_type.startswith("image/") or content_type == "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        result["body"] = raw_body if binary else raw_body.decode("utf-8")
        return result

    def test_pages_require_a_session(self):
        for path in ("/", "/sacarose", "/producao", "/setores", "/relatorios", "/retornos", "/historico", "/usuarios", "/usuarios/cadastro", "/emitir-posicao-global"):
            with self.subTest(path=path):
                response = self.request(path)
                self.assertEqual(response["status"], 302)
                self.assertEqual(response["headers"]["Location"], "/login")

    def test_presentation_download_permissions_consistency_and_errors(self):
        from backend.services.return_presentation import PPTX_MIME, report_digest
        from tests.test_return_presentation import sample_report
        report = sample_report()
        overrides = {"QUERY_STRING": "unit=PPT&front=02&min_gap=1&digest=" + report_digest(report)}
        self.assertEqual(self.request("/api/return-analysis/presentation", method="POST")["status"], 401)
        with patch("backend.controllers.application_controller._analyze_return_request", return_value=report) as analyze:
            rejected = self.request("/api/return-analysis/presentation", method="POST", role="member", overrides={**overrides, "HTTP_ORIGIN": "https://untrusted.invalid"})
            self.assertEqual(rejected["status"], 403)
            analyze.assert_not_called()
            missing = self.request("/api/return-analysis/presentation", method="POST", role="member")
            self.assertEqual(missing["status"], 400)
            analyze.assert_not_called()
            for role in ("member", "admin"):
                response = self.request("/api/return-analysis/presentation", method="POST", role=role, overrides=overrides)
                self.assertEqual(response["status"], 200)
                self.assertEqual(response["headers"]["Content-Type"], PPTX_MIME)
                self.assertEqual(response["headers"]["Cache-Control"], "no-store")
                self.assertIn('attachment; filename="analise-mudancas-area-PPT', response["headers"]["Content-Disposition"])
                self.assertTrue(response["body"].startswith(b"PK"))
            conflict = self.request("/api/return-analysis/presentation", method="POST", role="member", overrides={"QUERY_STRING": "digest=" + "0" * 64})
            self.assertEqual(conflict["status"], 409)
            with patch("backend.controllers.application_controller.generate_return_presentation", side_effect=FileNotFoundError):
                missing_model = self.request("/api/return-analysis/presentation", method="POST", role="member", overrides=overrides)
                self.assertEqual(missing_model["status"], 500)
                self.assertIn("templates/presentations", missing_model["body"])
        self.assertEqual(self.request("/api/return-analysis/presentation", method="GET", role="member")["status"], 404)
        page = self.request("/retornos", role="member")["body"]
        self.assertIn('id="return-generate-presentation"', page)
        self.assertIn('disabled>Gerar apresentação', page)
        self.assertGreater(page.index('id="return-generate-presentation"'), page.index('id="return-other-body"'))
        self.assertEqual(self.request("/templates/presentations/apresentacao_ctt.pptx", role="member")["status"], 404)

    def test_real_upload_analysis_and_presentation_recompute_same_scope(self):
        from xml.sax.saxutils import escape
        from zipfile import ZipFile
        self.db.save_return_analysis_layouts("PST", [{"code": "02", "name": "Frente 02", "equipment": [1001]}], self.admin["id"])
        data = io.BytesIO()
        rows = [("DIA", "SETOR", "COLHEDORA"), ("2026-10-01", "101", "1001"),
                ("2026-10-02", "202", "1001"), ("2026-10-04", "101", "1001")]
        xml_rows = "".join('<row r="%d">%s</row>' % (number, "".join(
            f'<c r="{column}{number}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
            for column, value in zip("ABC", values))) for number, values in enumerate(rows, 1))
        with ZipFile(data, "w") as z:
            z.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dados" sheetId="1" r:id="rId1"/></sheets></workbook>')
            z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
            z.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + xml_rows + '</sheetData></worksheet>')
        boundary = "test-presentation-upload"
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="colheita.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'.encode()
                + data.getvalue() + f'\r\n--{boundary}--\r\n'.encode())

        def upload(route, query):
            return self.request(route, method="POST", role="member", overrides={
                "QUERY_STRING": query, "CONTENT_TYPE": "multipart/form-data; boundary=" + boundary,
                "CONTENT_LENGTH": str(len(body)), "wsgi.input": io.BytesIO(body),
            })
        analysis = upload("/api/return-analysis/analyze", "unit=PST&front=02&min_gap=1")
        self.assertEqual(analysis["status"], 200, analysis["body"])
        payload = json.loads(analysis["body"])
        self.assertEqual(payload["report"]["unit"]["code"], "PST")
        self.assertEqual(payload["report"]["returns_count"], 1)
        query = "unit=PST&front=02&min_gap=1&digest=" + payload["report_digest"]
        presentation = upload("/api/return-analysis/presentation", query)
        self.assertEqual(presentation["status"], 200)
        self.assertIn("PST-frente-02", presentation["headers"]["Content-Disposition"])
        from backend.services.soil_wet_import import parse_soil_wet_file
        from tests.test_return_analysis_integration import SOIL_HEADERS, soil_row, xlsx
        soil_records = parse_soil_wet_file(xlsx([SOIL_HEADERS, soil_row(unit="PST")]), "solo.xlsx")["records"]
        self.db.import_return_soil_wet_records("PST", soil_records, self.admin["id"])
        self.assertEqual(upload("/api/return-analysis/presentation", query)["status"], 409)
        payload = json.loads(upload("/api/return-analysis/analyze", "unit=PST&front=02&min_gap=1")["body"])
        query = "unit=PST&front=02&min_gap=1&digest=" + payload["report_digest"]
        self.assertEqual(upload("/api/return-analysis/presentation", query)["status"], 200)
        self.db.save_sector_base_item("202", "99", "Fazenda nova", self.admin["id"])
        self.assertEqual(upload("/api/return-analysis/presentation", query)["status"], 409)
        self.db.save_return_analysis_layouts("PST", [
            {"code": "02", "name": "Frente 02", "equipment": [9999]},
            {"code": "03", "name": "Frente 03", "equipment": [1001]},
        ], self.admin["id"])
        changed = upload("/api/return-analysis/presentation", query)
        self.assertEqual(changed["status"], 409)

    def test_presentation_trace_selection_is_validated_against_current_analysis(self):
        from backend.services.return_presentation import report_digest, _plan
        from tests.test_return_presentation import sample_report
        from zipfile import ZipFile
        import xml.etree.ElementTree as ET
        report = sample_report()
        query = "unit=PPT&front=02&min_gap=1&digest=" + report_digest(report)
        with patch("backend.controllers.application_controller._analyze_return_request", return_value=report):
            for value, selected in (("none", []), ("0", [0])):
                response = self.request("/api/return-analysis/presentation", method="POST", role="member",
                                        overrides={"QUERY_STRING": query + "&traces=" + value})
                self.assertEqual(response["status"], 200, response["body"] if response["status"] != 200 else "")
                with ZipFile(io.BytesIO(response["body"])) as archive:
                    root = ET.fromstring(archive.read("ppt/presentation.xml"))
                    self.assertEqual(len(root.find("{http://schemas.openxmlformats.org/presentationml/2006/main}sldIdLst")), len(_plan(report, selected)))
            for value in ("-1", "999", "0,0", "true", "0&traces=none"):
                with self.subTest(value=value):
                    response = self.request("/api/return-analysis/presentation", method="POST", role="member",
                                            overrides={"QUERY_STRING": query + "&traces=" + value})
                    self.assertEqual(response["status"], 400)
        many = sample_report()
        source = many["returns"][0]
        many["returns"] = [{**source, "sector": index + 1, "days_out": index + 1} for index in range(7)]
        many["returns_count"] = 7
        many["return_sectors_count"] = 7
        many_query = "unit=PPT&front=02&min_gap=1&digest=" + report_digest(many)
        with patch("backend.controllers.application_controller._analyze_return_request", return_value=many):
            response = self.request("/api/return-analysis/presentation", method="POST", role="member",
                                    overrides={"QUERY_STRING": many_query + "&traces=0,1,2,3,4,5,6"})
            self.assertEqual(response["status"], 200, response["body"] if response["status"] != 200 else "")
        page = self.request("/retornos", role="member")["body"]
        self.assertIn('id="return-trace-options"', page)
        self.assertIn("PowerPoint", page)

    def test_soil_wet_routes_require_auth_and_import_respects_origin_and_unit(self):
        from tests.test_return_analysis_integration import SOIL_HEADERS, soil_row, xlsx
        route = "/api/return-analysis/soil-wet/import"
        self.assertEqual(self.request("/api/return-analysis/soil-wet")["status"], 401)
        self.assertEqual(self.request(route, method="POST")["status"], 401)
        with patch("backend.controllers.application_controller.parse_soil_wet_file") as parse:
            self.assertEqual(self.request(route, method="POST", role="member", overrides={"HTTP_ORIGIN": "https://untrusted.invalid"})["status"], 403)
            parse.assert_not_called()
        self.assertEqual(self.request("/api/return-analysis/soil-wet", role="member", overrides={"QUERY_STRING": "unit=BAD"})["status"], 400)

        def upload(unit_in_file, selected="NRD"):
            boundary = "soil-upload"
            body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="solo.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'.encode()
                    + xlsx([SOIL_HEADERS, soil_row(unit=unit_in_file)]) + f'\r\n--{boundary}--\r\n'.encode())
            return self.request(route, method="POST", role="member", overrides={
                "QUERY_STRING": "unit=" + selected, "CONTENT_TYPE": "multipart/form-data; boundary=" + boundary,
                "CONTENT_LENGTH": str(len(body)), "wsgi.input": io.BytesIO(body),
            })

        self.assertEqual(upload("PPT")["status"], 400)
        self.assertEqual(self.db.get_return_soil_wet_summary("NRD")["records"], 0)
        imported = upload("NRD")
        self.assertEqual(imported["status"], 200, imported["body"])
        self.assertEqual(json.loads(imported["body"])["imported"]["inserted"], 1)
        self.assertEqual(json.loads(upload("NRD")["body"])["imported"]["unchanged"], 1)
        summary = self.request("/api/return-analysis/soil-wet", role="member", overrides={"QUERY_STRING": "unit=NRD"})
        self.assertEqual(json.loads(summary["body"])["summary"]["records"], 1)
        page = self.request("/retornos", role="member")["body"]
        for identifier in ("return-soil-wet-import", "return-soil-wet-file", "return-confirmed-soil-wet-body", "return-generate-presentation"):
            self.assertIn(f'id="{identifier}"', page)

    def test_pages_share_layout_and_assets_exist(self):
        for path in ("/", "/sacarose", "/setores", "/relatorios", "/retornos", "/historico", "/usuarios", "/emitir-posicao-global"):
            with self.subTest(path=path):
                response = self.request(path, role="admin")
                self.assertEqual(response["status"], 200)
                self.assertEqual(response["headers"]["Cache-Control"], "no-store")
                self.assertIn('aria-label="Navegação principal"', response["body"])
                self.assertEqual(response["body"].count('aria-current="page"'), 1)
                self.assertNotIn("{%", response["body"])
                parser = PageParser()
                parser.feed(response["body"])
                self.assertEqual(len(parser.ids), len(set(parser.ids)), "IDs duplicados")
                for asset in parser.assets:
                    self.assertTrue((config.STATIC_DIR / asset.lstrip("/")).is_file(), asset)
                    self.assertEqual(self.request(asset, role="admin")["status"], 200)

    def test_sidebar_and_unit_selector_have_no_gradients(self):
        base = (config.STATIC_DIR / "css/base.css").read_text(encoding="utf-8")
        dashboard = (config.STATIC_DIR / "css/dashboard.css").read_text(encoding="utf-8")
        self.assertIn("--nav-background: #234f3d;", base)
        self.assertRegex(base, r"\.app-navbar\s*\{[^}]*background:\s*var\(--nav-background\)")
        for selector, declarations in re.findall(r"([^{}]+)\{([^{}]*)\}", base + dashboard):
            if any(name in selector for name in (".app-navbar", ".nav-", ".unit-selector")):
                self.assertNotIn("gradient(", declarations, selector.strip())

    def test_each_page_only_loads_its_module(self):
        for path, required, excluded in (
            ("/", 'id="operation-form"', 'id="excel-report-form"'),
            ("/setores", 'id="sector-base-import-form"', 'id="operation-form"'),
            ("/historico", 'id="history-list"', 'id="sector-base-list"'),
            ("/usuarios", 'id="users-list"', 'id="sector-base-list"'),
            ("/relatorios", 'id="excel-report-form"', 'id="return-analysis-form"'),
            ("/retornos", 'id="return-analysis-form"', 'id="excel-report-form"'),
            ("/sacarose", 'id="sacarose-form"', 'id="operation-form"'),
            ("/producao", 'id="production-entry-form"', 'id="sacarose-form"'),
        ):
            with self.subTest(path=path):
                html = self.request(path, role="admin")["body"]
                self.assertIn(required, html)
                self.assertNotIn(excluded, html)

    def test_management_pages_use_standard_page_layout(self):
        for path in ('/historico', '/setores', '/usuarios'):
            with self.subTest(path=path):
                html = self.request(path, role='admin')['body']
                self.assertIn('class="module-standard-page ', html)
                self.assertIn('class="module-standard-header ', html)
                self.assertNotIn('module-page-card', html)
        history = self.request('/historico', role='admin')['body']
        self.assertIn('id="history-pagination"', history)
        self.assertNotIn('history-unit-filter', history)

    def test_sidebar_uses_shared_alignment(self):
        css = (config.STATIC_DIR / "css/base.css").read_text(encoding="utf-8")
        self.assertIn('--nav-item-inset: 12px;', css)
        self.assertIn('--nav-item-gap: 12px;', css)
        for selector in ('.nav-unit-selector-label', '.report-unit-button', '.nav-link', '.nav-logout', '.nav-user-greeting'):
            blocks = re.findall(re.escape(selector) + r'\s*\{([^}]+)\}', css)
            self.assertTrue(blocks, selector)
            self.assertTrue(any('var(--nav-item-inset)' in block for block in blocks), selector)

    def test_action_buttons_share_centered_layout(self):
        css = (config.STATIC_DIR / "css/base.css").read_text(encoding="utf-8")
        selector = ':where(button:not(.nav-link):not(.nav-logout):not(.report-unit-button), .modal-button, .excel-page-back)'
        declarations = re.search(re.escape(selector) + r'\s*\{([^}]+)\}', css)
        self.assertIsNotNone(declarations)
        for declaration in ('display: inline-flex;', 'align-items: center;', 'justify-content: center;', 'text-align: center;'):
            self.assertIn(declaration, declarations.group(1))
        html = self.request('/usuarios', role='admin')["body"]
        self.assertIn('id="open-user-create"', html)
        self.assertIn('id="user-create-modal"', html)
        self.assertIn('id="create-user-button"', html)

    def test_trace_picker_resets_global_input_size_and_contains_long_content(self):
        css = (config.STATIC_DIR / "css/retornos.css").read_text(encoding="utf-8")

        def declarations(selector):
            block = re.search(re.escape(selector) + r'\s*\{([^}]+)\}', css)
            self.assertIsNotNone(block, selector)
            return block.group(1)

        checkbox = declarations('.return-trace-list input[type="checkbox"]')
        for value in ('width: 16px;', 'height: 16px;', 'padding: 0;'):
            self.assertIn(value, checkbox)
        footer = declarations('.return-presentation-footer')
        self.assertIn('grid-template-columns: minmax(0, 1fr);', footer)
        self.assertIn('max-width: 100%;', footer)
        self.assertIn('min-width: 0;', footer)
        label = declarations('.return-trace-list label')
        self.assertIn('grid-template-columns: 16px minmax(0, 1fr);', label)
        self.assertIn('overflow-wrap: anywhere;', declarations('.return-trace-list label > span'))
        self.assertIn('max-height: 200px;', declarations('.return-trace-list'))
        self.assertIn('overflow-y: auto;', declarations('.return-trace-list'))
        self.assertIn('.return-trace-list { grid-template-columns: 1fr; }', css)
        page = self.request('/retornos', role='member')['body']
        self.assertRegex(page, r'/css/retornos\.css\?v=[A-Za-z0-9_-]+')

    def test_script_dependencies_and_styles_are_scoped(self):
        expected = {
            "/": ["common.js", "export.js", "app.js"],
            "/sacarose": ["common.js", "export.js", "sacarose.js"],
            "/producao": ["common.js", "production-consolidation.js", "producao.js"],
            "/emitir-posicao-global": ["common.js", "export.js", "production-consolidation.js", "production-export.js", "emissao.js"],
            "/setores": ["common.js", "setores.js"],
            "/relatorios": ["common.js", "relatorios.js"],
            "/retornos": ["common.js", "return-analysis.js"],
            "/historico": ["common.js", "historico.js"],
            "/usuarios": ["common.js", "usuarios.js"],
        }
        for path, scripts in expected.items():
            with self.subTest(path=path):
                parser = PageParser()
                parser.feed(self.request(path, role="admin")["body"])
                self.assertEqual([Path(asset).name for asset in parser.assets if asset.startswith("/js/")], scripts)
                self.assertIn("/css/base.css", parser.assets)
                self.assertNotIn("/css/style.css", parser.assets)


    def test_production_page_respects_user_units_and_exposes_popup_workflow(self):
        self.assertEqual(self.request("/producao", role="member")["status"], 403)
        self.assertEqual(self.request("/api/production/catalog", role="member", overrides={"QUERY_STRING": "unit=NRD"})["status"], 403)

        user = self.db.create_user(
            "ProductionAnalyst", "Production-pass-42", role="analyst", base_unit="NRD",
            production_access={
                "enabled": True,
                "permissions": {"fill": True},
                "units": ["NRD", "PPT"],
            },
        )
        cookie = f"{config.SESSION_COOKIE}={self.db.create_session(user['id'])}"
        page = self.request("/producao", cookie=cookie)
        self.assertEqual(page["status"], 200)
        for marker in (
            'id="production-entry-modal"', 'id="production-entry-form"',
            'id="production-status-options"', 'id="production-status-config-toggle"',
            'id="production-status-config-pane"', 'id="production-config-pane"',
            'id="production-front-form"', 'id="production-items-body"',
        ):
            self.assertIn(marker, page["body"])
        self.assertIn('href="/producao"', page["body"])

        emission = self.request('/emitir-posicao-global', cookie=cookie)["body"]
        self.assertIn('id="emit-global-production"', emission)
        self.assertIn('/js/production-export.js', emission)

        access = json.loads(self.request("/api/production/access", cookie=cookie)["body"])["access"]
        self.assertEqual(access["units"], ["PPT", "NRD"])
        self.assertTrue(access["permissions"]["fill"])
        self.assertEqual(self.request("/api/production/catalog", cookie=cookie, overrides={"QUERY_STRING": "unit=RBR"})["status"], 403)

    def test_users_page_denies_non_admin_direct_access(self):
        self.assertEqual(self.request("/usuarios", role="member")["status"], 403)
        self.assertEqual(self.request("/usuarios/cadastro", role="member")["status"], 403)
        for path in ("/", "/sacarose", "/setores", "/relatorios", "/retornos", "/historico"):
            html = self.request(path, role="member")["body"]
            self.assertNotIn('href="/usuarios"', html)
            self.assertNotIn('href="/usuarios/cadastro"', html)
            self.assertNotIn('id="users-toggle"', html)
            self.assertNotIn('id="users-flyout"', html)

    def test_admin_users_navigation_is_single_page_and_legacy_link_redirects(self):
        html = self.request('/usuarios', role='admin')["body"]
        self.assertIn('href="/usuarios" aria-current="page"', html)
        self.assertNotIn('users-flyout', html)
        self.assertNotIn('href="/usuarios/cadastro"', html)
        self.assertIn('id="user-create-modal" class="modal-backdrop" hidden', html)
        self.assertIn('id="quick-user-form"', html)
        self.assertIn('id="users-list"', html)
        self.assertIn('id="user-access-modal"', html)
        self.assertEqual(html.count('id="quick-user-form"'), 1)
        legacy = self.request('/usuarios/cadastro', role='admin')
        self.assertEqual(legacy['status'], 302)
        self.assertEqual(legacy['headers']['Location'], '/usuarios?novo=1')

    def test_backup_feature_is_removed(self):
        self.assertEqual(self.request("/api/backup", role="admin", method="POST")["status"], 404)
        self.assertNotIn("create-backup", self.request("/historico", role="admin")["body"])
        self.assertFalse((config.DATA_DIR / "backups").exists())

    def test_user_registration_exposes_profiles_and_optional_email(self):
        html = self.request('/usuarios', role='admin')['body']
        for element_id in ('quick-user-role', 'quick-user-email', 'quick-user-base-unit', 'quick-user-active'):
            self.assertIn(f'id="{element_id}"', html)
        self.assertNotIn('<option value="admin">', html)
        for role, label in (('coordinator', 'Coordenador'), ('analyst', 'Analista')):
            self.assertRegex(html, f'<option value="{role}"[^>]*>{label}</option>')
        for unit in ('PPT','NRD','RBR','PST'):
            self.assertIn(f'<option value="{unit}">', html)
        self.assertIn('type="email"', html)
        self.assertIn('(opcional)', html)

    def test_registered_users_have_standard_access_modal(self):
        html = self.request('/usuarios', role='admin')['body']
        self.assertIn('id="user-access-modal" class="modal-backdrop" hidden', html)
        self.assertIn('role="dialog" aria-modal="true"', html)
        self.assertIn('id="user-access-form"', html)
        self.assertIn('form="user-access-form"', html)
        self.assertNotIn('Histórico de acesso', html)

    def test_role_profiles_are_enforced_by_pages_and_apis_without_unit_restrictions(self):
        for role in ('admin', 'coordinator', 'analyst'):
            profile = {
                'name': 'ApiLevel-' + role, 'password': 'Profile-pass-42', 'role': role,
                'base_unit': 'RBR', 'email': role + '@example.com', 'is_active': True,
            }
            response = self.request('/api/users', role='admin', method='POST', body=profile)
            if role == 'admin':
                self.assertEqual(response['status'], 403)
                self.assertIsNone(self.db.authenticate_user(profile['name'], profile['password']))
                # Criação privilegiada é permitida apenas fora das rotas web.
                created = self.db.create_user(profile['name'], profile['password'], role=role,
                                              base_unit='RBR', email=profile['email'])
            else:
                self.assertEqual(response['status'], 201)
                created = json.loads(response['body'])['user']
            self.assertEqual((created['role'], created['base_unit'], created['email']), (role, 'RBR', role + '@example.com'))
            self.assertNotIn('password_hash', created)
            login = self.request('/api/auth/login', method='POST', body={'name': created['name'], 'password': 'Profile-pass-42'})
            self.assertEqual(login['status'], 200)
            self.assertEqual(json.loads(login['body'])['user']['base_unit'], 'RBR')
            cookie = login['headers']['Set-Cookie'].split(';', 1)[0]
            html = self.request('/', cookie=cookie)['body']
            self.assertIn('data-user-base-unit="RBR"', html)
            self.assertEqual('href="/usuarios"' in html, role == 'admin')
            for page in ('/', '/sacarose', '/relatorios', '/retornos', '/emitir-posicao-global'):
                self.assertEqual(self.request(page, cookie=cookie)['status'], 200)
            data = json.loads(self.request('/api/units', cookie=cookie)['body'])
            self.assertEqual({unit['code'] for unit in data['units']}, {'PPT','NRD','RBR','PST'})
            if role == 'admin':
                self.assertEqual(self.request('/usuarios/cadastro', cookie=cookie)['status'], 302)
                self.assertEqual(self.request('/api/users', cookie=cookie)['status'], 200)
            else:
                for page in ('/usuarios', '/usuarios/cadastro', '/api/users'):
                    self.assertEqual(self.request(page, cookie=cookie)['status'], 403)
                self.assertEqual(self.request('/api/users', cookie=cookie, method='POST', body={
                    'name':'Escalation-' + role, 'password':'Profile-pass-42', 'role':'admin',
                })['status'], 403)
                for path, method, body in (
                    (f"/api/users/{self.admin['id']}/active", 'PUT', {'is_active':False}),
                    (f"/api/users/{self.admin['id']}/password", 'PUT', {'password':'Profile-pass-42'}),
                    (f"/api/users/{self.admin['id']}", 'DELETE', {}),
                ):
                    self.assertEqual(self.request(path, cookie=cookie, method=method, body=body)['status'], 403)

    def test_users_api_validates_profile_fields_and_active_status(self):
        for invalid in ({'role':'super-admin'}, {'role':[]}, {'base_unit':'XXX'},
                        {'email':'invalid'}, {'email':None}, {'is_active':'false'}):
            response = self.request('/api/users', role='admin', method='POST', body={
                'name':'InvalidApiProfile', 'password':'Profile-pass-42', **invalid,
            })
            self.assertEqual(response['status'], 400, invalid)
        self.assertEqual(self.request('/api/users', method='POST', body={})['status'], 401)
        created = json.loads(self.request('/api/users', role='admin', method='POST', body={
            'name':'ApiInactive', 'password':'Profile-pass-42', 'role':'analyst',
            'base_unit':'PST', 'is_active':False,
        })['body'])['user']
        user_id = created['id']
        self.assertFalse(created['is_active'])
        credentials = {'name':created['name'], 'password':'Profile-pass-42'}
        self.assertEqual(self.request('/api/auth/login', method='POST', body=credentials)['status'], 401)
        self.assertEqual(self.request(f'/api/users/{user_id}/active', role='admin', method='PUT', body={'is_active':True})['status'], 200)
        login = self.request('/api/auth/login', method='POST', body=credentials)
        self.assertEqual(login['status'], 200)
        cookie = login['headers']['Set-Cookie'].split(';', 1)[0]
        self.assertEqual(self.request('/api/auth/me', cookie=cookie)['status'], 200)
        self.assertEqual(self.request(f'/api/users/{user_id}/active', role='admin', method='PUT', body={'is_active':False})['status'], 200)
        self.assertEqual(self.request('/api/auth/me', cookie=cookie)['status'], 401)
        self.assertEqual(self.request(f"/api/users/{self.admin['id']}/active", role='admin', method='PUT', body={'is_active':False})['status'], 400)

    def test_admins_only_see_their_own_admin_account_and_cannot_mutate_other_admins(self):
        other = self.db.create_user('HiddenAdmin', 'Hidden-admin-pass-42', role='admin', email='hidden-admin@example.com')
        inactive = self.db.create_user('HiddenInactiveAdmin', 'Hidden-admin-pass-42', role='admin', is_active=False)
        token = self.db.create_session(other['id'])
        cookie = f"{config.SESSION_COOKIE}={token}"
        for role, own_id, cookies in (('admin', self.admin['id'], None), (None, other['id'], cookie)):
            response = self.request('/api/users', role=role, cookie=cookies)
            self.assertEqual(response['status'], 200)
            visible = json.loads(response['body'])['users']
            self.assertEqual([u['id'] for u in visible if u['role']=='admin'], [own_id])
            self.assertIn(self.member['id'], {u['id'] for u in visible})
            self.assertNotIn('HiddenInactiveAdmin', response['body'])
            if role == 'admin':
                self.assertNotIn('HiddenAdmin', response['body'])
                self.assertNotIn('hidden-admin@example.com', response['body'])
        # Parâmetros enviados pelo cliente não podem escolher o administrador visível.
        forged = self.request('/api/users', role='admin', overrides={'QUERY_STRING': f'current_user_id={other["id"]}&role=admin'})
        self.assertNotIn('HiddenAdmin', forged['body'])
        for hidden in (other, inactive):
            for suffix, method, body in (
                ('/active','PUT',{'is_active':False}),
                ('/active','PUT',{'is_active':True}),
                ('/password','PUT',{'password':'Changed-pass-42'}),
                ('','DELETE',{}),
            ):
                response = self.request(f'/api/users/{hidden["id"]}{suffix}', role='admin', method=method, body=body)
                self.assertEqual(response['status'], 400)
                self.assertEqual(json.loads(response['body'])['error'], 'Usuário não encontrado.')
        self.assertEqual(self.db.get_user_by_session(token)['id'], other['id'])
        self.assertIsNotNone(self.db.authenticate_user(other['name'], 'Hidden-admin-pass-42'))
        self.assertFalse(next(u for u in self.db.list_users(inactive['id']) if u['id']==inactive['id'])['is_active'])

    def test_navigation_reports_unit_filter_and_footer(self):
        for path in ("/", "/sacarose", "/relatorios", "/retornos", "/setores", "/emitir-posicao-global"):
            html = self.request(path, role="member")["body"]
            parser = PageParser()
            parser.feed(html)
            self.assertEqual(parser.ids.count("report-unit"), 1)
            sidebar = html.split('aria-label="Navegação principal"', 1)[1].split('</nav>', 1)[0]
            self.assertEqual(sidebar.count('class="nav-brand"'), 1)
            self.assertLess(sidebar.index('class="nav-brand"'), sidebar.index('class="nav-unit-selector"'))
            self.assertLess(sidebar.index('class="nav-unit-selector"'), sidebar.index('class="nav-actions"'))
            self.assertLess(sidebar.index('class="nav-actions"'), sidebar.index('class="nav-user"'))
            footer = sidebar.split('class="nav-user"', 1)[1]
            self.assertNotIn('class="nav-brand"', footer)
            for element_id in ('greeting', 'today', 'current-time', 'logout-button'):
                self.assertIn(f'id="{element_id}"', footer)
            self.assertIn('class="menu-icon"', footer)
            self.assertIn('</svg><span>Emissão Global</span>', html)
            self.assertIn('</svg><span>Cadastro de Setores</span>', html)
            self.assertIn('</svg><span>Sair</span>', footer)
            self.assertNotIn('<select id="report-unit"', html)
            self.assertEqual(re.findall(r'data-report-unit="([A-Z]+)"', html), ['PPT', 'NRD', 'RBR', 'PST'])
            self.assertNotIn('<details class="nav-report-group"', html)
            self.assertRegex(html, r'id="reports-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="reports-flyout"')
            self.assertRegex(html, r'id="reports-flyout"[^>]*\bhidden\b')
            self.assertNotIn("COA · COCAL · SAFRA 2026", html)
            self.assertNotIn("Segurança · Qualidade · Pessoas · Resultados", html)
            self.assertIn('href="/emitir-posicao-global"', html)
            self.assertIn("Cadastro de Setores", html)
            group = html.split('<nav id="reports-flyout"', 1)[1].split('</nav>', 1)[0]
            self.assertNotIn('reports-close', group)
            self.assertNotIn('Fechar menu de relatórios', group)
            for label in ("Produtividade por frota e operador", "Análise de mudanças de área"):
                self.assertIn(label, group)
            for removed in ("Posição de Campo", "Sacarose", "Emissão Global"):
                self.assertNotIn(f'<span>{removed}</span>', group)
            self.assertRegex(html, r'id="ctt-toggle"[^>]*aria-controls="ctt-flyout"')
            ctt = html.split('<nav id="ctt-flyout"', 1)[1].split('</nav>', 1)[0]
            for label in ("Posição de Campo", "Sacarose"):
                self.assertIn(f'<span>{label}</span>', ctt)
            self.assertNotIn('Produtividade por frota e operador', ctt)
            self.assertNotIn('>Painel</a>', html)
        emission = self.request('/emitir-posicao-global', role='member')["body"]
        self.assertIn('id="emit-global-position"', emission)
        self.assertIn('id="emit-global-sacarose"', emission)
        self.assertNotIn('id="emit-global-production"', emission)
        self.assertNotIn('id="operation-form"', emission)
        self.assertNotIn('id="export-unit-image"', self.request('/', role='member')["body"])
        # A emissão individual foi adicionada à Sacarose depois da navegação global.
        self.assertIn('id="export-sacarose-unit"', self.request('/sacarose', role='member')["body"])

    def test_auth_api_uses_users_store_and_creates_valid_session(self):
        response = self.request("/api/auth/login", method="POST", body={"name": "TestAdmin", "password": "Test-password-42"})
        self.assertEqual(response["status"], 200)
        token = response["headers"]["Set-Cookie"].split(";", 1)[0].split("=", 1)[1]
        self.assertEqual(self.db.get_user_by_session(token)["id"], self.admin["id"])
        denied = self.request("/api/auth/login", method="POST", body={"name": "TestAdmin", "password": "wrong-password"})
        self.assertEqual(denied["status"], 401)

    def test_login_and_its_assets_are_public(self):
        response = self.request("/login")
        self.assertEqual(response["status"], 200)
        for removed in ("COCAL", "CONTROLE OPERACIONAL", "As contas são criadas pelo Administrador.",
                        "Usuários autorizados acessam PPT, NRD, RBR e PST.", "atualizada",
                        "Precisa de acesso? Solicite sua conta ao Administrador.", "auth-brand", "auth-agro-"):
            self.assertNotIn(removed, response["body"])
        self.assertIn('class="auth-visual-title">Posição<br />de Campo</h2>', response["body"])
        self.assertIn('<label for="name">Usuário</label>', response["body"])
        self.assertIn('Use seu usuário e senha', response["body"])
        self.assertIn('class="auth-leaf-mark"', response["body"])
        self.assertIn('class="auth-input-icon"', response["body"])
        self.assertIn('/assets/login-field-sunrise-v1.png', response["body"])
        self.assertNotIn('aria-label="Navegação principal"', response["body"])
        self.assertIn('id="remember-me"', response["body"])
        self.assertIn('id="toggle-password"', response["body"])
        self.assertIn('aria-label="Mostrar senha"', response["body"])
        self.assertIn('aria-pressed="false"', response["body"])
        parser = PageParser()
        parser.feed(response["body"])
        for asset in parser.assets:
            self.assertEqual(self.request(asset)["status"], 200, asset)
        photo = self.request("/assets/login-field-sunrise-v1.png")
        self.assertEqual(photo["headers"]["Content-Type"], "image/png")
        self.assertTrue(photo["body"].startswith(b"\x89PNG\r\n\x1a\n"))

    def login(self, *, remember_me=False, cookie=None, overrides=None):
        response = self.request("/api/auth/login", method="POST", body={
            "name": "TestAdmin", "password": "Test-password-42", "remember_me": remember_me,
        }, cookie=cookie, overrides=overrides)
        self.assertEqual(response["status"], 200)
        cookies = SimpleCookie()
        cookies.load(response["headers"]["Set-Cookie"])
        return response, cookies[config.SESSION_COOKIE]

    def test_session_cookie_without_remember_me_and_persistent_cookie_with_it(self):
        from backend.models.storage import auth_connection
        from backend.models.security import token_digest
        for remember, lifetime in ((False, config.SESSION_TTL_SECONDS), (True, config.REMEMBER_SESSION_TTL_SECONDS)):
            with self.subTest(remember=remember):
                response, cookie = self.login(remember_me=remember)
                self.assertEqual(cookie["max-age"], str(lifetime) if remember else "")
                self.assertEqual(cookie["expires"], "")
                self.assertTrue(cookie["httponly"])
                self.assertTrue(cookie["secure"])
                self.assertEqual(cookie["samesite"], "Strict")
                self.assertEqual(cookie["path"], "/")
                self.assertEqual(response["headers"]["Cache-Control"], "no-store")
                self.assertNotIn("password", response["body"])
                with auth_connection() as conn:
                    row = conn.execute("SELECT token_hash, created_at, expires_at FROM sessions WHERE token_hash=?", (token_digest(cookie.value),)).fetchone()
                    self.assertEqual(row["expires_at"] - row["created_at"], lifetime)
                    self.assertNotEqual(row["token_hash"], cookie.value)

    def test_remembered_session_survives_reinitialization_and_logout_revokes_it(self):
        _, cookie = self.login(remember_me=True)
        request_cookie = f"{config.SESSION_COOKIE}={cookie.value}"
        self.db.init_db()
        self.assertEqual(self.request("/api/auth/me", cookie=request_cookie)["status"], 200)
        self.assertEqual(self.request("/login", cookie=request_cookie)["headers"]["Location"], "/")
        logout = self.request("/api/auth/logout", method="POST", cookie=request_cookie)
        self.assertEqual(logout["status"], 200)
        self.assertIn("Max-Age=0", logout["headers"]["Set-Cookie"])
        self.assertIsNone(self.db.get_user_by_session(cookie.value))
        self.assertEqual(self.request("/api/auth/me", cookie=request_cookie)["status"], 401)
        self.assertEqual(self.request("/", cookie=request_cookie)["headers"]["Location"], "/login")

    def test_expired_and_forged_sessions_cannot_access_data(self):
        from backend.models.storage import auth_connection
        from backend.models.security import token_digest
        _, cookie = self.login(remember_me=True)
        with auth_connection() as conn:
            conn.execute("UPDATE sessions SET expires_at=? WHERE token_hash=?", (int(time.time()) - 1, token_digest(cookie.value)))
        for token in (cookie.value, "forged-session"):
            self.assertEqual(self.request("/api/auth/me", cookie=f"{config.SESSION_COOKIE}={token}")["status"], 401)

    def test_new_login_rotates_the_session_and_can_disable_remember_me(self):
        _, old_cookie = self.login(remember_me=True)
        _, new_cookie = self.login(cookie=f"{config.SESSION_COOKIE}={old_cookie.value}")
        self.assertNotEqual(old_cookie.value, new_cookie.value)
        self.assertIsNone(self.db.get_user_by_session(old_cookie.value))
        self.assertIsNotNone(self.db.get_user_by_session(new_cookie.value))
        self.assertEqual(new_cookie["max-age"], "")

    def test_remember_me_requires_a_json_boolean(self):
        for invalid in ("false", "true", 0, 1, None, []):
            response = self.request("/api/auth/login", method="POST", body={
                "name": "TestAdmin", "password": "Test-password-42", "remember_me": invalid,
            })
            self.assertEqual(response["status"], 400)
            self.assertNotIn("Set-Cookie", response["headers"])

    def test_http_local_and_https_proxy_login_cookies(self):
        _, cookie = self.login(overrides={"wsgi.url_scheme": "http"})
        self.assertFalse(cookie["secure"])
        _, cookie = self.login(overrides={"wsgi.url_scheme": "http", "HTTP_X_FORWARDED_PROTO": "https"})
        self.assertTrue(cookie["secure"])

    def test_cross_site_login_is_rejected(self):
        response = self.request("/api/auth/login", method="POST", body={
            "name": "TestAdmin", "password": "Test-password-42", "remember_me": True,
        }, overrides={"HTTP_ORIGIN": "https://untrusted.invalid"})
        self.assertEqual(response["status"], 403)
        self.assertNotIn("Set-Cookie", response["headers"])

    def test_deactivation_and_password_reset_revoke_remembered_sessions(self):
        member = self.db.create_user("RememberedUser", "Remembered-pass-42")
        token = self.db.create_session(member["id"], remember_me=True)
        self.db.set_user_active(member["id"], False, self.admin["id"])
        self.assertIsNone(self.db.get_user_by_session(token))
        with self.assertRaises(ValueError):
            self.db.create_session(member["id"], remember_me=True)
        self.db.set_user_active(member["id"], True, self.admin["id"])
        token = self.db.create_session(member["id"], remember_me=True)
        self.db.reset_user_password(member["id"], "Reset-password-42", self.admin["id"])
        self.assertIsNone(self.db.get_user_by_session(token))
        self.assertIsNone(self.db.authenticate_user("RememberedUser", "Remembered-pass-42"))
        self.assertIsNotNone(self.db.authenticate_user("RememberedUser", "Reset-password-42"))

    def test_template_escapes_user_values(self):
        from backend.views.templates import render_template
        html = render_template("index.html", user={"id": 1, "role": "user", "name": '<script>alert("x")</script>'}, page="dashboard").decode()
        self.assertNotIn('<script>alert("x")</script>', html)
        self.assertIn("&lt;script&gt;", html)

    def test_template_and_source_files_are_not_public(self):
        for path in ("/templates/base.html", "/base.html", "/css/../../backend/config.py", "/css/../js/common.js"):
            self.assertEqual(self.request(path, role="admin")["status"], 404, path)


    def test_module_permissions_enforced_on_pages_and_direct_api_calls(self):
        from backend.models.module_access import MODULES
        permissions = {item['key']: {'view': False, 'edit': False} for item in MODULES}
        permissions['sacarose']['view'] = True
        response = self.request('/api/users', role='admin', method='POST', body={
            'name': 'OnlyReadSacarose', 'password': 'Test-password-42', 'role': 'analyst',
            'module_access': permissions,
            'production_access': {'enabled': False, 'permissions': {'fill': False}, 'units': []},
        })
        self.assertEqual(response['status'], 201, response['body'])
        created = json.loads(response['body'])['user']
        cookie = f"{config.SESSION_COOKIE}={self.db.create_session(created['id'])}"
        self.assertEqual(self.request('/sacarose', cookie=cookie)['status'], 200)
        self.assertEqual(self.request('/', cookie=cookie)['status'], 403)
        self.assertEqual(self.request('/setores', cookie=cookie)['status'], 403)
        self.assertEqual(self.request('/retornos', cookie=cookie)['status'], 403)
        self.assertEqual(self.request('/emitir-posicao-global', cookie=cookie)['status'], 200)  # emissão livre para analistas
        self.assertEqual(self.request('/api/sacarose', cookie=cookie)['status'], 200)
        self.assertEqual(self.request('/api/sacarose', cookie=cookie, method='POST')['status'], 403)
        self.assertEqual(self.request('/api/units', cookie=cookie)['status'], 200)  # dados necessários à emissão global
        self.assertEqual(self.request('/api/units/meta', cookie=cookie)['status'], 200)  # revisões sem dados de campo
        self.assertEqual(self.request('/api/sector-base', cookie=cookie)['status'], 200)  # base para leitura
        self.assertEqual(self.request('/api/sector-base', cookie=cookie, method='POST')['status'], 403)
        self.assertEqual(self.request('/api/return-analysis/layouts', cookie=cookie)['status'], 403)
        self.assertEqual(self.request('/api/units/PPT', cookie=cookie, method='PUT')['status'], 403)
        login = self.request('/api/auth/login', method='POST', body={
            'name':'OnlyReadSacarose', 'password':'Test-password-42'
        })
        self.assertEqual(json.loads(login['body'])['landing_page'], '/sacarose')

    def test_modules_and_production_are_saved_atomically_and_reject_invalid_escalations(self):
        from backend.models.module_access import MODULES
        permissions = {item['key']: {'view': False, 'edit': False} for item in MODULES}
        target = self.db.create_user('AccessManagedAnalyst', 'Test-password-42')
        path = f"/api/users/{target['id']}/access"
        access = {'modules': permissions, 'production': {'enabled': True, 'permissions': {
            'fill': False, 'configure': False
        }, 'units': ['PPT']}}
        response = self.request(path, role='admin', method='PUT', body={'access': access})
        self.assertEqual(response['status'], 200, response['body'])
        self.assertFalse(json.loads(self.request(path, role='admin')['body'])['access']['modules']['dashboard']['view'])
        # Configuração de catálogo compartilhado não pode escapar para outras unidades.
        invalid = {'modules': {**permissions, 'dashboard': {'view': True, 'edit': True}},
                   'production': {'enabled': True, 'permissions': {'fill': True, 'configure': True},
                                  'units': ['PPT']}}
        self.assertEqual(self.request(path, role='admin', method='PUT', body={'access': invalid})['status'], 400)
        stored = json.loads(self.request(path, role='admin')['body'])['access']
        self.assertFalse(stored['modules']['dashboard']['view'])
        self.assertFalse(stored['production']['permissions']['configure'])
        self.assertEqual(self.request(path, role='member')['status'], 403)
        self.assertEqual(self.request(path, role='member', method='PUT', body={'access': access})['status'], 403)
        invalid_modules = {**permissions, 'dashboard': {'view': False, 'edit': True}}
        self.assertEqual(self.request(path, role='admin', method='PUT', body={
            'access': {'modules': invalid_modules, 'production': access['production']}
        })['status'], 400)
        access['production']['units'] = ['PPT','NRD','RBR','PST']
        access['production']['permissions']['configure'] = True
        response = self.request(path, role='admin', method='PUT', body={'access': access})
        self.assertEqual(response['status'], 200, response['body'])
        self.assertTrue(json.loads(response['body'])['access']['production']['permissions']['configure'])

    def test_production_unit_permissions_are_enforced_by_http_routes(self):
        from backend.models.module_access import MODULES
        modules = {spec["key"]: {"view": False, "edit": False} for spec in MODULES}
        created = self.db.create_user(
            "UnitMatrixAnalyst", "Test-password-42", role="analyst", base_unit="PPT",
            module_access=modules,
            production_access={"enabled": True, "unit_permissions": {
                "PPT": {"view": True, "fill": False, "summary": True},
                "NRD": {"view": True, "fill": True, "summary": False},
            }},
        )
        cookie = f"{config.SESSION_COOKIE}={self.db.create_session(created['id'])}"
        self.assertEqual(self.request('/emitir-posicao-global', cookie=cookie)['status'], 200)
        for unit, expected_fill in (("PPT", False), ("NRD", True)):
            response = self.request('/api/production/my-items', cookie=cookie, overrides={
                'QUERY_STRING': f'unit={unit}&date=2026-10-16'
            })
            self.assertEqual(response['status'], 200, response['body'])
            self.assertEqual(json.loads(response['body'])['permissions']['fill'], expected_fill)
        self.assertEqual(self.request('/api/production/my-items', cookie=cookie, overrides={
            'QUERY_STRING': 'unit=PST&date=2026-10-16'
        })['status'], 403)
        summary_path = '/api/production/daily-summary'
        update = {"unit_code": "PPT", "work_date": "2026-10-16", "changes": "Autorizado"}
        self.assertEqual(self.request(summary_path, cookie=cookie, method="PUT", body=update)['status'], 200)
        update['unit_code'] = 'NRD'
        self.assertEqual(self.request(summary_path, cookie=cookie, method="PUT", body=update)['status'], 403)
        update['unit_code'] = 'PST'
        self.assertEqual(self.request(summary_path, cookie=cookie, method="PUT", body=update)['status'], 403)

    def test_ctt_report_independent_permissions_and_seven_access_sections(self):
        from backend.models.module_access import MODULES
        modules = {spec["key"]: {"view": False, "edit": False} for spec in MODULES}
        modules["sacarose"] = {"view": True, "edit": False}
        modules["returns"] = {"view": True, "edit": False}
        analyst = self.db.create_user('CTTOnlyAnalyst', 'Strong-password-42', role='analyst', module_access=modules)
        cookie = f"{config.SESSION_COOKIE}={self.db.create_session(analyst['id'])}"
        self.assertEqual(self.request('/sacarose', cookie=cookie)['status'], 200)
        self.assertEqual(self.request('/', cookie=cookie)['status'], 403)
        self.assertEqual(self.request('/relatorios', cookie=cookie)['status'], 403)
        self.assertEqual(self.request('/retornos', cookie=cookie)['status'], 200)
        self.assertEqual(self.request('/api/sacarose', cookie=cookie)['status'], 200)
        self.assertEqual(self.request('/api/units/sync', cookie=cookie, method='POST')['status'], 403)
        self.assertEqual(self.request('/api/users', cookie=cookie)['status'], 403)
        self.assertEqual(self.request('/emitir-posicao-global', cookie=cookie)['status'], 200)
        nav = self.request('/sacarose', cookie=cookie)['body']
        self.assertIn('id="ctt-toggle"', nav)
        self.assertIn('id="reports-toggle"', nav)
        self.assertNotIn('href="/relatorios"', nav)
        self.assertNotIn('href="/" data-unit-context', nav)
        page = self.request('/usuarios', role='admin')['body']
        for key in ('reports', 'ctt', 'production', 'emission', 'sectors', 'history', 'users'):
            self.assertEqual(page.count(f'data-permission-target="{key}"'), 2)
            self.assertEqual(page.count(f'data-permission-panel="{key}"'), 2)
        self.assertIn('data-user-step="identity"', page)
        self.assertIn('data-user-step="permissions"', page)
        self.assertIn('data-permission-picker', page)
        self.assertNotIn('user-access-accordion', page)
        self.assertNotIn('data-module-view="emission"', page)
        self.assertEqual(page.count('data-module-view="users"'), 2)
        self.assertEqual(page.count('data-module-edit="users"'), 2)

    def test_delegated_users_are_limited_and_cannot_escalate(self):
        from backend.models.module_access import MODULES
        none = {spec["key"]: {"view": False, "edit": False} for spec in MODULES}
        delegate = dict(none)
        delegate['users'] = {"view": True, "edit": True}
        delegate['sacarose'] = {"view": True, "edit": False}
        manager = self.db.create_user('DelegatedManager', 'Strong-password-42', role='analyst', module_access=delegate)
        cookie = f"{config.SESSION_COOKIE}={self.db.create_session(manager['id'])}"
        observer = {**none, 'users': {"view": True, "edit": False}}
        viewer = self.db.create_user('ReadOnlyManager', 'Strong-password-42', role='analyst', module_access=observer)
        view_cookie = f"{config.SESSION_COOKIE}={self.db.create_session(viewer['id'])}"
        self.assertEqual(self.request('/usuarios', cookie=view_cookie)['status'], 200)
        self.assertEqual(self.request('/api/users', cookie=view_cookie)['status'], 200)
        viewer_page = self.request('/usuarios', cookie=view_cookie)['body']
        self.assertNotIn('id="open-user-create"', viewer_page)
        self.assertEqual(self.request(f"/api/users/{manager['id']}/access", cookie=view_cookie)['status'], 200)
        self.assertEqual(self.request(f"/api/users/{manager['id']}/access", cookie=view_cookie, method='PUT',
            body={'access': {'modules': observer, 'production': {'enabled': False}}})['status'], 403)
        self.assertEqual(self.request('/api/users', cookie=view_cookie, method='POST', body={})['status'], 403)
        self.assertEqual(self.request('/api/users', cookie=cookie)['status'], 200)
        permitted = {'name': 'NewDelegate', 'password': 'Strong-password-42', 'role': 'analyst',
                     'module_access': delegate, 'production_access': {'enabled': False}}
        self.assertEqual(self.request('/api/users', cookie=cookie, method='POST', body=permitted)['status'], 201)
        forbidden = {**permitted, 'name': 'AttemptEscalation',
                     'module_access': {**delegate, 'dashboard': {'view': True, 'edit': True}}}
        self.assertEqual(self.request('/api/users', cookie=cookie, method='POST', body=forbidden)['status'], 403)
        self.assertEqual(self.request('/api/users', cookie=cookie, method='POST', body={**permitted, 'name': 'NoProduction',
            'production_access': {'enabled': True, 'units': ['PPT'], 'permissions': {'view': True, 'fill': True}}})['status'], 403)
        self.assertEqual(self.request(f"/api/users/{self.admin['id']}/access", cookie=cookie)['status'], 400)
        self.assertEqual(self.request(f"/api/users/{manager['id']}/access", cookie=cookie, method='PUT',
            body={'access': {'modules': delegate, 'production': {'enabled': False}}})['status'], 403)
        sub = next(item for item in self.db.list_users(self.admin['id']) if item['name'] == 'NewDelegate')
        # Gestores delegados podem editar subordinados dentro do próprio escopo.
        self.assertEqual(self.request(f"/api/users/{sub['id']}/password", cookie=cookie, method='PUT',
            body={'password': 'Different-strong-42'})['status'], 200)
        # Nunca podem excluir contas com autorizações superiores.
        self.assertEqual(self.request(f"/api/users/{self.member['id']}", cookie=cookie, method='DELETE')['status'], 403)
        self.assertEqual(self.request(f"/api/users/{self.member['id']}/active", cookie=cookie, method='PUT',
            body={'is_active': False})['status'], 403)
        self.assertEqual(self.request(f"/api/users/{sub['id']}", cookie=cookie, method='DELETE')['status'], 200)
        self.assertEqual(self.request('/usuarios/cadastro', cookie=cookie)['status'], 302)
        # O endpoint legado deve respeitar as mesmas regras que o endpoint unificado.
        target = self.db.create_user('DelegateTarget', 'Strong-password-42')
        self.assertEqual(self.request(f"/api/users/{target['id']}/production-access", cookie=cookie, method='PUT',
            body={'access': {'enabled': True, 'units': ['PPT'], 'permissions': {'view': True}}})['status'], 403)

    def test_user_permission_controls_are_not_duplicated(self):
        page = self.request('/usuarios', role='admin')
        self.assertEqual(page['status'], 200)
        parser = PageParser()
        parser.feed(page['body'])
        self.assertEqual(len(parser.ids), len(set(parser.ids)))
        self.assertIn('data-module-view="dashboard"', page['body'])
        self.assertIn('data-production-access-configure', page['body'])
        self.assertNotIn('Unidades liberadas', page['body'])
        self.assertEqual(page['body'].count('data-production-unit-row="PPT"'), 2)
        self.assertNotIn('data-module-view="emission"', page['body'])
        self.assertEqual(page['body'].count('data-module-view="dashboard"'), 2)  # cadastro e gestão


if __name__ == "__main__":
    unittest.main()
