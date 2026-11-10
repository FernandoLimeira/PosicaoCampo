// Aba "Ordem de serviço" da Produção Agrícola: importação e consulta das O.S.
// da unidade, e o detalhe ("Ver") com todas as O.S. abertas de um setor.
let serviceOrdersData = null;
let serviceOrdersLoadedUnit = '';
let serviceOrdersSearchTimer = null;

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
  body.innerHTML = data.orders.map(order => `<tr>
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
// Detalhe compacto (cabe na tela, sem rolagem): as colunas do arquivo que se repetem
// em todas as linhas da O.S. aparecem uma vez; o que muda por linha (o talhão) vira etiqueta.
function serviceOrderCardHtml(order) {
  const rows = order.rows || [];
  const columns = order.columns?.length ? order.columns : Object.keys(rows[0] || {});
  const header = `<header>
      <div><strong>O.S. ${escapeHtml(order.number)}</strong><small>${escapeHtml(serviceOrderOperationLabel(order))}</small></div>
      ${order.matches ? '<span>Confere com o lançamento</span>' : ''}
    </header>`;
  if (!rows.length) {
    return `<article class="production-order-card${order.matches ? ' is-match' : ''}">${header}
      <dl>
        <div><dt>Setor / seção</dt><dd>${escapeHtml(order.sector)}${order.section ? ` / ${escapeHtml(order.section)}` : ''}</dd></div>
        <div><dt>Centro de custo</dt><dd>${escapeHtml(order.cost_center || '-')}</dd></div>
        <div><dt>Abertura</dt><dd>${escapeHtml(serviceOrderDate(order.opened_on))}</dd></div>
        <div><dt>Talhões</dt><dd>${escapeHtml(serviceOrderPlotsLabel(order))}</dd></div>
      </dl></article>`;
  }
  const constant = columns.filter(name => rows.every(row => (row[name] ?? '') === (rows[0][name] ?? '')));
  const varying = columns.filter(name => !constant.includes(name));
  const plotColumn = varying.find(name => /talh/i.test(name)) || varying[0];
  const others = varying.filter(name => name !== plotColumn);
  return `<article class="production-order-card${order.matches ? ' is-match' : ''}">${header}
    <dl class="production-order-fields">
      ${constant.map(name => `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(serviceOrderCellText(rows[0][name]) || '-')}</dd></div>`).join('')}
    </dl>
    <div class="production-order-plots">
      <span class="production-order-plots-title">${escapeHtml(plotColumn || 'Linhas')} · ${rows.length} ${rows.length === 1 ? 'linha' : 'linhas'}</span>
      <div class="production-order-plot-list">
        ${rows.map(row => `<span class="production-order-plot"${others.length ? ` title="${escapeHtml(others.map(name => `${name}: ${serviceOrderCellText(row[name])}`).join(' · '))}"` : ''}>
          ${escapeHtml(plotColumn ? serviceOrderCellText(row[plotColumn]) : '-')}${others.length ? `<small>${escapeHtml(others.map(name => serviceOrderCellText(row[name])).join(' · '))}</small>` : ''}
        </span>`).join('')}
      </div>
    </div>
  </article>`;
}

// Com mais de uma O.S. no setor, o popup mostra uma O.S. por etapa: lista das O.S.
// no topo (clicável) e Anterior/Próxima embaixo. Com uma só, mostra direto.
let serviceOrderSteps = { orders: [], index: 0 };

function renderServiceOrderStep() {
  const body = document.querySelector('#production-order-modal-body');
  if (!body) return;
  const { orders, index } = serviceOrderSteps;
  if (!orders.length) {
    body.innerHTML = '<p class="production-empty">Nenhuma O.S. aberta para este setor.</p>';
    return;
  }
  if (orders.length === 1) {
    body.innerHTML = serviceOrderCardHtml(orders[0]);
    return;
  }
  const order = orders[index];
  body.innerHTML = `
    <nav class="production-order-steps" aria-label="O.S. do setor">
      ${orders.map((item, position) => `<button type="button" class="production-order-step${position === index ? ' is-current' : ''}${item.matches ? ' is-match' : ''}"
        data-order-step="${position}" aria-current="${position === index ? 'step' : 'false'}">
        <span class="production-order-step-number">${position + 1}</span>
        <span class="production-order-step-label"><strong>O.S. ${escapeHtml(item.number)}</strong><small>${escapeHtml(item.operation || '-')}${item.matches ? ' · confere' : ''}</small></span>
      </button>`).join('')}
    </nav>
    ${serviceOrderCardHtml(order)}
    <div class="production-order-step-footer">
      <button type="button" class="modal-button secondary" data-order-step="${index - 1}" ${index === 0 ? 'disabled' : ''}>Anterior</button>
      <span>O.S. ${index + 1} de ${orders.length}</span>
      <button type="button" class="modal-button save" data-order-step="${index + 1}" ${index === orders.length - 1 ? 'disabled' : ''}>Próxima</button>
    </div>`;
  body.querySelector('.production-order-step.is-current')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function showServiceOrdersModal(contextText, orders) {
  const context = document.querySelector('#production-order-modal-context');
  if (context) {
    const count = orders.length > 1 ? ` · ${orders.length} O.S. abertas` : '';
    context.textContent = `${contextText}${count}`;
  }
  serviceOrderSteps = { orders, index: 0 };
  renderServiceOrderStep();
  openModal('production-order-modal');
}

document.querySelector('#production-order-modal-body')?.addEventListener('click', event => {
  const button = event.target.closest('[data-order-step]');
  if (!button || button.disabled) return;
  const next = Number(button.dataset.orderStep);
  if (next < 0 || next >= serviceOrderSteps.orders.length) return;
  serviceOrderSteps.index = next;
  renderServiceOrderStep();
});
document.querySelector('#production-order-modal')?.addEventListener('keydown', event => {
  if (serviceOrderSteps.orders.length < 2 || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  if (event.target.closest('input, select, textarea')) return;
  const next = serviceOrderSteps.index + (event.key === 'ArrowRight' ? 1 : -1);
  if (next < 0 || next >= serviceOrderSteps.orders.length) return;
  serviceOrderSteps.index = next;
  renderServiceOrderStep();
});

// "Ver" da tabela de lançamentos: todas as O.S. abertas do setor do lançamento.
function openProductionItemOrders(itemId) {
  const item = findProductionItem(itemId);
  if (!item) return;
  const entry = item.entry || {};
  const section = entry.section ? ` / Seção ${entry.section}` : '';
  const operation = entry.operation ? ` · ${entry.operation.includes(',') ? 'Operações' : 'Operação'} ${entry.operation}` : '';
  showServiceOrdersModal(`${item.service_name} · Setor ${entry.sector || '-'}${section}${operation}`, item.service_order?.orders || []);
}

// "Ver setor" da aba Ordem de serviço.
function openSectorOrders(sector) {
  const orders = (serviceOrdersData?.orders || []).filter(order => order.sector === sector);
  showServiceOrdersModal(`Setor ${sector} · ${orders.length} ${orders.length === 1 ? 'O.S. aberta' : 'O.S. abertas'}`, orders);
}

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
  if (serviceOrdersPageActive()) window.setTimeout(() => loadServiceOrders({ force: true }), 0);
});
if (serviceOrdersPageActive()) loadServiceOrders();
