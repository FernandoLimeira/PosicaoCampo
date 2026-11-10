"""Login, logout e sessão atual (rotas avaliadas antes da checagem global de permissão)."""
from http import HTTPStatus

from ...config import SESSION_COOKIE
from ...models.module_access import get_module_access, landing_page
from ...models.production import get_user_access as get_production_user_access
from ...models.users import authenticate_user, create_session, delete_session
from ..auth import (
    _auth_cookie,
    _clear_auth_cookie,
    _clear_login_failures,
    _login_blocked,
    _record_login_failure,
)
from ..http import _cookies, _page, _redirect


def handle(req):
    path, method, user, environ = req.path, req.method, req.user, req.environ

    if path == "/login" and method == "GET":
        if user:
            return _redirect(req.start_response, user.get("home_path", "/"))
        return _page(req.start_response, "login.html")

    if path == "/register" and method == "GET":
        return _redirect(req.start_response, "/login")

    if path == "/api/auth/register" and method == "POST":
        return req.error(HTTPStatus.NOT_FOUND, "Cadastro público desativado.")

    if path == "/api/auth/login" and method == "POST":
        try:
            payload = req.body()
        except ValueError as exc:
            return req.error(HTTPStatus.BAD_REQUEST, exc)
        username = str(payload.get("name", ""))
        password = str(payload.get("password", ""))
        remember_me = payload.get("remember_me", False)
        if not isinstance(remember_me, bool):
            return req.error(HTTPStatus.BAD_REQUEST, "Lembrar de mim deve ser verdadeiro ou falso.")
        if _login_blocked(environ, username):
            return req.error(HTTPStatus.TOO_MANY_REQUESTS, "Muitas tentativas de login. Aguarde alguns minutos.")
        logged = authenticate_user(username, password)
        if not logged:
            _record_login_failure(environ, username)
            return req.error(HTTPStatus.UNAUTHORIZED, "Nome ou senha inválidos.")
        try:
            token = create_session(
                logged["id"], remember_me=remember_me,
                replace_token=_cookies(environ).get(SESSION_COOKIE),
            )
        except ValueError:
            return req.error(HTTPStatus.UNAUTHORIZED, "Nome ou senha inválidos.")
        _clear_login_failures(environ, username)
        modules = get_module_access(logged["id"])
        production = get_production_user_access(logged["id"])
        landing = landing_page(modules, production["enabled"])
        return req.json(HTTPStatus.OK, {"user": logged, "landing_page": landing},
                        [_auth_cookie(token, environ, remember_me=remember_me)])

    if path == "/api/auth/logout" and method == "POST":
        token = _cookies(environ).get(SESSION_COOKIE)
        delete_session(token)
        return req.json(HTTPStatus.OK, {"ok": True}, [_clear_auth_cookie(environ)])

    if path == "/api/auth/me" and method == "GET":
        if not user:
            return req.error(HTTPStatus.UNAUTHORIZED, "Sessão expirada.")
        return req.json(HTTPStatus.OK, {"user": user})

    return None
