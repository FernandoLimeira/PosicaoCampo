"""Posição de Campo: acompanhamentos por frente, unidades e histórico."""
import re
import time
from http import HTTPStatus

from ...models.front_notes import (
    append_front_note,
    front_notes_for_shift,
    front_notes_summary,
    list_front_notes,
    update_front_note,
)
from ...models.units import (
    UnitConflictError,
    initialize_units,
    list_history,
    list_unit_versions,
    list_units_payload,
    save_unit,
)
from ...services.operational_shifts import shift_at
from ..auth import _is_admin


def _front_notes(req):
    path, method, user = req.path, req.method, req.user

    def run():
        if path == "/api/front-notes/shift" and method == "GET":
            result = front_notes_for_shift(req.param("unit", ""), user,
                                           req.param("date"), req.param("shift"),
                                           after_id=int(req.param("after_id", "0")))
            return req.json(HTTPStatus.OK, result)
        if path == "/api/front-notes":
            if method == "GET":
                unit = req.param("unit", "")
                front = req.param("front", "")
                before = req.param("before_id")
                open_only = req.param("open_only", "0")
                if open_only not in {"0", "1"}:
                    raise ValueError("Filtro de acontecimentos inválido.")
                result = list_front_notes(unit, front, user, before_id=int(before) if before is not None else None,
                                          open_only=open_only == "1") if front else {
                    "summaries": front_notes_summary(unit, user), "period": shift_at(int(time.time()))
                }
                return req.json(HTTPStatus.OK, result)
            if method == "POST":
                item = append_front_note(req.body(), user)
                return req.json(HTTPStatus.CREATED, {"entry": item})
        elif method == "PUT" and re.fullmatch(r"/api/front-notes/\d+", path):
            item = update_front_note(int(path.rsplit("/", 1)[-1]), req.body(), user)
            return req.json(HTTPStatus.OK, {"entry": item})
        return req.error(HTTPStatus.METHOD_NOT_ALLOWED, "Método não permitido.")

    return req.guarded(run)


def _conflict(req, exc):
    return req.json(HTTPStatus.CONFLICT, {"error": str(exc), "conflict": True, "current": exc.current})


def handle(req):
    path, method, user = req.path, req.method, req.user

    if path == "/api/front-notes" or path.startswith("/api/front-notes/"):
        if not user:
            return req.unauthorized()
        return _front_notes(req)

    if path == "/api/units/meta" and method == "GET":
        if not user:
            return req.unauthorized()
        return req.json(HTTPStatus.OK, list_unit_versions())

    if path == "/api/units" and method == "GET":
        if not user:
            return req.unauthorized()
        return req.json(HTTPStatus.OK, list_units_payload())

    if path == "/api/units/sync" and method == "POST":
        if not user:
            return req.unauthorized()
        if not _is_admin(user):
            return req.error(HTTPStatus.FORBIDDEN, "A inicialização das unidades é exclusiva do Administrador.")

        def sync():
            units = req.body().get("units")
            if not isinstance(units, list):
                raise ValueError("Lista de unidades inválida.")
            result = initialize_units(units, user["id"])
            return req.json(HTTPStatus.OK, {"ok": True, **result})

        return req.guarded(sync, bad_request=ValueError, forbidden=False)

    if path.startswith("/api/units/") and method == "PUT":
        if not user:
            return req.unauthorized()
        code = path.rsplit("/", 1)[-1].strip().upper()
        try:
            payload = req.body()
            unit = payload.get("unit")
            position = int(payload.get("position", 0))
            expected_version_raw = payload.get("expected_version")
            if isinstance(expected_version_raw, bool) or not isinstance(expected_version_raw, int):
                raise ValueError("Versão da unidade ausente. Recarregue a página antes de salvar.")
            if not isinstance(unit, dict) or str(unit.get("code", "")).upper() != code:
                raise ValueError("Unidade inválida.")
            result = save_unit(unit, position, user["id"], expected_version_raw)
            return req.json(HTTPStatus.OK, {"ok": True, **result})
        except UnitConflictError as exc:
            return _conflict(req, exc)
        except (ValueError, TypeError) as exc:
            return req.error(HTTPStatus.BAD_REQUEST, exc)

    if path == "/api/history" and method == "GET":
        if not user:
            return req.unauthorized()
        try:
            limit = int(req.param("limit", 100))
        except ValueError:
            limit = 100
        return req.json(HTTPStatus.OK, {"history": list_history(limit, req.param("unit"))})

    return None
