import json
import mimetypes
import re
import threading
import time
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .config import BASE_DIR, MAX_BODY_BYTES, SESSION_COOKIE, SESSION_TTL_SECONDS
from .excel_reports import MAX_EXCEL_UPLOAD_BYTES, analyze_excel_report
from .sector_base_import import MAX_SECTOR_BASE_UPLOAD_BYTES, parse_sector_base_excel_details
from .database import (
    UnitConflictError,
    authenticate_user,
    create_backup,
    create_session,
    create_user,
    delete_user,
    delete_session,
    reset_user_password,
    set_user_active,
    get_user_by_session,
    init_db,
    initialize_units,
    list_history,
    list_users,
    list_units_payload,
    list_sector_base,
    list_sacarose_positions,
    save_sector_base_item,
    import_sector_base_items,
    delete_sector_base_item,
    save_sacarose_positions,
    save_unit,
)

STATIC_ROOTS = {"css", "js", "assets"}
PUBLIC_STATIC_FILES = {
    ("css", "auth.css"),
    ("js", "login.js"),
    ("assets", "cornfield.svg"),
}
LOGIN_WINDOW_SECONDS = 5 * 60
LOGIN_MAX_FAILURES = 10
LOGIN_MAX_FAILURES_PER_IP = 30
LOGIN_TRACKED_KEYS_MAX = 5000
_login_failures = {}
_login_lock = threading.Lock()


def _client_key(environ, username=""):
    return (environ.get("REMOTE_ADDR", "unknown"), username.strip().casefold())


def _ip_key(environ):
    return (environ.get("REMOTE_ADDR", "unknown"), "*")


def _prune_login_failures(now):
    stale_keys = []
    for key, stamps in _login_failures.items():
        fresh = [stamp for stamp in stamps if now - stamp < LOGIN_WINDOW_SECONDS]
        if fresh:
            limit = LOGIN_MAX_FAILURES_PER_IP if key[1] == "*" else LOGIN_MAX_FAILURES
            _login_failures[key] = fresh[-limit:]
        else:
            stale_keys.append(key)
    for key in stale_keys:
        _login_failures.pop(key, None)

    if len(_login_failures) > LOGIN_TRACKED_KEYS_MAX:
        ordered = sorted(_login_failures, key=lambda key: _login_failures[key][-1])
        for key in ordered[: len(_login_failures) - LOGIN_TRACKED_KEYS_MAX]:
            _login_failures.pop(key, None)


def _login_blocked(environ, username):
    user_key = _client_key(environ, username)
    ip_key = _ip_key(environ)
    now = time.time()
    with _login_lock:
        _prune_login_failures(now)
        return (
            len(_login_failures.get(user_key, [])) >= LOGIN_MAX_FAILURES
            or len(_login_failures.get(ip_key, [])) >= LOGIN_MAX_FAILURES_PER_IP
        )


def _record_login_failure(environ, username):
    now = time.time()
    with _login_lock:
        _prune_login_failures(now)
        for key, limit in ((_client_key(environ, username), LOGIN_MAX_FAILURES), (_ip_key(environ), LOGIN_MAX_FAILURES_PER_IP)):
            attempts = list(_login_failures.get(key, []))
            attempts.append(now)
            _login_failures[key] = attempts[-limit:]


def _clear_login_failures(environ, username):
    # Limpa o bloqueio específico do usuário autenticado; o histórico agregado
    # do IP permanece para evitar pulverização de tentativas entre vários nomes.
    with _login_lock:
        _login_failures.pop(_client_key(environ, username), None)


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


def _session_user(environ):
    return get_user_by_session(_cookies(environ).get(SESSION_COOKIE))


def _is_admin(user):
    return bool(user and user.get("role") == "admin" and user.get("is_active", True))


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
        raise ValueError("A planilha excede o limite de 10 MB.")

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
    headers.append(("Permissions-Policy", "camera=(), microphone=(), geolocation=()"))
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


def _file(start_response, path: Path):
    if not path.is_file():
        return _respond(start_response, HTTPStatus.NOT_FOUND, "Arquivo não encontrado.".encode("utf-8"))
    mime, _ = mimetypes.guess_type(str(path))
    data = path.read_bytes()
    content_type = f"{mime}; charset=utf-8" if (mime or "").startswith("text/") else (mime or "application/octet-stream")
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


def _auth_cookie(token, environ):
    secure = "; Secure" if _request_is_https(environ) else ""
    return (
        "Set-Cookie",
        f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL_SECONDS}{secure}",
    )


def _clear_auth_cookie(environ):
    secure = "; Secure" if _request_is_https(environ) else ""
    return (
        "Set-Cookie",
        f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}",
    )


