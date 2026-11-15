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
  // Correção da etapa "Imagem CTT": vale só no fechamento em que foi feita (ref = data_until).
  summary.units[0].data_until = 1794772799;
  const corrected = standalone.normalizeReportUnit({ ...ppt, image_overrides: { ref: 1794772799, values: { millingShift: 850.5, stock: 50 } } }, 0);
  const fixed = standalone.fieldUnitIndicators(corrected, summary);
  assert.deepEqual([fixed.millingShift, fixed.stock, fixed.deliveryShift, fixed.balance.millingShift, fixed.balance.stock],
    [850.5, 50, 818, 846.6, 48]);
  assert.deepEqual(Array.from(fixed.corrected), ['millingShift', 'stock']);
  summary.units[0].data_until = 1794776399;  // outro SELECT importado: a correção deixa de valer
  const stale = standalone.fieldUnitIndicators(corrected, summary);
  assert.deepEqual([stale.millingShift, stale.stock, stale.corrected.length], [846.6, 48, 0]);
  const fallback = standalone.fieldUnitIndicators(ppt, null);
  assert.deepEqual([fallback.millingShift, fallback.stock, fallback.atr, fallback.day], [700, 40, null, null]);
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
