"""Sacarose: consulta e gravação das frentes/setores/seções por unidade."""
from http import HTTPStatus

from ...models.sacarose import list_sacarose_positions, save_sacarose_positions
from ...models.units import UnitConflictError


def handle(req):
    path, method, user = req.path, req.method, req.user

    if path == "/api/sacarose" and method == "GET":
        if not user:
            return req.unauthorized()
        return req.json(HTTPStatus.OK, {"units": list_sacarose_positions()})

    if path == "/api/sacarose" and method == "POST":
        if not user:
            return req.unauthorized()
        try:
            payload = req.body()
            units_payload = payload.get("units")
            expected_versions = payload.get("expected_versions")
            result = save_sacarose_positions(units_payload, user["id"], expected_versions)
            return req.json(HTTPStatus.OK, {"ok": True, **result})
        except UnitConflictError as exc:
            return req.json(HTTPStatus.CONFLICT, {"error": str(exc), "conflict": True, "current": exc.current})
        except (ValueError, TypeError) as exc:
            return req.error(HTTPStatus.BAD_REQUEST, exc)

    return None
