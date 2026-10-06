"""Compatibilidade para integrações que ainda importam ``backend.database``.

Novos módulos devem importar a persistência de ``backend.models.database``.
"""

from .models.database import *  # noqa: F401,F403
