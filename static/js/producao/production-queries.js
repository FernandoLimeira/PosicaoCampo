// Página "Consultas SQL" da Produção Agrícola: guarda o SELECT usado no sistema de
// origem para gerar o arquivo de Ordem de serviço. Permite copiar, cadastrar novas
// consultas e atualizar as existentes (o comando não é executado aqui).
let productionQueries = [];
let productionQueriesEditable = false;

const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';

function productionQueriesPageActive() {
  return String(globalThis.location?.pathname || '').startsWith('/producao/consultas');
}

function renderProductionQueries() {
  const list = document.querySelector('#production-queries-list');
  if (!list) return;
  const newButton = document.querySelector('#production-query-new');
  if (newButton) newButton.hidden = !productionQueriesEditable;
  list.innerHTML = productionQueries.map(query => {
    const lines = query.sql.split('\n').length;
    const updated = query.updated_at
      ? new Date(query.updated_at * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-';
    return `<article class="production-query-item" data-query-id="${query.id}">
      <div class="production-query-head">
        <div>
          <strong>${escapeHtml(query.name)}</strong>
          <small>${lines} ${lines === 1 ? 'linha' : 'linhas'} · atualizada em ${escapeHtml(updated)} por ${escapeHtml(query.updated_by)}</small>
        </div>
        <div class="production-query-actions">
          <button class="production-query-copy" type="button" data-query-action="copy" title="Copiar o SQL">${COPY_ICON}Copiar</button>
          ${productionQueriesEditable ? `
          <button class="icon-edit-button" type="button" data-query-action="edit" title="Editar" aria-label="Editar consulta ${escapeHtml(query.name)}">${PENCIL_ICON}</button>
          <button class="icon-delete-button" type="button" data-query-action="delete" title="Excluir" aria-label="Excluir consulta ${escapeHtml(query.name)}">${TRASH_ICON}</button>` : ''}
        </div>
      </div>
      <pre class="production-query-sql">${escapeHtml(query.sql)}</pre>
      ${lines > 10 ? '<button class="production-query-toggle" type="button" data-query-action="toggle">Mostrar tudo</button>' : ''}
    </article>`;
  }).join('') || `<div class="production-empty"><strong>Nenhuma consulta salva.</strong><span>${
    productionQueriesEditable ? 'Use “+ Nova consulta” para guardar o SELECT das ordens de serviço.' : 'Peça a quem configura a Produção para cadastrar a consulta.'}</span></div>`;
}

async function loadProductionQueries() {
  const data = await apiRequest('/api/production/queries');
  productionQueries = Array.isArray(data?.queries) ? data.queries : [];
  productionQueriesEditable = Boolean(data?.can_configure);
  renderProductionQueries();
}

function openProductionQueryModal(query = null) {
  document.querySelector('#production-query-form')?.reset();
  document.querySelector('#production-query-id').value = query?.id || '';
  document.querySelector('#production-query-name').value = query?.name || '';
  document.querySelector('#production-query-sql').value = query?.sql || '';
  document.querySelector('#production-query-modal-title').textContent = query ? `Editar: ${query.name}` : 'Nova consulta';
  openModal('production-query-modal');
}

async function saveProductionQuery(event) {
  event.preventDefault();
  const id = document.querySelector('#production-query-id').value;
  const button = document.querySelector('#production-query-save');
  const payload = {
    name: document.querySelector('#production-query-name').value.trim(),
    sql: document.querySelector('#production-query-sql').value
  };
  if (button) button.disabled = true;
  try {
    await apiRequest(id ? `/api/production/queries/${id}` : '/api/production/queries', {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(payload)
    });
    closeModal('production-query-modal');
    showToast(id ? 'Consulta atualizada.' : 'Consulta salva.');
    await loadProductionQueries();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar a consulta.', true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function copyProductionQuery(query) {
  try {
    await navigator.clipboard.writeText(query.sql);
  } catch (_) {
    // Navegadores sem acesso à área de transferência: copia por um campo temporário.
    const area = document.createElement('textarea');
    area.value = query.sql;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  showToast(`SQL de “${query.name}” copiado.`);
}

async function deleteProductionQuery(query) {
  if (!await askConfirmation({
    kicker: 'Consultas SQL', title: `Excluir “${query.name}”?`,
    message: 'A consulta salva será removida. Isso não altera as O.S. já importadas.',
    confirmLabel: 'Excluir consulta'
  })) return;
  try {
    await apiRequest(`/api/production/queries/${query.id}`, { method: 'DELETE' });
    showToast('Consulta excluída.');
    await loadProductionQueries();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível excluir a consulta.', true);
  }
}

document.querySelector('#production-query-new')?.addEventListener('click', () => openProductionQueryModal());
document.querySelector('#production-query-form')?.addEventListener('submit', saveProductionQuery);
document.querySelector('#production-queries-list')?.addEventListener('click', event => {
  const button = event.target.closest('[data-query-action]');
  if (!button) return;
  const item = button.closest('[data-query-id]');
  const query = productionQueries.find(entry => String(entry.id) === item?.dataset.queryId);
  if (!query) return;
  const action = button.dataset.queryAction;
  if (action === 'copy') copyProductionQuery(query);
  if (action === 'edit') openProductionQueryModal(query);
  if (action === 'delete') deleteProductionQuery(query);
  if (action === 'toggle') {
    const expanded = item.classList.toggle('is-expanded');
    button.textContent = expanded ? 'Mostrar menos' : 'Mostrar tudo';
  }
});
// Tab no campo SQL insere recuo em vez de sair do campo.
document.querySelector('#production-query-sql')?.addEventListener('keydown', event => {
  if (event.key !== 'Tab' || event.shiftKey) return;
  event.preventDefault();
  const area = event.target;
  const start = area.selectionStart;
  area.setRangeText('    ', start, area.selectionEnd, 'end');
});
if (productionQueriesPageActive()) {
  loadProductionQueries().catch(error => {
    console.error(error);
    showToast(error.message || 'Não foi possível carregar as consultas.', true);
  });
}
