"""Aplicação WSGI: despacha cada requisição para os handlers por domínio.

Ordem de avaliação (equivalente à antiga cadeia única de ``if``):

1. sessão do usuário (cookie) e bloqueio de métodos de escrita cross-origin;
2. rotas de autenticação (``routes.auth``), antes de qualquer permissão;
3. checagem global ``required_permission`` para usuários autenticados;
4. handlers de API por domínio, em ``ROUTE_HANDLERS``; cada um devolve
   ``None`` quando a rota não é dele;
5. páginas, arquivos estáticos e 404 (``routes.pages``), sempre por último.

Utilitários HTTP vivem em ``controllers.http`` e sessão/login em
``controllers.auth``. Os nomes abaixo continuam importáveis daqui por
compatibilidade.
"""
from http import HTTPStatus

from ..models.database import init_db
from ..models.module_access import required_permission, user_can
from .auth import (  # noqa: F401
    LOGIN_MAX_FAILURES,
    LOGIN_MAX_FAILURES_PER_IP,
    LOGIN_TRACKED_KEYS_MAX,
    LOGIN_WINDOW_SECONDS,
    _auth_cookie,
    _clear_auth_cookie,
    _clear_login_failures,
    _client_key,
    _ip_key,
    _is_admin,
    _login_blocked,
    _login_failures,
    _login_lock,
    _prune_login_failures,
    _record_login_failure,
    _session_user,
)
from .http import (  # noqa: F401
    Request,
    _cookies,
    _file,
    _json,
    _json_body,
    _multipart_file,
    _page,
    _redirect,
    _request_is_https,
    _respond,
    _same_origin_request,
)
from .routes import auth as auth_routes
from .routes import field, pages, production, reports, returns, sacarose, sectors, users
from .routes.pages import PAGE_ROUTES, PUBLIC_STATIC_FILES, STATIC_ROOTS  # noqa: F401
from .routes.returns import _analyze_return_request  # noqa: F401

# Os caminhos de cada domínio não se sobrepõem, então a ordem entre módulos
# não altera o resultado; dentro de cada módulo a ordem original foi mantida.
ROUTE_HANDLERS = (
    users.handle,
    production.handle,
    field.handle,
    sacarose.handle,
    sectors.handle,
    returns.handle,
    reports.handle,
)


def application(environ, start_response):
    req = Request(environ, start_response, user=_session_user(environ))

    if req.method in {"POST", "PUT", "PATCH", "DELETE"} and not _same_origin_request(environ):
        return req.error(HTTPStatus.FORBIDDEN, "Origem da requisição não permitida.")

    response = auth_routes.handle(req)
    if response is not None:
        return response

    required = required_permission(req.path, req.method)
    if required and req.user:
        modules, action = required
        if not any(user_can(req.user, module, action) for module in modules):
            return req.error(HTTPStatus.FORBIDDEN, "Você não possui permissão para esta operação.")

    for handler in ROUTE_HANDLERS:
        response = handler(req)
        if response is not None:
            return response

    return pages.handle(req)


init_db()
