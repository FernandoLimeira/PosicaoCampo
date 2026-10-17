"""Catálogo único e verificações de acesso dos módulos operacionais.

Ausência de registro só é aceita para módulos anteriores à personalização, a fim
de manter acessos existentes. Todo novo cadastro feito pela interface grava um
registro explícito de cada módulo; negações nunca são representadas por DELETE.
"""
import time
from typing import Any

from .storage import auth_connection

# As chaves existentes são mantidas para preservar as permissões já gravadas.
# A apresentação em sete áreas é independente das chaves persistidas na API.
MODULES = (
    {"key": "reports", "name": "Produtividade", "description": "Análise de produtividade por frota e operador.", "edit": False, "group": "Relatório"},
    {"key": "returns", "name": "Mudanças de área", "description": "Analisar retornos, importar dados e editar layouts.", "edit": True, "group": "Relatório"},
    {"key": "dashboard", "name": "Posição de Campo", "description": "Consultar posições e editar apontamentos de campo.", "edit": True, "group": "CTT"},
    {"key": "sacarose", "name": "Sacarose", "description": "Consultar e atualizar indicadores de sacarose.", "edit": True, "group": "CTT"},
    {"key": "emission", "name": "Emissão Global", "description": "Emissão consolidada liberada para todos os analistas.", "edit": False, "group": "Emissão Global"},
    {"key": "sectors", "name": "Cadastro de Setores", "description": "Consultar, cadastrar, importar e excluir setores.", "edit": True, "group": "Cadastro de Setores"},
    {"key": "history", "name": "Histórico", "description": "Consultar o registro de alterações.", "edit": False, "group": "Histórico"},
    {"key": "users", "name": "Usuários", "description": "Consultar contas ou administrar cadastros e acessos.", "edit": True, "group": "Usuários"},
)
MODULE_BY_KEY = {module["key"]: module for module in MODULES}
MODULE_ROUTES = (
    ("dashboard", "/"), ("sacarose", "/sacarose"),
    ("reports", "/relatorios"), ("returns", "/retornos"),
    ("sectors", "/setores"), ("history", "/historico"),
    ("users", "/usuarios"), ("emission", "/emitir-posicao-global"),
)


def landing_page(modules: dict, production_enabled: bool) -> str:
    # Módulos atribuídos têm prioridade sobre a emissão, que é universal.
    return next((route for key, route in MODULE_ROUTES if key != "emission" and modules[key]["view"]),
                "/producao" if production_enabled else "/emitir-posicao-global")


def normalize_module_access(payload: Any) -> dict[str, dict[str, bool]] | None:
    if payload is None:
        return None  # Compatibilidade com integrações antigas.
    if not isinstance(payload, dict) or not set(payload).issubset(MODULE_BY_KEY) or set(payload) - {"users"} != set(MODULE_BY_KEY) - {"users"}:
        raise ValueError("Envie as permissões de todos os módulos.")
    result = {}
    for key, spec in MODULE_BY_KEY.items():
        entry = payload.get(key, {"view": False, "edit": False})
        if not isinstance(entry, dict) or not isinstance(entry.get("view"), bool) or not isinstance(entry.get("edit"), bool):
            raise ValueError(f"Permissões inválidas: {spec['name']}.")
        if entry["edit"] and (not entry["view"] or not spec["edit"]):
            raise ValueError(f"Edição incompatível com o acesso: {spec['name']}.")
        result[key] = {"view": True if key == "emission" else entry["view"], "edit": entry["edit"]}
    return result


def write_module_access(conn, user_id: int, permissions: dict, *, now: int | None = None):
    if permissions is None:
        return
    timestamp = int(now if now is not None else time.time())
    conn.executemany(
        """INSERT INTO user_module_permissions(user_id,module_key,can_view,can_fill,updated_at)
           VALUES (?,?,?,?,?) ON CONFLICT(user_id,module_key) DO UPDATE SET
           can_view=excluded.can_view,can_fill=excluded.can_fill,updated_at=excluded.updated_at""",
        [(user_id, key, int(value["view"]), int(value["edit"]), timestamp) for key, value in permissions.items()],
    )


