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
  const term = String(document.querySelector('#production-operation-search')?.value || '').trim().toLocaleLowerCase('pt-BR');
  const visible = productionOperations.filter(item => !term
    || [item.code, item.name, item.front_name].some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(term)));
  const editable = canConfigureProduction();
  list.innerHTML = visible.map(item => `
    <div class="production-config-list-item ${item.is_active ? '' : 'is-inactive'}">
      <div class="production-config-list-item-copy">
        <strong>${escapeHtml(item.code)} — ${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.front_name || 'Sem frente vinculada')}${item.in_use ? ' · em uso' : ''}${item.is_active ? '' : ' · inativa'}</span>
      </div>
      ${editable ? `<div class="production-config-list-actions">
        <button type="button" data-operation-action="edit" data-operation-id="${item.id}">Editar</button>
        <button class="is-delete" type="button" data-operation-action="delete" data-operation-id="${item.id}">Apagar</button>
      </div>` : ''}
    </div>`).join('') || `<div class="production-empty"><span>${productionOperations.length
      ? 'Nenhuma operação encontrada nesta busca.' : 'Nenhuma operação cadastrada. Importe as O.S. ou cadastre manualmente.'}</span></div>`;
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
  document.querySelectorAll('#production-catalog-panel .production-config-editor').forEach(editor => { editor.hidden = !editable; });
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
document.querySelector('#production-operation-search')?.addEventListener('input', renderProductionOperations);
document.querySelector('#production-operations-list')?.addEventListener('click', event => {
  const button = event.target.closest('[data-operation-action]');
  if (!button) return;
  if (button.dataset.operationAction === 'edit') editProductionOperation(button.dataset.operationId);
  if (button.dataset.operationAction === 'delete') deleteProductionOperation(button.dataset.operationId);
});
if (productionCatalogPageActive()) {
  document.addEventListener('production-page-ready', initializeProductionCatalogPage);
  // Troca de unidade: as frentes listadas dependem da unidade.
  document.addEventListener('report-unit-change', () => window.setTimeout(initializeProductionCatalogPage, 300));
}
