"""Handlers HTTP por domínio.

Cada módulo expõe ``handle(req)``, que devolve a resposta WSGI ou ``None``
quando a rota não pertence a ele. A ordem de chamada fica em
``controllers.application_controller``.
"""
