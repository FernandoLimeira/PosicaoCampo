"""Produção Agrícola: acesso, status, catálogo, opções de setor e apontamentos diários."""
from http import HTTPStatus

from ...models.service_orders import (
    delete_operation,
    import_service_orders,
    list_operations,
    list_service_orders,
    save_operation,
)
from ...services.service_order_import import MAX_SERVICE_ORDER_UPLOAD_BYTES, parse_service_order_file
from ..http import _multipart_file
from ...models.production import (
    delete_group as delete_production_group,
    delete_service_front as delete_production_service_front,
    delete_status as delete_production_status,
    get_daily_summary as get_production_daily_summary,
    get_user_access as get_production_user_access,
    list_catalog as list_production_catalog,
    list_my_items as list_production_my_items,
    list_sector_options as list_production_sector_options,
    list_statuses as list_production_statuses,
    remove_my_item as remove_production_my_item,
    save_daily_summary as save_production_daily_summary,
    save_group as save_production_group,
    save_my_item as save_production_my_item,
    save_items_sheet as save_production_items_sheet,
    save_my_items as save_production_my_items,
    save_service_front as save_production_service_front,
    save_status as save_production_status,
)


def _last_id(path):
    return int(path.rsplit("/", 1)[-1])


def handle(req):
    path, method, user = req.path, req.method, req.user
    if not path.startswith("/api/production/"):
        return None

    if path == "/api/production/service-orders" and method == "GET":
        if not user:
            return req.unauthorized()
        return req.guarded(
            lambda: req.json(HTTPStatus.OK, list_service_orders(user["id"], req.param("unit", ""), req.param("search"))),
            bad_request=ValueError,
        )

    if path == "/api/production/service-orders/import" and method == "POST":
        if not user:
            return req.unauthorized()

        def import_orders():
            filename, file_bytes = _multipart_file(req.environ, max_file_bytes=MAX_SERVICE_ORDER_UPLOAD_BYTES)
            parsed = parse_service_order_file(file_bytes, filename)
            result = import_service_orders(user["id"], req.param("unit", ""), parsed["records"], filename=filename)
            return req.json(HTTPStatus.OK, {"ok": True, **result, "sheet": parsed["sheet"]})

        return req.guarded(import_orders, bad_request=ValueError)

    if path == "/api/production/operations":
        if not user:
            return req.unauthorized()
        if method == "GET":
            return req.guarded(lambda: req.json(HTTPStatus.OK, list_operations(
                user["id"], include_inactive=req.param("include_inactive", "0") == "1")))
        if method == "POST":
            return req.guarded(lambda: req.json(HTTPStatus.CREATED, {
                "ok": True, "operation": save_operation(user["id"], req.body()),
            }))

    if path.startswith("/api/production/operations/") and method in {"PUT", "DELETE"}:
        if not user:
            return req.unauthorized()

        def operation():
            operation_id = _last_id(path)
            if method == "PUT":
                return req.json(HTTPStatus.OK, {"ok": True, "operation": save_operation(user["id"], req.body(), operation_id=operation_id)})
            delete_operation(user["id"], operation_id)
            return req.json(HTTPStatus.OK, {"ok": True})

        return req.guarded(operation, bad_request=(ValueError, TypeError))

    if path == "/api/production/access" and method == "GET":
        if not user:
            return req.unauthorized()
        return req.guarded(
            lambda: req.json(HTTPStatus.OK, {"access": get_production_user_access(user["id"])}),
            bad_request=ValueError, forbidden=False,
        )

    if path == "/api/production/statuses":
        if not user:
            return req.unauthorized()

        def statuses():
            if method == "GET":
                include_inactive = req.param("include_inactive", "0") == "1"
                return req.json(HTTPStatus.OK, list_production_statuses(user["id"], include_inactive=include_inactive))
            if method == "POST":
                status = save_production_status(user["id"], req.body())
                return req.json(HTTPStatus.CREATED, {"ok": True, "status": status})
            return None

        response = req.guarded(statuses)
        if response is not None:
            return response

    if path.startswith("/api/production/statuses/"):
        if not user:
            return req.unauthorized()

        def status_item():
            status_id = _last_id(path)
            if method == "PUT":
                status = save_production_status(user["id"], req.body(), status_id=status_id)
                return req.json(HTTPStatus.OK, {"ok": True, "status": status})
            if method == "DELETE":
                delete_production_status(user["id"], status_id)
                return req.json(HTTPStatus.OK, {"ok": True})
            return None

        response = req.guarded(status_item)
        if response is not None:
            return response

    if path == "/api/production/catalog" and method == "GET":
        if not user:
            return req.unauthorized()

        def catalog():
            unit_code = req.param("unit")
            include_inactive = req.param("include_inactive", "0") == "1"
            return req.json(HTTPStatus.OK, list_production_catalog(user["id"], unit_code=unit_code, include_inactive=include_inactive))

        return req.guarded(catalog, bad_request=ValueError)

    if path == "/api/production/catalog/groups" and method == "POST":
        if not user:
            return req.unauthorized()
        return req.guarded(lambda: req.json(HTTPStatus.CREATED, {
            "ok": True, "group": save_production_group(user["id"], req.body()),
        }))

    if path.startswith("/api/production/catalog/groups/") and method == "PUT":
        if not user:
            return req.unauthorized()

        def update_group():
            group_id = _last_id(path)
            group = save_production_group(user["id"], req.body(), group_id=group_id)
            return req.json(HTTPStatus.OK, {"ok": True, "group": group})

        return req.guarded(update_group)

    if path.startswith("/api/production/catalog/groups/") and method == "DELETE":
        if not user:
            return req.unauthorized()

        def remove_group():
            delete_production_group(user["id"], _last_id(path))
            return req.json(HTTPStatus.OK, {"ok": True})

        return req.guarded(remove_group)

    if path == "/api/production/catalog/fronts" and method == "POST":
        if not user:
            return req.unauthorized()
        return req.guarded(lambda: req.json(HTTPStatus.CREATED, {
            "ok": True, "front": save_production_service_front(user["id"], req.body()),
        }))

    if path.startswith("/api/production/catalog/fronts/") and method == "PUT":
        if not user:
            return req.unauthorized()

        def update_front():
            front_id = _last_id(path)
            front = save_production_service_front(user["id"], req.body(), front_id=front_id)
            return req.json(HTTPStatus.OK, {"ok": True, "front": front})

        return req.guarded(update_front)

    if path.startswith("/api/production/catalog/fronts/") and method == "DELETE":
        if not user:
            return req.unauthorized()

        def remove_front():
            delete_production_service_front(user["id"], _last_id(path))
            return req.json(HTTPStatus.OK, {"ok": True})

        return req.guarded(remove_front)

    if path == "/api/production/sector-options" and method == "GET":
        if not user:
            return req.unauthorized()
        return req.guarded(lambda: req.json(HTTPStatus.OK, {
            "items": list_production_sector_options(user["id"], req.param("unit", ""), req.param("sector", "")),
        }), bad_request=ValueError)

    if path == "/api/production/daily-summary":
        if not user:
            return req.unauthorized()

        def daily_summary():
            if method == "GET":
                summary = get_production_daily_summary(user["id"], req.param("unit", ""), req.param("date", ""))
                return req.json(HTTPStatus.OK, {"summary": summary})
            if method == "PUT":
                summary = save_production_daily_summary(user["id"], req.body())
                return req.json(HTTPStatus.OK, {"ok": True, "summary": summary})
            return None

        response = req.guarded(daily_summary)
        if response is not None:
            return response

    if path == "/api/production/my-items":
        if not user:
            return req.unauthorized()

        def my_items():
            if method == "GET":
                return req.json(
                    HTTPStatus.OK,
                    list_production_my_items(user["id"], req.param("unit", ""), req.param("date", ""),
                                             scope=req.param("scope", "mine")),
                )
            if method == "POST":
                item = save_production_my_item(user["id"], req.body())
                return req.json(HTTPStatus.CREATED, {"ok": True, "item": item})
            return None

        response = req.guarded(my_items)
        if response is not None:
            return response

    if path == "/api/production/my-items/sheet" and method == "POST":
        if not user:
            return req.unauthorized()
        return req.guarded(lambda: req.json(HTTPStatus.OK, {
            "ok": True, **save_production_items_sheet(user["id"], req.body()),
        }))

    if path == "/api/production/my-items/batch" and method == "POST":
        if not user:
            return req.unauthorized()
        return req.guarded(lambda: req.json(HTTPStatus.CREATED, {
            "ok": True, "items": save_production_my_items(user["id"], req.body()),
        }))

    if path.startswith("/api/production/my-items/"):
        if not user:
            return req.unauthorized()

        def my_item():
            item_id = _last_id(path)
            if method == "PUT":
                item = save_production_my_item(user["id"], req.body(), item_id=item_id)
                return req.json(HTTPStatus.OK, {"ok": True, "item": item})
            if method == "DELETE":
                remove_production_my_item(user["id"], item_id)
                return req.json(HTTPStatus.OK, {"ok": True})
            return None

        response = req.guarded(my_item)
        if response is not None:
            return response

    return None
