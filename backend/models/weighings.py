"""Pesagem de cana do CTT: importação das cargas da balança e resumo por unidade/frente.

Mesma lógica da aba "Chegada" da planilha "Controle de entrega x Moagem", hora a hora.
Conferida com a NRD em 14/11/2026: moagem, CVs e entrega batem nas horas 00h-21h quando
o arquivo traz DT_REG_GUARITA (sem ela, os CVs pela entrada no pátio variam ±2 por hora):
- Horas: de 00:00 até a última hora do SELECT importado (vale até a próxima importação,
  independente do relógio); o dia é o mais recente do arquivo.
- Moagem da hora: soma do peso líquido (QT_LIQUIDO) das cargas com saída da balança
  na hora. Moagem do dia: soma das horas fechadas, desde 00:00:00.
- Densidade da hora: peso médio das julietas pesadas na hora (moagem ÷ cargas).
- Entrega da hora: CVs que chegaram na hora × 2 julietas × densidade da hora. CVs pelo padrão
  da planilha de cada polo: Polo SP conta caminhões; Polo MS conta cada julieta como 0,5 CV.
  Chegada = guarita (DATA_HORA_GUARITA), quando o arquivo traz; senão a entrada no pátio.
- Turno: média das horas do turno. Polo SP: A 00h-06h, B 07h-15h, C 16h-23h; Polo MS: A 00h-06h,
  B 07h-14h, C 15h-23h (como a planilha de cada polo).
- Últimas 3 h: média das 3 últimas horas fechadas.
- Referência ("dados até"): última saída da balança, limitada à última chegada (até
  onde o arquivo está completo); é o momento do estoque.
- Estoque: cargas que chegaram (nas 24 h até a referência) e ainda não tinham saído
  da balança na referência.
- Fuso: o Polo MS (RBR e PST) registra no horário local, uma hora a menos que Brasília.
  Os horários do arquivo, as horas, os turnos e o relógio do fechamento de cada unidade
  seguem o horário local dela; os turnos (A 00h-06h, B 07h-15h, C 16h-23h) são os mesmos.
- Frente de outra unidade (troca de cana): a frente é procurada nas frentes da Posição de
  Campo de cada unidade; se pertence a outra, conta como ATR recebido nesta e apoio daquela.
  O ATR dessa cana entra na média da unidade que recebeu (onde foi pesada), nunca na da dona.
"""
from __future__ import annotations

import json
import time
from datetime import date, datetime, time as dtime
from typing import Any

from ..services.front_identifiers import front_key, natural_key
from ..services.operational_shifts import FIELD_TIMEZONE, MS_UNIT_CODES, unit_timezone
from .constants import ALLOWED_UNIT_CODES
from .storage import connection, validate_actor

MAX_WEIGHING_RECORDS = 150_000
STOCK_WINDOW_SECONDS = 24 * 3600
LAST_HOURS = 3
JULIETAS_PER_TRUCK = 2
# Julietas do mesmo caminhão que chegam até 30 min depois da primeira são o mesmo CV.
CV_JULIETA_WINDOW = 30 * 60
# Turnos da planilha de cada polo, por hora cheia (horário local da unidade): no Polo MS a
# hora 15:00 já é do turno C (planilha da PST); no Polo SP o turno C começa às 16:00.
SHIFT_HOURS = {"A": range(0, 7), "B": range(7, 16), "C": range(16, 24)}
MS_SHIFT_HOURS = {"A": range(0, 7), "B": range(7, 15), "C": range(15, 24)}

_COLUMNS = (
    "unit_code", "release_no", "movement_date", "truck", "trailer", "front", "sector", "section",
    "net_kg", "atr", "patio_at", "scale_in_at", "scale_out_at", "guarita_at",
)


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    number = int(value)
    if not 0 < number < 2 ** 40:
        raise ValueError
    return number


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    number = float(value)
    if number != number or abs(number) > 1e12:
        raise ValueError
    return number


