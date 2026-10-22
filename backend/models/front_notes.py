"""Registro de acompanhamento por frente, isolado da posição operacional oficial.

Os apontamentos não alteram units, unit_history ou dados usados pela emissão.
"""
import json
import re
import time

from .storage import connection, validate_actor

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


def _ensure_schema(conn):
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


def _item(row):
    return {
        'id': row['id'], 'unit': row['unit_code'], 'front': row['front_label'],
        'front_key': row['front_key'], 'sector': row['sector_snapshot'],
        'shift': row['shift_code'], 'kind': row['kind'],
        'kind_label': NOTE_KINDS.get(row['kind'], row['kind']),
        'text': row['note'], 'author': row['author_name'],
        'created_at': row['created_at'],
    }


def front_notes_summary(unit):
    code = _unit(unit)
    with connection() as conn:
        _ensure_schema(conn)
        rows = conn.execute('''
          SELECT t.front_key, t.note_count, n.*
          FROM (
             SELECT front_key, COUNT(*) AS note_count, MAX(id) AS latest_id
             FROM field_front_notes WHERE unit_code=? GROUP BY front_key
          ) t
          JOIN field_front_notes n ON n.id=t.latest_id
        ''', (code,)).fetchall()
    return {row['front_key']: {'count': row['note_count'], 'latest': _item(row)} for row in rows}


def list_front_notes(unit, front, limit=100):
    code = _unit(unit)
    key = _front_key(front)
    with connection() as conn:
        _ensure_schema(conn)
        total = conn.execute('''
          SELECT COUNT(*) FROM field_front_notes WHERE unit_code=? AND front_key=?
        ''', (code, key)).fetchone()[0]
        rows = conn.execute('''
          SELECT * FROM field_front_notes
          WHERE unit_code=? AND front_key=? ORDER BY id DESC LIMIT ?
        ''', (code, key, limit)).fetchall()
    return {'entries': [_item(row) for row in rows], 'total': total}


def append_front_note(payload, actor):
    if not isinstance(payload, dict):
        raise ValueError('Dados do apontamento inválidos.')
    code = _unit(payload.get('unit'))
    key = _front_key(payload.get('front'))
    # Campo livre: registros novos não dependem de turno ou classificação.
    # Valores fixos mantêm compatibilidade com a tabela já criada no servidor.
    shift = ''
    kind = 'outros'
    note = str(payload.get('text') or '').strip()
    requested_sector = str(payload.get('sector') or '').strip()
    if not note or len(note) > 1500:
        raise ValueError('Preencha a observação (até 1.500 caracteres).')
    if any(ord(char) < 32 and char not in '\n\t' for char in note):
        raise ValueError('Descrição contém caracteres inválidos.')

    with connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        _ensure_schema(conn)
        validate_actor(conn, int(actor['id']))
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
        author = str(actor.get('name') or 'Usuário')[:80]
        timestamp = int(time.time())
        cursor = conn.execute('''
          INSERT INTO field_front_notes (
            unit_code, front_key, front_label, sector_snapshot, shift_code,
            kind, note, author_user_id, author_name, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (code, key, str(selected[0]).strip(), requested_sector, shift,
              kind, note, int(actor['id']), author, timestamp))
        row = conn.execute('SELECT * FROM field_front_notes WHERE id=?', (cursor.lastrowid,)).fetchone()
    return _item(row)
