// Produção Agrícola: lançamentos do dia, filtros, chuva e inicialização da página.
const PRODUCTION_STATUS_STYLES = {
  active: { className: 'is-active', label: 'Verde' },
  wet: { className: 'is-wet', label: 'Amarelo' },
  waiting: { className: 'is-waiting', label: 'Cinza' },
  stopped: { className: 'is-stopped', label: 'Vermelho' }
};

const PRODUCTION_UNIT_NAMES = {
  PPT: 'Paraguaçu Paulista',
  NRD: 'Narandiba',
  RBR: 'Rio Brilhante',
  PST: 'Passa Tempo'
};

let productionAccess = null;
let productionCatalog = { groups: [] };
let productionStatuses = [];
let productionConfigStatuses = [];
let productionArchivedStatuses = [];
let productionItems = [];
let productionEditingItemId = null;
let productionFilterGroup = '';
let productionFilterFront = '';
// Grupo e Frente filtrados ficam salvos na aba (por conta e unidade) para não voltarem a "Todos" ao atualizar.
const PRODUCTION_FILTERS_KEY = `posicao-campo-production-filters:${(typeof currentUser !== 'undefined' && currentUser?.id) || 'anonymous'}`;
const productionSectorOptions = new WeakMap();
let productionSectorSequence = 0;
let productionPageEpoch = 0;

function isCurrentProductionRequest(unit, epoch) {
  return unit === currentProductionUnit() && epoch === productionPageEpoch;
}

// Mensagem para quando a gravação deu certo, mas a recarga da tela falhou.
const PRODUCTION_REFRESH_WARNING = 'Os dados foram salvos, mas não foi possível atualizar a tela. Recarregue a página para ver a versão mais recente.';

function allowedProductionUnits() {
  return Array.isArray(productionAccess?.units) ? productionAccess.units : [];
}

function canFillProduction() {
  return Boolean(productionAccess?.unit_permissions?.[currentProductionUnit()]?.fill ?? productionAccess?.permissions?.fill);
}

function canEditProductionDailySummary() {
  return Boolean(productionAccess?.enabled && allowedProductionUnits().includes(currentProductionUnit()) &&
    (productionAccess?.unit_permissions?.[currentProductionUnit()]?.summary ?? productionAccess?.permissions?.summary));
}

function canConfigureProduction() {
  return Boolean(productionAccess?.permissions?.configure);
}

function updateProductionAccessMessage() {
  const message = document.querySelector('#production-access-message');
  if (!message) return;
  message.hidden = canFillProduction();
  if (!message.hidden) message.textContent = canEditProductionDailySummary()
    ? 'As frentes estão em modo de consulta. Você pode preencher a chuva da unidade.'
    : 'Esta unidade está liberada somente para consulta.';
}

function selectedNavbarProductionUnit() {
  const selected = getReportUnit();
  const units = allowedProductionUnits();
  return units.includes(selected) ? selected : (units[0] || selected);
}

function currentProductionUnit() {
  return selectedNavbarProductionUnit();
}

function productionUnitLabel(unit) {
  return `${unit} — ${PRODUCTION_UNIT_NAMES[unit] || unit}`;
}

function setProductionContext(unit) {
  const label = document.querySelector('#production-current-unit');
  const date = document.querySelector('#production-current-date');
  if (label) label.textContent = productionUnitLabel(unit);
  if (date) date.textContent = formatIsoDateBr(saoPauloIsoDate());
}

function setProductionEntryUnit(unit = selectedNavbarProductionUnit()) {
  const units = allowedProductionUnits();
  const selected = units.includes(unit) ? unit : selectedNavbarProductionUnit();
  const input = document.querySelector('#production-unit-input');
  const label = document.querySelector('#production-entry-unit-label');
  if (input) input.value = selected || '';
  if (label) label.textContent = selected ? productionUnitLabel(selected) : '-';
  return selected;
}

function setProductionConfigUnit(unit = selectedNavbarProductionUnit()) {
  const units = allowedProductionUnits();
  const selected = units.includes(unit) ? unit : selectedNavbarProductionUnit();
  const input = document.querySelector('#production-config-unit-input');
  if (input) input.value = selected || '';
  return selected;
}

async function loadProductionAccess() {
  const data = await apiRequest('/api/production/access');
  productionAccess = data.access || { enabled: false, permissions: {}, units: [] };
  const addButton = document.querySelector('#production-add-button');
  if (addButton) addButton.hidden = !canFillProduction();
  const rainButton = document.querySelector('#production-rain-button');
  if (rainButton) rainButton.hidden = !canEditProductionDailySummary();
  const configButton = document.querySelector('#production-config-toggle');
  if (configButton) configButton.hidden = !canConfigureProduction();

  const units = allowedProductionUnits();
  if (!units.length) throw new Error('Nenhuma unidade foi liberada para a Produção Agrícola.');
  if (!units.includes(getReportUnit())) setReportUnit(units[0]);
  return currentProductionUnit();
}

async function loadProductionCatalog(unit, epoch = productionPageEpoch) {
  const data = await apiRequest(`/api/production/catalog?unit=${encodeURIComponent(unit)}`);
  if (!isCurrentProductionRequest(unit, epoch)) return null;
  productionCatalog = data;
  return productionCatalog;
}

