"""Herança de layout com escape automático de dados inseridos em HTML."""

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from ..config import TEMPLATE_DIR

ASSET_VERSION = "20261006-ctt-presentation-v22"

environment = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
    undefined=StrictUndefined,
)


def render_template(name: str, *, user=None, page="login") -> bytes:
    return environment.get_template(name).render(
        user=user, page=page, asset_version=ASSET_VERSION,
    ).encode("utf-8")
