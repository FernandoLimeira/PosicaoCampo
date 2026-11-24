const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { BASE_SCRIPTS, EXPORT_SCRIPTS, loadScripts, pageScripts, withoutInitializeApp } = require('./page_scripts.js');

function context(search = '?unit=PPT', stored = 'NRD', baseUnit = 'PPT', pathname = '/', userId = '7') {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', textContent: '', innerHTML: '', listeners: {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
      attributes: {}, dataset: {},
      style: {}, hidden: false,
      getBoundingClientRect() { return { left: 20, right: 220, top: 120, bottom: 160, width: 320, height: 280 }; },
      contains(target) { return target === this || target?.parent === this; },
      querySelector() { const child = element('#flyout-first-link'); child.parent = this; return child; },
      focus() { ctx.focused = selector; },
      setAttribute(key, value) { this.attributes[key] = value; }, classList: { add() {}, remove() {}, toggle() {} }
    });
    return elements.get(selector);
  };
  const listeners = {};
  const unitButtons = ['PPT', 'NRD', 'RBR', 'PST'].map(code => {
    const button = element(`[data-report-unit="${code}"]`);
    button.dataset.reportUnit = code;
    return button;
  });
  const link = { href: 'http://localhost/sacarose', pathname: '/sacarose' };
  const ctx = vm.createContext({
    URL, URLSearchParams, console, Date, setTimeout, clearTimeout,
    setInterval(handler, delay) { (ctx.intervals ||= []).push({ handler, delay }); ctx.clockInterval = { handler, delay }; },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: {
      body: { dataset: { userId, userName: 'Operador Teste', userRole: 'user', userBaseUnit: baseUnit,
        fieldStatuses: fs.readFileSync(path.join(__dirname, '../backend/services/field_statuses.json'), 'utf8') }, classList: { add() {}, remove() {} } },
      querySelector: element,
      querySelectorAll: selector => selector === '[data-unit-context]' ? [link] : selector === '[data-report-unit]' ? unitButtons : [],
      addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
      dispatchEvent(event) { (listeners[event.type] || []).forEach(handler => handler(event)); }
    },
    window: { innerWidth: 1280, innerHeight: 720, addEventListener() {}, location: { search, href: `http://localhost${pathname}${search}`, origin: 'http://localhost' } },
    history: { replaceState(...args) { ctx.lastURL = args[2]; } },
    sessionStorage: { getItem(key) { ctx.storageKey = key; return stored; }, setItem(key, value) { ctx.storageKey = key; ctx.stored = value; } },
    localStorage: {
      getItem() { throw new Error('Dados operacionais não devem vir do cache compartilhado.'); },
      removeItem(key) { ctx.removedStorageKey = key; }
    },
  });
  loadScripts(ctx, BASE_SCRIPTS);
  return { ctx, elements, link };
}