def module_access_from_conn(conn, user_id: int, *, role: str) -> dict[str, dict[str, bool]]:
    if role == "admin":
        return {key: {"view": True, "edit": spec["edit"]} for key, spec in MODULE_BY_KEY.items()}
    rows = {row["module_key"]: row for row in conn.execute(
        "SELECT module_key,can_view,can_fill FROM user_module_permissions WHERE user_id=?", (user_id,)
    )}
    result = {}
    for key, spec in MODULE_BY_KEY.items():
        row = rows.get(key)
        # Usuários legados sem configuração explícita continuam com os acessos anteriores.
        view = bool(row["can_view"]) if row is not None else key != "users"
        edit = bool(row["can_fill"]) if row is not None else (spec["edit"] and key != "users")
        result[key] = {"view": True if key == "emission" else view, "edit": view and edit and spec["edit"]}
    return result


def get_module_access(user_id: int) -> dict[str, dict[str, bool]]:
    with auth_connection() as conn:
        row = conn.execute("SELECT role FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise ValueError("Usuário não encontrado.")
        return module_access_from_conn(conn, user_id, role=row["role"])


def get_full_user_access(user_id: int, *, actor_id: int) -> dict:
    from .production import _access_from_conn
    with auth_connection() as conn:
        _validate_manager(conn, user_id, actor_id, action="view")
        row = conn.execute("SELECT role FROM users WHERE id=?", (user_id,)).fetchone()
        return {
            "modules": module_access_from_conn(conn, user_id, role=row["role"]),
            "production": _access_from_conn(conn, user_id, role=row["role"]),
        }


def _validate_manager(conn, user_id, actor_id, *, action="edit"):
    actor = conn.execute("SELECT role,is_active FROM users WHERE id=?", (actor_id,)).fetchone()
    if not actor or not actor["is_active"] or (actor["role"] != "admin" and not module_access_from_conn(conn, actor_id, role=actor["role"])["users"][action]):
        raise PermissionError("Sem permissão para gerenciar usuários.")
    target = conn.execute("SELECT role FROM users WHERE id=?", (user_id,)).fetchone()
    if not target or target["role"] == "admin":
        raise ValueError("Usuário não encontrado.")
    if action == "edit" and user_id == actor_id:
        raise PermissionError("Você não pode alterar seus próprios acessos.")
    if action == "edit":
        validate_delegated_target(conn, actor_id, user_id)
    return actor


def validate_delegated_grants(conn, actor_id: int, modules: dict, production: dict) -> None:
    """Um gestor delegado nunca pode conceder módulos ou unidades que não possui."""
    actor = conn.execute("SELECT role,is_active FROM users WHERE id=?", (actor_id,)).fetchone()
    if not actor or not actor["is_active"]:
        raise PermissionError("Conta sem autorização.")
    if actor["role"] == "admin":
        return
    own = module_access_from_conn(conn, actor_id, role=actor["role"])
    if not own["users"]["edit"]:
        raise PermissionError("Sem permissão para administrar usuários.")
    for key, flags in modules.items():
        if (flags["view"] and not own[key]["view"]) or (flags["edit"] and not own[key]["edit"]):
            raise PermissionError("Não é possível conceder módulos acima de seus próprios acessos.")
    from .production import _access_from_conn
    own_production = _access_from_conn(conn, actor_id, role=actor["role"])
    if production["enabled"]:
        if not own_production["enabled"]:
            raise PermissionError("Produção Agrícola não autorizada para este gestor.")
        if production["permissions"].get("configure") and not own_production["permissions"].get("configure"):
            raise PermissionError("Configuração global não autorizada.")
        for unit, flags in production["unit_permissions"].items():
            own_flags = own_production["unit_permissions"].get(unit, {})
            if any(flags.get(action) and not own_flags.get(action) for action in ("view", "fill", "summary")):
                raise PermissionError("Não é possível conceder operações de unidades sem acesso.")


def validate_delegated_target(conn, actor_id: int, target_id: int) -> None:
    """Impedir que um gestor delegado modifique contas acima de seu escopo."""
    actor = conn.execute("SELECT role FROM users WHERE id=?", (actor_id,)).fetchone()
    target = conn.execute("SELECT role FROM users WHERE id=?", (target_id,)).fetchone()
    if not actor or not target or target["role"] == "admin":
        raise ValueError("Usuário não encontrado.")
    if actor["role"] == "admin":
        return
    own = module_access_from_conn(conn, actor_id, role=actor["role"])
    theirs = module_access_from_conn(conn, target_id, role=target["role"])
    for key, flags in theirs.items():
        if any(flags[action] and not own[key][action] for action in ("view", "edit")):
            raise PermissionError("Esta conta possui acessos acima da sua autorização.")
    from .production import _access_from_conn
    own_production = _access_from_conn(conn, actor_id, role=actor["role"])
    target_production = _access_from_conn(conn, target_id, role=target["role"])
    if target_production["permissions"]["configure"] and not own_production["permissions"]["configure"]:
        raise PermissionError("Esta conta possui configuração global não autorizada.")
    for unit, flags in target_production["unit_permissions"].items():
        own_flags = own_production["unit_permissions"].get(unit, {})
        if any(flags[action] and not own_flags.get(action) for action in ("view", "fill", "summary")):
            raise PermissionError("Esta conta possui operações acima da sua autorização.")


def save_full_user_access(user_id: int, payload: Any, *, actor_id: int) -> dict:
    from .production import normalize_user_access, write_user_access, _access_from_conn
    if not isinstance(payload, dict) or set(payload) != {"modules", "production"}:
        raise ValueError("Configuração dos acessos inválida.")
    modules = normalize_module_access(payload["modules"])
    if modules is None:
        raise ValueError("Informe os módulos do usuário.")
    production = normalize_user_access(payload["production"])
    with auth_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _validate_manager(conn, user_id, actor_id)
        validate_delegated_grants(conn, actor_id, modules, production)
        write_module_access(conn, user_id, modules)
        write_user_access(conn, user_id, production)
        role = conn.execute("SELECT role FROM users WHERE id=?", (user_id,)).fetchone()["role"]
        return {
            "modules": module_access_from_conn(conn, user_id, role=role),
            "production": _access_from_conn(conn, user_id, role=role),
        }


def required_permission(path: str, method: str):
    """Resolve autorização API sem depender de condições duplicadas em cada handler.

    Retorna (módulos aceitos, ação). Os handlers continuam validando método,
    payload e demais regras próprias após a barreira de acesso.
    """
    if path == "/api/units" and method == "GET":
        return (("dashboard", "emission"), "view")
    if path == "/api/units/meta" and method == "GET":
        return (("sacarose",), "view")
    if path == "/api/units/sync" and method == "POST":
        return (("dashboard",), "edit")
    if path.startswith("/api/units/") and method == "PUT":
        return (("dashboard",), "edit")
    if path == "/api/sacarose" and method in {"GET", "POST"}:
        return (("sacarose",), "edit" if method == "POST" else "view")
    if path == "/api/sector-base" and method in {"GET", "POST"}:
        return (("sectors", "sacarose") if method == "GET" else ("sectors",), "edit" if method == "POST" else "view")
    if path == "/api/sector-base/import" and method == "POST":
        return (("sectors",), "edit")
    if path.startswith("/api/sector-base/") and method == "DELETE":
        return (("sectors",), "edit")
    if path.startswith("/api/return-analysis/"):
        if path == "/api/return-analysis/layouts" and method == "GET":
            return (("returns",), "view")
        if path.startswith("/api/return-analysis/layouts/") and method == "PUT":
            return (("returns",), "edit")
        if path == "/api/return-analysis/soil-wet" and method == "GET":
            return (("returns",), "view")
        if path == "/api/return-analysis/soil-wet/import" and method == "POST":
            return (("returns",), "edit")
        if path in {"/api/return-analysis/analyze", "/api/return-analysis/presentation"} and method == "POST":
            return (("returns",), "view")
    if path == "/api/reports/excel/analyze" and method == "POST":
        return (("reports",), "view")
    if path == "/api/history" and method == "GET":
        return (("history",), "view")
    return None


def user_can(user: dict, module: str, permission: str = "view") -> bool:
    if user["role"] == "admin":
        return True
    access = user.get("module_access", {}).get(module, {})
    return bool(access.get(permission))
