// Aba "Ordem de serviço" da Produção Agrícola: importação e consulta das O.S.
// (base única para todas as unidades), e o detalhe ("Ver") com todas as O.S. abertas de um setor.
let serviceOrdersData = null;
let serviceOrdersLoadedUnit = '';
let serviceOrdersSearchTimer = null;
let serviceOrdersPage = 1;

// Linhas por página conforme a altura da tela: a tabela cabe sem rolar a página.
let serviceOrdersRowHeight = 50;
function serviceOrdersPageSize() {
  const body = document.querySelector('#production-orders-body');
  const top = body?.getBoundingClientRect?.().top || 360;
  // Altura real de uma linha (medida na tela) e espaço da paginação + margem inferior.
  const measured = body?.querySelector?.('tr')?.getBoundingClientRect?.().height;
  if (measured > 20) serviceOrdersRowHeight = measured;
  const available = (globalThis.innerHeight || 800) - Math.max(top, 160) - 100;
  return Math.max(5, Math.min(50, Math.floor(available / serviceOrdersRowHeight)));
}

// Ícone de olho usado nos botões "Ver" das O.S.
const SERVICE_ORDER_EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

// A página /producao/ordens-servico (menu lateral) mostra o painel de O.S.
function serviceOrdersPageActive() {
  return String(globalThis.location?.pathname || '').startsWith('/producao/ordens-servico');
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
  const pageSize = serviceOrdersPageSize();
  const totalPages = Math.max(1, Math.ceil(data.orders.length / pageSize));
  serviceOrdersPage = Math.min(Math.max(1, serviceOrdersPage), totalPages);
  const start = (serviceOrdersPage - 1) * pageSize;
  const pageOrders = data.orders.slice(start, start + pageSize);
  const pagination = document.querySelector('#production-orders-pagination');
  if (pagination) {
    pagination.hidden = data.orders.length <= pageSize;
    const info = document.querySelector('#production-orders-page-info');
    if (info) info.textContent = `${start + 1}–${start + pageOrders.length} de ${data.orders.length} · Página ${serviceOrdersPage} de ${totalPages}`;
    const prev = document.querySelector('#production-orders-prev');
    const next = document.querySelector('#production-orders-next');
    if (prev) prev.disabled = serviceOrdersPage <= 1;
    if (next) next.disabled = serviceOrdersPage >= totalPages;
  }
  body.innerHTML = pageOrders.map(order => `<tr>
      <td><strong>${escapeHtml(order.number)}</strong></td>
      <td class="production-cell-number">${escapeHtml(order.sector || '-')}</td>
      <td class="production-cell-number">${escapeHtml(order.section || '-')}</td>
      <td>${escapeHtml(serviceOrderOperationLabel(order))}</td>
      <td class="production-cell-number">${escapeHtml(order.cost_center || '-')}</td>
      <td><span class="production-os-plots" title="${escapeHtml((order.plots || []).join(', '))}">${escapeHtml(serviceOrderPlotsLabel(order))}</span></td>
      <td>${escapeHtml(serviceOrderDate(order.opened_on))}</td>
      <td><button class="production-os-view is-icon" type="button" data-order-sector="${escapeHtml(order.sector)}"
        title="Ver O.S. do setor ${escapeHtml(order.sector)}" aria-label="Ver O.S. do setor ${escapeHtml(order.sector)}">${SERVICE_ORDER_EYE_ICON}</button></td>
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
    serviceOrdersPage = 1;
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
    title: 'Importar O.S. para todas as unidades?',
    message: `A base de O.S. é única: as ordens de serviço atuais de todas as unidades serão substituídas pelas do arquivo “${file.name}”.`,
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
    showToast(`${result.imported} O.S. importadas para todas as unidades.`);
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

// Popup "O.S. abertas do setor": visual simples. Uma linha de resumo (com a conferência
// quando vem de um lançamento) e uma lista única: cada O.S. com a operação, a seção,
// a abertura e todos os talhões. As O.S. que conferem com o lançamento vêm primeiro.
function serviceOrderPlotsHtml(plots = []) {
  if (!plots.length) return '<span class="pos-os-muted">Sem talhão</span>';
  return `<span class="pos-os-plots"><b>${plots.length === 1 ? 'Talhão' : `Talhões (${plots.length})`}:</b> ${escapeHtml(plots.join(', '))}</span>`;
}

function serviceOrdersPanelHtml(orders, { check = null } = {}) {
  const ordered = [...orders].sort((a, b) => Number(Boolean(b.matches)) - Number(Boolean(a.matches))
    || compareFrontLabels(a.operation || '', b.operation || '') || compareFrontLabels(a.number || '', b.number || ''));
  const operations = new Set(orders.map(order => order.operation).filter(Boolean));
  const plots = new Set(orders.flatMap(order => (order.plots || []).map(plot => `${order.section}|${plot}`)));
  const showSection = orders.some(order => order.section);
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

  const status = !check ? ''
    : check.needsSection ? '<span class="pos-status is-missing">Informe a seção do lançamento</span>'
    : check.missing.length ? `<span class="pos-status is-missing">Sem O.S. para ${escapeHtml(check.missing.join(', '))}</span>`
      : check.wanted ? '<span class="pos-status is-ok">O.S. OK</span>'
        : '<span class="pos-status">Lançamento sem operação</span>';
  const summary = `<div class="pos-summary">
      <span>${plural(orders.length, 'O.S. aberta', 'O.S. abertas')} · ${plural(operations.size, 'operação', 'operações')} · ${plural(plots.size, 'talhão', 'talhões')}</span>
      ${status}
    </div>`;

  const rows = ordered.map(order => `<li class="${order.matches ? 'is-match' : ''}">
      <div class="pos-os-head">
        <span class="pos-os-op"><b>${escapeHtml(order.operation || '-')}</b>${escapeHtml(order.operation_name || '')}</span>
        ${order.matches ? '<em>confere</em>' : ''}
        <span class="pos-os-meta">O.S. <strong>${escapeHtml(order.number)}</strong>${showSection ? ` · Seção ${escapeHtml(order.section || '-')}` : ''} · ${escapeHtml(serviceOrderDate(order.opened_on))}</span>
      </div>
      ${serviceOrderPlotsHtml(order.plots)}
    </li>`).join('');

  return `${summary}<ul class="pos-os-list">${rows}</ul>`;
}

function showServiceOrdersModal(contextText, orders, options = {}) {
  const body = document.querySelector('#production-order-modal-body');
  const context = document.querySelector('#production-order-modal-context');
  if (!body) return;
  if (context) context.textContent = contextText;
  body.innerHTML = orders.length ? serviceOrdersPanelHtml(orders, options)
    : '<p class="production-empty">Nenhuma O.S. aberta para este setor.</p>';
  openModal('production-order-modal');
}

// "Ver" da tabela de lançamentos: todas as O.S. abertas do setor do lançamento.
// O resumo que vem com o lançamento já basta (sem nova consulta ao servidor).
function openProductionItemOrders(itemId) {
  const item = findProductionItem(itemId);
  if (!item) return;
  const entry = item.entry || {};
  const section = entry.section ? ` / Seção ${entry.section}` : '';
  const codes = splitProductionOperations(entry.operation);
  const operation = codes.length ? ` · ${codes.length > 1 ? 'Operações' : 'Operação'} ${codes.join(', ')}` : '';
  const check = { wanted: codes.length > 0, missing: item.service_order?.missing_operations || [],
    needsSection: Boolean(item.service_order?.needs_section) };
  showServiceOrdersModal(`${item.service_name} · Setor ${entry.sector || '-'}${section}${operation}`,
    item.service_order?.orders || [], { check });
}

// "Ver setor" da aba Ordem de serviço.
function openSectorOrders(sector) {
  const orders = (serviceOrdersData?.orders || []).filter(order => order.sector === sector);
  showServiceOrdersModal(`Setor ${sector}`, orders);
}

document.querySelector('#production-orders-body')?.addEventListener('click', event => {
  const button = event.target.closest('[data-order-sector]');
  if (button) openSectorOrders(button.dataset.orderSector);
});
document.querySelector('#production-orders-form')?.addEventListener('submit', importServiceOrders);
document.querySelector('#production-orders-prev')?.addEventListener('click', () => { serviceOrdersPage -= 1; renderServiceOrders(); });
document.querySelector('#production-orders-next')?.addEventListener('click', () => { serviceOrdersPage += 1; renderServiceOrders(); });
let serviceOrdersResizeTimer = null;
globalThis.addEventListener?.('resize', () => {
  if (!serviceOrdersPageActive()) return;
  clearTimeout(serviceOrdersResizeTimer);
  serviceOrdersResizeTimer = setTimeout(renderServiceOrders, 150);
});
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
  if (serviceOrdersPageActive()) window.setTimeout(() => loadServiceOrders({ force: true }), 0);
});
if (serviceOrdersPageActive()) loadServiceOrders();
