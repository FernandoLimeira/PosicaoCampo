"""Classificação da posição de campo, compartilhada com o painel e a emissão."""

import json
import unicodedata
from pathlib import Path
from typing import Any


FIELD_STATUSES = json.loads(Path(__file__).with_name("field_statuses.json").read_text(encoding="utf-8"))


def _status_key(value: Any) -> str:
    text = " ".join(str(value or "").strip().upper().split())
    return "".join(char for char in unicodedata.normalize("NFD", text) if not unicodedata.combining(char))


_STATUSES_BY_KEY = {
    _status_key(label): item
    for item in FIELD_STATUSES
    for label in [item["label"], *item["aliases"]]
}


def field_status(value: Any) -> dict:
    key = _status_key(value)
    if "SOLO UMIDO" in key:
        key = "SOLO UMIDO"
    return _STATUSES_BY_KEY.get(key, _STATUSES_BY_KEY["MUDANCA"])


def field_unit_border(statuses: list[str]) -> str:
    groups = [field_status(status)["group"] for status in statuses]
    if not groups or all(group == "active" for group in groups):
        return "active"
    if all(group != "active" for group in groups):
        return "critical"
    return "attention"
