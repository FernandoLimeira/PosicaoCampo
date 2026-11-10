"""Base de setores: consulta, cadastro manual, importação de planilha e exclusão."""
import logging
from http import HTTPStatus
from urllib.parse import unquote

from ...models.module_access import user_can
from ...models.sectors import (
    clear_sector_base,
    delete_sector_base_item,
    import_sector_base_items,
    list_sector_base,
    save_sector_base_item,
)
from ...services.sector_base_import import MAX_SECTOR_BASE_UPLOAD_BYTES, parse_sector_base_excel_details
from ..http import _multipart_file

logger = logging.getLogger("posicao_campo")


def handle(req):
    path, method, user = req.path, req.method, req.user

    if path == "/api/sector-base" and method == "GET":
        if not user:
            return req.unauthorized()
        items = list_sector_base(req.param("search"))
        return req.json(HTTPStatus.OK, {"items": items, "count": len(items)})

    if path == "/api/sector-base" and method == "POST":
        if not user:
            return req.unauthorized()

        def save():
            payload = req.body()
            item = save_sector_base_item(
                payload.get("sector"),
                payload.get("section"),
                payload.get("description"),
                user["id"],
                source="manual",
                original_section=payload.get("original_section"),
            )
            return req.json(HTTPStatus.OK, {"item": item})

        return req.guarded(save, bad_request=ValueError, forbidden=False)

    if path == "/api/sector-base/import" and method == "POST":
        if not user:
            return req.unauthorized()
        replace = req.param("replace") == "1"
        if replace and not user_can(user, "sectors_purge"):
            return req.error(HTTPStatus.FORBIDDEN, "Sem permissão para substituir a base de setores.")
        try:
            filename, file_bytes = _multipart_file(req.environ, max_file_bytes=MAX_SECTOR_BASE_UPLOAD_BYTES)
            parsed = parse_sector_base_excel_details(file_bytes, filename)
            result = import_sector_base_items(parsed["items"], user["id"], replace=replace)
            return req.json(
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
            return req.error(HTTPStatus.BAD_REQUEST, exc)
        except Exception:
            logger.exception("Erro ao importar base de setores")
            return req.error(HTTPStatus.INTERNAL_SERVER_ERROR, "Não foi possível importar a base de setores.")

    if path == "/api/sector-base" and method == "DELETE":
        if not user:
            return req.unauthorized()

        def purge():
            # Confirmação explícita no corpo evita apagar a base por uma chamada acidental.
            if str(req.body().get("confirm") or "").strip().upper() != "APAGAR":
                raise ValueError("Digite APAGAR para confirmar a exclusão de toda a base.")
            removed = clear_sector_base(user["id"])
            logger.info("Base de setores apagada por usuário %s (%s registros)", user["id"], removed)
            return req.json(HTTPStatus.OK, {"ok": True, "removed": removed})

        return req.guarded(purge, bad_request=ValueError, forbidden=False)

    if path.startswith("/api/sector-base/") and method == "DELETE":
        if not user:
            return req.unauthorized()
        sector = path.rsplit("/", 1)[-1]
        section = req.param("section")

        def remove():
            if section is None:
                raise ValueError("Informe a seção para confirmar a exclusão do setor.")
            delete_sector_base_item(unquote(sector), section, user["id"])
            return req.json(HTTPStatus.OK, {"ok": True})

        return req.guarded(remove, bad_request=ValueError, forbidden=False)

    return None