async function loadProductionStatuses({ includeInactive = false } = {}) {
  const suffix = includeInactive ? '?include_inactive=1' : '';
  const data = await apiRequest(`/api/production/statuses${suffix}`);
  const statuses = Array.isArray(data.statuses) ? data.statuses : [];
  productionArchivedStatuses = Array.isArray(data.archived_statuses) ? data.archived_statuses : [];
  if (includeInactive) productionConfigStatuses = statuses;
  else productionStatuses = statuses;
  return statuses;
}

async function loadProductionItems(unit, epoch = productionPageEpoch) {
  const workDate = saoPauloIsoDate();
  const data = await apiRequest(`/api/production/my-items?unit=${encodeURIComponent(unit)}&date=${encodeURIComponent(workDate)}&scope=all`);
  if (!isCurrentProductionRequest(unit, epoch) || workDate !== saoPauloIsoDate()) return null;
  productionItems = Array.isArray(data.items) ? data.items : [];
  renderProductionFilters();
  saveProductionFilters(unit);
  renderProductionItems(data);
  return data;
}

async function loadProductionDailySummary(unit, epoch = productionPageEpoch, fixedWorkDate = null) {
  const workDate = fixedWorkDate || saoPauloIsoDate();
  const save = document.querySelector('#production-daily-save');
  if (save) save.disabled = true;
  const { summary } = await apiRequest(`/api/production/daily-summary?unit=${encodeURIComponent(unit)}&date=${workDate}`);
  if (!isCurrentProductionRequest(unit, epoch) || (!fixedWorkDate && workDate !== saoPauloIsoDate())) return;
  const fields = [
    ['#production-rain-turn', summary?.rain_turn_mm],
    ['#production-rain-accumulated', summary?.rain_accumulated_mm]
  ];
  fields.forEach(([selector, value]) => {
    const input = document.querySelector(selector);
    if (!input) return;
    input.value = value ?? '';
    input.disabled = !canEditProductionDailySummary();
  });
  if (save) {
    save.hidden = !canEditProductionDailySummary();
    save.disabled = false;
  }
  const status = document.querySelector('#production-daily-status');
  if (status) status.textContent = summary?.updated_at
    ? `Dados salvos para ${formatIsoDateBr(workDate)}.`
    : `Sem dados salvos para ${formatIsoDateBr(workDate)}.`;
}

// Unidade e dia exibidos no modal de chuva; o envio usa esses valores mesmo após a virada do dia.
let productionRainModalContext = null;

async function openProductionRainModal() {
  if (!canEditProductionDailySummary()) return;
  const unit = currentProductionUnit();
  const workDate = saoPauloIsoDate();
  const label = document.querySelector('#production-rain-unit');
  if (label) label.textContent = productionUnitLabel(unit);
  await loadProductionDailySummary(unit, productionPageEpoch, workDate);
  if (unit !== currentProductionUnit()) return;
  productionRainModalContext = { unit, workDate };
  openModal('production-rain-modal');
  document.querySelector('#production-rain-turn')?.focus();
}

async function submitProductionDailySummary(event) {
  event.preventDefault();
  if (!canEditProductionDailySummary()) return;
  const { unit, workDate } = productionRainModalContext || { unit: currentProductionUnit(), workDate: saoPauloIsoDate() };
  const save = document.querySelector('#production-daily-save');
  const status = document.querySelector('#production-daily-status');
  const payload = {
    unit_code: unit, work_date: workDate,
    rain_turn_mm: document.querySelector('#production-rain-turn')?.value || null,
    rain_accumulated_mm: document.querySelector('#production-rain-accumulated')?.value || null
  };
  if (save) save.disabled = true;
  if (status) status.textContent = 'Salvando dados do dia…';
  try {
    await apiRequest('/api/production/daily-summary', { method: 'PUT', body: JSON.stringify(payload) });
  } catch (error) {
    console.error(error);
    if (status) status.textContent = error.message || 'Não foi possível salvar os dados do dia.';
    showToast(status?.textContent || 'Não foi possível salvar os dados do dia.', true);
    if (save) save.disabled = false;
    return;
  }
  closeModal('production-rain-modal');
  productionRainModalContext = null;
  showToast('Dados da imagem salvos.');
  try {
    await loadProductionDailySummary(unit, productionPageEpoch, workDate);
  } catch (error) {
    console.error(error);
    showToast(PRODUCTION_REFRESH_WARNING, true);
  } finally {
    if (save) save.disabled = false;
  }
}

function statusMeta(code) {
  const statuses = [...productionStatuses, ...productionConfigStatuses, ...productionArchivedStatuses];
  const status = statuses.find(item => item.code === code);
  const style = PRODUCTION_STATUS_STYLES[status?.style_key] || PRODUCTION_STATUS_STYLES.waiting;
  return {
    code: code || '',
    name: status?.name || code || 'Sem status',
    className: style.className,
    styleLabel: style.label
  };
}

// Status do setor numa barra seletora simples (select), com a cor do status escolhido.
function renderStatusOptions(selectedCode = selectedStatus(), container = document.querySelector('#production-status-options')) {
  if (!container) return;
  if (!productionStatuses.length) {
    container.innerHTML = '<div class="production-empty"><span>Nenhum status configurado.</span></div>';
    return;
  }
  const selected = productionStatuses.some(status => status.code === selectedCode) ? selectedCode : productionStatuses[0].code;
  container.innerHTML = `<select class="production-status-select ${statusMeta(selected).className}" data-production-status-select aria-label="Status do setor">${
    productionStatuses.map(status => `<option value="${escapeHtml(status.code)}" ${status.code === selected ? 'selected' : ''}>${escapeHtml(status.name)}</option>`).join('')
  }</select>`;
}

