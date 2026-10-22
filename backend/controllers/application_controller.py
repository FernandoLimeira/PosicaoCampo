import json
import mimetypes
import re
import threading
import time
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from ..config import MAX_BODY_BYTES, REMEMBER_SESSION_TTL_SECONDS, SESSION_COOKIE, STATIC_DIR
from ..views.templates import render_template
from ..services.excel_reports import MAX_EXCEL_UPLOAD_BYTES, analyze_excel_report
from ..services.return_analysis import MAX_RETURN_UPLOAD_BYTES, analyze_return_file
from ..services.soil_wet_import import MAX_SOIL_WET_UPLOAD_BYTES, parse_soil_wet_file
from ..services.return_presentation import PPTX_MIME, generate_return_presentation, report_digest
from ..services.sector_base_import import MAX_SECTOR_BASE_UPLOAD_BYTES, parse_sector_base_excel_details
from ..services.operational_shifts import shift_at
from ..models.database import (
    UnitConflictError,
    authenticate_user,
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
    list_unit_versions,
    list_sector_base,
    list_sacarose_positions,
    list_return_analysis_layouts,
    save_return_analysis_layouts,
    get_return_soil_wet_summary,
    list_return_soil_wet_records,
    import_return_soil_wet_records,
    save_sector_base_item,
    import_sector_base_items,
    delete_sector_base_item,
    save_sacarose_positions,
    save_unit,
)
from ..models.module_access import (
    get_module_access, get_full_user_access, save_full_user_access,
    required_permission, user_can, landing_page,
)
from ..models.front_notes import front_notes_summary, list_front_notes, append_front_note, update_front_note, front_notes_for_shift
from ..models.production import (
    get_user_access as get_production_user_access,
    save_user_access as save_production_user_access,
    list_catalog as list_production_catalog,
    list_statuses as list_production_statuses,
    save_status as save_production_status,
    delete_status as delete_production_status,
    save_group as save_production_group,
    delete_group as delete_production_group,
    save_service_front as save_production_service_front,
    delete_service_front as delete_production_service_front,
    list_sector_options as list_production_sector_options,
    list_my_items as list_production_my_items,
    save_my_item as save_production_my_item,
    save_my_items as save_production_my_items,
    remove_my_item as remove_production_my_item,
    get_daily_summary as get_production_daily_summary,
    save_daily_summary as save_production_daily_summary,
)

STATIC_ROOTS = {"css", "js", "assets"}
PAGE_ROUTES = {
    "/usuarios/cadastro": ("usuarios.html", "users"),
    "/emitir-posicao-global": ("emissao.html", "emission"),
    "/": ("index.html", "dashboard"),
    "/sacarose": ("sacarose.html", "sacarose"),
    "/producao": ("producao.html", "production"),
    "/setores": ("setores.html", "sectors"),
    "/relatorios": ("relatorios.html", "reports"),
    "/retornos": ("retornos.html", "returns"),
    "/historico": ("historico.html", "history"),
    "/usuarios": ("usuarios.html", "users"),
}
PUBLIC_STATIC_FILES = {
    ("css", "base.css"),
    ("css", "auth.css"),
    ("js", "login.js"),
    ("assets", "cornfield.svg"),
    ("assets", "login-field-sunrise-v1.png"),
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
    user = get_user_by_session(_cookies(environ).get(SESSION_COOKIE))
    if not user:
        return None
    try:
        user["module_access"] = get_module_access(int(user["id"]))
        user["production_access"] = get_production_user_access(int(user["id"]))
        user["home_path"] = landing_page(user["module_access"], user["production_access"]["enabled"])
    except (ValueError, TypeError):
        user["production_access"] = {
            "enabled": False,
            "admin": False,
            "permissions": {"view": False, "fill": False, "configure": False},
            "units": [],
        }
    return user


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


def _page(start_response, template, *, user=None, page="login"):
    return _respond(
        start_response, HTTPStatus.OK,
        render_template(template, user=user, page=page),
        [("Content-Type", "text/html; charset=utf-8"), ("Cache-Control", "no-store")],
    )


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


def _auth_cookie(token, environ, *, remember_me=False):
    secure = "; Secure" if _request_is_https(environ) else ""
    persistent = f"; Max-Age={REMEMBER_SESSION_TTL_SECONDS}" if remember_me else ""
    return (
        "Set-Cookie",
        f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict{persistent}{secure}",
    )


def _clear_auth_cookie(environ):
    secure = "; Secure" if _request_is_https(environ) else ""
    return (
        "Set-Cookie",
        f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}",
    )


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


