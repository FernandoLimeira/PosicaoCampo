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
  const errors = [];
  let handler;
  class TestURL extends URL {
    static createObjectURL() { return 'blob:presentation'; }
    static revokeObjectURL(url) { assert.equal(url, 'blob:presentation'); }
  }
  const ctx = vm.createContext({
    console: {...console, error(...values) { errors.push(values); }}, URL: TestURL, URLSearchParams,
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
    apiRequest: async () => ({units: ['PPT', 'NRD', 'RBR', 'PST'].map(code => ({code, name: code, fronts: []}))}),
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
  assert(request.url.includes('traces=none'), 'Sem retornos não inventa rastros');
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.body.values[0][1], file);
  assert.equal(button.disabled, false);
  report.returns = Array.from({length: 8}, (_, index) => ({sector: index % 7 + 1, days_out: index + 1,
    return_date: '2026-10-04', sector_reference: {status: 'matched', farm: 'Fazenda teste'}}));
  await analyze();
  assert.equal(element('#return-trace-options').hidden, false);
  const selected = () => Array.from(vm.runInContext('returnTraceSelection', ctx));
  assert.deepEqual(selected(), [7, 6, 5], 'Três maiores intervalos de setores distintos');
  assert(element('#return-trace-list').innerHTML.includes('retorno em 04/10/2026'));
  function choose(index, checked) {
    const input = {checked, getAttribute() { return String(index); }};
    element('#return-trace-list').listeners.change({target: input});
    return input;
  }
  choose(0, true); choose(1, true); choose(2, true); choose(3, true); choose(4, true);
  assert.equal(selected().length, 8, 'Permite selecionar mais de 6 retornos');
  assert.equal(choose(3, true).checked, true);
  assert.equal(element('#return-presentation-status').textContent, '');
  for (const index of selected()) choose(index, false);
  assert.deepEqual(selected(), []);
  choose(2, true);
  handler = async () => success();
  await ctx.generateReturnPresentation();
  assert.equal(new URL(requests.at(-1).url, 'https://test.invalid').searchParams.get('traces'), '2');
  assert.equal(downloads.length, 2);
  let complete;
  handler = () => new Promise(resolve => { complete = resolve; });
  const generation = ctx.generateReturnPresentation();
  const count = requests.length;
  await ctx.generateReturnPresentation();
  assert.equal(requests.length, count);
  assert.equal(button.disabled, true);
  assert.equal(choose(2, false).checked, true, 'Não altera a seleção durante a exportação');
  selectedUnit = 'NRD';
  events['report-unit-change']();
  complete(success());
  await generation;
  assert.equal(downloads.length, 2, 'Não baixa uma unidade anterior após mudar o filtro');
  assert.equal(button.disabled, true);
  assert.equal(element('#return-trace-options').hidden, true);
  assert.deepEqual(selected(), []);
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
  assert.equal(downloads.length, 2);
  element('#return-analysis-front').listeners.change();
  assert.equal(button.disabled, true);
  await analyze();
  element('#return-analysis-file').listeners.change();
  assert.equal(button.disabled, true);
  await analyze();
  element('#return-min-gap').listeners.input();
  assert.equal(button.disabled, true);
  await analyze();
  handler = async () => ({ok: true, status: 200, json: async () => ({
    imported: {inserted: 2}, summary: {unit: 'PPT', records: 2, equipments: 2},
  })});
  await ctx.importReturnSoilWetFile({name: 'solo.xlsx', size: 100});
  assert.equal(button.disabled, true, 'Atualizar apontamentos exige reprocessar antes de exportar');
  assert.equal(element('#return-analysis-results').hidden, true);
  assert(requests.at(-1).url.includes('/soil-wet/import?unit=PPT'));
  assert(element('#return-soil-wet-status').textContent.includes('2 registros'));
  assert.equal(element('#return-soil-wet-import').disabled, false);
  await analyze();
  handler = async () => ({ok: false, status: 400, json: async () => ({error: 'Unidade da planilha divergente'})});
  await ctx.importReturnSoilWetFile({name: 'solo.xlsx', size: 100});
  assert(element('#return-soil-wet-status').textContent.includes('divergente'));
  assert(errors.some(values => String(values[0]).includes('divergente')));
  assert.equal(button.disabled, true);
  await analyze();
  handler = () => new Promise(resolve => { complete = resolve; });
  const importing = ctx.importReturnSoilWetFile({name: 'solo.xlsx', size: 100});
  const duringImport = requests.length;
  await ctx.importReturnSoilWetFile({name: 'duplicate.xlsx', size: 100});
  await ctx.processReturnAnalysis({preventDefault() {}});
  await ctx.generateReturnPresentation();
  assert.equal(requests.length, duringImport, 'Importação bloqueia duplicação, processamento e exportação');
  selectedUnit = 'NRD';
  events['report-unit-change']();
  await new Promise(resolve => setImmediate(resolve));
  complete({ok: true, status: 200, json: async () => ({summary: {unit: 'PPT', records: 999}, imported: {inserted: 999}})});
  await importing;
  assert(!element('#return-soil-wet-status').textContent.includes('999'), 'Resposta anterior não sobrescreve a nova unidade');
  assert.equal(element('#return-soil-wet-import').disabled, false);
  assert.equal(button.disabled, true);
  ctx.renderConfirmedSoilWetRows({confirmed_soil_wet: [{sector: 73, days_out: 2,
    sector_reference: {status: 'matched', section: '10', farm: 'Fazenda A'},
    soil_wet_evidence: {fleet_size: 3, majority_required: 2, days_in_gap: 2, days_with_majority: 2,
      equipment: [1001, 1002], daily: [{total_hours: 4}, {total_hours: 4}], sector_evidence: [{sector: 71, total_hours: 8}]},
  }]});
  assert(element('#return-confirmed-soil-wet-body').innerHTML.includes('Fazenda A'));
  assert(element('#return-confirmed-soil-wet-body').innerHTML.includes('Aguardando no setor 71'));
  assert(!element('#return-confirmed-soil-wet-body').innerHTML.includes('setor próximo'), 'Não presume proximidade sem cadastro geográfico');
  ctx.renderConfirmedSoilWetRows({confirmed_soil_wet: [{sector: 73, days_out: 2,
    sector_reference: {status: 'matched', section: '10', farm: 'Fazenda A'},
    soil_wet_evidence: {fleet_size: 3, majority_required: 2, days_in_gap: 2, days_with_majority: 2,
      equipment: [1001, 1002], daily: [{total_hours: 4}, {total_hours: 4}], sector_evidence: [],
      location_evidence: [{sector: null, farm: 'FAZENDA LORENA', field: 18, total_hours: 8}]},
  }]});
  assert(element('#return-confirmed-soil-wet-body').innerHTML.includes('Aguardando em FAZENDA LORENA · Talhão 18'));
  ctx.renderPossibleSoilWetRows({possible_soil_wet: [{sector: 101, days_out: 5, exit_date: '2026-10-01', return_date: '2026-10-07',
    sector_reference: {status: 'matched', section: '10', farm: 'Fazenda A'}, other_fronts_in_sector: [],
    soil_wet_evidence: {probable: true}}]});
  assert(element('#return-soil-wet-body').innerHTML.includes('Solo úmido provável'));
  ctx.renderReturnOtherRows({target_front: {name: 'Frente 13'}, other_front_periods: [{
    start: '2026-05-28', end: '2026-05-29', sector: 3104, assigned_front: 'Frente 15', executor_front: 'Frente 15',
    execution_mode: 'cut_order', uses_target_cut_order: true, cut_order_front: 'Frente 13', equipment: [4300173, 4300254],
    counts: [{code: '15', front: 'Frente 15', count: 2}], daily: [{date: '2026-05-28', counts: [{code: '15', front: 'Frente 15', count: 2}]}],
    sector_reference: {status: 'matched', section: '10', farm: 'NOVA DAMASCO'},
  }]});
  assert(element('#return-other-body').innerHTML.includes('Frente 15'));
  assert(element('#return-other-body').innerHTML.includes('Frente 13'));
  assert(!element('#return-other-body').innerHTML.includes('Apoio'));
  console.log('OK: apresentação PPTX, arquivo/escopo processado, download, erros, sessão, bloqueio de duplicação e resultados obsoletos.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
