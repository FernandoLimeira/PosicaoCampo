import json
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from backend import config
from backend.models import database as db, storage
from backend.models.security import hash_password, token_digest


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name, value in {
            "DATA_DIR": self.root, "AUTH_DB_PATH": self.root / "usuarios.db",
            "OPERATIONS_DB_PATH": self.root / "dados.db", "LEGACY_DB_PATH": self.root / "posicao_campo.db",
        }.items():
            p = patch.object(config, name, value)
            p.start()
            self.addCleanup(p.stop)

    def units(self):
        return [{"code": code, "name": definition["name"], "rows": [], "metrics": [], "rain": []}
                for code, definition in db.UNIT_DEFINITIONS.items()]

    def seed(self):
        db.init_db()
        admin = db.create_or_update_admin("Admin", "Admin-pass-42")
        member = db.create_user("Operador", "Member-pass-42")
        db.initialize_units(self.units(), admin["id"])
        return admin, member

    @contextmanager
    def legacy_connection(self):
        conn = sqlite3.connect(config.LEGACY_DB_PATH)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def legacy(self, *, layouts=True):
        now = int(time.time())
        with self.legacy_connection() as conn:
            for statement in storage.SCHEMA_SQL.split(";"):
                if not statement.strip() or "schema_info" in statement:
                    continue
                if not layouts and "return_analysis_" in statement:
                    continue
                # A base legada anterior não possui os campos novos de perfil.
                statement = statement.replace(",\n    email TEXT NOT NULL DEFAULT '',\n    base_unit TEXT NOT NULL DEFAULT 'PPT'", "")
                conn.execute(statement.replace("auth.", ""))
            conn.execute("INSERT INTO users VALUES (7, 'LegacyAdmin', ?, 'admin', 1, ?)",
                         (hash_password("Legacy-pass-42"), now))
            conn.execute("INSERT INTO users VALUES (17, 'LegacyOperator', ?, 'user', 1, ?)",
                         (hash_password("Operator-pass-42"), now))
            conn.execute("INSERT INTO users VALUES (200, 'Deleted', '-', 'user', 1, ?)", (now,))
            conn.execute("DELETE FROM users WHERE id=200")
            conn.execute("INSERT INTO sessions VALUES (35, 7, ?, ?, ?)",
                         (token_digest("legacy-session"), now + 3600, now))
            conn.execute("UPDATE sqlite_sequence SET seq=300 WHERE name='sessions'")
            unit = {"code": "PPT", "name": db.UNIT_DEFINITIONS["PPT"]["name"], "rows": [], "metrics": [], "rain": []}
            payload = json.dumps(unit, ensure_ascii=False)
            conn.execute("INSERT INTO units VALUES (23, 'PPT', ?, 0, ?, 17, ?, 4)", (unit["name"], payload, now))
            conn.execute("INSERT INTO unit_history VALUES (41, 'PPT', ?, 17, 'atualização', NULL, ?, 4, ?)",
                         (unit["name"], payload, now))
            conn.execute("INSERT INTO sector_base VALUES ('101', '10', 'Fazenda', 'manual', 17, ?)", (now,))
            conn.execute("INSERT INTO sacarose_positions VALUES ('PPT', '02', '101', '10', 1, 17, ?)", (now,))
            if layouts:
                conn.execute("INSERT INTO return_analysis_fronts VALUES ('PPT', '02', 'Personalizada', 0, 17, ?)", (now,))
                conn.execute("INSERT INTO return_analysis_equipment VALUES ('PPT', '02', 999, 17, ?)", (now,))

    def test_physical_separation_and_no_automatic_copies(self):
        self.seed()
        with storage.auth_connection() as conn:
            self.assertEqual(storage._tables(conn), set(storage.AUTH_TABLES) | {"schema_info"})
        with storage.connection() as conn:
            self.assertEqual(storage._tables(conn), set(storage.DATA_TABLES) | {"schema_info"})
            storage.check_integrity(conn)
            self.assertEqual(conn.execute("PRAGMA main.journal_mode").fetchone()[0], "delete")
            self.assertEqual(conn.execute("PRAGMA auth.journal_mode").fetchone()[0], "delete")
        db.init_db()
        self.assertEqual({p.name for p in self.root.iterdir()}, {"usuarios.db", "dados.db"})

    def test_soil_wet_upgrade_preserves_old_pair_and_is_idempotent(self):
        admin, member = self.seed()
        token = db.create_session(member["id"])
        with storage.connection() as conn:
            snapshots = {table: [tuple(row) for row in conn.execute(f"SELECT * FROM {table}")]
                         for table in storage.CORE_DATA_TABLES}
            accounts = [tuple(row) for row in conn.execute("SELECT * FROM auth.users")]
            sessions = [tuple(row) for row in conn.execute("SELECT * FROM auth.sessions")]
            pair_id = storage._metadata(conn, "main")["pair_id"]
            conn.execute("DROP TABLE return_analysis_soil_wet")
            conn.execute("DELETE FROM schema_info WHERE key='return_soil_wet_schema_version'")
        for _ in range(2):
            db.init_db()
            with storage.connection() as conn:
                self.assertEqual(storage._metadata(conn, "main")["pair_id"], pair_id)
                self.assertEqual(storage._metadata(conn, "main")["return_soil_wet_schema_version"], "2")
                self.assertEqual([tuple(row) for row in conn.execute("SELECT * FROM auth.users")], accounts)
                self.assertEqual([tuple(row) for row in conn.execute("SELECT * FROM auth.sessions")], sessions)
                for table, original in snapshots.items():
                    self.assertEqual([tuple(row) for row in conn.execute(f"SELECT * FROM {table}")], original)
                storage.check_integrity(conn)
        self.assertEqual(db.get_user_by_session(token)["id"], member["id"])

    def test_soil_wet_v1_table_migrates_to_nullable_sector_without_data_loss(self):
        _, member = self.seed()
        now = int(time.time())
        with storage.connection() as conn:
            conn.execute("DROP TABLE return_analysis_soil_wet")
            conn.execute("""
                CREATE TABLE return_analysis_soil_wet (
                    unit_code TEXT NOT NULL, record_key TEXT NOT NULL, source_front TEXT NOT NULL DEFAULT '',
                    equipment INTEGER NOT NULL, operation_date TEXT NOT NULL, start_time TEXT NOT NULL,
                    end_time TEXT NOT NULL, duration_seconds INTEGER NOT NULL DEFAULT 0,
                    operation_code TEXT NOT NULL DEFAULT '', operation_description TEXT NOT NULL DEFAULT 'SOLO UMIDO',
                    operation_group TEXT NOT NULL DEFAULT '', sector INTEGER NOT NULL, field INTEGER,
                    farm TEXT NOT NULL DEFAULT '', import_file TEXT NOT NULL DEFAULT '', updated_by INTEGER,
                    updated_at INTEGER NOT NULL, PRIMARY KEY (unit_code, record_key)
                )
            """)
            conn.execute("""
                INSERT INTO return_analysis_soil_wet VALUES
                ('PPT','legacy','PPT FRENTE 02',1001,'2026-10-02','08:00:00','10:00:00',7200,'','SOLO UMIDO','',71,18,'FAZENDA A','legacy.xlsx',?,?)
            """, (member["id"], now))
            conn.execute("INSERT OR REPLACE INTO schema_info(key,value) VALUES ('return_soil_wet_schema_version','1')")
        db.init_db()
        with storage.connection() as conn:
            sector = next(row for row in conn.execute("PRAGMA main.table_info(return_analysis_soil_wet)") if row[1] == "sector")
            self.assertEqual(sector[3], 0)
            row = conn.execute("SELECT record_key, sector, farm FROM return_analysis_soil_wet WHERE record_key='legacy'").fetchone()
            self.assertEqual(tuple(row), ("legacy", 71, "FAZENDA A"))
            self.assertEqual(storage._metadata(conn, "main")["return_soil_wet_schema_version"], "2")

    def test_soil_wet_import_is_unit_scoped_upsert_and_survives_restart(self):
        from tests.test_return_analysis_integration import SOIL_HEADERS, soil_row, xlsx
        from backend.services.soil_wet_import import parse_soil_wet_file
        admin, member = self.seed()
        records = parse_soil_wet_file(xlsx([SOIL_HEADERS, soil_row()]), "soil.xlsx")["records"]
        result = db.import_return_soil_wet_records("PPT", records, member["id"], filename="soil.xlsx")
        self.assertEqual(result["imported"]["inserted"], 1)
        without_sector = [{**records[0], "record_key": "missing-sector", "sector": None, "farm": "Fazenda A", "field": 18}]
        missing_result = db.import_return_soil_wet_records("PPT", without_sector, member["id"], filename="soil-sem-setor.xlsx")
        self.assertEqual(missing_result["imported"]["inserted"], 1)
        self.assertTrue(any(item["sector"] is None for item in db.list_return_soil_wet_records("PPT")))
        self.assertEqual(db.get_return_soil_wet_summary("PST")["records"], 0)
        repeated = db.import_return_soil_wet_records("PPT", records, member["id"], filename="soil.xlsx")
        self.assertEqual(repeated["imported"]["unchanged"], 1)
        records[0]["end_time"] = "11:00:00"
        records[0]["duration_seconds"] = 10800
        updated = db.import_return_soil_wet_records("PPT", records, member["id"], filename="soil.xlsx")
        self.assertEqual(updated["imported"]["updated"], 1)
        db.init_db()
        stored = db.list_return_soil_wet_records("PPT")
        sector_record = next(item for item in stored if item["sector"] == 71)
        self.assertEqual(sector_record["duration_seconds"], 10800)
        db.delete_user(member["id"], admin["id"])
        with storage.connection() as conn:
            self.assertIsNone(conn.execute("SELECT updated_by FROM return_analysis_soil_wet").fetchone()[0])
            storage.check_integrity(conn)
        self.assertEqual(db.get_return_soil_wet_summary("PPT")["records"], 2)

    def test_soil_wet_import_failure_rolls_back_whole_batch(self):
        from tests.test_return_analysis_integration import SOIL_HEADERS, soil_row, xlsx
        from backend.services.soil_wet_import import parse_soil_wet_file
        admin, _ = self.seed()
        records = parse_soil_wet_file(xlsx([SOIL_HEADERS, soil_row()]), "soil.xlsx")["records"]
        with self.assertRaises(ValueError):
            db.import_return_soil_wet_records("PPT", records + [{}], admin["id"])
        self.assertEqual(db.get_return_soil_wet_summary("PPT")["records"], 0)
        with self.assertRaises(ValueError):
            db.import_return_soil_wet_records("PPT", records, 999999)
        self.assertEqual(db.get_return_soil_wet_summary("PPT")["records"], 0)
        for code in ("INVALID", "", "../PPT"):
            with self.subTest(code=code), self.assertRaises(ValueError):
                db.get_return_soil_wet_summary(code)

    def test_migration_preserves_ids_passwords_sessions_and_all_records(self):
        self.legacy()
        original = config.LEGACY_DB_PATH.read_bytes()
        storage.initialize_databases()
        with storage.connection() as target, self.legacy_connection() as source:
            for schema, tables in (("auth", storage.AUTH_TABLES), ("main", storage.DATA_TABLES)):
                for table in tables:
                    with self.subTest(table=table):
                        columns = ', '.join(f'"{row[1]}"' for row in source.execute(f'PRAGMA table_info({table})'))
                        self.assertEqual([tuple(r) for r in target.execute(f"SELECT {columns} FROM {schema}.{table}")],
                                         source.execute(f"SELECT * FROM {table}").fetchall())
            storage.check_integrity(target)
        self.assertEqual(config.LEGACY_DB_PATH.read_bytes(), original)
        db.init_db()
        self.assertEqual(db.authenticate_user("LegacyAdmin", "Legacy-pass-42")["id"], 7)
        self.assertEqual(db.get_user_by_session("legacy-session")["id"], 7)
        self.assertEqual(db.get_user_by_session("legacy-session")["base_unit"], 'PPT')
        self.assertEqual(db.get_user_by_session("legacy-session")["email"], '')
        self.assertEqual(db.list_units_payload()["meta"]["PPT"]["version"], 4)
        self.assertEqual(db.list_history()[0]["user_name"], "LegacyOperator")
        self.assertEqual(db.list_sacarose_positions()["PPT"][0]["exclude_image"], True)
        self.assertEqual(db.list_return_analysis_layouts("PPT")["units"][0]["fronts"][0]["equipment"], [999])
        member = db.create_user("Novo", "New-pass-42")
        self.assertGreater(member["id"], 200)
        db.create_session(member["id"])
        with storage.auth_connection() as conn:
            self.assertGreater(conn.execute("SELECT MAX(id) FROM sessions").fetchone()[0], 300)

    def test_migration_is_once_only_and_keeps_intentionally_empty_layouts(self):
        self.legacy()
        with self.legacy_connection() as conn:
            conn.execute("DELETE FROM return_analysis_equipment")
            conn.execute("DELETE FROM return_analysis_fronts")
        db.init_db()
        db.delete_user(17, 7)
        db.init_db()
        self.assertIsNone(db.authenticate_user("LegacyOperator", "Operator-pass-42"))
        self.assertEqual(db.list_return_analysis_layouts("PPT")["units"][0]["fronts"], [])
        self.assertTrue(config.LEGACY_DB_PATH.exists())

    def test_existing_pair_gets_additive_profile_upgrade_without_losing_accounts(self):
        # Simula o par já separado da versão anterior, sem os campos de perfil.
        old_schema = storage.SCHEMA_SQL.replace(",\n    email TEXT NOT NULL DEFAULT '',\n    base_unit TEXT NOT NULL DEFAULT 'PPT'", "")
        with patch.object(storage, 'SCHEMA_SQL', old_schema), patch.object(storage, '_upgrade_user_profile'):
            storage.initialize_databases()
        password_hash = hash_password('Original-pass-42')
        now = int(time.time())
        with storage.auth_connection() as conn:
            conn.execute("INSERT INTO users VALUES (42, 'Original', ?, 'user', 1, ?)", (password_hash, now))
            conn.execute("INSERT INTO sessions VALUES (13, 42, ?, ?, ?)", (token_digest('original-session'), now + 3600, now))
            original_users = [tuple(row) for row in conn.execute('SELECT * FROM users')]
            original_sessions = [tuple(row) for row in conn.execute('SELECT * FROM sessions')]
        db.init_db()
        db.init_db()
        with storage.auth_connection() as conn:
            self.assertEqual([tuple(row) for row in conn.execute('SELECT id,name,password_hash,role,is_active,created_at FROM users')], original_users)
            self.assertEqual([tuple(row) for row in conn.execute('SELECT * FROM sessions')], original_sessions)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM pragma_table_info('users') WHERE name IN ('email','base_unit')").fetchone()[0], 2)
        self.assertEqual(db.authenticate_user('Original', 'Original-pass-42')['id'], 42)
        self.assertEqual(db.get_user_by_session('original-session')['base_unit'], 'PPT')
        with storage.connection() as conn:
            storage.check_integrity(conn)

    def test_new_roles_profiles_and_multiple_admins_survive_restart(self):
        admin, _ = self.seed()
        users = []
        for role in ('admin', 'coordinator', 'analyst'):
            users.append(db.create_user('Level-' + role, 'Profile-pass-42', role=role,
                                        base_unit='NRD', email=role + '@example.com'))
        tokens = [db.create_session(user['id']) for user in users]
        db.init_db()
        for user, token in zip(users, tokens):
            self.assertEqual(db.authenticate_user(user['name'], 'Profile-pass-42'), user)
            self.assertEqual(db.get_user_by_session(token), user)
        db.create_or_update_admin(admin['name'], 'Recovered-pass-42')
        # Recuperar um administrador não pode remover o nível dos demais.
        self.assertEqual(db.get_user_by_session(tokens[0])['role'], 'admin')
        self.assertEqual(db.get_user_by_session(tokens[0])['email'], 'admin@example.com')

    def test_other_admins_are_hidden_and_protected_from_direct_mutations(self):
        admin, member = self.seed()
        other = db.create_user('SecondAdmin', 'Profile-pass-42', role='admin')
        inactive = db.create_user('InactiveAdmin', 'Profile-pass-42', role='admin', is_active=False)
        token = db.create_session(other['id'])
        self.assertEqual({u['id'] for u in db.list_users(admin['id'])}, {admin['id'],member['id']})
        self.assertEqual({u['id'] for u in db.list_users(other['id'])}, {other['id'],member['id']})
        for hidden in (other, inactive):
            for operation in (
                lambda: db.set_user_active(hidden['id'], False, admin['id']),
                lambda: db.set_user_active(hidden['id'], True, admin['id']),
                lambda: db.reset_user_password(hidden['id'], 'Changed-pass-42', admin['id']),
                lambda: db.delete_user(hidden['id'], admin['id']),
            ):
                with self.assertRaisesRegex(ValueError, 'Usuário não encontrado'):
                    operation()
        self.assertEqual(db.get_user_by_session(token)['id'], other['id'])
        self.assertIsNotNone(db.authenticate_user(other['name'], 'Profile-pass-42'))
        with self.assertRaisesRegex(ValueError, 'própria conta'):
            db.set_user_active(admin['id'], False, admin['id'])
        with self.assertRaisesRegex(ValueError, 'Usuário não encontrado'):
            db.set_user_active(admin['id'], False, other['id'])
        self.assertTrue(db.has_admin())

    def test_new_inactive_user_cannot_sign_in_or_create_session(self):
        self.seed()
        user = db.create_user('Inactive', 'Profile-pass-42', role='analyst', base_unit='PST', is_active=False)
        self.assertFalse(user['is_active'])
        self.assertIsNone(db.authenticate_user('Inactive', 'Profile-pass-42'))
        with self.assertRaises(ValueError):
            db.create_session(user['id'])

    def test_invalid_profile_fields_do_not_create_accounts(self):
        admin, _ = self.seed()
        for invalid in ({'role': 'root'}, {'role': []}, {'base_unit': 'XYZ'},
                        {'base_unit': None}, {'is_active': 'false'}, {'email': 'invalid'},
                        {'email': []}, {'email': 'x' * 255 + '@example.com'}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                db.create_user('Invalid', 'Profile-pass-42', **invalid)
        self.assertEqual(len(db.list_users(admin['id'])), 2)

    def test_older_schema_without_layouts_gets_initial_layout(self):
        self.legacy(layouts=False)
        db.init_db()
        self.assertEqual(len(db.list_return_analysis_layouts("PPT")["units"][0]["fronts"]), 6)

    def test_unknown_legacy_table_aborts_and_can_retry_without_partial_data(self):
        self.legacy()
        with self.legacy_connection() as conn:
            conn.execute("CREATE TABLE extra_data(value TEXT)")
        with self.assertRaisesRegex(RuntimeError, "Estrutura"):
            db.init_db()
        with storage.connection() as conn:
            self.assertEqual(storage._tables(conn), set())
            self.assertEqual(storage._tables(conn, "auth"), set())
        with self.legacy_connection() as conn:
            conn.execute("DROP TABLE extra_data")
        db.init_db()
        self.assertEqual(len(db.list_users(7)), 2)

    def test_corrupt_legacy_is_not_silently_replaced(self):
        config.LEGACY_DB_PATH.write_bytes(b"not a sqlite database")
        with self.assertRaises(sqlite3.DatabaseError):
            db.init_db()
        self.assertEqual(config.LEGACY_DB_PATH.read_bytes(), b"not a sqlite database")

    def test_missing_store_and_mismatched_pair_are_rejected(self):
        self.seed()
        with storage.auth_connection() as conn:
            conn.execute("UPDATE schema_info SET value='another-pair' WHERE key='pair_id'")
        with self.assertRaisesRegex(RuntimeError, "par completo"):
            db.init_db()
        config.AUTH_DB_PATH.unlink()  # Somente arquivo de teste dentro do temporário.
        with self.assertRaisesRegex(RuntimeError, "par completo"):
            db.init_db()

    def test_data_mutations_and_attribution_across_stores(self):
        admin, member = self.seed()
        uid = member["id"]
        self.assertIsNone(db.authenticate_user("Admin", "wrong-password"))
        token = db.create_session(uid)
        self.assertEqual(db.get_user_by_session(token)["name"], "Operador")
        item = db.save_sector_base_item("101", "10", "Fazenda", uid)
        self.assertEqual(item["updated_by"], "Operador")
        self.assertEqual(db.import_sector_base_items([{"sector": "102", "section": "20", "description": "Outra"}], uid)["created"], 1)
        db.save_sacarose_positions({"PPT": [{"front": "02", "sector": "101", "section": "10"}]}, uid, {"PPT": 1})
        current = db.list_units_payload()
        unit = current["units"][0]
        unit["observation"] = "Teste de gravação"
        saved = db.save_unit(unit, 0, uid, current["meta"]["PPT"]["version"])
        self.assertEqual(saved["meta"]["updated_by"], "Operador")
        with self.assertRaises(db.UnitConflictError):
            db.save_unit(unit, 0, admin["id"], 0)
        db.save_return_analysis_layouts("PPT", [{"code": "02", "name": "Equipe", "equipment": [123]}], uid)
        self.assertEqual(db.list_history()[0]["user_name"], "Operador")
        with storage.connection() as conn:
            storage.check_integrity(conn)
        db.set_user_active(uid, False, admin["id"])
        self.assertIsNone(db.get_user_by_session(token))
        self.assertIsNone(db.authenticate_user("Operador", "Member-pass-42"))
        db.set_user_active(uid, True, admin["id"])
        db.reset_user_password(uid, "Changed-pass-42", admin["id"])
        self.assertIsNotNone(db.authenticate_user("Operador", "Changed-pass-42"))

    def test_deleting_user_keeps_data_and_clears_every_reference_and_session(self):
        self.legacy()
        db.init_db()
        db.delete_user(17, 7)
        with storage.connection() as conn:
            for table, column in storage.USER_REFERENCES:
                self.assertEqual(conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {column}=17").fetchone()[0], 0)
                self.assertGreater(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)
            storage.check_integrity(conn)
        self.assertEqual(db.list_history()[0]["user_name"], "Usuário removido")
        with self.assertRaises(ValueError):
            db.delete_user(7, 7)

    def test_deleting_user_rolls_back_both_stores_if_auth_write_fails(self):
        self.legacy()
        db.init_db()
        token = db.create_session(17)
        with storage.auth_connection() as conn:
            conn.execute("CREATE TRIGGER block_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            db.delete_user(17, 7)
        self.assertEqual(db.get_user_by_session(token)["id"], 17)
        with storage.connection() as conn:
            for table, column in storage.USER_REFERENCES:
                self.assertGreater(conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {column}=17").fetchone()[0], 0)
            storage.check_integrity(conn)

    def test_invalid_author_is_rejected_before_writing_data(self):
        self.seed()
        with self.assertRaisesRegex(ValueError, "responsável"):
            db.save_sector_base_item("101", "10", "Fazenda", 98765)
        self.assertEqual(db.list_sector_base(), [])

    def test_concurrent_workers_initialize_a_consistent_pair(self):
        child = "\n".join((
            "import sys", "from pathlib import Path", "from backend import config",
            "from backend.models.database import init_db", "root = Path(sys.argv[1])",
            "config.DATA_DIR = root", "config.AUTH_DB_PATH = root / 'usuarios.db'",
            "config.OPERATIONS_DB_PATH = root / 'dados.db'",
            "config.LEGACY_DB_PATH = root / 'posicao_campo.db'", "init_db()",
        ))
        for attempt in range(3):
            root = self.root / str(attempt)
            workers = [subprocess.Popen(
                [sys.executable, "-c", child, str(root)],
                cwd=Path(__file__).resolve().parents[1],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            ) for _ in range(4)]
            results = []
            try:
                for worker in workers:
                    _, error = worker.communicate(timeout=20)
                    results.append((worker.returncode, error.decode("utf-8", errors="replace")))
            finally:
                for worker in workers:
                    if worker.poll() is None:
                        worker.kill()
                        worker.communicate()
            for status, error in results:
                self.assertEqual(status, 0, error)
            with patch.object(config, "AUTH_DB_PATH", root / "usuarios.db"), \
                    patch.object(config, "OPERATIONS_DB_PATH", root / "dados.db"):
                with storage.connection() as conn:
                    self.assertTrue(storage._validate_pair(conn))
                    storage.check_integrity(conn)
                    self.assertEqual(conn.execute("SELECT COUNT(*) FROM return_analysis_fronts").fetchone()[0], 6)


if __name__ == "__main__":
    unittest.main()
