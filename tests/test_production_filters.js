const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadScripts, pageScripts } = require('./page_scripts.js');

const elements = new Map();
const modalEvents = [];
const requests = [];
const sectorRows = [];
const sectorEvents = {};
const toasts = [];
const confirmations = [];
const groupEvents = {};
const sheetEvents = {};
const detailClicks = [];
let dashboardGroupClick;
function element(selector) {
  if (!elements.has(selector)) elements.set(selector, {
    innerHTML: '', textContent: '', value: '', hidden: false,
    addEventListener(type, listener) {
      if (selector === '#production-groups-list') groupEvents[type] = listener;
      if (selector === '#production-sheet-rows') sheetEvents[type] = listener;
      if (selector === '#production-sector-rows') sectorEvents[type] = listener;
      if (selector === '#production-front-detail-body' && type === 'click') detailClicks.push(listener);
      if (selector === '#production-group-tabs' && type === 'click') dashboardGroupClick = listener;
    },
    setAttribute() {}, reset() {}, focus() {}, setSelectionRange() {},
    querySelector(name) { return element(`${selector} ${name}`); }
  });
  return elements.get(selector);
}
const document = {
  querySelector: element,
  querySelectorAll(selector) {
    if (selector === '[data-production-sector-row]') return sectorRows;
    return [];
  },
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
const productionTemplate = fs.readFileSync(path.join(__dirname, '../templates/producao.html'), 'utf8');
assert.match(productionTemplate, /id="production-item-id"\s+type="hidden"/);
assert.match(productionTemplate, /Status da frente\s*<\/span>\s*<div id="production-status-options"[^>]*><\/div>\s*<\/label>\s*<div id="production-sector-rows"/);
assert.match(productionTemplate, /data-production-sector-row[\s\S]+data-entry-operation-inputs[\s\S]+data-remove-sector/);
assert.match(productionTemplate, /id="production-remove-front"[^>]*>Remover frente inteira/);
assert.doesNotMatch(productionTemplate, /production-sector-number/);
assert.equal(element('#production-modal-kicker').textContent, 'Atualizar frente');
// O título do popup de edição mostra o nome da frente.
assert.equal(element('#production-modal-title').textContent, vm.runInContext('findProductionItem(2).service_name', context));
// Observação e previsão de mudança saíram do Editar frente (ficam no Detalhe da frente).
assert.doesNotMatch(productionTemplate, /production-entry-notes|production-observation-input|production-changes-input/);

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
assert.match(detail, /Adicionar observação/);
// Outras O.S. ficam numa aba própria (escondida até clicar), separadas das operações.
const othersPanel = detail.split('data-pfd-panel="others" hidden')[1];
assert.ok(othersPanel);
assert.doesNotMatch(othersPanel, /5001/);
assert.match(detail, /data-pfd-tab="others"/);
context.openDashboardFrontDetail(2);
assert.match(element('#production-front-detail-body').innerHTML, /Nenhuma outra O\.S\. aberta no setor 42/);
assert.match(element('#production-front-detail-body').innerHTML, /Equipe do turno.*Ana/s);
const scheduledTile = vm.runInContext("dashboardFrontTile([{ ...findProductionItem(2), responsibles: { A: 'Ana', B: 'João' } }], 'B')", context);
assert.match(scheduledTile, /João/);
assert.doesNotMatch(scheduledTile, /Atualização hoje|pdash-sector-footer/);
assert.doesNotMatch(scheduledTile, /Folguista|Ana/);
const teamTile = vm.runInContext(`dashboardFrontTile([{ ...findProductionItem(2), responsibility_team: { B: [
  {role_name: 'Encarregado', role_type: 'lead', name: 'Ana', day_off: true},
  {role_name: 'Ponto focal', role_type: 'support', name: 'Maria', day_off: false}
] } }], 'B')`, context);
assert.match(teamTile, /Encarregado Ana \(cobertura\) · Ponto focal Maria/);
const schedulingForm = { elements: { kind: { value: 'day_off' }, responsible_name: {}, relief_name: {}, relief_whatsapp: {} } };
context.updateProductionResponsibilityFields(schedulingForm);
assert.equal(element('#production-responsibility-date-label').textContent, 'Data da folga');
assert.equal(schedulingForm.elements.responsible_name.required, false);
assert.equal(schedulingForm.elements.relief_name.disabled, true);
assert.equal(schedulingForm.elements.relief_whatsapp.disabled, true);
assert.equal(element('#production-responsibility-whatsapp-label').textContent, 'WhatsApp de quem cobre (opcional)');
schedulingForm.elements.kind.value = 'cycle';
context.updateProductionResponsibilityFields(schedulingForm);
assert.equal(schedulingForm.elements.responsible_name.required, true);
assert.equal(schedulingForm.elements.relief_name.disabled, false);
assert.equal(schedulingForm.elements.relief_whatsapp.disabled, false);
assert.equal(element('#production-responsibility-relief-whatsapp').hidden, false);
// A mesma frente pode ter lançamentos separados, mesmo na mesma fazenda.
vm.runInContext(`Object.assign(productionItems[0].entry, { sector: '4', farm: 'IZAURA', observation: '<teste>' });
  Object.assign(productionItems[1].entry, { sector: '6', farm: 'IZAURA' });`, context);
context.renderProductionDashboard();
context.renderProductionSummary();
assert.match(element('#production-summary').innerHTML, /title="Em atividade: 1"/);
assert.match(element('#production-summary').innerHTML, /title="Solo úmido: 0"/);
const cards = element('#production-front-cards');
const separateCards = cards.innerHTML.match(/<article[^>]*data-panel-front-card="7"[^>]*>.*?<\/article>/gs) || [];
assert.equal(separateCards.length, 2);
assert.equal(separateCards.filter(card => /Setor 4 · IZAURA/.test(card)).length, 1);
assert.equal(separateCards.filter(card => /Setor 6 · IZAURA/.test(card)).length, 1);
assert.ok(separateCards.every(card => !/Setor 4 · IZAURA.*Setor 6 · IZAURA|Setor 6 · IZAURA.*Setor 4 · IZAURA/s.test(card)));
assert.equal((cards.innerHTML.match(/<option value="7"/g) || []).length, 1);
assert.doesNotMatch(cards.innerHTML, /data-panel-front-card="9"/);
assert.doesNotMatch(cards.innerHTML, /Plantio|Tratos|data-panel-group/);
assert.doesNotMatch(cards.innerHTML, /Resumo do turno/);
assert.match(cards.innerHTML, /data-panel-filter="ok"/);
const dashboardGroups = element('#production-group-tabs');
assert.equal(dashboardGroups.hidden, false);
assert.doesNotMatch(dashboardGroups.innerHTML, /Todos os grupos|data-panel-group=""/);
assert.match(dashboardGroups.innerHTML, /data-panel-group="1" aria-pressed="true"[^>]*>Plantio/);
assert.match(dashboardGroups.innerHTML, /data-panel-group="2"[^>]*>Tratos/);
function selectDashboardGroup(groupId) {
  let focused = false;
  const tab = { dataset: { panelGroup: groupId }, focus() { focused = true; } };
  dashboardGroupClick({ target: { closest: () => tab }, currentTarget: { querySelectorAll: () => [tab] } });
  assert.equal(focused, true);
}
vm.runInContext("dashboardPanelFilter.front = '7'; dashboardPanelFilter.flag = 'ok'", context);
selectDashboardGroup('2');
assert.match(dashboardGroups.innerHTML, /data-panel-group="2" aria-pressed="true"/);
assert.match(cards.innerHTML, /data-panel-front-card="9"/);
assert.doesNotMatch(cards.innerHTML, /data-panel-front-card="7"/);
assert.doesNotMatch(cards.innerHTML, /pdash-sector-notes/);
assert.equal(vm.runInContext('dashboardPanelFilter.front || dashboardPanelFilter.flag', context), '');
selectDashboardGroup('1');
assert.match(cards.innerHTML, /data-panel-front-card="7"/);
assert.doesNotMatch(cards.innerHTML, /data-panel-front-card="9"/);
// Depois de salvar, a página recarrega com a lista vazia por um instante: o grupo, a frente e o
// indicador escolhidos continuam os mesmos quando os lançamentos voltam.
vm.runInContext(`Object.assign(dashboardPanelFilter, { group: '2', front: '9', flag: 'today' });
  savedItemsForReload = productionItems; productionItems = [];`, context);
context.renderProductionDashboard();
assert.deepEqual({ ...vm.runInContext('dashboardPanelFilter', context) }, { group: '2', front: '9', flag: 'today' });
vm.runInContext('productionItems = savedItemsForReload;', context);
context.renderProductionDashboard();
assert.equal(vm.runInContext('dashboardPanelFilter.group + "|" + dashboardPanelFilter.front', context), '2|9');
assert.match(cards.innerHTML, /data-panel-front-card="9"/);
vm.runInContext("Object.assign(dashboardPanelFilter, { group: '1', front: '', flag: '' })", context);
context.renderProductionDashboard();
// Um filtro por O.S. mantém juntos os setores vinculados no formulário.
vm.runInContext(`productionItems[0].sector_group_id = productionItems[1].sector_group_id = 'saved-group';
  dashboardPanelFilter.flag = 'ok';`, context);
context.renderProductionDashboard();
const frontCard = cards.innerHTML.match(/<article[^>]*data-panel-front-card="7"[^>]*>.*?<\/article>/s)?.[0];
assert.ok(frontCard);
assert.match(frontCard, /aria-label="Setor 4 · IZAURA".*aria-label="Setor 6 · IZAURA".*class="pdash-status is-wet"/s);
const frontSectorRows = frontCard.match(/<section class="pdash-sector-row".*?<\/section>/gs);
assert.equal(frontSectorRows.length, 2);
// Status uma vez no cabeçalho (Em atividade); o setor só repete quando é diferente (solo úmido).
assert.equal(frontCard.match(/class="pdash-status is-active"/g).length, 1);
assert.doesNotMatch(frontSectorRows[0], /pdash-status/);
assert.match(frontSectorRows[1], /class="pdash-status is-wet"/);
// Observações por último, depois de todos os setores, cada uma com o seu setor.
assert.doesNotMatch(frontSectorRows.join(''), /Observação/);
assert.match(frontCard, /<\/section>\s*<dl class="pdash-sector-notes pdash-front-notes"><div><dt>Observação<\/dt><dd><b>Setor 4<\/b> <span class="pdash-note">&lt;teste><\/span><\/dd><dd><b>Setor 6<\/b> <span class="pdash-note">Observação anterior/);
assert.doesNotMatch(frontCard, /data-panel-note|Mudança anterior/);
// O cartão inteiro abre o detalhe (um só por frente); o rodapé tem o botão Editar.
assert.equal(frontCard.match(/data-panel-detail=/g).length, 1);
assert.match(frontCard, /<article class="pdash-tile is-clickable[^"]*"[^>]*data-panel-detail="\d+" tabindex="0"[^>]*aria-label="Ver detalhes · Preparo · 2 setores"/);
assert.match(frontCard, /data-panel-card-edit="\d+"[^>]*>Editar<\/button>/);
assert.doesNotMatch(frontCard, /Ver detalhes<\/button>/);
// Detalhe consolidado: operações agrupadas pela operação (uma linha por setor), outras O.S.
// dos setores e a aba Setores com as anotações e o "Remover setor" de cada um.
vm.runInContext(`productionItems[1].entry.operation = '101, 205';
  productionItems[1].service_order = { status: 'missing', missing_operations: ['101', '205'], orders: [
    { number: '6001', sector: '6', operation: '310', operation_name: 'Herbicida', section: '', plots: ['9'], matches: false }] };`, context);
context.openDashboardFrontDetail(2);
const consolidated = element('#production-front-detail-body').innerHTML;
assert.match(consolidated, /2 setores/);
assert.match(consolidated, /101<\/span>\s*<span class="pfd-op-name">Gradagem<\/span>\s*<span class="pfd-op-badge is-order-missing">1\/2 setores com O\.S\./);
assert.match(consolidated, /<b>Setor 4<\/b>O\.S\. 5001.*<b>Setor 6<\/b>Sem O\.S\./s);
assert.match(consolidated, /205<\/span>\s*<span class="pfd-op-name">Operação sem nome no cadastro/);
// Setor 4 já tem a O.S. 5002 (Calagem) e o setor 6 a 6001 (Herbicida): 2 outras O.S.
assert.match(consolidated, /data-pfd-tab="others">Outras O\.S\. nos setores <small>2<\/small>/);
assert.match(consolidated, /<b>Setor 4<\/b>O\.S\. 5002/);
assert.match(consolidated, /<b>Setor 6<\/b>O\.S\. 6001 · Talhão 9/);
assert.match(consolidated, /data-panel-remove="1"[^>]*>Remover setor.*data-panel-remove="2"[^>]*>Remover setor/s);
// Observações na lateral: um campo de observação e um de previsão para a frente inteira
// (os textos diferentes dos setores juntos, um por linha), valendo para os 2 setores.
assert.match(consolidated, /<aside class="pfd-aside"[^>]*>.*data-note-field="observation">&lt;teste>\nObservação anterior<\/textarea>.*data-note-field="changes">Mudança anterior<\/textarea>.*Vale para os 2 setores da frente.*Salvar observações/s);
assert.equal(consolidated.match(/data-note-field=/g).length, 2);
assert.doesNotMatch(consolidated, /<h4>Setor/);
assert.doesNotMatch(consolidated.split('<aside')[0], /&lt;teste>|Mudança anterior/);
assert.match(consolidated, /data-panel-edit="\d+"[^>]*>Editar frente/);
vm.runInContext(`productionItems[1].entry.operation = ''; delete productionItems[1].service_order;`, context);
assert.doesNotMatch(cards.innerHTML, /data-panel-front-card="9"/);
const addProductionSector = context.addProductionSector;
const editCompanions = [];
context.addProductionSector = item => editCompanions.push(item.id);
context.openEditProductionItem(2);
assert.deepEqual(editCompanions, [1]);
context.addProductionSector = addProductionSector;
vm.runInContext(`delete productionItems[0].sector_group_id;
  delete productionItems[1].sector_group_id;`, context);
context.openDashboardFrontDetail(1);
assert.match(element('#production-front-detail-body').innerHTML, /&lt;teste>/);
context.openDashboardFrontDetail(2);
assert.match(element('#production-front-detail-body').innerHTML, /data-note-field="changes">Mudança anterior<\/textarea>/);
assert.doesNotMatch(element('#production-front-detail-body').innerHTML, /Vale para os/);
assert.doesNotMatch(element('#production-front-detail-body').innerHTML, /<h4>Setor/);
vm.runInContext(`Object.assign(productionItems[0].entry, { sector: '42', farm: '' });
  Object.assign(productionItems[1].entry, { sector: '42', farm: '' });`, context);
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

function sectorRow(sector, operation = '') {
  const fields = { sector: { value: sector, focus() {} }, section: { value: '' }, farm: { value: '' } };
  const scan = { innerHTML: '', textContent: '' };
  const suggestions = { innerHTML: '' };
  const removeButton = { hidden: true };
  const operations = [{ value: operation }];
  return { fields, scan, operations, suggestions, dataset: {},
    remove() { sectorRows.splice(sectorRows.indexOf(this), 1); },
    querySelectorAll(selector) { return selector === '[data-entry-op]' ? operations : []; },
    querySelector(selector) {
      if (selector === '[data-sector-scan]') return scan;
      if (selector === '[data-entry-operation-suggestions]') return suggestions;
      if (selector === '[data-remove-sector]') return removeButton;
      const match = selector.match(/^\[data-sector-field="(.+)"\]$/);
      return match ? fields[match[1]] : null;
    }
  };
}

(async () => {
  assert.equal(typeof context.openProductionRainModal, 'undefined', 'A Produção não tem mais o preenchimento de chuva');
  assert.equal(typeof context.submitProductionDailySummary, 'undefined');

  context.refreshProductionPage = async () => {};
  element('#production-front-input').value = '7';
  element('[data-production-status-select]').value = 'UMIDO';
  const editedFirst = sectorRow('42', '101');
  const editedSecond = sectorRow('43', '205');
  sectorRows.push(editedFirst, editedSecond);
  editedFirst.dataset.linkedItemId = '2';
  editedSecond.dataset.linkedItemId = '8';
  await context.submitProductionEntry({ preventDefault() {} });
  const update = requests.at(-1);
  assert.equal(update.url, '/api/production/my-items/2');
  assert.equal(update.options.method, 'PUT');
  const updatedSectors = JSON.parse(update.options.body).sectors;
  // A edição não envia as anotações: o servidor mantém a observação e a previsão já salvas.
  assert.ok(!('observation' in updatedSectors[0]) && !('changes' in updatedSectors[0]));
  assert.deepEqual(updatedSectors.map(item => item.status), ['UMIDO', 'UMIDO']);
  assert.deepEqual(updatedSectors.map(item => item.operation), ['101', '205']);
  assert.equal(updatedSectors[1].id, 8);

  context.updateProductionSectorRows();
  assert.equal(editedFirst.querySelector('[data-remove-sector]').hidden, false);
  sectorEvents.click({ target: { closest: selector => editedFirst.querySelector(selector)
    || (selector === '[data-production-sector-row]' ? editedFirst : null) } });
  assert.deepEqual(sectorRows, [editedSecond]);
  assert.equal(editedSecond.querySelector('[data-remove-sector]').hidden, true);
  await context.submitProductionEntry({ preventDefault() {} });
  const reduced = JSON.parse(requests.at(-1).options.body);
  assert.deepEqual(reduced.removed_sector_ids, [2]);
  assert.deepEqual(reduced.sectors.map(({ id, operation }) => [id, operation]), [[8, '205']]);
  await context.removeProductionFront();
  assert.equal(requests.at(-1).url, '/api/production/my-items/2?scope=front');
  assert.deepEqual(JSON.parse(requests.at(-1).options.body).item_ids.sort(), [2, 8]);
  assert.match(confirmations.at(-1), /todos os setores vinculados/);
  sectorRows.unshift(editedFirst);
  delete editedFirst.dataset.linkedItemId;
  delete editedSecond.dataset.linkedItemId;

  await context.removeProductionItem(2);
  assert.equal(requests.at(-1).url, '/api/production/my-items/2');
  assert.equal(requests.at(-1).options.method, 'DELETE');
  assert.match(confirmations.at(-1), /setor 42.*NRD/);

  vm.runInContext('productionEditingItemId = null', context);
  await context.submitProductionEntry({ preventDefault() {} });
  const batch = requests.at(-1);
  assert.equal(batch.url, '/api/production/my-items/batch');
  assert.deepEqual(JSON.parse(batch.options.body).sectors.map(item => [item.sector, item.status, item.operation]),
    [['42', 'UMIDO', '101'], ['43', 'UMIDO', '205']]);
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

  const ambiguous = sectorRow('1608');
  ambiguous.fields.section.value = '380';
  const lookup = context.resolveSectorFromBase(ambiguous, { keep: true });
  pending.at(-1).resolve({ items: [{ section: '515', farm: 'MUTUM' }, { section: '516', farm: 'MUTUM II' }] });
  await lookup;
  assert.equal(ambiguous.fields.section.required, true);
  assert.equal(ambiguous.fields.section.value, '');
  assert.match(ambiguous.fields.section.innerHTML, /Confirme a seção/);
  assert.match(context.dashboardSectionWarning({ section_warning: { saved: '380', choices: ['515'] } }),
    /Seção gravada 380 · Cadastro 515/);

  const concurrentStart = pending.length;
  const oldScan = context.scanProductionSector(first);
  first.fields.sector.value = '201';
  const newScan = context.scanProductionSector(first);
  const otherScan = context.scanProductionSector(second);
  assert.match(pending[concurrentStart + 1].url, /unit=NRD&sector=201/);
  pending[concurrentStart + 1].resolve({ orders: [{ operation: '101', operation_name: 'Gradagem' }] });
  pending[concurrentStart + 2].resolve({ orders: [{ operation: '205', operation_name: 'Calagem' }] });
  pending[concurrentStart].resolve({ orders: [{ operation: '205', operation_name: 'Calagem' }] });
  await Promise.all([oldScan, newScan, otherScan]);
  assert.match(first.suggestions.innerHTML, /Gradagem/);
  assert.doesNotMatch(first.suggestions.innerHTML, /Calagem/);
  assert.match(second.suggestions.innerHTML, /Calagem/);
  assert.equal(first.scan.textContent, '');
  assert.equal(second.scan.textContent, '');
  first.operations[0].value = '0205';
  context.refreshProductionSectorWarning(first);
  assert.match(first.scan.textContent, /Setor 201 sem O\.S\. aberta para a operação 0205/);
  assert.equal(second.scan.textContent, '');
  assert.equal(pending.length, concurrentStart + 3);
  vm.runInContext('productionEditingItemId = 2', context);
  const editScan = context.scanProductionSector(first);
  pending.at(-1).resolve({ orders: [{ operation: '101', operation_name: 'Gradagem' }] });
  await editScan;
  assert.equal(first.suggestions.innerHTML, '');
  assert.match(first.scan.textContent, /Setor 201 sem O\.S\. aberta para a operação 0205/);
  vm.runInContext('productionEditingItemId = null', context);

  assert.equal(context.productionPlaceLabel({ sector: '201', section: '20', farm: 'Fazenda 201' }, 'NRD'), 'Setor 201 · Fazenda 201');
  assert.equal(context.productionPlaceLabel({ sector: '201', section: '20', farm: 'Fazenda 201' }, 'RBR'), 'Setor 201 / Seção 20 · Fazenda 201');

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
  assert.doesNotMatch(cards.innerHTML, /production-sector-card/);
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

  context.loadProductionItems = async () => true;
  context.apiRequest = async (url, options) => { requests.push({ url, options }); return { ok: true }; };
  // Salvar observações da lateral: grava só o campo alterado, conferindo o texto anterior.
  context.openDashboardFrontDetail(2);
  const notesButton = { disabled: false };
  const notesStatus = { hidden: true, textContent: '', classList: { toggle() {} } };
  const noteInputs = [
    { dataset: { noteField: 'observation' }, value: 'Observação anterior' },
    { dataset: { noteField: 'changes' }, value: 'Ir ao novo setor após 16h' }];
  const requestsBefore = requests.length;
  await context.saveDashboardNotes({ querySelectorAll: () => noteInputs,
    querySelector: selector => (selector.includes('button') ? notesButton : notesStatus) });
  assert.equal(requests.length, requestsBefore + 1);
  const noteUpdate = requests.at(-1);
  assert.equal(noteUpdate.url, '/api/production/my-items/2');
  assert.equal(noteUpdate.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(noteUpdate.options.body), { unit_code: 'NRD', work_date: context.saoPauloIsoDate(),
    field: 'changes', expected: 'Mudança anterior', value: 'Ir ao novo setor após 16h' });
  assert.equal(notesStatus.hidden, true);

  // Frente com 2 setores: a observação digitada uma vez vai para os dois lançamentos, cada um
  // conferindo o seu texto anterior; a previsão sem alteração não grava nada.
  vm.runInContext(`Object.assign(productionItems[0].entry, { sector: '4', observation: '<teste>' });
    Object.assign(productionItems[1].entry, { sector: '6', observation: 'Observação anterior', changes: '' });
    productionItems[0].sector_group_id = productionItems[1].sector_group_id = 'saved-group';`, context);
  context.openDashboardFrontDetail(1);
  const groupedBefore = requests.length;
  await context.saveDashboardNotes({ querySelectorAll: () => [
    { dataset: { noteField: 'observation' }, value: 'Aguardando prancha' },
    { dataset: { noteField: 'changes' }, value: '' }],
  querySelector: selector => (selector.includes('button') ? { disabled: false } : notesStatus) });
  const grouped = requests.slice(groupedBefore).map(request => [request.url, JSON.parse(request.options.body)]);
  assert.deepEqual(grouped.map(([url, body]) => [url, body.field, body.expected, body.value]), [
    ['/api/production/my-items/1', 'observation', '<teste>', 'Aguardando prancha'],
    ['/api/production/my-items/2', 'observation', 'Observação anterior', 'Aguardando prancha']]);
  vm.runInContext(`delete productionItems[0].sector_group_id; delete productionItems[1].sector_group_id;`, context);

  const responsibilityForm = element('#production-responsibility-form');
  responsibilityForm.dataset = {};
  responsibilityForm.elements = Object.fromEntries(['rule_id', 'unit_code', 'role_id', 'shift',
    'kind', 'work_date', 'responsible_name', 'relief_name', 'responsible_whatsapp', 'relief_whatsapp'].map(name => [name, { value: '' }]));
  responsibilityForm.elements.unit_code.form = responsibilityForm;
  responsibilityForm.elements.kind.value = 'cycle';
  const frontChoices = responsibilityForm.querySelector('#production-responsibility-fronts');
  const picker = responsibilityForm.querySelector('#production-responsibility-front-picker');
  const summary = responsibilityForm.querySelector('#production-responsibility-front-summary');
  responsibilityForm.querySelectorAll = () => [...frontChoices.innerHTML.matchAll(/value="(\d+)" checked \/>\s*<span>([^<]+)<\/span>/g)]
    .map(([, value, textContent]) => ({ value, nextElementSibling: { textContent } }));
  vm.runInContext(`productionAccess.units = ['NRD','PPT'];
    productionResponsibilityUnit = 'NRD'; productionResponsibilityState = 'ready';
    productionResponsibilityPermissions = {edit_schedules: true};`, context);
  context.openProductionResponsibilityForm(null, { keepOpen: true });
  assert.equal(responsibilityForm.elements.unit_code.value, 'NRD');
  assert.match(responsibilityForm.elements.unit_code.innerHTML, /value="PPT"/);
  assert.match(productionTemplate, /<details id="production-responsibility-front-picker"[^>]*>\s*<summary[\s\S]*?<div id="production-responsibility-fronts"/);
  assert.match(frontChoices.innerHTML, /type="checkbox"[^>]*value="7"[\s\S]*?<span>Preparo<\/span>/);
  assert.equal(picker.open, false);
  assert.equal(summary.textContent, 'Selecione');
  context.apiRequest = async url => url.includes('/responsibilities?')
    ? { permissions: { edit_schedules: true } }
    : { groups: [{ name: 'Colheita', fronts: [{ id: 31, name: 'Frente de PPT' }, { id: 32, name: 'Frente 2 de PPT' }] }] };
  responsibilityForm.elements.unit_code.value = 'PPT';
  await context.changeProductionResponsibilityUnit({ currentTarget: responsibilityForm.elements.unit_code });
  assert.equal(responsibilityForm.dataset.scheduleUnit, 'PPT');
  assert.match(frontChoices.innerHTML, /Frente de PPT/);
  assert.doesNotMatch(frontChoices.innerHTML, /Preparo/);
  context.FormData = function (form) {
    const data = Object.entries(form.elements).filter(([, field]) => !field.disabled).map(([key, field]) => [key, field.value]);
    data.push(...form.querySelectorAll('#production-responsibility-fronts input:checked').map(choice => ['service_front_id', choice.value]));
    data.getAll = name => data.filter(([key]) => key === name).map(([, value]) => value);
    return data;
  };
  context.apiRequest = async (url, options) => { requests.push({ url, options }); return { ids: [99, 100] }; };
  const beforeEmptySchedule = requests.length;
  await context.submitProductionResponsibility({ currentTarget: responsibilityForm, preventDefault() {} });
  assert.equal(requests.length, beforeEmptySchedule);
  assert.match(toasts.at(-1), /Selecione pelo menos uma frente/);
  assert.equal(picker.open, true);
  frontChoices.innerHTML = frontChoices.innerHTML.replace(/value="(31|32)"/g, 'value="$1" checked');
  responsibilityForm.elements.work_date.value = '2099-11-25';
  responsibilityForm.elements.responsible_whatsapp.value = '(18) 99123-4567';
  context.updateResponsibilityFrontSummary(responsibilityForm);
  assert.equal(summary.textContent, '2 frentes selecionadas');
  await context.submitProductionResponsibility({ currentTarget: responsibilityForm, preventDefault() {} });
  const schedule = requests.at(-1);
  assert.equal(schedule.url, '/api/production/catalog/responsibilities');
  const schedulePayload = JSON.parse(schedule.options.body);
  assert.deepEqual([schedulePayload.unit_code, schedulePayload.service_front_ids], ['PPT', [31, 32]]);
  assert.ok(!('service_front_id' in schedulePayload));
  assert.equal(schedulePayload.responsible_whatsapp, '(18) 99123-4567');
  assert.match(toasts.at(-1), /Vigência programada para 25\/11\/2099/);
  assert.equal(context.currentProductionUnit(), 'NRD');
  context.openProductionResponsibilityForm({ id: 99, service_front_id: 7, kind: 'cycle' });
  assert.match(frontChoices.innerHTML, /type="radio"[^>]*value="7" checked/);
  assert.equal(summary.textContent, 'Preparo');
  assert.equal(picker.open, false);

  const groupedSchedule = vm.runInContext(`
    const scheduleSource = { kind: 'cycle', role_id: 1, role_name: 'Encarregado', shift: 'C',
      work_date: '2026-11-25', responsible_name: 'Renato', relief_name: '',
      responsible_whatsapp: '5518991234567', relief_whatsapp: '' };
    productionResponsibilities = [
      { ...scheduleSource, id: 101, service_front_id: 7, service_name: 'Preparo' },
      { ...scheduleSource, id: 102, service_front_id: 8, service_name: 'Sulcação' },
      { ...scheduleSource, id: 103, service_front_id: 7, service_name: 'Preparo', shift: 'A' }
    ];
    renderProductionResponsibilities();
    groupedResponsibilityRules()[0];`, context);
  const schedulesHtml = element('#production-responsibilities-list').innerHTML;
  assert.equal((schedulesHtml.match(/<article/g) || []).length, 2);
  assert.match(schedulesHtml, /data-responsibility-group-edit="101"[^>]*>Editar em conjunto/);
  assert.match(schedulesHtml, /<summary>2 frentes<\/summary>[\s\S]*?data-responsibility-edit="102"/);
  assert.match(schedulesHtml, /<strong>Renato<a class="whatsapp-link"[^>]*href="https:\/\/web\.whatsapp\.com\/send\?phone=5518991234567"[\s\S]*?<span class="whatsapp-number">\(18\) 99123-4567<\/span>/);
  context.openProductionResponsibilityForm(groupedSchedule[0], { keepOpen: true, batch: groupedSchedule });
  assert.equal(responsibilityForm.elements.responsible_whatsapp.value, '(18) 99123-4567');
  const batchFronts = responsibilityForm.querySelector('#production-responsibility-batch-fronts');
  assert.equal(batchFronts.textContent, 'Preparo, Sulcação');
  assert.equal(picker.hidden, true);
  assert.match(responsibilityForm.querySelector('button[type="submit"]').textContent, /Salvar para 2 frentes/);
  responsibilityForm.elements.work_date.value = '2026-11-24';
  context.apiRequest = async (url, options) => {
    requests.push({ url, options });
    return options?.method === 'PUT' ? { ids: [101, 102] }
      : { rules: [], roles: [], permissions: { edit_schedules: true, edit_roles: true } };
  };
  await context.submitProductionResponsibility({ currentTarget: responsibilityForm, preventDefault() {} });
  const editRequest = requests.findLast(request => request.options?.method === 'PUT');
  assert.equal(editRequest.url, '/api/production/catalog/responsibilities');
  const editPayload = JSON.parse(editRequest.options.body);
  assert.deepEqual(editPayload.targets, [{ id: 101, service_front_id: 7 }, { id: 102, service_front_id: 8 }]);
  assert.equal(editPayload.previous.work_date, '2026-11-25');
  assert.equal(editPayload.previous.responsible_whatsapp, '5518991234567');
  assert.equal(editPayload.work_date, '2026-11-24');
  assert.equal(picker.hidden, false);

  const [targetRow, draftRow, removedRow] = vm.runInContext(`productionSheetUnit = 'NRD';
    productionSheetRows = productionItems.map(sheetRowFromItem);`, context);
  draftRow.observation = 'Observação ainda em edição';
  removedRow.removed = true;
  assert.match(context.sheetRowHtml(targetRow), /data-sheet-action="update"[^>]*>Atualizar/);
  assert.doesNotMatch(context.sheetRowHtml(removedRow), /data-sheet-action="update"/);
  const sheetUpdate = { dataset: { sheetAction: 'update' } };
  const targetTr = { dataset: { sheetRow: targetRow.key }, classList: { toggle() {} }, querySelector() {} };
  const clickRowUpdate = () => sheetEvents.click({ target: { closest: selector =>
    selector === '[data-sheet-action]' ? sheetUpdate : selector === '[data-sheet-row]' ? targetTr : null } });
  vm.runInContext(`productionSheetSections.set('44', [{ section: '10' }, { section: '20' }]);`, context);
  sheetEvents.change({ target: { value: '44', dataset: { sheetField: 'sector' }, closest: () => targetTr } });
  assert.equal(targetTr.outerHTML, undefined, 'Editing the sector leaves the update button in place');
  assert.match(context.sheetRowHtml(targetRow), /data-sheet-field="section"/);
  await clickRowUpdate();
  assert.equal(toasts.at(-1), 'Confirme a seção do setor 44.');
  sheetEvents.change({ target: { value: '20', dataset: { sheetField: 'section' }, closest: () => targetTr } });

  let finishSheetSave;
  const sheetRefreshes = [];
  context.loadProductionItems = async unit => { sheetRefreshes.push(unit); };
  context.apiRequest = (url, options) => {
    requests.push({ url, options });
    return new Promise(resolve => { finishSheetSave = resolve; });
  };
  const previousModalEvents = modalEvents.length;
  const sheetSave = clickRowUpdate();
  const sheetRequest = requests.at(-1);
  assert.equal(sheetRequest.url, '/api/production/my-items/sheet');
  const sheetPayload = JSON.parse(sheetRequest.options.body);
  assert.equal(sheetPayload.unit_code, 'NRD');
  assert.deepEqual(sheetPayload.removed, []);
  assert.deepEqual(sheetPayload.rows.map(row => [row.id, row.sector]), [[targetRow.id, '44']]);
  assert.equal(sheetPayload.rows[0].section, '20');
  assert.equal(element('#production-sheet-save').disabled, true);
  await clickRowUpdate();
  assert.equal(requests.at(-1), sheetRequest);
  finishSheetSave({ saved: 1, removed: 0, item_ids: [targetRow.id] });
  await sheetSave;
  assert.equal(element('#production-sheet-save').disabled, false);
  assert.deepEqual(sheetRefreshes, ['NRD']);
  assert.equal(modalEvents.length, previousModalEvents);
  assert.equal(context.sheetRowChanged(targetRow), false);
  assert.equal(context.sheetRowChanged(draftRow), true);
  assert.equal(removedRow.removed, true);
  assert.equal(element('#production-sheet-status').textContent, '2 alterações para salvar.');

  const newSheetRow = vm.runInContext(`addProductionSheetRow({ render: false }); productionSheetRows[0]`, context);
  assert.equal(newSheetRow.id, null);
  newSheetRow.sector = '45';
  const newSheetSave = context.saveProductionSheet(newSheetRow);
  assert.equal(JSON.parse(requests.at(-1).options.body).rows[0].id, null);
  finishSheetSave({ saved: 1, removed: 0, item_ids: [45] });
  await newSheetSave;
  assert.equal(newSheetRow.id, 45);
  assert.equal(context.sheetRowChanged(newSheetRow), false);
  const batchSheetSave = context.saveProductionSheet();
  await new Promise(resolve => setImmediate(resolve));
  const remainingSheetPayload = JSON.parse(requests.at(-1).options.body);
  assert.deepEqual(remainingSheetPayload.rows.map(row => row.id), [draftRow.id]);
  assert.deepEqual(remainingSheetPayload.removed, [removedRow.id]);
  finishSheetSave({ saved: 1, removed: 1, item_ids: [draftRow.id] });
  await batchSheetSave;
  assert.equal(modalEvents.at(-1), 'close:production-sheet-modal');

  // "Adicionar frente" abre no filtro do painel: grupo Plantio e frente Sulcação (sem
  // lançamento nela, a planilha já começa com uma linha nova da Sulcação).
  context.apiRequest = async () => ({ items: [] });
  element('#production-sheet-rows').closest = () => null;
  vm.runInContext(`productionAccess.permissions.fill = true;
    Object.assign(dashboardPanelFilter, { group: '2', front: '8', flag: '' });`, context);
  await context.openProductionSheet();
  assert.equal(element('#production-sheet-group').value, '1');
  assert.equal(element('#production-sheet-front').value, '8');
  assert.equal(vm.runInContext('productionSheetRows[0].frontId', context), '8');
  // Só o grupo filtrado no painel: abre nele, com todas as frentes do grupo.
  vm.runInContext("Object.assign(dashboardPanelFilter, { group: '2', front: '' })", context);
  await context.openProductionSheet();
  assert.equal(element('#production-sheet-group').value, '2');
  assert.equal(element('#production-sheet-front').value, '');
  // WhatsApp do responsável: número formatado e ícone que abre a conversa, na frente do nome.
  assert.equal(context.formatWhatsapp('5518991234567'), '(18) 99123-4567');
  assert.equal(context.formatWhatsapp('551833334444'), '(18) 3333-4444');
  assert.equal(context.whatsappLinkHtml(''), '');
  const team = { responsibility_team: { B: [
    { role_name: 'Encarregado', role_type: 'lead', name: 'João', whatsapp: '5518991234567', day_off: false },
    { role_name: 'Ponto focal', role_type: 'support', name: 'Bia', whatsapp: '', day_off: false }] } };
  const who = context.productionResponsibleHtml(team, 'B');
  assert.match(who, /^Encarregado João<a class="whatsapp-link has-tooltip" data-whatsapp-link href="https:\/\/web\.whatsapp\.com\/send\?phone=5518991234567" target="_blank"\s+rel="noopener noreferrer"/);
  assert.match(who, /aria-label="Conversar no WhatsApp com João: \(18\) 99123-4567"/);
  // No cartão: só o ícone, com o número no balão (sem o title nativo do navegador).
  assert.match(who, /<span class="whatsapp-tooltip" role="tooltip"><small>WhatsApp · João<\/small><strong>\(18\) 99123-4567<\/strong><em>Clique para abrir a conversa<\/em><\/span>/);
  assert.doesNotMatch(who, /title=|whatsapp-number/);
  assert.match(who, /<\/a> · Ponto focal Bia$/);
  const detailWho = context.productionResponsibleHtml(team, 'B', true);
  assert.match(detailWho, /<span class="whatsapp-number">\(18\) 99123-4567<\/span><\/a>/);
  assert.doesNotMatch(detailWho, /whatsapp-tooltip/);
  assert.equal(context.productionResponsibleHtml({ responsibles: { B: 'Ana' } }, 'B'), 'Ana');
  // Celular: wa.me (abre o aplicativo); computador: WhatsApp Web direto na conversa.
  context.navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' };
  assert.equal(context.whatsappChatUrl('5518991234567'), 'https://wa.me/5518991234567');
  context.navigator = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131' };
  assert.equal(context.whatsappChatUrl('5518991234567'), 'https://web.whatsapp.com/send?phone=5518991234567');
  console.log('OK: frentes dentro dos grupos, inclusão com grupo selecionado, busca e consulta sem edição.');
})().catch(error => { console.error(error); process.exitCode = 1; });
