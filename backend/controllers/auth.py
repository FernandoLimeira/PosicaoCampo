"""Sessão do usuário, cookie de autenticação e limitação de tentativas de login."""
import threading
import time

from ..config import REMEMBER_SESSION_TTL_SECONDS, SESSION_COOKIE
from ..models.module_access import MODULES, get_module_access, landing_page
from ..models.production import get_user_access as get_production_user_access
from ..models.users import get_user_by_session
from .http import _cookies, _request_is_https

LOGIN_WINDOW_SECONDS = 5 * 60
LOGIN_MAX_FAILURES = 10
LOGIN_MAX_FAILURES_PER_IP = 30
LOGIN_TRACKED_KEYS_MAX = 5000
_login_failures = {}
_login_lock = threading.Lock()


def _client_key(environ, username=""):
    return (environ.get("REMOTE_ADDR", "unknown"), username.strip().casefold())


def _ip_key(environ):
    return (environ.get("REMOTE_ADDR", "unknown"), "*")


def _prune_login_failures(now):
    stale_keys = []
    for key, stamps in _login_failures.items():
        fresh = [stamp for stamp in stamps if now - stamp < LOGIN_WINDOW_SECONDS]
        if fresh:
            limit = LOGIN_MAX_FAILURES_PER_IP if key[1] == "*" else LOGIN_MAX_FAILURES
            _login_failures[key] = fresh[-limit:]
        else:
            stale_keys.append(key)
    for key in stale_keys:
        _login_failures.pop(key, None)

    if len(_login_failures) > LOGIN_TRACKED_KEYS_MAX:
        ordered = sorted(_login_failures, key=lambda key: _login_failures[key][-1])
        for key in ordered[: len(_login_failures) - LOGIN_TRACKED_KEYS_MAX]:
            _login_failures.pop(key, None)


def _login_blocked(environ, username):
    user_key = _client_key(environ, username)
    ip_key = _ip_key(environ)
    now = time.time()
    with _login_lock:
        _prune_login_failures(now)
        return (
            len(_login_failures.get(user_key, [])) >= LOGIN_MAX_FAILURES
            or len(_login_failures.get(ip_key, [])) >= LOGIN_MAX_FAILURES_PER_IP
        )


def _record_login_failure(environ, username):
    now = time.time()
    with _login_lock:
        _prune_login_failures(now)
        for key, limit in ((_client_key(environ, username), LOGIN_MAX_FAILURES), (_ip_key(environ), LOGIN_MAX_FAILURES_PER_IP)):
            attempts = list(_login_failures.get(key, []))
            attempts.append(now)
            _login_failures[key] = attempts[-limit:]


def _clear_login_failures(environ, username):
    # Limpa o bloqueio específico do usuário autenticado; o histórico agregado
    # do IP permanece para evitar pulverização de tentativas entre vários nomes.
    with _login_lock:
        _login_failures.pop(_client_key(environ, username), None)


def _session_user(environ):
    user = get_user_by_session(_cookies(environ).get(SESSION_COOKIE))
    if not user:
        return None
    try:
        user["module_access"] = get_module_access(int(user["id"]))
        user["production_access"] = get_production_user_access(int(user["id"]))
        user["home_path"] = landing_page(user["module_access"], user["production_access"]["enabled"])
    except (ValueError, TypeError):
        user["module_access"] = {item["key"]: {"view": False, "edit": False} for item in MODULES}
        user["production_access"] = {
            "enabled": False,
            "admin": False,
            "permissions": {"view": False, "fill": False, "configure": False},
            "units": [],
        }
    return user


def _is_admin(user):
    return bool(user and user.get("role") == "admin" and user.get("is_active", True))


def _auth_cookie(token, environ, *, remember_me=False):
    secure = "; Secure" if _request_is_https(environ) else ""
    persistent = f"; Max-Age={REMEMBER_SESSION_TTL_SECONDS}" if remember_me else ""
    return (
        "Set-Cookie",
        f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict{persistent}{secure}",
    )


def _clear_auth_cookie(environ):
    secure = "; Secure" if _request_is_https(environ) else ""
    return (
        "Set-Cookie",
        f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}",
    )
