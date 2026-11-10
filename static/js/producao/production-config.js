// Produção Agrícola: cadastro de grupos, frentes/serviços e status (painéis de configuração).
// Carregado antes de producao/producao.js, que liga os eventos e inicializa a página.
let productionConfigCatalog = { groups: [] };
let productionEditingFrontUnits = [];
let productionEditingFrontActive = true;

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
          <button class="icon-edit-button" type="button" data-config-action="edit-group" data-group-id="${group.id}" title="Editar" aria-label="Editar grupo ${escapeHtml(group.name)}">${PENCIL_ICON}</button>
          <button class="is-delete" type="button" data-config-action="delete-group" data-group-id="${group.id}" data-group-name="${escapeHtml(group.name)}" title="Apagar" aria-label="Apagar grupo ${escapeHtml(group.name)}">${TRASH_ICON}</button>
        </div>
      </div>`).join('') || '<div class="production-empty"><span>Nenhum grupo cadastrado.</span></div>';
  }
  if (frontList) {
    const fronts = groups.flatMap(group => (group.fronts || []).map(front => ({ ...front, group_name: group.name })));
    frontList.innerHTML = fronts.map(front => `
      <div class="production-config-list-item ${front.is_active ? '' : 'is-inactive'}">
        <div class="production-config-list-item-copy"><strong>${escapeHtml(front.name)}</strong><span>${escapeHtml(front.group_name)} · ${front.display_style === 'front' ? 'frente' : 'operação'}${front.is_active ? '' : ' · inativa'}</span></div>
        <div class="production-config-list-actions">
          <button class="icon-edit-button" type="button" data-config-action="edit-front" data-front-id="${front.id}" title="Editar" aria-label="Editar frente ${escapeHtml(front.name)}">${PENCIL_ICON}</button>
          <button class="is-delete" type="button" data-config-action="delete-front" data-front-id="${front.id}" data-front-name="${escapeHtml(front.name)}" title="Apagar" aria-label="Apagar frente ${escapeHtml(front.name)}">${TRASH_ICON}</button>
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
    const saved = await apiRequest(id ? `/api/production/catalog/fronts/${id}` : '/api/production/catalog/fronts', {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(payload)
    });
    clearFrontConfigForm();
    const editor = document.querySelector('#production-front-editor');
    if (editor) editor.open = false;
    await loadProductionConfigCatalog();
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
    refreshProductionSectorStatuses();
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
    refreshProductionSectorStatuses();
    renderProductionItems({ permissions: productionAccess?.permissions || {} });
    showToast('Status apagado.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível apagar o status.', true);
  }
}
