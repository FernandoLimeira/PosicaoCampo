// Confere a ordem dos scripts de cada template e garante que dois scripts da
// mesma página não declarem o mesmo nome global (function/const/let/class/var).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { BASE_SCRIPTS, PAGE_SCRIPTS, PAGE_TEMPLATES, EXPORT_SCRIPTS, readScript } = require('./page_scripts.js');

const TEMPLATES = path.join(__dirname, '../templates');
const scriptSources = file => [...fs.readFileSync(path.join(TEMPLATES, file), 'utf8')
  .matchAll(/<script\s+src="\/js\/([^"?]+)/g)].map(match => match[1]);

// Nomes de function/var criam propriedades no objeto global: executar o script
// sozinho num contexto vazio revela esses nomes, mesmo que a execução falhe
// logo depois (sem DOM). Redeclarar function/var em outro script não gera erro
// no navegador e sobrescreve silenciosamente; por isso a comparação explícita.
function globalPropertyNames(name) {
  const ctx = vm.createContext({});
  const before = new Set(Object.getOwnPropertyNames(vm.runInContext('globalThis', ctx)));
  try { vm.runInContext(readScript(name), ctx); } catch (_) { /* Sem DOM: só interessam as declarações. */ }
  return Object.getOwnPropertyNames(vm.runInContext('globalThis', ctx)).filter(key => !before.has(key));
}

// let/const/class repetidos entre scripts (ou com function/var) geram
// "Identifier has already been declared" ao instanciar o segundo script.
function lexicalConflicts(names) {
  const ctx = vm.createContext({});
  const conflicts = [];
  for (const name of names) {
    try { vm.runInContext(readScript(name), ctx); } catch (error) {
      if (/already been declared/.test(error.message)) conflicts.push(`${name}: ${error.message}`);
      else if (error.name === 'SyntaxError') throw error;
      // Demais erros vêm da falta de DOM durante a execução e são esperados.
    }
  }
  return conflicts;
}

function checkPage(page, names) {
  const owners = new Map();
  for (const name of names) {
    for (const global of globalPropertyNames(name)) {
      assert(!owners.has(global), `${page}: "${global}" declarado em ${owners.get(global)} e ${name}`);
      owners.set(global, name);
    }
  }
  assert.deepEqual(lexicalConflicts(names), [], `${page}: declarações repetidas`);
}

for (const [page, template] of Object.entries(PAGE_TEMPLATES)) {
  assert.deepEqual([...BASE_SCRIPTS, ...scriptSources(template)], PAGE_SCRIPTS[page],
    `${template} deve carregar os scripts na ordem de tests/page_scripts.js`);
}
assert.deepEqual(scriptSources('base.html'), BASE_SCRIPTS);
assert.deepEqual(scriptSources('login.html'), ['login.js']);

for (const [page, names] of Object.entries(PAGE_SCRIPTS)) checkPage(page, names);
checkPage('emissão global sem painel (testes)', [...BASE_SCRIPTS, ...EXPORT_SCRIPTS]);

// Todo arquivo de static/js pertence a alguma página.
const listed = new Set([...Object.values(PAGE_SCRIPTS).flat(), 'login.js']);
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const jsRoot = path.join(__dirname, '../static/js');
for (const file of walk(jsRoot)) {
  const relative = path.relative(jsRoot, file).split(path.sep).join('/');
  assert(listed.has(relative), `${relative} não é carregado por nenhuma página`);
}
console.log('OK: ordem dos scripts por página e nenhum nome global repetido entre scripts da mesma página.');