def import_weighings(user_id: int, records: Any, *, filename: str = "") -> dict[str, Any]:
    if not isinstance(records, list) or not records or len(records) > MAX_WEIGHING_RECORDS:
        raise ValueError("Lista de cargas inválida.")
    prepared = []
    for position, item in enumerate(records, start=1):
        try:
            unit = str(item["unit_code"]).strip().upper()
            release = str(item["release_no"]).strip()
            front = str(item["front"]).strip()
            if unit not in ALLOWED_UNIT_CODES or not release or not front:
                raise ValueError
            movement = str(item.get("movement_date") or "").strip()
            if movement:
                date.fromisoformat(movement)
            prepared.append((
                unit, release, movement, str(item.get("truck") or "").strip(), str(item.get("trailer") or "").strip(),
                front, str(item.get("sector") or "").strip(), str(item.get("section") or "").strip(),
                _optional_float(item.get("net_kg")), _optional_float(item.get("atr")),
                _optional_int(item.get("patio_at")), _optional_int(item.get("scale_in_at")),
                _optional_int(item.get("scale_out_at")), _optional_int(item.get("guarita_at")),
            ))
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise ValueError(f"Carga {position} com dados inválidos.") from exc

    now = int(time.time())
    placeholders = ", ".join("?" for _ in range(len(_COLUMNS) + 3))
    updates = ", ".join(f"{column}=excluded.{column}" for column in _COLUMNS[2:])
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        validate_actor(conn, user_id)
        # Cada importação substitui a base inteira: o banco guarda só o último SELECT
        # importado (sem histórico de pesagens antigas). Na mesma transação, então uma
        # importação inválida não apaga a base anterior.
        removed = conn.execute("DELETE FROM field_weighings").rowcount
        # Liberação repetida no mesmo arquivo: vale a última linha.
        conn.executemany(
            f"""INSERT INTO field_weighings ({", ".join(_COLUMNS)}, import_file, imported_by, imported_at)
                VALUES ({placeholders})
                ON CONFLICT(unit_code, release_no) DO UPDATE SET {updates},
                    import_file=excluded.import_file, imported_by=excluded.imported_by,
                    imported_at=excluded.imported_at""",
            [values + (str(filename or "")[:200], user_id, now) for values in prepared],
        )
    keys = {(values[0], values[1]) for values in prepared}
    by_unit = {code: 0 for code in ALLOWED_UNIT_CODES}
    # Cargas pesadas por unidade e data de movimento: mostra na importação se uma
    # unidade veio sem cargas ou com outra data.
    dates_by_unit: dict[str, dict[str, int]] = {code: {} for code in ALLOWED_UNIT_CODES}
    for values in prepared:
        by_unit[values[0]] += 1
        if values[2]:
            dates_by_unit[values[0]][values[2]] = dates_by_unit[values[0]].get(values[2], 0) + 1
    dates = sorted({values[2] for values in prepared if values[2]})
    return {
        "imported": len(keys), "removed": removed,
        "by_unit": by_unit, "dates": dates, "dates_by_unit": dates_by_unit,
        "pending": sum(1 for values in prepared if values[12] is None),
    }


def _front_owners(conn) -> dict[str, str]:
    """Frente (chave normalizada) -> unidade, pelas frentes da Posição de Campo.
    Frente cadastrada em mais de uma unidade fica sem dono (não vira "recebida")."""
    owners: dict[str, set[str]] = {}
    for code, data_json in conn.execute("SELECT code, data_json FROM units"):
        try:
            rows = json.loads(data_json or "{}").get("rows") or []
        except (TypeError, ValueError, AttributeError):
            continue
        for row in rows:
            if isinstance(row, list) and row and str(row[0] or "").strip():
                owners.setdefault(front_key(row[0]), set()).add(str(code).upper())
    return {key: next(iter(units)) for key, units in owners.items() if len(units) == 1}


def _tons(rows) -> float:
    return sum((row["net_kg"] or 0) for row in rows) / 1000


def _weighted_atr(rows) -> float | None:
    weighted = [(row["atr"], row["net_kg"] or 0) for row in rows if row["atr"] is not None and row["net_kg"]]
    total = sum(weight for _, weight in weighted)
    return round(sum(atr * weight for atr, weight in weighted) / total, 2) if total else None


def _round(value: float | None, digits: int = 1) -> float | None:
    return None if value is None else round(value, digits)


def _shift_table(unit_code: str | None = None) -> dict[str, range]:
    return MS_SHIFT_HOURS if unit_code in MS_UNIT_CODES else SHIFT_HOURS


def _shift_of_hour(hour: int, unit_code: str | None = None) -> str:
    return next(code for code, hours in _shift_table(unit_code).items() if hour in hours)


def _average(values) -> float | None:
    values = [value for value in values if value is not None]
    return sum(values) / len(values) if values else None


def _arrival(row) -> int | None:
    """Chegada da carga: guarita, quando o arquivo traz; senão a entrada no pátio."""
    return row["guarita_at"] or row["patio_at"]


