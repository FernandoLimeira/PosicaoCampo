"""Produção Agrícola: fertirrigação do Polo SP (PPT e NRD), gestão em um lugar só.

Cada frente com operação de fertirrigação (509 ou 524) no lançamento do dia recebe um plano:
base de carregamento, tratores e CVs alocados e os parâmetros da conta (horas, ha/hora,
velocidades, tempos). A vazão e a recomendação de produtos vêm da O.S. do PIMS da mesma
operação da frente (componentes da O.S.); o raio vem da tabela setor × base. O dimensionamento
é o da planilha "Logística Fertirrigação" (``services.fert_dimensioning``).

Controle dos CVs (feito pelo analista):
- situação de cada CV/trator: operando (em frente), disponível, oficina, sem motorista, apoio
  ou inativo; só operando/disponível podem ir para uma frente;
- um CV só muda de frente se a recomendação de produtos das duas frentes for a mesma (o CV
  sai carregado da base com a mistura da recomendação);
- toda alocação, troca de frente e mudança de situação fica registrada (quem e quando).

O plano vale para o dia; sem plano no dia, a frente usa o último plano salvo (copiado).

Módulos:
- ``common``: constantes, unidade, frota e histórico;
- ``sources``: o que vem de fora do plano (lançamento do dia, O.S. do PIMS, raio, planos gravados);
- ``overview``: painel (frentes dimensionadas, frota e movimentações);
- ``plans``: gravação do plano do dia (alocação e troca de frente);
- ``week``: planejamento da semana e raio orçado;
- ``equipment``: cadastro e situação da frota e importação do raio.
"""
from .common import (
    ALLOCATABLE_STATUSES, EQUIPMENT_KINDS, EQUIPMENT_STATUSES, FERT_BASES, FERT_OPERATIONS, FERT_UNITS, FUELS,
    base_key,
)
from .equipment import delete_fert_equipment, import_fert_radius, require_fert_radius_import, save_fert_equipment
from .overview import fert_overview
from .plans import save_fert_plan
from .week import save_fert_settings, save_fert_week

__all__ = [
    "ALLOCATABLE_STATUSES", "EQUIPMENT_KINDS", "EQUIPMENT_STATUSES", "FERT_BASES", "FERT_OPERATIONS", "FERT_UNITS",
    "FUELS", "base_key", "delete_fert_equipment", "fert_overview", "import_fert_radius", "require_fert_radius_import",
    "save_fert_equipment", "save_fert_plan", "save_fert_settings", "save_fert_week",
]
