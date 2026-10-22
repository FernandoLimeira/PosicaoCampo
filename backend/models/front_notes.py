"""Registro de acompanhamento por frente, isolado da posição operacional oficial.

Os apontamentos só alimentam a observação oficial após revisão e salvamento
no formulário da unidade. O registro original permanece no histórico.
"""
import json
import re
import time

from .storage import connection
from .module_access import module_access_from_conn
from ..services.operational_shifts import shift_at, shift_period

UNIT_CODES = {'PPT', 'NRD', 'RBR', 'PST'}
NOTE_KINDS = {
    'observacao': 'Observação',
    'parada': 'Ocorrência / parada',
    'previsao': 'Previsão de retorno',
    'mudanca': 'Mudança de área',
    'outros': 'Outros',
}


def _unit(value):
    code = str(value or '').strip().upper()
    if code not in UNIT_CODES:
        raise ValueError('Unidade inválida.')
    return code


def _front_key(value):
    name = str(value or '').strip()
    if not name or len(name) > 12 or not re.fullmatch(r'[\w\-./ ]+', name, re.UNICODE):
        raise ValueError('Identificação da frente inválida.')
    return str(int(name)) if name.isdecimal() else name.casefold()


def initialize_front_notes(conn):
    # A migração é aditiva e executada na conexão operacional, sem mexer nas unidades.
    conn.execute('''
        CREATE TABLE IF NOT EXISTS field_front_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          unit_code TEXT NOT NULL,
          front_key TEXT NOT NULL,
          front_label TEXT NOT NULL,
          sector_snapshot TEXT NOT NULL,
          shift_code TEXT NOT NULL,
          kind TEXT NOT NULL,
          note TEXT NOT NULL,
          author_user_id INTEGER NOT NULL,
          author_name TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
    ''')
    conn.execute('''
        CREATE INDEX IF NOT EXISTS ix_field_front_notes_unit_front_id
        ON field_front_notes(unit_code, front_key, id DESC)
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS ix_field_front_notes_unit_time ON field_front_notes(unit_code, created_at, id)')
    columns = {row[1] for row in conn.execute('PRAGMA table_info(field_front_notes)')}
    for name, definition in (
        ('highlighted', 'INTEGER NOT NULL DEFAULT 1'),
        ('resolved_at', 'INTEGER'),
        ('resolved_by', 'INTEGER'),
        ('work_date', "TEXT NOT NULL DEFAULT ''"),
    ):
        if name not in columns:
            conn.execute(f'ALTER TABLE field_front_notes ADD COLUMN {name} {definition}')
    for row in conn.execute("SELECT id,created_at,shift_code,work_date FROM field_front_notes WHERE work_date='' OR shift_code NOT IN ('A','B','C')").fetchall():
        period = shift_at(row[1])
        conn.execute('UPDATE field_front_notes SET work_date=?,shift_code=? WHERE id=?',
                     (row[3] or period['work_date'], row[2] if row[2] in ('A', 'B', 'C') else period['shift'], row[0]))


def _authorize(conn, actor, action):
    user = conn.execute('SELECT name,role,is_active FROM auth.users WHERE id=?', (actor['id'],)).fetchone()
    if not user or not user['is_active'] or not module_access_from_conn(
        conn, int(actor['id']), role=user['role']
    )['dashboard'][action]:
        raise PermissionError('Sem permissão para acompanhar as frentes de campo.')
    return user


def _item(row):
    return {
        'id': row['id'], 'unit': row['unit_code'], 'front': row['front_label'],
        'front_key': row['front_key'], 'sector': row['sector_snapshot'],
        'shift': row['shift_code'], 'kind': row['kind'],
        'work_date': row['work_date'],
        'kind_label': NOTE_KINDS.get(row['kind'], row['kind']),
        'text': row['note'], 'author': row['author_name'],
        'created_at': row['created_at'],
        'highlighted': bool(row['highlighted']),
        'resolved_at': row['resolved_at'],
    }


def front_notes_summary(unit, actor):
    code = _unit(unit)
    with connection() as conn:
        conn.execute('BEGIN')
        _authorize(conn, actor, 'view')
        rows = conn.execute('''
          SELECT t.front_key, t.note_count, t.highlight_count, n.*
          FROM (
             SELECT front_key, COUNT(*) AS note_count, MAX(id) AS latest_id,
                    SUM(CASE WHEN highlighted=1 AND resolved_at IS NULL THEN 1 ELSE 0 END) AS highlight_count
             FROM field_front_notes WHERE unit_code=? GROUP BY front_key
          ) t
          JOIN field_front_notes n ON n.id=t.latest_id
        ''', (code,)).fetchall()
        highlights = conn.execute('''
          SELECT * FROM (
            SELECT n.*, ROW_NUMBER() OVER (PARTITION BY front_key ORDER BY id DESC) AS rank
            FROM field_front_notes n WHERE unit_code=? AND highlighted=1 AND resolved_at IS NULL
          ) WHERE rank<=3 ORDER BY id DESC
        ''', (code,)).fetchall()
    result = {row['front_key']: {'count': row['note_count'], 'latest': _item(row),
              'highlight_count': row['highlight_count'], 'highlights': []} for row in rows}
    for row in highlights:
        result[row['front_key']]['highlights'].append(_item(row))
    return result


def list_front_notes(unit, front, actor, limit=100, before_id=None, open_only=False):
    code = _unit(unit)
    key = _front_key(front)
    if before_id is not None and (not isinstance(before_id, int) or before_id < 1):
        raise ValueError('Página de histórico inválida.')
    if not isinstance(open_only, bool):
        raise ValueError('Filtro de acontecimentos inválido.')
    with connection() as conn:
        conn.execute('BEGIN')
        _authorize(conn, actor, 'view')
        total = conn.execute('''
          SELECT COUNT(*) FROM field_front_notes WHERE unit_code=? AND front_key=?
          AND (?=0 OR (highlighted=1 AND resolved_at IS NULL))
        ''', (code, key, int(open_only))).fetchone()[0]
        rows = conn.execute('''
          SELECT * FROM field_front_notes
          WHERE unit_code=? AND front_key=? AND (? IS NULL OR id<?)
          AND (?=0 OR (highlighted=1 AND resolved_at IS NULL)) ORDER BY id DESC LIMIT ?
        ''', (code, key, before_id, before_id, int(open_only), limit + 1)).fetchall()
    return {'entries': [_item(row) for row in rows[:limit]], 'total': total,
            'next_cursor': rows[limit - 1]['id'] if len(rows) > limit else None}


def front_notes_for_shift(unit, actor, work_date=None, shift=None):
    code = _unit(unit)
    if work_date is None and shift is None:
        current = shift_at(int(time.time()))
        work_date, shift = current['work_date'], current['shift']
    start, end = shift_period(work_date, shift)
    with connection() as conn:
        conn.execute('BEGIN')
        _authorize(conn, actor, 'view')
        rows = conn.execute('''
          SELECT * FROM field_front_notes WHERE unit_code=? AND created_at>=? AND created_at<?
          ORDER BY front_key,sector_snapshot,id
        ''', (code, start, end)).fetchall()
    # O histórico preserva todos os lançamentos. Só a sugestão elimina textos
    # idênticos na mesma frente/setor, sem atribuir autores ao texto da imagem.
    groups = {}
    for row in rows:
        group = groups.setdefault((row['front_key'], row['sector_snapshot']),
                                  {'front': row['front_label'], 'sector': row['sector_snapshot'], 'points': {}})
        text = row['note'].strip()
        group['points'].setdefault(' '.join(text.split()).casefold(), text)
    def order(group):
        front = group['front']
        return (0, int(front), group['sector']) if front.isdecimal() else (1, front.casefold(), group['sector'])
    sections = [f"Frente {group['front']} · Setor {group['sector']}\n" +
                '\n'.join(f'• {text}' for text in group['points'].values())
                for group in sorted(groups.values(), key=order)]
    return {'unit': code, 'work_date': work_date, 'shift': shift, 'total': len(rows),
            'suggested_text': '\n\n'.join(sections)}


def append_front_note(payload, actor):
    if not isinstance(payload, dict):
        raise ValueError('Dados do apontamento inválidos.')
    code = _unit(payload.get('unit'))
    key = _front_key(payload.get('front'))
    kind = 'outros'
    note = str(payload.get('text') or '').strip()
    requested_sector = str(payload.get('sector') or '').strip()
    highlighted = payload.get('highlighted', True)
    if not isinstance(highlighted, bool):
        raise ValueError('A opção de destaque deve ser verdadeira ou falsa.')
    if not note or len(note) > 1500:
        raise ValueError('Preencha a observação (até 1.500 caracteres).')
    if any(ord(char) < 32 and char not in '\n\t' for char in note):
        raise ValueError('Descrição contém caracteres inválidos.')

    with connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        user = _authorize(conn, actor, 'edit')
        official = conn.execute('SELECT data_json FROM units WHERE code=?', (code,)).fetchone()
        if not official:
            raise ValueError('Unidade não cadastrada.')
        unit_payload = json.loads(official['data_json'])
        matches = [row for row in unit_payload.get('rows', [])
                   if isinstance(row, list) and len(row) >= 2 and _front_key(row[0]) == key]
        if not matches:
            raise ValueError('Frente não encontrada na posição oficial da unidade.')
        selected = next((row for row in matches if str(row[1]).strip() == requested_sector), None)
        if selected is None:
            raise ValueError('O setor desta frente mudou. Atualize a tela antes de registrar.')
        author = user['name']
        timestamp = int(time.time())
        period = shift_at(timestamp)
        cursor = conn.execute('''
          INSERT INTO field_front_notes (
            unit_code, front_key, front_label, sector_snapshot, shift_code,
            kind, note, author_user_id, author_name, created_at, highlighted, work_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (code, key, str(selected[0]).strip(), requested_sector, period['shift'],
              kind, note, int(actor['id']), author, timestamp, int(highlighted), period['work_date']))
        row = conn.execute('SELECT * FROM field_front_notes WHERE id=?', (cursor.lastrowid,)).fetchone()
    return _item(row)


def update_front_note(note_id, payload, actor):
    if not isinstance(payload, dict) or not payload or set(payload) - {'resolved', 'highlighted'}:
        raise ValueError('Atualização do apontamento inválida.')
    if any(not isinstance(value, bool) for value in payload.values()):
        raise ValueError('As opções do apontamento devem ser verdadeiras ou falsas.')
    with connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        _authorize(conn, actor, 'edit')
        row = conn.execute('SELECT * FROM field_front_notes WHERE id=?', (note_id,)).fetchone()
        if not row:
            raise ValueError('Apontamento não encontrado.')
        if 'resolved' in payload:
            conn.execute('UPDATE field_front_notes SET resolved_at=?,resolved_by=? WHERE id=?',
                         (int(time.time()) if payload['resolved'] else None,
                          int(actor['id']) if payload['resolved'] else None, note_id))
        if 'highlighted' in payload:
            conn.execute('UPDATE field_front_notes SET highlighted=? WHERE id=?',
                         (int(payload['highlighted']), note_id))
        row = conn.execute('SELECT * FROM field_front_notes WHERE id=?', (note_id,)).fetchone()
    return _item(row)
