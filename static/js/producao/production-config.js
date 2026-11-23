// Produção Agrícola: cadastro de grupos, frentes/serviços e status (painéis de configuração).
// Carregado antes de producao/producao.js, que liga os eventos e inicializa a página.
let productionConfigCatalog = { groups: [] };
let productionEditingFrontUnits = [];
let productionEditingFrontActive = true;
let openProductionConfigGroups = null;

function renderConfigGroupOptions() {
  const select = document.querySelector('#production-config-front-group');
  if (!select) return;
  const groups = Array.isArray(productionConfigCatalog.groups) ? productionConfigCatalog.groups : [];
  select.innerHTML = groups.map(group => `<option value="${group.id}">${escapeHtml(group.name)}${group.is_active ? '' : ' · inativo'}</option>`).join('');
}

function productionConfigGroupSearch() {
  return productionConfigSearchText(document.querySelector('[data-catalog-search="groups"]')?.value || '');
}

function productionConfigSearchText(value) {
  return value.trim().normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
}

function renderProductionConfigGroups(revealGroupId = null) {
  const groups = Array.isArray(productionConfigCatalog.groups) ? productionConfigCatalog.groups : [];
  const groupList = document.querySelector('#production-groups-list');
  if (!groupList) return;
  const count = document.querySelector('[data-catalog-count="groups"]');
  if (count) count.textContent = String(groups.length);
  if (!openProductionConfigGroups) openProductionConfigGroups = new Set(groups.length ? [String(groups[0].id)] : []);
  if (revealGroupId != null) openProductionConfigGroups.add(String(revealGroupId));
  const term = productionConfigGroupSearch();
  const editable = canConfigureProduction();
  groupList.innerHTML = groups.map(group => {
    const fronts = group.fronts || [];
    const matchesGroup = productionConfigSearchText(group.name).includes(term);
    const visibleFronts = matchesGroup ? fronts : fronts.filter(front => productionConfigSearchText(front.name).includes(term));
    if (!matchesGroup && !visibleFronts.length) return '';
    const name = escapeHtml(group.name);
    return `<details class="catalog-group-card" data-catalog-group-id="${group.id}"${term || openProductionConfigGroups.has(String(group.id)) ? ' open' : ''}>
      <summary class="catalog-group-summary">
        <span class="catalog-group-chevron" aria-hidden="true"></span>
        <span class="catalog-group-title"><strong>${name}</strong><small>Ordem ${group.position}${group.is_active ? '' : ' · inativo'}</small></span>
        <span class="catalog-group-count">${fronts.length} ${fronts.length === 1 ? 'item' : 'itens'}</span>
      </summary>
      ${editable ? `<div class="catalog-group-actions">
        <button class="production-secondary-button" type="button" data-config-action="add-front" data-group-id="${group.id}">+ Adicionar frente ou serviço</button>
        <div class="production-config-list-actions">
          <button class="icon-edit-button" type="button" data-config-action="edit-group" data-group-id="${group.id}" title="Editar grupo" aria-label="Editar grupo ${name}">${PENCIL_ICON}</button>
          <button class="is-delete icon-delete-button" type="button" data-config-action="delete-group" data-group-id="${group.id}" data-group-name="${name}" title="Apagar grupo" aria-label="Apagar grupo ${name}">${TRASH_ICON}</button>
        </div>
      </div>` : ''}
      <div class="catalog-list catalog-group-fronts">${visibleFronts.length ? visibleFronts.map(front => renderProductionConfigFront(front, editable)).join('')
        : '<div class="production-empty">Nenhuma frente ou serviço cadastrado neste grupo para a unidade.</div>'}</div>
    </details>`;
  }).join('') || `<div class="production-empty">${term && groups.length ? 'Nenhum grupo, frente ou serviço encontrado.' : 'Nenhum grupo cadastrado.'}</div>`;
}

function renderProductionConfigFront(front, editable) {
  const name = escapeHtml(front.name);
  return `<div class="production-config-list-item ${front.is_active ? '' : 'is-inactive'}">
    <div class="production-config-list-item-copy"><strong>${name}</strong><span>${front.display_style === 'front' ? 'Frente operacional' : 'Operação / serviço'}${front.default_operations ? ` · Operações padrão ${escapeHtml(front.default_operations)}` : ''}${front.is_active ? '' : ' · Inativa'}</span></div>
    ${editable ? `<div class="production-config-list-actions">
      <button class="icon-edit-button" type="button" data-config-action="edit-front" data-front-id="${front.id}" title="Editar" aria-label="Editar ${name}">${PENCIL_ICON}</button>
      <button class="is-delete icon-delete-button" type="button" data-config-action="delete-front" data-front-id="${front.id}" data-front-name="${name}" title="Apagar" aria-label="Apagar ${name}">${TRASH_ICON}</button>
    </div>` : ''}
  </div>`;
}

function renderProductionConfigLists(revealGroupId) {
  renderConfigGroupOptions();
  renderProductionConfigGroups(revealGroupId);
}

