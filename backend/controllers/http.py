"""Utilitários HTTP/WSGI sem regra de negócio: respostas, cookies e corpo da requisição."""
import json
import mimetypes
import re
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from ..config import MAX_BODY_BYTES
from ..services.excel_reports import MAX_EXCEL_UPLOAD_BYTES
from ..views.templates import render_template

# Fonte do sistema (Inter, WOFF2): versões antigas do Python não conhecem o tipo.
mimetypes.add_type("font/woff2", ".woff2")

AUTH_REQUIRED_MESSAGE = "Autenticação necessária."


def _same_origin_request(environ):
    fetch_site = (environ.get("HTTP_SEC_FETCH_SITE") or "").lower()
    if fetch_site == "cross-site":
        return False

    host = environ.get("HTTP_HOST", "")
    if not host:
        return False

    origin = environ.get("HTTP_ORIGIN")
    if origin:
        return origin in {f"http://{host}", f"https://{host}"}

    referer = environ.get("HTTP_REFERER")
    if referer:
        parsed = urlsplit(referer)
        return parsed.netloc == host and parsed.scheme in {"http", "https"}

    # Clientes locais não-navegador podem não enviar Origin/Referer.
    # O cookie SameSite=Strict continua impedindo envio cross-site pelo navegador.
    return True


def _cookies(environ):
    raw = environ.get("HTTP_COOKIE", "")
    cookies = {}
    for part in raw.split(";"):
        if "=" in part:
            key, value = part.strip().split("=", 1)
            cookies[key] = value
    return cookies


def _multipart_file(environ, field_name="file", max_file_bytes=MAX_EXCEL_UPLOAD_BYTES):
    content_type = environ.get("CONTENT_TYPE", "")
    if "multipart/form-data" not in content_type:
        raise ValueError("Envie a planilha usando multipart/form-data.")

    boundary_match = None
    for part in content_type.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary_match = part.split("=", 1)[1].strip().strip('"')
            break
    if not boundary_match:
        raise ValueError("Limite multipart inválido.")

    raw_length = environ.get("CONTENT_LENGTH") or "0"
    try:
        length = int(raw_length)
    except ValueError as exc:
        raise ValueError("Tamanho de requisição inválido.") from exc
    if length <= 0:
        raise ValueError("Selecione uma planilha XLSX.")
    if length > max_file_bytes + 256 * 1024:
        limit_mb = max_file_bytes / (1024 * 1024)
        raise ValueError(f"A planilha excede o limite de {limit_mb:g} MB.")

    body = environ["wsgi.input"].read(length)
    boundary = ("--" + boundary_match).encode("utf-8")
    for chunk in body.split(boundary):
        chunk = chunk.lstrip(b"\r\n")
        if chunk.endswith(b"--\r\n"):
            chunk = chunk[:-4]
        elif chunk.endswith(b"--"):
            chunk = chunk[:-2]
        if not chunk or b"\r\n\r\n" not in chunk:
            continue
        header_bytes, content = chunk.split(b"\r\n\r\n", 1)
        headers = header_bytes.decode("utf-8", errors="replace")
        disposition = next((line for line in headers.split("\r\n") if line.lower().startswith("content-disposition:")), "")
        name_match = re.search(r'name="([^"]+)"', disposition)
        if not name_match or name_match.group(1) != field_name:
            continue
        filename_match = re.search(r'filename="([^"]*)"', disposition)
        filename = filename_match.group(1) if filename_match else "planilha.xlsx"
        return filename, content[:-2] if content.endswith(b"\r\n") else content
    raise ValueError("Arquivo XLSX não encontrado na requisição.")


def _json_body(environ):
    raw_length = environ.get("CONTENT_LENGTH") or "0"
    try:
        length = int(raw_length)
    except ValueError as exc:
        raise ValueError("Tamanho de requisição inválido.") from exc
    if length < 0:
        raise ValueError("Tamanho de requisição inválido.")
    if length > MAX_BODY_BYTES:
        raise ValueError("Requisição muito grande.")
    body = environ["wsgi.input"].read(length) if length else b"{}"
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("JSON inválido.") from exc
    if not isinstance(payload, dict):
        raise ValueError("O corpo da requisição deve ser um objeto JSON.")
    return payload


