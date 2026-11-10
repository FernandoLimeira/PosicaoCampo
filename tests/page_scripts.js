// Ordem dos scripts de cada página (igual aos templates) e utilitários para
// carregá-los em contextos node:vm como scripts clássicos.
// tests/test_page_scripts.js confere esta lista com os templates.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../static/js');

// Carregados por templates/base.html em todas as páginas autenticadas.
const BASE_SCRIPTS = ['core/format.js', 'core/api.js', 'core/common.js', 'core/dialog.js'];

const PAGE_SCRIPTS = {
  '/': [...BASE_SCRIPTS, 'core/field-fronts.js', 'core/sector-base.js',
    'dashboard/dashboard.js', 'dashboard/field-notes.js', 'dashboard/editor.js', 'dashboard/app.js'],
  '/sacarose': [...BASE_SCRIPTS, 'reports-export/shared-drawing.js', 'reports-export/sacarose-export.js',
    'sacarose/sacarose.js'],
  '/producao': [...BASE_SCRIPTS, 'producao/production-consolidation.js', 'producao/production-config.js',
    'producao/producao.js', 'producao/service-orders.js', 'producao/production-sheet.js',
    'producao/production-catalog.js'],
  // Os dois scripts da Produção Agrícola só entram para quem tem acesso a ela.
  '/emitir-posicao-global': [...BASE_SCRIPTS, 'core/field-fronts.js', 'reports-export/shared-drawing.js',
    'reports-export/field-report-data.js', 'reports-export/global-report.js', 'reports-export/sacarose-export.js',
    'producao/production-consolidation.js', 'producao/production-export.js', 'emissao/emissao.js'],
  '/setores': [...BASE_SCRIPTS, 'core/sector-base.js', 'setores/setores.js'],
  '/relatorios': [...BASE_SCRIPTS, 'relatorios/relatorios.js'],
  '/retornos': [...BASE_SCRIPTS, 'retornos/return-analysis.js'],
  '/historico': [...BASE_SCRIPTS, 'historico/historico.js'],
  '/usuarios': [...BASE_SCRIPTS, 'usuarios/usuarios.js'],
};

const PAGE_TEMPLATES = {
  '/': 'index.html', '/sacarose': 'sacarose.html', '/producao': 'producao.html',
  '/emitir-posicao-global': 'emissao.html', '/setores': 'setores.html', '/relatorios': 'relatorios.html',
  '/retornos': 'retornos.html', '/historico': 'historico.html', '/usuarios': 'usuarios.html',
};

// Emissão individual: nenhuma página a carrega (somente os testes).
// Scripts da emissão global da Posição de Campo, carregados sem o painel.
const EXPORT_SCRIPTS = ['core/field-fronts.js', 'reports-export/shared-drawing.js',
  'reports-export/field-report-data.js', 'reports-export/global-report.js'];

function readScript(name) {
  return fs.readFileSync(path.join(JS_DIR, name), 'utf8');
}

function runScript(ctx, name, transform = source => source) {
  vm.runInContext(transform(readScript(name)), ctx, { filename: `static/js/${name}` });
}

// Carrega uma lista de scripts na ordem, ignorando os que já foram carregados no contexto.
function loadScripts(ctx, names, transform) {
  const loaded = ctx.__loadedScripts || (ctx.__loadedScripts = new Set());
  for (const name of names) {
    if (loaded.has(name)) continue;
    runScript(ctx, name, transform);
    loaded.add(name);
  }
}

// Scripts próprios da página (sem o núcleo de base.html), na ordem do template.
function pageScripts(page) {
  return PAGE_SCRIPTS[page].filter(name => !BASE_SCRIPTS.includes(name));
}

// Painel sem a chamada final initializeApp(), para os testes controlarem a carga.
const withoutInitializeApp = source => source.replace(/initializeApp\(\);\s*$/, '');

module.exports = {
  BASE_SCRIPTS, PAGE_SCRIPTS, PAGE_TEMPLATES, EXPORT_SCRIPTS,
  readScript, runScript, loadScripts, pageScripts, withoutInitializeApp,
};