def application(environ, start_response):
    method = environ.get("REQUEST_METHOD", "GET").upper()
    path = environ.get("PATH_INFO", "/")
    query = parse_qs(environ.get("QUERY_STRING", ""))
    user = _session_user(environ)

    if method in {"POST", "PUT", "PATCH", "DELETE"} and not _same_origin_request(environ):
        return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Origem da requisição não permitida."})

    if path == "/login" and method == "GET":
        if user:
            return _redirect(start_response, user.get("home_path", "/"))
        return _page(start_response, "login.html")

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
        remember_me = payload.get("remember_me", False)
        if not isinstance(remember_me, bool):
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": "Lembrar de mim deve ser verdadeiro ou falso."})
        if _login_blocked(environ, username):
            return _json(start_response, HTTPStatus.TOO_MANY_REQUESTS, {"error": "Muitas tentativas de login. Aguarde alguns minutos."})
        logged = authenticate_user(username, password)
        if not logged:
            _record_login_failure(environ, username)
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Nome ou senha inválidos."})
        try:
            token = create_session(
                logged["id"], remember_me=remember_me,
                replace_token=_cookies(environ).get(SESSION_COOKIE),
            )
        except ValueError:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Nome ou senha inválidos."})
        _clear_login_failures(environ, username)
        from ..models.module_access import get_module_access
        modules = get_module_access(logged["id"])
        production = get_production_user_access(logged["id"])
        landing = landing_page(modules, production["enabled"])
        return _json(start_response, HTTPStatus.OK, {"user": logged, "landing_page": landing}, [_auth_cookie(token, environ, remember_me=remember_me)])

    if path == "/api/auth/logout" and method == "POST":
        token = _cookies(environ).get(SESSION_COOKIE)
        delete_session(token)
        return _json(start_response, HTTPStatus.OK, {"ok": True}, [_clear_auth_cookie(environ)])

    if path == "/api/auth/me" and method == "GET":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Sessão expirada."})
        return _json(start_response, HTTPStatus.OK, {"user": user})


    required = required_permission(path, method)
    if required and user:
        modules, action = required
        if not any(user_can(user, module, action) for module in modules):
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Você não possui permissão para esta operação."})

    if path == "/api/users" and method == "GET":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        if not user_can(user, "users", "view"):
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Sem acesso ao módulo Usuários."})
        return _json(start_response, HTTPStatus.OK, {"users": list_users(user["id"])})

    if path == "/api/users" and method == "POST":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        if not user_can(user, "users", "edit"):
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Sem permissão para gerenciar usuários."})
        try:
            payload = _json_body(environ)
            if payload.get("role") == "admin":
                return _json(start_response, HTTPStatus.FORBIDDEN, {
                    "error": "Administradores só podem ser criados pelo utilitário local.",
                })
            created = create_user(
                str(payload.get("name", "")), str(payload.get("password", "")),
                role=payload.get("role", "analyst"), base_unit=payload.get("base_unit", "PPT"),
                email=payload.get("email", ""), is_active=payload.get("is_active", True),
                production_access=payload.get("production_access"),
                module_access=payload.get("module_access"), actor_id=user["id"],
            )
            return _json(start_response, HTTPStatus.CREATED, {"user": created})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path.startswith("/api/users/"):
        parts = [part for part in path.split("/") if part]
        if len(parts) >= 3 and parts[0] == "api" and parts[1] == "users":
            if not user:
                return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
            is_user_change = (len(parts) == 3 and method == "DELETE") or (
                len(parts) == 4 and parts[3] in {"password", "active"} and method == "PUT")
            if is_user_change and not user_can(user, "users", "edit"):
                return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Sem permissão para gerenciar usuários."})
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
            except PermissionError as exc:
                return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
            except (ValueError, TypeError) as exc:
                return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path.startswith("/api/users/") and path.endswith("/access") and not path.endswith("/production-access"):
        parts = [part for part in path.split("/") if part]
        if len(parts) == 4 and parts[:2] == ["api", "users"] and method in {"GET", "PUT"}:
            if not user:
                return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
            if not user_can(user, "users", "view" if method == "GET" else "edit"):
                return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Sem permissão para o módulo Usuários."})
            try:
                target_id = int(parts[2])
                if method == "GET":
                    access = get_full_user_access(target_id, actor_id=user["id"])
                else:
                    access = save_full_user_access(target_id, _json_body(environ).get("access"), actor_id=user["id"])
                return _json(start_response, HTTPStatus.OK, {"access": access})
            except PermissionError as exc:
                return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
            except (ValueError, TypeError) as exc:
                return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path.startswith("/api/users/") and path.endswith("/production-access"):
        parts = [part for part in path.split("/") if part]
        if len(parts) == 4 and parts[:2] == ["api", "users"]:
            if not user:
                return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
            if not user_can(user, "users", "view" if method == "GET" else "edit"):
                return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Sem permissão para o módulo Usuários."})
            try:
                target_user_id = int(parts[2])
                if method == "GET":
                    return _json(start_response, HTTPStatus.OK, {"access": get_full_user_access(target_user_id, actor_id=user["id"])["production"]})
                if method == "PUT":
                    payload = _json_body(environ)
                    access = save_production_user_access(target_user_id, payload.get("access"), actor_id=user["id"])
                    return _json(start_response, HTTPStatus.OK, {"ok": True, "access": access})
            except PermissionError as exc:
                return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
            except (ValueError, TypeError) as exc:
                return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/production/access" and method == "GET":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            return _json(start_response, HTTPStatus.OK, {"access": get_production_user_access(user["id"])})
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/production/statuses":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            if method == "GET":
                include_inactive = (query.get("include_inactive") or ["0"])[0] == "1"
                return _json(start_response, HTTPStatus.OK, list_production_statuses(user["id"], include_inactive=include_inactive))
            if method == "POST":
                status = save_production_status(user["id"], _json_body(environ))
                return _json(start_response, HTTPStatus.CREATED, {"ok": True, "status": status})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path.startswith("/api/production/statuses/"):
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            status_id = int(path.rsplit("/", 1)[-1])
            if method == "PUT":
                status = save_production_status(user["id"], _json_body(environ), status_id=status_id)
                return _json(start_response, HTTPStatus.OK, {"ok": True, "status": status})
            if method == "DELETE":
                delete_production_status(user["id"], status_id)
                return _json(start_response, HTTPStatus.OK, {"ok": True})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/production/catalog" and method == "GET":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            unit_code = (query.get("unit") or [None])[0]
            include_inactive = (query.get("include_inactive") or ["0"])[0] == "1"
            return _json(start_response, HTTPStatus.OK, list_production_catalog(user["id"], unit_code=unit_code, include_inactive=include_inactive))
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/production/catalog/groups" and method == "POST":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            group = save_production_group(user["id"], _json_body(environ))
            return _json(start_response, HTTPStatus.CREATED, {"ok": True, "group": group})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path.startswith("/api/production/catalog/groups/") and method == "PUT":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            group_id = int(path.rsplit("/", 1)[-1])
            group = save_production_group(user["id"], _json_body(environ), group_id=group_id)
            return _json(start_response, HTTPStatus.OK, {"ok": True, "group": group})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path.startswith("/api/production/catalog/groups/") and method == "DELETE":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            group_id = int(path.rsplit("/", 1)[-1])
            delete_production_group(user["id"], group_id)
            return _json(start_response, HTTPStatus.OK, {"ok": True})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/production/catalog/fronts" and method == "POST":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            front = save_production_service_front(user["id"], _json_body(environ))
            return _json(start_response, HTTPStatus.CREATED, {"ok": True, "front": front})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path.startswith("/api/production/catalog/fronts/") and method == "PUT":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            front_id = int(path.rsplit("/", 1)[-1])
            front = save_production_service_front(user["id"], _json_body(environ), front_id=front_id)
            return _json(start_response, HTTPStatus.OK, {"ok": True, "front": front})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path.startswith("/api/production/catalog/fronts/") and method == "DELETE":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            front_id = int(path.rsplit("/", 1)[-1])
            delete_production_service_front(user["id"], front_id)
            return _json(start_response, HTTPStatus.OK, {"ok": True})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/production/sector-options" and method == "GET":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            unit_code = (query.get("unit") or [""])[0]
            sector = (query.get("sector") or [""])[0]
            return _json(start_response, HTTPStatus.OK, {"items": list_production_sector_options(user["id"], unit_code, sector)})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/production/daily-summary":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            if method == "GET":
                unit_code = (query.get("unit") or [""])[0]
                work_date = (query.get("date") or [""])[0]
                summary = get_production_daily_summary(user["id"], unit_code, work_date)
                return _json(start_response, HTTPStatus.OK, {"summary": summary})
            if method == "PUT":
                summary = save_production_daily_summary(user["id"], _json_body(environ))
                return _json(start_response, HTTPStatus.OK, {"ok": True, "summary": summary})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/production/my-items":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            if method == "GET":
                unit_code = (query.get("unit") or [""])[0]
                work_date = (query.get("date") or [""])[0]
                scope = (query.get("scope") or ["mine"])[0]
                return _json(
                    start_response, HTTPStatus.OK,
                    list_production_my_items(user["id"], unit_code, work_date, scope=scope),
                )
            if method == "POST":
                item = save_production_my_item(user["id"], _json_body(environ))
                return _json(start_response, HTTPStatus.CREATED, {"ok": True, "item": item})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/production/my-items/batch" and method == "POST":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            items = save_production_my_items(user["id"], _json_body(environ))
            return _json(start_response, HTTPStatus.CREATED, {"ok": True, "items": items})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path.startswith("/api/production/my-items/"):
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            item_id = int(path.rsplit("/", 1)[-1])
            if method == "PUT":
                item = save_production_my_item(user["id"], _json_body(environ), item_id=item_id)
                return _json(start_response, HTTPStatus.OK, {"ok": True, "item": item})
            if method == "DELETE":
                remove_production_my_item(user["id"], item_id)
                return _json(start_response, HTTPStatus.OK, {"ok": True})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/front-notes" or path.startswith("/api/front-notes/"):
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            if path == "/api/front-notes/shift" and method == "GET":
                result = front_notes_for_shift((query.get("unit") or [""])[0], user,
                                               (query.get("date") or [None])[0], (query.get("shift") or [None])[0])
                return _json(start_response, HTTPStatus.OK, result)
            if path == "/api/front-notes":
                if method == "GET":
                    unit = (query.get("unit") or [""])[0]
                    front = (query.get("front") or [""])[0]
                    before = (query.get("before_id") or [None])[0]
                    result = list_front_notes(unit, front, user, before_id=int(before) if before is not None else None) if front else {
                        "summaries": front_notes_summary(unit, user), "period": shift_at(int(time.time()))
                    }
                    return _json(start_response, HTTPStatus.OK, result)
                if method == "POST":
                    item = append_front_note(_json_body(environ), user)
                    return _json(start_response, HTTPStatus.CREATED, {"entry": item})
            elif method == "PUT" and re.fullmatch(r"/api/front-notes/\d+", path):
                item = update_front_note(int(path.rsplit("/", 1)[-1]), _json_body(environ), user)
                return _json(start_response, HTTPStatus.OK, {"entry": item})
            return _json(start_response, HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Método não permitido."})
        except PermissionError as exc:
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/units/meta" and method == "GET":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        return _json(start_response, HTTPStatus.OK, list_unit_versions())

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
                    "unique_records": parsed.get("unique_records", result.get("total", 0)),
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

    if path == "/api/return-analysis/layouts" and method == "GET":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        unit_code = (query.get("unit") or [None])[0]
        try:
            return _json(start_response, HTTPStatus.OK, list_return_analysis_layouts(unit_code))
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path.startswith("/api/return-analysis/layouts/") and method == "PUT":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        unit_code = path.rsplit("/", 1)[-1].strip().upper()
        try:
            payload = _json_body(environ)
            fronts = payload.get("fronts")
            result = save_return_analysis_layouts(unit_code, fronts, user["id"])
            return _json(start_response, HTTPStatus.OK, {"ok": True, **result})
        except (ValueError, TypeError) as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/return-analysis/soil-wet" and method == "GET":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        unit_code = str((query.get("unit") or [""])[0]).strip().upper()
        try:
            return _json(start_response, HTTPStatus.OK, {"summary": get_return_soil_wet_summary(unit_code)})
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    if path == "/api/return-analysis/soil-wet/import" and method == "POST":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        unit_code = str((query.get("unit") or [""])[0]).strip().upper()
        try:
            filename, file_bytes = _multipart_file(environ, max_file_bytes=MAX_SOIL_WET_UPLOAD_BYTES)
            parsed = parse_soil_wet_file(file_bytes, filename)
            detected_unit = parsed.get("detected_unit") or ""
            if detected_unit and detected_unit != unit_code:
                raise ValueError(
                    f"A planilha foi identificada como {detected_unit}, mas a unidade selecionada é {unit_code}."
                )
            result = import_return_soil_wet_records(
                unit_code, parsed.get("records") or [], user["id"], filename=parsed.get("filename") or filename
            )
            result["ignored_non_soil_wet"] = int(parsed.get("ignored_non_soil_wet") or 0)
            result["invalid_rows"] = int(parsed.get("invalid_rows") or 0)
            return _json(start_response, HTTPStatus.OK, {"ok": True, **result})
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            print(f"Erro ao importar apontamentos de solo úmido: {exc}")
            return _json(start_response, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível importar os apontamentos de solo úmido."})

    if path == "/api/return-analysis/analyze" and method == "POST":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            report = _analyze_return_request(environ, query)
            return _json(start_response, HTTPStatus.OK, {"report": report, "report_digest": report_digest(report)})
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            print(f"Erro ao processar análise de retornos: {exc}")
            return _json(start_response, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível processar a planilha de retornos."})

    if path == "/api/return-analysis/presentation" and method == "POST":
        if not user:
            return _json(start_response, HTTPStatus.UNAUTHORIZED, {"error": "Autenticação necessária."})
        try:
            expected_digest = (query.get("digest") or [""])[0]
            if not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
                raise ValueError("Processe a análise antes de gerar a apresentação.")
            # Reprocessa o mesmo arquivo com os layouts do banco: o cliente não
            # fornece totais, conclusões ou caminhos de modelo arbitrários.
            report = _analyze_return_request(environ, query)
            if report_digest(report) != expected_digest:
                return _json(start_response, HTTPStatus.CONFLICT, {
                    "error": "O arquivo, os layouts ou as bases de setores/apontamentos mudaram. Processe novamente a análise antes de gerar a apresentação.",
                })
            traces = None
            if "traces" in query:
                requested = query["traces"]
                if len(requested) != 1 or not re.fullmatch(r"none|\d+(?:,\d+)*", requested[0]):
                    raise ValueError("Seleção de rastros inválida.")
                traces = [] if requested[0] == "none" else [int(index) for index in requested[0].split(",")]
            content, filename = generate_return_presentation(report, trace_indices=traces)
            return _respond(start_response, HTTPStatus.OK, content, [
                ("Content-Type", PPTX_MIME), ("Cache-Control", "no-store"),
                ("Content-Disposition", f'attachment; filename="{filename}"'),
            ])
        except ValueError as exc:
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except FileNotFoundError:
            return _json(start_response, HTTPStatus.INTERNAL_SERVER_ERROR, {
                "error": "Modelo CTT não encontrado. Publique também a pasta templates/presentations.",
            })
        except Exception as exc:
            print(f"Erro ao gerar apresentação de mudanças de área: {exc}")
            return _json(start_response, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Não foi possível gerar a apresentação."})

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

    if path == "/sem-acesso" and method == "GET":
        if not user:
            return _redirect(start_response, "/login")
        return _respond(start_response, HTTPStatus.FORBIDDEN,
                        b"Nenhum modulo liberado para esta conta. Solicite acesso ao administrador.",
                        [("Content-Type", "text/plain; charset=utf-8")])

    if path in PAGE_ROUTES and method == "GET":
        if not user:
            return _redirect(start_response, "/login")
        if path in {"/usuarios", "/usuarios/cadastro"} and not user_can(user, "users", "view"):
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Sem acesso ao módulo Usuários."})
        if path == "/producao" and not user.get("production_access", {}).get("enabled"):
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Você não possui acesso à Produção Agrícola."})
        page_key = PAGE_ROUTES[path][1]
        if page_key not in {"production", "users"} and not user_can(user, page_key):
            return _json(start_response, HTTPStatus.FORBIDDEN, {"error": "Você não possui acesso a este módulo."})
        if path == "/usuarios/cadastro":
            return _redirect(start_response, "/usuarios?novo=1")
        template, page = PAGE_ROUTES[path]
        return _page(start_response, template, user=user, page=page)

    parts = [part for part in path.split("/") if part]
    if method == "GET" and parts and parts[0] in STATIC_ROOTS:
        public_file = len(parts) == 2 and tuple(parts) in PUBLIC_STATIC_FILES
        if not user and not public_file:
            return _respond(start_response, HTTPStatus.NOT_FOUND, "Arquivo não encontrado.".encode("utf-8"))
        candidate = (STATIC_DIR / Path(*parts)).resolve()
        root = (STATIC_DIR / parts[0]).resolve()
        if root == candidate or root in candidate.parents:
            return _file(start_response, candidate)

    return _respond(start_response, HTTPStatus.NOT_FOUND, "Rota não encontrada.".encode("utf-8"))


init_db()
