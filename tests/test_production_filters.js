const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadScripts, pageScripts } = require('./page_scripts.js');

const elements = new Map();
const modalEvents = [];
const requests = [];
const sectorRows = [];
const toasts = [];
const confirmations = [];
const groupEvents = {};
function element(selector) {
  if (!elements.has(selector)) elements.set(selector, {
    innerHTML: '', textContent: '', value: '', hidden: false,
    addEventListener(type, listener) { if (selector === '#production-groups-list') groupEvents[type] = listener; },
    setAttribute() {}, reset() {}, focus() {},
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
  document, console, URLSearchParams, setTimeout, clearTimeout,
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
// Helpers puros de data/número (core/format.js) e os scripts da página /producao.
// O escapeHtml simulado acima continua valendo para as asserções deste teste.
const escapeHtmlStub = context.escapeHtml;
loadScripts(context, ['core/format.js', ...pageScripts('/producao')],
  source => source.replace(/initializeProductionPage\(\);\s*$/, ''));
context.escapeHtml = escapeHtmlStub;
// A janela de confirmação do sistema (core/dialog.js) precisa de DOM real; aqui só registra o texto.
context.askConfirmation = async options => { confirmations.push(`${options.title} ${options.message}`); return true; };

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
      responsibles: { A: 'Ana', B: 'Ana', C: 'Ana' },
      is_current_day: true, entry: { id: 2, work_date: '2026-10-18', updated_at: 20, sector: '42', status: 'UMIDO',
        observation: 'Observação anterior', changes: 'Mudança anterior' } },
    { id: 3, group_id: 2, group_name: 'Tratos', service_front_id: 9,
      service_name: 'Cultivo', owner_name: 'Titular', owner_user_id: 1, is_own: true,
      is_current_day: false, entry: { id: 3, work_date: '2026-10-17', updated_at: 5, sector: '10', status: 'ATIVO' } }
  ];
`, context);

context.renderProductionFilters();
context.renderProductionItems();
assert.match(element('#production-items-body').innerHTML, /Preparo<\/strong><small>Operação \/ serviço · Ana/);
assert.match(element('#production-items-body').innerHTML, /Cultivo<\/strong><small>Operação \/ serviço · Sem responsável escalado/);
assert.doesNotMatch(element('#production-items-body').innerHTML, /Titular|Folguista/);
assert.match(element('#production-items-body').innerHTML, /Atualizar/);
assert.match(element('#production-items-body').innerHTML, /data-production-action="remove" data-item-id="2"/);
assert.match(element('#production-items-body').innerHTML, /Último registro: 17\/10\/2026/);
assert.equal(element('#production-list-status').textContent, '2 lançamentos · 2 analistas');
context.openEditProductionItem(2);
assert.equal(vm.runInContext('productionEditingItemId', context), 2);
assert.equal(element('#production-item-id').value, '2');
assert.match(fs.readFileSync(path.join(__dirname, '../templates/producao.html'), 'utf8'), /id="production-item-id"\s+type="hidden"/);
assert.equal(element('#production-modal-kicker').textContent, 'Atualizar frente');
// O título do popup de edição mostra o nome da frente.
assert.equal(element('#production-modal-title').textContent, vm.runInContext('findProductionItem(2).service_name', context));
assert.equal(element('#production-observation-input').value, 'Observação anterior');
assert.equal(element('#production-changes-input').value, 'Mudança anterior');

// Painel: o detalhe da frente mostra as outras O.S. abertas no setor (as que não conferem
// com as operações do lançamento), com a operação de cada uma.
vm.runInContext(`productionItems[0].entry.operation = '101';
  productionItems[0].service_order = { status: 'ok', orders: [
    { number: '5001', operation: '101', operation_name: 'Gradagem', section: '1', plots: ['1'], matches: true },
    { number: '5002', operation: '205', operation_name: 'Calagem', section: '1', plots: ['2', '3'], matches: false }] };`, context);
context.openDashboardFrontDetail(1);
const detail = element('#production-front-detail-body').innerHTML;
assert.match(detail, /Outras O\.S\. no setor <small>1<\/small>/);
assert.match(detail, /205<\/span>\s*<span class="pfd-op-name">Calagem/);
assert.match(detail, /O\.S\. 5002/);
// Outras O.S. ficam numa aba própria (escondida até clicar), separadas das operações.
const othersPanel = detail.split('data-pfd-panel="others" hidden')[1];
assert.ok(othersPanel);
assert.doesNotMatch(othersPanel, /5001/);
assert.match(detail, /data-pfd-tab="others"/);
context.openDashboardFrontDetail(2);
assert.match(element('#production-front-detail-body').innerHTML, /Nenhuma outra O\.S\. aberta no setor 42/);
assert.match(element('#production-front-detail-body').innerHTML, /Equipe do turno.*Ana/s);
const scheduledTile = vm.runInContext("dashboardFrontTile({ ...findProductionItem(2), responsibles: { A: 'Ana', B: 'João' } }, 'B')", context);
assert.match(scheduledTile, /João · Atualização/);
assert.doesNotMatch(scheduledTile, /Folguista|Ana/);
const teamTile = vm.runInContext(`dashboardFrontTile({ ...findProductionItem(2), responsibility_team: { B: [
  {role_name: 'Encarregado', role_type: 'lead', name: 'Ana', day_off: true},
  {role_name: 'Ponto focal', role_type: 'support', name: 'Maria', day_off: false}
] } }, 'B')`, context);
assert.match(teamTile, /Encarregado Ana \(cobertura\) · Ponto focal Maria/);
const schedulingForm = { elements: { kind: { value: 'day_off' }, responsible_name: {}, relief_name: {} } };
context.updateProductionResponsibilityFields(schedulingForm);
assert.equal(element('#production-responsibility-date-label').textContent, 'Data da folga');
assert.equal(schedulingForm.elements.responsible_name.required, false);
assert.equal(schedulingForm.elements.relief_name.disabled, true);
schedulingForm.elements.kind.value = 'cycle';
context.updateProductionResponsibilityFields(schedulingForm);
assert.equal(schedulingForm.elements.responsible_name.required, true);
assert.equal(schedulingForm.elements.relief_name.disabled, false);
// Filtros do grupo: só aparecem quando alguma frente está na condição (Plantio: 1 sem O.S.,
// 1 sem operação, nenhuma parada).
vm.runInContext("productionPanelGroup = '1'", context);
context.renderProductionDashboard();
const groupCards = element('#production-group-cards').innerHTML;
assert.match(groupCards, /data-panel-filter="noOperation"/);
assert.match(groupCards, /data-panel-filter="ok"/);
assert.doesNotMatch(groupCards, /data-panel-filter="stopped"/);
assert.doesNotMatch(groupCards, /data-panel-filter="noOrder"/);
// Filtro ligado cuja condição deixou de existir volta para "todas as frentes".
vm.runInContext("dashboardPanelFilter.flag = 'stopped'", context);
context.renderProductionDashboard();
assert.equal(vm.runInContext('dashboardPanelFilter.flag', context), '');

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

function sectorRow(sector, status = 'ATIVO', operations = []) {
  const fields = { sector: { value: sector, focus() {} }, section: { value: '' }, farm: { value: '' } };
  const scan = { innerHTML: '', textContent: '' };
  return { fields, scan, querySelectorAll() { return operations.map(value => ({ value })); }, querySelector(selector) {
    if (selector === '[data-sector-scan]') return scan;
    if (selector === '[data-production-status]:checked') return status ? { value: status } : null;
    const match = selector.match(/^\[data-sector-field="(.+)"\]$/);
    return match ? fields[match[1]] : null;
  } };
}

(async () => {
  assert.equal(typeof context.openProductionRainModal, 'undefined', 'A Produção não tem mais o preenchimento de chuva');
  assert.equal(typeof context.submitProductionDailySummary, 'undefined');

  context.refreshProductionPage = async () => {};
  element('#production-front-input').value = '7';
  sectorRows.push(sectorRow('42', 'UMIDO', ['101']), sectorRow('43', 'ATIVO', ['205']));
  await context.submitProductionEntry({ preventDefault() {} });
  const update = requests.at(-1);
  assert.equal(update.url, '/api/production/my-items/2');
  assert.equal(update.options.method, 'PUT');
  const updatedSectors = JSON.parse(update.options.body).sectors;
  assert.equal(updatedSectors[0].observation, 'Observação anterior');
  assert.deepEqual(updatedSectors.map(item => [item.sector, item.operation]), [['42', '101'], ['43', '205']]);
  await context.removeProductionItem(2);
  assert.equal(requests.at(-1).url, '/api/production/my-items/2');
  assert.equal(requests.at(-1).options.method, 'DELETE');
  assert.match(confirmations.at(-1), /setor 42.*NRD/);

  vm.runInContext('productionEditingItemId = null', context);
  await context.submitProductionEntry({ preventDefault() {} });
  const batch = requests.at(-1);
  assert.equal(batch.url, '/api/production/my-items/batch');
  assert.deepEqual(JSON.parse(batch.options.body).sectors.map(item => [item.sector, item.status]), [['42', 'UMIDO'], ['43', 'ATIVO']]);
  sectorRows[1].fields.sector.value = ' 42 ';
  const requestCount = requests.length;
  await context.submitProductionEntry({ preventDefault() {} });
  assert.equal(requests.length, requestCount);
  assert.match(toasts.at(-1), /repetido/);

  const previousApiRequest = context.apiRequest;
  context.apiRequest = async (url, options) => {
    requests.push({ url, options });
    return { statuses: [{ id: 1, code: 'ATIVO', name: 'Em atividade', style_key: 'active', is_active: true }],
      archived_statuses: [{ id: 9, code: 'ANTIGO', name: 'Status excluído', style_key: 'wet', is_active: false }] };
  };
  await context.loadProductionConfigStatuses();
  await context.loadProductionStatuses();
  assert.doesNotMatch(element('#production-status-list').innerHTML, /Status excluído/);
  context.renderStatusOptions();
  assert.doesNotMatch(element('#production-status-options').innerHTML, /Status excluído/);
  assert.match(context.statusBadge('ANTIGO'), /is-wet.*Status excluído/);
  await context.deleteProductionStatus(9, 'Status excluído');
  assert(requests.some(request => request.url === '/api/production/statuses/9' && request.options?.method === 'DELETE'));
  assert.match(confirmations.at(-1), /histórico serão preservados/);
  assert.doesNotMatch(confirmations.at(-1), /não pode ser apagado/);
  context.apiRequest = previousApiRequest;

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

  const concurrentStart = pending.length;
  const oldScan = context.scanProductionSector(first);
  first.fields.sector.value = '201';
  const newScan = context.scanProductionSector(first);
  const otherScan = context.scanProductionSector(second);
  assert.match(pending[concurrentStart + 1].url, /unit=NRD&sector=201/);
  pending[concurrentStart + 1].resolve({ orders: [{ operation: '101', operation_name: 'Gradagem' }] });
  pending[concurrentStart + 2].resolve({ orders: [] });
  pending[concurrentStart].resolve({ orders: [{ operation: '205', operation_name: 'Calagem' }] });
  await Promise.all([oldScan, newScan, otherScan]);
  assert.match(first.scan.innerHTML, /Gradagem/);
  assert.doesNotMatch(first.scan.innerHTML, /Calagem/);
  assert.match(second.scan.innerHTML, /Nenhuma operação/);

  assert.equal(context.productionPlaceLabel({ sector: '201', section: '20', farm: 'Fazenda 201' }, 'NRD'), 'Setor 201 · Fazenda 201');
  assert.equal(context.productionPlaceLabel({ sector: '201', section: '20', farm: 'Fazenda 201' }, 'RBR'), 'Setor 201 / Seção 20 · Fazenda 201');
  const grouped = vm.runInContext(`productionStatuses.push({code: 'PARADA', name: 'Parada', style_key: 'stopped'});
    dashboardGroupStats([
      { service_front_id: 7, entry: { sector: '201', status: 'ATIVO' } },
      { service_front_id: 7, entry: { sector: '202', status: 'PARADA' } }
    ])`, context);
  assert.deepEqual([grouped.total, grouped.active, grouped.stopped], [1, 1, 0]);

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

  // A busca mostra apenas O.S. do setor digitado e esconde o cartão ao limpar.
  context.URLSearchParams = URLSearchParams;
  context.apiRequest = async url => {
    assert.match(url, /service-orders\?unit=NRD&search=42/);
    return { orders: [{ number: '7001', sector: '42', section: '1', operation: '101', operation_name: 'Gradagem', plots: ['1'] },
      { number: '7002', sector: '420', section: '1', operation: '205', operation_name: 'Calagem', plots: [] }] };
  };
  await context.searchDashboardSector('042');
  const sectorCard = element('#production-sector-card');
  assert.equal(sectorCard.hidden, false);
  assert.match(sectorCard.innerHTML, /O\.S\. do setor 042/);
  assert.match(sectorCard.innerHTML, /7001/);
  assert.doesNotMatch(sectorCard.innerHTML, /7002/);
  context.renderProductionDashboard();
  assert.doesNotMatch(element('#production-overview').innerHTML, /production-sector-card/);
  assert.match(sectorCard.innerHTML, /7001/);

  let finishSectorSearch;
  context.apiRequest = () => new Promise(resolve => { finishSectorSearch = resolve; });
  const previousQuery = context.searchDashboardSector('042');
  await context.searchDashboardSector('043', { delay: 300 });
  finishSectorSearch({ orders: [{ sector: '42', number: '7001', operation: '101' }] });
  await previousQuery;
  assert.match(sectorCard.innerHTML, /O\.S\. do setor 043/);
  assert.doesNotMatch(sectorCard.innerHTML, /7001/);
  element('#production-sector-search').value = '043';
  context.clearDashboardSectorSearch();
  assert.equal(sectorCard.hidden, true);
  assert.equal(sectorCard.innerHTML, '');
  assert.equal(element('#production-sector-search').value, '');
  assert.equal(element('#production-sector-clear').hidden, true);

  vm.runInContext(`
    productionAccess.permissions.configure = true;
    productionConfigCatalog = { groups: [
      {id: 1, name: 'Preparo', position: 0, is_active: true, fronts: [
        {id: 7, group_id: 1, name: 'Sulcação', display_style: 'operation', is_active: true}
      ]},
      {id: 2, name: 'Colheita', position: 1, is_active: true, fronts: [
        {id: 8, group_id: 2, name: 'Frente 19', display_style: 'front', is_active: true}
      ]},
      {id: 3, name: 'Tratos', position: 2, is_active: true, fronts: []}
    ]};
  `, context);
  context.renderProductionConfigLists();
  const configGroups = element('#production-groups-list');
  const [prep, harvest, emptyGroup] = configGroups.innerHTML.split('</details>');
  assert.match(prep, /data-catalog-group-id="1" open.*Sulcação/s);
  assert.doesNotMatch(prep, /Frente 19/);
  assert.match(harvest, /data-catalog-group-id="2".*Frente 19/s);
  assert.match(emptyGroup, /data-catalog-group-id="3".*Nenhuma frente ou serviço cadastrado/s);
  assert.equal(element('[data-catalog-count="groups"]').textContent, '3');

  groupEvents.click({ target: { closest: () => ({ dataset: { configAction: 'add-front', groupId: '2' } }) } });
  assert.equal(element('#production-config-front-group').value, '2');
  assert.equal(element('#production-front-editor').open, true);
  groupEvents.toggle({ target: { dataset: { catalogGroupId: '2' }, open: true } });
  const groupSearch = element('[data-catalog-search="groups"]');
  groupSearch.value = 'sulcacao';
  context.applyCatalogSearch('groups');
  assert.match(configGroups.innerHTML, /Preparo.*Sulcação/s);
  assert.doesNotMatch(configGroups.innerHTML, /Frente 19/);
  groupSearch.value = '';
  vm.runInContext('productionAccess.permissions.configure = false', context);
  context.applyCatalogSearch('groups');
  assert.match(configGroups.innerHTML, /data-catalog-group-id="2" open/);
  assert.doesNotMatch(configGroups.innerHTML, /data-config-action/);
  console.log('OK: frentes dentro dos grupos, inclusão com grupo selecionado, busca e consulta sem edição.');
})().catch(error => { console.error(error); process.exitCode = 1; });
