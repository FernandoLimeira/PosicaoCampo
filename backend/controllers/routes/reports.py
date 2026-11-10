"""Relatório de produtividade a partir de planilha CSV/XLSX."""
import logging
from http import HTTPStatus

from ...services.excel_reports import analyze_excel_report
from ..http import _multipart_file

logger = logging.getLogger("posicao_campo")


def handle(req):
    if req.path == "/api/reports/excel/analyze" and req.method == "POST":
        if not req.user:
            return req.unauthorized()
        try:
            filename, file_bytes = _multipart_file(req.environ)
            report = analyze_excel_report(file_bytes, filename)
            return req.json(HTTPStatus.OK, {"report": report})
        except ValueError as exc:
            return req.error(HTTPStatus.BAD_REQUEST, exc)
        except Exception:
            logger.exception("Erro ao processar relatório Excel")
            return req.error(HTTPStatus.INTERNAL_SERVER_ERROR, "Não foi possível processar a planilha.")
    return None
