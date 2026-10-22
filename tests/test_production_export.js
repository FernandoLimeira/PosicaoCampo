const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const labels = [];
const downloads = [];
const requests = [];
const strokes = [];
const fills = [];
const button = { disabled: false, addEventListener(type, listener) { this.click = listener; } };
const status = { textContent: '' };
const document = {
  querySelector(selector) {
    if (selector === '#emit-global-production') return button;
    if (selector === '#production-emission-status') return status;
    return null;
  },
  addEventListener() {},
  createElement(name) {
    assert.equal(name, 'canvas');
    const canvas = {
      getContext() {
        return {
          canvas,
          fillRect() {}, strokeRect() {}, beginPath() {}, roundRect() {},
          fill() { fills.push(this.fillStyle); },
          save() {}, restore() {},
          stroke() { strokes.push({ color: this.strokeStyle, dash: this.dash || [] }); },
          setLineDash(pattern) { this.dash = [...pattern]; },
          scale() {},
          moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {}, ellipse() {},
          createLinearGradient() { return { addColorStop() {} }; },
          measureText(value) { return { width: value.length * 14 }; },
          fillText(value) { labels.push(value); }
        };
      },
      toBlob(callback, type) { callback({ type, width: this.width, height: this.height }); }
    };
    return canvas;
  }
};
const context = vm.createContext({
  document, Date, console,
  getReportUnit: () => 'PPT',
  loadImageAsset: async () => null,
  showToast(message) { throw new Error(message); },
  downloadBlobFile(blob, name) { downloads.push({ blob, name }); },
  async apiRequest(url) {
    requests.push(url);
    if (url === '/api/production/access') return { access: { enabled: true, units: ['PPT', 'NRD'] } };
    if (url === '/api/production/statuses?include_inactive=1') return { statuses: [
      { code: 'ATIVO', name: 'Em atividade', style_key: 'active' },
      { code: 'UMIDO', name: 'Solo úmido', style_key: 'wet' },
      { code: 'AGUARDA', name: 'Aguardando', style_key: 'waiting' },
      { code: 'CRITICO', name: 'Parado', style_key: 'stopped' }
    ] };
    if (url.includes('/api/production/daily-summary?unit=PPT')) return { summary: {
      rain_turn_mm: 3, rain_accumulated_mm: 5,
      changes: 'Frente 1 deslocada.\nFrente 2 em teste.'
    } };
    if (url.includes('/api/production/daily-summary?unit=NRD')) return { summary: {
      rain_turn_mm: null, rain_accumulated_mm: null, changes: ''
    } };
    if (url.includes('unit=PPT')) return { items: Array.from({ length: 19 }, (_, index) => ({
      group_name: 'Fertirrigação', service_name: `Frente ${index + 1}`, owner_name: 'Analista',
      is_current_day: index !== 0,
      entry: { sector: '3392', section: '10', farm: 'Fazenda', status: 'ATIVO',
        work_date: '2026-10-15', observation: 'Operação normal' }
    })) };
    if (url.includes('unit=NRD')) return { items: [] };
    throw new Error(`Consulta inesperada: ${url}`);
  }
});

for (const name of ['production-consolidation.js', 'production-export.js', 'emissao.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js', name), 'utf8'), context);
}

