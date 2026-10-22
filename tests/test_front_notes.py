import tempfile
import unittest
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

from backend import config
from backend.models import database as db, front_notes as notes, storage


class FrontNotesTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        for key, value in {'DATA_DIR': root, 'AUTH_DB_PATH': root / 'usuarios.db',
                           'OPERATIONS_DB_PATH': root / 'dados.db', 'LEGACY_DB_PATH': root / 'legacy.db'}.items():
            setting = patch.object(config, key, value)
            setting.start()
            self.addCleanup(setting.stop)
        db.init_db()
        self.admin = db.create_or_update_admin('Admin', 'Admin-password-42')
        self.analyst = db.create_user('Analista', 'Analyst-password-42')
        db.initialize_units([
            {'code': code, 'name': definition['name'], 'rows': [
                ['01', '101', 'green', 'EM ATIVIDADE', ''], ['02', '102', 'yellow', 'SOLO ÚMIDO', '']],
             'metrics': [], 'rain': []} for code, definition in db.UNIT_DEFINITIONS.items()
        ], self.admin['id'])

    def add(self, text='Aguardar liberação da área', actor=None, **values):
        return notes.append_front_note({'unit': 'PPT', 'front': '01', 'sector': '101',
                                        'text': text, **values}, actor or self.analyst)

    def test_shared_highlights_keep_multiple_points_and_preserve_official_position(self):
        before = db.list_units_payload()
        first = self.add('Manutenção em andamento')
        self.add('Retorno previsto para 15h', actor=self.admin)
        self.add('Aguardando transbordo')
        self.add('Conferir acesso à área')
        self.add('Anotação complementar', highlighted=False)
        summary = notes.front_notes_summary('PPT', self.analyst)['1']
        self.assertEqual((summary['count'], summary['highlight_count']), (5, 4))
        self.assertEqual(len(summary['highlights']), 3)
        self.assertEqual(summary['latest']['text'], 'Anotação complementar')
        self.assertNotIn('Anotação complementar', [entry['text'] for entry in summary['highlights']])
        notes.update_front_note(first['id'], {'resolved': True}, self.admin)
        self.assertEqual(notes.front_notes_summary('PPT', self.analyst)['1']['highlight_count'], 3)
        history = notes.list_front_notes('PPT', '1', self.analyst)
        self.assertEqual(history['total'], 5)
        collected = []
        cursor = None
        while True:
            page = notes.list_front_notes('PPT', '1', self.analyst, limit=2, before_id=cursor)
            collected.extend(entry['id'] for entry in page['entries'])
            cursor = page['next_cursor']
            if cursor is None:
                break
        self.assertEqual(collected, [entry['id'] for entry in history['entries']])
        self.assertTrue(next(entry for entry in history['entries'] if entry['id'] == first['id'])['resolved_at'])
        notes.update_front_note(first['id'], {'resolved': False}, self.admin)
        self.assertEqual(notes.front_notes_summary('PPT', self.analyst)['1']['highlight_count'], 4)
        self.assertEqual(db.list_units_payload(), before)

    def test_units_and_fronts_are_isolated_and_stale_sector_is_rejected(self):
        self.add('Somente PPT')
        self.add('Somente NRD', unit='NRD')
        self.add('Outra frente', front='02', sector='102')
        self.assertEqual(notes.list_front_notes('NRD', '1', self.analyst)['entries'][0]['text'], 'Somente NRD')
        self.assertEqual(notes.list_front_notes('PPT', '2', self.analyst)['entries'][0]['text'], 'Outra frente')
        with self.assertRaisesRegex(ValueError, 'setor desta frente mudou'):
            self.add(sector='999')
        with self.assertRaisesRegex(ValueError, 'Frente não encontrada'):
            self.add(front='99')
        self.assertEqual(notes.list_front_notes('PPT', '01', self.analyst)['total'], 1)

    def test_permissions_are_checked_against_database_and_inputs_are_validated(self):
        entry = self.add()
        for payload in ({'resolved': 'false'}, {'highlighted': 1}, {'text': 'alterado'}, {}):
            with self.assertRaises(ValueError):
                notes.update_front_note(entry['id'], payload, self.analyst)
        for values in ({'text': ''}, {'text': 'x' * 1501}, {'text': '\x00'}, {'highlighted': 'true'}):
            with self.assertRaises(ValueError):
                self.add(**values)
        with storage.auth_connection() as conn:
            conn.execute('INSERT INTO user_module_permissions(user_id,module_key,can_view,can_fill,updated_at) VALUES (?,?,?,?,?)',
                         (self.analyst['id'], 'dashboard', 1, 0, 1))
        fake_admin = {**self.analyst, 'role': 'admin'}
        self.assertEqual(notes.list_front_notes('PPT', '01', fake_admin)['total'], 1)
        with self.assertRaises(PermissionError):
            self.add(actor=fake_admin)
        with self.assertRaises(PermissionError):
            notes.update_front_note(entry['id'], {'resolved': True}, fake_admin)
        with storage.auth_connection() as conn:
            conn.execute('UPDATE user_module_permissions SET can_view=0 WHERE user_id=?', (self.analyst['id'],))
        with self.assertRaises(PermissionError):
            notes.front_notes_summary('PPT', fake_admin)

    def test_concurrent_analysts_do_not_overwrite_each_other(self):
        barrier = Barrier(4)
        def write(index):
            barrier.wait(timeout=10)
            return self.add(f'Ponto {index}', actor=self.admin if index % 2 else self.analyst)
        with ThreadPoolExecutor(max_workers=4) as pool:
            entries = list(pool.map(write, range(4)))
        self.assertEqual(len({entry['id'] for entry in entries}), 4)
        history = notes.list_front_notes('PPT', '01', self.analyst)
        self.assertEqual({entry['text'] for entry in history['entries']}, {f'Ponto {index}' for index in range(4)})
        self.assertEqual(notes.front_notes_summary('PPT', self.analyst)['1']['highlight_count'], 4)

    def test_existing_notes_gain_new_fields_without_losing_history(self):
        entry = self.add('Registro existente')
        with storage.connection() as conn:
            for column in ('highlighted', 'resolved_at', 'resolved_by', 'work_date'):
                conn.execute(f'ALTER TABLE field_front_notes DROP COLUMN {column}')
            conn.execute("UPDATE field_front_notes SET shift_code=''")
        for _ in range(2):
            db.init_db()
            history = notes.list_front_notes('PPT', '1', self.analyst)
            self.assertEqual(history['total'], 1)
            self.assertEqual(history['entries'][0]['id'], entry['id'])
            self.assertTrue(history['entries'][0]['highlighted'])
            self.assertIsNone(history['entries'][0]['resolved_at'])
            from backend.services.operational_shifts import shift_at
            expected = shift_at(entry['created_at'])
            self.assertEqual(history['entries'][0]['shift'], expected['shift'])
            self.assertEqual(history['entries'][0]['work_date'], expected['work_date'])

    def test_daily_history_keeps_occurrences_and_original_analyst_after_completion(self):
        first = self.add('Manutenção da frente')
        second = self.add('Previsão de liberação', actor=self.admin, highlighted=False)
        self.add('Acontecimento de outra unidade', unit='NRD')
        notes.update_front_note(first['id'], {'resolved': True}, self.admin)
        history = db.list_history(unit_code='PPT')
        occurrences = [entry for entry in history if entry['kind'] == 'front_note']
        self.assertEqual(len(occurrences), 2)
        self.assertTrue(any(entry['kind'] == 'position' for entry in history))
        self.assertEqual(len({entry['id'] for entry in history}), len(history))
        saved = next(entry for entry in occurrences if entry['id'] == f"front-note:{first['id']}")
        self.assertEqual((saved['front'], saved['sector'], saved['text'], saved['user_name']),
                         ('01', '101', 'Manutenção da frente', 'Analista'))
        self.assertTrue(saved['resolved_at'])
        self.assertEqual(saved['created_at'], first['created_at'])
        self.assertIn(f"front-note:{second['id']}", {entry['id'] for entry in occurrences})
        db.delete_user(self.analyst['id'], self.admin['id'])
        saved = next(entry for entry in db.list_history(unit_code='PPT') if entry['id'] == f"front-note:{first['id']}")
        self.assertEqual(saved['user_name'], 'Analista')

    def test_shift_draft_separates_occurrences_and_only_reviewed_text_updates_image_source(self):
        original = db.list_units_payload()
        def add_at(utc, text, **values):
            timestamp = int(datetime.fromisoformat(utc).timestamp())
            with patch.object(notes.time, 'time', return_value=timestamp):
                return self.add(text, **values)
        add_at('2026-10-22T02:59:59+00:00', 'Turno C do dia anterior')
        first = add_at('2026-10-22T03:00:00+00:00', 'Manutenção da frente', shift='C', work_date='2000-01-01')
        add_at('2026-10-22T10:19:59+00:00', 'manutenção da frente', actor=self.admin, highlighted=False)
        add_at('2026-10-22T10:20:00+00:00', 'Liberação no turno B')
        add_at('2026-10-22T12:00:00+00:00', 'Outra unidade', unit='NRD')
        add_at('2026-10-22T18:40:00+00:00', 'Avaliação no turno C')
        notes.update_front_note(first['id'], {'resolved': True}, self.admin)
        self.assertEqual((first['work_date'], first['shift']), ('2026-10-22', 'A'))
        draft = notes.front_notes_for_shift('PPT', self.analyst, '2026-10-22', 'A')
        self.assertEqual(draft['total'], 2)
        self.assertEqual(draft['suggested_text'], 'Frente 01 · Setor 101\n• Manutenção da frente')
        self.assertNotIn('Analista', draft['suggested_text'])
        self.assertIn('Liberação', notes.front_notes_for_shift('PPT', self.analyst, '2026-10-22', 'B')['suggested_text'])
        self.assertEqual(db.list_units_payload(), original)
        unit = next(unit for unit in original['units'] if unit['code'] == 'PPT')
        reviewed = {**unit, 'observation': draft['suggested_text'] + '\nEquipe avisada.',
                    'observation_period': {'work_date': draft['work_date'], 'shift': draft['shift']}}
        saved = db.save_unit(reviewed, 0, self.admin['id'])
        self.assertEqual(saved['unit']['observation'], reviewed['observation'])
        position = next(item for item in db.list_history(unit_code='PPT')
                        if item['kind'] == 'position' and item['version'] == saved['meta']['version'])
        self.assertEqual((position['work_date'], position['shift']), ('2026-10-22', 'A'))
        with self.assertRaises(ValueError):
            notes.front_notes_for_shift('PPT', self.analyst, '2026-10-22', None)


if __name__ == '__main__':
    unittest.main()
