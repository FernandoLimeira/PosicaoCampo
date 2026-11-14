// Entrega CTT: importação do Excel de pesagem da balança, resumo de moagem/entrega
// por unidade e frente, e consultas SQL salvas (o SELECT da pesagem, só guardado).
const DELIVERY_UNIT_NAMES = { PPT: 'Paraguaçu Paulista', NRD: 'Narandiba', RBR: 'Rio Brilhante', PST: 'Passa Tempo' };
const DELIVERY_COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
let deliveryQueries = [];
let deliveryQueriesEditable = false;

function deliveryNumber(value, digits = 0) {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function deliveryTime(timestamp) {
  return new Date(timestamp * 1000).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function deliverySection(front) {
  return front.section ? ` / ${escapeHtml(front.section)}` : '';
}

function renderDeliverySummary(summary) {
  const reference = document.querySelector('#delivery-reference');
  if (reference) {
    const parts = [];
    if (summary.reference_at) {
      parts.push(`Dados até ${escapeHtml(deliveryTime(summary.reference_at))}`);
      if (summary.shift) parts.push(`turno ${escapeHtml(summary.shift.code)}`);
    } else {
      parts.push(`Nenhuma carga pesada em ${escapeHtml(formatIsoDateBr(summary.work_date))}`);
    }
    if (summary.last_import) {
      parts.push(`última importação ${escapeHtml(deliveryTime(summary.last_import.imported_at))} por ${escapeHtml(summary.last_import.imported_by_name || '-')}`);
    }
    reference.innerHTML = parts.join(' · ');
  }
  const body = document.querySelector('#delivery-units');
  if (body) body.innerHTML = summary.units.map(unit => `<tr>
      <th scope="row"><strong>${escapeHtml(unit.code)}</strong><small>${escapeHtml(DELIVERY_UNIT_NAMES[unit.code] || '')}</small></th>
      <td>${deliveryNumber(unit.milling_day_t)}</td>
      <td>${deliveryNumber(unit.milling_shift_tph)}</td>
      <td>${deliveryNumber(unit.milling_last3h_tph)}</td>
      <td>${deliveryNumber(unit.delivery_shift_tph)}</td>
      <td>${deliveryNumber(unit.delivery_last3h_tph)}</td>
      <td>${deliveryNumber(unit.stock_loads)}</td>
      <td>${deliveryNumber(unit.atr, 2)}</td>
    </tr>`).join('');
  const fronts = document.querySelector('#delivery-fronts');
  if (!fronts) return;
  fronts.innerHTML = summary.units.map(unit => {
    const rows = unit.fronts.map(front => `<tr class="${front.external ? 'is-external' : ''}">
        <td><strong>${escapeHtml(front.front)}</strong>${front.external
          ? `<span class="delivery-tag" title="Frente de ${escapeHtml(front.home_unit)} entregando nesta unidade">${escapeHtml(front.home_unit)}</span>` : ''}</td>
        <td>${escapeHtml(front.sector || '-')}${deliverySection(front)}</td>
        <td>${deliveryNumber(front.tons)}</td>
        <td>${deliveryNumber(front.loads)}</td>
        <td>${deliveryNumber(front.atr, 2)}</td>
      </tr>`).join('');
    return `<section class="delivery-card delivery-unit">
        <header><h2>${escapeHtml(unit.code)} <small>${escapeHtml(DELIVERY_UNIT_NAMES[unit.code] || '')}</small></h2>
          <span>${deliveryNumber(unit.fronts.length)} ${unit.fronts.length === 1 ? 'frente' : 'frentes'}</span></header>
        ${rows ? `<table class="delivery-table delivery-front-table">
          <thead><tr><th scope="col">Frente</th><th scope="col">Setor</th><th scope="col">Moagem<small>t</small></th>
            <th scope="col">Cargas</th><th scope="col">ATR</th></tr></thead>
          <tbody>${rows}</tbody></table>` : '<p class="delivery-empty">Nenhuma carga pesada no dia.</p>'}
      </section>`;
  }).join('');
}

async function loadDeliverySummary() {
  const input = document.querySelector('#delivery-date');
  const day = input?.value || saoPauloIsoDate();
  const summary = await apiRequest(`/api/weighings/summary?date=${encodeURIComponent(day)}`);
  renderDeliverySummary(summary);
}

// A mesma liberação importada de novo é atualizada, então o arquivo pode ser reenviado no dia.
async function importDeliveryFile(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  const label = document.querySelector('#delivery-import-label');
  label?.classList.add('is-busy');
  try {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const result = await apiRequest('/api/weighings/import', { method: 'POST', body: formData });
    const weighed = result.imported - result.pending;
    showToast(`Pesagem importada: ${deliveryNumber(weighed)} ${weighed === 1 ? 'carga pesada' : 'cargas pesadas'}`
      + `${result.pending ? ` e ${deliveryNumber(result.pending)} no pátio` : ''}.`);
    const dateInput = document.querySelector('#delivery-date');
    if (dateInput && result.dates?.length) dateInput.value = result.dates.at(-1);
    await loadDeliverySummary();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível importar a pesagem.', true);
  } finally {
    input.value = '';
    label?.classList.remove('is-busy');
  }
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

document.querySelector('#delivery-import-file')?.addEventListener('change', importDeliveryFile);
document.querySelector('#delivery-date')?.addEventListener('change', () => {
  loadDeliverySummary().catch(error => showToast(error.message || 'Não foi possível carregar a pesagem.', true));
});
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

if (document.querySelector('#delivery-units')) {
  const dateInput = document.querySelector('#delivery-date');
  if (dateInput && !dateInput.value) dateInput.value = saoPauloIsoDate();
  loadDeliverySummary().catch(error => {
    console.error(error);
    showToast(error.message || 'Não foi possível carregar a pesagem.', true);
  });
}
if (document.querySelector('#delivery-queries')) {
  loadDeliveryQueries().catch(error => {
    console.error(error);
    showToast(error.message || 'Não foi possível carregar as consultas.', true);
  });
}
