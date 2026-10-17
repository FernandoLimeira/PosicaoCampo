function canViewUsers() {
  return currentUser?.role === 'admin' || (typeof moduleAccess !== 'undefined' && Boolean(moduleAccess.users?.view));
}

function canManageUsers() {
  return currentUser?.role === 'admin' || (typeof moduleAccess !== 'undefined' && Boolean(moduleAccess.users?.edit));
}

function normalizeUserSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function filterUsersList() {
  const input = document.querySelector('#users-search');
  const list = document.querySelector('#users-list');
  const count = document.querySelector('#users-search-count');
  const empty = document.querySelector('#users-search-empty');
  if (!list) return;

  const items = Array.from(list.querySelectorAll('.user-list-item'));
  const term = normalizeUserSearch(input?.value);
  let visible = 0;

  items.forEach(item => {
    const matches = !term || normalizeUserSearch(item.textContent).includes(term);
    item.hidden = !matches;
    if (matches) visible += 1;
  });

  if (count) {
    if (!items.length) count.textContent = '';
    else if (term) count.textContent = `${visible} de ${items.length} ${items.length === 1 ? 'usuário' : 'usuários'}`;
    else count.textContent = `${items.length} ${items.length === 1 ? 'usuário' : 'usuários'}`;
  }

  if (empty) empty.hidden = !term || visible > 0 || items.length === 0;
}

function userItemHtml(user) {
  const isCurrent = Number(user.id) === Number(currentUser?.id);
  const isAdmin = user.role === 'admin';
  if (isAdmin && !isCurrent) return '';
  const isActive = user.is_active !== false;
  const roleLabel = { admin: 'Administrador', coordinator: 'Coordenador', analyst: 'Analista', user: 'Usuário padrão' }[user.role] || 'Usuário padrão';
  const visibleModules = Object.values(user.module_access || {}).filter(access => access?.view).length;
  const actions = !isCurrent && !isAdmin ? `
      <div class="user-actions">
        <button class="user-action ${canManageUsers() ? 'user-action-primary' : ''}" type="button" data-user-action="access" data-user-id="${escapeHtml(user.id)}" aria-label="${canManageUsers() ? 'Gerenciar' : 'Consultar'} acessos de ${escapeHtml(user.name || 'usuário')}">${canManageUsers() ? 'Gerenciar acessos' : 'Consultar acessos'}</button>
        ${canManageUsers() ? `<button class="user-action" type="button" data-user-action="toggle" data-user-id="${escapeHtml(user.id)}" data-active="${isActive ? 'true' : 'false'}">${isActive ? 'Desativar' : 'Ativar'}</button>
        <button class="user-action" type="button" data-user-action="password" data-user-id="${escapeHtml(user.id)}">Redefinir senha</button>
        <button class="user-delete" type="button" data-user-action="delete" data-user-id="${escapeHtml(user.id)}">Excluir</button>
        ` : ''}
      </div>
      ${canManageUsers() ? `
      <form class="user-password-form" data-user-id="${escapeHtml(user.id)}" hidden>
        <input class="user-password-input" type="password" autocomplete="new-password" required placeholder="Nova senha" aria-label="Nova senha para ${escapeHtml(user.name || 'usuário')}" />
        <button class="user-action user-action-primary" type="submit">Salvar senha</button>
        <button class="user-action" type="button" data-user-action="cancel-password">Cancelar</button>
      </form>` : ''}` : '';
  return `
    <article class="user-list-item ${isActive ? '' : 'is-disabled'}" data-user-id="${escapeHtml(user.id)}" data-user-base-unit="${escapeHtml(user.base_unit || 'PPT')}">
      <div class="user-list-copy">
        <strong>${escapeHtml(user.name || 'Usuário')}${isCurrent ? ' · conectado' : ''}</strong>
        <span class="user-badges">
          <i class="user-role-badge ${isAdmin ? 'is-admin' : ''}">${roleLabel}</i>
          <i class="user-status-badge ${isActive ? 'is-active' : 'is-disabled'}">${isActive ? 'Ativo' : 'Desativado'}</i>
        </span>
        <span>Unidade base: ${escapeHtml(user.base_unit || 'PPT')}</span>
        <span>E-mail: ${escapeHtml(user.email || 'Não informado')}</span>
        ${!isAdmin ? `<span class="user-access-summary">${visibleModules} ${visibleModules === 1 ? 'módulo liberado' : 'módulos liberados'} · ${escapeHtml(user.access_summary || 'Produção Agrícola: sem acesso')}</span>` : ''}
      </div>
      ${actions}
    </article>`;
}

