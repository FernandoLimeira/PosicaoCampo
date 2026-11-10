"""Páginas HTML, arquivos estáticos e a resposta 404 final (sempre por último)."""
from http import HTTPStatus
from pathlib import Path

from ...config import STATIC_DIR
from ...models.module_access import user_can
from ..http import _file, _page, _redirect, _respond

STATIC_ROOTS = {"css", "js", "assets"}
PAGE_ROUTES = {
    "/usuarios/cadastro": ("usuarios.html", "users"),
    "/emitir-posicao-global": ("emissao.html", "emission"),
    "/": ("index.html", "dashboard"),
    "/sacarose": ("sacarose.html", "sacarose"),
    "/producao": ("producao.html", "production"),
    "/producao/ordens-servico": ("producao.html", "service_orders"),
    "/producao/cadastros": ("producao.html", "production_catalog"),
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


def handle(req):
    """Trata páginas e estáticos; qualquer outra rota recebe 404 em texto."""
    path, method, user, start_response = req.path, req.method, req.user, req.start_response

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
            return req.error(HTTPStatus.FORBIDDEN, "Sem acesso ao módulo Usuários.")
        if path in {"/producao", "/producao/ordens-servico", "/producao/cadastros"} and not user.get("production_access", {}).get("enabled"):
            return req.error(HTTPStatus.FORBIDDEN, "Você não possui acesso à Produção Agrícola.")
        page_key = PAGE_ROUTES[path][1]
        if page_key not in {"production", "service_orders", "production_catalog", "users"} and not user_can(user, page_key):
            return req.error(HTTPStatus.FORBIDDEN, "Você não possui acesso a este módulo.")
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