def _truck_arrivals(rows) -> list[int]:
    """Chegada de cada CV (caminhão). As julietas do mesmo caminhão podem passar na guarita
    com alguns minutos de diferença (ex.: 19:06 e 19:07): as que chegam até
    ``CV_JULIETA_WINDOW`` depois da primeira formam um só CV, contado na hora da primeira,
    como a planilha, que conta a julieta de sequência 1."""
    starts: list[int] = []
    first_by_truck: dict[Any, int] = {}
    for row in sorted(rows, key=_arrival):
        arrival = _arrival(row)
        # Sem placa do caminhão, junta só as julietas com a mesma chegada.
        key = row["truck"] or ("", arrival)
        first = first_by_truck.get(key)
        if first is not None and arrival - first <= CV_JULIETA_WINDOW:
            continue
        first_by_truck[key] = arrival
        starts.append(arrival)
    return starts


def weighing_summary(work_date: Any = None, *, now: float | None = None, at_time: Any = None) -> dict[str, Any]:
    """Resumo do dia da pesagem importada (sem data: o dia mais recente do arquivo).

    As horas vão de 00:00 até a última hora que veio no SELECT importado, independente do
    relógio: a importação vale até a próxima. ``at_time`` ("HH:MM") ou ``now`` (epoch)
    limitam às horas encerradas até aquele momento (hora − 1 h), para conferir com uma
    planilha de fechamento tirada nele."""
    if work_date in (None, ""):
        with connection() as conn:
            latest = conn.execute(
                "SELECT MAX(movement_date) FROM field_weighings WHERE scale_out_at IS NOT NULL AND movement_date <> ''"
            ).fetchone()[0]
        selected = date.fromisoformat(latest) if latest else datetime.now(FIELD_TIMEZONE).date()
    else:
        try:
            selected = date.fromisoformat(str(work_date))
        except ValueError as exc:
            raise ValueError("Data da pesagem inválida.") from exc
    day = selected.isoformat()
    day_start = int(datetime.combine(selected, dtime.min, FIELD_TIMEZONE).timestamp())
    day_end = day_start + 86400
    if at_time not in (None, ""):
        try:
            hour, minute = (int(part) for part in str(at_time).split(":"))
            if not (0 <= hour <= 23 and 0 <= minute <= 59):
                raise ValueError
        except ValueError as exc:
            raise ValueError("Horário de fechamento inválido (use HH:MM).") from exc
        now = day_start + hour * 3600 + minute * 60
    with connection() as conn:
        owners = _front_owners(conn)
        weighed = conn.execute(
            "SELECT * FROM field_weighings WHERE scale_out_at IS NOT NULL AND movement_date=?", (day,)
        ).fetchall()
        # Folga de 1 h: o dia do Polo MS começa e termina uma hora depois do de Brasília.
        arrival_rows = conn.execute(
            "SELECT * FROM field_weighings WHERE COALESCE(guarita_at, patio_at) BETWEEN ? AND ?",
            (day_start - STOCK_WINDOW_SECONDS - 3600, day_end + 3600 - 1),
        ).fetchall()
        last_import = conn.execute(
            """SELECT w.import_file, w.imported_at, u.name AS imported_by_name
               FROM field_weighings w LEFT JOIN auth.users u ON u.id=w.imported_by
               ORDER BY w.imported_at DESC LIMIT 1"""
        ).fetchone()

    # Referência = momento em que o arquivo está completo: a última saída da balança,
    # limitada à última chegada do dia. Saídas depois dela ficam para a próxima importação.
    # Uma por polo (fuso): a balança de cada polo tem a sua extração.
    def polo_of(code: str) -> str:
        return getattr(unit_timezone(code), "key", str(unit_timezone(code)))

    references: dict[str, int | None] = {}
    for polo in {polo_of(code) for code in ALLOWED_UNIT_CODES}:
        codes = {code for code in ALLOWED_UNIT_CODES if polo_of(code) == polo}
        last_exit = max((row["scale_out_at"] for row in weighed if row["unit_code"] in codes), default=None)
        last_arrival = max((_arrival(row) for row in arrival_rows
                            if row["unit_code"] in codes and _arrival(row) >= day_start), default=None)
        references[polo] = min(value for value in (last_exit, last_arrival) if value) if last_exit else None
    reference = references.get(polo_of("PPT")) or next((value for value in references.values() if value), None)
    # Último dado do SELECT por polo (última saída da balança ou última chegada do dia).
    data_until: dict[str, int | None] = {}
    for polo in references:
        codes = {code for code in ALLOWED_UNIT_CODES if polo_of(code) == polo}
        moments = [row["scale_out_at"] for row in weighed if row["unit_code"] in codes]
        moments += [_arrival(row) for row in arrival_rows if row["unit_code"] in codes and _arrival(row) >= day_start]
        data_until[polo] = max(moments, default=None) if references[polo] else None

    def closing(unit_start: int, polo: str) -> tuple[list[int], int | None]:
        """Horas de 00:00 até a hora do último dado do SELECT (no fuso da unidade): a
        importação vale até a próxima, a qualquer hora. Com ``now``/``at_time``, só as horas
        encerradas até aquele momento (às 23:35: 00h a 22h no Polo SP, 00h a 21h no MS)."""
        last = data_until.get(polo)
        if not last:
            return [], None
        cutoff = min(unit_start + 86400, unit_start + ((last - unit_start) // 3600 + 1) * 3600)
        if now is not None:
            cutoff = min(cutoff, unit_start + max(0, (int(now) - unit_start) // 3600) * 3600)
        hours = [hour for hour in range(24) if unit_start + (hour + 1) * 3600 <= cutoff]
        return hours, unit_start + len(hours) * 3600 if hours else None

    # Resumo geral no horário de Brasília (Polo SP); cada unidade traz o seu.
    closed_hours, closed_until = closing(day_start, polo_of("PPT"))
    shift_code = _shift_of_hour(closed_hours[-1]) if closed_hours else None

    units = []
    support = []
    for code in ALLOWED_UNIT_CODES:
        tz = unit_timezone(code)
        unit_start = int(datetime.combine(selected, dtime.min, tz).timestamp())
        unit_hours, unit_closed_until = closing(unit_start, polo_of(code))
        unit_shift = _shift_of_hour(unit_hours[-1], code) if unit_hours else None
        # Moagem, cargas e frentes param no último segundo da última hora fechada.
        rows = [row for row in weighed if row["unit_code"] == code
                and unit_closed_until and row["scale_out_at"] < unit_closed_until]
        arrivals = [row for row in arrival_rows if row["unit_code"] == code]
        # Estoque: chegou nas 24 h até a referência do polo e ainda não tinha saído da balança nela.
        unit_reference = references.get(polo_of(code))
        stock = [row for row in arrivals
                 if unit_reference and unit_reference - STOCK_WINDOW_SECONDS <= _arrival(row) <= unit_reference
                 and (row["scale_out_at"] is None or row["scale_out_at"] > unit_reference)]
        day_density = _tons(rows) / len(rows) if rows else None
        # CVs da hora pelo padrão da planilha de cada polo: no Polo SP, caminhões (a julieta de
        # sequência 1); no Polo MS, cada julieta que chegou vale meio CV (6,5 · 5,5 ...).
        cv_arrivals = ([(_arrival(row), 1 / JULIETAS_PER_TRUCK) for row in arrivals] if code in MS_UNIT_CODES
                       else [(arrival, 1) for arrival in _truck_arrivals(arrivals)])
        hours = []
        for hour in unit_hours:
            start, end = unit_start + hour * 3600, unit_start + (hour + 1) * 3600
            milled = [row for row in rows if start <= row["scale_out_at"] < end]
            trucks = sum(weight for arrival, weight in cv_arrivals if start <= arrival < end)
            density = _tons(milled) / len(milled) if milled else day_density
            hours.append({
                "hour": hour, "shift": _shift_of_hour(hour, code), "milling_t": _round(_tons(milled)),
                "loads": len(milled), "density_t": _round(density, 3), "trucks": trucks,
                "delivery_t": _round(trucks * JULIETAS_PER_TRUCK * density) if density else None,
            })
        shift_hours = [item for item in hours if item["shift"] == unit_shift]
        recent_hours = hours[-LAST_HOURS:]
        fronts: dict[str, list] = {}
        for row in rows:
            fronts.setdefault(row["front"], []).append(row)
        front_list = []
        for front, front_rows in sorted(fronts.items(), key=lambda item: natural_key(item[0])):
            latest = max(front_rows, key=lambda row: row["scale_out_at"])
            owner = owners.get(front_key(front))
            entry = {
                "front": front, "home_unit": owner or code, "external": bool(owner and owner != code),
                "sector": latest["sector"], "section": latest["section"],
                "loads": len(front_rows), "tons": _round(_tons(front_rows)),
                "atr": _weighted_atr(front_rows), "last_at": latest["scale_out_at"],
            }
            front_list.append(entry)
            if entry["external"]:
                support.append({"front": front, "from_unit": owner, "to_unit": code,
                                "loads": entry["loads"], "tons": entry["tons"], "atr": entry["atr"]})
        units.append({
            "code": code,
            # Horário local da unidade: horas, turno e fechamento (Polo MS: uma hora a menos).
            "timezone": getattr(tz, "key", str(tz)),
            "reference_at": unit_reference,
            # Último dado do SELECT importado para esta unidade (polo), no seu fuso.
            "data_until": data_until.get(polo_of(code)),
            "closed_hours": len(unit_hours),
            "closed_until": unit_closed_until,
            "shift": unit_shift,
            # Faixas dos turnos A, B e C da unidade ([início, fim) em horas), para o gráfico.
            "shift_hours": {shift: [span.start, span.stop] for shift, span in _shift_table(code).items()},
            "milling_day_t": _round(_tons(rows)),
            "delivery_day_t": _round(sum(item["delivery_t"] or 0 for item in hours)),
            "loads_day": len(rows),
            "milling_shift_tph": _round(_average(item["milling_t"] for item in shift_hours)),
            "milling_last3h_tph": _round(_average(item["milling_t"] for item in recent_hours)),
            "delivery_shift_tph": _round(_average(item["delivery_t"] for item in shift_hours)),
            "delivery_last3h_tph": _round(_average(item["delivery_t"] for item in recent_hours)),
            # Projeção do dia (quadro "Projeções" da planilha): média por hora do dia × 24.
            "milling_projection_t": _round(_average(item["milling_t"] for item in hours) * 24) if hours else None,
            "delivery_projection_t": _round(_average(item["delivery_t"] for item in hours) * 24)
            if any(item["delivery_t"] is not None for item in hours) else None,
            "stock_loads": len(stock),
            "atr": _weighted_atr(rows),
            "hours": hours,
            "fronts": front_list,
            "received": [front for front in front_list if front["external"]],
        })

    return {
        "work_date": day,
        "reference_at": reference,
        "shift": {"code": shift_code} if shift_code else None,
        "closed_hours": len(closed_hours),
        "closed_until": closed_until,
        "units": units,
        "support": support,
        "last_import": dict(last_import) if last_import else None,
    }


# Consultas SQL da Entrega CTT: o SELECT que gera o Excel de pesagem no sistema de
# origem. O comando é só guardado aqui (para copiar), nunca executado.
MAX_QUERY_SQL_LENGTH = 20_000


def _query_payload(row) -> dict[str, Any]:
    return {
        "id": int(row["id"]), "name": row["name"], "sql": row["sql_text"], "position": int(row["position"]),
        "updated_at": int(row["updated_at"] or 0), "updated_by": row["updated_by_name"] or "-",
    }


_QUERY_SELECT = """SELECT q.*, u.name AS updated_by_name FROM field_sql_queries q
                   LEFT JOIN auth.users u ON u.id=q.updated_by"""


def list_delivery_queries() -> list[dict[str, Any]]:
    with connection() as conn:
        rows = conn.execute(f"{_QUERY_SELECT} ORDER BY q.position, q.name COLLATE NOCASE").fetchall()
    return [_query_payload(row) for row in rows]


def save_delivery_query(user_id: int, payload: Any, *, query_id: int | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Dados da consulta inválidos.")
    name = " ".join(str(payload.get("name") or "").split())[:120]
    sql = str(payload.get("sql") or "").strip()
    if not name:
        raise ValueError("Informe o nome da consulta.")
    if not sql:
        raise ValueError("Cole o comando SQL da consulta.")
    if len(sql) > MAX_QUERY_SQL_LENGTH:
        raise ValueError("O comando SQL deve ter no máximo 20.000 caracteres.")
    try:
        position = int(payload.get("position") or 0)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Ordem inválida.") from exc
    if not 0 <= position <= 9999:
        raise ValueError("A ordem deve ficar entre 0 e 9999.")
    now = int(time.time())
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        validate_actor(conn, user_id)
        if query_id is None:
            query_id = int(conn.execute(
                """INSERT INTO field_sql_queries(name,sql_text,position,created_by,updated_by,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (name, sql, position, user_id, user_id, now, now),
            ).lastrowid)
        elif conn.execute(
            "UPDATE field_sql_queries SET name=?,sql_text=?,position=?,updated_by=?,updated_at=? WHERE id=?",
            (name, sql, position, user_id, now, query_id),
        ).rowcount == 0:
            raise ValueError("Consulta não encontrada.")
        return _query_payload(conn.execute(f"{_QUERY_SELECT} WHERE q.id=?", (query_id,)).fetchone())


def delete_delivery_query(query_id: int) -> None:
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("DELETE FROM field_sql_queries WHERE id=?", (query_id,)).rowcount == 0:
            raise ValueError("Consulta não encontrada.")
