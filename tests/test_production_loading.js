const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadScripts, pageScripts } = require('./page_scripts.js');

function setup() {
  let unit = 'PPT';
  const pending = [];
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {value: '', hidden: false, disabled: false, textContent: '', addEventListener() {}});
      return elements.get(selector);
    }, querySelectorAll() { return []; }, addEventListener() {}
  };
  const context = vm.createContext({document, console, getReportUnit: () => unit,
    apiRequest(url) { return new Promise((resolve, reject) => pending.push({url, resolve, reject})); }});
  loadScripts(context, ['core/format.js', ...pageScripts('/producao')],
    source => source.replace(/initializeProductionPage\(\);\s*$/, ''));
  vm.runInContext(`productionAccess = {enabled: true, units: ['PPT','NRD'], permissions: {summary: true}};
    renderProductionFilters = () => {};
    renderProductionItems = () => {};
    renderStatusOptions = () => {};
    setProductionContext = () => {};
    saoPauloIsoDate = () => '2026-10-23';`, context);
  return {context, pending, elements, select(value) { unit = value; },
    state() { return JSON.parse(vm.runInContext('JSON.stringify({productionItems, productionCatalog})', context)); }};
}

const tick = () => new Promise(resolve => setImmediate(resolve));
function finishDependencies(requests, unit) {
  requests[0].resolve({unit, groups: [{name: unit}]});
  requests[1].resolve({statuses: []});
}

async function main() {
  // Items already in flight must not overwrite a different unit, even if they finish last.
  const t = setup();
  const older = t.context.refreshProductionPage('PPT');
  finishDependencies(t.pending.slice(0, 2), 'PPT');
  await tick();
  const oldItems = t.pending[2];
  t.select('NRD');
  const newer = t.context.refreshProductionPage('NRD');
  assert.deepEqual(t.state().productionItems, []);
  finishDependencies(t.pending.slice(3, 5), 'NRD');
  await tick();
  t.pending[5].resolve({items: [{unit: 'NRD'}]});
  await newer;
  oldItems.resolve({items: [{unit: 'PPT'}]});
  await older;
  assert.equal(t.state().productionItems[0].unit, 'NRD');
  assert.equal(t.state().productionCatalog.unit, 'NRD');

  // Epochs also reject old catalog/status responses after PPT -> NRD -> PPT.
  const s = setup();
  const first = s.context.refreshProductionPage('PPT');
  const oldDependencies = s.pending.slice(0, 2);
  s.select('NRD');
  const second = s.context.refreshProductionPage('NRD');
  const middleDependencies = s.pending.slice(2, 4);
  s.select('PPT');
  const last = s.context.refreshProductionPage('PPT');
  finishDependencies(s.pending.slice(4, 6), 'PPT');
  await tick();
  s.pending[6].resolve({items: [{unit: 'PPT', latest: true}]});
  await last;
  oldDependencies[0].resolve({unit: 'PPT', groups: [{name: 'obsolete'}]});
  oldDependencies[1].resolve({statuses: []});
  finishDependencies(middleDependencies, 'NRD');
  await Promise.all([first, second]);
  assert.equal(s.pending.length, 7, 'Obsolete refreshes never launch an item request');
  assert.equal(s.state().productionItems[0].latest, true);
  assert.notEqual(s.state().productionCatalog.groups[0].name, 'obsolete');

  const panel = setup();
  const windowEvents = new Map();
  const documentEvents = new Map();
  let periodCheck;
  panel.context.window = {
    location: { pathname: '/producao' }, setInterval(callback) { periodCheck = callback; },
    addEventListener(type, callback) { windowEvents.set(type, callback); }
  };
  panel.context.document.addEventListener = (type, callback) => documentEvents.set(type, callback);
  panel.context.dashboardCurrentShift = () => ({ name: 'C' });
  panel.context.startProductionResponsibilityClock();
  await periodCheck();
  assert.equal(panel.pending.length, 0, 'The clock waits for a shift change while the panel remains open');
  panel.context.document.hidden = true;
  await documentEvents.get('visibilitychange')();
  assert.equal(panel.pending.length, 0);
  panel.context.document.hidden = false;
  const resumed = documentEvents.get('visibilitychange')();
  await windowEvents.get('focus')();
  assert.equal(panel.pending.length, 1, 'Returning to the tab reloads the current shift once');
  const newerItems = panel.context.loadProductionItems('PPT');
  panel.pending[1].resolve({ items: [{ responsibles: { C: 'Novo encarregado' } }] });
  await newerItems;
  panel.pending[0].resolve({ items: [{ responsibles: {} }] });
  await resumed;
  assert.equal(panel.state().productionItems[0].responsibles.C, 'Novo encarregado');

  const catalog = setup();
  const { context } = catalog;
  context.document.body = { dataset: { page: 'production_catalog' } };
  const refreshCatalog = context.refreshProductionPage('PPT');
  finishDependencies(catalog.pending.slice(0, 2), 'PPT');
  await tick();
  assert.equal(catalog.pending.length, 2, 'Cadastros opens without loading daily production items');
  await refreshCatalog;

  const scheduleButton = context.document.querySelector('#production-responsibility-add');
  Object.assign(scheduleButton, { tagName: 'BUTTON', dataset: { responsibilityPermission: 'edit_schedules' } });
  const roleButton = context.document.querySelector('#production-responsibility-role-add');
  Object.assign(roleButton, { tagName: 'BUTTON', dataset: { responsibilityPermission: 'edit_roles' } });
  context.document.querySelectorAll = selector => selector === '[data-responsibility-permission]' ? [scheduleButton, roleButton] : [];
  const status = context.document.querySelector('#production-responsibility-status');
  const feedback = context.document.querySelector('#production-responsibility-feedback');
  const retry = context.document.querySelector('#production-responsibility-retry');
  const load = context.loadProductionResponsibilities();
  assert.equal(scheduleButton.hidden, false);
  assert.equal(scheduleButton.disabled, true);
  assert.match(status.textContent, /Carregando/);
  const data = { roles: [{ id: 1, name: 'Encarregado', role_type: 'lead' }], rules: [] };
  catalog.pending.at(-1).resolve({ ...data, permissions: { edit_schedules: true, edit_roles: true } });
  await load;
  assert.equal(scheduleButton.disabled, false);
  assert.equal(roleButton.disabled, false);
  assert.equal(feedback.hidden, true);

  const restricted = context.loadProductionResponsibilities();
  catalog.pending.at(-1).resolve({ ...data, permissions: { edit_schedules: false, edit_roles: false } });
  await restricted;
  assert.equal(scheduleButton.disabled, true);
  assert.equal(roleButton.disabled, true);
  assert.match(status.textContent, /acesso de consulta/);

  context.console = { ...console, warn() {} };
  const failed = context.loadProductionResponsibilities();
  catalog.pending.at(-1).reject(new Error('Servidor indisponível'));
  await failed;
  assert.match(status.textContent, /Não foi possível carregar/);
  assert.equal(retry.hidden, false);
  const retried = context.loadProductionResponsibilities();
  catalog.pending.at(-1).resolve({ ...data, permissions: { edit_schedules: true, edit_roles: false } });
  await retried;
  assert.equal(retry.hidden, true);
  assert.equal(scheduleButton.disabled, false);
  assert.equal(roleButton.disabled, true);
  console.log('OK: responses from obsolete production units/epochs cannot replace current data.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
