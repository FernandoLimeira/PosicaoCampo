"""Ponto de entrada WSGI da aplicação.

Este módulo permanece estável para o PythonAnywhere e para o servidor local.
A implementação HTTP vive na camada de controllers.
"""

import gzip

from .controllers.application_controller import application as _application

GZIP_MIN_BYTES = 1024
GZIP_TYPES = ("application/json", "text/", "javascript", "css", "svg")


def _gzip(app):
    """Comprime respostas de texto (JSON, HTML, CSS, JS) acima de 1 KB quando o
    navegador envia ``Accept-Encoding: gzip``. Arquivos binários passam direto."""
    def wrapped(environ, start_response):
        if "gzip" not in str(environ.get("HTTP_ACCEPT_ENCODING", "")).lower():
            return app(environ, start_response)
        captured = {}

        def capture(status, headers, exc_info=None):
            captured["status"], captured["headers"] = status, list(headers)
            return lambda data: captured.setdefault("written", []).append(data)

        result = app(environ, capture)
        try:
            body = b"".join(captured.pop("written", [])) + b"".join(result)
        finally:
            if hasattr(result, "close"):
                result.close()
        headers = captured["headers"]
        content_type = next((value for key, value in headers if key.lower() == "content-type"), "").lower()
        already = any(key.lower() == "content-encoding" for key, _ in headers)
        if len(body) >= GZIP_MIN_BYTES and not already and any(kind in content_type for kind in GZIP_TYPES):
            body = gzip.compress(body, compresslevel=6)
            headers = [(key, value) for key, value in headers if key.lower() != "content-length"]
            headers += [("Content-Length", str(len(body))), ("Content-Encoding", "gzip"), ("Vary", "Accept-Encoding")]
        start_response(captured["status"], headers)
        return [body]
    return wrapped


def _hsts(app):
    """Envia Strict-Transport-Security nas respostas servidas por HTTPS."""
    def wrapped(environ, start_response):
        scheme = str(environ.get("wsgi.url_scheme", "")).lower()
        forwarded = str(environ.get("HTTP_X_FORWARDED_PROTO", "")).split(",", 1)[0].strip().lower()
        if "https" not in (scheme, forwarded):
            return app(environ, start_response)

        def secure_start(status, headers, exc_info=None):
            headers = list(headers) + [("Strict-Transport-Security", "max-age=31536000")]
            if exc_info is None:
                return start_response(status, headers)
            return start_response(status, headers, exc_info)
        return app(environ, secure_start)
    return wrapped


application = _hsts(_gzip(_application))

__all__ = ["application"]