async function main() {
  const { ctx, elements, link } = context('?unit=rbr');
  assert.equal(ctx.removedStorageKey, 'posicao-campo-v1-state');
  for (const [hour, expected] of [[0, 'Boa noite!'], [4, 'Boa noite!'], [5, 'Bom dia!'], [11, 'Bom dia!'], [12, 'Boa tarde!'], [17, 'Boa tarde!'], [18, 'Boa noite!'], [23, 'Boa noite!']]) {
    assert.equal(ctx.greetingForHour(hour), expected);
  }
  assert.equal(ctx.clockInterval.delay, 1000);
  ctx.Date = class extends Date { constructor() { super(2026, 9, 6, 11, 59, 59); } };
  ctx.clockInterval.handler();
  assert.equal(elements.get('#greeting').textContent, 'Bom dia, Operador Teste!');
  assert.equal(elements.get('#today').textContent, '06/10/2026');
  assert.equal(elements.get('#current-time').textContent, '11:59:59');
  ctx.Date = class extends Date { constructor() { super(2026, 9, 6, 12, 0, 0); } };
  ctx.clockInterval.handler();
  assert.equal(elements.get('#greeting').textContent, 'Boa tarde, Operador Teste!');
  assert.equal(elements.get('#current-time').textContent, '12:00:00');
  ctx.Date = Date;
  assert.equal(ctx.getReportUnit(), 'RBR');
  assert.equal(elements.get('[data-report-unit="RBR"]').attributes['aria-pressed'], 'true');
  assert.equal(elements.get('[data-report-unit="PPT"]').attributes['aria-pressed'], 'false');
  assert.equal(link.href, '/sacarose?unit=RBR');
  assert.equal(ctx.matchesReportUnit('Usina Paraguaçu Paulista', 'PPT'), true);
  assert.equal(ctx.matchesReportUnit('UNIDADE - NRD', 'PPT'), false);
  assert.equal(ctx.matchesReportUnit('', 'PPT'), false);
  const toggle = elements.get('#reports-toggle');
  const flyout = elements.get('#reports-flyout');
  assert.equal(flyout.hidden, true);
  assert.equal(toggle.attributes['aria-expanded'], 'false');
  toggle.listeners.click();
  assert.equal(flyout.hidden, false);
  assert.equal(toggle.attributes['aria-expanded'], 'true');
  assert.equal(flyout.style.left, '230px');
  assert.equal(flyout.style.top, '120px');
  assert.equal(ctx.focused, '#flyout-first-link');
  ctx.document.dispatchEvent({ type: 'click', target: toggle });
  assert.equal(flyout.hidden, false);
  ctx.document.dispatchEvent({ type: 'click', target: {} });
  assert.equal(flyout.hidden, true);
  toggle.listeners.click();
  ctx.document.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
  assert.equal(flyout.hidden, true);
  assert.equal(ctx.focused, '#reports-toggle');
  toggle.listeners.click();
  toggle.listeners.click();
  assert.equal(flyout.hidden, true);
  toggle.listeners.click();
  ctx.window.innerWidth = 380;
  // O primeiro menu lateral registrado é o de Relatórios.
  vm.runInContext('sidebarFlyouts[0].position()', ctx);
  assert.equal(flyout.style.left, '20px');
  assert.equal(flyout.style.top, '170px');
  ctx.document.dispatchEvent({ type: 'focusin', target: {} });
  assert.equal(flyout.hidden, true);
  ctx.window.innerWidth = 1280;
  assert.equal(context('?unit=invalida', 'PST').ctx.getReportUnit(), 'PST');
  assert.equal(context('', 'invalida').ctx.getReportUnit(), 'PPT');
  assert.equal(context('', 'PPT', 'NRD').ctx.getReportUnit(), 'NRD', 'Entrada inicial sempre usa a unidade base');
  assert.equal(context('?unit=PST', 'PPT', 'NRD').ctx.getReportUnit(), 'PST', 'URL pode escolher outra unidade');
  assert.equal(context('', 'RBR', 'NRD', '/sacarose').ctx.getReportUnit(), 'RBR', 'Navegação mantém a unidade escolhida');
  assert.equal(context('', null, 'PST', '/sacarose').ctx.getReportUnit(), 'PST');
  assert.equal(context('', null, 'XYZ').ctx.getReportUnit(), 'PPT');
  assert.equal(context('', null, 'NRD', '/', '8').ctx.storageKey, 'posicao-campo-report-unit:8');
  assert.equal(ctx.storageKey, 'posicao-campo-report-unit:7');
  loadScripts(ctx, pageScripts('/'), withoutInitializeApp);
  ctx.renderDashboard();
  // O card não repete o código da unidade; a seleção aparece no rótulo da prévia.
  assert.match(elements.get('#preview-unit-label').textContent, /RBR/);
  elements.get('[data-report-unit="PST"]').listeners.click();
  ctx.renderDashboard();
  assert.equal(elements.get('[data-report-unit="PST"]').attributes['aria-pressed'], 'true');
  assert.equal(elements.get('[data-report-unit="RBR"]').attributes['aria-pressed'], 'false');
  assert.equal(ctx.stored, 'PST');
  assert.equal(link.href, '/sacarose?unit=PST');
  assert.match(elements.get('#preview-unit-label').textContent, /PST/);

  const refresh = context('?unit=PPT');
  loadScripts(refresh.ctx, pageScripts('/'), withoutInitializeApp);
  refresh.ctx.setupEvents();
  vm.runInContext(`
    unitMeta = { PPT: { version: 1 }, NRD: { version: 9 } };
    units[1].observation = 'Dados da NRD';
    weighingSummary = {
      work_date: '2026-11-17', reference_at: 1794960000, last_import: { imported_at: 1 },
      units: [{ code: 'NRD', work_date: '2026-11-17', reference_at: 1794960000, data_until: 1794960000,
        closed_until: 1794960001, loads_day: 2, milling_day_t: 880, milling_projection_t: 980 }]
    };
  `, refresh.ctx);
  refresh.ctx.loadUnitEditor(0);
  const untouched = vm.runInContext('[units[1], unitMeta.NRD, weighingSummary.units[0]]', refresh.ctx);
  const requests = [];
  let resolvePosition;
  refresh.ctx.showToast = () => {};
  refresh.ctx.apiRequest = async path => {
    requests.push(path);
    if (path === '/api/units?unit=PPT') return new Promise(resolve => { resolvePosition = resolve; });
    if (path === '/api/weighings/summary?unit=PPT') return {
      work_date: '2026-11-18', last_import: { imported_at: 2 },
      units: [{ code: 'PPT', work_date: '2026-11-18', reference_at: 1795046400, data_until: 1795046400,
        closed_until: 1795046401, loads_day: 3,
        milling_day_t: 1500, milling_projection_t: 1800 }]
    };
    return {};
  };
  const refreshButton = refresh.elements.get('#dashboard-refresh');
  const refreshing = refreshButton.listeners.click({ currentTarget: refreshButton });
  assert(refreshButton.disabled);
  refresh.ctx.setReportUnit('NRD');
  resolvePosition({ units: [{ code: 'PPT', observation: 'PPT atualizado' }], meta: { PPT: { version: 2 } } });
  await refreshing;
  assert.deepEqual(requests, ['/api/units?unit=PPT', '/api/weighings/summary?unit=PPT', '/api/front-notes?unit=NRD']);
  assert.equal(refresh.ctx.getReportUnit(), 'NRD');
  assert(!refreshButton.disabled);
  assert.equal(vm.runInContext('units[0].observation', refresh.ctx), 'PPT atualizado');
  assert.equal(vm.runInContext('unitMeta.PPT.version', refresh.ctx), 2);
  assert.equal(vm.runInContext('editorUnitVersion', refresh.ctx), 1);
  assert.equal(vm.runInContext('units[1]', refresh.ctx), untouched[0]);
  assert.equal(vm.runInContext('unitMeta.NRD', refresh.ctx), untouched[1]);
  assert.equal(vm.runInContext('weighingSummary.units.find(unit => unit.code === "NRD")', refresh.ctx), untouched[2]);
  const nrdOverview = refresh.ctx.managementReportHtml();
  assert.match(nrdOverview, /Visão geral · NRD/);
  assert.match(nrdOverview, /Processado no dia<\/small><strong>880 /);
  assert.match(nrdOverview, /Balança até 17\/11/);
  assert.doesNotMatch(nrdOverview, /PPT|1\.500|data-overview-unit/);
  refresh.ctx.setReportUnit('PPT');
  const pptOverview = refresh.ctx.managementReportHtml();
  assert.match(pptOverview, /Visão geral · PPT/);
  assert.match(pptOverview, /Processado no dia<\/small><strong>1\.500 /);
  assert.match(pptOverview, /Balança até 18\/11/);
  assert.doesNotMatch(pptOverview, /NRD|880/);
  assert.doesNotMatch(refresh.elements.get('#units-grid').innerHTML, /Painel gerencial · Balança/);
  // Preencher: o ATR da frente já vem com o calculado pela balança e só é gravado se mudar.
  const savedSummary = vm.runInContext('weighingSummary', refresh.ctx);
  vm.runInContext(`weighingSummary = {
      work_date: '2026-11-18', reference_at: 1795046400,
      units: [{ code: 'PPT', work_date: '2026-11-18', reference_at: 1795046400, data_until: 1795046400,
        closed_until: 1795046401, loads_day: 3, fronts: [{ front: '05', atr: 135.15, tons: 60 }, { front: '19', atr: 140.3, tons: 20 }] }]
    };
    editorFrontAtr = editorFrontAtrValues(units[0]);`, refresh.ctx);
  const calculatedRow = refresh.ctx.frontRowHtml('FT 05', '5010', 'EM ATIVIDADE', '');
  assert.match(calculatedRow, /class="atr-input is-calculated"[^>]*value="135,15"[^>]*data-calculated="135,15"/);
  assert.match(calculatedRow, /title="ATR da balança: 135,15"/);
  const typedRow = refresh.ctx.frontRowHtml('FT 19', '1900', 'EM ATIVIDADE', '141');
  assert.match(typedRow, /class="atr-input"[^>]*value="141"[^>]*data-calculated="140,30"/);
  assert.match(refresh.ctx.frontRowHtml('FT 77', '7700', 'EM ATIVIDADE', ''), /value="" data-calculated=""/);
  const fakeRow = (front, atr, calculated) => ({ querySelector: selector => ({
    '.front-input': { value: front }, '.sector-input': { value: '1' },
    '.status-input': { value: 'EM ATIVIDADE', dataset: {} },
    '.atr-input': { value: atr, dataset: { calculated } } })[selector] });
  const originalQueryAll = refresh.ctx.document.querySelectorAll;
  refresh.ctx.document.querySelectorAll = selector => selector === '.front-edit-row'
    ? [fakeRow('FT 05', '135,15', '135,15'), fakeRow('FT 19', '141', '140,30'), fakeRow('FT 77', '', '')]
    : originalQueryAll(selector);
  assert.equal(JSON.stringify(refresh.ctx.collectFrontRows().map(row => row[4])), '["","141",""]');
  refresh.ctx.document.querySelectorAll = originalQueryAll;
  refresh.ctx.savedSummary = savedSummary;
  vm.runInContext('weighingSummary = savedSummary; editorFrontAtr = new Map();', refresh.ctx);
  vm.runInContext(`units[0].rows = [['FT 99', '9900', '', 'EM ATIVIDADE', '']];
    units[0].observation = 'Observação atual';`, refresh.ctx);
  refresh.ctx.apiRequest = async path => {
    assert.match(path, /^\/api\/weighings\/summary\?date=2026-11-18/);
    assert.match(path, /unit=PPT&position=1/);
    return {
      work_date: '2026-11-18', reference_at: 1795046400,
      units: [{ code: 'PPT', work_date: '2026-11-18', data_until: 1795046400,
        closed_until: 1795032000, position_until: 1795032000, loads_day: 2, milling_day_t: 700,
        milling_shift_tph: 275, fronts: [{ front: '5', atr: 119.5 }] }],
      position: { unit: { code: 'PPT', rows: [['FT 05', '5010', '', 'PARADA', '']],
        observation: 'Observação do fechamento' } },
      note_summaries: { 'ft 05': { highlights: [{ text: 'Acontecimento do corte' }], highlight_count: 1 } }
    };
  };
  vm.runInContext("managementReportDate = '2026-11-18'; managementReportTime = '17:00';", refresh.ctx);
  await refresh.ctx.loadManagementReport();
  assert.match(refresh.ctx.managementReportHtml(), /Processado no dia<\/small><strong>700 /);
  assert.match(refresh.ctx.managementReportHtml(), /value="17:00"/);
  refresh.ctx.renderDashboard();
  const closingGrid = refresh.elements.get('#units-grid').innerHTML;
  for (const text of ['FT 05', 'PARADA', '5010', '119,50', '275', 'Observação do fechamento', 'Acontecimento do corte']) {
    assert(closingGrid.includes(text), text);
  }
  assert.doesNotMatch(closingGrid, /FT 99|Observação atual/);
  assert.equal(refresh.elements.get('#open-data-modal').hidden, true);
  refresh.ctx.openModal = () => {};
  refresh.ctx.apiRequest = async path => {
    assert.match(path, /front=FT%2005&cutoff=1795032000/);
    return { entries: [{ text: 'Detalhe no horário' }], total: 1 };
  };
  const loadClosingNotes = refresh.ctx.loadFieldFrontHistory;
  let closingNotes;
  refresh.ctx.loadFieldFrontHistory = (...args) => (closingNotes = loadClosingNotes(...args));
  refresh.ctx.openFieldFrontDetails(0);
  assert.doesNotMatch(refresh.elements.get('#field-front-detail-content').innerHTML, /field-front-note-form/);
  await closingNotes;
  assert.match(refresh.elements.get('#field-front-note-history').innerHTML, /Detalhe no horário/);

  let resolveOld;
  refresh.ctx.apiRequest = path => path.includes('hora=17%3A00')
    ? new Promise(resolve => { resolveOld = resolve; })
    : Promise.resolve({ units: [{ code: 'PPT', position_until: 1795035600 }], position: null });
  const outdatedClosing = refresh.ctx.loadManagementReport();
  vm.runInContext("managementReportTime = '18:00';", refresh.ctx);
  await refresh.ctx.loadManagementReport();
  resolveOld({ units: [{ code: 'PPT', position_until: 1795032000 }] });
  await outdatedClosing;
  assert.equal(refresh.ctx.managementReportView().cutoff, 1795035600);

  vm.runInContext("managementReportTime = '';", refresh.ctx);
  await refresh.ctx.loadManagementReport();
  assert.match(refresh.ctx.managementReportHtml(), /Processado no dia<\/small><strong>1\.500 /);
  refresh.ctx.renderDashboard();
  assert.match(refresh.elements.get('#units-grid').innerHTML, /FT 99|Observação atual/);
  assert.equal(refresh.elements.get('#open-data-modal').hidden, false);

  loadScripts(ctx, pageScripts('/relatorios'));
  const report = { performance_rows: [{ unit: 'PPT', front: '1' }, { unit: 'NRD', front: '1' }, { unit: '' }], timeline: [{ unit: 'PPT' }, { unit: 'NRD' }] };
  assert.equal(ctx.filterExcelPerformanceRows(report, { unit: 'PPT' }).length, 1);
  assert.equal(ctx.filterExcelTimeline(report, { unit: 'NRD' }).length, 1);

  // Exports run without app.js: no dashboard globals or editor dependencies.
  const standalone = context().ctx;
  const drawn = [];
  const fakeCtx = new Proxy({ measureText: text => ({ width: String(text).length * 7 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) }, {
    get: (target, key) => key in target ? target[key] : () => {}
  });
  standalone.document.createElement = () => {
    const canvas = { width: 0, height: 0, getContext: () => fakeCtx, toBlob(callback) { callback({ width: this.width, height: this.height }); } };
    return canvas;
  };
  // Emissões sem o painel: só os scripts de emissão (global e Sacarose).
  loadScripts(standalone, [...EXPORT_SCRIPTS, 'reports-export/sacarose-export.js']);
  standalone.loadSacaroseHeaderIconImage = async () => null;
  standalone.drawSacaroseExportUnit = (ctx, code) => { drawn.push({ code }); return 200; };
  const unit = { code: 'NRD', name: 'Narandiba', rows: [['1', '10', 'green', 'EM ATIVIDADE']], rain: [] };
  const global = ['PPT', 'NRD', 'RBR', 'PST'].map(code => ({ ...unit, code }));
  // A emissão global usa o layout aprovado (720 px de referência, escala 2,5x)
  // e desenha cada unidade em globalDrawCard.
  standalone.globalDrawCard = (ctx, layout, unit) => drawn.push({ code: unit.code, layout });
  const globalImage = await standalone.generateReportImageBlob(global);
  assert.equal(globalImage.width, 1800);
  assert.deepEqual(drawn.map(item => item.code).sort(), ['NRD', 'PPT', 'PST', 'RBR']);
  await assert.rejects(standalone.generateReportImageBlob([unit]), /quatro unidades/);

  // Dados da imagem "Troca de Turno CTT": a balança substitui o digitado; sem pesagem, vale o digitado.
  const typed = [['', 'INDÚSTRIA', '850 TN/H'], ['', 'MOAGEM TURNO', '700 TN/H'], ['', 'ENTREGA TURNO', '690 TN/H'],
    ['', 'ESTOQUE', '40 CARGAS', 'stock'], ['', 'MOAGEM ÚLT. 3 H', '710 TN/H'], ['', 'ENTREGA ÚLT. 3 H', '705 TN/H']];
  const ppt = standalone.normalizeReportUnit({ code: 'PPT', name: 'PARAGUAÇU PAULISTA', metrics: typed,
    rows: [['FT 02', '1631', '', 'EM ATIVIDADE', ''], ['FT 19', '3432', '', 'SOLO ÚMIDO', '125']] }, 0);
  const summary = { reference_at: 1, support: [
    { front: '19', from_unit: 'NRD', to_unit: 'PPT', loads: 12, tons: 410.5, atr: 127.91 },
    { front: '05', from_unit: 'PPT', to_unit: 'RBR', loads: 3, tons: 98 }],
    units: [{ code: 'PPT', loads_day: 300, milling_shift_tph: 846.6, delivery_shift_tph: 818, stock_loads: 48,
      milling_last3h_tph: 832, delivery_last3h_tph: 878, atr: 118.64, milling_day_t: 11763, milling_projection_t: 18822,
      fronts: [{ front: '02', atr: 121.06 }], received: [{ front: '19', home_unit: 'NRD', atr: 127.91 }] }] };
  const data = standalone.fieldUnitIndicators(ppt, summary);
  assert.deepEqual([data.industry, data.millingShift, data.deliveryShift, data.stock, data.milling3h, data.delivery3h,
    data.atr, data.day, data.projection], [850, 846.6, 818, 48, 832, 878, 118.64, 11763, 18822]);
  assert.equal(data.active, 1, 'Solo úmido não conta como frente em atividade');
  assert.equal(data.frontAtr(ppt.rows[0]), '121,06', 'Sem ATR digitado, usa o ATR da balança da frente');
  assert.equal(data.frontAtr(ppt.rows[1]), '125', 'O ATR digitado tem prioridade');
  // 846,6 ÷ 850 = 99,6%: amarelo e "99%" (verde só a partir de 100%).
  assert.equal(standalone.globalIndustryShare(data).color, '#fdcc05');
  // Correção dos "Indicadores do turno": vale só no fechamento em que foi feita (ref = data_until).
  summary.units[0].data_until = 1794772799;
  summary.units[0].closed_until = 1794772800;
  const corrected = standalone.normalizeReportUnit({ ...ppt, image_overrides: { ref: 1794772799,
    values: { millingShift: 850.5, stock: 50, day: 11945 } } }, 0);
  const fixed = standalone.fieldUnitIndicators(corrected, summary);
  assert.deepEqual([fixed.millingShift, fixed.stock, fixed.day, fixed.deliveryShift, fixed.balance.millingShift, fixed.balance.stock],
    [850.5, 50, 11945, 818, 846.6, 48]);
  assert.deepEqual(Array.from(fixed.corrected), ['millingShift', 'stock', 'day']);
  const earlier = { ...summary, units: [{ ...summary.units[0], closed_until: 1794751200, stock_loads: 31, milling_day_t: 5367.7 }] };
  const historical = standalone.fieldUnitIndicators(corrected, earlier);
  assert.deepEqual([historical.day, historical.stock, historical.corrected.length], [5367.7, 31, 0]);

  const batchId = 'a'.repeat(32);
  const batchCorrection = standalone.normalizeReportUnit({ ...corrected,
    image_overrides: { ...corrected.image_overrides, batch_id: batchId } }, 0);
  const currentBatch = { ...summary, units: [{ ...summary.units[0], batch_id: batchId }] };
  assert.equal(standalone.fieldUnitIndicators(batchCorrection, currentBatch).day, 11945);
  assert.equal(standalone.fieldUnitIndicators(corrected, currentBatch).day, 11763, 'Correção antiga sem lote');
  const replacedBatch = { ...summary, units: [{ ...summary.units[0], batch_id: 'b'.repeat(32), milling_day_t: 11900 }] };
  const reimported = standalone.fieldUnitIndicators(batchCorrection, replacedBatch);
  assert.deepEqual([reimported.closingRef, reimported.closingBatchId, reimported.day, reimported.corrected.length],
    [1794772799, 'b'.repeat(32), 11900, 0]);

  const stoppedUnit = { ...corrected, rows: [['FT 02', '', '', 'PARADA'], ['FT 19', '', '', 'PARADO']] };
  const currentWeighing = { ...summary.units[0], zero_milling_at_latest_close: true,
    hours: [{ hour: 20, shift: 'C', milling_t: 0, delivery_t: 0, loads: 0, trucks: 0 }] };
  const stoppedSummary = { ...summary, units: [currentWeighing] };
  const stopped = standalone.fieldUnitIndicators(stoppedUnit, stoppedSummary);
  assert.deepEqual([stopped.projectionStopped, stopped.projection, stopped.day, stopped.stock],
    [true, null, 11945, 50]);
  const resumedUnit = { ...stoppedUnit, rows: [stoppedUnit.rows[0], ['FT 19', '', '', 'EM ATIVIDADE']] };
  const resumed = standalone.fieldUnitIndicators(resumedUnit, stoppedSummary);
  assert.deepEqual([resumed.projectionStopped, resumed.projection], [false, 18822]);
  assert.equal(standalone.fieldIndicatorTotals([stopped, resumed]).projection, 18822);
  assert.equal(standalone.fieldIndicatorTotals([stopped]).projection, null);
  assert.equal(standalone.fieldUnitIndicators(stoppedUnit, summary).projection, 18822);
  assert.equal(standalone.fieldUnitIndicators({ ...stoppedUnit, rows: [] }, stoppedSummary).projection, 18822);
  assert.equal(standalone.fieldUnitIndicators({ ...stoppedUnit, rows: [['FT 02', '', '', '']] }, stoppedSummary).projection, 18822);
  const idleAllDay = { ...stoppedSummary, units: [{ ...currentWeighing, loads_day: 0,
    milling_day_t: 0, milling_projection_t: 0 }] };
  assert.equal(standalone.fieldUnitIndicators(resumedUnit, idleAllDay).projection, 0);
  ctx.testOverviewUnit = stoppedUnit;
  ctx.testProjectionSummary = stoppedSummary;
  ctx.setReportUnit('PPT');
  vm.runInContext('units[0] = testOverviewUnit; weighingSummary = testProjectionSummary', ctx);
  assert.match(ctx.managementReportHtml(), /Unidade parada/);
  assert.match(ctx.managementReportHtml(), /300 cargas pesadas/);
  ctx.testOverviewUnit = resumedUnit;
  vm.runInContext('units[0] = testOverviewUnit', ctx);
  assert.doesNotMatch(ctx.managementReportHtml(), /Unidade parada/);
  vm.runInContext('weighingSummary = null', ctx);

  summary.units[0].data_until = 1794776399;  // outro SELECT importado: a correção deixa de valer
  summary.units[0].closed_until = 1794776400;
  const stale = standalone.fieldUnitIndicators(corrected, summary);
  assert.deepEqual([stale.millingShift, stale.stock, stale.corrected.length], [846.6, 48, 0]);
  // Moagem do dia consolidada: soma das 4 unidades (processado e projeção), como o modelo
  // (11.763 + 16.498 + 12.390 + 6.612 = 47.263 t; projeções 78.354 t). Unidade sem balança fica fora.
  const consolidated = standalone.fieldIndicatorTotals([[11763, 18822], [16498, 26342], [12390, 21240], [6612, 11950]]
    .map(([day, projection]) => ({ rows: [], active: 0, day, projection, atr: null })));
  assert.deepEqual([consolidated.day, consolidated.projection], [47263, 78354]);
  const partial = standalone.fieldIndicatorTotals([{ rows: [], active: 0, day: 100, projection: 240, atr: null },
    { rows: [], active: 0, day: null, projection: null, atr: null }]);
  assert.deepEqual([partial.day, partial.projection], [100, 240]);
  const fallback = standalone.fieldUnitIndicators(ppt, null);
  // Sem pesagem, o ATR da unidade é a média do ATR digitado nas frentes (FT 19: 125).
  assert.deepEqual([fallback.millingShift, fallback.stock, fallback.atr, fallback.atrSource, fallback.day], [700, 40, 125, 'frentes', null]);
  // Pesagem sem ATR das cargas (QT_ATR vazio no SELECT): média das frentes, digitado primeiro e,
  // sem ele, o da balança da frente (FT 02: 121,06 da balança; FT 19: 125 digitado).
  const noAtr = { ...summary, units: [{ ...summary.units[0], atr: null }] };
  const frontsAtr = standalone.fieldUnitIndicators(ppt, noAtr);
  assert.equal(frontsAtr.atrSource, 'frentes');
  assert(Math.abs(frontsAtr.atr - (121.06 + 125) / 2) < 1e-9);
  assert.equal(standalone.fieldUnitIndicators(ppt, summary).atrSource, 'balança');
  // Com a tonelada das frentes na balança, a média das frentes é ponderada pela cana:
  // (121,06 × 300 + 125 × 100) ÷ 400 = 122,045.
  const weighedFronts = { ...summary, units: [{ ...summary.units[0], atr: null,
    fronts: [{ front: '02', atr: 121.06, tons: 300 }, { front: '19', atr: 130, tons: 100 }] }] };
  assert(Math.abs(standalone.fieldUnitIndicators(ppt, weighedFronts).atr - (121.06 * 300 + 125 * 100) / 400) < 1e-9);
  // ATR médio geral ponderado pelo processado do dia de cada unidade:
  // (118,64 × 11.763 + 128,41 × 16.498) ÷ 28.261.
  const weighted = standalone.fieldIndicatorTotals([[118.64, 11763], [128.41, 16498], [null, 12390]]
    .map(([atr, day]) => ({ rows: [], active: 0, day, projection: null, atr })));
  assert.equal(weighted.atrUnits, 2);
  assert.equal(weighted.atrWeighted, true);
  assert(Math.abs(weighted.atr - (118.64 * 11763 + 128.41 * 16498) / 28261) < 1e-9);
  // A amostra de PPT é de 25 t das 50 t processadas. Usa o ATR da carga antes de arredondar por unidade.
  const sampledSummary = { reference_at: 1, units: [
    { code: 'PPT', loads_day: 2, milling_day_t: 50, atr: 100, atr_weight_t: 25, atr_sample_kg: 2500.125 },
    { code: 'NRD', loads_day: 1, milling_day_t: 75, atr: 120, atr_weight_t: 75, atr_sample_kg: 9000.375 }
  ] };
  const sampled = standalone.fieldIndicatorTotals([ppt, { ...ppt, code: 'NRD' }]
    .map(unit => standalone.fieldUnitIndicators(unit, sampledSummary)));
  assert.equal(sampled.atr, 115.005);
  assert.equal(standalone.fieldIndicatorNumber(sampled.atr, 2), '115,01');
  // Sem processado do dia (só ATR digitado): média simples das unidades que têm ATR.
  const atrTotals = standalone.fieldIndicatorTotals([118.64, 128.41, 119.8, 113.78, null]
    .map(atr => ({ rows: [], active: 0, day: null, projection: null, atr })));
  assert.equal(atrTotals.atrUnits, 4);
  assert(Math.abs(atrTotals.atr - 120.1575) < 1e-9);  // 120,16 no modelo
  drawn.length = 0;
  await standalone.generateSacaroseReportImageBlob(['PPT'], { PPT: [{ front: '1', sector: '10' }], NRD: [{ front: '9', sector: '90' }] }, []);
  assert.deepEqual(drawn.map(item => item.code), ['PPT']);
  const rows = standalone.getSacaroseExportRows('PPT', { PPT: [{ front: '1', sector: '10', exclude_image: true }, { front: '2', sector: '20' }] }, [{ sector: '20', section: '1', description: 'Fazenda' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, 'Fazenda');
  console.log('OK: saudação, filtro compartilhado, isolamento de unidades e emissões HD.');
}

module.exports = { context };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
