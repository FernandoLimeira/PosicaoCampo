// Página "Cadastros" da Produção Agrícola (menu lateral): grupos, frentes/serviços,
// status e operações. Grupos, frentes e status usam producao/production-config.js;
// aqui ficam a abertura da página e o cadastro de operações (código da O.S.).
let productionOperations = [];

function productionCatalogPageActive() {
  return String(globalThis.location?.pathname || '').startsWith('/producao/cadastros');
}

function operationFrontOptions(selected = '') {
  const groups = Array.isArray(productionConfigCatalog.groups) ? productionConfigCatalog.groups : [];
  return '<option value="">Sem vínculo</option>' + groups.map(group => `<optgroup label="${escapeHtml(group.name)}">${
    (group.fronts || []).map(front => `<option value="${front.id}" ${String(front.id) === String(selected) ? 'selected' : ''}>${escapeHtml(front.name)}</option>`).join('')
  }</optgroup>`).join('');
}

function renderProductionOperations() {
  const list = document.querySelector('#production-operations-list');
  if (!list) return;
  const visible = productionOperations;
  const editable = canConfigureProduction();
  list.innerHTML = visible.map(item => `
    <div class="production-config-list-item ${item.is_active ? '' : 'is-inactive'}">
      <div class="production-config-list-item-copy">
        <strong>${escapeHtml(item.code)} — ${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.front_name || 'Sem frente vinculada')}${item.in_use ? ' · em uso' : ''}${item.is_active ? '' : ' · inativa'}</span>
      </div>
      ${editable ? `<div class="production-config-list-actions">
        <button class="icon-edit-button" type="button" data-operation-action="edit" data-operation-id="${item.id}" title="Editar" aria-label="Editar operação ${escapeHtml(item.code)}">${PENCIL_ICON}</button>
        <button class="is-delete icon-delete-button" type="button" data-operation-action="delete" data-operation-id="${item.id}" title="Apagar" aria-label="Apagar operação ${escapeHtml(item.code)}">${TRASH_ICON}</button>
      </div>` : ''}
    </div>`).join('') || '<div class="production-empty"><span>Nenhuma operação cadastrada. Importe as O.S. ou cadastre manualmente.</span></div>';
}

async function loadProductionOperations() {
  const data = await apiRequest('/api/production/operations?include_inactive=1');
  productionOperations = Array.isArray(data?.operations) ? data.operations : [];
  renderProductionOperations();
}

function clearOperationForm({ keepOpen = false } = {}) {
  document.querySelector('#production-operation-form')?.reset();
  document.querySelector('#production-operation-id').value = '';
  const front = document.querySelector('#production-operation-front');
  if (front) front.innerHTML = operationFrontOptions();
  document.querySelector('#production-operation-editor-title').textContent = 'Nova operação';
  document.querySelector('#production-operation-submit').textContent = 'Adicionar operação';
  const editor = document.querySelector('#production-operation-editor');
  if (editor && !keepOpen) editor.open = false;
}

function editProductionOperation(operationId) {
  const item = productionOperations.find(operation => Number(operation.id) === Number(operationId));
  if (!item) return;
  document.querySelector('#production-operation-id').value = item.id;
  document.querySelector('#production-operation-code').value = item.code;
  document.querySelector('#production-operation-name').value = item.name;
  document.querySelector('#production-operation-front').innerHTML = operationFrontOptions(item.service_front_id ?? '');
  document.querySelector('#production-operation-position').value = item.position;
  document.querySelector('#production-operation-active').checked = item.is_active;
  document.querySelector('#production-operation-editor-title').textContent = `Editar operação ${item.code}`;
  document.querySelector('#production-operation-submit').textContent = 'Salvar alterações';
  const editor = document.querySelector('#production-operation-editor');
  if (editor) editor.open = true;
  document.querySelector('#production-operation-name')?.focus();
}

