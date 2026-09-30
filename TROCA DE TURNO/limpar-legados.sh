#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

rm -f app.py database.py config.py app.js style.css report-template.jpg test_database.py download
rm -f css/relatorio.css js/register.js js/relatorio.js js/template-export-data.js assets/template-export.png
rm -rf __pycache__ backend/__pycache__ tests/__pycache__

echo "Limpeza concluída. Banco, backups, .venv e arquivos atuais foram preservados."