function refreshProductionSectorStatuses() {
  productionSectorRows().forEach(row => {
    const code = selectedStatus(row);
    renderStatusOptions(productionStatuses.some(status => status.code === code) ? code : defaultStatusCode(),
      row.querySelector('.production-status-options'));
  });
}

function visibleProductionItems() {
  return consolidateProductionItems(productionItems).filter(item =>
    (!productionFilterGroup || String(item.group_id) === productionFilterGroup) &&
    (!productionFilterFront || String(item.service_front_id) === productionFilterFront));
}

function restoreProductionFilters(unit) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PRODUCTION_FILTERS_KEY) || '{}');
    if (saved?.unit !== unit) return;
    productionFilterGroup = typeof saved.group === 'string' ? saved.group : '';
    productionFilterFront = typeof saved.front === 'string' ? saved.front : '';
  } catch (_) { /* Armazenamento opcional: sem ele, os filtros começam em Todos. */ }
}

function saveProductionFilters(unit = currentProductionUnit()) {
  try {
    sessionStorage.setItem(PRODUCTION_FILTERS_KEY, JSON.stringify({ unit, group: productionFilterGroup, front: productionFilterFront }));
  } catch (_) { /* Armazenamento opcional. */ }
}

function renderProductionFilters() {
  const container = document.querySelector('#production-filters');
  const groupSelect = document.querySelector('#production-filter-group');
  const frontSelect = document.querySelector('#production-filter-front');
  if (!container || !groupSelect || !frontSelect) return;
  container.hidden = false;
  const groups = new Map();
  for (const group of productionCatalog.groups || []) groups.set(String(group.id), group.name);
  for (const item of productionItems) groups.set(String(item.group_id), item.group_name);
  groupSelect.innerHTML = '<option value="">Todos os grupos</option>' +
    [...groups].map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('');
  if (!groups.has(productionFilterGroup)) productionFilterGroup = '';
  groupSelect.value = productionFilterGroup;

  const fronts = new Map();
  for (const group of productionCatalog.groups || []) {
    if (productionFilterGroup && String(group.id) !== productionFilterGroup) continue;
    for (const front of group.fronts || []) fronts.set(String(front.id), front.name);
  }
  for (const item of productionItems) {
    if (productionFilterGroup && String(item.group_id) !== productionFilterGroup) continue;
    fronts.set(String(item.service_front_id), item.service_name);
  }
  frontSelect.innerHTML = '<option value="">Todas as frentes</option>' +
    [...fronts].map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('');
  if (!fronts.has(productionFilterFront)) productionFilterFront = '';
  frontSelect.value = productionFilterFront;
}

function renderProductionSummary() {
  const summary = document.querySelector('#production-summary');
  if (!summary) return;
  const counts = Object.fromEntries(productionStatuses.map(status => [status.code, 0]));
  visibleProductionItems().forEach(item => {
    if (!item.is_current_day) return;
    const code = item.entry?.status;
    if (Object.hasOwn(counts, code)) counts[code] += 1;
  });
  summary.innerHTML = productionStatuses.map(status => {
    const style = PRODUCTION_STATUS_STYLES[status.style_key] || PRODUCTION_STATUS_STYLES.waiting;
    return `<div class="production-summary-item ${style.className}"><span>${escapeHtml(status.name)}</span><strong>${counts[status.code] || 0}</strong></div>`;
  }).join('');
  summary.hidden = productionStatuses.length === 0;
}

function statusBadge(status) {
  const config = statusMeta(status);
  return `<span class="production-status-badge ${config.className}">${escapeHtml(config.name)}</span>`;
}

// Coluna O.S.: "OK" quando há O.S. do setor para a operação do lançamento; "Sem O.S." quando não há.
function serviceOrderCell(item) {
  const order = item.service_order || {};
  if (order.status !== 'ok' && order.status !== 'missing') {
    return '<div class="production-os"><span class="production-os-state is-empty">-</span></div>';
  }
  const state = order.status === 'ok'
    ? '<span class="production-os-state is-ok">OK</span>'
    : '<span class="production-os-state is-missing">Sem O.S.</span>';
  // "Ver" aparece sempre que o setor tem O.S. abertas (mesmo de outra operação).
  const label = `Ver O.S. do setor ${escapeHtml(item.entry?.sector || '')}`;
  const view = order.orders?.length ? `<button class="production-os-view is-icon" type="button" data-production-action="orders" data-item-id="${item.id}"
      title="${label}" aria-label="${label}">${typeof SERVICE_ORDER_EYE_ICON === 'string' ? SERVICE_ORDER_EYE_ICON : 'Ver'}</button>` : '';
  return `<div class="production-os">${state}${view}</div>`;
}

