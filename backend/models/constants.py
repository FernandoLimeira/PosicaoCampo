"""Constantes de domínio sem dependências internas.

Este módulo não importa nada do pacote ``backend``: pode ser usado por
qualquer camada (models, services, controllers) sem risco de import circular.
"""

ALLOWED_UNIT_CODES = ("PPT", "NRD", "RBR", "PST")
UNIT_DEFINITIONS = {
    "PPT": {"name": "PARAGUAÇU PAULISTA", "position": 0},
    "NRD": {"name": "NARANDIBA", "position": 1},
    "RBR": {"name": "RIO BRILHANTE", "position": 2},
    "PST": {"name": "PASSA TEMPO", "position": 3},
}
METRIC_DEFINITIONS = (
    ("🏭", "INDÚSTRIA", "TN/H", ""),
    ("⚙️", "MOAGEM TURNO", "TN/H", ""),
    ("🚚", "ENTREGA TURNO", "TN/H", ""),
    ("⬡", "ESTOQUE", "CARGAS", "stock"),
    ("⚙️", "MOAGEM ÚLTIMAS 3H", "TN/H", ""),
    ("🚚", "ENTREGA ÚLTIMAS 3H", "TN/H", ""),
)

ROLE_ADMIN = "admin"
ROLE_USER = "user"
ROLE_COORDINATOR = "coordinator"
ROLE_ANALYST = "analyst"
ALLOWED_ROLES = {ROLE_ADMIN, ROLE_USER, ROLE_COORDINATOR, ROLE_ANALYST}

# Limite único de tamanho do setor, compartilhado por posição, Sacarose e base.
MAX_SECTOR_LENGTH = 24

# Ordem de exibição das unidades na Sacarose.
SACAROSE_UNIT_CODES = ("NRD", "PPT", "RBR", "PST")
