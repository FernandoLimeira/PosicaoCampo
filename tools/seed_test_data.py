"""Alimenta o banco LOCAL com dados de teste para ver as telas funcionando.

    python tools/seed_test_data.py

O que entra (gravado pelas mesmas funções das telas, em nome do primeiro Administrador):
- Posição de Campo (CTT): frentes, métricas, chuva e apontamentos das 4 unidades;
- Cadastro de setores: setores com seção e fazenda;
- Produção Agrícola: frentes nos 3 grupos, operações, O.S. (base única) e
  lançamentos de hoje para cada unidade, com a chuva do dia.

Segurança:
- copia ``data/usuarios.db`` e ``data/dados.db`` para ``data/backups/`` antes de gravar;
- não cria contas: entre com a sua conta de Administrador;
- cada parte só é preenchida se ainda estiver vazia (rodar de novo não duplica nada);
- os nomes de fazenda/frente levam "TESTE" para não serem confundidos com dados reais.

Não use no servidor de produção.
"""
from __future__ import annotations

import json
import random
import sqlite3
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend import config  # noqa: E402
from backend.models import production, sectors, service_orders, units  # noqa: E402
from backend.models.database import init_db  # noqa: E402
from backend.models.storage import connection  # noqa: E402

UNITS = ["PPT", "NRD", "RBR", "PST"]
FARMS = ["SANTA ROSA", "BOA VISTA", "SÃO JOSÉ", "ÁGUA LIMPA", "TRÊS IRMÃOS", "PRIMAVERA", "SANTA FÉ", "ESPERANÇA"]
FRONTS = {  # grupo -> frentes
    "Preparo e Plantio": ["Preparo de solo", "Plantio mecanizado", "Sulcação"],
    "Tratos Culturais": ["Aplicação de herbicida", "Adubação de cobertura", "Cultivo"],
    "Fertirrigação": ["Vinhaça localizada", "Aspersão"],
}
OPERATIONS = [
    ("338", "PLANTIO MEIOSI", "Plantio mecanizado"), ("361", "PREPARO DO SOLO", "Preparo de solo"),
    ("396", "SULCAÇÃO", "Sulcação"), ("457", "TRATOS PLANTIO", "Adubação de cobertura"),
    ("512", "HERBICIDA PRÉ-EMERGENTE", "Aplicação de herbicida"), ("530", "CULTIVO MECÂNICO", "Cultivo"),
    ("611", "VINHAÇA LOCALIZADA", "Vinhaça localizada"), ("620", "ASPERSÃO", "Aspersão"),
]
MISSING_OPERATION = "620"  # nunca tem O.S. nos setores de teste (ver seed_production)
FIELD_STATUSES = ["EM ATIVIDADE", "EM ATIVIDADE", "EM ATIVIDADE", "MUDANÇA DE SETOR", "SOLO ÚMIDO", "PARADA", "AGUARDANDO PIPA"]


def backup() -> Path:
    target = config.DATA_DIR / "backups" / f"antes-dados-teste-{time.strftime('%Y%m%d-%H%M%S')}"
    target.mkdir(parents=True, exist_ok=True)
    for path in (config.AUTH_DB_PATH, config.OPERATIONS_DB_PATH):
        if path.exists():
            # Cópia consistente mesmo com o banco aberto.
            with sqlite3.connect(path) as source, sqlite3.connect(target / path.name) as copy:
                source.backup(copy)
    return target


def admin_id() -> int:
    with sqlite3.connect(config.AUTH_DB_PATH) as conn:
        row = conn.execute("SELECT id FROM users WHERE role='admin' AND is_active=1 ORDER BY id LIMIT 1").fetchone()
    if not row:
        raise SystemExit("Nenhum Administrador ativo. Rode antes: python -m backend.create_admin")
    return int(row[0])


def count(sql: str, *params) -> int:
    with connection() as conn:
        return int(conn.execute(sql, params).fetchone()[0])


def sector_list(unit_index: int) -> list[tuple[str, str, str]]:
    """Setores da unidade (setor, seção, fazenda). Cada unidade numa faixa própria."""
    rng = random.Random(unit_index)
    base = 3000 + unit_index * 400
    items = []
    for n in range(10):
        sector = str(base + n * 7 + rng.randint(0, 5))
        items.append((sector, str(1 + n % 3), f"FAZENDA TESTE {FARMS[(n + unit_index) % len(FARMS)]}"))
    return items


def seed_sectors(user: int) -> str:
    if count("SELECT COUNT(*) FROM sector_base"):
        return "setores: já havia dados, nada feito"
    items = [{"sector": s, "section": sec, "description": farm}
             for index, _ in enumerate(UNITS) for s, sec, farm in sector_list(index)]
    result = sectors.import_sector_base_items(items, user)
    return f"setores: {result.get('created', len(items))} cadastrados"