function renderProductionItems(data) {
  const body = document.querySelector('#production-items-body');
  const empty = document.querySelector('#production-empty');
  const status = document.querySelector('#production-list-status');
  const actionsHeading = document.querySelector('#production-actions-heading');
  const visibleItems = visibleProductionItems();
  if (!body) return;

  if (data?.permissions && productionAccess) {
    productionAccess.permissions = { ...productionAccess.permissions, ...data.permissions };
    const addButton = document.querySelector('#production-add-button');
    if (addButton) addButton.hidden = !canFillProduction();
    const rainButton = document.querySelector('#production-rain-button');
    if (rainButton) rainButton.hidden = !canEditProductionDailySummary();
    updateProductionAccessMessage();
  }

  if (actionsHeading) actionsHeading.hidden = !canFillProduction();

  body.innerHTML = visibleItems.map(item => {
    const entry = item.entry || {};
    const current = Boolean(item.is_current_day);
    const updatedDetail = entry.work_date ? `Último registro: ${formatIsoDateBr(entry.work_date)}` : 'Nenhum registro salvo';
    const styleLabel = item.display_style === 'front' ? 'Frente operacional' : 'Operação / serviço';
    const owner = entry.updated_by_name || item.owner_name || '';
    const actions = canFillProduction() ? `
      <div class="production-row-actions">
        <button class="production-row-action icon-edit-button" type="button" data-production-action="edit" data-item-id="${item.id}"
          title="${item.is_own ? 'Editar' : 'Atualizar'}" aria-label="${item.is_own ? 'Editar' : 'Atualizar'} ${escapeHtml(item.service_name || 'frente')}">${PENCIL_ICON}</button>
        <button class="production-row-action is-remove icon-delete-button" type="button" data-production-action="remove" data-item-id="${item.id}" title="Remover" aria-label="Remover ${escapeHtml(item.service_name || 'frente')}">${TRASH_ICON}</button>
      </div>` : '';
    const actionCell = canFillProduction() ? `<td>${actions}</td>` : '';
    const observation = String(entry.observation || '').trim();
    const changes = String(entry.changes || '').trim();
    // Analista e data do último registro ficam sob o nome e o status (sem colunas próprias).
    return `<tr class="${current ? '' : 'is-pending'}" title="${escapeHtml(item.group_name || '')}">
      <td><div class="production-item-name"><strong>${escapeHtml(item.service_name || '-')}</strong><small>${escapeHtml(styleLabel)}${owner ? ` · ${escapeHtml(owner)}` : ''}</small></div></td>
      <td class="production-cell-number">${escapeHtml(entry.sector || '-')}</td>
      <td class="production-cell-number">${escapeHtml(entry.section || '-')}</td>
      <td class="production-cell-farm">${escapeHtml(entry.farm || '-')}</td>
      <td><div class="production-status-cell">${statusBadge(entry.status)}${current ? '' : `<small class="production-pending-note">${escapeHtml(updatedDetail)}</small>`}</div></td>
      <td>${serviceOrderCell(item)}</td>
      <td><div class="production-observation${observation ? '' : ' is-empty'}">${escapeHtml(observation || '-')}</div></td>
      <td><div class="production-observation${changes ? '' : ' is-empty'}">${escapeHtml(changes || '-')}</div></td>
      ${actionCell}
    </tr>`;
  }).join('');

  if (empty) {
    empty.hidden = visibleItems.length > 0;
    const emptyTitle = empty.querySelector('strong');
    const emptyText = empty.querySelector('span');
    if (emptyTitle) emptyTitle.textContent = 'Nenhum lançamento neste filtro.';
    if (emptyText) emptyText.textContent = 'Selecione outro grupo ou frente para consultar os lançamentos da unidade.';
  }
  if (status) {
    if (!visibleItems.length) {
      status.textContent = '';
    } else {
      const analysts = new Set(visibleItems.map(item => item.entry?.updated_by || item.owner_user_id).filter(Boolean));
      status.textContent = `${visibleItems.length} ${visibleItems.length === 1 ? 'lançamento' : 'lançamentos'} · ${analysts.size} ${analysts.size === 1 ? 'analista' : 'analistas'}`;
    }
  }

  renderProductionSummary();
}

function groupsForEntry() {
  return Array.isArray(productionCatalog.groups) ? productionCatalog.groups.filter(group => group.is_active !== false) : [];
}

function renderEntryGroups(selectedGroupId = null, selectedFrontId = null, fallbackItem = null) {
  const groupSelect = document.querySelector('#production-group-input');
  if (!groupSelect) return;
  let groups = groupsForEntry();
  if (fallbackItem && !groups.some(group => Number(group.id) === Number(fallbackItem.group_id))) {
    groups = [...groups, { id: fallbackItem.group_id, name: fallbackItem.group_name, fronts: [] }];
  }
  groupSelect.innerHTML = groups.map(group =>
    `<option value="${group.id}" ${Number(group.id) === Number(selectedGroupId) ? 'selected' : ''}>${escapeHtml(group.name)}</option>`
  ).join('');
  if (!groupSelect.value && groups[0]) groupSelect.value = String(groups[0].id);
  renderEntryFronts(selectedFrontId, fallbackItem);
}

function renderEntryFronts(selectedFrontId = null, fallbackItem = null) {
  const groupSelect = document.querySelector('#production-group-input');
  const frontSelect = document.querySelector('#production-front-input');
  if (!groupSelect || !frontSelect) return;
  const group = groupsForEntry().find(item => Number(item.id) === Number(groupSelect.value));
  let fronts = Array.isArray(group?.fronts) ? group.fronts.filter(front => front.is_active !== false) : [];
  if (fallbackItem && Number(fallbackItem.group_id) === Number(groupSelect.value) && !fronts.some(front => Number(front.id) === Number(fallbackItem.service_front_id))) {
    fronts = [...fronts, { id: fallbackItem.service_front_id, name: fallbackItem.service_name }];
  }
  frontSelect.innerHTML = fronts.length
    ? fronts.map(front => `<option value="${front.id}" ${Number(front.id) === Number(selectedFrontId) ? 'selected' : ''}>${escapeHtml(front.name)}</option>`).join('')
    : '<option value="">Nenhuma frente/serviço cadastrada neste grupo</option>';
}

