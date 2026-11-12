// Painel gerencial da Produção Agrícola: visão por grupo, alternável com a tabela.
// Usa os mesmos lançamentos da tabela (productionItems) e os status cadastrados.
const PRODUCTION_VIEW_KEY = 'posicao-campo-production-view';
// O painel mostra um grupo por vez (sem "Todos"): mais espaço para as frentes.
const PRODUCTION_PANEL_GROUP_KEY = 'posicao-campo-production-panel-group';
let productionPanelGroup = '';
try { productionPanelGroup = localStorage.getItem(PRODUCTION_PANEL_GROUP_KEY) || ''; } catch (_) { /* sem armazenamento */ }

function dashboardProblemScore(items) {
  return items.reduce((sum, item) => {
    const flags = dashboardFlags(item);
    return sum + (flags.stopped ? 3 : 0) + (flags.noOrder ? 2 : 0) + (flags.noOperation ? 1 : 0) + (flags.stale ? 1 : 0);
  }, 0);
}

function renderDashboardGroupTabs(groups) {
  const nav = document.querySelector('#production-group-tabs');
  if (!nav) return;
  nav.hidden = groups.length === 0;
  nav.innerHTML = groups.map(group => {
    const red = group.items.filter(item => { const flags = dashboardFlags(item); return flags.stopped || flags.noOrder; }).length;
    const amber = group.items.filter(item => dashboardFlags(item).noOperation).length;
    const badge = red ? `<i class="is-red" title="${red} parada(s) ou sem O.S.">${red}</i>`
      : amber ? `<i class="is-amber" title="${amber} sem operação">${amber}</i>` : '';
    const active = String(group.id) === productionPanelGroup;
    return `<button type="button" role="tab" class="pdash-group-tab${active ? ' is-active' : ''}" aria-selected="${active}" data-panel-group="${escapeHtml(group.id)}">
      <span>${escapeHtml(group.name)}</span><b>${group.items.length}</b>${badge}</button>`;
  }).join('');
}

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

function dashboardItems() {
  return Array.isArray(productionItems) ? productionItems : [];
}

