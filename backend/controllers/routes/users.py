"""Cadastro de usuários e acessos (módulos e Produção Agrícola)."""
from http import HTTPStatus

from ...models.module_access import get_full_user_access, save_full_user_access, user_can
from ...models.production import save_user_access as save_production_user_access
from ...models.users import create_user, delete_user, list_users, reset_user_password, set_user_active


def _user_path_parts(path):
    return [part for part in path.split("/") if part]


def handle(req):
    path, method, user = req.path, req.method, req.user

    if path == "/api/users" and method == "GET":
        if not user:
            return req.unauthorized()
        if not user_can(user, "users", "view"):
            return req.error(HTTPStatus.FORBIDDEN, "Sem acesso ao módulo Usuários.")
        return req.json(HTTPStatus.OK, {"users": list_users(user["id"])})

    if path == "/api/users" and method == "POST":
        if not user:
            return req.unauthorized()
        if not user_can(user, "users", "edit"):
            return req.error(HTTPStatus.FORBIDDEN, "Sem permissão para gerenciar usuários.")

        def create():
            payload = req.body()
            if payload.get("role") == "admin":
                return req.error(HTTPStatus.FORBIDDEN, "Administradores só podem ser criados pelo utilitário local.")
            created = create_user(
                str(payload.get("name", "")), str(payload.get("password", "")),
                role=payload.get("role", "analyst"), base_unit=payload.get("base_unit", "PPT"),
                email=payload.get("email", ""), is_active=payload.get("is_active", True),
                production_access=payload.get("production_access"),
                module_access=payload.get("module_access"), actor_id=user["id"],
            )
            return req.json(HTTPStatus.CREATED, {"user": created})

        return req.guarded(create, bad_request=ValueError)

    if path.startswith("/api/users/"):
        parts = _user_path_parts(path)
        if len(parts) >= 3 and parts[0] == "api" and parts[1] == "users":
            if not user:
                return req.unauthorized()
            is_user_change = (len(parts) == 3 and method == "DELETE") or (
                len(parts) == 4 and parts[3] in {"password", "active"} and method == "PUT")
            if is_user_change and not user_can(user, "users", "edit"):
                return req.error(HTTPStatus.FORBIDDEN, "Sem permissão para gerenciar usuários.")

            def change():
                user_id = int(parts[2])
                if len(parts) == 3 and method == "DELETE":
                    delete_user(user_id, user["id"])
                    return req.json(HTTPStatus.OK, {"ok": True})
                if len(parts) == 4 and parts[3] == "password" and method == "PUT":
                    payload = req.body()
                    reset_user_password(user_id, str(payload.get("password", "")), user["id"])
                    return req.json(HTTPStatus.OK, {"ok": True})
                if len(parts) == 4 and parts[3] == "active" and method == "PUT":
                    payload = req.body()
                    if not isinstance(payload.get("is_active"), bool):
                        raise ValueError("Situação do usuário inválida.")
                    updated = set_user_active(user_id, payload["is_active"], user["id"])
                    return req.json(HTTPStatus.OK, {"ok": True, "user": updated})
                return None  # Segue para /access e /production-access.

            response = req.guarded(change)
            if response is not None:
                return response

    # /access é avaliado antes de /production-access (que também termina em "access").
    if path.startswith("/api/users/") and path.endswith("/access") and not path.endswith("/production-access"):
        parts = _user_path_parts(path)
        if len(parts) == 4 and parts[:2] == ["api", "users"] and method in {"GET", "PUT"}:
            if not user:
                return req.unauthorized()
            if not user_can(user, "users", "view" if method == "GET" else "edit"):
                return req.error(HTTPStatus.FORBIDDEN, "Sem permissão para o módulo Usuários.")

            def access():
                target_id = int(parts[2])
                if method == "GET":
                    result = get_full_user_access(target_id, actor_id=user["id"])
                else:
                    result = save_full_user_access(target_id, req.body().get("access"), actor_id=user["id"])
                return req.json(HTTPStatus.OK, {"access": result})

            return req.guarded(access)

    if path.startswith("/api/users/") and path.endswith("/production-access"):
        parts = _user_path_parts(path)
        if len(parts) == 4 and parts[:2] == ["api", "users"]:
            if not user:
                return req.unauthorized()
            if not user_can(user, "users", "view" if method == "GET" else "edit"):
                return req.error(HTTPStatus.FORBIDDEN, "Sem permissão para o módulo Usuários.")

            def production_access():
                target_user_id = int(parts[2])
                if method == "GET":
                    return req.json(HTTPStatus.OK, {"access": get_full_user_access(target_user_id, actor_id=user["id"])["production"]})
                if method == "PUT":
                    payload = req.body()
                    result = save_production_user_access(target_user_id, payload.get("access"), actor_id=user["id"])
                    return req.json(HTTPStatus.OK, {"ok": True, "access": result})
                return None

            response = req.guarded(production_access)
            if response is not None:
                return response

    return None