async function submitProductionOperation(event) {
  event.preventDefault();
  const id = document.querySelector('#production-operation-id').value;
  const payload = {
    code: document.querySelector('#production-operation-code').value.trim(),
    name: document.querySelector('#production-operation-name').value.trim(),
    service_front_id: document.querySelector('#production-operation-front').value || null,
    position: Number(document.querySelector('#production-operation-position').value || 0),
    is_active: document.querySelector('#production-operation-active').checked
  };
  try {
    await apiRequest(id ? `/api/production/operations/${id}` : '/api/production/operations', {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(payload)
    });
    showToast(id ? 'Operação atualizada.' : 'Operação cadastrada.');
    clearOperationForm();
    await loadProductionOperations();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar a operação.', true);
  }
}

async function deleteProductionOperation(operationId) {
  const item = productionOperations.find(operation => Number(operation.id) === Number(operationId));
  if (!item || !await askConfirmation({
    kicker: 'Cadastros', title: `Apagar a operação ${item.code}?`,
    message: 'Operações já usadas em lançamentos não podem ser apagadas; nesse caso, inative-as.',
    confirmLabel: 'Apagar operação'
  })) return;
  try {
    await apiRequest(`/api/production/operations/${item.id}`, { method: 'DELETE' });
    showToast('Operação apagada.');
    await loadProductionOperations();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível apagar a operação.', true);
  }
}

async function initializeProductionCatalogPage() {
  const editable = canConfigureProduction();
  const readonly = document.querySelector('#production-catalog-readonly');
  if (readonly) readonly.hidden = editable;
  // Sem a configuração global, a página só consulta: os formulários ficam ocultos.
  document.querySelectorAll('.catalog-editor, #production-catalog-panel .catalog-new')
    .forEach(element => { element.hidden = !editable; });
  document.querySelector('#production-catalog-panel')?.classList.toggle('is-readonly', !editable);
  const tasks = [loadProductionOperations()];
  if (editable) {
    tasks.push(loadProductionConfigCatalog().then(() => {
      clearGroupConfigForm();
      clearFrontConfigForm();
      clearOperationForm();
      renderProductionOperations();
    }));
    tasks.push(loadProductionConfigStatuses().then(() => clearStatusConfigForm()));
  } else {
    productionConfigCatalog = productionCatalog;
    renderProductionConfigLists();
    productionConfigStatuses = productionStatuses;
    renderProductionStatusConfigList();
  }
  const results = await Promise.allSettled(tasks);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) showToast(failed.reason?.message || 'Não foi possível carregar os cadastros.', true);
}

document.querySelector('#production-operation-form')?.addEventListener('submit', submitProductionOperation);
document.querySelector('#production-operation-clear')?.addEventListener('click', () => clearOperationForm());
document.querySelector('#production-operations-list')?.addEventListener('click', event => {
  const button = event.target.closest('[data-operation-action]');
  if (!button) return;
  if (button.dataset.operationAction === 'edit') editProductionOperation(button.dataset.operationId);
  if (button.dataset.operationAction === 'delete') deleteProductionOperation(button.dataset.operationId);
});
// ---- Abas, contadores, busca e botão "Novo" -------------------------------
const CATALOG_TAB_KEY = 'posicao-campo-production-catalog-tab';
const CATALOG_EDITOR_IDS = {
  groups: '#production-group-editor', fronts: '#production-front-editor',
  operations: '#production-operation-editor', status: '#production-status-editor'
};
const CATALOG_NEW_ACTIONS = {
  groups: () => clearGroupConfigForm({ keepOpen: true }),
  fronts: () => clearFrontConfigForm({ keepOpen: true }),
  operations: () => clearOperationForm({ keepOpen: true }),
  status: () => clearStatusConfigForm({ keepOpen: true })
};

function selectCatalogTab(tab) {
  if (!document.querySelector(`[data-catalog-section="${tab}"]`)) tab = 'groups';
  document.querySelectorAll('[data-catalog-tab]').forEach(button => {
    const active = button.dataset.catalogTab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-catalog-section]').forEach(section => { section.hidden = section.dataset.catalogSection !== tab; });
  try { localStorage.setItem(CATALOG_TAB_KEY, tab); } catch (_) { /* preferência opcional */ }
}

// Busca simples sobre os itens já desenhados de cada lista.
function applyCatalogSearch(key) {
  const term = String(document.querySelector(`[data-catalog-search="${key}"]`)?.value || '').trim().toLocaleLowerCase('pt-BR');
  const list = document.querySelector(`[data-catalog-list="${key}"]`);
  if (!list) return;
  let visible = 0;
  list.querySelectorAll('.production-config-list-item').forEach(item => {
    const match = !term || item.textContent.toLocaleLowerCase('pt-BR').includes(term);
    item.hidden = !match;
    if (match) visible += 1;
  });
  let empty = list.querySelector('.catalog-search-empty');
  if (term && !visible && list.querySelector('.production-config-list-item')) {
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'production-empty catalog-search-empty';
      empty.textContent = 'Nada encontrado nesta busca.';
      list.appendChild(empty);
    }
  } else {
    empty?.remove();
  }
}