def application(environ, start_response):
    method = environ.get("REQUEST_METHOD", "GET").upper()
    path = environ.get("PATH_INFO", "/")
    query = parse_qs(environ.get("QUERY_STRING", ""))
    user = _session_user(environ)

    if method in {"POST", "PUT", "PATCH", "DELETE"} and not _same_origin_request(environ):
        return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Origem da requisição não permitida."})

    if path == "/login" and method == "GET":
        if user:
            return _redirect(start_response, "/")
        return _file(start_response, BASE_DIR / "login.html")

    if path == "/register" and method == "GET":
        return _redirect(start_response, "/login")

    if path == "/api/auth/register" and method == "POST":
        return _json(start_response, HTTPStatus.NOT_FOUND, {"error": "Cadastro público desativado."})

    if path == "/api/auth/login" and method == "POST":
        try:
            payload = _json_body(environ)
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        username = str(payload.get("name", ""))
        password = str(payload.get("password", ""))
        if _login_blocked(environ, username):
            return _json(start_response, HTTPStatus.TOO_MANY_REQUESTS, {"error": "Muitas tentativas de login. Aguarde alguns minutos."})
        logged = authenticate_user(username, password)
        if not logged:
            _record_login_failure(environ, username)
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Nome ou senha inválidos."})
        _clear_login_failures(environ, username)
        token = create_session(logged["id"])
        return _json(start_response, HTTPStatus.OK, {"user": logged}, [_auth_cookie(token, environ)])

    if path == "/api/auth/logout" and method == "POST":
        token = _cookies(environ).get(SESSION_COOKIE)
        delete_session(token)
        return _json(start_response, HTTPStatus.OK, {"ok": True}, [_clear_auth_cookie(environ)])

    if path == "/api/auth/me" and method == "GET":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Sessão expirada."})
        return _json(start_response, HTTPStatus.OK, {"user": user})


    if path == "/api/users" and method == "GET":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        if not _is_admin(user):
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Acesso exclusivo do Administrador."})
        return _json(start_response, HTTPStatus.OK, {"users": list_users()})

    if path == "/api/users" and method == "POST":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        if not _is_admin(user):
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Acesso exclusivo do Administrador."})
        try:
            payload = _json_body(environ)
            created = create_user(str(payload.get("name", "")), str(payload.get("password", "")))
            return _json(start_response, HTTPStatus.CREATED, {"user": created})
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path.startswith("/api/users/"):
        parts = [part for part in path.split("/") if part]
        if len(parts) >= 3 and parts[0] == "api" and parts[1] == "users":
            if not user:
                return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
            if not _is_admin(user):
                return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Acesso exclusivo do Administrador."})
            try:
                user_id = int(parts[2])
                if len(parts) == 3 and method == "DELETE":
                    delete_user(user_id, user["id"])
                    return _json(start_response, HTTPStatus.OK, {"ok": True})
                if len(parts) == 4 and parts[3] == "password" and method == "PUT":
                    payload = _json_body(environ)
                    reset_user_password(user_id, str(payload.get("password", "")), user["id"])
                    return _json(start_response, HTTPStatus.OK, {"ok": True})
                if len(parts) == 4 and parts[3] == "active" and method == "PUT":
                    payload = _json_body(environ)
                    if not isinstance(payload.get("is_active"), bool):
                        raise ValueError("Situação do usuário inválida.")
                    updated = set_user_active(user_id, payload["is_active"], user["id"])
                    return _json(start_response, HTTPStatus.OK, {"ok": True, "user": updated})
            except (ValueError, TypeError) as exc:
                return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/units" and method == "GET":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        return _json(start_response, HTTPStatus.OK, list_units_payload())

    if path == "/api/units/sync" and method == "POST":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        if not _is_admin(user):
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "A inicialização das unidades é exclusiva do Administrador."})
        try:
            payload = _json_body(environ)
            units = payload.get("units")
            if not isinstance(units, list):
                raise ValueError("Lista de unidades inválida.")
            result = initialize_units(units, user["id"])
            create_backup(force=True)
            return _json(start_response, HTTPStatus.OK, {"ok": True, **result})
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path.startswith("/api/units/") and method == "PUT":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        code = path.rsplit("/", 1)[-1].strip().upper()
        try:
            payload = _json_body(environ)
            unit = payload.get("unit")
            position = int(payload.get("position", 0))
            expected_version_raw = payload.get("expected_version")
            expected_version = int(expected_version_raw) if expected_version_raw is not None else None
            if not isinstance(unit, dict) or str(unit.get("code", "")).upper() != code:
                raise ValueError("Unidade inválida.")
            create_backup()
            result = save_unit(unit, position, user["id"], expected_version)
            return _json(start_response, HTTPStatus.OK, {"ok": True, **result})
        except UnitConflictError as exc:
            return _json(
                start_response,
                HTTPStatus.CONFLICT,
                {"error": str(exc), "conflict": True, "current": exc.current},
            )
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})


    if path == "/api/sacarose" and method == "GET":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        return _json(start_response, HTTPStatus.OK, {"units": list_sacarose_positions()})

    if path == "/api/sacarose" and method == "POST":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            payload = _json_body(environ)
            units_payload = payload.get("units")
            expected_versions = payload.get("expected_versions")
            create_backup()
            result = save_sacarose_positions(units_payload, user["id"], expected_versions)
            return _json(start_response, HTTPStatus.OK, {"ok": True, **result})
        except UnitConflictError as exc:
            return _json(
                start_response,
                HTTPStatus.CONFLICT,
                {"error": str(exc), "conflict": True, "current": exc.current},
            )
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/sector-base" and method == "GET":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        search = (query.get("search") or [None])[0]
        items = list_sector_base(search)
        return _json(start_response, HTTPStatus.OK, {"items": items, "count": len(items)})

    if path == "/api/sector-base" and method == "POST":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            payload = _json_body(environ)
            item = save_sector_base_item(
                payload.get("sector"),
                payload.get("section"),
                payload.get("description"),
                user["id"],
                source="manual",
                original_section=payload.get("original_section"),
            )
            return _json(start_response, HTTPStatus.OK, {"item": item})
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/sector-base/import" and method == "POST":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            filename, file_bytes = _multipart_file(environ, max_file_bytes=MAX_SECTOR_BASE_UPLOAD_BYTES)
            parsed = parse_sector_base_excel_details(file_bytes, filename)
            result = import_sector_base_items(parsed["items"], user["id"])
            return _json(
                start_response,
                HTTPStatus.OK,
                {
                    "ok": True,
                    **result,
                    "rows_read": parsed["rows_read"],
                    "duplicate_rows": parsed["duplicate_rows"],
                    "conflicts": parsed["conflicts"],
                    "conflict_keys": parsed["conflict_keys"],
                    "matched_sheets": parsed["matched_sheets"],
                },
            )
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            print(f"Erro ao importar base de setores: {exc}")
            return _json(start_response, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível importar a base de setores."})

    if path.startswith("/api/sector-base/") and method == "DELETE":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        sector = path.rsplit("/", 1)[-1]
        section = (query.get("section") or [None])[0]
        try:
            from urllib.parse import unquote
            if section is None:
                raise ValueError("Informe a seção para confirmar a exclusão do setor.")
            delete_sector_base_item(unquote(sector), section)
            return _json(start_response, HTTPStatus.OK, {"ok": True})
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/reports/excel/analyze" and method == "POST":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            filename, file_bytes = _multipart_file(environ)
            report = analyze_excel_report(file_bytes, filename)
            return _json(start_response, HTTPStatus.OK, {"report": report})
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            print(f"Erro ao processar relatório Excel: {exc}")
            return _json(start_response, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível processar a planilha."})

    if path == "/api/history" and method == "GET":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            limit = int((query.get("limit") or [100])[0])
        except ValueError:
            limit = 100
        unit_code = (query.get("unit") or [None])[0]
        return _json(start_response, HTTPStatus.OK, {"history": list_history(limit, unit_code)})

    if path == "/api/backup" and method == "POST":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        if not _is_admin(user):
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Acesso exclusivo do Administrador."})
        backup = create_backup(force=True)
        return _json(start_response, HTTPStatus.OK, {"ok": True, "backup": backup.name if backup else None})

    if path == "/" and method == "GET":
        if not user:
            return _redirect(start_response, "/login")
        return _file(start_response, BASE_DIR / "index.html")

    parts = [part for part in path.split("/") if part]
    if method == "GET" and parts and parts[0] in STATIC_ROOTS:
        public_file = len(parts) == 2 and tuple(parts) in PUBLIC_STATIC_FILES
        if not user and not public_file:
            return _respond(start_response, HTTPStatus.NOT_FOUND, "Arquivo não encontrado.".encode("utf-8"))
        candidate = (BASE_DIR / Path(*parts)).resolve()
        root = (BASE_DIR / parts[0]).resolve()
        if root == candidate or root in candidate.parents:
            return _file(start_response, candidate)

    return _respond(start_response, HTTPStatus.NOT_FOUND, "Rota não encontrada.".encode("utf-8"))


init_db()
create_backup()
