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
let productionConfigCatalog = { groups: [] };
let productionStatuses = [];
let productionConfigStatuses = [];
let productionEditingFrontUnits = [];
let productionEditingFrontActive = true;
let productionItems = [];
let productionListScope = 'mine';
let sectorOptions = [];

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatProductionDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '-');
}

function allowedProductionUnits() {
  return Array.isArray(productionAccess?.units) ? productionAccess.units : [];
}

function canFillProduction() {
  return Boolean(productionAccess?.permissions?.fill);
}

function canConfigureProduction() {
  return Boolean(productionAccess?.permissions?.configure);
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
  if (date) date.textContent = formatProductionDate(localIsoDate());
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

async function loadProductionCatalog(unit) {
  productionCatalog = await apiRequest(`/api/production/catalog?unit=${encodeURIComponent(unit)}`);
  return productionCatalog;
}

async function loadProductionStatuses({ includeInactive = false } = {}) {
  const suffix = includeInactive ? '?include_inactive=1' : '';
  const data = await apiRequest(`/api/production/statuses${suffix}`);
  const statuses = Array.isArray(data.statuses) ? data.statuses : [];
  if (includeInactive) productionConfigStatuses = statuses;
  else productionStatuses = statuses;
  return statuses;
}

async function loadProductionItems(unit) {
  const workDate = localIsoDate();
  const scope = productionListScope === 'all' ? 'all' : 'mine';
  const data = await apiRequest(`/api/production/my-items?unit=${encodeURIComponent(unit)}&date=${encodeURIComponent(workDate)}&scope=${encodeURIComponent(scope)}`);
  productionItems = Array.isArray(data.items) ? data.items : [];
  renderProductionItems(data);
  return data;
}

async function setProductionListScope(scope) {
  const nextScope = scope === 'all' ? 'all' : 'mine';
  if (productionListScope === nextScope) return;
  productionListScope = nextScope;
  document.querySelectorAll('[data-production-scope]').forEach(button => {
    const active = button.dataset.productionScope === productionListScope;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  await loadProductionItems(currentProductionUnit());
}

function statusMeta(code) {
  const statuses = [...productionStatuses, ...productionConfigStatuses];
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
  container.innerHTML = productionStatuses.map(status => {
    const style = PRODUCTION_STATUS_STYLES[status.style_key] || PRODUCTION_STATUS_STYLES.waiting;
    const checked = status.code === selectedCode ? ' checked' : '';
    return `<label class="production-status-option ${style.className}"><input type="checkbox" data-production-status value="${escapeHtml(status.code)}"${checked} /><span>${escapeHtml(status.name)}</span></label>`;
  }).join('');
  if (!container.innerHTML) {
    container.innerHTML = '<div class="production-empty"><span>Nenhum status configurado.</span></div>';
  }
}

function renderProductionSummary() {
  const summary = document.querySelector('#production-summary');
  if (!summary) return;
  const counts = Object.fromEntries(productionStatuses.map(status => [status.code, 0]));
  productionItems.forEach(item => {
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

function renderProductionItems(data) {
  const body = document.querySelector('#production-items-body');
  const empty = document.querySelector('#production-empty');
  const status = document.querySelector('#production-list-status');
  const ownerHeading = document.querySelector('#production-owner-heading');
  const actionsHeading = document.querySelector('#production-actions-heading');
  const showingAll = productionListScope === 'all';
  if (!body) return;

  if (ownerHeading) ownerHeading.hidden = !showingAll;
  if (actionsHeading) actionsHeading.hidden = showingAll;
  document.querySelectorAll('[data-production-scope]').forEach(button => {
    const active = button.dataset.productionScope === productionListScope;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  body.innerHTML = productionItems.map(item => {
    const entry = item.entry || {};
    const current = Boolean(item.is_current_day);
    const updatedLabel = current ? 'Atualizado hoje' : (entry.work_date ? 'Atualizar hoje' : 'Sem atualização');
    const updatedDetail = entry.work_date ? `Último registro: ${formatProductionDate(entry.work_date)}` : 'Nenhum registro salvo';
    const styleLabel = item.display_style === 'front' ? 'Frente operacional' : 'Operação / serviço';
    const actions = canFillProduction() ? `
      <div class="production-row-actions">
        <button class="production-row-action" type="button" data-production-action="edit" data-item-id="${item.id}">Editar</button>
        <button class="production-row-action is-remove" type="button" data-production-action="remove" data-item-id="${item.id}">Remover</button>
      </div>` : '';
    const actionCell = showingAll ? '' : `<td>${actions}</td>`;
    const ownerCell = showingAll ? `<td><span class="production-owner-name">${escapeHtml(item.owner_name || '-')}</span></td>` : '';
    return `<tr>
      <td>${escapeHtml(item.group_name || '-')}</td>
      <td><div class="production-item-name"><strong>${escapeHtml(item.service_name || '-')}</strong><small>${escapeHtml(styleLabel)}</small></div></td>
      ${ownerCell}
      <td>${escapeHtml(entry.sector || '-')}</td>
      <td>${escapeHtml(entry.farm || '-')}</td>
      <td>${statusBadge(entry.status)}</td>
      <td><div class="production-update-state ${current ? '' : 'is-pending'}"><strong>${updatedLabel}</strong><small>${escapeHtml(updatedDetail)}</small></div></td>
      ${actionCell}
    </tr>`;
  }).join('');

  if (empty) {
    empty.hidden = productionItems.length > 0;
    const emptyTitle = empty.querySelector('strong');
    const emptyText = empty.querySelector('span');
    if (emptyTitle) emptyTitle.textContent = showingAll ? 'Nenhum lançamento nesta unidade.' : 'Nenhuma frente adicionada.';
    if (emptyText) emptyText.textContent = showingAll
      ? 'Ainda não há frentes ou serviços acompanhados pelos analistas desta unidade.'
      : 'Use “Adicionar frente” para montar sua lista de trabalho desta unidade.';
  }
  if (status) {
    if (!productionItems.length) {
      status.textContent = '';
    } else if (showingAll) {
      const analysts = new Set(productionItems.map(item => item.owner_user_id).filter(Boolean));
      status.textContent = `${productionItems.length} ${productionItems.length === 1 ? 'lançamento' : 'lançamentos'} · ${analysts.size} ${analysts.size === 1 ? 'analista' : 'analistas'}`;
    } else {
      status.textContent = `${productionItems.length} ${productionItems.length === 1 ? 'lançamento meu' : 'lançamentos meus'}`;
    }
  }

  renderProductionSummary();

  if (data?.permissions) {
    productionAccess.permissions = { ...productionAccess.permissions, ...data.permissions };
  }
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

function setSelectedStatus(value) {
  document.querySelectorAll('[data-production-status]').forEach(input => {
    input.checked = input.value === value;
  });
}

function selectedStatus() {
  return document.querySelector('[data-production-status]:checked')?.value || '';
}

function defaultStatusCode() {
  return productionStatuses.find(status => status.code === 'EM ATIVIDADE')?.code
    || productionStatuses[0]?.code
    || '';
}

function resetSectorFields() {
  sectorOptions = [];
  const section = document.querySelector('#production-section-input');
  if (section) section.innerHTML = '<option value="">Sem seção</option>';
}

async function resolveSectorFromBase() {
  const unit = document.querySelector('#production-unit-input')?.value || currentProductionUnit();
  const sector = document.querySelector('#production-sector-input')?.value.trim() || '';
  const section = document.querySelector('#production-section-input');
  const farm = document.querySelector('#production-farm-input');
  resetSectorFields();
  if (!sector) return;
  try {
    const data = await apiRequest(`/api/production/sector-options?unit=${encodeURIComponent(unit)}&sector=${encodeURIComponent(sector)}`);
    sectorOptions = Array.isArray(data.items) ? data.items : [];
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

function syncFarmFromSection() {
  const sectionValue = document.querySelector('#production-section-input')?.value || '';
  const selected = sectorOptions.find(item => item.section === sectionValue);
  const farm = document.querySelector('#production-farm-input');
  if (farm && selected) farm.value = selected.farm || '';
}

function showEntryPane() {
  document.querySelector('#production-entry-pane').hidden = false;
  document.querySelector('#production-config-pane').hidden = true;
  document.querySelector('#production-status-config-pane').hidden = true;
  document.querySelector('#production-entry-footer').hidden = false;

  const editingItemId = document.querySelector('#production-item-id')?.value;
  const configButton = document.querySelector('#production-config-toggle');
  if (configButton) configButton.hidden = Boolean(editingItemId) || !canConfigureProduction();
  const statusConfigButton = document.querySelector('#production-status-config-toggle');
  if (statusConfigButton) statusConfigButton.hidden = !canConfigureProduction();

  const modalTitle = document.querySelector('#production-modal-title');
  if (modalTitle) modalTitle.textContent = editingItemId ? 'Editar frente' : 'Adicionar frente';
}

async function showConfigPane() {
  if (!canConfigureProduction()) return;
  document.querySelector('#production-entry-pane').hidden = true;
  document.querySelector('#production-config-pane').hidden = false;
  document.querySelector('#production-status-config-pane').hidden = true;
  document.querySelector('#production-entry-footer').hidden = true;

  const configButton = document.querySelector('#production-config-toggle');
  if (configButton) configButton.hidden = true;
  const statusConfigButton = document.querySelector('#production-status-config-toggle');
  if (statusConfigButton) statusConfigButton.hidden = true;

  const modalTitle = document.querySelector('#production-modal-title');
  if (modalTitle) modalTitle.textContent = 'Configuração';

  setProductionConfigUnit(selectedNavbarProductionUnit());
  await loadProductionConfigCatalog();
  clearGroupConfigForm();
  clearFrontConfigForm();
}

async function showStatusConfigPane() {
  if (!canConfigureProduction()) return;
  document.querySelector('#production-entry-pane').hidden = true;
  document.querySelector('#production-config-pane').hidden = true;
  document.querySelector('#production-status-config-pane').hidden = false;
  document.querySelector('#production-entry-footer').hidden = true;

  const configButton = document.querySelector('#production-config-toggle');
  if (configButton) configButton.hidden = true;
  const statusConfigButton = document.querySelector('#production-status-config-toggle');
  if (statusConfigButton) statusConfigButton.hidden = true;

  const modalTitle = document.querySelector('#production-modal-title');
  if (modalTitle) modalTitle.textContent = 'Configuração de status';

  await loadProductionConfigStatuses();
  clearStatusConfigForm();
}

function setProductionEntryEditMode(isEditing) {
  const serviceSection = document.querySelector('#production-service-section');
  if (serviceSection) serviceSection.hidden = Boolean(isEditing);

  const configButton = document.querySelector('#production-config-toggle');
  if (configButton) configButton.hidden = Boolean(isEditing) || !canConfigureProduction();
  const statusConfigButton = document.querySelector('#production-status-config-toggle');
  if (statusConfigButton) statusConfigButton.hidden = !canConfigureProduction();

  const modalTitle = document.querySelector('#production-modal-title');
  if (modalTitle) modalTitle.textContent = isEditing ? 'Editar frente' : 'Adicionar frente';

  const submit = document.querySelector('#production-entry-submit');
  if (submit) submit.textContent = isEditing ? 'Atualizar' : 'Adicionar';

  const hint = document.querySelector('#production-entry-hint');
  if (hint) hint.textContent = isEditing ? 'Enter atualiza' : 'Enter adiciona';
}

function clearEntryForm(defaultUnit = selectedNavbarProductionUnit()) {
  const form = document.querySelector('#production-entry-form');
  form?.reset();
  document.querySelector('#production-item-id').value = '';
  document.querySelector('#production-work-date').value = localIsoDate();
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
  document.querySelector('#production-item-id').value = String(item.id);
  document.querySelector('#production-work-date').value = localIsoDate();
  setProductionEntryUnit(currentProductionUnit());
  renderEntryGroups(item.group_id, item.service_front_id, item);
  document.querySelector('#production-sector-input').value = entry.sector || '';
  document.querySelector('#production-farm-input').value = entry.farm || '';
  document.querySelector('#production-observation-input').value = entry.observation || '';
  setSelectedStatus(entry.status || defaultStatusCode());
  resetSectorFields();
  const section = document.querySelector('#production-section-input');
  section.innerHTML = `<option value="${escapeHtml(entry.section || '')}">${escapeHtml(entry.section || 'Sem seção')}</option>`;
  section.value = entry.section || '';
  setProductionEntryEditMode(true);
  openModal('production-entry-modal');
  document.querySelector('#production-sector-input')?.focus();
}

async function submitProductionEntry(event) {
  event.preventDefault();
  if (!canFillProduction()) return;
  const submit = document.querySelector('#production-entry-submit');
  const itemId = Number(document.querySelector('#production-item-id')?.value || 0);
  const unit = document.querySelector('#production-unit-input')?.value || currentProductionUnit();
  const frontId = Number(document.querySelector('#production-front-input')?.value || 0);
  const status = selectedStatus();
  if (!frontId) {
    showToast('Selecione uma frente ou serviço.', true);
    return;
  }
  if (!status) {
    showToast('Selecione um status.', true);
    return;
  }
  const payload = {
    unit_code: unit,
    service_front_id: frontId,
    work_date: localIsoDate(),
    sector: document.querySelector('#production-sector-input')?.value.trim() || '',
    section: document.querySelector('#production-section-input')?.value || '',
    farm: document.querySelector('#production-farm-input')?.value.trim() || '',
    status,
    observation: document.querySelector('#production-observation-input')?.value.trim() || ''
  };
  if (!payload.sector) {
    showToast('Informe o setor.', true);
    document.querySelector('#production-sector-input')?.focus();
    return;
  }
  if (submit) submit.disabled = true;
  try {
    await apiRequest(itemId ? `/api/production/my-items/${itemId}` : '/api/production/my-items', {
      method: itemId ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    closeModal('production-entry-modal');
    showToast(itemId ? 'Frente atualizada.' : 'Frente adicionada à sua lista.');
    await refreshProductionPage(unit);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar a frente.', true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function removeProductionItem(itemId) {
  const item = findProductionItem(itemId);
  if (!item || !canFillProduction()) return;
  if (!window.confirm(`Remover ${item.service_name} da sua lista? O histórico dos dias anteriores será preservado.`)) return;
  try {
    await apiRequest(`/api/production/my-items/${itemId}`, { method: 'DELETE' });
    showToast('Frente removida da sua lista.');
    await refreshProductionPage(currentProductionUnit());
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível remover a frente.', true);
  }
}

async function refreshProductionPage(unit = currentProductionUnit()) {
  setProductionContext(unit);
  await Promise.all([loadProductionCatalog(unit), loadProductionStatuses()]);
  renderStatusOptions(defaultStatusCode());
  await loadProductionItems(unit);
}

function renderConfigGroupOptions() {
  const select = document.querySelector('#production-config-front-group');
  if (!select) return;
  const groups = Array.isArray(productionConfigCatalog.groups) ? productionConfigCatalog.groups : [];
  select.innerHTML = groups.map(group => `<option value="${group.id}">${escapeHtml(group.name)}${group.is_active ? '' : ' · inativo'}</option>`).join('');
}

function renderProductionConfigLists() {
  const groups = Array.isArray(productionConfigCatalog.groups) ? productionConfigCatalog.groups : [];
  const groupList = document.querySelector('#production-groups-list');
  const frontList = document.querySelector('#production-fronts-list');
  renderConfigGroupOptions();
  if (groupList) {
    groupList.innerHTML = groups.map(group => `
      <div class="production-config-list-item ${group.is_active ? '' : 'is-inactive'}">
        <div class="production-config-list-item-copy"><strong>${escapeHtml(group.name)}</strong><span>Ordem ${group.position}${group.is_active ? '' : ' · inativo'}</span></div>
        <div class="production-config-list-actions">
          <button type="button" data-config-action="edit-group" data-group-id="${group.id}">Editar</button>
          <button class="is-delete" type="button" data-config-action="delete-group" data-group-id="${group.id}" data-group-name="${escapeHtml(group.name)}">Apagar</button>
        </div>
      </div>`).join('') || '<div class="production-empty"><span>Nenhum grupo cadastrado.</span></div>';
  }
  if (frontList) {
    const fronts = groups.flatMap(group => (group.fronts || []).map(front => ({ ...front, group_name: group.name })));
    frontList.innerHTML = fronts.map(front => `
      <div class="production-config-list-item ${front.is_active ? '' : 'is-inactive'}">
        <div class="production-config-list-item-copy"><strong>${escapeHtml(front.name)}</strong><span>${escapeHtml(front.group_name)} · ${front.display_style === 'front' ? 'frente' : 'operação'}${front.is_active ? '' : ' · inativa'}</span></div>
        <div class="production-config-list-actions">
          <button type="button" data-config-action="edit-front" data-front-id="${front.id}">Editar</button>
          <button class="is-delete" type="button" data-config-action="delete-front" data-front-id="${front.id}" data-front-name="${escapeHtml(front.name)}">Apagar</button>
        </div>
      </div>`).join('') || '<div class="production-empty"><span>Nenhuma frente/serviço cadastrada nesta unidade.</span></div>';
  }
}

async function loadProductionConfigCatalog() {
  const unit = setProductionConfigUnit(selectedNavbarProductionUnit());
  productionConfigCatalog = await apiRequest(`/api/production/catalog?unit=${encodeURIComponent(unit)}&include_inactive=1`);
  renderProductionConfigLists();
}

function nextGroupPosition() {
  const groups = Array.isArray(productionConfigCatalog.groups) ? productionConfigCatalog.groups : [];
  const highest = groups.reduce((max, group) => Math.max(max, Number(group.position) || 0), 0);
  return String(highest + 1);
}

function setGroupConfigEditorMode(isEditing = false, open = false) {
  const editor = document.querySelector('#production-group-editor');
  const title = document.querySelector('#production-group-editor-title');
  const hint = editor?.querySelector('.production-config-editor-hint');
  const submit = document.querySelector('#production-group-submit');
  const cancel = document.querySelector('#production-group-clear');
  if (title) title.textContent = isEditing ? 'Editar grupo' : 'Adicionar grupo';
  if (hint) hint.textContent = isEditing ? 'Alterando grupo selecionado' : 'Nome e ordem';
  if (submit) submit.textContent = isEditing ? 'Salvar alterações' : 'Adicionar grupo';
  if (cancel) cancel.textContent = isEditing ? 'Cancelar edição' : 'Cancelar';
  if (editor && open) editor.open = true;
}

function clearGroupConfigForm({ keepOpen = false } = {}) {
  const id = document.querySelector('#production-group-id');
  const name = document.querySelector('#production-group-name');
  const position = document.querySelector('#production-group-position');
  if (id) id.value = '';
  if (name) name.value = '';
  if (position) position.value = '';
  setGroupConfigEditorMode(false, keepOpen);
}

function setFrontConfigEditorMode(isEditing = false, open = false) {
  const editor = document.querySelector('#production-front-editor');
  const title = document.querySelector('#production-front-editor-title');
  const hint = editor?.querySelector('.production-config-editor-hint');
  if (title) title.textContent = isEditing ? 'Editar frente / serviço' : 'Nova frente / serviço';
  if (hint) hint.textContent = isEditing ? 'Alterando cadastro selecionado' : 'Clique para preencher';
  if (editor && open) editor.open = true;
}

function clearFrontConfigForm({ keepOpen = false } = {}) {
  document.querySelector('#production-config-front-id').value = '';
  document.querySelector('#production-config-front-name').value = '';
  document.querySelector('#production-config-front-position').value = '0';
  document.querySelector('#production-config-front-style').value = 'operation';
  productionEditingFrontActive = true;
  const unit = setProductionConfigUnit(selectedNavbarProductionUnit());
  productionEditingFrontUnits = unit ? [unit] : [];
  renderConfigGroupOptions();
  setFrontConfigEditorMode(false, keepOpen);
}

function editConfigGroup(groupId) {
  const group = (productionConfigCatalog.groups || []).find(item => Number(item.id) === Number(groupId));
  if (!group) return;
  document.querySelector('#production-group-id').value = String(group.id);
  document.querySelector('#production-group-name').value = group.name;
  document.querySelector('#production-group-position').value = String(group.position || 0);
  setGroupConfigEditorMode(true, true);
  document.querySelector('#production-group-name')?.focus();
}

function editConfigFront(frontId) {
  const groups = productionConfigCatalog.groups || [];
  const front = groups.flatMap(group => (group.fronts || []).map(item => ({ ...item, group_id: group.id }))).find(item => Number(item.id) === Number(frontId));
  if (!front) return;
  document.querySelector('#production-config-front-id').value = String(front.id);
  document.querySelector('#production-config-front-name').value = front.name;
  document.querySelector('#production-config-front-group').value = String(front.group_id);
  document.querySelector('#production-config-front-style').value = front.display_style || 'operation';
  document.querySelector('#production-config-front-position').value = String(front.position || 0);
  productionEditingFrontActive = Boolean(front.is_active);
  productionEditingFrontUnits = Array.isArray(front.units) ? [...front.units] : [];
  const unit = setProductionConfigUnit(selectedNavbarProductionUnit());
  if (unit && !productionEditingFrontUnits.includes(unit)) productionEditingFrontUnits.push(unit);
  setFrontConfigEditorMode(true, true);
  document.querySelector('#production-config-front-name')?.focus();
}

async function submitConfigGroup(event) {
  event.preventDefault();
  const id = Number(document.querySelector('#production-group-id')?.value || 0);
  const existingGroup = id
    ? (productionConfigCatalog.groups || []).find(item => Number(item.id) === id)
    : null;
  const payload = {
    name: document.querySelector('#production-group-name')?.value.trim() || '',
    position: Number(document.querySelector('#production-group-position')?.value || 0),
    is_active: id ? Boolean(existingGroup?.is_active) : true
  };
  try {
    await apiRequest(id ? `/api/production/catalog/groups/${id}` : '/api/production/catalog/groups', {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(payload)
    });
    clearGroupConfigForm();
    const editor = document.querySelector('#production-group-editor');
    if (editor) editor.open = false;
    await loadProductionConfigCatalog();
    await loadProductionCatalog(currentProductionUnit());
    renderEntryGroups();
    showToast('Grupo salvo.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar o grupo.', true);
  }
}

async function submitConfigFront(event) {
  event.preventDefault();
  const id = Number(document.querySelector('#production-config-front-id')?.value || 0);
  const unit = document.querySelector('#production-config-unit-input')?.value || selectedNavbarProductionUnit();
  const units = id
    ? Array.from(new Set([...(productionEditingFrontUnits || []), unit].filter(Boolean)))
    : [unit].filter(Boolean);
  const payload = {
    name: document.querySelector('#production-config-front-name')?.value.trim() || '',
    group_id: Number(document.querySelector('#production-config-front-group')?.value || 0),
    display_style: document.querySelector('#production-config-front-style')?.value || 'operation',
    position: Number(document.querySelector('#production-config-front-position')?.value || 0),
    is_active: id ? productionEditingFrontActive : true,
    units
  };
  try {
    await apiRequest(id ? `/api/production/catalog/fronts/${id}` : '/api/production/catalog/fronts', {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(payload)
    });
    clearFrontConfigForm();
    const editor = document.querySelector('#production-front-editor');
    if (editor) editor.open = false;
    await loadProductionConfigCatalog();
    await loadProductionCatalog(currentProductionUnit());
    renderEntryGroups();
    showToast('Frente/serviço salva.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar a frente/serviço.', true);
  }
}

async function deleteConfigGroup(groupId, groupName = '') {
  const label = groupName ? ` “${groupName}”` : '';
  if (!window.confirm(`Apagar o grupo${label}? Essa ação só é permitida quando não existem frentes/serviços vinculados.`)) return;
  try {
    await apiRequest(`/api/production/catalog/groups/${groupId}`, { method: 'DELETE' });
    clearGroupConfigForm();
    await loadProductionConfigCatalog();
    await loadProductionCatalog(currentProductionUnit());
    renderEntryGroups();
    showToast('Grupo apagado.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível apagar o grupo.', true);
  }
}

async function deleteConfigFront(frontId, frontName = '') {
  const label = frontName ? ` “${frontName}”` : '';
  if (!window.confirm(`Apagar a frente/serviço${label}? Itens que já possuem lançamentos não podem ser apagados para preservar o histórico.`)) return;
  try {
    await apiRequest(`/api/production/catalog/fronts/${frontId}`, { method: 'DELETE' });
    clearFrontConfigForm();
    await loadProductionConfigCatalog();
    await loadProductionCatalog(currentProductionUnit());
    renderEntryGroups();
    showToast('Frente/serviço apagada.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível apagar a frente/serviço.', true);
  }
}

async function loadProductionConfigStatuses() {
  productionConfigStatuses = await loadProductionStatuses({ includeInactive: true });
  renderProductionStatusConfigList();
  return productionConfigStatuses;
}

function nextStatusPosition() {
  const highest = productionConfigStatuses.reduce((max, status) => Math.max(max, Number(status.position) || 0), 0);
  return String(highest + 1);
}

function renderProductionStatusConfigList() {
  const list = document.querySelector('#production-status-list');
  if (!list) return;
  list.innerHTML = productionConfigStatuses.map(status => {
    const style = PRODUCTION_STATUS_STYLES[status.style_key] || PRODUCTION_STATUS_STYLES.waiting;
    return `
      <div class="production-config-list-item ${status.is_active ? '' : 'is-inactive'}">
        <div class="production-config-list-item-copy">
          <strong><span class="production-status-dot ${style.className}" aria-hidden="true"></span>${escapeHtml(status.name)}</strong>
          <span>${style.label} · Ordem ${status.position}${status.is_active ? '' : ' · inativo'}</span>
        </div>
        <div class="production-config-list-actions">
          <button type="button" data-status-action="edit" data-status-id="${status.id}">Editar</button>
          <button class="is-delete" type="button" data-status-action="delete" data-status-id="${status.id}" data-status-name="${escapeHtml(status.name)}">Apagar</button>
        </div>
      </div>`;
  }).join('') || '<div class="production-empty"><span>Nenhum status cadastrado.</span></div>';
}

function setStatusConfigEditorMode(isEditing = false, open = false) {
  const editor = document.querySelector('#production-status-editor');
  const title = document.querySelector('#production-status-editor-title');
  const hint = editor?.querySelector('.production-config-editor-hint');
  const submit = document.querySelector('#production-status-submit');
  const cancel = document.querySelector('#production-status-clear');
  if (title) title.textContent = isEditing ? 'Editar status' : 'Novo status';
  if (hint) hint.textContent = isEditing ? 'Alterando status selecionado' : 'Clique para preencher';
  if (submit) submit.textContent = isEditing ? 'Salvar alterações' : 'Adicionar status';
  if (cancel) cancel.textContent = isEditing ? 'Cancelar edição' : 'Cancelar';
  if (editor && open) editor.open = true;
}

function clearStatusConfigForm({ keepOpen = false } = {}) {
  const id = document.querySelector('#production-status-id');
  const name = document.querySelector('#production-status-name');
  const style = document.querySelector('#production-status-style');
  const position = document.querySelector('#production-status-position');
  if (id) id.value = '';
  if (name) name.value = '';
  if (style) style.value = 'active';
  if (position) position.value = '';
  setStatusConfigEditorMode(false, keepOpen);
}

function editProductionStatus(statusId) {
  const status = productionConfigStatuses.find(item => Number(item.id) === Number(statusId));
  if (!status) return;
  document.querySelector('#production-status-id').value = String(status.id);
  document.querySelector('#production-status-name').value = status.name;
  document.querySelector('#production-status-style').value = status.style_key || 'waiting';
  document.querySelector('#production-status-position').value = String(status.position || 0);
  setStatusConfigEditorMode(true, true);
  document.querySelector('#production-status-name')?.focus();
}

async function submitProductionStatus(event) {
  event.preventDefault();
  const id = Number(document.querySelector('#production-status-id')?.value || 0);
  const existing = id ? productionConfigStatuses.find(item => Number(item.id) === id) : null;
  const payload = {
    name: document.querySelector('#production-status-name')?.value.trim() || '',
    style_key: document.querySelector('#production-status-style')?.value || 'waiting',
    position: Number(document.querySelector('#production-status-position')?.value || 0),
    is_active: id ? Boolean(existing?.is_active) : true
  };
  try {
    await apiRequest(id ? `/api/production/statuses/${id}` : '/api/production/statuses', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    clearStatusConfigForm();
    const editor = document.querySelector('#production-status-editor');
    if (editor) editor.open = false;
    await loadProductionConfigStatuses();
    await loadProductionStatuses();
    renderStatusOptions(defaultStatusCode());
    renderProductionItems({ permissions: productionAccess?.permissions || {} });
    showToast('Status salvo.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar o status.', true);
  }
}

async function deleteProductionStatus(statusId, statusName = '') {
  const label = statusName ? ` “${statusName}”` : '';
  if (!window.confirm(`Apagar o status${label}? Status já usado em lançamentos não pode ser apagado.`)) return;
  try {
    await apiRequest(`/api/production/statuses/${statusId}`, { method: 'DELETE' });
    clearStatusConfigForm();
    await loadProductionConfigStatuses();
    await loadProductionStatuses();
    renderStatusOptions(defaultStatusCode());
    renderProductionItems({ permissions: productionAccess?.permissions || {} });
    showToast('Status apagado.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível apagar o status.', true);
  }
}

async function initializeProductionPage() {
  const accessMessage = document.querySelector('#production-access-message');
  try {
    const unit = await loadProductionAccess();
    setProductionContext(unit);
    await refreshProductionPage(unit);
    if (!canFillProduction() && accessMessage) {
      accessMessage.hidden = false;
      accessMessage.textContent = 'Seu acesso à Produção Agrícola está em modo de consulta. O administrador pode liberar preenchimento na tela de usuários.';
    }
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

document.querySelector('#production-add-button')?.addEventListener('click', openNewProductionItem);
document.querySelector('.production-list-scope')?.addEventListener('click', async event => {
  const button = event.target.closest('[data-production-scope]');
  if (!button) return;
  try {
    await setProductionListScope(button.dataset.productionScope);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível trocar a visualização dos lançamentos.', true);
  }
});
document.querySelector('#production-entry-form')?.addEventListener('submit', submitProductionEntry);
document.querySelector('#production-group-input')?.addEventListener('change', () => renderEntryFronts());
document.querySelector('#production-sector-input')?.addEventListener('change', resolveSectorFromBase);
document.querySelector('#production-sector-input')?.addEventListener('blur', resolveSectorFromBase);
document.querySelector('#production-section-input')?.addEventListener('change', syncFarmFromSection);

document.querySelector('#production-status-options')?.addEventListener('change', event => {
  const input = event.target.closest('[data-production-status]');
  if (!input || !input.checked) return;
  document.querySelectorAll('[data-production-status]').forEach(other => {
    if (other !== input) other.checked = false;
  });
});

document.querySelector('#production-entry-form')?.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.target instanceof HTMLTextAreaElement) return;
  event.preventDefault();
  event.currentTarget.requestSubmit();
});

document.querySelector('#production-items-body')?.addEventListener('click', event => {
  const button = event.target.closest('[data-production-action]');
  if (!button) return;
  const itemId = Number(button.dataset.itemId);
  if (button.dataset.productionAction === 'edit') openEditProductionItem(itemId);
  if (button.dataset.productionAction === 'remove') removeProductionItem(itemId);
});

document.querySelector('#production-config-toggle')?.addEventListener('click', showConfigPane);
document.querySelector('#production-config-back')?.addEventListener('click', showEntryPane);
document.querySelector('#production-status-config-toggle')?.addEventListener('click', showStatusConfigPane);
document.querySelector('#production-status-config-back')?.addEventListener('click', showEntryPane);
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
    const configPane = document.querySelector('#production-config-pane');
    if (configPane && !configPane.hidden) {
      await loadProductionConfigCatalog();
      clearFrontConfigForm();
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível trocar a unidade.', true);
  }
});

initializeProductionPage();