function setSelectedStatus(value, root = document) {
  root.querySelectorAll('[data-production-status-select]').forEach(select => {
    if ([...select.options].some(option => option.value === value)) select.value = value;
    select.className = `production-status-select ${statusMeta(select.value).className}`;
  });
}

function selectedStatus(root = document) {
  const select = root.querySelector('[data-production-status-select]');
  if (select?.value) return select.value;
  return root.querySelector('[data-production-status]:checked')?.value || '';
}

function defaultStatusCode() {
  return productionStatuses.find(status => status.code === 'EM ATIVIDADE')?.code
    || productionStatuses[0]?.code
    || '';
}

function productionSectorField(row, field) {
  return row === document ? document.querySelector(`#production-${field}-input`)
    : row.querySelector(`[data-sector-field="${field}"]`);
}

function productionSectorRows() {
  return [...document.querySelectorAll('[data-production-sector-row]')];
}

function updateProductionSectorRows() {
  const rows = productionSectorRows();
  rows.forEach((row, index) => {
    row.querySelector('.production-sector-number').textContent = `Setor ${index + 1}`;
    row.querySelector('[data-remove-sector]').hidden = index === 0;
  });
  const add = document.querySelector('#production-add-sector');
  if (add) add.disabled = rows.length >= 100;
}

function addProductionSector() {
  const rows = productionSectorRows();
  if (!rows.length || rows.length >= 100) return;
  const row = rows[0].cloneNode(true);
  const suffix = `-${++productionSectorSequence}`;
  row.querySelectorAll('[id]').forEach(element => { element.id += suffix; });
  row.querySelectorAll('label[for]').forEach(label => { label.htmlFor += suffix; });
  productionSectorField(row, 'sector').value = '';
  productionSectorField(row, 'farm').value = '';
  resetSectorFields(row);
  renderStatusOptions(defaultStatusCode(), row.querySelector('.production-status-options'));
  document.querySelector('#production-sector-rows').append(row);
  updateProductionSectorRows();
  productionSectorField(row, 'sector').focus();
}

function resetSectorFields(row = document) {
  productionSectorOptions.set(row, []);
  const section = productionSectorField(row, 'section');
  if (section) section.innerHTML = '<option value="">Sem seção</option>';
}

async function resolveSectorFromBase(row = document) {
  const unit = document.querySelector('#production-unit-input')?.value || currentProductionUnit();
  const input = productionSectorField(row, 'sector');
  const sector = input?.value.trim() || '';
  const section = productionSectorField(row, 'section');
  const farm = productionSectorField(row, 'farm');
  const request = {};
  productionSectorOptions.set(row, request);
  if (section) section.innerHTML = '<option value="">Sem seção</option>';
  if (farm) farm.value = '';
  if (!sector) return;
  try {
    request.promise = apiRequest(`/api/production/sector-options?unit=${encodeURIComponent(unit)}&sector=${encodeURIComponent(sector)}`);
    const data = await request.promise;
    if (productionSectorOptions.get(row) !== request || input.value.trim() !== sector ||
        document.querySelector('#production-unit-input')?.value !== unit) return;
    const sectorOptions = Array.isArray(data.items) ? data.items : [];
    productionSectorOptions.set(row, sectorOptions);
    if (!section) return;
    section.innerHTML = '<option value="">Sem seção</option>' + sectorOptions.map(item =>
      `<option value="${escapeHtml(item.section)}">${escapeHtml(item.section || 'Sem seção')}${item.farm ? ` — ${escapeHtml(item.farm)}` : ''}</option>`
    ).join('');
    if (sectorOptions.length === 1) {
      section.value = sectorOptions[0].section || '';
      if (farm) farm.value = sectorOptions[0].farm || '';
    } else if (sectorOptions.length > 1) {
      const first = sectorOptions[0];
      section.value = first.section || '';
      if (farm) farm.value = first.farm || '';
    }
  } catch (error) {
    console.warn(error);
  }
}

function syncFarmFromSection(row = document) {
  const sectionValue = productionSectorField(row, 'section')?.value || '';
  const options = productionSectorOptions.get(row);
  const selected = Array.isArray(options) ? options.find(item => item.section === sectionValue) : null;
  const farm = productionSectorField(row, 'farm');
  if (farm && selected) farm.value = selected.farm || '';
}

function showEntryPane() {
  document.querySelector('#production-entry-pane').hidden = false;
  document.querySelector('#production-entry-footer').hidden = false;

  const editingItemId = productionEditingItemId;
  const configButton = document.querySelector('#production-config-toggle');
  if (configButton) configButton.hidden = Boolean(editingItemId) || !canConfigureProduction();
  const statusConfigButton = document.querySelector('#production-status-config-toggle');
  if (statusConfigButton) statusConfigButton.hidden = !canConfigureProduction();

  const modalTitle = document.querySelector('#production-modal-title');
  if (modalTitle) modalTitle.textContent = editingItemId ? 'Editar frente' : 'Adicionar frente';
}

// Grupos, frentes, status e operações ficam na página Cadastros (menu lateral).
function showConfigPane() {
  if (canConfigureProduction()) window.location.href = '/producao/cadastros';
}

function showStatusConfigPane() {
  showConfigPane();
}

