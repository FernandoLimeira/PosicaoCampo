import json
import os
import tempfile
import time
import unittest
from pathlib import Path

from backend import database


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        self.original_paths = (database.DATA_DIR, database.DB_PATH, database.BACKUP_DIR)
        database.DATA_DIR = root / "data"
        database.DB_PATH = database.DATA_DIR / "posicao_campo.db"
        database.BACKUP_DIR = database.DATA_DIR / "backups"
        database.init_db()
        self.admin = database.create_or_update_admin("Admin Teste", "SenhaForte123")

    def tearDown(self):
        database.DATA_DIR, database.DB_PATH, database.BACKUP_DIR = self.original_paths
        self.tempdir.cleanup()

    @staticmethod
    def default_units():
        return [
            {"code": "PPT", "name": "PARAGUAÇU PAULISTA", "rows": [], "metrics": [], "observation": "-", "changes": "-", "rain": []},
            {"code": "NRD", "name": "NARANDIBA", "rows": [], "metrics": [], "observation": "-", "changes": "-", "rain": []},
            {"code": "RBR", "name": "RIO BRILHANTE", "rows": [], "metrics": [], "observation": "-", "changes": "-", "rain": []},
            {"code": "PST", "name": "PASSA TEMPO", "rows": [], "metrics": [], "observation": "-", "changes": "-", "rain": []},
        ]

    def test_rejects_short_password_for_new_user(self):
        with self.assertRaisesRegex(ValueError, "pelo menos 8 caracteres"):
            database.create_user("Operador", "1234")

    def test_conflict_preserves_first_concurrent_save(self):
        database.initialize_units(self.default_units(), self.admin["id"])
        payload = database.list_units_payload()
        unit = payload["units"][0]
        version = payload["meta"]["PPT"]["version"]

        first = dict(unit)
        first["observation"] = "primeiro salvamento"
        saved = database.save_unit(first, 0, self.admin["id"], version)
        self.assertEqual(saved["meta"]["version"], version + 1)

        second = dict(unit)
        second["observation"] = "salvamento concorrente"
        with self.assertRaises(database.UnitConflictError):
            database.save_unit(second, 0, self.admin["id"], version)

        current = database.list_units_payload()["units"][0]
        self.assertEqual(current["observation"], "primeiro salvamento")

    def test_periodic_backup_contains_current_database_state(self):
        database.initialize_units(self.default_units(), self.admin["id"])
        first_backup = database.create_backup(force=True)
        old = time.time() - database.BACKUP_INTERVAL_SECONDS - 60
        os.utime(first_backup, (old, old))

        payload = database.list_units_payload()
        unit = payload["units"][0]
        version = payload["meta"]["PPT"]["version"]
        changed = dict(unit)
        changed["observation"] = "marcador-backup"
        database.save_unit(changed, 0, self.admin["id"], version)

        backup = database.create_backup()
        self.assertNotEqual(backup, first_backup)

        import sqlite3
        with sqlite3.connect(backup) as conn:
            row = conn.execute("SELECT data_json FROM units WHERE code = 'PPT'").fetchone()
        self.assertEqual(json.loads(row[0])["observation"], "marcador-backup")


if __name__ == "__main__":
    unittest.main()