(async () => {
  assert.equal(context.localProductionExportDate(new Date(2026, 9, 16)), '2026-10-16');
  assert.equal(context.buildProductionExportPages([{ code: 'PPT', items: Array(49).fill({}) }]).length, 2);
  const chunked = context.buildProductionExportPages([{
    code: 'PPT', items: Array(49).fill({}), summary: { changes: 'Mudança legada' }
  }]);
  assert.equal(chunked[0][0].summary.changes, 'Mudança legada');
  assert.equal(chunked[1][0].summary.changes, '');
  const colors = vm.runInContext('PRODUCTION_EXPORT_COLORS', context);
  assert.equal(colors.active, '#76b82a');
  assert.equal(colors.wet, '#ffcc00');
  assert.equal(colors.waiting, '#b2b2b2');
  assert.equal(colors.stopped, '#e95b45');
  assert.equal(context.productionExportBorderState({ active: 2, wet: 3, waiting: 0, stopped: 0 }), 'wet');
  assert.equal(context.productionExportBorderState({ active: 12, wet: 8, waiting: 0, stopped: 0 }), 'active');
  assert.equal(context.productionExportBorderState({ active: 8, wet: 13, waiting: 0, stopped: 0 }), 'wet');
  assert.equal(context.productionExportBorderState({ active: 1, wet: 0, waiting: 2, stopped: 0 }), 'waiting');
  assert.equal(context.productionExportBorderState({ active: 1, wet: 0, waiting: 0, stopped: 2 }), 'stopped');
  assert.equal(context.productionExportBorderState({ active: 2, wet: 2, waiting: 0, stopped: 0 }), 'wet');
  assert.equal(context.productionExportBorderState({ active: 0, wet: 0, waiting: 0, stopped: 0 }), 'waiting');
  const duplicateSector = [
    { service_front_id: 7, group_name: 'Plantio', service_name: 'Preparo', owner_name: 'Titular',
      is_current_day: true, entry: { id: 10, work_date: '2026-10-18', updated_at: 100,
        sector: '42', status: 'ATIVO', observation: 'Antiga' } },
    { service_front_id: 7, group_name: 'Plantio', service_name: 'Preparo', owner_name: 'Folguista',
      is_current_day: true, entry: { id: 11, work_date: '2026-10-18', updated_at: 200,
        sector: '42', status: 'UMIDO', observation: 'Atualizada', updated_by_name: 'Revisor' } },
    { service_front_id: 7, group_name: 'Plantio', service_name: 'Preparo', owner_name: 'Outro',
      is_current_day: true, entry: { id: 12, work_date: '2026-10-18', updated_at: 150,
        sector: '43', status: 'ATIVO' } },
    { service_front_id: 8, group_name: 'Plantio', service_name: 'Preparo', owner_name: 'Outro',
      is_current_day: true, entry: { id: 13, work_date: '2026-10-18', updated_at: 150,
        sector: '42', status: 'ATIVO' } }
  ];
  const consolidated = context.consolidateProductionItems(duplicateSector);
  assert.equal(consolidated.length, 3);
  assert.equal(consolidated[0].owner_name, 'Folguista');
  const duplicatePages = context.prepareProductionExportPages(document.createElement('canvas').getContext('2d'),
    [{ code: 'PPT', items: duplicateSector }],
    new Map([['ATIVO', { style_key: 'active' }], ['UMIDO', { style_key: 'wet' }]]));
  assert.equal(duplicatePages[0].plans[0].counts.wet, 1);
  assert.equal(duplicatePages[0].plans[0].counts.active, 2);
  assert.ok(duplicatePages[0].plans[0].noteLines.join(' ').includes('setor 42: Atualizada'));
  assert.ok(!duplicatePages[0].plans[0].noteLines.join(' ').includes('Revisor'));
  assert.ok(!duplicatePages[0].plans[0].noteLines.join(' ').includes('Antiga'));
  const stale = { group_name: 'Teste', service_name: 'Frente 1', is_current_day: false,
    entry: { sector: '3392', status: 'CRITICO', work_date: '2026-10-15' } };
  const staleReport = { code: 'PPT', items: [stale] };
  const canvas = document.createElement('canvas');
  const paint = canvas.getContext('2d');
  const plan = context.productionExportCardPlan(paint, staleReport,
    new Map([['CRITICO', { style_key: 'stopped' }]]), 520);
  const stalePill = plan.rows.find(row => row.type === 'service').lines[0].pills[0];
  assert.equal(stalePill.state, 'stopped');
  assert.equal(stalePill.label, '3392');
  context.drawProductionExportCard(paint, staleReport, plan, 26, 370);
  assert.ok(strokes.some(stroke => stroke.color === '#bf594d' && !stroke.dash.length));
  assert.ok(fills.includes('rgba(233, 91, 69, 0.14)'));
  const mixedReport = { code: 'PPT', items: [
    ['A', 'ATIVO'], ['B', 'UMIDO'], ['C', 'AGUARDA'], ['D', 'CRITICO']
  ].map(([sector, statusCode]) => ({
    group_name: 'Preparo e Plantio', service_name: 'Preparo de solo', is_current_day: true,
    entry: { sector, status: statusCode }
  })) };
  const mixedStatuses = new Map([
    ['ATIVO', { style_key: 'active' }], ['UMIDO', { style_key: 'wet' }],
    ['AGUARDA', { style_key: 'waiting' }], ['CRITICO', { style_key: 'stopped' }]
  ]);
  const mixedPlan = context.productionExportCardPlan(paint, mixedReport, mixedStatuses, 520);
  assert.equal(mixedPlan.rows.find(row => row.type === 'service').lines
    .flatMap(line => line.pills).map(pill => pill.state).join(','),
  'active,wet,waiting,stopped');
  const sharedObservation = context.productionExportCardPlan(paint, { code: 'PPT', items: [
    { group_name: 'Preparo e Plantio', service_name: 'Preparo de solo', owner_name: 'Ana',
      is_current_day: true, entry: { sector: '100', status: 'ATIVO', observation: 'Texto igual', changes: 'Mudança A', updated_by_name: 'Revisor A' } },
    { group_name: 'Preparo e Plantio', service_name: 'Preparo de solo', owner_name: 'Beto',
      is_current_day: true, entry: { sector: '200', status: 'UMIDO', observation: 'Texto igual', changes: 'Mudança B', updated_by_name: 'Revisor B' } }
  ] }, mixedStatuses, 0);
  assert.ok(sharedObservation.noteLines.join(' ').includes('setor 100: Texto igual'));
  assert.ok(sharedObservation.noteLines.join(' ').includes('setor 200: Texto igual'));
  assert.ok(sharedObservation.changeLines.join(' ').includes('setor 100: Mudança A'));
  assert.ok(sharedObservation.changeLines.join(' ').includes('setor 200: Mudança B'));
  assert.ok(![...sharedObservation.noteLines, ...sharedObservation.changeLines].join(' ').match(/Ana|Beto|Revisor/));
  assert.ok(sharedObservation.changeLines.join(' ').includes('Mudança A'));
  assert.ok(sharedObservation.changeLines.join(' ').includes('Mudança B'));
  context.drawProductionExportCard(paint, mixedReport, mixedPlan, 26, 370);
  for (const color of ['#679b2b', '#bba020', '#969d9e', '#bf594d']) {
    assert.ok(strokes.some(stroke => stroke.color === color && !stroke.dash.length));
  }
  for (const color of Object.values(colors)) {
    assert.ok(fills.includes(color), `Ponto colorido ausente: ${color}`);
  }
  for (const background of ['rgba(118, 184, 42, 0.14)', 'rgba(221, 190, 0, 0.14)',
    'rgba(178, 178, 178, 0.12)', 'rgba(233, 91, 69, 0.14)']) {
    assert.ok(fills.includes(background), `Fundo de etiqueta não aplicado: ${background}`);
  }
  const verbose = Array.from({ length: 48 }, (_, index) => ({
    group_name: 'Fertirrigação', service_name: `Frente longa ${index}`,
    is_current_day: true,
    entry: { sector: String(index), status: 'ATIVO',
      observation: `Observação ${index} ` + 'informação '.repeat(30) }
  }));
  const responsive = context.prepareProductionExportPages(paint,
    [{ code: 'PPT', items: verbose }], new Map([['ATIVO', { style_key: 'active' }]]));
  assert.ok(responsive.length > 1);
  assert.equal(responsive.reduce((total, page) => total + page.page[0].items.length, 0), 48);
  assert.ok(responsive.every(page => page.height * 4096 / 1080 <= 12000));
  const analystItems = Array.from({ length: 49 }, (_, index) => ({
    group_name: 'Tratos culturais', service_name: 'Cultivo',
    owner_name: `Analista ${index}`, is_current_day: true,
    entry: { sector: String(index), status: 'ATIVO',
      observation: `Observação ${index}`, changes: `Mudança ${index}` }
  }));
  const consolidatedPages = context.prepareProductionExportPages(paint, [{
    code: 'PPT', items: analystItems, summary: { changes: 'Legado único' }
  }], mixedStatuses);
  const pptPlans = consolidatedPages.map(page => page.plans[0]);
  assert.equal(pptPlans.reduce((sum, plan) => sum + plan.noteLines.filter(line => line.startsWith('•')).length, 0), 49);
  assert.equal(pptPlans.reduce((sum, plan) => sum + plan.changeLines.filter(line => line.startsWith('•')).length, 0), 50);
  const longLabels = context.productionExportCardPlan(paint, { code: 'PPT', items: [{
    group_name: 'Grupo de atividades agrícolas com identificação excepcionalmente longa',
    service_name: 'Serviço de preparo, plantio e acompanhamento com identificação longa',
    is_current_day: true,
    entry: { sector: 'Frente de produção com identificação muito longa', status: 'ATIVO' }
  }] }, new Map([['ATIVO', { style_key: 'active' }]]), 0);
  assert.ok(longLabels.rows.find(row => row.type === 'group').nameLines.length > 1);
  const longService = longLabels.rows.find(row => row.type === 'service');
  assert.ok(longService.nameLines.length > 1);
  assert.ok(longService.lines[0].pills[0].textLines.length > 1);
  const longChanges = context.productionExportCardPlan(paint, {
    code: 'PPT', items: [], summary: { changes: 'Mudança operacional '.repeat(90) }
  }, new Map(), 0);
  assert.ok(longChanges.changeLines.length > 1);
  assert.ok(longChanges.height > 520);

  // Indicadores completos: sem reticências em operações, serviços e setores.
  const counterLabelsBefore = labels.length;
  const manyOperationsReport = { code: 'PPT', items: Array.from({ length: 123 },
    (_, index) => ({ group_name: 'Tratos culturais', service_name: 'Cultivo',
      is_current_day: true, entry: { sector: String(index), status: 'ATIVO' } })) };
  context.drawProductionExportCard(paint, manyOperationsReport,
    context.productionExportCardPlan(paint, manyOperationsReport, mixedStatuses, 0), 26, 370);
  assert.ok(labels.slice(counterLabelsBefore).includes('123'));
  assert.ok(labels.slice(counterLabelsBefore).includes('OPERAÇÕES'));

  const bigObservation = 'Operação com observações extensas '.repeat(420);
  const oversized = context.prepareProductionExportPages(paint, [{ code: 'PPT', items: [{
    group_name: 'Fertirrigação', service_name: 'Operação especial', is_current_day: true,
    entry: { sector: '12345', status: 'ATIVO', observation: bigObservation }
  }] }], mixedStatuses);
  assert.ok(oversized.length > 1, 'Observação longa deve gerar páginas adicionais');
  assert.ok(oversized.every(page => page.height * 4096 / 1080 <= 12000));
  assert.equal(oversized.flatMap(page => page.page).reduce((sum, report) => sum + report.items.length, 0), 1);

  const grid = context.productionExportPageLayout(paint, [
    { code: 'PPT', items: [] }, { code: 'NRD', items: [{
      group_name: 'Tratos culturais', service_name: 'Cultivo', is_current_day: true,
      entry: { sector: '1', status: 'ATIVO' }
    }] }, { code: 'RBR', items: [] }, { code: 'PST', items: [] }
  ], mixedStatuses);
  assert.equal(grid.plans[0].height, grid.plans[1].height);
  assert.equal(grid.plans[2].height, grid.plans[3].height);
  assert.ok(grid.plans.every(plan => plan.contentHeight <= plan.height));

  const configuredStatuses = new Map([
    ['CUSTOM', { code: 'CUSTOM', name: 'Situação cadastrada', style_key: 'wet', is_active: true }],
    ['OLD', { code: 'OLD', name: 'Status desativado', style_key: 'stopped', is_active: false }]
  ]);
  const configuredLegend = context.productionExportLegendLayout(paint, [], configuredStatuses);
  assert.equal(configuredLegend.entries.length, 1);
  assert.equal(configuredLegend.entries[0].lines.join(' '), 'Situação cadastrada');
  assert.equal(configuredLegend.entries[0].state, 'wet');
  const legacyLegend = context.productionExportLegendLayout(paint,
    [{ items: [{ entry: { status: 'OLD' } }] }], configuredStatuses);
  assert.equal(legacyLegend.entries.length, 2, 'Status desativado ainda usado deve constar na legenda');
  const manyStatuses = new Map(Array.from({ length: 9 }, (_, index) => [String(index), {
    code: String(index), name: `Status ${index}`, style_key: 'active'
  }]));
  const expandedGrid = context.productionExportPageLayout(paint,
    ['PPT', 'NRD', 'RBR', 'PST'].map(code => ({ code, items: [] })), manyStatuses);
  assert.equal(expandedGrid.legend.entries.length, 9);
  assert.equal(expandedGrid.firstY, 434, 'Os cartões devem acompanhar as linhas extras da legenda');
  assert.ok(expandedGrid.legend.entries.every(entry => entry.y < expandedGrid.firstY));

  await button.click({ currentTarget: button });
  assert.equal(button.disabled, false);
  assert.equal(downloads.length, 1);
  assert.ok(downloads.every(item => item.blob.type === 'image/png'));
  assert.equal(downloads[0].blob.width, 4096);
  assert.ok(downloads[0].blob.height >= 1920 * 4096 / 1080);
  assert.match(downloads[0].name, /^Producao-Agricola-Global-\d{2}-\d{2}-\d{4}\.png$/);
  assert.ok(requests.some(url => url.includes('unit=PPT') && url.includes('scope=all')));
  assert.ok(requests.some(url => url.includes('unit=NRD') && url.includes('scope=all')));
  assert.ok(requests.some(url => url.includes('daily-summary?unit=PPT')));
  assert.ok(!requests.some(url => url.includes('unit=RBR')));
  assert.ok(labels.includes('POSIÇÃO DE CAMPO'));
  assert.ok(!labels.includes('TROCA DE TURNO'));
  assert.ok(labels.includes('PRODUÇÃO AGRÍCOLA'));
  assert.ok(labels.includes('Parado'));
  assert.ok(!labels.includes('Parado / crítico'));
  assert.ok(labels.includes('Solo úmido'));
  assert.ok(labels.includes('Aguardando'));
  assert.ok(!labels.includes('Solo úmido / teste'));
  assert.ok(labels.includes('Nenhum lançamento nesta unidade.'));
  assert.ok(labels.some(value => value.startsWith('Unidade não liberada')));
  assert.ok(labels.includes('Frente 19'));
  assert.equal(context.productionExportRainText({ rain_turn_mm: 3, rain_accumulated_mm: 5 }),
    'Chuva: turno 3 mm | acumulado 5 mm');
  assert.ok(labels.some(value => value.startsWith('Chuva: turno 3 mm')));
  assert.ok(labels.includes('• Frente 1 deslocada.'));
  assert.ok(labels.includes('• Frente 2 em teste.'));
  assert.ok(labels.some(value => value.includes('15/10/2026')));
  assert.match(status.textContent, /1 imagem emitida/);
})().catch(error => { console.error(error); process.exitCode = 1; });
