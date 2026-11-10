// Aba "Ordem de serviço" da Produção Agrícola: importação e consulta das O.S.
// da unidade, e o detalhe ("Ver") com todas as O.S. abertas de um setor.
let serviceOrdersData = null;
let serviceOrdersLoadedUnit = '';
let serviceOrdersSearchTimer = null;

function activeProductionTab() {
  return document.querySelector('[data-production-tab].is-active')?.dataset.productionTab || 'entries';
}

function selectProductionTab(tab) {
  document.querySelectorAll('[data-production-tab]').forEach(button => {
    const active = button.dataset.productionTab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const entries = document.querySelector('#production-entries-panel');
  const orders = document.querySelector('#production-orders-panel');
  if (entries) entries.hidden = tab !== 'entries';
  if (orders) orders.hidden = tab !== 'orders';
  if (tab === 'orders') loadServiceOrders();
}

function serviceOrderOperationLabel(order) {
  return [order.operation, order.operation_name].filter(Boolean).join(' — ') || '-';
}

function serviceOrderPlotsLabel(order) {
  const plots = order.plots || [];
  return plots.length ? `${plots.length} ${plots.length === 1 ? 'talhão' : 'talhões'}: ${plots.join(', ')}` : '-';
}

function serviceOrderDate(value) {
  return /^\d{4}-\d{2}-\d{2}/.test(String(value || '')) ? formatIsoDateBr(String(value).slice(0, 10)) : (value || '-');
}

function renderServiceOrders() {
  const body = document.querySelector('#production-orders-body');
  const empty = document.querySelector('#production-orders-empty');
  const meta = document.querySelector('#production-orders-meta');
  const importCard = document.querySelector('#production-orders-import');
  if (!body) return;
  const data = serviceOrdersData || { orders: [], total: 0 };
  if (importCard) importCard.hidden = !data.can_import;
  body.innerHTML = data.orders.map(order => `<tr>
      <td><strong>${escapeHtml(order.number)}</strong></td>
      <td class="production-cell-number">${escapeHtml(order.sector || '-')}</td>
      <td class="production-cell-number">${escapeHtml(order.section || '-')}</td>
      <td>${escapeHtml(serviceOrderOperationLabel(order))}</td>
      <td class="production-cell-number">${escapeHtml(order.cost_center || '-')}</td>
      <td><span class="production-os-plots" title="${escapeHtml((order.plots || []).join(', '))}">${escapeHtml(serviceOrderPlotsLabel(order))}</span></td>
      <td>${escapeHtml(serviceOrderDate(order.opened_on))}</td>
      <td><button class="production-os-view" type="button" data-order-sector="${escapeHtml(order.sector)}">Ver setor</button></td>
    </tr>`).join('');
  if (empty) {
    empty.hidden = data.orders.length > 0;
    const title = empty.querySelector('strong');
    if (title) title.textContent = data.total ? 'Nenhuma O.S. encontrada nesta busca.' : 'Nenhuma ordem de serviço importada.';
  }
  if (meta) {
    const last = data.last_import;
    meta.textContent = last
      ? `${data.total} O.S. · ${last.file || 'arquivo'} · ${new Date(last.imported_at * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${last.imported_by}`
      : '';
  }
}

async function loadServiceOrders({ force = false } = {}) {
  const unit = currentProductionUnit();
  const search = document.querySelector('#production-orders-search')?.value.trim() || '';
  if (!force && serviceOrdersLoadedUnit === `${unit}|${search}` && serviceOrdersData) {
    renderServiceOrders();
    return;
  }
  try {
    const params = new URLSearchParams({ unit });
    if (search) params.set('search', search);
    serviceOrdersData = await apiRequest(`/api/production/service-orders?${params}`);
    serviceOrdersLoadedUnit = `${unit}|${search}`;
    renderServiceOrders();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível carregar as ordens de serviço.', true);
  }
}

async function importServiceOrders(event) {
  event.preventDefault();
  const input = document.querySelector('#production-orders-file');
  const button = document.querySelector('#production-orders-submit');
  const file = input?.files?.[0];
  if (!file) {
    showToast('Selecione o arquivo de ordens de serviço.', true);
    return;
  }
  const unit = currentProductionUnit();
  const accepted = await askConfirmation({
    kicker: 'Ordem de serviço',
    title: `Importar O.S. da unidade ${unit}?`,
    message: `As ordens de serviço atuais de ${unit} serão substituídas pelas do arquivo “${file.name}”.`,
    details: ['Se o arquivo tiver erro, as O.S. atuais são mantidas.'],
    confirmLabel: 'Importar O.S.',
    tone: 'default'
  });
  if (!accepted) return;
  if (button) button.disabled = true;
  try {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const result = await apiRequest(`/api/production/service-orders/import?unit=${encodeURIComponent(unit)}`,
      { method: 'POST', body: formData });
    input.value = '';
    const label = document.querySelector('#production-orders-file-name');
    if (label) label.textContent = 'Nenhum arquivo selecionado';
    showToast(`${result.imported} O.S. importadas para ${unit}.`);
    await loadServiceOrders({ force: true });
    // A coluna O.S. dos lançamentos depende das O.S. importadas.
    await refreshProductionPage(unit, { keepFilters: true });
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível importar as ordens de serviço.', true);
  } finally {
    if (button) button.disabled = false;
  }
}

function serviceOrderCellText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? formatIsoDateBr(value) : String(value ?? '');
}

// Cartão da O.S. com o resumo e a tabela de todas as colunas do arquivo (uma linha por talhão).
function serviceOrderCardHtml(order) {
  const rows = order.rows || [];
  const columns = order.columns?.length ? order.columns : Object.keys(rows[0] || {});
  return `<article class="production-order-card${order.matches ? ' is-match' : ''}">
    <header>
      <div><strong>O.S. ${escapeHtml(order.number)}</strong><small>${escapeHtml(serviceOrderOperationLabel(order))}</small></div>
      ${order.matches ? '<span>Confere com o lançamento</span>' : ''}
    </header>
    <dl>
      <div><dt>Setor / seção</dt><dd>${escapeHtml(order.sector)}${order.section ? ` / ${escapeHtml(order.section)}` : ''}</dd></div>
      <div><dt>Centro de custo</dt><dd>${escapeHtml(order.cost_center || '-')}</dd></div>
      <div><dt>Abertura</dt><dd>${escapeHtml(serviceOrderDate(order.opened_on))}</dd></div>
      <div><dt>Talhões</dt><dd>${escapeHtml(serviceOrderPlotsLabel(order))}</dd></div>
    </dl>
    ${rows.length ? `<div class="production-order-rows"><table>
      <thead><tr>${columns.map(name => `<th>${escapeHtml(name)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(row => `<tr>${columns.map(name => `<td>${escapeHtml(serviceOrderCellText(row[name]))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>` : ''}
  </article>`;
}

function showServiceOrdersModal(contextText, orders) {
  const body = document.querySelector('#production-order-modal-body');
  const context = document.querySelector('#production-order-modal-context');
  if (!body) return;
  if (context) context.textContent = contextText;
  body.innerHTML = orders.map(serviceOrderCardHtml).join('')
    || '<p class="production-empty">Nenhuma O.S. aberta para este setor.</p>';
  openModal('production-order-modal');
}

// "Ver" da tabela de lançamentos: todas as O.S. abertas do setor do lançamento.
function openProductionItemOrders(itemId) {
  const item = findProductionItem(itemId);
  if (!item) return;
  const entry = item.entry || {};
  const section = entry.section ? ` / Seção ${entry.section}` : '';
  const operation = entry.operation ? ` · Operação ${entry.operation}` : '';
  showServiceOrdersModal(`${item.service_name} · Setor ${entry.sector || '-'}${section}${operation}`, item.service_order?.orders || []);
}

// "Ver setor" da aba Ordem de serviço.
function openSectorOrders(sector) {
  const orders = (serviceOrdersData?.orders || []).filter(order => order.sector === sector);
  showServiceOrdersModal(`Setor ${sector} · ${orders.length} ${orders.length === 1 ? 'O.S. aberta' : 'O.S. abertas'}`, orders);
}

document.querySelectorAll('[data-production-tab]').forEach(button => {
  button.addEventListener('click', () => selectProductionTab(button.dataset.productionTab));
});
document.querySelector('#production-orders-body')?.addEventListener('click', event => {
  const button = event.target.closest('[data-order-sector]');
  if (button) openSectorOrders(button.dataset.orderSector);
});
document.querySelector('#production-orders-form')?.addEventListener('submit', importServiceOrders);
document.querySelector('#production-orders-file')?.addEventListener('change', event => {
  const label = document.querySelector('#production-orders-file-name');
  if (label) label.textContent = event.target.files?.[0]?.name || 'Nenhum arquivo selecionado';
});
document.querySelector('#production-orders-search')?.addEventListener('input', () => {
  window.clearTimeout(serviceOrdersSearchTimer);
  serviceOrdersSearchTimer = window.setTimeout(() => loadServiceOrders(), 250);
});
// Troca de unidade: a lista é recarregada quando a aba estiver aberta.
document.addEventListener('report-unit-change', () => {
  serviceOrdersData = null;
  serviceOrdersLoadedUnit = '';
  if (activeProductionTab() === 'orders') window.setTimeout(() => loadServiceOrders({ force: true }), 0);
});
