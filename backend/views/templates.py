"""Herança de layout com escape automático de dados inseridos em HTML."""

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from ..config import TEMPLATE_DIR
from ..models.module_access import MODULES

ASSET_VERSION = "20261017-user-permissions-workspace-v5"

environment = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
    undefined=StrictUndefined,
)


def render_template(name: str, *, user=None, page="login") -> bytes:
    if user is not None and "module_access" not in user:
        user = {**user, "module_access": {item["key"]: {"view": True, "edit": item["edit"]} for item in MODULES}}
    return environment.get_template(name).render(
        user=user, page=page, asset_version=ASSET_VERSION, modules=MODULES,
    ).encode("utf-8")
