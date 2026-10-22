"""Herança de layout com escape automático de dados inseridos em HTML."""

from functools import lru_cache
from hashlib import sha256

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from ..config import STATIC_DIR, TEMPLATE_DIR
from ..models.module_access import MODULES
from ..services.field_status import FIELD_STATUSES

@lru_cache(maxsize=1)
def _asset_version_for_files(signature: tuple) -> str:
    digest = sha256()
    for path, _, _ in signature:
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


def get_asset_version() -> str:
    """Atualiza os endereços dos assets quando o HTML, CSS ou JavaScript muda."""
    paths = sorted(
        [path for path in STATIC_DIR.rglob("*") if path.suffix in {".css", ".js"}]
        + list(TEMPLATE_DIR.rglob("*.html"))
    )
    signature = []
    for path in paths:
        stat = path.stat()
        signature.append((path, stat.st_mtime_ns, stat.st_size))
    return _asset_version_for_files(tuple(signature))

environment = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
    undefined=StrictUndefined,
)


def render_template(name: str, *, user=None, page="login") -> bytes:
    if user is not None and "module_access" not in user:
        user = {**user, "module_access": {item["key"]: {"view": True, "edit": item["edit"]} for item in MODULES}}
    return environment.get_template(name).render(
        user=user, page=page, asset_version=get_asset_version(), modules=MODULES,
        field_statuses=FIELD_STATUSES,
    ).encode("utf-8")
