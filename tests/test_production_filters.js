const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const elements = new Map();
const modalEvents = [];
const requests = [];
const sectorRows = [];
const toasts = [];
const confirmations = [];
function element(selector) {
  if (!elements.has(selector)) elements.set(selector, {
    innerHTML: '', textContent: '', value: '', hidden: false,
    addEventListener() {}, setAttribute() {}, reset() {}, focus() {},
    querySelector(name) { return element(`${selector} ${name}`); }
  });
  return elements.get(selector);
}
const document = {
  querySelector: element,
  querySelectorAll(selector) { return selector === '[data-production-sector-row]' ? sectorRows : []; },
  addEventListener() {}
};
const context = vm.createContext({
  document, console,
  window: { confirm(message) { confirmations.push(message); return true; } },
  getReportUnit: () => 'NRD',
  escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
  openModal(id) { modalEvents.push(`open:${id}`); },
  closeModal(id) { modalEvents.push(`close:${id}`); },
  showToast(message) { toasts.push(message); },
  apiRequest: async (url, options) => {
    requests.push({ url, options });
    return url.includes('/daily-summary?')
      ? { summary: { rain_turn_mm: 2, rain_accumulated_mm: 5, updated_at: 1 } }
      : {};
  }
});
const scripts = ['production-consolidation.js', 'producao.js'];
for (const name of scripts) {
  const source = fs.readFileSync(path.join(__dirname, '../static/js', name), 'utf8')
    .replace(/initializeProductionPage\(\);\s*$/, '');
  vm.runInContext(source, context);
}

vm.runInContext(`
  productionAccess = { enabled: true, units: ['NRD'], permissions: { fill: true } };
  productionStatuses = [{ code: 'ATIVO', name: 'Em atividade', style_key: 'active' },
    { code: 'UMIDO', name: 'Solo úmido', style_key: 'wet' }];
  productionCatalog = { groups: [
    { id: 1, name: 'Plantio', fronts: [{ id: 7, name: 'Preparo' }, { id: 8, name: 'Sulcação' }] },
    { id: 2, name: 'Tratos', fronts: [{ id: 9, name: 'Cultivo' }] }
  ] };
  productionItems = [
    { id: 1, group_id: 1, group_name: 'Plantio', service_front_id: 7,
      service_name: 'Preparo', owner_name: 'Titular', owner_user_id: 1, is_own: true,
      is_current_day: true, entry: { id: 1, work_date: '2026-10-18', updated_at: 10, sector: '42', status: 'ATIVO' } },
    { id: 2, group_id: 1, group_name: 'Plantio', service_front_id: 7,
      service_name: 'Preparo', owner_name: 'Folguista', owner_user_id: 2, is_own: false,
      is_current_day: true, entry: { id: 2, work_date: '2026-10-18', updated_at: 20, sector: '42', status: 'UMIDO',
        observation: 'Observação anterior', changes: 'Mudança anterior' } },
    { id: 3, group_id: 2, group_name: 'Tratos', service_front_id: 9,
      service_name: 'Cultivo', owner_name: 'Titular', owner_user_id: 1, is_own: true,
      is_current_day: false, entry: { id: 3, work_date: '2026-10-17', updated_at: 5, sector: '10', status: 'ATIVO' } }
  ];
`, context);

context.renderProductionFilters();
context.renderProductionItems();
assert.match(element('#production-items-body').innerHTML, /Folguista/);
assert.doesNotMatch(element('#production-items-body').innerHTML, /Titular.*Preparo/s);
assert.match(element('#production-items-body').innerHTML, /Atualizar/);
assert.match(element('#production-items-body').innerHTML, /data-production-action="remove" data-item-id="2"/);
assert.match(element('#production-items-body').innerHTML, /Último registro: 17\/10\/2026/);
assert.equal(element('#production-list-status').textContent, '2 lançamentos · 2 analistas');
context.openEditProductionItem(2);
assert.equal(vm.runInContext('productionEditingItemId', context), 2);
assert.equal(element('#production-item-id').value, '2');
assert.match(fs.readFileSync(path.join(__dirname, '../templates/producao.html'), 'utf8'), /id="production-item-id"\s+type="hidden"/);
assert.equal(element('#production-modal-title').textContent, 'Atualizar frente');
assert.equal(element('#production-observation-input').value, 'Observação anterior');
assert.equal(element('#production-changes-input').value, 'Mudança anterior');

vm.runInContext("productionFilterGroup = '1'", context);
context.renderProductionFilters();
context.renderProductionItems();
assert.match(element('#production-filter-front').innerHTML, /Sulcação/);
assert.doesNotMatch(element('#production-filter-front').innerHTML, /Cultivo/);
assert.doesNotMatch(element('#production-items-body').innerHTML, /Cultivo/);
assert.equal(element('#production-list-status').textContent, '1 lançamento · 1 analista');

