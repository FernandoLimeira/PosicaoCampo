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
let productionPageEpoch = 0;
let productionItemsRequest = 0;

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
  if (!isCurrentProductionRequest(unit, epoch)) return null;
  const request = ++productionItemsRequest;
  const workDate = saoPauloIsoDate();
  const data = await apiRequest(`/api/production/my-items?unit=${encodeURIComponent(unit)}&date=${encodeURIComponent(workDate)}&scope=all`);
  if (request !== productionItemsRequest || !isCurrentProductionRequest(unit, epoch) || workDate !== saoPauloIsoDate()) return null;
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

function renderStatusOptions(selectedCode = selectedStatus()) {
  const container = document.querySelector('#production-status-options');
  if (!container) return;
  if (!productionStatuses.length) {
    container.innerHTML = '<div class="production-empty"><span>Nenhum status configurado.</span></div>';
    return;
  }
  const selected = productionStatuses.some(status => status.code === selectedCode) ? selectedCode : defaultStatusCode();
  container.innerHTML = `<select class="production-status-select ${statusMeta(selected).className}" data-production-status-select aria-label="Status da frente">${
    productionStatuses.map(status => `<option value="${escapeHtml(status.code)}" ${status.code === selected ? 'selected' : ''}>${escapeHtml(status.name)}</option>`).join('')
  }</select>`;
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

function productionPlaceLabel(entry, unit = currentProductionUnit()) {
  const section = productionUnitUsesSection(unit) && entry.section ? ` / Seção ${entry.section}` : '';
  return `Setor ${entry.sector || '-'}${section}${entry.farm ? ` · ${entry.farm}` : ''}`;
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

// WhatsApp do responsável: gravado só com dígitos e DDI 55 ("5518991234567").
const WHATSAPP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
  + '<path class="whatsapp-icon-bubble" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z"/>'
  + '<path class="whatsapp-icon-phone" d="M8.6 7.2c.3-.3.8-.3 1 .1l.9 1.9c.2.4.1.8-.2 1.1l-.5.5c.6 1.2 1.6 2.2 2.8 2.8l.5-.5c.3-.3.7-.4 1.1-.2l1.9.9c.4.2.5.7.1 1l-.8.8c-.6.6-1.6.8-2.4.4a10 10 0 0 1-5.2-5.2c-.4-.8-.2-1.8.4-2.4z"/></svg>';

function formatWhatsapp(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return local;
}

// Ícone que abre a conversa (wa.me) em outra aba; o número aparece ao passar o mouse e, com
// ``showNumber``, ao lado do ícone.
function whatsappLinkHtml(value, name = '', showNumber = false) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  const number = formatWhatsapp(digits);
  const label = `Conversar no WhatsApp${name ? ` com ${name}` : ''}: ${number}`;
  return `<a class="whatsapp-link" data-whatsapp-link href="https://wa.me/${digits}" target="_blank" rel="noopener noreferrer"
    title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${WHATSAPP_ICON}${showNumber ? `<span>${escapeHtml(number)}</span>` : ''}</a>`;
}

// Mesmo texto de productionResponsibleName, com o ícone do WhatsApp na frente de cada nome.
function productionResponsibleHtml(item, shift = dashboardCurrentShift().name, showNumber = false) {
  const team = item.responsibility_team?.[shift];
  if (!team?.length) return escapeHtml(productionResponsibleName(item, shift));
  const labels = team.map(person => person.name
    ? `${escapeHtml(`${person.role_name} ${person.name}${person.day_off ? ' (cobertura)' : ''}`)}${whatsappLinkHtml(person.whatsapp, person.name, showNumber)}`
    : escapeHtml(`${person.role_name} em folga sem cobertura`));
  if (!team.some(person => person.role_type === 'lead')) labels.unshift(escapeHtml('Sem responsável escalado'));
  return labels.join(' · ');
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

function findProductionItem(itemId) {
  return productionItems.find(item => Number(item.id) === Number(itemId));
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

document.querySelector('#production-items-body')?.addEventListener('click', event => {
  const button = event.target.closest('[data-production-action]');
  if (!button) return;
  const itemId = Number(button.dataset.itemId);
  if (button.dataset.productionAction === 'edit') openEditProductionItem(itemId);
  if (button.dataset.productionAction === 'remove') removeProductionItem(itemId);
  if (button.dataset.productionAction === 'orders') openProductionItemOrders(itemId);
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
