"""Mudanças de área: layouts, solo úmido, análise de retornos e apresentação PPTX."""
import logging
import re
from http import HTTPStatus

from ...models.returns import (
    get_return_soil_wet_summary,
    import_return_soil_wet_records,
    list_return_analysis_layouts,
    list_return_soil_wet_records,
    save_return_analysis_layouts,
)
from ...models.sectors import list_sector_base
from ...services.return_analysis import MAX_RETURN_UPLOAD_BYTES, analyze_return_file
from ...services.return_presentation import PPTX_MIME, generate_return_presentation, report_digest
from ...services.soil_wet_import import MAX_SOIL_WET_UPLOAD_BYTES, parse_soil_wet_file
from ..http import _multipart_file, _respond

logger = logging.getLogger("posicao_campo")


def _analyze_return_request(environ, query):
    unit_code = str((query.get("unit") or [""])[0]).strip().upper()
    front_code = str((query.get("front") or [""])[0]).strip()
    try:
        min_gap_days = int((query.get("min_gap") or [1])[0])
    except (TypeError, ValueError):
        min_gap_days = 1
    layouts_payload = list_return_analysis_layouts(unit_code)
    units_payload = layouts_payload.get("units") or []
    if not units_payload:
        raise ValueError("Unidade sem cadastro de layouts para análise.")
    unit_payload = units_payload[0]
    filename, file_bytes = _multipart_file(environ, max_file_bytes=MAX_RETURN_UPLOAD_BYTES)
    return analyze_return_file(
        file_bytes, filename, unit_payload.get("fronts") or [], front_code,
        min_gap_days=min_gap_days, unit_code=unit_payload.get("code") or unit_code,
        unit_name=unit_payload.get("name") or unit_code,
        soil_wet_records=list_return_soil_wet_records(unit_code),
        sector_base=list_sector_base(),
    )


def _presentation(req):
    query = req.query
    try:
        expected_digest = req.param("digest", "")
        if not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
            raise ValueError("Processe a análise antes de gerar a apresentação.")
        # Reprocessa o mesmo arquivo com os layouts do banco: o cliente não
        # fornece totais, conclusões ou caminhos de modelo arbitrários.
        report = _analyze_return_request(req.environ, query)
        if report_digest(report) != expected_digest:
            return req.error(
                HTTPStatus.CONFLICT,
                "O arquivo, os layouts ou as bases de setores/apontamentos mudaram. Processe novamente a análise antes de gerar a apresentação.",
            )
        traces = None
        if "traces" in query:
            requested = query["traces"]
            if len(requested) != 1 or not re.fullmatch(r"none|\d+(?:,\d+)*", requested[0]):
                raise ValueError("Seleção de rastros inválida.")
            traces = [] if requested[0] == "none" else [int(index) for index in requested[0].split(",")]
        content, filename = generate_return_presentation(report, trace_indices=traces)
        return _respond(req.start_response, HTTPStatus.OK, content, [
            ("Content-Type", PPTX_MIME), ("Cache-Control", "no-store"),
            ("Content-Disposition", f'attachment; filename="{filename}"'),
        ])
    except ValueError as exc:
        return req.error(HTTPStatus.BAD_REQUEST, exc)
    except FileNotFoundError:
        return req.error(
            HTTPStatus.INTERNAL_SERVER_ERROR,
            "Modelo CTT não encontrado. Publique também a pasta templates/presentations.",
        )
    except Exception:
        logger.exception("Erro ao gerar apresentação de mudanças de área")
        return req.error(HTTPStatus.INTERNAL_SERVER_ERROR, "Não foi possível gerar a apresentação.")


def _import_soil_wet(req):
    unit_code = str(req.param("unit", "")).strip().upper()
    try:
        filename, file_bytes = _multipart_file(req.environ, max_file_bytes=MAX_SOIL_WET_UPLOAD_BYTES)
        parsed = parse_soil_wet_file(file_bytes, filename)
        detected_unit = parsed.get("detected_unit") or ""
        if detected_unit and detected_unit != unit_code:
            raise ValueError(
                f"A planilha foi identificada como {detected_unit}, mas a unidade selecionada é {unit_code}."
            )
        result = import_return_soil_wet_records(
            unit_code, parsed.get("records") or [], req.user["id"], filename=parsed.get("filename") or filename
        )
        result["ignored_non_soil_wet"] = int(parsed.get("ignored_non_soil_wet") or 0)
        result["invalid_rows"] = int(parsed.get("invalid_rows") or 0)
        return req.json(HTTPStatus.OK, {"ok": True, **result})
    except ValueError as exc:
        return req.error(HTTPStatus.BAD_REQUEST, exc)
    except Exception:
        logger.exception("Erro ao importar apontamentos de solo úmido")
        return req.error(HTTPStatus.INTERNAL_SERVER_ERROR, "Não foi possível importar os apontamentos de solo úmido.")


def handle(req):
    path, method, user = req.path, req.method, req.user
    if not path.startswith("/api/return-analysis/"):
        return None

    if path == "/api/return-analysis/layouts" and method == "GET":
        if not user:
            return req.unauthorized()
        unit_code = req.param("unit")
        return req.guarded(lambda: req.json(HTTPStatus.OK, list_return_analysis_layouts(unit_code)),
                           bad_request=ValueError, forbidden=False)

    if path.startswith("/api/return-analysis/layouts/") and method == "PUT":
        if not user:
            return req.unauthorized()
        unit_code = path.rsplit("/", 1)[-1].strip().upper()

        def save_layouts():
            fronts = req.body().get("fronts")
            result = save_return_analysis_layouts(unit_code, fronts, user["id"])
            return req.json(HTTPStatus.OK, {"ok": True, **result})

        return req.guarded(save_layouts, forbidden=False)

    if path == "/api/return-analysis/soil-wet" and method == "GET":
        if not user:
            return req.unauthorized()
        unit_code = str(req.param("unit", "")).strip().upper()
        return req.guarded(lambda: req.json(HTTPStatus.OK, {"summary": get_return_soil_wet_summary(unit_code)}),
                           bad_request=ValueError, forbidden=False)

    if path == "/api/return-analysis/soil-wet/import" and method == "POST":
        if not user:
            return req.unauthorized()
        return _import_soil_wet(req)

    if path == "/api/return-analysis/analyze" and method == "POST":
        if not user:
            return req.unauthorized()
        try:
            report = _analyze_return_request(req.environ, req.query)
            return req.json(HTTPStatus.OK, {"report": report, "report_digest": report_digest(report)})
        except ValueError as exc:
            return req.error(HTTPStatus.BAD_REQUEST, exc)
        except Exception:
            logger.exception("Erro ao processar análise de retornos")
            return req.error(HTTPStatus.INTERNAL_SERVER_ERROR, "Não foi possível processar a planilha de retornos.")

    if path == "/api/return-analysis/presentation" and method == "POST":
        if not user:
            return req.unauthorized()
        return _presentation(req)

    return None
