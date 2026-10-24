const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js/producao.js'), 'utf8')
    .replace(/initializeProductionPage\(\);\s*$/, ''), context);
  vm.runInContext(`productionAccess = {enabled: true, units: ['PPT','NRD'], permissions: {summary: true}};
    renderProductionFilters = () => {};
    renderProductionItems = () => {};
    renderStatusOptions = () => {};
    setProductionContext = () => {};
    localIsoDate = () => '2026-10-23';`, context);
  return {context, pending, elements, select(value) { unit = value; },
    state() { return JSON.parse(vm.runInContext('JSON.stringify({productionItems, productionCatalog})', context)); }};
}

const tick = () => new Promise(resolve => setImmediate(resolve));
function finishDependencies(requests, unit) {
  requests[0].resolve({unit, groups: [{name: unit}]});
  requests[1].resolve({statuses: []});
  requests[2].resolve({summary: {rain_turn_mm: unit === 'NRD' ? 5 : 99, rain_accumulated_mm: 10}});
}

async function main() {
  // Items already in flight must not overwrite a different unit, even if they finish last.
  const t = setup();
  const older = t.context.refreshProductionPage('PPT');
  finishDependencies(t.pending.slice(0, 3), 'PPT');
  await tick();
  const oldItems = t.pending[3];
  t.select('NRD');
  const newer = t.context.refreshProductionPage('NRD');
  assert.deepEqual(t.state().productionItems, []);
  finishDependencies(t.pending.slice(4, 7), 'NRD');
  await tick();
  t.pending[7].resolve({items: [{unit: 'NRD'}]});
  await newer;
  oldItems.resolve({items: [{unit: 'PPT'}]});
  await older;
  assert.equal(t.state().productionItems[0].unit, 'NRD');
  assert.equal(t.state().productionCatalog.unit, 'NRD');
  assert.equal(t.elements.get('#production-rain-turn').value, 5);

  // Epochs also reject old catalog/summary responses after PPT -> NRD -> PPT.
  const s = setup();
  const first = s.context.refreshProductionPage('PPT');
  const oldDependencies = s.pending.slice(0, 3);
  s.select('NRD');
  const second = s.context.refreshProductionPage('NRD');
  const middleDependencies = s.pending.slice(3, 6);
  s.select('PPT');
  const last = s.context.refreshProductionPage('PPT');
  finishDependencies(s.pending.slice(6, 9), 'PPT');
  await tick();
  s.pending[9].resolve({items: [{unit: 'PPT', latest: true}]});
  await last;
  oldDependencies[0].resolve({unit: 'PPT', groups: [{name: 'obsolete'}]});
  oldDependencies[1].resolve({statuses: []});
  oldDependencies[2].resolve({summary: {rain_turn_mm: 777}});
  finishDependencies(middleDependencies, 'NRD');
  await Promise.all([first, second]);
  assert.equal(s.pending.length, 10, 'Obsolete refreshes never launch an item request');
  assert.equal(s.state().productionItems[0].latest, true);
  assert.notEqual(s.state().productionCatalog.groups[0].name, 'obsolete');
  assert.notEqual(s.elements.get('#production-rain-turn').value, 777);
  console.log('OK: responses from obsolete production units/epochs cannot replace current data.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