vm.runInContext("productionFilterFront = '8'", context);
context.renderProductionItems();
assert.equal(element('#production-empty').hidden, false);

function sectorRow(sector, status = 'ATIVO') {
  const fields = { sector: { value: sector, focus() {} }, section: { value: '' }, farm: { value: '' } };
  return { fields, querySelector(selector) {
    if (selector === '[data-production-status]:checked') return status ? { value: status } : null;
    const match = selector.match(/^\[data-sector-field="(.+)"\]$/);
    return match ? fields[match[1]] : null;
  } };
}

(async () => {
  vm.runInContext('productionAccess.permissions.summary = true', context);
  await context.openProductionRainModal();
  assert.equal(element('#production-rain-unit').textContent, 'NRD — Narandiba');
  assert.equal(element('#production-rain-turn').value, 2);
  assert.ok(modalEvents.includes('open:production-rain-modal'));
  element('#production-rain-turn').value = '3';
  await context.submitProductionDailySummary({ preventDefault() {} });
  const save = requests.find(request => request.options?.method === 'PUT');
  assert.equal(JSON.parse(save.options.body).unit_code, 'NRD');
  assert.equal(JSON.parse(save.options.body).rain_turn_mm, '3');
  assert.ok(modalEvents.includes('close:production-rain-modal'));

  context.refreshProductionPage = async () => {};
  element('#production-front-input').value = '7';
  sectorRows.push(sectorRow('42', 'UMIDO'));
  await context.submitProductionEntry({ preventDefault() {} });
  const update = requests.at(-1);
  assert.equal(update.url, '/api/production/my-items/2');
  assert.equal(update.options.method, 'PUT');
  assert.equal(JSON.parse(update.options.body).observation, 'Observação anterior');
  await context.removeProductionItem(2);
  assert.equal(requests.at(-1).url, '/api/production/my-items/2');
  assert.equal(requests.at(-1).options.method, 'DELETE');
  assert.match(confirmations.at(-1), /setor 42.*NRD/);

  vm.runInContext('productionEditingItemId = null', context);
  sectorRows.push(sectorRow('43'));
  await context.submitProductionEntry({ preventDefault() {} });
  const batch = requests.at(-1);
  assert.equal(batch.url, '/api/production/my-items/batch');
  assert.deepEqual(JSON.parse(batch.options.body).sectors.map(item => [item.sector, item.status]), [['42', 'UMIDO'], ['43', 'ATIVO']]);
  sectorRows[1].fields.sector.value = ' 42 ';
  const requestCount = requests.length;
  await context.submitProductionEntry({ preventDefault() {} });
  assert.equal(requests.length, requestCount);
  assert.match(toasts.at(-1), /repetido/);

  // Delayed sector-base responses must remain tied to their own row and current value.
  const pending = [];
  context.apiRequest = (url) => new Promise(resolve => pending.push({ url, resolve }));
  const first = sectorRows[0];
  first.fields.sector.value = '100';
  const oldLookup = context.resolveSectorFromBase(first);
  first.fields.sector.value = '200';
  const newLookup = context.resolveSectorFromBase(first);
  const second = sectorRows[1];
  second.fields.sector.value = '300';
  const otherLookup = context.resolveSectorFromBase(second);
  pending[1].resolve({ items: [{ section: '20', farm: 'Fazenda 200' }] });
  pending[2].resolve({ items: [{ section: '30', farm: 'Fazenda 300' }] });
  await Promise.all([newLookup, otherLookup]);
  pending[0].resolve({ items: [{ section: '10', farm: 'Fazenda antiga' }] });
  await oldLookup;
  assert.equal(first.fields.farm.value, 'Fazenda 200');
  assert.equal(second.fields.farm.value, 'Fazenda 300');

  let finishLookup;
  let savedPayload;
  context.apiRequest = (url, options) => {
    if (url.includes('/sector-options?')) return new Promise(resolve => { finishLookup = resolve; });
    savedPayload = JSON.parse(options.body);
    return Promise.resolve({});
  };
  first.fields.sector.value = '400';
  const lookupBeforeSave = context.resolveSectorFromBase(first);
  const saveWhileLoading = context.submitProductionEntry({ preventDefault() {} });
  assert.equal(savedPayload, undefined);
  assert.equal(element('#production-entry-submit').disabled, true);
  finishLookup({ items: [{ section: '40', farm: 'Fazenda 400' }] });
  await Promise.all([lookupBeforeSave, saveWhileLoading]);
  assert.equal(savedPayload.sectors[0].farm, 'Fazenda 400');
  assert.equal(savedPayload.sectors[0].section, '40');
})().catch(error => { console.error(error); process.exitCode = 1; });
