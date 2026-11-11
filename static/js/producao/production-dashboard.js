// Painel gerencial da Produção Agrícola: visão por grupo, alternável com a tabela.
// Usa os mesmos lançamentos da tabela (productionItems) e os status cadastrados.
const PRODUCTION_VIEW_KEY = 'posicao-campo-production-view';
let productionPanelFilter = '';

// Situação de O.S. igual à da coluna da tabela: sem operação não confere O.S.
function dashboardOrderState(item) {
  const entry = item.entry || {};
  if (!entry.sector) return '';
  if (!String(entry.operation || '').trim()) return 'no_operation';
  return item.service_order?.status === 'ok' ? 'ok' : 'missing';
}

function dashboardFlags(item) {
  const state = dashboardOrderState(item);
  return {
    stopped: statusMeta(item.entry?.status).className === 'is-stopped',
    noOrder: state === 'missing',
    noOperation: state === 'no_operation',
    stale: !item.is_current_day
  };
}

const DASHBOARD_ALERTS = [
  { key: 'stopped', label: count => `${count} ${count === 1 ? 'frente parada' : 'frentes paradas'}`, tone: 'red' },
  { key: 'noOrder', label: count => `${count} sem O.S.`, tone: 'red' },
  { key: 'noOperation', label: count => `${count} sem operação`, tone: 'amber' },
  { key: 'stale', label: count => `${count} sem atualização hoje`, tone: 'gray' }
];

function dashboardItems() {
  return Array.isArray(productionItems) ? productionItems : [];
}

function renderDashboardAlerts(items) {
  const box = document.querySelector('#production-alerts');
  if (!box) return;
  const alerts = DASHBOARD_ALERTS.map(alert => ({
    ...alert, count: items.filter(item => dashboardFlags(item)[alert.key]).length
  })).filter(alert => alert.count > 0);
  if (productionPanelFilter && !alerts.some(alert => alert.key === productionPanelFilter)) productionPanelFilter = '';
  box.innerHTML = alerts.length
    ? alerts.map(alert => `<button type="button" class="production-alert is-${alert.tone}${productionPanelFilter === alert.key ? ' is-active' : ''}"
        data-panel-filter="${alert.key}" aria-pressed="${productionPanelFilter === alert.key}">${escapeHtml(alert.label(alert.count))}</button>`).join('')
      + (productionPanelFilter ? '<button type="button" class="production-alert is-clear" data-panel-filter="">Mostrar todas</button>' : '')
    : '<span class="production-alert is-ok">Tudo em dia: nenhuma frente parada, sem O.S. ou sem atualização hoje.</span>';
}

function dashboardStatusBar(items) {
  const counts = productionStatuses.map(status => ({
    status, count: items.filter(item => item.entry?.status === status.code).length
  })).filter(entry => entry.count > 0);
  const total = counts.reduce((sum, entry) => sum + entry.count, 0) || 1;
  const bar = counts.map(({ status, count }) => `<span class="production-group-bar-segment ${statusMeta(status.code).className}"
      data-weight="${count}" title="${escapeHtml(status.name)}: ${count}"></span>`).join('');
  const legend = counts.map(({ status, count }) => `<span class="production-group-legend-item ${statusMeta(status.code).className}">
      <i aria-hidden="true"></i>${escapeHtml(status.name)} <b>${count}</b><small>${Math.round(count * 100 / total)}%</small></span>`).join('');
  return `<div class="production-group-bar" role="img" aria-label="Distribuição por status">${bar}</div>
    <div class="production-group-legend">${legend}</div>`;
}

function dashboardFrontTile(item) {
  const entry = item.entry || {};
  const meta = statusMeta(entry.status);
  const state = dashboardOrderState(item);
  const codes = String(entry.operation || '').split(/[,;+]/).map(code => code.trim()).filter(Boolean);
  const order = state === 'ok' ? '<span class="production-tile-os is-ok" title="O.S. confere">O.S. OK</span>'
    : state === 'missing' ? '<span class="production-tile-os is-missing" title="Operação sem O.S. no setor">Sem O.S.</span>' : '';
  const operation = codes.length
    ? codes.map(code => `<span class="production-tile-op">${escapeHtml(code)}</span>`).join('')
    : '<span class="production-tile-op is-empty">Sem operação</span>';
  const editable = canFillProduction();
  const tag = editable ? 'button type="button"' : 'div';
  return `<${tag} class="production-front-tile ${meta.className}${item.is_current_day ? '' : ' is-stale'}" ${editable ? `data-panel-edit="${item.id}"` : ''}
      title="${escapeHtml(`${item.service_name} · ${meta.name}`)}">
      <span class="production-tile-head"><i class="production-tile-dot" aria-hidden="true"></i><strong>${escapeHtml(item.service_name || '-')}</strong></span>
      <span class="production-tile-place">Setor ${escapeHtml(entry.sector || '-')}${entry.farm ? ` · ${escapeHtml(entry.farm)}` : ''}</span>
      <span class="production-tile-status">${escapeHtml(meta.name)}${item.is_current_day ? '' : ` · último ${escapeHtml(entry.work_date ? formatIsoDateBr(entry.work_date) : 'sem registro')}`}</span>
      <span class="production-tile-ops">${operation}${order}</span>
    </${editable ? 'button' : 'div'}>`;
}

