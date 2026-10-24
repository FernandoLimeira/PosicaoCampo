"""Identificadores de chuva padronizados, sem renumerar frentes operacionais."""
import re
import unicodedata


def front_key(value):
    text = unicodedata.normalize('NFKC', str(value or '')).strip().upper()
    text = re.sub(r'^(?:(?:EQ(?:UIPE|UIPAMENTO)?|FRENTE|FRT|FT|F|CTT|CCT|PPT|NRD|RBR|PST)(?=[.\s:#-]|\d|$)[.\s:#-]*)+', '', text)
    text = re.sub(r'\s*[-–—|]\s*(?:SETOR|FAZENDA)\b.*$', '', text)
    text = re.sub(r'\s+', '', text)
    return re.sub(r'\d+', lambda match: str(int(match.group())), text)


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
        key = str(number + 10) if number is not None else front_key(row[0])
        match = re.fullmatch(r'(\d+)([A-Z]*)', key)
        label = 'FT ' + match[1].zfill(2) + match[2] if match else row[0]
        result.append([label, *row[1:]])
    return result