def seed_field_positions(user: int) -> str:
    done = []
    for index, code in enumerate(UNITS):
        with connection() as conn:
            row = conn.execute("SELECT data_json, version FROM units WHERE code=?", (code,)).fetchone()
        data = json.loads(row["data_json"]) if row else {"code": code}
        if data.get("rows"):
            continue
        rng = random.Random(100 + index)
        unit_sectors = sector_list(index)
        data["rows"] = [[f"F{n + 1:02d}", unit_sectors[n][0], "", FIELD_STATUSES[(n + index) % len(FIELD_STATUSES)],
                         f"{rng.uniform(128, 146):.1f}"] for n in range(6)]
        values = [rng.randint(380, 520), rng.randint(350, 500), rng.randint(360, 510), rng.randint(20, 60),
                  rng.randint(340, 520), rng.randint(330, 500)]
        data["metrics"] = [[m[0], m[1], v, m[3]] for m, v in zip(data.get("metrics") or [["", "", 0, ""]] * 6, values)]
        data["rain"] = [[f"PLUV-{n + 1:02d}", round(rng.uniform(0, 6), 1), round(rng.uniform(10, 60), 1)] for n in range(3)]
        data["observation"] = "Dados de TESTE: frentes operando normalmente, F06 aguardando manutenção."
        data["changes"] = "Dados de TESTE: F04 muda para o próximo setor às 14h."
        units.save_unit(data, units.UNIT_DEFINITIONS[code]["position"], user, int(row["version"]) if row else None)
        done.append(code)
    return f"posição de campo (CTT): {', '.join(done) or 'já havia dados, nada feito'}"


def seed_production(user: int) -> list[str]:
    report = []
    groups = {g["name"]: g["id"] for g in production.list_catalog(user, include_inactive=True)["groups"]}
    fronts = {}
    if count("SELECT COUNT(*) FROM production_service_fronts"):
        report.append("frentes da produção: já havia dados, nada feito")
        with connection() as conn:
            fronts = {r["name"]: int(r["id"]) for r in conn.execute("SELECT id,name FROM production_service_fronts")}
    else:
        position = 1
        for group_name, names in FRONTS.items():
            if group_name not in groups:
                continue
            for name in names:
                front = production.save_service_front(user, {
                    "name": name, "group_id": groups[group_name], "display_style": "operation",
                    "position": position, "units": UNITS, "is_active": True,
                })
                fronts[name] = int(front["id"])
                position += 1
        report.append(f"frentes da produção: {len(fronts)} cadastradas")

    if count("SELECT COUNT(*) FROM production_operations"):
        report.append("operações: já havia dados, nada feito")
    else:
        for index, (code, name, front_name) in enumerate(OPERATIONS):
            service_orders.save_operation(user, {"code": code, "name": name, "service_front_id": fronts.get(front_name),
                                                 "position": index})
        report.append(f"operações: {len(OPERATIONS)} cadastradas")

    if count("SELECT COUNT(*) FROM production_service_orders"):
        report.append("ordens de serviço: já havia dados, nada feito")
    else:
        records, number = [], 331000
        for index, _ in enumerate(UNITS):
            for n, (sector, section, _) in enumerate(sector_list(index)[:8]):
                for code, name, _ in (OPERATIONS[n % len(OPERATIONS)], OPERATIONS[(n + 3) % len(OPERATIONS)])[: 1 + n % 2]:
                    if code == MISSING_OPERATION:
                        continue
                    number += 1
                    plots = [str(p) for p in range(1, 2 + (number % 9))]
                    records.append({"number": str(number), "sector": sector, "section": section, "operation": code,
                                    "operation_name": name, "cost_center": f"30{5100 + n}", "plots": plots,
                                    "opened_on": f"2026-{10 + n % 2:02d}-{1 + (number % 27):02d}"})
        result = service_orders.import_service_orders(user, "PPT", records, filename="os-teste.xlsx")
        report.append(f"ordens de serviço: {result['imported']} importadas (base única)")

    today = date.today().isoformat()
    statuses = [s["code"] for s in production.list_statuses(user)["statuses"]]
    names = list(fronts)
    for index, unit in enumerate(UNITS):
        if count("SELECT COUNT(*) FROM production_user_items WHERE unit_code=? AND is_active=1", unit):
            report.append(f"lançamentos {unit}: já havia dados, nada feito")
            continue
        unit_sectors = sector_list(index)
        rows = []
        for n, name in enumerate(names):
            sector, section, _ = unit_sectors[n % len(unit_sectors)]
            ops = [OPERATIONS[n % len(OPERATIONS)][0]]
            if n % 4 == 1:
                ops.append(OPERATIONS[(n + 3) % len(OPERATIONS)][0])  # duas operações no setor
            if n % 4 == 3:
                ops.append(MISSING_OPERATION)  # operação sem O.S. no setor: coluna "Sem O.S."
            if n % 5 == 4:
                ops = []  # sem operação informada
            rows.append({"service_front_id": fronts[name], "sector": sector,
                         "section": section if unit in ("PST", "RBR") else "",
                         "status": statuses[(n + index) % len(statuses)], "operation": ", ".join(ops),
                         "observation": "Lançamento de TESTE" if n % 3 == 0 else ""})
        result = production.save_items_sheet(user, {"unit_code": unit, "work_date": today, "rows": rows})
        production.save_daily_summary(user, {"unit_code": unit, "work_date": today,
                                             "rain_turn_mm": round(1.5 * index, 1), "rain_accumulated_mm": 12.5 + 4 * index,
                                             "changes": "Dados de TESTE"})
        report.append(f"lançamentos {unit}: {result['saved']} frentes + chuva do dia")
    return report


def main() -> int:
    if "--yes" not in sys.argv:
        answer = input(f"Gravar dados de teste em {config.DATA_DIR}? [s/N] ").strip().lower()
        if answer not in {"s", "sim", "y", "yes"}:
            print("Nada foi gravado.")
            return 1
    init_db()
    user = admin_id()
    saved = backup()
    print(f"backup: {saved.relative_to(ROOT).as_posix()}")
    for line in [seed_sectors(user), seed_field_positions(user), *seed_production(user)]:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
