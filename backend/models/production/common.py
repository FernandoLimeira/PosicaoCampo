"""Produção Agrícola: constantes e normalização dos dados recebidos (unidade, data, textos e operações)."""
from __future__ import annotations

import re
from datetime import date
from typing import Any

from ..constants import ALLOWED_UNIT_CODES


MODULE_KEY = "production"


STATUS_STYLE_KEYS = {"active", "wet", "waiting", "stopped"}


DISPLAY_STYLES = {"operation", "front"}


def _normalize_unit(value: Any) -> str:
    unit = str(value or "").strip().upper()
    if unit not in ALLOWED_UNIT_CODES:
        raise ValueError("Unidade inválida para a Produção Agrícola.")
    return unit


def _normalize_work_date(value: Any) -> str:
    text = str(value or "").strip()
    try:
        parsed = date.fromisoformat(text)
    except ValueError as exc:
        raise ValueError("Data do apontamento inválida.") from exc
    if parsed.year < 2000 or parsed.year > 2100:
        raise ValueError("Data do apontamento inválida.")
    return parsed.isoformat()


def _clean_text(value: Any, field: str, max_length: int, *, required: bool = False) -> str:
    text = str(value or "").strip()
    if required and not text:
        raise ValueError(f"Informe {field}.")
    if len(text) > max_length:
        raise ValueError(f"{field.capitalize()} deve ter no máximo {max_length} caracteres.")
    return text


def _normalize_status(value: Any) -> str:
    return _clean_text(value, "o status", 120, required=True)


def _normalize_position(value: Any) -> int:
    try:
        position = int(value if value is not None else 0)
    except (TypeError, ValueError) as exc:
        raise ValueError("Ordem de exibição inválida.") from exc
    if position < 0 or position > 9999:
        raise ValueError("A ordem de exibição deve estar entre 0 e 9999.")
    return position


_ONLY_CODES = re.compile(r"\d+(?:\s*[\s/\-]\s*\d+)+")


def split_operations(value: Any) -> list[str]:
    """Separa as operações do lançamento. Aceita vírgula, ";" e "+" e, quando o trecho
    só tem códigos, também espaço, "/" e "-" ("338 457", "338/457"). Assim "338 — TRATOS"
    continua sendo uma operação só."""
    parts = []
    for part in re.split(r"[,;+]", str(value or "")):
        text = part.strip()
        parts.extend(re.split(r"\s*[\s/\-]\s*", text) if _ONLY_CODES.fullmatch(text) else [text])
    return [part for part in parts if part]


def _normalize_operations(value: Any) -> str:
    """Uma ou mais operações ("338, 457"), sem repetição, no máximo 10."""
    parts = []
    for part in split_operations(value):
        text = part.strip()
        if text and text.casefold() not in {item.casefold() for item in parts}:
            parts.append(text)
    if len(parts) > 10:
        raise ValueError("Informe no máximo 10 operações por lançamento.")
    return _clean_text(", ".join(parts), "a operação", 160)