def _respond(start_response, status, body=b"", headers=None):
    headers = list(headers or [])
    headers.append(("Content-Length", str(len(body))))
    headers.append(("X-Content-Type-Options", "nosniff"))
    headers.append(("X-Frame-Options", "DENY"))
    headers.append(("Referrer-Policy", "no-referrer"))
    headers.append(("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()"))
    headers.append(("X-Permitted-Cross-Domain-Policies", "none"))
    headers.append(("Cross-Origin-Opener-Policy", "same-origin"))
    headers.append(("Cross-Origin-Resource-Policy", "same-origin"))
    headers.append(("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"))
    start_response(f"{status.value} {status.phrase}", headers)
    return [body]


def _json(start_response, status, payload, headers=None):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    all_headers = [("Content-Type", "application/json; charset=utf-8"), ("Cache-Control", "no-store")]
    all_headers.extend(headers or [])
    return _respond(start_response, status, body, all_headers)


def _redirect(start_response, location):
    return _respond(start_response, HTTPStatus.FOUND, b"", [("Location", location), ("Cache-Control", "no-store")])


def _page(start_response, template, *, user=None, page="login"):
    return _respond(
        start_response, HTTPStatus.OK,
        render_template(template, user=user, page=page),
        [("Content-Type", "text/html; charset=utf-8"), ("Cache-Control", "no-store")],
    )


def _file(start_response, path: Path, *, versioned: bool = False):
    if not path.is_file():
        return _respond(start_response, HTTPStatus.NOT_FOUND, "Arquivo não encontrado.".encode("utf-8"))
    mime, _ = mimetypes.guess_type(str(path))
    data = path.read_bytes()
    content_type = f"{mime}; charset=utf-8" if (mime or "").startswith("text/") else (mime or "application/octet-stream")
    if path.suffix in {".css", ".js"} and versioned:
        # A URL leva ?v=<hash do conteúdo>: qualquer mudança gera outra URL.
        cache_control = "public, max-age=31536000, immutable"
    else:
        cache_control = "no-store" if path.suffix in {".html", ".css", ".js"} else "public, max-age=3600"
    return _respond(
        start_response,
        HTTPStatus.OK,
        data,
        [("Content-Type", content_type), ("Cache-Control", cache_control)],
    )


def _request_is_https(environ):
    if str(environ.get("wsgi.url_scheme", "")).lower() == "https":
        return True
    forwarded_proto = str(environ.get("HTTP_X_FORWARDED_PROTO", "")).split(",", 1)[0].strip().lower()
    return forwarded_proto == "https"


class Request:
    """Requisição já interpretada, com atalhos para as respostas mais comuns.

    Os handlers de rota retornam a resposta WSGI ou ``None`` quando a
    requisição não é deles (o despachante segue para o próximo handler).
    """

    __slots__ = ("environ", "start_response", "method", "path", "query", "user")

    def __init__(self, environ, start_response, user=None):
        self.environ = environ
        self.start_response = start_response
        self.method = environ.get("REQUEST_METHOD", "GET").upper()
        self.path = environ.get("PATH_INFO", "/")
        self.query = parse_qs(environ.get("QUERY_STRING", ""))
        self.user = user

    def param(self, name, default=None):
        """Primeiro valor do parâmetro de query (``default`` quando ausente ou vazio)."""
        return (self.query.get(name) or [default])[0]

    def body(self):
        return _json_body(self.environ)

    def json(self, status, payload, headers=None):
        return _json(self.start_response, status, payload, headers)

    def error(self, status, message):
        return self.json(status, {"error": str(message)})

    def unauthorized(self):
        return self.error(HTTPStatus.UNAUTHORIZED, AUTH_REQUIRED_MESSAGE)

    def guarded(self, action, *, bad_request=(ValueError, TypeError, OverflowError), forbidden=True):
        """Executa ``action`` convertendo erros esperados em respostas JSON.

        ``PermissionError`` -> 403 (se ``forbidden``) e ``bad_request`` -> 400,
        ambos com a mensagem da exceção. Outras exceções seguem adiante.
        """
        try:
            return action()
        except Exception as exc:
            if forbidden and isinstance(exc, PermissionError):
                return self.error(HTTPStatus.FORBIDDEN, exc)
            if isinstance(exc, bad_request):
                return self.error(HTTPStatus.BAD_REQUEST, exc)
            raise
