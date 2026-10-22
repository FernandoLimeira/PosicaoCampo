const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { context } = require('./test_reports.js');

async function main() {
  const { ctx } = context();
  for (const name of ['app.js', 'export.js']) {
    vm.runInContext(fs.readFileSync(require.resolve(`../static/js/${name}`), 'utf8')
      .replace(/initializeApp\(\);\s*$/, ''), ctx);
  }
  const catalog = JSON.parse(ctx.document.body.dataset.fieldStatuses);
  const source = { code: 'PPT', rows: catalog.map((item, index) =>
    [String(index + 1), '101', 'yellow', item.label, '145']), rain: [] };
  const original = JSON.stringify(source);
  for (const item of catalog) {
    assert.equal(ctx.normalizeStatus(item.label), item.label);
    assert.equal(ctx.getStatusColor(item.label), item.color);
    assert(ctx.statusOptionsHtml(item.label, true).includes(`value="${item.label}" selected`));
    assert.equal(ctx.fieldStatusClass(item.label), `is-${item.group}`);
    const primary = ctx.statusOptionsHtml(item.label);
    assert(primary.includes('value="EM ATIVIDADE"'));
    assert(primary.includes('value="SOLO ÚMIDO"'));
    assert.equal((primary.match(/<option value="[^\"]+"/g) || []).length, 2);
    assert.equal(ctx.collectPrimaryFieldStatus({ value: ctx.primaryFieldStatus(item.label),
      dataset: { originalStatus: item.label } }), item.label, 'O editor principal deve preservar o detalhe existente');
  }
  assert.equal(ctx.collectPrimaryFieldStatus({ value: 'SOLO ÚMIDO', dataset: { originalStatus: 'AGUARDANDO PIPA' } }), 'SOLO ÚMIDO');
  assert.equal(ctx.collectPrimaryFieldStatus({ value: 'EM ATIVIDADE', dataset: { originalStatus: 'PARADA' } }), 'EM ATIVIDADE');
  assert.equal(ctx.fieldFrontStatusForm('EM ATIVIDADE'), '', 'Sem permissão, Ver deve continuar apenas para consulta');
  vm.runInContext('moduleAccess.dashboard = { edit: true };', ctx);
  assert(ctx.fieldFrontStatusForm('EM ATIVIDADE').includes('value="AGUARDANDO PIPA"'));
  for (const [raw, expected] of [[' mudanca de patio ', 'MUDANÇA DE PÁTIO'],
    ['trajeto   travado vazio', 'TRAJETO TRAVADO VAZIO'], ['solo umido', 'SOLO ÚMIDO'], ['parado', 'PARADA']]) {
    assert.equal(ctx.normalizeStatus(raw), expected);
  }
  const normalized = ctx.normalizeReportUnit(source, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.rows)), catalog.map((item, index) =>
    [String(index + 1), '101', item.color, item.image_status, '145']));
  assert.equal(ctx.fieldUnitSummary(source).active, 7);
  assert.equal(ctx.fieldUnitSummary(source).attention, 2);
  for (const [statuses, border] of [[[], 'active'], [['AGUARDANDO PIPA', 'MUDANÇA DE SETOR'], 'active'],
    [['SOLO ÚMIDO'], 'critical'], [['PARADA'], 'critical'], [['PARADA', 'SOLO ÚMIDO'], 'critical'],
    [['TRAJETO TRAVADO CARREGADO', 'PARADA'], 'attention']]) {
    assert.equal(ctx.calculateUnitBorder(statuses.map(status => ['01', '101', '', status])), border);
  }
  const html = ctx.unitCard({ ...normalized, rows: ctx.normalizeFrontRows(source.rows) });
  assert.equal((html.match(/data-field-group="active"/g) || []).length, 7);
  assert.equal((html.match(/data-field-group="attention"/g) || []).length, 2);
  assert(html.includes('is-stopped'));

  // Exercita os dois geradores reais; somente canvas e carregamento de assets são simulados.
  const drawn = [];
  const canvasContext = new Proxy({
    measureText: text => ({ width: String(text).length * 5 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    fillText(text, x, y, maxWidth) { drawn.push({ text: String(text), color: this.fillStyle, x, y, maxWidth }); }
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  ctx.document.createElement = () => ({ width: 0, height: 0, getContext: () => canvasContext,
    toBlob(callback) { callback({ width: this.width, height: this.height }); } });
  ctx.loadImageAsset = async () => null;
  ctx.loadEmbeddedReportUnitSymbol = async () => null;
  ctx.loadReportUnitIconImage = async () => null;
  for (const generate of [() => ctx.generateUnitReportImageBlob(source),
    () => ctx.generateReportImageBlob(['PPT', 'NRD', 'RBR', 'PST'].map(code => ({ ...source, code })))]) {
    drawn.length = 0;
    const image = await generate();
    assert(image.width > 0 && image.height > 0);
    assert(drawn.some(item => item.text.toUpperCase() === 'EM ATIVIDADE'));
    assert(drawn.some(item => item.text.toUpperCase() === 'SOLO ÚMIDO'));
    assert(drawn.some(item => item.text.toUpperCase() === 'PARADA' && item.color === '#ff6b57'));
    for (const item of catalog.filter(item => item.image_status !== item.label)) {
      assert(!drawn.some(drawing => drawing.text.toUpperCase() === item.label));
    }
    assert.equal(JSON.stringify(source), original, 'Emitir não pode alterar os detalhes salvos no painel');
  }
  assert(drawn.some(item => item.text === 'Solo úmido'));
  assert(drawn.some(item => item.text === 'Parada'));
  assert(!drawn.some(item => /situação crítica/i.test(item.text)));
  const legend = drawn.filter(item => item.y === 270);
  assert.deepEqual(legend.map(item => item.text), ['Em atividade', 'Solo úmido', 'Parada']);
  assert(legend.every((item, index) => index === legend.length - 1
    || item.x + item.maxWidth < legend[index + 1].x), 'A legenda deve ficar alinhada sem sobreposição');
  assert(drawn.some(item => item.text === 'CTT' && item.color === '#80b82e'));
  assert(!drawn.some(item => /mudança ou teste/i.test(item.text)));

  // Salvar em Ver usa a versão aberta e mantém observações, chuva, ATR e demais frentes/unidades.
  vm.runInContext('unitMeta.PPT = { version: 7 };', ctx);
  const opened = vm.runInContext('clone(units[0])', ctx);
  const otherUnit = vm.runInContext('JSON.stringify(units[1])', ctx);
  const detailContext = { unit: 'PPT', front: opened.rows[0][0], sector: opened.rows[0][1], index: 0,
    unitSnapshot: JSON.parse(JSON.stringify(opened)), version: 7 };
  let sent;
  ctx.renderDashboard = () => {};
  ctx.apiRequest = async (path, options) => {
    sent = { path, ...JSON.parse(options.body) };
    return { unit: sent.unit, meta: { version: 8 } };
  };
  await ctx.saveFieldFrontStatus(detailContext, 'AGUARDANDO PIPA');
  assert.equal(sent.path, '/api/units/PPT');
  assert.equal(sent.expected_version, 7);
  assert.equal(sent.unit.rows[0][3], 'AGUARDANDO PIPA');
  assert.equal(sent.unit.rows[0][2], 'green');
  const expected = JSON.parse(JSON.stringify(opened));
  expected.rows[0][2] = 'green';
  expected.rows[0][3] = 'AGUARDANDO PIPA';
  expected.border = ctx.calculateUnitBorder(expected.rows);
  assert.deepEqual(sent.unit, expected);
  assert.equal(vm.runInContext('JSON.stringify(units[1])', ctx), otherUnit);
  assert.equal(detailContext.version, 8);
  const savedBeforeConflict = vm.runInContext('JSON.stringify(units[0])', ctx);
  ctx.apiRequest = async () => { const error = new Error('Atualização concorrente'); error.status = 409; throw error; };
  await assert.rejects(ctx.saveFieldFrontStatus(detailContext, 'PARADA'), error => error.status === 409);
  assert.equal(vm.runInContext('JSON.stringify(units[0])', ctx), savedBeforeConflict);
  vm.runInContext('moduleAccess.dashboard.edit = false;', ctx);
  await assert.rejects(ctx.saveFieldFrontStatus(detailContext, 'PARADA'), /permissão/);
  vm.runInContext('moduleAccess.dashboard.edit = true;', ctx);
  ctx.detailContext = detailContext;
  vm.runInContext('activeFieldFrontContext = detailContext;', ctx);
  ctx.apiRequest = async (_path, options) => ({ unit: JSON.parse(options.body).unit, meta: { version: 9 } });
  ctx.showToast = () => {};
  ctx.setupEvents();
  const button = { disabled: false };
  const state = { textContent: '' };
  const form = { id: 'field-front-status-form', querySelector(selector) {
    return selector === '[type="submit"]' ? button : selector === '[name="status"]' ? { value: 'PARADA' } : state;
  } };
  await ctx.document.querySelector('#field-front-detail-modal').listeners.submit({ target: form, preventDefault() {} });
  assert.equal(ctx.document.querySelector('#field-front-current-status').textContent, 'PARADA');
  assert.match(state.textContent, /Situação salva/);
  assert.equal(button.disabled, false);
  console.log('OK: situações detalhadas, contadores, filtros, cores e emissão individual/global sem alterar a origem.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
