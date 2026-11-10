"""Normalização de identificadores de frente (fonte única).

Cada variante abaixo existe porque os consumidores dependem de saídas
diferentes; nenhuma delas deve ser trocada por outra sem migração dos dados
já gravados (por exemplo ``field_front_notes.front_key``).

| Função                         | Regra                                          | Usada por                         |
|--------------------------------|------------------------------------------------|-----------------------------------|
| front_key                      | remove prefixos (FT, FRENTE, EQ, unidade),     | rótulos de chuva                  |
|                                | sufixo "- SETOR/FAZENDA", espaços e zeros à    | (standardize_rain_labels)         |
|                                | esquerda; mantém letras ("13A" != "13B")       |                                   |
| position_front_key             | numérico -> str(int); demais textos casefold;  | Sacarose e espelhamento da        |
|                                | nunca levanta erro                             | posição oficial (models.units)    |
| validated_position_front_key   | mesma chave, mas valida (1-12 caracteres,      | acompanhamentos por frente        |
|                                | [\\w-./ ]) e levanta ValueError                 | (models.front_notes)              |
| position_front_sort_key        | numéricos primeiro, por valor; depois ordem    | ordenação da Sacarose             |
|                                | natural (natural_key)                          |                                   |
| explicit_front_code            | resolve a frente de origem apenas quando o     | análise de retornos               |
|                                | texto cita nome/código sem ambiguidade         | (services.return_analysis)        |
| normalize_label                | sem acentos, casefold, apenas [a-z0-9]         | comparação de nomes/cabeçalhos    |
"""
import re
import unicodedata
from typing import Any


def normalize_label(value: Any) -> str:
    """Texto comparável: sem acentos, ``casefold`` e apenas letras/dígitos separados por espaço."""
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.casefold().strip()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def natural_key(value: Any) -> tuple:
    """Ordem natural ("2" antes de "10") e sem diferenciar maiúsculas."""
    pieces = re.split(r"(\d+)", str(value or "").casefold())
    return tuple(int(piece) if piece.isdigit() else piece for piece in pieces)


def front_key(value):
    text = unicodedata.normalize('NFKC', str(value or '')).strip().upper()
    text = re.sub(r'^(?:(?:EQ(?:UIPE|UIPAMENTO)?|FRENTE|FRT|FT|F|CTT|CCT|PPT|NRD|RBR|PST)(?=[.\s:#-]|\d|$)[.\s:#-]*)+', '', text)
    text = re.sub(r'\s*[-–—|]\s*(?:SETOR|FAZENDA)\b.*$', '', text)
    text = re.sub(r'\s+', '', text)
    return re.sub(r'\d+', lambda match: str(int(match.group())), text)


def position_front_key(value: Any) -> str:
    """Chave de comparação da frente na posição oficial (Sacarose/posição)."""
    text = str(value or "").strip()
    if text.isdecimal():
        return str(int(text))
    return text.casefold()


def validated_position_front_key(value: Any) -> str:
    """Igual a ``position_front_key``, mas rejeita identificações fora do padrão."""
    name = str(value or '').strip()
    if not name or len(name) > 12 or not re.fullmatch(r'[\w\-./ ]+', name, re.UNICODE):
        raise ValueError('Identificação da frente inválida.')
    return str(int(name)) if name.isdecimal() else name.casefold()


def position_front_sort_key(value: Any) -> tuple[int, Any]:
    text = str(value or "").strip()
    if text.isdecimal():
        return (0, int(text))
    return (1, natural_key(text))


def explicit_front_code(value: Any, fronts: list[dict[str, Any]], unit_code: str = "") -> str | None:
    """Resolve only an explicit source front, without guessing from arbitrary digits."""
    text = str(value or "").strip()
    if not text:
        return None
    matches = {front["code"] for front in fronts if normalize_label(text) in
               {normalize_label(front["name"]), normalize_label(front["code"])}}
    numeric_text = re.sub(r"^" + re.escape(unit_code) + r"\s+(?=frente\b)", "", text,
                          flags=re.IGNORECASE) if unit_code else text
    numeric = re.fullmatch(r"(?:frente\s*)?(\d+)(?:[.,]0+)?", numeric_text, re.IGNORECASE)
    if numeric:
        matches.update(front["code"] for front in fronts
                       if front["code"].isdigit() and int(front["code"]) == int(numeric.group(1)))
    return next(iter(matches)) if len(matches) == 1 else None


def standardize_rain_labels(code, fronts, rain):
    keys = {front_key(row[0]) for row in fronts if isinstance(row, (list, tuple)) and row}
    entries = rain if isinstance(rain, list) else []

    def team(label):
        match = re.fullmatch(r'EQ(?:UIPE|UIPAMENTO)?[.\s:-]*0*(\d+)', str(label).strip(), re.I)
        number = int(match[1]) if match else 0
        return number if 3 <= number <= 12 else None

    legacy_nrd = str(code).upper() == 'NRD' and any(
        (team(row[0]) is not None and str(team(row[0])) not in keys and str(team(row[0]) + 10) in keys)
        or (re.fullmatch(r'FT[.\s:-]*0*8', str(row[0]).strip(), re.I) and '8' in keys)
        for row in entries if isinstance(row, (list, tuple)) and row
    )
    result = []
    for row in entries:
        if not isinstance(row, (list, tuple)) or not row:
            result.append(row)
            continue
        number = team(row[0]) if legacy_nrd else None
        # Decide linha a linha: uma equipe que já corresponde a uma frente
        # existente (e cuja +10 não existe) não é renumerada.
        if number is not None and str(number) in keys and str(number + 10) not in keys:
            number = None
        key = str(number + 10) if number is not None else front_key(row[0])
        match = re.fullmatch(r'(\d+)([A-Z]*)', key)
        label = 'FT ' + match[1].zfill(2) + match[2] if match else row[0]
        result.append([label, *row[1:]])
    return result
