const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const elements = new Map();
  const events = {};
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', files: [], options: [], hidden: true, disabled: false, textContent: '',
      innerHTML: '', listeners: {}, classList: { add() {} },
      addEventListener(type, fn) { this.listeners[type] = fn; },
    });
    return elements.get(id);
  };
  let selectedUnit = 'PPT';
  let requests = [];
  let downloads = [];
  let handler;
  class TestURL extends URL {
    static createObjectURL() { return 'blob:presentation'; }
    static revokeObjectURL(url) { assert.equal(url, 'blob:presentation'); }
  }
  const ctx = vm.createContext({
    console, URL: TestURL, URLSearchParams,
    FormData: class { constructor() { this.values = []; } append(...values) { this.values.push(values); } },
    setTimeout(fn) { fn(); },
    document: {
      querySelector: element, querySelectorAll() { return []; },
      addEventListener(type, fn) { events[type] = fn; },
      body: { appendChild() {} },
      createElement() { return { click() { downloads.push({href: this.href, filename: this.download}); }, remove() {} }; },
    },
    window: { location: { href: '', search: '' } },
    getReportUnit() { return selectedUnit; },
    escapeHtml(value) { return String(value ?? ''); }, showToast() {}, closeAllModals() {},
    apiRequest: async () => ({units: []}),
    fetch: async (url, options) => { requests.push({url, options}); return handler(url, options); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js/return-analysis.js'), 'utf8'), ctx);
  await new Promise(resolve => setImmediate(resolve));
  const button = element('#return-generate-presentation');
  assert.equal(button.disabled, true);
  await ctx.generateReturnPresentation();
  assert.equal(requests.length, 0);
  const file = {name: 'historico.xlsx', size: 100};
  const report = {file: file.name, unit: {code: 'PPT'}, target_front: {name: 'Frente 02'}, records: 10, report: 'Resumo gerado', returns: []};
  async function analyze() {
    element('#return-analysis-unit').value = 'PPT';
    element('#return-analysis-front').value = '02';
    element('#return-min-gap').value = '1';
    element('#return-analysis-file').files = [file];
    handler = async () => ({ok: true, status: 200, json: async () => ({report, report_digest: 'a'.repeat(64)})});
    await ctx.processReturnAnalysis({preventDefault() {}});
    assert.equal(button.disabled, false);
  }
  const mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const success = () => ({ok: true, status: 200, headers: {get(name) { return name === 'Content-Type' ? mime : 'attachment; filename="analise-PPT.pptx"'; }}, blob: async () => ({size: 400})});
  await analyze();
  handler = async () => success();
  await button.listeners.click();
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].filename, 'analise-PPT.pptx');
  const request = requests.at(-1);
  assert(request.url.includes('/api/return-analysis/presentation?'));
  assert(request.url.includes('unit=PPT&front=02&min_gap=1&digest='));
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.body.values[0][1], file);
  assert.equal(button.disabled, false);
  let complete;
  handler = () => new Promise(resolve => { complete = resolve; });
  const generation = ctx.generateReturnPresentation();
  const count = requests.length;
  await ctx.generateReturnPresentation();
  assert.equal(requests.length, count);
  assert.equal(button.disabled, true);
  selectedUnit = 'NRD';
  events['report-unit-change']();
  complete(success());
  await generation;
  assert.equal(downloads.length, 1, 'Não baixa uma unidade anterior após mudar o filtro');
  assert.equal(button.disabled, true);
  selectedUnit = 'PPT';
  await analyze();
  handler = async () => ({ok: false, status: 409, json: async () => ({error: 'Layouts mudaram. Processe novamente.'})});
  await ctx.generateReturnPresentation();
  assert(element('#return-presentation-status').textContent.includes('Processe novamente'));
  assert.equal(button.disabled, false);
  handler = async () => ({ok: false, status: 401});
  await ctx.generateReturnPresentation();
  assert.equal(ctx.window.location.href, '/login');
  handler = async () => ({ok: true, status: 200, headers: {get() { return 'text/html'; }}});
  await ctx.generateReturnPresentation();
  assert(element('#return-presentation-status').textContent.includes('não retornou um arquivo PowerPoint'));
  assert.equal(downloads.length, 1);
  element('#return-analysis-front').listeners.change();
  assert.equal(button.disabled, true);
  await analyze();
  element('#return-analysis-file').listeners.change();
  assert.equal(button.disabled, true);
  await analyze();
  element('#return-min-gap').listeners.input();
  assert.equal(button.disabled, true);
  console.log('OK: apresentação PPTX, arquivo/escopo processado, download, erros, sessão, bloqueio de duplicação e resultados obsoletos.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
