// Produção Agrícola: lançamentos do dia, filtros e inicialização da página.
// Classe visual e rótulo de cada grupo de status (production-status-groups.js).
const PRODUCTION_STATUS_STYLES = Object.fromEntries(PRODUCTION_STATUS_GROUPS.map(group => [
  group.key, { className: `is-${group.key}`, label: group.name }
]));

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

function canConfigureProduction() {
  return Boolean(productionAccess?.permissions?.configure);
}

function updateProductionAccessMessage() {
  const message = document.querySelector('#production-access-message');
  if (!message) return;
  message.hidden = canFillProduction();
  if (!message.hidden) message.textContent = 'Esta unidade está liberada somente para consulta.';
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
  // Sem a barra de filtros na página (painel gerencial), filtros salvos não escondem frentes.
  if (!document.querySelector('#production-filters')) return consolidateProductionItems(productionItems);
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

// Colunas dos cartões de status pelo espaço real disponível (menu lateral, zoom e
// tamanho da janela contam): cabe o máximo com ~170px por cartão e as linhas ficam
// equilibradas (6 status em 1366px viram 3+3, nunca 5+1).
const PRODUCTION_SUMMARY_MIN_CARD = 170;
let productionSummaryObserver = null;

function fitProductionSummaryColumns() {
  const summary = document.querySelector('#production-summary');
  if (!summary?.style?.setProperty) return;
  if (!productionSummaryObserver && typeof ResizeObserver === 'function') {
    productionSummaryObserver = new ResizeObserver(() => fitProductionSummaryColumns());
    productionSummaryObserver.observe(summary);
  }
  const quantity = Math.max(1, summary.children?.length || 1);
  const width = summary.clientWidth || 0;
  if (!width) return;
  const gap = 10;
  const maxColumns = Math.max(1, Math.min(quantity, Math.floor((width + gap) / (PRODUCTION_SUMMARY_MIN_CARD + gap))));
  const rows = Math.ceil(quantity / maxColumns);
  const columns = String(Math.ceil(quantity / rows));
  if (summary.style.getPropertyValue('--summary-cols') !== columns) summary.style.setProperty('--summary-cols', columns);
}

function renderProductionSummary() {
  const summary = document.querySelector('#production-summary');
  if (!summary || typeof dashboardFrontGroups !== 'function') return;
  const counts = Object.fromEntries(productionStatuses.map(status => [status.code, 0]));
  const currentFronts = dashboardFrontGroups(dashboardItems().filter(item => item.is_current_day));
  currentFronts.forEach(sectors => {
    const code = dashboardFrontStatus(sectors).entry?.status;
    if (Object.hasOwn(counts, code)) counts[code] += 1;
  });
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  summary.innerHTML = productionStatuses.map(status => {
    const style = PRODUCTION_STATUS_STYLES[status.style_key] || PRODUCTION_STATUS_STYLES.waiting;
    const count = counts[status.code] || 0;
    const percent = total ? Math.round(count * 100 / total) : 0;
    return `<div class="production-summary-item ${style.className}${count ? '' : ' is-zero'}" title="${escapeHtml(status.name)}: ${count}">
      <span>${escapeHtml(status.name)}</span>
      <strong>${count}<small>${percent}%</small></strong>
    </div>`;
  }).join('');
  summary.hidden = productionStatuses.length === 0;
  fitProductionSummaryColumns();
}

function statusBadge(status) {
  const config = statusMeta(status);
  return `<span class="production-status-badge ${config.className}">${escapeHtml(config.name)}</span>`;
}

// Separa as operações como o servidor: vírgula, ";" e "+"; e, quando o trecho só tem
// códigos, também espaço, "/" e "-" ("338 457", "338/457"). "338 — TRATOS" é uma só.
function splitProductionOperations(value) {
  return String(value || '').split(/[,;+]/).map(part => part.trim())
    .flatMap(part => (/^\d+(?:\s*[\s/-]\s*\d+)+$/.test(part) ? part.split(/\s*[\s/-]\s*/) : [part]))
    .filter(Boolean);
}

// Coluna Operação: código(s) da operação em execução na frente.
// Situação de cada operação do lançamento: "is-order-ok" (tem O.S. no setor) ou
// "is-order-missing" (sem O.S.). Usa a lista que o servidor manda; sem conferência, nada.
// Operações padrão da frente (cadastro): preenchem o lançamento quando ele está sem operação.
function productionFrontDefaultOperations(frontId) {
  const front = (productionCatalog?.groups || []).flatMap(group => group.fronts || [])
    .find(item => String(item.id) === String(frontId));
  return splitProductionOperations(front?.default_operations);
}

// Código comparável da operação, como no servidor: "0338", "338" e "338 — DESC" são 338.
function productionOperationKey(code) {
  const match = String(code ?? '').match(/^\s*(\d+)/);
  return match ? String(Number.parseInt(match[1], 10)) : String(code ?? '').trim().toLocaleLowerCase('pt-BR');
}

function productionOperationTone(item, code) {
  const status = item?.service_order?.status;
  if (status !== 'ok' && status !== 'missing') return '';
  if (item.service_order.needs_section) return 'is-order-missing';
  const missing = (item.service_order.missing_operations || []).map(String);
  return missing.includes(productionOperationKey(code)) ? 'is-order-missing' : 'is-order-ok';
}

// Nome da operação: o da Ordem de serviço do setor; sem ela, o que o servidor manda
// (o da base de O.S. ou, sem ele, o do cadastro de operações).
function productionOperationName(item, code) {
  const key = productionOperationKey(code);
  return (item?.service_order?.orders || []).find(order => productionOperationKey(order.operation) === key && order.operation_name)?.operation_name
    || item?.service_order?.operation_names?.[key] || '';
}

// O.S. que conferem com uma operação do lançamento (mesmo setor, seção e operação).
function productionOperationOrders(item, code) {
  const key = productionOperationKey(code);
  return (item?.service_order?.orders || []).filter(order => order.matches && productionOperationKey(order.operation) === key);
}

function productionOperationTitle(tone, item) {
  if (tone === 'is-order-missing' && item?.service_order?.needs_section) return 'Informe a seção: no Polo MS a O.S. confere por setor e seção';
  return tone === 'is-order-ok' ? 'Operação com O.S. no setor' : tone === 'is-order-missing' ? 'Operação sem O.S. no setor' : '';
}

function productionOperationCell(entry, item) {
  const codes = splitProductionOperations(entry?.operation);
  return codes.length
    ? `<div class="production-operation-codes">${codes.map(code => {
      const tone = productionOperationTone(item, code);
      return `<span class="${tone}" title="${productionOperationTitle(tone, item)}">${escapeHtml(code)}</span>`;
    }).join('')}</div>`
    : '<span class="production-os-state is-no-operation">Sem operação</span>';
}

function renderEntryOperations(row, operations = ['']) {
  const container = row?.querySelector('[data-sector-operations]');
  if (!container) return;
  container.innerHTML = operations.map((value, index) => `<div class="production-sheet-operation">
      <input data-entry-op="${index}" value="${escapeHtml(value)}" maxlength="40"
        autocomplete="off" inputmode="numeric" placeholder="Cód." aria-label="Operação ${index + 1}" />
      ${index > 0 ? `<button class="production-sheet-op-remove" type="button" data-entry-op-remove="${index}" aria-label="Remover operação ${index + 1}">×</button>` : ''}
    </div>`).join('') + `<button class="production-sheet-op-add" type="button" data-entry-op-add title="Adicionar outra operação"
      aria-label="Adicionar operação" ${operations.length >= 10 ? 'disabled' : ''}>+</button>`;
}

function productionEntryOperationValues(row) {
  return [...row.querySelectorAll('[data-entry-op]')].map(input => input.value);
}

function productionPlaceLabel(entry, unit = currentProductionUnit()) {
  const section = productionUnitUsesSection(unit) && entry.section ? ` / Seção ${entry.section}` : '';
  return `Setor ${entry.sector || '-'}${section}${entry.farm ? ` · ${entry.farm}` : ''}`;
}

const productionSectorScans = new WeakMap();

function clearProductionSectorScan(row) {
  productionSectorScans.delete(row);
  const target = row?.querySelector('[data-sector-scan]');
  if (target) target.innerHTML = '';
}

async function scanProductionSector(row) {
  const target = row?.querySelector('[data-sector-scan]');
  if (!target) return;
  clearProductionSectorScan(row);
  const unit = document.querySelector('#production-unit-input')?.value || currentProductionUnit();
  const sector = productionSectorField(row, 'sector').value.trim();
  const section = productionSectorField(row, 'section').value.trim();
  if (!sector || (productionUnitUsesSection(unit) && !section)) return;
  const request = {};
  productionSectorScans.set(row, request);
  target.textContent = 'Consultando O.S. abertas…';
  const query = new URLSearchParams({ unit, sector, section, summary: '1' });
  try {
    const data = await apiRequest(`/api/production/service-orders?${query}`);
    if (productionSectorScans.get(row) !== request) return;
    const operations = new Map();
    for (const order of data.orders || []) {
      const key = productionOperationKey(order.operation);
      if (key && !operations.has(key)) operations.set(key, order);
    }
    const frontId = document.querySelector('#production-front-input')?.value;
    const defaults = productionFrontDefaultOperations(frontId).map(productionOperationKey);
    const options = [...operations].sort(([a], [b]) => Number(defaults.includes(b)) - Number(defaults.includes(a)));
    target.innerHTML = options.length
      ? `<span>Operações com O.S. aberta neste setor</span><div class="production-sector-scan-options">${options.map(([, order]) =>
        `<button type="button" class="production-secondary-button" data-sector-operation="${escapeHtml(order.operation)}">${escapeHtml(serviceOrderOperationLabel(order))}</button>`
      ).join('')}</div>`
      : '<span>Nenhuma operação com O.S. aberta neste setor.</span>';
  } catch (error) {
    if (productionSectorScans.get(row) === request) {
      target.innerHTML = '<span>Não foi possível consultar as O.S.</span> <button type="button" class="production-secondary-button" data-retry-sector-scan>Consultar novamente</button>';
    }
  }
}

// Coluna O.S.: "OK" quando há O.S. do setor para a operação do lançamento; "Sem O.S." quando não há.
function serviceOrderCell(item) {
  const order = { ...(item.service_order || {}) };
  // Sem operação informada no lançamento nunca aparece como "OK" (decidido também aqui na tela).
  const hasOperation = String(item.entry?.operation || '').trim() !== '';
  if (item.entry?.sector && !hasOperation) order.status = 'no_operation';
  if (!['ok', 'missing', 'no_operation'].includes(order.status)) {
    return '<div class="production-os"><span class="production-os-state is-empty">-</span></div>';
  }
  // Sem operação: a coluna O.S. fica sem texto ("Sem operação" aparece só na coluna Operação).
  const state = order.status === 'ok' ? '<span class="production-os-state is-ok">OK</span>'
    : order.status === 'no_operation' ? ''
      : order.needs_section
        ? '<span class="production-os-state is-missing" title="No Polo MS a O.S. confere por setor e seção">Informe a seção</span>'
        : '<span class="production-os-state is-missing">Sem O.S.</span>';
  // "Ver" aparece sempre que o setor tem O.S. abertas (mesmo de outra operação).
  const label = `Ver O.S. do setor ${escapeHtml(item.entry?.sector || '')}`;
  const view = order.orders?.length ? `<button class="production-os-view is-icon" type="button" data-production-action="orders" data-item-id="${item.id}"
      title="${label}" aria-label="${label}">${typeof SERVICE_ORDER_EYE_ICON === 'string' ? SERVICE_ORDER_EYE_ICON : 'Ver'}</button>` : '';
  return `<div class="production-os">${state}${view}</div>`;
}

function productionResponsibleName(item, shift = dashboardCurrentShift().name) {
  const team = item.responsibility_team?.[shift];
  if (team?.length) {
    const labels = team.map(person => `${person.role_name} ${person.name
      ? `${person.name}${person.day_off ? ' (cobertura)' : ''}` : 'em folga sem cobertura'}`);
    if (!team.some(person => person.role_type === 'lead')) labels.unshift('Sem responsável escalado');
    return labels.join(' · ');
  }
  return item.responsibles?.[shift] || 'Sem responsável escalado';
}

function renderProductionItems(data) {
  const body = document.querySelector('#production-items-body');
  const empty = document.querySelector('#production-empty');
  const status = document.querySelector('#production-list-status');
  const actionsHeading = document.querySelector('#production-actions-heading');
  const visibleItems = visibleProductionItems();

  if (data?.permissions && productionAccess) {
    productionAccess.permissions = { ...productionAccess.permissions, ...data.permissions };
    const addButton = document.querySelector('#production-add-button');
    if (addButton) addButton.hidden = !canFillProduction();
    updateProductionAccessMessage();
  }

  if (actionsHeading) actionsHeading.hidden = !canFillProduction();

  // Tabela de lançamentos: só desenhada quando existe na página (hoje a Produção usa o painel).
  if (body) body.innerHTML = visibleItems.map(item => {
    const entry = item.entry || {};
    const current = Boolean(item.is_current_day);
    const updatedDetail = entry.work_date ? `Último registro: ${formatIsoDateBr(entry.work_date)}` : 'Nenhum registro salvo';
    const styleLabel = item.display_style === 'front' ? 'Frente operacional' : 'Operação / serviço';
    const responsible = productionResponsibleName(item);
    const actions = canFillProduction() ? `
      <div class="production-row-actions">
        <button class="production-row-action icon-edit-button" type="button" data-production-action="edit" data-item-id="${item.id}"
          title="${item.is_own ? 'Editar' : 'Atualizar'}" aria-label="${item.is_own ? 'Editar' : 'Atualizar'} ${escapeHtml(item.service_name || 'frente')}">${PENCIL_ICON}</button>
        <button class="production-row-action is-remove icon-delete-button" type="button" data-production-action="remove" data-item-id="${item.id}" title="Remover" aria-label="Remover ${escapeHtml(item.service_name || 'frente')}">${TRASH_ICON}</button>
      </div>` : '';
    const actionCell = canFillProduction() ? `<td>${actions}</td>` : '';
    const observation = String(entry.observation || '').trim();
    const changes = String(entry.changes || '').trim();
    // Responsável no turno e data do último registro ficam sob o nome e o status.
    return `<tr class="${current ? '' : 'is-pending'}" title="${escapeHtml(item.group_name || '')}">
      <td><div class="production-item-name"><strong>${escapeHtml(item.service_name || '-')}</strong><small>${escapeHtml(styleLabel)} · ${escapeHtml(responsible)}</small></div></td>
      <td class="production-cell-number">${escapeHtml(entry.sector || '-')}</td>
      ${productionUnitUsesSection(currentProductionUnit()) ? `<td class="production-cell-number">${escapeHtml(entry.section || '-')}</td>` : ''}
      <td class="production-cell-farm">${escapeHtml(entry.farm || '-')}</td>
      <td><div class="production-status-cell">${statusBadge(entry.status)}${current ? '' : `<small class="production-pending-note">${escapeHtml(updatedDetail)}</small>`}</div></td>
      <td>${productionOperationCell(entry, item)}</td>
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
  // Painel gerencial por grupo (producao/production-dashboard.js) usa os mesmos lançamentos.
  if (typeof renderProductionDashboard === 'function') renderProductionDashboard();
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
  renderEntryOperations(row);
  clearProductionSectorScan(row);
  renderStatusOptions(defaultStatusCode(), row.querySelector('.production-status-options'));
  document.querySelector('#production-sector-rows').append(row);
  updateProductionSectorRows();
  productionSectorField(row, productionEntryUsesSection() ? 'section' : 'sector').focus();
}

function resetSectorFields(row = document) {
  productionSectorOptions.set(row, []);
  const section = productionSectorField(row, 'section');
  if (productionEntryUsesSection()) {
    if (section) section.value = '';
    renderProductionSectorChoices(row);
    return;
  }
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
    if (sectorOptions.length) {
      const first = sectorOptions[0];
      if (sectorOptions.length === 1) section.value = first.section || '';
      if (farm) farm.value = first.farm || '';
    }
  } catch (error) {
    console.warn(error);
  }
}

// Polo MS (PST e RBR): vários setores dividem a mesma seção, então a seção é digitada
// e o setor é escolhido numa lista com os setores cadastrados daquela seção.
// No Polo SP são exibidos apenas o setor e a fazenda.
const PRODUCTION_SECTION_UNITS = new Set(['PST', 'RBR']);
function productionUnitUsesSection(unit) {
  return PRODUCTION_SECTION_UNITS.has(String(unit || '').toUpperCase());
}

function productionEntryUsesSection() {
  return productionUnitUsesSection(document.querySelector('#production-unit-input')?.value || currentProductionUnit());
}

// Base de setores da unidade ({ sector, section, farm }), carregada uma vez por unidade.
const productionSectorBaseCache = new Map();
function loadProductionSectorBase(unit) {
  const key = String(unit || '').toUpperCase();
  if (!productionSectorBaseCache.has(key)) {
    const promise = apiRequest(`/api/production/sector-base?unit=${encodeURIComponent(key)}`)
      .then(base => (Array.isArray(base?.items) ? base.items : []))
      .catch(error => { productionSectorBaseCache.delete(key); throw error; });
    productionSectorBaseCache.set(key, promise);
  }
  return productionSectorBaseCache.get(key);
}

function productionSectionSectors(base, section) {
  const key = String(section || '').trim().toLocaleLowerCase('pt-BR');
  if (!key) return [];
  const bySector = new Map();
  (base || [])
    .filter(item => String(item.section || '').trim().toLocaleLowerCase('pt-BR') === key)
    .forEach(item => { if (!bySector.has(item.sector)) bySector.set(item.sector, item); });
  return [...bySector.values()].sort((a, b) => compareFrontLabels(a.sector, b.sector));
}

// Opções do seletor de setor (Polo MS); um setor salvo fora do cadastro continua na lista.
function productionSectorSelectOptions(base, section, current) {
  const sectors = productionSectionSectors(base, section);
  const value = String(current || '').trim();
  const placeholder = !String(section || '').trim() ? 'Digite a seção' : (sectors.length ? 'Selecione' : 'Seção sem setores');
  const known = sectors.some(item => item.sector === value);
  return `<option value="" ${value ? '' : 'selected'}>${placeholder}</option>`
    + (value && !known ? `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)}</option>` : '')
    + sectors.map(item => `<option value="${escapeHtml(item.sector)}" ${item.sector === value ? 'selected' : ''}>${
      escapeHtml([item.sector, item.farm].filter(Boolean).join(' · '))}</option>`).join('');
}

// Troca o campo entre texto e lista mantendo id e o vínculo data-sector-field.
function swapProductionSectorField(row, field, tag) {
  const current = productionSectorField(row, field);
  if (!current?.tagName || current.tagName.toLowerCase() === tag) return;
  const next = document.createElement(tag);
  next.id = current.id;
  next.dataset.sectorField = field;
  if (tag === 'input') {
    next.type = 'text';
    next.maxLength = 32;
    next.autocomplete = 'off';
    next.placeholder = field === 'section' ? 'Ex.: 3190' : 'Ex.: 3392';
  }
  next.required = field === 'sector';
  current.replaceWith(next);
}

// Ajusta todas as linhas de setor do popup ao polo da unidade escolhida.
function applyProductionLocationMode() {
  const usesSection = productionEntryUsesSection();
  productionSectorRows().forEach(row => {
    swapProductionSectorField(row, 'section', usesSection ? 'input' : 'select');
    swapProductionSectorField(row, 'sector', usesSection ? 'select' : 'input');
    const sectorLabel = productionSectorField(row, 'sector')?.closest?.('label');
    const sectionLabel = productionSectorField(row, 'section')?.closest?.('label');
    if (!sectorLabel || !sectionLabel) return;
    sectionLabel.hidden = !usesSection;
    row.classList.toggle('shows-section', usesSection);
    // Polo MS: a seção vem primeiro, porque filtra a lista de setores.
    if (usesSection) sectorLabel.before(sectionLabel);
    else sectionLabel.before(sectorLabel);
  });
}

// Polo MS: monta a lista de setores da seção digitada. Um setor que não é da
// seção é limpo, a não ser que seja o valor já salvo do lançamento (keep).
async function renderProductionSectorChoices(row = document, { keep = '' } = {}) {
  const select = productionSectorField(row, 'sector');
  const sectionInput = productionSectorField(row, 'section');
  if (!select || !sectionInput) return;
  const unit = document.querySelector('#production-unit-input')?.value || currentProductionUnit();
  const request = {};
  productionSectorOptions.set(row, request);
  const previous = keep || select.value;
  const draw = (base, loaded) => {
    const section = sectionInput.value.trim();
    // Antes da base carregar, mantém o valor; depois, só se for da seção (ou o salvo).
    const current = keep || !loaded || productionSectionSectors(base, section).some(item => item.sector === previous) ? previous : '';
    select.innerHTML = productionSectorSelectOptions(base, section, current);
    select.value = current;
  };
  draw([], false);
  try {
    request.promise = loadProductionSectorBase(unit);
    const base = await request.promise;
    if (productionSectorOptions.get(row) !== request) return;
    request.base = base;
    draw(base, true);
    syncFarmFromSectorChoice(row);
  } catch (error) {
    console.warn(error);
  }
}

function syncFarmFromSectorChoice(row = document) {
  const base = productionSectorOptions.get(row)?.base;
  const farm = productionSectorField(row, 'farm');
  if (!farm || !Array.isArray(base)) return;
  const sector = productionSectorField(row, 'sector')?.value || '';
  if (!sector) farm.value = '';
  const selected = productionSectionSectors(base, productionSectorField(row, 'section')?.value)
    .find(item => item.sector === sector);
  if (selected) farm.value = selected.farm || '';
}

function showEntryPane() {
  document.querySelector('#production-entry-pane').hidden = false;
  document.querySelector('#production-entry-footer').hidden = false;

  const editingItemId = productionEditingItemId;
  const configButton = document.querySelector('#production-config-toggle');
  if (configButton) configButton.hidden = Boolean(editingItemId) || !canConfigureProduction();

  const modalTitle = document.querySelector('#production-modal-title');
  if (modalTitle) modalTitle.textContent = editingItemId ? 'Editar frente' : 'Adicionar frente';
}

function setProductionEntryEditMode(isEditing) {
  const serviceSection = document.querySelector('#production-service-section');
  if (serviceSection) serviceSection.hidden = Boolean(isEditing);
  const notesSection = document.querySelector('#production-entry-notes');
  if (notesSection) notesSection.hidden = !isEditing;

  const configButton = document.querySelector('#production-config-toggle');
  if (configButton) configButton.hidden = Boolean(isEditing) || !canConfigureProduction();

  const modalTitle = document.querySelector('#production-modal-title');
  if (modalTitle) modalTitle.textContent = isEditing ? 'Editar frente' : 'Adicionar frente';
  const kicker = document.querySelector('#production-modal-kicker');
  if (kicker) kicker.textContent = isEditing ? 'Editar frente' : 'Produção Agrícola';
  const subtitle = document.querySelector('#production-modal-subtitle');
  if (subtitle) subtitle.hidden = !isEditing;
  // Na edição, o formulário fica em duas colunas: setor/status e anotações.
  document.querySelector('#production-entry-form')?.classList?.toggle('is-editing', Boolean(isEditing));

  const submit = document.querySelector('#production-entry-submit');
  if (submit) submit.textContent = isEditing ? 'Atualizar' : 'Adicionar';

  const hint = document.querySelector('#production-entry-hint');
  if (hint) hint.textContent = isEditing ? 'Enter atualiza' : 'Enter adiciona';
}

function clearEntryForm(defaultUnit = selectedNavbarProductionUnit()) {
  const [first, ...additional] = productionSectorRows();
  productionSectorRows().forEach(row => {
    productionSectorOptions.delete(row);
    clearProductionSectorScan(row);
  });
  additional.forEach(row => row.remove());
  updateProductionSectorRows();
  const form = document.querySelector('#production-entry-form');
  form?.reset();
  productionEditingItemId = null;
  // Mantém compatibilidade com abas que ainda usam o campo de identificação.
  const itemInput = document.querySelector('#production-item-id');
  if (itemInput) itemInput.value = '';
  document.querySelector('#production-work-date').value = saoPauloIsoDate();
  setProductionEntryUnit(defaultUnit);
  applyProductionLocationMode();
  renderEntryGroups();
  setSelectedStatus(defaultStatusCode());
  if (first) {
    resetSectorFields(first);
    renderEntryOperations(first);
  }
  setProductionEntryEditMode(false);
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
  applyProductionLocationMode();
  renderEntryGroups(item.group_id, item.service_front_id, item);
  document.querySelector('#production-sector-input').value = entry.sector || '';
  document.querySelector('#production-farm-input').value = entry.farm || '';
  document.querySelector('#production-observation-input').value = entry.observation || '';
  document.querySelector('#production-changes-input').value = entry.changes || '';
  setSelectedStatus(entry.status || defaultStatusCode());
  const [row] = productionSectorRows();
  const section = document.querySelector('#production-section-input');
  if (productionEntryUsesSection()) {
    // Polo MS: seção digitada; o setor salvo fica escolhido na lista da seção.
    section.value = entry.section || '';
    renderProductionSectorChoices(row, { keep: entry.sector || '' });
  } else {
    resetSectorFields(row);
    section.innerHTML = `<option value="${escapeHtml(entry.section || '')}">${escapeHtml(entry.section || 'Sem seção')}</option>`;
    section.value = entry.section || '';
  }
  setProductionEntryEditMode(true);
  let operations = splitProductionOperations(entry.operation);
  if (!operations.length) operations = productionFrontDefaultOperations(item.service_front_id);
  renderEntryOperations(row, operations.length ? operations : ['']);
  scanProductionSector(row);
  // O nome da frente em edição fica em destaque no topo do popup.
  document.querySelector('#production-modal-title').textContent = item.service_name || 'Frente';
  const subtitle = document.querySelector('#production-modal-subtitle');
  if (subtitle) {
    subtitle.textContent = [productionUnitLabel(currentProductionUnit()), item.group_name,
      entry.sector ? productionPlaceLabel(entry) : '',
      item.owner_name ? `Analista: ${item.owner_name}` : ''].filter(Boolean).join(' · ');
  }
  if (!item.is_own) {
    document.querySelector('#production-modal-kicker').textContent = 'Atualizar frente';
    document.querySelector('#production-entry-submit').textContent = 'Salvar atualização';
  }
  openModal('production-entry-modal');
  document.querySelector(productionEntryUsesSection() ? '#production-section-input' : '#production-sector-input')?.focus();
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
  if (itemId) Object.assign(sectors[0], {
    observation: document.querySelector('#production-observation-input')?.value.trim() || '',
    changes: document.querySelector('#production-changes-input')?.value.trim() || ''
  });
  payload.sectors = sectors;
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
  return productionSectorRows().map((row, index) => {
    const input = productionSectorField(row, 'sector');
    const sector = input.value.trim();
    const status = selectedStatus(row);
    if (!sector || seen.has(sector.toLocaleUpperCase('pt-BR'))) {
      input.focus();
      throw new Error(sector ? `O setor ${sector} está repetido nesta frente.` : 'Informe o setor.');
    }
    if (!status) throw new Error(`Selecione o status do setor ${sector}.`);
    seen.add(sector.toLocaleUpperCase('pt-BR'));
    const operations = productionEntryOperationValues(row).map(value => value.trim()).filter(Boolean);
    return { sector, section: productionSectorField(row, 'section').value.trim(),
      farm: productionSectorField(row, 'farm').value.trim(), status,
      ...(operations.length || index === 0 && productionEditingItemId
        ? { operation: operations.join(', ') } : {}) };
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
    await Promise.all([loadProductionCatalog(unit, epoch), loadProductionStatuses()]);
    if (!isCurrentProductionRequest(unit, epoch)) return;
    renderStatusOptions(defaultStatusCode());
    if (document.body?.dataset?.page !== 'production_catalog') await loadProductionItems(unit, epoch);
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
  }
}


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

document.querySelector('#production-group-input')?.addEventListener('change', () => renderEntryFronts());

document.querySelector('#production-add-sector')?.addEventListener('click', addProductionSector);

document.querySelector('#production-sector-rows')?.addEventListener('click', event => {
  const row = event.target.closest('[data-production-sector-row]');
  if (!row) return;
  const button = event.target.closest('[data-remove-sector]');
  if (button && row !== productionSectorRows()[0]) {
    productionSectorOptions.delete(row);
    clearProductionSectorScan(row);
    row.remove();
    updateProductionSectorRows();
    return;
  }
  if (event.target.closest('[data-retry-sector-scan]')) scanProductionSector(row);
  const add = event.target.closest('[data-entry-op-add]');
  const remove = event.target.closest('[data-entry-op-remove]');
  const suggestion = event.target.closest('[data-sector-operation]');
  if (!add && !remove && !suggestion) return;
  const operations = productionEntryOperationValues(row);
  if (remove) operations.splice(Number(remove.dataset.entryOpRemove), 1);
  else if (suggestion) {
    const code = suggestion.dataset.sectorOperation;
    if (operations.some(value => productionOperationKey(value) === productionOperationKey(code))) return;
    const blank = operations.findIndex(value => !value.trim());
    if (blank >= 0) operations[blank] = code;
    else if (operations.length < 10) operations.push(code);
    else return;
  } else if (operations.length < 10) operations.push('');
  renderEntryOperations(row, operations);
  if (add) row.querySelector(`[data-entry-op="${operations.length - 1}"]`)?.focus();
});

document.querySelector('#production-sector-rows')?.addEventListener('input', event => {
  if (!event.target.matches('input[data-sector-field="sector"], input[data-sector-field="section"]')) return;
  const row = event.target.closest('[data-production-sector-row]');
  if (row) {
    productionSectorOptions.delete(row);
    clearProductionSectorScan(row);
  }
});

document.querySelector('#production-sector-rows')?.addEventListener('change', async event => {
  const row = event.target.closest('[data-production-sector-row]');
  if (!row) return;
  const field = event.target.dataset.sectorField;
  const value = event.target.value;
  if (field === 'sector' || field === 'section') clearProductionSectorScan(row);
  if (productionEntryUsesSection()) {
    // Polo MS: a seção digitada refaz a lista de setores; o setor escolhido traz a fazenda.
    if (field === 'section') {
      const choices = renderProductionSectorChoices(row);
      productionSectorField(row, 'sector')?.focus();
      await choices;
    }
    if (field === 'sector') syncFarmFromSectorChoice(row);
  } else if (field === 'sector') await resolveSectorFromBase(row);
  if ((field === 'sector' || field === 'section') && row.isConnected && event.target.value === value) scanProductionSector(row);
  if (event.target.matches('[data-production-status-select]')) setSelectedStatus(event.target.value, row);
});

document.querySelector('#production-entry-form')?.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.target instanceof HTMLTextAreaElement) return;
  if (event.target.closest('button')) return;
  event.preventDefault();
  if (event.target.matches('input[data-sector-field]')) event.target.blur();
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

const productionConfigGroupsList = document.querySelector('#production-groups-list');
productionConfigGroupsList?.addEventListener('click', event => {
  const button = event.target.closest('[data-config-action]');
  if (!button || !canConfigureProduction()) return;
  if (button.dataset.configAction === 'add-front') {
    clearFrontConfigForm({ keepOpen: true, groupId: Number(button.dataset.groupId) });
    document.querySelector('#production-config-front-name')?.focus();
  }
  if (button.dataset.configAction === 'edit-group') editConfigGroup(Number(button.dataset.groupId));
  if (button.dataset.configAction === 'delete-group') deleteConfigGroup(Number(button.dataset.groupId), button.dataset.groupName || '');
  if (button.dataset.configAction === 'edit-front') editConfigFront(Number(button.dataset.frontId));
  if (button.dataset.configAction === 'delete-front') deleteConfigFront(Number(button.dataset.frontId), button.dataset.frontName || '');
});
productionConfigGroupsList?.addEventListener('toggle', event => {
  const id = event.target.dataset?.catalogGroupId;
  if (!id || !openProductionConfigGroups || productionConfigGroupSearch()) return;
  if (event.target.open) openProductionConfigGroups.add(id);
  else openProductionConfigGroups.delete(id);
}, true);

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
    if (requested !== currentProductionUnit()) return;
    // Na página Cadastros, as frentes listadas dependem da unidade.
    if (typeof productionCatalogPageActive === 'function' && productionCatalogPageActive()) {
      openProductionResponsibilityForm();
      if (!canConfigureProduction()) {
        productionConfigCatalog = productionCatalog;
        renderProductionConfigLists();
      }
      await Promise.all([
        loadProductionResponsibilities(requested),
        canConfigureProduction() ? loadProductionConfigCatalog().then(() => clearFrontConfigForm()) : null
      ]);
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível trocar a unidade.', true);
  }
});

initializeProductionPage();