async function loadUsers() {
  const list = document.querySelector('#users-list');
  if (!list) return;
  if (!canViewUsers()) {
    list.innerHTML = '<div class="history-empty">Sem acesso ao módulo Usuários.</div>';
    return;
  }
  list.innerHTML = '<div class="history-loading">Carregando usuários...</div>';
  const count = document.querySelector('#users-search-count');
  const empty = document.querySelector('#users-search-empty');
  if (count) count.textContent = '';
  if (empty) empty.hidden = true;
  try {
    const data = await apiRequest('/api/users');
    const usersList = Array.isArray(data.users)
      ? data.users.filter(user => user.role !== 'admin' || Number(user.id) === Number(currentUser?.id))
      : [];
    list.innerHTML = usersList.length
      ? usersList.map(userItemHtml).join('')
      : '<div class="history-empty">Nenhum usuário cadastrado.</div>';
    filterUsersList();
  } catch (error) {
    console.error(error);
    list.innerHTML = `<div class="history-empty">${escapeHtml(error.message || 'Não foi possível carregar os usuários.')}</div>`;
    if (count) count.textContent = '';
  }
}

function collectModuleAccess(root) {
  const permissions = {};
  root.querySelectorAll('[data-module-view]').forEach(view => {
    const key = view.dataset.moduleView;
    const edit = root.querySelector(`[data-module-edit="${key}"]`);
    permissions[key] = { view: Boolean(view.checked), edit: Boolean(view.checked && edit?.checked) };
  });
  // Emissão global não é um controle de acesso individual.
  permissions.emission = { view: true, edit: false };
  return permissions;
}

function applyModuleAccess(root, access) {
  root.querySelectorAll('[data-module-view]').forEach(view => {
    const key = view.dataset.moduleView;
    view.checked = Boolean(access?.[key]?.view);
    const edit = root.querySelector(`[data-module-edit="${key}"]`);
    if (edit) edit.checked = Boolean(access?.[key]?.edit);
  });
  syncModuleAccessDisabled(root);
}

function syncModuleAccessDisabled(root) {
  if (!root) return;
  root.querySelectorAll('[data-module-view]').forEach(view => {
    const edit = root.querySelector(`[data-module-edit="${view.dataset.moduleView}"]`);
    if (edit) edit.disabled = !view.checked;
  });
}

