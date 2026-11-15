import io
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from xml.sax.saxutils import escape
from zipfile import ZipFile

from backend import config
from backend.models import database as db
from backend.models import module_access
from backend.models import storage, weighings
from backend.models.units import initialize_units
from backend.services.operational_shifts import FIELD_TIMEZONE
from backend.services.weighing_import import parse_weighing_file

HEADER = ["INSTANCIA_ORIGEM", "DT_MOVIMENTO", "NO_LIBERACAO", "CAMINHAO", "JULIETA", "CD_UPNIVEL1",
          "CD_UPNIVEL2", "CD_FREN_TRAN", "QT_LIQUIDO", "ATR", "HR_ENTRADA_PATIO", "HR_ENTRADA_BALANCA",
          "HR_SAIDA_BALANCA", "CD_USUARIO_ENTR"]


def xlsx(rows):
    data = io.BytesIO()
    xml_rows = "".join('<row r="%d">%s</row>' % (number, "".join(
        f'<c r="{chr(65 + index)}{number}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'
        for index, value in enumerate(values))) for number, values in enumerate(rows, 1))
    with ZipFile(data, "w") as archive:
        archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Pesagem" sheetId="1" r:id="rId1"/></sheets></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + xml_rows + '</sheetData></worksheet>')
    return data.getvalue()


def clock(hhmm, day="14/11/2026"):
    """Relógio dos testes: com ``now``, o resumo só conta as horas encerradas até ali."""
    return int(datetime.strptime(f"{day} {hhmm}", "%d/%m/%Y %H:%M").replace(tzinfo=FIELD_TIMEZONE).timestamp())


def load(instance, release, front, level1, level2, kg, out, atr="", patio="14/11/2026 08:00:00"):
    return [instance, "14/11/2026" if out else "", release, "4100586", "4401225", level1, level2, front,
            kg, atr, patio, patio, out, "****"]



# Carga da NRD que passa das 16:00 (fecha a hora 15 nos testes do resumo).
LATE_NRD_LOAD = load("204", "10", "20", "300", "3500", "30000", "14/11/2026 16:05:00", patio="14/11/2026 16:01:00")

class WeighingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        for name, value in {
            "DATA_DIR": root, "AUTH_DB_PATH": root / "usuarios.db",
            "OPERATIONS_DB_PATH": root / "dados.db", "LEGACY_DB_PATH": root / "legacy.db",
        }.items():
            patcher = patch.object(config, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        db.init_db()
        self.admin = db.create_or_update_admin("Admin", "Admin-pass-42")
        fronts = {"PPT": ["02", "05"], "NRD": ["19", "20"], "RBR": ["402", "411"], "PST": ["401", "404"]}
        initialize_units([{"code": code, "rows": [[front, "", "", "EM ATIVIDADE", ""] for front in fronts[code]]}
                          for code in ("PPT", "NRD", "RBR", "PST")], self.admin["id"])

    def file(self):
        return xlsx([HEADER,
            # PPT: frente própria 05 (setor no nível 2) e frente 19 da NRD (recebida).
            load("201", "1", "5", "361", "1173", "36000", "14/11/2026 13:00:00", atr="120"),
            load("201", "2", "5", "361", "1173", "34000", "14/11/2026 15:00:00", atr="130"),
            load("201", "3", "19", "300", "3432", "30000", "14/11/2026 15:30:00", atr="127,91"),
            load("201", "4", "5", "361", "1173", "", ""),  # no pátio
            # PST: setor no nível 1 e seção no nível 2; frente 402 é da RBR.
            load("401", "5", "404", "90428", "1", "32000", "14/11/2026 15:20:00"),
            load("401", "6", "402", "67742", "2", "31000", "14/11/2026 15:35:00"),
            load("999", "7", "1", "1", "1", "1000", "14/11/2026 15:00:00"),  # indústria desconhecida
            load("0402", "9", "411", "90453", "3", "30000", "14/11/2026 15:10:00"),  # "0402" vale como 402 (RBR)
            # NRD: carga que entrou no pátio às 15:40 (o arquivo está completo até aí).
            load("204", "8", "20", "300", "3500", "", "", patio="14/11/2026 15:40:00"),
        ])

    def test_parse_maps_instances_sector_and_section(self):
        parsed = parse_weighing_file(self.file(), "Pasta1.xlsx")
        records = {record["release_no"]: record for record in parsed["records"]}
        self.assertEqual(parsed["ignored_units"], 1)
        self.assertEqual(records["1"]["unit_code"], "PPT")
        self.assertEqual((records["1"]["sector"], records["1"]["section"]), ("1173", ""))
        self.assertEqual(records["5"]["unit_code"], "PST")
        self.assertEqual((records["5"]["sector"], records["5"]["section"]), ("90428", "1"))
        self.assertEqual(records["3"]["atr"], 127.91)
        self.assertIsNone(records["4"]["scale_out_at"])
        self.assertIsNone(records["4"]["net_kg"])
        self.assertEqual(records["1"]["movement_date"], "2026-11-14")

    def test_import_reports_units_dates_and_ignored_instances(self):
        parsed = parse_weighing_file(self.file(), "a.xlsx")
        self.assertEqual(parsed["ignored_instances"], {"999": 1})
        result = weighings.import_weighings(self.admin["id"], parsed["records"])
        self.assertEqual(result["by_unit"], {"PPT": 4, "NRD": 1, "RBR": 1, "PST": 2})
        self.assertEqual(result["dates_by_unit"]["PPT"], {"2026-11-14": 3})
        self.assertEqual(result["dates_by_unit"]["RBR"], {"2026-11-14": 1})

    def test_parse_rejects_missing_columns(self):
        with self.assertRaisesRegex(ValueError, "HR_SAIDA_BALANCA"):
            parse_weighing_file(xlsx([["INSTANCIA_ORIGEM", "NO_LIBERACAO", "CD_FREN_TRAN", "QT_LIQUIDO"]]), "a.xlsx")
        with self.assertRaisesRegex(ValueError, "Excel"):
            parse_weighing_file(b"abc", "a.csv")

    def test_import_replaces_the_whole_base(self):
        records = parse_weighing_file(self.file(), "a.xlsx")["records"]
        first = weighings.import_weighings(self.admin["id"], records, filename="a.xlsx")
        self.assertEqual((first["imported"], first["removed"], first["pending"]), (8, 0, 2))
        # O arquivo seguinte substitui a base inteira: nada do anterior fica guardado.
        pending = next(record for record in records if record["release_no"] == "4")
        pending.update(scale_out_at=pending["patio_at"] + 7 * 3600, net_kg=35000.0, movement_date="2026-11-14")
        second = weighings.import_weighings(self.admin["id"], [pending], filename="b.xlsx")
        self.assertEqual((second["imported"], second["removed"], second["pending"]), (1, 8, 0))
        with storage.connection() as conn:
            rows = conn.execute("SELECT unit_code, release_no, import_file FROM field_weighings").fetchall()
        self.assertEqual([tuple(row) for row in rows], [("PPT", "4", "b.xlsx")])
        # Importação inválida não apaga a base atual.
        with self.assertRaises(ValueError):
            weighings.import_weighings(self.admin["id"], [{"unit_code": "PPT"}])
        with storage.connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM field_weighings").fetchone()[0], 1)

    def test_summary_rates_stock_and_external_fronts(self):
        # Com a carga da NRD das 16:01, o arquivo fecha a hora 15 (cargas até 15:59:59).
        weighings.import_weighings(self.admin["id"], parse_weighing_file(self.file(), "a.xlsx")["records"]
                                   + parse_weighing_file(xlsx([HEADER, LATE_NRD_LOAD]), "a.xlsx")["records"])
        # 17:00 em Brasília (16:00 no MS): fecham as cargas da PST das 15:20 e 15:35 (horário do MS).
        summary = weighings.weighing_summary("2026-11-14", now=clock("17:00"))
        units = {unit["code"]: unit for unit in summary["units"]}
        ppt, pst = units["PPT"], units["PST"]
        self.assertEqual(ppt["milling_day_t"], 100.0)
        self.assertEqual(ppt["loads_day"], 3)
        self.assertEqual(ppt["stock_loads"], 1)
        # ATR ponderado pelo peso.
        self.assertEqual(ppt["atr"], round((120 * 36 + 130 * 34 + 127.91 * 30) / 100, 2))
        fronts = {front["front"]: front for front in ppt["fronts"]}
        self.assertEqual(fronts["5"]["sector"], "1173")
        self.assertFalse(fronts["5"]["external"])
        self.assertTrue(fronts["19"]["external"])
        self.assertEqual(fronts["19"]["home_unit"], "NRD")
        self.assertEqual([front["front"] for front in ppt["received"]], ["19"])
        self.assertEqual([front["front"] for front in pst["received"]], ["402"])
        self.assertEqual(units["RBR"]["milling_day_t"], 30.0)
        support = {(item["front"], item["from_unit"], item["to_unit"]) for item in summary["support"]}
        self.assertEqual(support, {("19", "NRD", "PPT"), ("402", "RBR", "PST")})
        self.assertEqual(summary["last_import"]["imported_by_name"], "Admin")
        # Troca de cana: a FT19 é da NRD e entrou na PPT; o ATR dela entra na média da PPT
        # (acima) e não na da NRD, que não teve carga pesada fechada.
        self.assertIsNone(units["NRD"]["atr"])
        self.assertNotIn("19", [front["front"] for front in units["NRD"]["fronts"]])
        self.assertEqual(units["NRD"]["loads_day"], 1)  # a saída das 16:05 entra: a hora 16 fechou às 17:00

    def test_hourly_logic_of_the_spreadsheet(self):
        # Mesma lógica da planilha "Controle de entrega x Moagem" (validada com a NRD):
        # moagem da hora = soma das saídas; densidade = peso médio das julietas da hora;
        # entrega da hora = CVs que chegaram × 2 × densidade; turno e 3 h = média das horas.
        def truck(release, plate, arrival, out="", kg=""):
            row = load("201", release, "5", "361", "1173", kg, out, patio=f"14/11/2026 {arrival}")
            row[3] = plate
            return row
        weighings.import_weighings(self.admin["id"], parse_weighing_file(xlsx([HEADER,
            truck("1", "A", "07:10:00", "14/11/2026 08:05:00", "30000"),  # CV A: 2 julietas
            truck("2", "A", "07:10:00", "14/11/2026 08:05:00", "30000"),
            truck("3", "B", "08:20:00", "14/11/2026 09:10:00", "36000"),  # CV B
            truck("4", "B", "08:20:00", "14/11/2026 09:10:00", "34000"),
            truck("5", "D", "09:45:00", "14/11/2026 10:01:00", "32000"),  # pesado depois da referência
            truck("6", "C", "09:59:30"),                                   # CV C: no pátio
            truck("7", "C", "09:59:30"),
            truck("8", "E", "10:00:10"),                                   # CV E: passou das 10:00
        ]), "a.xlsx")["records"])
        summary = weighings.weighing_summary("2026-11-14", now=clock("10:30"))
        ppt = summary["units"][0]
        # Referência = última chegada (10:00:10): a hora 09 fechou (passou de 09:59:59);
        # a saída das 10:01 fica para a próxima importação.
        self.assertEqual(summary["reference_at"], 1794661210)
        self.assertEqual(summary["closed_hours"], 10)  # 00h a 09h
        self.assertEqual(summary["shift"]["code"], "B")
        hours = {item["hour"]: item for item in ppt["hours"]}
        self.assertEqual((hours[8]["milling_t"], hours[8]["density_t"], hours[8]["trucks"], hours[8]["delivery_t"]),
                         (60.0, 30.0, 1, 60.0))
        # 09h: B pesado (70 t / 2 = 35 t); chegaram D e C (2 CVs × 2 × 35 t).
        self.assertEqual((hours[9]["milling_t"], hours[9]["density_t"], hours[9]["trucks"], hours[9]["delivery_t"]),
                         (70.0, 35.0, 2, 140.0))
        # 07h: sem saídas; a densidade usa a média do dia (130 t / 4 = 32,5 t).
        self.assertEqual((hours[7]["milling_t"], hours[7]["trucks"], hours[7]["delivery_t"]), (0.0, 1, 65.0))
        self.assertEqual(ppt["milling_day_t"], 130.0)
        self.assertEqual(ppt["milling_shift_tph"], round((0 + 60 + 70) / 3, 1))     # turno B: 07h, 08h e 09h
        self.assertEqual(ppt["milling_last3h_tph"], round((0 + 60 + 70) / 3, 1))
        self.assertEqual(ppt["delivery_shift_tph"], round((65 + 60 + 140) / 3, 1))
        self.assertEqual(ppt["delivery_day_t"], 265.0)
        # Projeção do dia: média por hora (10 horas fechadas: 00h a 09h) × 24.
        self.assertEqual(ppt["milling_projection_t"], round(130 / 10 * 24, 1))
        self.assertEqual(ppt["delivery_projection_t"], round(265 / 10 * 24, 1))
        # Pátio: D (pesado só às 10:01), as 2 julietas de C e a de E.
        self.assertEqual(ppt["stock_loads"], 4)

    def test_hours_go_until_the_last_hour_of_the_imported_select(self):
        # O SELECT foi até 21:59:07: as horas vão de 00h a 21h, a qualquer hora do relógio
        # (a importação vale até a próxima, inclusive no dia seguinte).
        weighings.import_weighings(self.admin["id"], parse_weighing_file(xlsx([HEADER,
            load("204", "1", "20", "300", "3500", "35000", "14/11/2026 20:30:00", patio="14/11/2026 19:50:00"),
            load("204", "2", "20", "300", "3500", "20000", "14/11/2026 21:59:07", patio="14/11/2026 21:59:07"),
        ]), "a.xlsx")["records"])
        for current in (None, clock("23:35"), clock("08:00", "15/11/2026")):
            summary = weighings.weighing_summary(now=current)  # sem data: o dia do arquivo
            self.assertEqual(summary["work_date"], "2026-11-14")
            self.assertEqual((summary["closed_hours"], summary["closed_until"]), (22, clock("22:00")))
            nrd = summary["units"][1]
            self.assertEqual([item["milling_t"] for item in nrd["hours"][-2:]], [35.0, 20.0])
            self.assertEqual((nrd["milling_day_t"], nrd["data_until"]), (55.0, clock("21:59") + 7))
        # "Fechamento às 21:35" (planilha tirada nesse horário): só as horas encerradas, 00h a 20h.
        summary = weighings.weighing_summary("2026-11-14", now=clock("21:35"))
        self.assertEqual(summary["closed_hours"], 21)  # 00h a 20h
        nrd = summary["units"][1]
        self.assertEqual(nrd["hours"][-1]["hour"], 20)
        self.assertEqual(nrd["milling_shift_tph"], round(35 / 5, 1))  # turno C: 16h a 20h
        # Fechamento até 20:59:59: a carga que saiu às 21:59 fica para a hora 21.
        self.assertEqual(summary["closed_until"], 1794700800)  # 14/11/2026 21:00
        self.assertEqual((nrd["milling_day_t"], nrd["loads_day"]), (35.0, 1))
        self.assertEqual(nrd["stock_loads"], 0)

    def test_guarita_time_is_used_for_delivery_when_present(self):
        rows = [HEADER + ["DATA_HORA_GUARITA"],
                load("201", "1", "5", "361", "1173", "30000", "14/11/2026 08:30:00", patio="14/11/2026 08:10:00")
                + ["14/11/2026 07:55:00"],
                load("201", "2", "5", "361", "1173", "", "", patio="14/11/2026 08:59:30") + ["14/11/2026 08:40:00"],
                # Chegou às 09:10 e saiu às 09:20: a referência fica em 09:10 e fecha a hora 08.
                load("201", "3", "5", "361", "1173", "30000", "14/11/2026 09:20:00", patio="14/11/2026 09:12:00")
                + ["14/11/2026 09:10:00"],
                # Chegou há mais de 24 h e nunca foi pesada: fora do estoque.
                load("201", "4", "5", "361", "1173", "", "", patio="13/11/2026 06:10:00") + ["13/11/2026 06:00:00"]]
        records = parse_weighing_file(xlsx(rows), "a.xlsx")["records"]
        weighings.import_weighings(self.admin["id"], records)
        summary = weighings.weighing_summary("2026-11-14", now=clock("09:30"))
        self.assertEqual(summary["reference_at"], 1794658200)  # 14/11/2026 09:10 (Brasília)
        ppt = summary["units"][0]
        hours = {item["hour"]: item for item in ppt["hours"]}
        # Chegou na guarita às 07:55 (no pátio às 08:10): conta como CV da hora 07.
        self.assertEqual(hours[7]["trucks"], 1)
        self.assertEqual(hours[8]["trucks"], 1)
        # Pátio: a liberação 2 (sem pesagem) e a 3 (pesada depois da referência).
        self.assertEqual(ppt["stock_loads"], 2)

    def test_julietas_of_the_same_truck_are_one_cv(self):
        # Caminhão X: julieta 1 na guarita às 07:59 e julieta 2 às 08:01 -> 1 CV na hora 07
        # (como a planilha, que conta a julieta de sequência 1). Caminhão Y volta 2 h depois.
        def julieta(release, plate, guarita, out="14/11/2026 10:30:00"):
            row = load("201", release, "5", "361", "1173", "30000", out, patio=f"14/11/2026 {guarita}")
            row[3] = plate
            return row + [f"14/11/2026 {guarita}"]
        weighings.import_weighings(self.admin["id"], parse_weighing_file(xlsx([HEADER + ["DT_REG_GUARITA"],
            julieta("1", "X", "07:59:00"), julieta("2", "X", "08:01:00"),
            julieta("3", "Y", "07:10:00"), julieta("4", "Y", "07:12:00"),
            julieta("5", "Y", "09:20:00"), julieta("6", "Y", "09:21:00"),
            julieta("7", "Z", "10:30:00"),  # fecha as horas até 09
        ]), "a.xlsx")["records"])
        hours = {item["hour"]: item for item in weighings.weighing_summary("2026-11-14", now=clock("10:40"))["units"][0]["hours"]}
        self.assertEqual((hours[7]["trucks"], hours[8]["trucks"], hours[9]["trucks"]), (2, 0, 1))

    def test_ms_units_use_local_time_one_hour_behind(self):
        # A balança do Polo MS registra no horário local (uma hora a menos que Brasília).
        # Às 23:35 de Brasília são 22:35 no MS: fecham 00h a 22h na NRD e 00h a 21h na RBR.
        weighings.import_weighings(self.admin["id"], parse_weighing_file(xlsx([HEADER,
            load("204", "1", "20", "300", "3500", "30000", "14/11/2026 22:40:00", patio="14/11/2026 22:00:00"),
            load("402", "2", "611", "90441", "2", "32000", "14/11/2026 21:40:00", patio="14/11/2026 21:00:00"),
            load("402", "3", "611", "90441", "2", "33000", "14/11/2026 22:20:00", patio="14/11/2026 22:00:00"),
        ]), "a.xlsx")["records"])
        rbr_record = next(r for r in parse_weighing_file(xlsx([HEADER,
            load("402", "2", "611", "90441", "2", "32000", "14/11/2026 21:40:00")]), "a.xlsx")["records"])
        self.assertEqual(rbr_record["scale_out_at"], clock("22:40"))  # 21:40 no MS = 22:40 em Brasília
        summary = weighings.weighing_summary("2026-11-14", now=clock("23:35"))
        units = {unit["code"]: unit for unit in summary["units"]}
        self.assertEqual((units["NRD"]["closed_hours"], units["NRD"]["hours"][-1]["milling_t"]), (23, 30.0))
        rbr = units["RBR"]
        self.assertEqual(rbr["timezone"], "America/Campo_Grande")
        self.assertEqual(rbr["closed_hours"], 22)                # 00h a 21h (horário do MS)
        self.assertEqual(rbr["closed_until"], clock("23:00"))    # 22:00 no MS
        self.assertEqual(rbr["hours"][-1]["hour"], 21)
        self.assertEqual(rbr["hours"][-1]["milling_t"], 32.0)    # a das 22:20 (MS) é da hora 22, aberta
        self.assertEqual(rbr["milling_day_t"], 32.0)

    def test_cvs_follow_each_polo_spreadsheet(self):
        # Mesmas cargas na PPT (Polo SP) e na PST (Polo MS), horário local de cada uma:
        # caminhão X com 2 julietas e caminhão Y com 1 julieta chegando às 08h; 3 cargas de 30 t
        # pesadas às 08h (densidade 30 t). SP conta caminhões (2 CVs); MS conta julietas × 0,5 (1,5).
        def julieta(instance, release, plate, out, arrival="08:10:00"):
            row = load(instance, release, "5", "361", "1173", "30000", f"14/11/2026 {out}", patio=f"14/11/2026 {arrival}")
            row[3] = plate
            return row
        weighings.import_weighings(self.admin["id"], parse_weighing_file(xlsx([HEADER,
            julieta("201", "1", "X", "08:40:00"), julieta("201", "2", "X", "08:41:00"), julieta("201", "3", "Y", "08:50:00"),
            julieta("401", "4", "X", "08:40:00"), julieta("401", "5", "X", "08:41:00"), julieta("401", "6", "Y", "08:50:00"),
            julieta("201", "7", "Z", "10:30:00", "10:00:00"), julieta("401", "8", "Z", "10:30:00", "10:00:00"),  # fecham até 09h
        ]), "a.xlsx")["records"])
        units = {unit["code"]: unit for unit in weighings.weighing_summary("2026-11-14")["units"]}
        ppt8 = next(item for item in units["PPT"]["hours"] if item["hour"] == 8)
        pst8 = next(item for item in units["PST"]["hours"] if item["hour"] == 8)
        self.assertEqual((ppt8["trucks"], ppt8["delivery_t"]), (2, 120.0))   # 2 × 2 × 30 t
        self.assertEqual((pst8["trucks"], pst8["delivery_t"]), (1.5, 90.0))  # 1,5 × 2 × 30 t

    def test_closing_at_a_chosen_time(self):
        # "Fechamento às 23:35": o dia como estava às 23:35 de Brasília, mesmo consultado depois.
        weighings.import_weighings(self.admin["id"], parse_weighing_file(xlsx([HEADER,
            load("204", "1", "20", "300", "3500", "30000", "14/11/2026 22:40:00", patio="14/11/2026 22:00:00"),
            load("204", "2", "20", "300", "3500", "20000", "14/11/2026 23:10:00", patio="14/11/2026 22:59:00"),
        ]), "a.xlsx")["records"])
        later = clock("08:00", "15/11/2026")
        self.assertEqual(weighings.weighing_summary("2026-11-14", now=later)["units"][1]["milling_day_t"], 50.0)
        at = weighings.weighing_summary("2026-11-14", now=later, at_time="23:35")
        self.assertEqual((at["closed_hours"], at["units"][1]["milling_day_t"]), (23, 30.0))
        with self.assertRaisesRegex(ValueError, "HH:MM"):
            weighings.weighing_summary("2026-11-14", at_time="25:00")

    def test_management_report_xlsx(self):
        from backend.models.weighing_report import build_weighing_report
        from backend.services.weighing_import import parse_weighing_file as parse
        weighings.import_weighings(self.admin["id"], parse(self.file(), "a.xlsx")["records"]
                                   + parse(xlsx([HEADER, LATE_NRD_LOAD]), "a.xlsx")["records"])
        content, filename = build_weighing_report("2026-11-14", at_time="17:00")
        self.assertEqual(filename, "Relatorio-gerencial-2026-11-14-17h00.xlsx")
        # O arquivo gerado é lido de volta pelo mesmo leitor das importações.
        from backend.services.xlsx_reader import open_archive, plain_cell_value, read_sheet_rows, workbook_sheets
        archive = open_archive(content, "inválido")
        self.assertEqual([name for name, _ in workbook_sheets(archive)],
                         ["Resumo", "Hora a hora", "Turnos", "Troca de cana", "Frentes"])
        sheets = {name: [values for values, _ in read_sheet_rows(
            archive, path, lambda cell: plain_cell_value(cell, []), max_rows=1000, max_columns=40, keep_empty_rows=False)]
            for name, path in workbook_sheets(archive)}
        resumo = {row[0]: row for row in sheets["Resumo"] if row}
        self.assertEqual(resumo["PPT"][12], "100")  # processado dia (t)
        # PPT 100 + NRD 30 (16:05) + RBR 30 (15:10 MS) + PST 63 (15:20 e 15:35 MS).
        self.assertEqual(resumo["Total"][12], "223")
        troca = sheets["Troca de cana"]
        self.assertEqual(troca[0][:3], ["Frente", "Unidade dona", "Entregou em"])
        self.assertIn(["19", "NRD", "PPT", "1", "30", "127.91", "PPT"], troca)

    def test_summary_without_data(self):
        summary = weighings.weighing_summary("2026-11-13")
        self.assertIsNone(summary["reference_at"])
        self.assertTrue(all(unit["milling_day_t"] == 0 and unit["milling_shift_tph"] is None
                            for unit in summary["units"]))
        with self.assertRaisesRegex(ValueError, "Data"):
            weighings.weighing_summary("14/11/2026")

    def test_saved_queries(self):
        saved = weighings.save_delivery_query(self.admin["id"], {"name": "  Pesagem   do dia ", "sql": "SELECT 1\nFROM dual"})
        self.assertEqual(saved["name"], "Pesagem do dia")
        self.assertEqual(saved["updated_by"], "Admin")
        updated = weighings.save_delivery_query(self.admin["id"], {"name": "Pesagem", "sql": "SELECT 2"}, query_id=saved["id"])
        self.assertEqual([query["sql"] for query in weighings.list_delivery_queries()], ["SELECT 2"])
        self.assertEqual(updated["id"], saved["id"])
        for payload, message in (({"name": "", "sql": "SELECT 1"}, "nome"), ({"name": "A", "sql": " "}, "SQL"),
                                 ({"name": "A", "sql": "x" * 20001}, "20.000")):
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                weighings.save_delivery_query(self.admin["id"], payload)
        weighings.delete_delivery_query(saved["id"])
        self.assertEqual(weighings.list_delivery_queries(), [])
        with self.assertRaisesRegex(ValueError, "não encontrada"):
            weighings.delete_delivery_query(saved["id"])

    def test_permissions(self):
        self.assertEqual(module_access.required_permission("/api/weighings/import", "POST"), (("dashboard",), "edit"))
        self.assertEqual(module_access.required_permission("/api/weighings/summary", "GET"),
                         (("dashboard", "emission"), "view"))
        self.assertEqual(module_access.required_permission("/api/delivery/queries", "GET"), (("dashboard",), "view"))
        self.assertEqual(module_access.required_permission("/api/delivery/queries", "POST"), (("dashboard",), "edit"))
        self.assertEqual(module_access.required_permission("/api/delivery/queries/3", "DELETE"), (("dashboard",), "edit"))


if __name__ == "__main__":
    unittest.main()