function renderProductionDashboard() {
  const cards = document.querySelector('#production-group-cards');
  if (!cards) return;
  const items = dashboardItems();
  renderDashboardAlerts(items);
  const empty = document.querySelector('#production-dashboard-empty');
  if (empty) empty.hidden = items.length > 0;

  // Agrupa na ordem do catálogo; grupos com problemas aparecem primeiro.
  const groups = new Map();
  items.forEach((item, index) => {
    if (!groups.has(item.group_id)) groups.set(item.group_id, { id: item.group_id, name: item.group_name || 'Sem grupo', order: index, items: [] });
    groups.get(item.group_id).items.push(item);
  });
  const score = group => group.items.reduce((sum, item) => {
    const flags = dashboardFlags(item);
    return sum + (flags.stopped ? 3 : 0) + (flags.noOrder ? 2 : 0) + (flags.noOperation ? 1 : 0) + (flags.stale ? 1 : 0);
  }, 0);
  const ordered = [...groups.values()].sort((a, b) => score(b) - score(a) || a.order - b.order);

  cards.innerHTML = ordered.map(group => {
    const visible = productionPanelFilter
      ? group.items.filter(item => dashboardFlags(item)[productionPanelFilter]) : group.items;
    if (!visible.length) return '';
    const total = group.items.length;
    const withOperation = group.items.filter(item => dashboardOrderState(item) !== 'no_operation' && item.entry?.sector);
    const ok = group.items.filter(item => dashboardOrderState(item) === 'ok').length;
    const noOperation = group.items.filter(item => dashboardOrderState(item) === 'no_operation').length;
    const today = group.items.filter(item => item.is_current_day).length;
    const stopped = group.items.filter(item => dashboardFlags(item).stopped).length;
    return `<article class="production-group-card">
      <header class="production-group-card-header">
        <div><h3>${escapeHtml(group.name)}</h3><span>${total} ${total === 1 ? 'frente' : 'frentes'}</span></div>
        ${stopped ? `<span class="production-group-flag">${stopped} ${stopped === 1 ? 'parada' : 'paradas'}</span>` : ''}
      </header>
      ${dashboardStatusBar(group.items)}
      <div class="production-group-kpis">
        <div><b>${withOperation.length ? `${ok}/${withOperation.length}` : '-'}</b><span>O.S. OK</span></div>
        <div class="${noOperation ? 'is-amber' : ''}"><b>${noOperation}</b><span>Sem operação</span></div>
        <div class="${today < total ? 'is-gray' : ''}"><b>${today}/${total}</b><span>Atualizadas hoje</span></div>
      </div>
      <div class="production-front-tiles">${visible.map(dashboardFrontTile).join('')}</div>
    </article>`;
  }).join('');
  // A CSP bloqueia "style" no HTML; o tamanho de cada faixa é aplicado pelo script.
  cards.querySelectorAll?.('[data-weight]').forEach(segment => { segment.style.flexGrow = segment.dataset.weight; });
}

function setProductionView(view) {
  const panel = view !== 'table';
  document.querySelectorAll('[data-production-view]').forEach(button => {
    const active = (button.dataset.productionView === 'panel') === panel;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const dashboard = document.querySelector('#production-dashboard');
  const table = document.querySelector('#production-table-card');
  if (dashboard) dashboard.hidden = !panel;
  if (table) table.hidden = panel;
  try { localStorage.setItem(PRODUCTION_VIEW_KEY, panel ? 'panel' : 'table'); } catch (_) { /* preferência opcional */ }
}

document.querySelectorAll('[data-production-view]').forEach(button => {
  button.addEventListener('click', () => setProductionView(button.dataset.productionView));
});
document.querySelector('#production-alerts')?.addEventListener('click', event => {
  const button = event.target.closest('[data-panel-filter]');
  if (!button) return;
  const key = button.dataset.panelFilter;
  productionPanelFilter = productionPanelFilter === key ? '' : key;
  renderProductionDashboard();
});
document.querySelector('#production-group-cards')?.addEventListener('click', event => {
  const tile = event.target.closest('[data-panel-edit]');
  if (tile) openEditProductionItem(Number(tile.dataset.panelEdit));
});
(() => {
  let saved = 'panel';
  try { saved = localStorage.getItem(PRODUCTION_VIEW_KEY) || 'panel'; } catch (_) { /* sem armazenamento */ }
  setProductionView(saved);
})();