// A navegação visual usa os mesmos campos persistidos; não cria um segundo estado de permissões.
function selectPermissionPanel(root, key = 'reports') {
  if (!root) return;
  const workspace = root.querySelector('[data-permission-workspace]');
  if (!workspace) return;
  const panels = Array.from(workspace.querySelectorAll('[data-permission-panel]'));
  if (!panels.some(panel => panel.dataset.permissionPanel === key)) key = 'reports';
  panels.forEach(panel => { panel.hidden = panel.dataset.permissionPanel !== key; });
  workspace.querySelectorAll('[data-permission-target]').forEach(button => {
    const active = button.dataset.permissionTarget === key;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const picker = workspace.querySelector('[data-permission-picker]');
  if (picker) picker.value = key;
}

function updatePermissionSummaries(root) {
  const workspace = root?.querySelector('[data-permission-workspace]');
  if (!workspace) return;
  workspace.querySelectorAll('[data-permission-count]').forEach(label => {
    const key = label.dataset.permissionCount;
    if (key === 'emission') { label.textContent = 'Liberado'; return; }
    if (key === 'production') {
      const enabled = Boolean(root.querySelector('[data-production-access-enabled]')?.checked);
      const quantity = enabled ? visibleProductionRows(root).length : 0;
      label.textContent = quantity ? `${quantity} ${quantity === 1 ? 'unidade' : 'unidades'}` : 'Sem acesso';
      return;
    }
    const panel = workspace.querySelector(`[data-permission-panel="${key}"]`);
    const quantity = Array.from(panel?.querySelectorAll('[data-module-view]') || []).filter(input => input.checked).length;
    label.textContent = quantity ? `${quantity} ${quantity === 1 ? 'função' : 'funções'}` : 'Sem acesso';
  });
}

function focusPermissionMenu(root) {
  const mobile = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 680px)').matches;
  root.querySelector(mobile ? '[data-permission-picker]' : '[data-permission-target="reports"]')?.focus();
}

function setCreateStep(form, step, focus = false) {
  if (!form) return;
  const active = step === 'permissions' ? 'permissions' : 'identity';
  form.querySelectorAll('[data-user-step]').forEach(panel => { panel.hidden = panel.dataset.userStep !== active; });
  form.querySelectorAll('[data-user-step-button]').forEach(button => {
    const selected = button.dataset.userStepButton === active;
    button.classList.toggle('is-active', selected);
    if (selected) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  const next = form.querySelector('[data-user-step-next]');
  const back = form.querySelector('[data-user-step-back]');
  const submit = form.querySelector('#create-user-button');
  if (next) next.hidden = active !== 'identity';
  if (back) back.hidden = active !== 'permissions';
  if (submit) submit.hidden = active !== 'permissions';
  const help = form.querySelector('[data-user-step-help]');
  if (help) help.textContent = active === 'identity' ? 'Etapa 1 de 2 · Dados da conta' : 'Etapa 2 de 2 · Permissões por módulo';
  if (focus) {
    if (active === 'identity') form.querySelector('#quick-user-name')?.focus();
    else focusPermissionMenu(form);
  }
}

function validateCreateFields(form) {
  const invalid = Array.from(form.querySelectorAll('.user-create-fields input, .user-create-fields select'))
    .find(input => typeof input.checkValidity === 'function' && !input.checkValidity());
  if (!invalid) return true;
  setCreateStep(form, 'identity');
  invalid.focus();
  invalid.reportValidity();
  return false;
}

const PRODUCTION_UNITS = ['PPT', 'NRD', 'RBR', 'PST'];

function visibleProductionRows(root) {
  return Array.from(root.querySelectorAll('[data-production-unit-row]')).filter(row => !row.hidden);
}

function updateProductionPicker(root) {
  const picker = root.querySelector('[data-production-unit-picker]');
  if (!picker) return;
  picker.querySelectorAll('option').forEach(option => {
    option.disabled = !root.querySelector(`[data-production-unit-row="${option.value}"]`)?.hidden;
  });
  if (!picker.value || picker.selectedOptions[0]?.disabled) {
    picker.value = PRODUCTION_UNITS.find(code => root.querySelector(`[data-production-unit-row="${code}"]`)?.hidden) || '';
  }
  const add = root.querySelector('[data-production-add-unit]');
  if (add) add.disabled = !picker.value || !PRODUCTION_UNITS.some(code => root.querySelector(`[data-production-unit-row="${code}"]`)?.hidden);
  const empty = root.querySelector('[data-production-unit-empty]');
  if (empty) empty.hidden = visibleProductionRows(root).length !== 0;
}

function toggleProductionUnit(root, unit, active, flags = null) {
  if (!PRODUCTION_UNITS.includes(unit)) return;
  const row = root.querySelector(`[data-production-unit-row="${unit}"]`);
  if (!row) return;
  row.hidden = !active;
  if (flags) {
    row.querySelector('[data-production-unit-fill]').checked = Boolean(flags.fill);
    row.querySelector('[data-production-unit-summary]').checked = Boolean(flags.summary);
  }
  updateProductionPicker(root);
  syncProductionAccessDisabled(root);
  updatePermissionSummaries(root);
}

function markProductionBaseUnit(root, unit) {
  root.dataset.baseUnit = unit;
  root.querySelectorAll('[data-production-unit-row]').forEach(row => {
    const label = row.querySelector('[data-unit-base-label]');
    if (label) label.hidden = row.dataset.productionUnitRow !== unit;
  });
}

function initializeProductionUnits(root, unit = 'PPT') {
  markProductionBaseUnit(root, unit);
  root.querySelectorAll('[data-production-unit-row]').forEach(row => {
    row.hidden = true;
    row.querySelector('[data-production-unit-fill]').checked = true;
    row.querySelector('[data-production-unit-summary]').checked = true;
  });
  toggleProductionUnit(root, unit, true, { fill: true, summary: true });
}

function collectProductionAccess(root = document) {
  const master = root.querySelector('[data-production-access-enabled]');
  if (!master) return null;
  const enabled = Boolean(master.checked);
  const unit_permissions = {};
  if (enabled) visibleProductionRows(root).forEach(row => {
    unit_permissions[row.dataset.productionUnitRow] = {
      view: true,
      fill: Boolean(row.querySelector('[data-production-unit-fill]')?.checked),
      summary: Boolean(row.querySelector('[data-production-unit-summary]')?.checked)
    };
  });
  return { enabled,
    permissions: {
      view: enabled,
      fill: Object.values(unit_permissions).some(item => item.fill),
      summary: Object.values(unit_permissions).some(item => item.summary),
      configure: enabled && Boolean(root.querySelector('[data-production-access-configure]')?.checked),
    },
    units: Object.keys(unit_permissions), unit_permissions };
}

function validateProductionAccess(access) {
  if (!access?.enabled) return;
  if (!access.units.length) throw new Error('Adicione ao menos uma unidade para a Produção Agrícola.');
  if (access.permissions.configure && access.units.length !== 4) throw new Error('A configuração global exige as quatro unidades.');
}

function syncProductionAccessDisabled(root = document) {
  if (!root) return;
  const enabled = Boolean(root.querySelector('[data-production-access-enabled]')?.checked);
  root.querySelectorAll('[data-production-access-configure], [data-production-unit-picker], [data-production-add-unit], [data-production-unit-fill], [data-production-unit-summary], [data-production-remove-unit]').forEach(input => {
    input.disabled = !enabled;
  });
  if (enabled) updateProductionPicker(root);
}

function resetCreateUserForm(form) {
  if (!form) return;
  form.reset();
  // Recria somente a unidade base; evita herdar unidades de outro cadastro.
  initializeProductionUnits(form, form.querySelector('#quick-user-base-unit')?.value || 'PPT');
  syncProductionAccessDisabled(form);
  // Nunca conceder gerenciamento de usuários como padrão; gestores delegados
  // iniciam com os próprios limites, sem possibilidade de escalada.
  form.querySelectorAll('[data-module-view]').forEach(view => {
    const key = view.dataset.moduleView;
    if (key === 'users') view.checked = false;
    else if (currentUser?.role !== 'admin' && typeof moduleAccess !== 'undefined') view.checked = Boolean(moduleAccess[key]?.view);
    const edit = form.querySelector(`[data-module-edit="${key}"]`);
    if (edit && (key === 'users' || currentUser?.role !== 'admin')) {
      edit.checked = key !== 'users' && Boolean(typeof moduleAccess !== 'undefined' && moduleAccess[key]?.edit);
    }
  });
  if (currentUser?.role !== 'admin') {
    const master = form.querySelector('[data-production-access-enabled]');
    if (master) master.checked = false;
    syncProductionAccessDisabled(form);
  }
  syncModuleAccessDisabled(form);
  selectPermissionPanel(form, 'reports');
  setCreateStep(form, 'identity');
  updatePermissionSummaries(form);
  const status = document.querySelector('#user-create-status');
  if (status) {
    status.textContent = '';
    status.classList.remove('is-error');
  }
}

function openCreateUserModal() {
  if (!canManageUsers()) return;
  const form = document.querySelector('#quick-user-form');
  if (!form) return;
  resetCreateUserForm(form);
  openModal('user-create-modal');
  requestAnimationFrame(() => document.querySelector('#quick-user-name')?.focus());
}

async function createQuickUser(event) {
  event.preventDefault();
  if (!canManageUsers()) return;
  const form = document.querySelector('#quick-user-form');
  const nameInput = document.querySelector('#quick-user-name');
  const passwordInput = document.querySelector('#quick-user-password');
  const emailInput = document.querySelector('#quick-user-email');
  const roleInput = document.querySelector('#quick-user-role');
  const baseUnitInput = document.querySelector('#quick-user-base-unit');
  const activeInput = document.querySelector('#quick-user-active');
  const submit = document.querySelector('#create-user-button');
  const status = document.querySelector('#user-create-status');
  if (submit?.disabled) return;
  const updateStatus = (message, error = false) => {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', error);
  };
  const name = nameInput?.value.trim() || '';
  const password = passwordInput?.value || '';
  const email = emailInput?.value.trim() || '';
  const role = roleInput?.value || 'analyst';
  const base_unit = baseUnitInput?.value || 'PPT';
  const is_active = activeInput?.value !== 'inactive';
  const production_access = collectProductionAccess(form);
  const module_access = collectModuleAccess(form);
  if (!name || !password) {
    setCreateStep(form, 'identity');
    updateStatus('Informe usuário e senha.', true);
    showToast('Informe usuário e senha.', true);
    return;
  }
  if (!['coordinator', 'analyst'].includes(role)) {
    const message = 'Selecione Coordenador ou Analista. Administradores não podem ser cadastrados por esta tela.';
    setCreateStep(form, 'identity');
    updateStatus(message, true);
    showToast(message, true);
    return;
  }
  if (!validateCreateFields(form)) {
    updateStatus('Confira os dados da conta antes de continuar.', true);
    return;
  }
  // Enter na primeira etapa avança; nunca cadastra sem a revisão das permissões.
  if (form.querySelector('[data-user-step="identity"]')?.hidden === false) {
    setCreateStep(form, 'permissions', true);
    return;
  }
  try {
    validateProductionAccess(production_access);
  } catch (error) {
    setCreateStep(form, 'permissions');
    selectPermissionPanel(form, 'production');
    updateStatus(error.message, true);
    showToast(error.message, true);
    return;
  }
  if (submit) submit.disabled = true;
  updateStatus('Cadastrando usuário...');
  try {
    await apiRequest('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name, password, email, role, base_unit, is_active, production_access, module_access })
    });
    resetCreateUserForm(form);
    updateStatus(`Usuário ${name} cadastrado com sucesso.`);
    showToast(`Conta de ${name} criada.`);
    await loadUsers();
    closeModal('user-create-modal');
    document.querySelector('#open-user-create')?.focus();
  } catch (error) {
    console.error(error);
    const message = error.message || 'Não foi possível criar a conta.';
    updateStatus(message, true);
    showToast(message, true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function deleteUserFromList(button) {
  const userId = Number(button?.dataset.userId);
  if (!Number.isInteger(userId) || userId <= 0) return;
  const item = button.closest('.user-list-item');
  const name = item?.querySelector('strong')?.textContent?.replace(' · conectado', '') || 'este usuário';
  if (!window.confirm(`Excluir ${name}?`)) return;
  button.disabled = true;
  try {
    await apiRequest(`/api/users/${userId}`, { method: 'DELETE' });
    showToast('Usuário excluído.');
    await loadUsers();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível excluir o usuário.', true);
    button.disabled = false;
  }
}

async function toggleUserActive(button) {
  const userId = Number(button?.dataset.userId);
  if (!Number.isInteger(userId) || userId <= 0) return;
  const currentlyActive = button.dataset.active === 'true';
  button.disabled = true;
  try {
    await apiRequest(`/api/users/${userId}/active`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !currentlyActive })
    });
    showToast(currentlyActive ? 'Usuário desativado.' : 'Usuário ativado.');
    await loadUsers();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível alterar o usuário.', true);
    button.disabled = false;
  }
}

function togglePasswordForm(button, visible) {
  const item = button.closest('.user-list-item');
  const form = item?.querySelector('.user-password-form');
  if (!form) return;
  form.hidden = !visible;
  if (visible) form.querySelector('.user-password-input')?.focus();
  else {
    const input = form.querySelector('.user-password-input');
    if (input) input.value = '';
  }
}

async function resetUserPassword(form) {
  const userId = Number(form?.dataset.userId);
  const input = form?.querySelector('.user-password-input');
  const password = input?.value || '';
  if (!Number.isInteger(userId) || userId <= 0) return;
  if (!password) {
    showToast('Informe a nova senha.', true);
    input?.focus();
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  try {
    await apiRequest(`/api/users/${userId}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password })
    });
    showToast('Senha redefinida. O usuário deverá entrar novamente.');
    if (input) input.value = '';
    form.hidden = true;
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível redefinir a senha.', true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

function applyAccessToForm(form, access, baseUnit = 'PPT') {
  applyModuleAccess(form, access?.modules);
  const production = access?.production;
  const master = form.querySelector('[data-production-access-enabled]');
  const configure = form.querySelector('[data-production-access-configure]');
  if (master) master.checked = Boolean(production?.enabled);
  if (configure) configure.checked = Boolean(production?.permissions?.configure);
  markProductionBaseUnit(form, baseUnit);
  const unitPermissions = production?.unit_permissions || Object.fromEntries((production?.units || []).map(unit =>
    [unit, { view: true, fill: Boolean(production?.permissions?.fill), summary: Boolean(production?.permissions?.summary) }]));
  form.querySelectorAll('[data-production-unit-row]').forEach(row => {
    row.hidden = true;
  });
  Object.entries(unitPermissions).forEach(([unit, flags]) => toggleProductionUnit(form, unit, true, flags));
  updateProductionPicker(form);
  syncProductionAccessDisabled(form);
  updatePermissionSummaries(form);
}

let accessRequestId = 0;

async function openAccessModal(button) {
  const userId = Number(button?.dataset.userId);
  const item = button.closest('.user-list-item');
  const modal = document.querySelector('#user-access-modal');
  const form = document.querySelector('#user-access-form');
  const loading = document.querySelector('#user-access-loading');
  const save = document.querySelector('#user-access-save');
  if (!userId || !item || !modal || !form || !loading || !save) return;
  const requestId = ++accessRequestId;
  document.querySelector('#user-access-modal-name').textContent = item.querySelector('.user-list-copy strong')?.textContent || 'usuário';
  document.querySelector('#user-access-status').textContent = '';
  form.dataset.userAccessForm = String(userId);
  form.hidden = true;
  save.disabled = true;
  loading.hidden = false;
  loading.textContent = 'Carregando acessos...';
  openModal('user-access-modal');
  try {
    const data = await apiRequest(`/api/users/${userId}/access`);
    if (requestId !== accessRequestId || modal.hidden) return;
    applyAccessToForm(form, data.access, item.dataset.userBaseUnit || 'PPT');
    selectPermissionPanel(form, 'reports');
    form.hidden = false;
    loading.hidden = true;
    save.hidden = !canManageUsers();
    save.disabled = !canManageUsers();
    // Somente ações de alteração são bloqueadas; consulta deve permitir mudar de módulo.
    if (!canManageUsers()) {
      form.querySelectorAll('input, select, button').forEach(input => {
        if (!input.matches('[data-permission-target], [data-permission-picker]')) input.disabled = true;
      });
    }
    focusPermissionMenu(form);
  } catch (error) {
    if (requestId !== accessRequestId || modal.hidden) return;
    console.error(error);
    loading.textContent = error.message || 'Não foi possível carregar os acessos.';
  }
}

async function saveAccessForm(form) {
  const userId = Number(form?.dataset.userAccessForm);
  if (!userId) return;
  const requestId = accessRequestId;
  const access = { modules: collectModuleAccess(form), production: collectProductionAccess(form) };
  const save = document.querySelector('#user-access-save');
  const status = document.querySelector('#user-access-status');
  if (save?.disabled) return;
  try {
    validateProductionAccess(access.production);
    if (save) save.disabled = true;
    if (status) status.textContent = 'Salvando acessos...';
    await apiRequest(`/api/users/${userId}/access`, {
      method: 'PUT',
      body: JSON.stringify({ access })
    });
    showToast('Acessos atualizados.');
    if (requestId === accessRequestId) closeModal('user-access-modal');
    await loadUsers();
  } catch (error) {
    console.error(error);
    const message = error.message || 'Não foi possível salvar os acessos.';
    if (status && requestId === accessRequestId) status.textContent = message;
    showToast(message, true);
  } finally {
    if (save && requestId === accessRequestId) save.disabled = false;
  }
}

document.querySelector('#quick-user-form')?.addEventListener('submit', createQuickUser);
document.querySelector('#open-user-create')?.addEventListener('click', openCreateUserModal);
document.querySelector('#users-search')?.addEventListener('input', filterUsersList);
document.querySelector('#quick-user-base-unit')?.addEventListener('change', event => {
  const form = document.querySelector('#quick-user-form');
  const previous = form.dataset.baseUnit;
  const onlyPrevious = visibleProductionRows(form).length === 1 && !form.querySelector(`[data-production-unit-row="${previous}"]`)?.hidden;
  if (onlyPrevious) toggleProductionUnit(form, previous, false);
  markProductionBaseUnit(form, event.target.value);
  toggleProductionUnit(form, event.target.value, true);
});

document.querySelector('#users-list')?.addEventListener('click', event => {
  const button = event.target.closest('[data-user-action]');
  if (!button) return;
  const action = button.dataset.userAction;
  if (action === 'delete') deleteUserFromList(button);
  if (action === 'toggle') toggleUserActive(button);
  if (action === 'password') togglePasswordForm(button, true);
  if (action === 'cancel-password') togglePasswordForm(button, false);
  if (action === 'access') openAccessModal(button);
});

// Os dois formulários compartilham navegação, eventos e lógica de permissões.
for (const selector of ['#quick-user-form', '#user-access-form']) {
  const form = document.querySelector(selector);
  form?.addEventListener('change', event => {
    if (event.target.matches('[data-production-access-enabled]')) syncProductionAccessDisabled(form);
    if (event.target.matches('[data-module-view]')) syncModuleAccessDisabled(form);
    if (event.target.matches('[data-permission-picker]')) selectPermissionPanel(form, event.target.value);
    updatePermissionSummaries(form);
  });
  form?.addEventListener('click', event => {
    const nav = event.target.closest('[data-permission-target]');
    const step = event.target.closest('[data-user-step-button]');
    const add = event.target.closest('[data-production-add-unit]');
    const remove = event.target.closest('[data-production-remove-unit]');
    if (nav) selectPermissionPanel(form, nav.dataset.permissionTarget);
    if (step) {
      if (step.dataset.userStepButton === 'permissions' && !validateCreateFields(form)) return;
      setCreateStep(form, step.dataset.userStepButton);
    }
    if (event.target.closest('[data-user-step-next]')) {
      if (validateCreateFields(form)) setCreateStep(form, 'permissions', true);
    }
    if (event.target.closest('[data-user-step-back]')) setCreateStep(form, 'identity', true);
    if (add) toggleProductionUnit(form, form.querySelector('[data-production-unit-picker]')?.value, true,
      { fill: true, summary: true });
    if (remove) toggleProductionUnit(form, remove.closest('[data-production-unit-row]')?.dataset.productionUnitRow, false);
  });
}

document.querySelector('#user-access-form')?.addEventListener('submit', event => {
  event.preventDefault();
  saveAccessForm(event.currentTarget);
});

document.querySelector('#users-list')?.addEventListener('submit', event => {
  const passwordForm = event.target.closest('.user-password-form');
  if (passwordForm) {
    event.preventDefault();
    resetUserPassword(passwordForm);
  }
});

initializeProductionUnits(document.querySelector('#quick-user-form'), document.querySelector('#quick-user-base-unit')?.value || 'PPT');
syncModuleAccessDisabled(document.querySelector('#quick-user-form'));
loadUsers();

// Mantém links antigos de cadastro funcionais sem restaurar uma segunda tela.
if (new URLSearchParams(window.location.search).get('novo') === '1') {
  openCreateUserModal();
  const url = new URL(window.location.href);
  url.searchParams.delete('novo');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
