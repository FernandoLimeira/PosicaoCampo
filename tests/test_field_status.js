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
    assert(ctx.statusOptionsHtml(item.label).includes(`value="${item.label}" selected`));
    assert.equal(ctx.fieldStatusClass(item.label), `is-${item.group}`);
  }
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
    fillText(text) { drawn.push({ text: String(text), color: this.fillStyle }); }
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
  assert(drawn.some(item => item.text === 'Parada / situação crítica'));
  assert(!drawn.some(item => /mudança ou teste/i.test(item.text)));
  console.log('OK: situações detalhadas, contadores, filtros, cores e emissão individual/global sem alterar a origem.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