function setProductionEntryEditMode(isEditing) {
  const serviceSection = document.querySelector('#production-service-section');
  if (serviceSection) serviceSection.hidden = Boolean(isEditing);
  const notesSection = document.querySelector('#production-entry-notes');
  if (notesSection) notesSection.hidden = !isEditing;
  const addSector = document.querySelector('#production-add-sector');
  if (addSector) addSector.hidden = Boolean(isEditing);

  const configButton = document.querySelector('#production-config-toggle');
  if (configButton) configButton.hidden = Boolean(isEditing) || !canConfigureProduction();
  const statusConfigButton = document.querySelector('#production-status-config-toggle');
  if (statusConfigButton) statusConfigButton.hidden = !canConfigureProduction();

  const modalTitle = document.querySelector('#production-modal-title');
  if (modalTitle) modalTitle.textContent = isEditing ? 'Editar frente' : 'Adicionar frente';
  const kicker = document.querySelector('#production-modal-kicker');
  if (kicker) kicker.textContent = isEditing ? 'Editar frente' : 'Produção Agrícola';
  const subtitle = document.querySelector('#production-modal-subtitle');
  if (subtitle) subtitle.hidden = !isEditing;
  const sectorTitle = document.querySelector('#production-sector-section-title');
  if (sectorTitle) sectorTitle.textContent = isEditing ? 'Setor da frente' : 'Setores da frente';
  // Na edição, o formulário fica em duas colunas: setor/status e anotações.
  document.querySelector('#production-entry-form')?.classList?.toggle('is-editing', Boolean(isEditing));

  const submit = document.querySelector('#production-entry-submit');
  if (submit) submit.textContent = isEditing ? 'Atualizar' : 'Adicionar';

  const hint = document.querySelector('#production-entry-hint');
  if (hint) hint.textContent = isEditing ? 'Enter atualiza' : 'Enter adiciona';
}

function clearEntryForm(defaultUnit = selectedNavbarProductionUnit()) {
  productionSectorRows().forEach(row => productionSectorOptions.delete(row));
  productionSectorRows().slice(1).forEach(row => row.remove());
  updateProductionSectorRows();
  const form = document.querySelector('#production-entry-form');
  form?.reset();
  productionEditingItemId = null;
  // Mantém compatibilidade com abas que ainda usam o campo de identificação.
  const itemInput = document.querySelector('#production-item-id');
  if (itemInput) itemInput.value = '';
  document.querySelector('#production-work-date').value = saoPauloIsoDate();
  setProductionEntryUnit(defaultUnit);
  renderEntryGroups();
  setSelectedStatus(defaultStatusCode());
  resetSectorFields();
  setProductionEntryEditMode(false);
}

async function openNewProductionItem() {
  if (!canFillProduction()) return;
  const navbarUnit = selectedNavbarProductionUnit();
  showEntryPane();
  try {
    if (productionCatalog?.unit !== navbarUnit) await loadProductionCatalog(navbarUnit);
    clearEntryForm(navbarUnit);
    openModal('production-entry-modal');
    document.querySelector('#production-group-input')?.focus();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível carregar as frentes desta unidade.', true);
  }
}

function findProductionItem(itemId) {
  return productionItems.find(item => Number(item.id) === Number(itemId));
}

function openEditProductionItem(itemId) {
  if (!canFillProduction()) return;
  const item = findProductionItem(itemId);
  if (!item) return;
  showEntryPane();
  clearEntryForm();
  const entry = item.entry || {};
  productionEditingItemId = Number(item.id);
  const itemInput = document.querySelector('#production-item-id');
  if (itemInput) itemInput.value = String(item.id);
  document.querySelector('#production-work-date').value = saoPauloIsoDate();
  setProductionEntryUnit(currentProductionUnit());
  renderEntryGroups(item.group_id, item.service_front_id, item);
  document.querySelector('#production-sector-input').value = entry.sector || '';
  document.querySelector('#production-farm-input').value = entry.farm || '';
  document.querySelector('#production-observation-input').value = entry.observation || '';
  document.querySelector('#production-changes-input').value = entry.changes || '';
  setSelectedStatus(entry.status || defaultStatusCode());
  resetSectorFields();
  const section = document.querySelector('#production-section-input');
  section.innerHTML = `<option value="${escapeHtml(entry.section || '')}">${escapeHtml(entry.section || 'Sem seção')}</option>`;
  section.value = entry.section || '';
  setProductionEntryEditMode(true);
  // O nome da frente em edição fica em destaque no topo do popup.
  document.querySelector('#production-modal-title').textContent = item.service_name || 'Frente';
  const subtitle = document.querySelector('#production-modal-subtitle');
  if (subtitle) {
    subtitle.textContent = [productionUnitLabel(currentProductionUnit()), item.group_name,
      entry.sector ? `Setor ${entry.sector}${entry.section ? ` / Seção ${entry.section}` : ''}` : '',
      item.owner_name ? `Analista: ${item.owner_name}` : ''].filter(Boolean).join(' · ');
  }
  if (!item.is_own) {
    document.querySelector('#production-modal-kicker').textContent = 'Atualizar frente';
    document.querySelector('#production-entry-submit').textContent = 'Salvar atualização';
  }
  openModal('production-entry-modal');
  document.querySelector('#production-sector-input')?.focus();
}