async function loadProductionConfigCatalog(revealGroupId) {
  const unit = setProductionConfigUnit(selectedNavbarProductionUnit());
  const catalog = await apiRequest(`/api/production/catalog?unit=${encodeURIComponent(unit)}&include_inactive=1`);
  if (unit !== currentProductionUnit()) return;
  productionConfigCatalog = catalog;
  renderProductionConfigLists(revealGroupId);
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
  if (title) title.textContent = isEditing ? 'Editar frente / serviço' : 'Nova frente / serviço';
  const hint = document.querySelector('#production-config-front-name-hint');
  if (hint) hint.hidden = isEditing;
  if (editor && open) editor.open = true;
}

function clearFrontConfigForm({ keepOpen = false, groupId = null } = {}) {
  document.querySelector('#production-config-front-id').value = '';
  document.querySelector('#production-config-front-name').value = '';
  document.querySelector('#production-config-front-position').value = '0';
  document.querySelector('#production-config-front-style').value = 'operation';
  const defaultOperations = document.querySelector('#production-config-front-operations');
  if (defaultOperations) defaultOperations.value = '';
  productionEditingFrontActive = true;
  const unit = setProductionConfigUnit(selectedNavbarProductionUnit());
  productionEditingFrontUnits = unit ? [unit] : [];
  renderConfigGroupOptions();
  if (groupId != null) document.querySelector('#production-config-front-group').value = String(groupId);
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
  const defaultOperations = document.querySelector('#production-config-front-operations');
  if (defaultOperations) defaultOperations.value = front.default_operations || '';
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
    const saved = await apiRequest(id ? `/api/production/catalog/groups/${id}` : '/api/production/catalog/groups', {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(payload)
    });
    clearGroupConfigForm();
    const editor = document.querySelector('#production-group-editor');
    if (editor) editor.open = false;
    await loadProductionConfigCatalog(saved.group?.id);
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
    default_operations: document.querySelector('#production-config-front-operations')?.value.trim() || '',
    is_active: id ? productionEditingFrontActive : true,
    units
  };
  try {
    const saved = await apiRequest(id ? `/api/production/catalog/fronts/${id}` : '/api/production/catalog/fronts', {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(payload)
    });
    clearFrontConfigForm();
    const editor = document.querySelector('#production-front-editor');
    if (editor) editor.open = false;
    await loadProductionConfigCatalog(saved.front?.group_id ?? payload.group_id);
    await loadProductionCatalog(currentProductionUnit());
    renderEntryGroups();
    showToast(saved.front?.linked_existing
      ? 'Frente existente vinculada a esta unidade com o grupo e tipo originais. Os lançamentos permanecem separados.'
      : 'Frente/serviço salva.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar a frente/serviço.', true);
  }
}

async function deleteConfigGroup(groupId, groupName = '') {
  const label = groupName ? ` “${groupName}”` : '';
  if (!await askConfirmation({
    kicker: 'Configuração da Produção',
    title: `Apagar o grupo${label}?`,
    message: 'Só é possível apagar grupos sem frentes/serviços vinculados.',
    confirmLabel: 'Apagar grupo'
  })) return;
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
  if (!await askConfirmation({
    kicker: 'Configuração da Produção',
    title: `Apagar a frente/serviço${label}?`,
    message: 'Itens que já possuem lançamentos não podem ser apagados, para preservar o histórico.',
    confirmLabel: 'Apagar frente'
  })) return;
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

// As opções do campo "Grupo" vêm da definição única dos grupos de status.
function renderStatusGroupOptions() {
  const select = document.querySelector('#production-status-style');
  if (!select) return;
  const current = select.value;
  select.innerHTML = PRODUCTION_STATUS_GROUPS.map(group =>
    `<option value="${group.key}">● ${escapeHtml(group.name)}</option>`).join('');
  if (current) select.value = current;
}

async function loadProductionConfigStatuses() {
  productionConfigStatuses = await loadProductionStatuses({ includeInactive: true });
  renderStatusGroupOptions();
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
          <button class="icon-edit-button" type="button" data-status-action="edit" data-status-id="${status.id}" title="Editar" aria-label="Editar status ${escapeHtml(status.name)}">${PENCIL_ICON}</button>
          <button class="is-delete" type="button" data-status-action="delete" data-status-id="${status.id}" data-status-name="${escapeHtml(status.name)}" title="Apagar" aria-label="Apagar status ${escapeHtml(status.name)}">${TRASH_ICON}</button>
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
    renderStatusOptions();
    renderProductionItems({ permissions: productionAccess?.permissions || {} });
    showToast('Status salvo.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar o status.', true);
  }
}

async function deleteProductionStatus(statusId, statusName = '') {
  const label = statusName ? ` “${statusName}”` : '';
  if (!await askConfirmation({
    kicker: 'Configuração da Produção',
    title: `Excluir o status${label}?`,
    message: 'O status sai das opções de preenchimento. Os lançamentos e o histórico serão preservados.',
    confirmLabel: 'Excluir status'
  })) return;
  try {
    await apiRequest(`/api/production/statuses/${statusId}`, { method: 'DELETE' });
    clearStatusConfigForm();
    await loadProductionConfigStatuses();
    await loadProductionStatuses();
    renderStatusOptions();
    renderProductionItems({ permissions: productionAccess?.permissions || {} });
    showToast('Status apagado.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível apagar o status.', true);
  }
}

// Eventos dos cadastros (status, grupos e frentes/serviços) da página Cadastros.
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