function updateCatalogCount(key) {
  const count = document.querySelector(`[data-catalog-count="${key}"]`);
  const list = document.querySelector(`[data-catalog-list="${key}"]`);
  if (count && list) count.textContent = String(list.querySelectorAll('.production-config-list-item').length);
}

if (productionCatalogPageActive()) {
  document.addEventListener('production-page-ready', initializeProductionCatalogPage);
  let savedTab = 'groups';
  try { savedTab = localStorage.getItem(CATALOG_TAB_KEY) || 'groups'; } catch (_) { /* sem armazenamento */ }
  selectCatalogTab(savedTab);
  document.querySelectorAll('[data-catalog-tab]').forEach(button => {
    button.addEventListener('click', () => selectCatalogTab(button.dataset.catalogTab));
  });
  document.querySelectorAll('[data-catalog-search]').forEach(input => {
    input.addEventListener('input', () => applyCatalogSearch(input.dataset.catalogSearch));
  });
  document.querySelectorAll('[data-catalog-new]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.catalogNew;
      CATALOG_NEW_ACTIONS[key]?.();
      const editor = document.querySelector(CATALOG_EDITOR_IDS[key]);
      if (editor) editor.open = true;
      editor?.querySelector('input:not([type="hidden"]), select')?.focus();
    });
  });
  // Formulários de "Novo"/"Editar" abrem como popup simples: fecha no ×, no Esc ou fora do quadro.
  const CANCEL_BUTTONS = {
    'production-group-editor': '#production-group-clear', 'production-front-editor': '#production-front-clear',
    'production-operation-editor': '#production-operation-clear', 'production-status-editor': '#production-status-clear'
  };
  const closeCatalogEditor = editor => {
    document.querySelector(CANCEL_BUTTONS[editor.id])?.click();
    editor.open = false;
  };
  document.querySelectorAll('.catalog-editor').forEach(editor => {
    // O popup fica direto no <body> para cobrir a tela inteira (fora das seções da página).
    document.body.appendChild(editor);
    const summary = editor.querySelector('summary');
    summary?.setAttribute('role', 'heading');
    summary?.addEventListener('click', event => event.preventDefault());
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'catalog-editor-close';
    close.setAttribute('aria-label', 'Fechar');
    close.textContent = '×';
    close.addEventListener('click', event => { event.preventDefault(); closeCatalogEditor(editor); });
    summary?.appendChild(close);
    editor.addEventListener('mousedown', event => { if (event.target === editor) closeCatalogEditor(editor); });
    editor.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCatalogEditor(editor); }
    });
    editor.addEventListener('toggle', () => {
      document.body.classList.toggle('modal-open', Boolean(document.querySelector('.catalog-editor[open]')));
      if (editor.open) requestAnimationFrame(() => editor.querySelector('input:not([type="hidden"]), select')?.focus());
    });
  });
  // "Cancelar" fecha o formulário em todas as abas (na frente, o botão antigo só limpava).
  document.querySelector('#production-front-clear')?.addEventListener('click', () => {
    const editor = document.querySelector('#production-front-editor');
    if (editor) editor.open = false;
  });
  // Contador e busca acompanham cada redesenho das listas.
  if (typeof MutationObserver === 'function') {
    document.querySelectorAll('[data-catalog-list]').forEach(list => {
      const key = list.dataset.catalogList;
      new MutationObserver(() => { updateCatalogCount(key); applyCatalogSearch(key); }).observe(list, { childList: true });
    });
  }
}
