// Entrega CTT: consultas SQL salvas (o SELECT da pesagem, só guardado para copiar).
// A pesagem é importada e acompanhada pela Posição de Campo (painel da unidade e
// relatório gerencial); aqui ficam apenas as consultas.
const DELIVERY_COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
let deliveryQueries = [];
let deliveryQueriesEditable = false;

function deliveryTime(timestamp) {
  return new Date(timestamp * 1000).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function renderDeliveryQueries() {
  const list = document.querySelector('#delivery-queries');
  if (!list) return;
  list.innerHTML = deliveryQueries.map(query => {
    const lines = query.sql.split('\n').length;
    const updated = query.updated_at ? deliveryTime(query.updated_at) : '-';
    return `<article class="delivery-query" data-query-id="${query.id}">
      <div class="delivery-query-head">
        <div><strong>${escapeHtml(query.name)}</strong>
          <small>${lines} ${lines === 1 ? 'linha' : 'linhas'} · atualizada em ${escapeHtml(updated)} por ${escapeHtml(query.updated_by)}</small></div>
        <div class="delivery-query-actions">
          <button class="delivery-query-copy" type="button" data-query-action="copy" title="Copiar o SQL">${DELIVERY_COPY_ICON}Copiar</button>
          ${deliveryQueriesEditable ? `
          <button class="icon-edit-button" type="button" data-query-action="edit" title="Editar" aria-label="Editar consulta ${escapeHtml(query.name)}">${PENCIL_ICON}</button>
          <button class="icon-delete-button" type="button" data-query-action="delete" title="Excluir" aria-label="Excluir consulta ${escapeHtml(query.name)}">${TRASH_ICON}</button>` : ''}
        </div>
      </div>
      <pre class="delivery-query-sql">${escapeHtml(query.sql)}</pre>
      ${lines > 10 ? '<button class="delivery-query-toggle" type="button" data-query-action="toggle">Mostrar tudo</button>' : ''}
    </article>`;
  }).join('') || `<p class="delivery-empty"><strong>Nenhuma consulta salva.</strong> ${
    deliveryQueriesEditable ? 'Use “+ Nova consulta” para guardar o SELECT da pesagem.' : 'Peça a quem edita a Posição de Campo para cadastrar a consulta.'}</p>`;
}

async function loadDeliveryQueries() {
  const data = await apiRequest('/api/delivery/queries');
  deliveryQueries = Array.isArray(data?.queries) ? data.queries : [];
  deliveryQueriesEditable = Boolean(data?.can_configure);
  renderDeliveryQueries();
}

function openDeliveryQueryModal(query = null) {
  document.querySelector('#delivery-query-form')?.reset();
  document.querySelector('#delivery-query-id').value = query?.id || '';
  document.querySelector('#delivery-query-name').value = query?.name || '';
  document.querySelector('#delivery-query-sql').value = query?.sql || '';
  document.querySelector('#delivery-query-modal-title').textContent = query ? `Editar: ${query.name}` : 'Nova consulta';
  openModal('delivery-query-modal');
}

async function saveDeliveryQuery(event) {
  event.preventDefault();
  const id = document.querySelector('#delivery-query-id').value;
  const button = document.querySelector('#delivery-query-save');
  if (button) button.disabled = true;
  try {
    await apiRequest(id ? `/api/delivery/queries/${id}` : '/api/delivery/queries', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        name: document.querySelector('#delivery-query-name').value.trim(),
        sql: document.querySelector('#delivery-query-sql').value
      })
    });
    closeModal('delivery-query-modal');
    showToast(id ? 'Consulta atualizada.' : 'Consulta salva.');
    await loadDeliveryQueries();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar a consulta.', true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function copyDeliveryQuery(query) {
  try {
    await navigator.clipboard.writeText(query.sql);
  } catch (_) {
    // Sem acesso à área de transferência: copia por um campo temporário.
    const area = document.createElement('textarea');
    area.value = query.sql;
    area.setAttribute('readonly', '');
    area.className = 'delivery-clipboard';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  showToast(`SQL de “${query.name}” copiado.`);
}

async function deleteDeliveryQuery(query) {
  if (!await askConfirmation({
    kicker: 'Consultas SQL', title: `Excluir “${query.name}”?`,
    message: 'A consulta salva será removida. Isso não altera a pesagem já importada.',
    confirmLabel: 'Excluir consulta'
  })) return;
  try {
    await apiRequest(`/api/delivery/queries/${query.id}`, { method: 'DELETE' });
    showToast('Consulta excluída.');
    await loadDeliveryQueries();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível excluir a consulta.', true);
  }
}

document.querySelector('#delivery-query-new')?.addEventListener('click', () => openDeliveryQueryModal());
document.querySelector('#delivery-query-form')?.addEventListener('submit', saveDeliveryQuery);
document.querySelector('#delivery-queries')?.addEventListener('click', event => {
  const button = event.target.closest('[data-query-action]');
  if (!button) return;
  const item = button.closest('[data-query-id]');
  const query = deliveryQueries.find(entry => String(entry.id) === item?.dataset.queryId);
  if (!query) return;
  const action = button.dataset.queryAction;
  if (action === 'copy') copyDeliveryQuery(query);
  if (action === 'edit') openDeliveryQueryModal(query);
  if (action === 'delete') deleteDeliveryQuery(query);
  if (action === 'toggle') {
    const expanded = item.classList.toggle('is-expanded');
    button.textContent = expanded ? 'Mostrar menos' : 'Mostrar tudo';
  }
});
// Tab no campo SQL insere recuo em vez de sair do campo.
document.querySelector('#delivery-query-sql')?.addEventListener('keydown', event => {
  if (event.key !== 'Tab' || event.shiftKey) return;
  event.preventDefault();
  event.target.setRangeText('    ', event.target.selectionStart, event.target.selectionEnd, 'end');
});

if (document.querySelector('#delivery-queries')) {
  loadDeliveryQueries().catch(error => {
    console.error(error);
    showToast(error.message || 'Não foi possível carregar as consultas.', true);
  });
}
