const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const elements = new Map();
const modalEvents = [];
const requests = [];
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
  querySelectorAll() { return []; },
  addEventListener() {}
};
const context = vm.createContext({
  document, console,
  getReportUnit: () => 'NRD',
  escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
  openModal(id) { modalEvents.push(`open:${id}`); },
  closeModal(id) { modalEvents.push(`close:${id}`); },
  showToast() {},
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
      is_current_day: true, entry: { id: 2, work_date: '2026-10-18', updated_at: 20, sector: '42', status: 'UMIDO' } },
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
assert.match(element('#production-items-body').innerHTML, /Último registro: 17\/10\/2026/);
assert.equal(element('#production-list-status').textContent, '2 lançamentos · 2 analistas');
context.openEditProductionItem(2);
assert.equal(element('#production-item-id').value, '1');
assert.equal(element('#production-modal-title').textContent, 'Atualizar frente');
assert.equal(element('#production-observation-input').value, '');

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
})().catch(error => { console.error(error); process.exitCode = 1; });
