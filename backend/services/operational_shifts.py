"""Calendário dos turnos de campo no horário de Brasília."""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    FIELD_TIMEZONE = ZoneInfo('America/Sao_Paulo')
except ZoneInfoNotFoundError:
    # Windows pode não fornecer a base IANA. Brasília usa UTC-3 nestes turnos.
    FIELD_TIMEZONE = timezone(timedelta(hours=-3), 'America/Sao_Paulo')

SHIFT_MINUTES = {'A': (0, 440), 'B': (440, 940), 'C': (940, 1440)}


def shift_period(work_date, shift):
    if not isinstance(work_date, str) or len(work_date) != 10:
        raise ValueError('Data do turno inválida.')
    try:
        day = date.fromisoformat(work_date)
        start, end = SHIFT_MINUTES[shift]
    except (ValueError, KeyError, TypeError) as exc:
        raise ValueError('Data ou turno inválido.') from exc
    midnight = datetime.combine(day, time.min, FIELD_TIMEZONE)
    return int((midnight + timedelta(minutes=start)).timestamp()), int((midnight + timedelta(minutes=end)).timestamp())


def shift_at(timestamp):
    local = datetime.fromtimestamp(timestamp, FIELD_TIMEZONE)
    minutes = local.hour * 60 + local.minute
    shift = 'A' if minutes < 440 else 'B' if minutes < 940 else 'C'
    work_date = local.date().isoformat()
    start, end = shift_period(work_date, shift)
    return {'work_date': work_date, 'shift': shift, 'start_at': start, 'end_at': end}