const DASHBOARD_ICONS = {
  pin: '<path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
function dashboardIcon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DASHBOARD_ICONS[name]}</svg>`;
}

function dashboardStatusBar(items) {
  const counts = productionStatuses.map(status => ({
    status, count: items.filter(item => item.entry?.status === status.code).length
  })).filter(entry => entry.count > 0);
  const total = counts.reduce((sum, entry) => sum + entry.count, 0) || 1;
  const bar = counts.map(({ status, count }) => `<span class="pdash-bar-segment ${statusMeta(status.code).className}"
      data-weight="${count}" title="${escapeHtml(status.name)}: ${count}"></span>`).join('');
  const legend = counts.map(({ status, count }) => `<span class="pdash-legend-item ${statusMeta(status.code).className}">
      <i aria-hidden="true"></i>${escapeHtml(status.name)} <b>${count}</b><small>${Math.round(count * 100 / total)}%</small></span>`).join('');
  return `<div class="pdash-bar" role="img" aria-label="Distribuição por status">${bar}</div>
    <div class="pdash-legend">${legend}</div>`;
}

function dashboardFrontTile(item) {
  const entry = item.entry || {};
  const meta = statusMeta(entry.status);
  const state = dashboardOrderState(item);
  const codes = splitProductionOperations(entry.operation);
  const order = state === 'ok' ? '<span class="pdash-os is-ok" title="O.S. confere">O.S. OK</span>'
    : state === 'missing' ? '<span class="pdash-os is-missing" title="Operação sem O.S. no setor">Sem O.S.</span>' : '';
  const operation = codes.length
    ? codes.map(code => `<span class="pdash-op">${escapeHtml(code)}</span>`).join('')
    : '<span class="pdash-op is-empty">Sem operação</span>';
  const editable = canFillProduction();
  const stale = item.is_current_day ? ''
    : `<span class="pdash-stale">${dashboardIcon('clock')}${entry.work_date ? `Último registro ${escapeHtml(formatIsoDateBr(entry.work_date))}` : 'Sem registro'}</span>`;
  const open = editable ? `button type="button" data-panel-edit="${item.id}"` : 'div';
  return `<${open} class="pdash-tile ${meta.className}${item.is_current_day ? '' : ' is-stale'}" title="${escapeHtml(`${item.service_name} · ${meta.name}`)}">
      <span class="pdash-tile-top">
        <strong>${escapeHtml(item.service_name || '-')}</strong>
        <span class="pdash-status ${meta.className}">${escapeHtml(meta.name)}</span>
      </span>
      <span class="pdash-place">${dashboardIcon('pin')}<span>Setor ${escapeHtml(entry.sector || '-')}${entry.section ? ` / ${escapeHtml(entry.section)}` : ''}${entry.farm ? ` · ${escapeHtml(entry.farm)}` : ''}</span></span>
      ${stale}
      <span class="pdash-tile-foot"><span class="pdash-ops">${operation}</span>${order}</span>
    </${editable ? 'button' : 'div'}>`;
}

function dashboardGroupInitials(name) {
  return String(name || '?').split(/\s+/).filter(word => word.length > 2).slice(0, 2)
    .map(word => word[0]).join('').toLocaleUpperCase('pt-BR') || '?';
}

function renderProductionDashboard() {
  const cards = document.querySelector('#production-group-cards');
  if (!cards) return;
  const allItems = dashboardItems();
  const empty = document.querySelector('#production-dashboard-empty');
  if (empty) empty.hidden = allItems.length > 0;

  // Agrupa na ordem do catálogo; o painel mostra só o grupo selecionado.
  const groups = new Map();
  allItems.forEach((item, index) => {
    if (!groups.has(item.group_id)) groups.set(item.group_id, { id: item.group_id, name: item.group_name || 'Sem grupo', order: index, items: [] });
    groups.get(item.group_id).items.push(item);
  });
  const ordered = [...groups.values()].sort((a, b) => a.order - b.order);
  // Grupo escolhido; sem escolha válida, abre no grupo que mais precisa de atenção.
  // Lista vazia (recarga depois de salvar): mantém o grupo para o painel voltar onde estava.
  if (ordered.length && !ordered.some(group => String(group.id) === productionPanelGroup)) {
    const worst = [...ordered].sort((a, b) => dashboardProblemScore(b.items) - dashboardProblemScore(a.items) || a.order - b.order)[0];
    productionPanelGroup = worst ? String(worst.id) : '';
  }
  renderDashboardGroupTabs(ordered);
  const selected = ordered.filter(group => String(group.id) === productionPanelGroup);

  cards.innerHTML = selected.map(group => {
    const total = group.items.length;
    const withOperation = group.items.filter(item => dashboardOrderState(item) !== 'no_operation' && item.entry?.sector).length;
    const ok = group.items.filter(item => dashboardOrderState(item) === 'ok').length;
    const noOperation = group.items.filter(item => dashboardOrderState(item) === 'no_operation').length;
    const today = group.items.filter(item => item.is_current_day).length;
    const stopped = group.items.filter(item => dashboardFlags(item).stopped).length;
    const kpi = (label, value, tone = '') => `<span class="pdash-kpi ${tone}"><b>${value}</b>${label}</span>`;
    return `<article class="pdash-group${stopped ? ' has-stopped' : ''}">
      <header class="pdash-group-header">
        <div class="pdash-group-title">
          <span class="pdash-group-icon" aria-hidden="true">${escapeHtml(dashboardGroupInitials(group.name))}</span>
          <div><h3>${escapeHtml(group.name)}</h3><span>${total} ${total === 1 ? 'frente' : 'frentes'}</span></div>
        </div>
        <div class="pdash-kpis">
          ${stopped ? kpi(stopped === 1 ? 'parada' : 'paradas', stopped, 'is-red') : ''}
          ${kpi('O.S. OK', withOperation ? `${ok}/${withOperation}` : '-', withOperation && ok < withOperation ? 'is-red' : 'is-green')}
          ${kpi('sem operação', noOperation, noOperation ? 'is-amber' : '')}
          ${kpi('atualizadas hoje', `${today}/${total}`, today < total ? 'is-gray' : 'is-green')}
        </div>
      </header>
      <div class="pdash-group-status">${dashboardStatusBar(group.items)}</div>
      <div class="pdash-tiles">${group.items.map(dashboardFrontTile).join('')}</div>
    </article>`;
  }).join('');
  // A CSP bloqueia "style" no HTML; o tamanho de cada faixa é aplicado pelo script.
  cards.querySelectorAll?.('[data-weight]').forEach(segment => { segment.style.flexGrow = segment.dataset.weight; });
  fitDashboardTiles();
}

// Blocos das frentes ocupam a largura toda: colunas pelo espaço real (menu lateral,
// zoom e janela contam), ~240px por bloco, com as linhas equilibradas.
const DASHBOARD_TILE_MIN = 240;
let dashboardTilesObserver = null;

function fitDashboardTiles() {
  const cards = document.querySelector('#production-group-cards');
  if (!cards?.querySelectorAll) return;
  if (!dashboardTilesObserver && typeof ResizeObserver === 'function') {
    dashboardTilesObserver = new ResizeObserver(() => fitDashboardTiles());
    dashboardTilesObserver.observe(cards);
  }
  const plans = [...cards.querySelectorAll('.pdash-tiles')].map(grid => {
    const quantity = Math.max(1, grid.children.length);
    const style = getComputedStyle(grid);
    const width = grid.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
    if (width <= 0) return null;
    const gap = parseFloat(style.columnGap) || 10;
    const maxColumns = Math.max(1, Math.min(quantity, Math.floor((width + gap) / (DASHBOARD_TILE_MIN + gap))));
    return { grid, columns: String(Math.ceil(quantity / Math.ceil(quantity / maxColumns))) };
  });
  plans.forEach(plan => {
    if (plan && plan.grid.style.getPropertyValue('--tile-cols') !== plan.columns) plan.grid.style.setProperty('--tile-cols', plan.columns);
  });
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
document.querySelector('#production-group-tabs')?.addEventListener('click', event => {
  const tab = event.target.closest('[data-panel-group]');
  if (!tab) return;
  productionPanelGroup = tab.dataset.panelGroup;
  try { localStorage.setItem(PRODUCTION_PANEL_GROUP_KEY, productionPanelGroup); } catch (_) { /* preferência opcional */ }
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

// Garantia além do ResizeObserver: refaz as colunas quando a janela muda de tamanho ou de zoom.
let dashboardResizeFrame = 0;
globalThis.addEventListener?.('resize', () => {
  if (dashboardResizeFrame) return;
  dashboardResizeFrame = requestAnimationFrame(() => {
    dashboardResizeFrame = 0;
    fitDashboardTiles();
    if (typeof fitProductionSummaryColumns === 'function') fitProductionSummaryColumns();
  });
});
