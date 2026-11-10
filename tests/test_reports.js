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
  ctx.positionReportsFlyout();
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
  standalone.loadReportUnitIconImage = async () => null;
  standalone.loadSacaroseHeaderIconImage = async () => null;
  // A emissão global carrega a arte de referência direto por loadImageAsset.
  standalone.loadImageAsset = async () => ({ width: 4096, height: 2304, close() {} });
  standalone.loadEmbeddedReportUnitSymbol = async () => null;
  standalone.drawSacaroseExportUnit = (ctx, code) => { drawn.push({ code }); return 200; };
  const unit = { code: 'NRD', name: 'Narandiba', rows: [['1', '10', 'green', 'EM ATIVIDADE']], rain: [] };
  const global = ['PPT', 'NRD', 'RBR', 'PST'].map(code => ({ ...unit, code }));
  // A emissão global usa o layout aprovado (900 px de referência, escala 2x)
  // e desenha cada unidade em globalDrawCard.
  standalone.globalDrawCard = (ctx, layout, unit) => drawn.push({ code: unit.code, layout });
  const globalImage = await standalone.generateReportImageBlob(global);
  assert.equal(globalImage.width, 1800);
  assert.deepEqual(drawn.map(item => item.code).sort(), ['NRD', 'PPT', 'PST', 'RBR']);
  await assert.rejects(standalone.generateReportImageBlob([unit]), /quatro unidades/);
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
