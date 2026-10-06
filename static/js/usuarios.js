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
  const actions = !isCurrent ? `
      <div class="user-actions">
        <button class="user-action" type="button" data-user-action="toggle" data-user-id="${escapeHtml(user.id)}" data-active="${isActive ? 'true' : 'false'}">${isActive ? 'Desativar' : 'Ativar'}</button>
        ${!isAdmin ? `
        <button class="user-action" type="button" data-user-action="password" data-user-id="${escapeHtml(user.id)}">Redefinir senha</button>
        <button class="user-delete" type="button" data-user-action="delete" data-user-id="${escapeHtml(user.id)}">Excluir</button>
        ` : ''}
      </div>
      ${!isAdmin ? `
      <form class="user-password-form" data-user-id="${escapeHtml(user.id)}" hidden>
        <input class="user-password-input" type="password" autocomplete="new-password" required placeholder="Nova senha" aria-label="Nova senha para ${escapeHtml(user.name || 'usuário')}" />
        <button class="user-action user-action-primary" type="submit">Salvar senha</button>
        <button class="user-action" type="button" data-user-action="cancel-password">Cancelar</button>
      </form>` : ''}` : '';
  return `
    <article class="user-list-item ${isActive ? '' : 'is-disabled'}" data-user-id="${escapeHtml(user.id)}">
      <div class="user-list-copy">
        <strong>${escapeHtml(user.name || 'Usuário')}${isCurrent ? ' · conectado' : ''}</strong>
        <span class="user-badges">
          <i class="user-role-badge ${isAdmin ? 'is-admin' : ''}">${roleLabel}</i>
          <i class="user-status-badge ${isActive ? 'is-active' : 'is-disabled'}">${isActive ? 'Ativo' : 'Desativado'}</i>
        </span>
        <span>Unidade base: ${escapeHtml(user.base_unit || 'PPT')}</span>
        <span>E-mail: ${escapeHtml(user.email || 'Não informado')}</span>
        <span>Cadastrado em ${escapeHtml(formatServerTimestamp(user.created_at))}</span>
      </div>
      ${actions}
    </article>`;
}

async function loadUsers() {
  const list = document.querySelector('#users-list');
  if (!list) return;
  if (currentUser?.role !== 'admin') {
    list.innerHTML = '<div class="history-empty">Acesso exclusivo do Administrador.</div>';
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
    const count = document.querySelector('#users-search-count');
    if (count) count.textContent = '';
  }
}

async function createQuickUser(event) {
  event.preventDefault();
  if (currentUser?.role !== 'admin') return;
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
  if (!name || !password) {
    updateStatus('Informe usuário e senha.', true);
    showToast('Informe usuário e senha.', true);
    return;
  }
  if (!['coordinator', 'analyst'].includes(role)) {
    const message = 'Selecione Coordenador ou Analista. Administradores não podem ser cadastrados por esta tela.';
    updateStatus(message, true);
    showToast(message, true);
    return;
  }
  if (submit) submit.disabled = true;
  updateStatus('Cadastrando usuário...');
  try {
    await apiRequest('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name, password, email, role, base_unit, is_active })
    });
    if (nameInput) nameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (emailInput) emailInput.value = '';
    if (roleInput) roleInput.value = 'analyst';
    if (activeInput) activeInput.value = 'active';
    updateStatus(`Usuário ${name} cadastrado com sucesso.`);
    showToast(`Conta de ${name} criada.`);
    nameInput?.focus();
    await loadUsers();
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
    showToast(error.message || 'Não foi possível excluir o usuário.');
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
    showToast(error.message || 'Não foi possível alterar o usuário.');
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
    showToast('Informe a nova senha.');
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
    showToast(error.message || 'Não foi possível redefinir a senha.');
  } finally {
    if (submit) submit.disabled = false;
  }
}

  document.querySelector('#quick-user-form')?.addEventListener('submit', createQuickUser);
  document.querySelector('#users-search')?.addEventListener('input', filterUsersList);
  document.querySelector('#users-list')?.addEventListener('click', event => {
    const button = event.target.closest('[data-user-action]');
    if (!button) return;
    const action = button.dataset.userAction;
    if (action === 'delete') deleteUserFromList(button);
    if (action === 'toggle') toggleUserActive(button);
    if (action === 'password') togglePasswordForm(button, true);
    if (action === 'cancel-password') togglePasswordForm(button, false);
  });
  document.querySelector('#users-list')?.addEventListener('submit', event => {
    const form = event.target.closest('.user-password-form');
    if (!form) return;
    event.preventDefault();
    resetUserPassword(form);
  });


loadUsers();
