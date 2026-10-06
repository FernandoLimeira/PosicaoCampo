"""Ponto de entrada WSGI da aplicação.

Este módulo permanece estável para o PythonAnywhere e para o servidor local.
A implementação HTTP vive na camada de controllers.
"""

from .controllers.application_controller import application

__all__ = ["application"]