async function submitProductionEntry(event) {
  event.preventDefault();
  if (!canFillProduction()) return;
  const submit = document.querySelector('#production-entry-submit');
  if (submit?.disabled) return;
  const itemId = productionEditingItemId;
  if (itemId !== null && (!Number.isInteger(itemId) || itemId <= 0)) {
    showToast('Não foi possível identificar o lançamento. Feche e abra a edição novamente.', true);
    return;
  }
  const unit = document.querySelector('#production-unit-input')?.value || currentProductionUnit();
  const frontId = Number(document.querySelector('#production-front-input')?.value || 0);
  if (!frontId) {
    showToast('Selecione uma frente ou serviço.', true);
    return;
  }
  const payload = {
    unit_code: unit,
    service_front_id: frontId,
    work_date: saoPauloIsoDate()
  };
  let sectors;
  if (submit) submit.disabled = true;
  try {
    await Promise.allSettled(productionSectorRows().map(row => productionSectorOptions.get(row)?.promise));
    sectors = collectProductionSectors();
  } catch (error) {
    if (submit) submit.disabled = false;
    showToast(error.message, true);
    return;
  }
  if (itemId) Object.assign(payload, sectors[0], {
    observation: document.querySelector('#production-observation-input')?.value.trim() || '',
    changes: document.querySelector('#production-changes-input')?.value.trim() || ''
  });
  else payload.sectors = sectors;
  try {
    await apiRequest(itemId ? `/api/production/my-items/${itemId}` : '/api/production/my-items/batch', {
      method: itemId ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar a frente.', true);
    if (submit) submit.disabled = false;
    return;
  }
  closeModal('production-entry-modal');
  showToast(itemId ? 'Frente atualizada.' : `${sectors.length} ${sectors.length === 1 ? 'setor salvo' : 'setores salvos'} na frente.`);
  try {
    await refreshProductionPage(unit, { keepFilters: true });
  } catch (error) {
    console.error(error);
    showToast(PRODUCTION_REFRESH_WARNING, true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

function collectProductionSectors() {
  const seen = new Set();
  return productionSectorRows().map(row => {
    const input = productionSectorField(row, 'sector');
    const sector = input.value.trim();
    const status = selectedStatus(row);
    if (!sector || seen.has(sector.toLocaleUpperCase('pt-BR'))) {
      input.focus();
      throw new Error(sector ? `O setor ${sector} está repetido nesta frente.` : 'Informe o setor.');
    }
    if (!status) throw new Error(`Selecione o status do setor ${sector}.`);
    seen.add(sector.toLocaleUpperCase('pt-BR'));
    return { sector, section: productionSectorField(row, 'section').value,
      farm: productionSectorField(row, 'farm').value.trim(), status };
  });
}

async function removeProductionItem(itemId) {
  const item = findProductionItem(itemId);
  if (!item || !canFillProduction()) return;
  const confirmed = await askConfirmation({
    kicker: 'Produção Agrícola',
    title: 'Remover lançamento?',
    message: `Remover o lançamento de ${item.service_name}, setor ${item.entry?.sector || '-'}, da unidade ${currentProductionUnit()}? O histórico será preservado.`,
    confirmLabel: 'Remover'
  });
  if (!confirmed) return;
  try {
    await apiRequest(`/api/production/my-items/${itemId}`, { method: 'DELETE' });
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível remover a frente.', true);
    return;
  }
  showToast('Lançamento removido da unidade.');
  try {
    await refreshProductionPage(currentProductionUnit(), { keepFilters: true });
  } catch (error) {
    console.error(error);
    showToast('O lançamento foi removido, mas não foi possível atualizar a tela. Recarregue a página para ver a versão mais recente.', true);
  }
}

async function refreshProductionPage(unit = currentProductionUnit(), { keepFilters = false } = {}) {
  const epoch = ++productionPageEpoch;
  productionItems = [];
  productionCatalog = { groups: [] };
  setProductionContext(unit);
  // Ao salvar, remover ou atualizar a página, os filtros escolhidos não voltam para "Todos".
  if (!keepFilters) renderProductionFilters();
  renderProductionItems();
  try {
    await Promise.all([loadProductionCatalog(unit, epoch), loadProductionStatuses(), loadProductionDailySummary(unit, epoch)]);
    if (!isCurrentProductionRequest(unit, epoch)) return;
    renderStatusOptions(defaultStatusCode());
    await loadProductionItems(unit, epoch);
  } catch (error) {
    if (!isCurrentProductionRequest(unit, epoch)) return;
    throw error;
  }
}

async function initializeProductionPage() {
  const accessMessage = document.querySelector('#production-access-message');
  try {
    const unit = await loadProductionAccess();
    restoreProductionFilters(unit);
    await refreshProductionPage(unit, { keepFilters: true });
    updateProductionAccessMessage();
    if (typeof CustomEvent === 'function') document.dispatchEvent(new CustomEvent('production-page-ready', { detail: { unit } }));
  } catch (error) {
    console.error(error);
    if (accessMessage) {
      accessMessage.hidden = false;
      accessMessage.textContent = error.message || 'Não foi possível carregar a Produção Agrícola.';
    }
    const addButton = document.querySelector('#production-add-button');
    if (addButton) addButton.hidden = true;
    const rainButton = document.querySelector('#production-rain-button');
    if (rainButton) rainButton.hidden = true;
  }
}


document.querySelector('#production-rain-button')?.addEventListener('click', async () => {
  try {
    await openProductionRainModal();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível carregar a chuva da unidade.', true);
  }
});

document.querySelector('#production-filter-group')?.addEventListener('change', event => {
  productionFilterGroup = event.target.value;
  productionFilterFront = '';
  renderProductionFilters();
  saveProductionFilters();
  renderProductionItems();
});

document.querySelector('#production-filter-front')?.addEventListener('change', event => {
  productionFilterFront = event.target.value;
  saveProductionFilters();
  renderProductionItems();
});

document.querySelector('#production-entry-form')?.addEventListener('submit', submitProductionEntry);

document.querySelector('#production-daily-form')?.addEventListener('submit', submitProductionDailySummary);

document.querySelector('#production-group-input')?.addEventListener('change', () => renderEntryFronts());

document.querySelector('#production-add-sector')?.addEventListener('click', addProductionSector);

document.querySelector('#production-sector-rows')?.addEventListener('click', event => {
  const button = event.target.closest('[data-remove-sector]');
  if (!button) return;
  const row = button.closest('[data-production-sector-row]');
  if (row === productionSectorRows()[0]) return;
  productionSectorOptions.delete(row);
  row.remove();
  updateProductionSectorRows();
});

document.querySelector('#production-sector-rows')?.addEventListener('change', event => {
  const row = event.target.closest('[data-production-sector-row]');
  if (!row) return;
  if (event.target.matches('[data-sector-field="sector"]')) resolveSectorFromBase(row);
  if (event.target.matches('[data-sector-field="section"]')) syncFarmFromSection(row);
  if (event.target.matches('[data-production-status-select]')) setSelectedStatus(event.target.value, row);
});

document.querySelector('#production-entry-form')?.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.target instanceof HTMLTextAreaElement) return;
  if (event.target.closest('button')) return;
  event.preventDefault();
  event.currentTarget.requestSubmit();
});

document.querySelector('#production-items-body')?.addEventListener('click', event => {
  const button = event.target.closest('[data-production-action]');
  if (!button) return;
  const itemId = Number(button.dataset.itemId);
  if (button.dataset.productionAction === 'edit') openEditProductionItem(itemId);
  if (button.dataset.productionAction === 'remove') removeProductionItem(itemId);
  if (button.dataset.productionAction === 'orders') openProductionItemOrders(itemId);
});





document.querySelector('#production-status-form')?.addEventListener('submit', submitProductionStatus);

document.querySelector('#production-status-clear')?.addEventListener('click', () => {
  clearStatusConfigForm();
  const editor = document.querySelector('#production-status-editor');
  if (editor) editor.open = false;
});

document.querySelector('#production-status-editor')?.addEventListener('toggle', event => {
  if (!event.currentTarget.open) return;
  const statusId = document.querySelector('#production-status-id')?.value || '';
  if (!statusId) {
    const position = document.querySelector('#production-status-position');
    if (position && !position.value) position.value = nextStatusPosition();
  }
  requestAnimationFrame(() => document.querySelector('#production-status-name')?.focus());
});

document.querySelector('#production-status-list')?.addEventListener('click', event => {
  const button = event.target.closest('[data-status-action]');
  if (!button) return;
  if (button.dataset.statusAction === 'edit') editProductionStatus(Number(button.dataset.statusId));
  if (button.dataset.statusAction === 'delete') deleteProductionStatus(Number(button.dataset.statusId), button.dataset.statusName || '');
});

document.querySelector('#production-group-form')?.addEventListener('submit', submitConfigGroup);

document.querySelector('#production-front-form')?.addEventListener('submit', submitConfigFront);

document.querySelector('#production-group-clear')?.addEventListener('click', () => {
  clearGroupConfigForm();
  const editor = document.querySelector('#production-group-editor');
  if (editor) editor.open = false;
});

document.querySelector('#production-group-editor')?.addEventListener('toggle', event => {
  if (!event.currentTarget.open) return;
  const groupId = document.querySelector('#production-group-id')?.value || '';
  if (!groupId) {
    const position = document.querySelector('#production-group-position');
    if (position && !position.value) position.value = nextGroupPosition();
  }
  requestAnimationFrame(() => document.querySelector('#production-group-name')?.focus());
});

document.querySelector('#production-front-clear')?.addEventListener('click', () => {
  clearFrontConfigForm({ keepOpen: true });
  document.querySelector('#production-config-front-name')?.focus();
});

document.querySelector('#production-groups-list')?.addEventListener('click', event => {
  const button = event.target.closest('[data-config-action]');
  if (!button) return;
  if (button.dataset.configAction === 'edit-group') editConfigGroup(Number(button.dataset.groupId));
  if (button.dataset.configAction === 'delete-group') deleteConfigGroup(Number(button.dataset.groupId), button.dataset.groupName || '');
});

document.querySelector('#production-fronts-list')?.addEventListener('click', event => {
  const button = event.target.closest('[data-config-action]');
  if (!button) return;
  if (button.dataset.configAction === 'edit-front') editConfigFront(Number(button.dataset.frontId));
  if (button.dataset.configAction === 'delete-front') deleteConfigFront(Number(button.dataset.frontId), button.dataset.frontName || '');
});

document.addEventListener('report-unit-change', async event => {
  if (!productionAccess) return;
  const requested = event.detail?.unit;
  const units = allowedProductionUnits();
  if (!units.includes(requested)) {
    showToast(`A unidade ${requested} não está liberada para a Produção Agrícola.`, true);
    if (units[0] && units[0] !== requested) setReportUnit(units[0]);
    return;
  }
  try {
    await refreshProductionPage(requested);
    // Na página Cadastros, as frentes listadas dependem da unidade.
    if (typeof productionCatalogPageActive === 'function' && productionCatalogPageActive() && canConfigureProduction()) {
      await loadProductionConfigCatalog();
      clearFrontConfigForm();
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível trocar a unidade.', true);
  }
});

initializeProductionPage();
