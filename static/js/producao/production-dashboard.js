// Painel gerencial da Produção Agrícola: a página da Produção concentra tudo nele.
// Usa os mesmos lançamentos da tabela (productionItems) e os status cadastrados.
// O painel mostra um grupo por vez (sem "Todos"): mais espaço para as frentes.
const PRODUCTION_PANEL_GROUP_KEY = 'posicao-campo-production-panel-group';
let productionPanelGroup = '';
try { productionPanelGroup = localStorage.getItem(PRODUCTION_PANEL_GROUP_KEY) || ''; } catch (_) { /* sem armazenamento */ }

// Filtros do painel (por grupo): frente escolhida e indicador clicado no cabeçalho.
const dashboardPanelFilter = { front: '', flag: '' };

function dashboardMatchesFilter(item) {
  if (dashboardPanelFilter.front && String(item.service_front_id) !== dashboardPanelFilter.front) return false;
  const state = dashboardOrderState(item);
  switch (dashboardPanelFilter.flag) {
    case 'stopped': return dashboardFlags(item).stopped;
    case 'ok': return state === 'ok';
    case 'noOrder': return state === 'missing';
    case 'noOperation': return state === 'no_operation';
    case 'today': return Boolean(item.is_current_day);
    default: return true;
  }
}

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

// Situação de uma operação do lançamento: O.S. que conferem, talhões e texto do selo.
function dashboardOperationInfo(item, code) {
  const tone = productionOperationTone(item, code);
  const orders = productionOperationOrders(item, code);
  const plots = [...new Set(orders.flatMap(order => order.plots || []))];
  const label = orders.length ? `O.S. ${orders.map(order => order.number).join(', ')}`
    : tone ? (item.service_order?.needs_section ? 'Informe a seção' : 'Sem O.S.') : 'Sem conferência';
  return { tone, orders, plots, label, name: productionOperationName(item, code) };
}

// Popup "Detalhe da frente": situação, dados do local e cada operação com a O.S. e os talhões.
function openDashboardFrontDetail(itemId) {
  const item = findProductionItem(itemId);
  const body = document.querySelector('#production-front-detail-body');
  if (!item || !body) return;
  const entry = item.entry || {};
  const meta = statusMeta(entry.status);
  const codes = splitProductionOperations(entry.operation);
  const title = document.querySelector('#production-front-detail-title');
  if (title) title.textContent = item.service_name || 'Frente';
  const context = document.querySelector('#production-front-detail-context');
  if (context) context.textContent = item.group_name || '';
  const info = [
    ['Setor', entry.sector || '-'],
    ['Seção', entry.section || '-'],
    ['Fazenda', entry.farm || '-'],
    ['Atualização', entry.work_date ? formatIsoDateBr(entry.work_date) : 'Sem registro'],
    ['Responsável', entry.updated_by_name || item.owner_name || '-']
  ];
  const okCount = codes.filter(code => productionOperationTone(item, code) === 'is-order-ok').length;
  const operations = codes.map(code => {
    const op = dashboardOperationInfo(item, code);
    const opened = [...new Set(op.orders.map(order => order.opened_on).filter(Boolean).map(date => serviceOrderDate(date)))];
    return `<article class="pfd-op ${op.tone}">
        <header>
          <span class="pfd-op-code">${escapeHtml(code)}</span>
          <span class="pfd-op-name">${escapeHtml(op.name || 'Operação sem nome no cadastro')}</span>
          <span class="pfd-op-badge ${op.tone}" title="${escapeHtml(productionOperationTitle(op.tone, item))}">${escapeHtml(op.label)}</span>
        </header>
        ${op.plots.length ? `<p class="pfd-op-line"><b>${op.plots.length === 1 ? 'Talhão' : `Talhões (${op.plots.length})`}</b>${escapeHtml(op.plots.join(', '))}</p>` : ''}
        ${opened.length ? `<p class="pfd-op-line"><b>Abertura</b>${escapeHtml(opened.join(', '))}</p>` : ''}
      </article>`;
  }).join('');
  const check = codes.length
    ? `<span class="pfd-hero-check ${okCount === codes.length ? 'is-order-ok' : 'is-order-missing'}">${okCount}/${codes.length} ${codes.length === 1 ? 'operação' : 'operações'} com O.S.</span>`
    : '<span class="pfd-hero-check">Sem operação informada</span>';
  body.innerHTML = `<div class="pfd-hero ${meta.className}">
      <span class="pdash-status ${meta.className}">${escapeHtml(meta.name)}</span>
      ${check}
      ${item.is_current_day ? '' : `<span class="pdash-stale">${dashboardIcon('clock')}Não atualizada hoje</span>`}
    </div>
    <dl class="pfd-info">${info.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
    <section class="pfd-section">
      <h3>Operações ${codes.length ? `<small>${codes.length}</small>` : ''}</h3>
      ${operations || '<p class="production-empty">Nenhuma operação informada neste lançamento.</p>'}
    </section>
    ${entry.observation ? `<section class="pfd-section"><h3>Observação</h3><p class="pfd-note">${escapeHtml(entry.observation)}</p></section>` : ''}
    ${canFillProduction() ? `<div class="pdash-detail-actions">
      <button class="modal-button danger" type="button" data-panel-remove="${item.id}">Remover</button>
      <button class="modal-button save" type="button" data-panel-edit="${item.id}">Editar frente</button>
    </div>` : ''}`;
  openModal('production-front-detail-modal');
}

function dashboardFrontTile(item) {
  const entry = item.entry || {};
  const meta = statusMeta(entry.status);
  const state = dashboardOrderState(item);
  const codes = splitProductionOperations(entry.operation);
  const order = state === 'ok' ? '<span class="pdash-os is-ok" title="O.S. confere">O.S. OK</span>'
    : state === 'missing' ? (item.service_order?.needs_section
      ? '<span class="pdash-os is-missing" title="No Polo MS a O.S. confere por setor e seção">Informe a seção</span>'
      : '<span class="pdash-os is-missing" title="Operação sem O.S. no setor">Sem O.S.</span>') : '';
  // Cada operação numa linha: código (verde com O.S., vermelho sem) e o nome.
  const operations = codes.length
    ? codes.map(code => {
      const tone = productionOperationTone(item, code);
      const name = productionOperationName(item, code);
      return `<span class="pdash-tile-op" title="${escapeHtml(productionOperationTitle(tone, item))}">
          <span class="pdash-op ${tone}">${escapeHtml(code)}</span><span class="pdash-tile-op-name">${escapeHtml(name || '-')}</span></span>`;
    }).join('')
    : '<span class="pdash-tile-op"><span class="pdash-op is-empty">Sem operação</span></span>';
  const stale = item.is_current_day ? ''
    : `<span class="pdash-stale">${dashboardIcon('clock')}${entry.work_date ? `Último registro ${escapeHtml(formatIsoDateBr(entry.work_date))}` : 'Sem registro'}</span>`;
  return `<button type="button" data-panel-detail="${item.id}" class="pdash-tile ${meta.className}${item.is_current_day ? '' : ' is-stale'}" title="${escapeHtml(`${item.service_name} · ${meta.name} · ver detalhes`)}">
      <span class="pdash-tile-top">
        <strong>${escapeHtml(item.service_name || '-')}</strong>
        <span class="pdash-status ${meta.className}">${escapeHtml(meta.name)}</span>
      </span>
      <span class="pdash-place">${dashboardIcon('pin')}<span>Setor ${escapeHtml(entry.sector || '-')}${entry.section ? ` / ${escapeHtml(entry.section)}` : ''}${entry.farm ? ` · ${escapeHtml(entry.farm)}` : ''}</span></span>
      <span class="pdash-tile-ops">${operations}</span>
      <span class="pdash-tile-foot">${stale || '<span></span>'}${order}</span>
    </button>`;
}

// Resumo analítico (topo do painel): indicadores por grupo da unidade e a chuva das 4 unidades.
function dashboardGroupStats(items) {
  const stats = { total: items.length, active: 0, stopped: 0, ok: 0, missing: 0, noOperation: 0, today: 0 };
  items.forEach(item => {
    const className = statusMeta(item.entry?.status).className;
    if (className === 'is-active') stats.active += 1;
    if (className === 'is-stopped') stats.stopped += 1;
    const state = dashboardOrderState(item);
    if (state === 'ok') stats.ok += 1;
    if (state === 'missing') stats.missing += 1;
    if (state === 'no_operation') stats.noOperation += 1;
    if (item.is_current_day) stats.today += 1;
  });
  return stats;
}

// Turno atual no horário de Brasília (mesmo calendário do campo: A 00:00–07:20,
// B 07:20–15:40, C 15:40–24:00) e o instante em que ele começou.
const DASHBOARD_SHIFTS = [['A', 0, 440], ['B', 440, 940], ['C', 940, 1440]];
function dashboardCurrentShift(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(part => [part.type, part.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const [name, start, end] = DASHBOARD_SHIFTS.find(([, from, to]) => minutes >= from && minutes < to) || DASHBOARD_SHIFTS[0];
  const startAt = Math.floor(now.getTime() / 1000) - ((minutes - start) * 60 + Number(parts.second));
  const clock = value => `${String(Math.floor(value / 60) % 24).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  return { name, startAt, label: `${clock(start)}–${end === 1440 ? '24:00' : clock(end)}` };
}

// Atualizada pelo analista no turno atual (hoje e depois do início do turno).
function dashboardUpdatedInShift(item, shift) {
  return Boolean(item.is_current_day) && Number(item.entry?.updated_at || 0) >= shift.startAt;
}

function dashboardOverviewRow(name, stats, total = false) {
  const percent = (part, all) => (all ? `${Math.round(part * 100 / all)}%` : '-');
  const checked = stats.ok + stats.missing;
  return `<tr class="${total ? 'is-total' : ''}">
      <th scope="row">${escapeHtml(name)}</th>
      <td>${stats.total}</td>
      <td>${stats.active}</td>
      <td class="${stats.stopped ? 'is-red' : ''}">${stats.stopped}</td>
      <td class="${checked && stats.ok < checked ? 'is-red' : checked ? 'is-green' : ''}">${checked ? `${stats.ok}/${checked}` : '-'}<small>${percent(stats.ok, checked)}</small></td>
      <td class="${stats.missing ? 'is-red' : ''}">${stats.missing}</td>
      <td class="${stats.noOperation ? 'is-amber' : ''}">${stats.noOperation}</td>
      <td class="${stats.shiftUpdated < stats.unitTotal ? 'is-gray' : 'is-green'}">${stats.shiftUpdated}/${stats.unitTotal}<small>${percent(stats.shiftUpdated, stats.unitTotal)}</small></td>
    </tr>`;
}

// Chuva do dia nas 4 unidades (quadro gerencial fixo: não muda com a unidade escolhida).
let productionRainOverview = null;

async function loadDashboardRainOverview() {
  try {
    const data = await apiRequest(`/api/production/rain-overview?date=${encodeURIComponent(saoPauloIsoDate())}`);
    productionRainOverview = data?.rain || null;
  } catch (error) {
    console.error(error);
    productionRainOverview = null;
  }
  renderDashboardRainCard();
}

function dashboardRainValue(value) {
  return value === null || value === undefined ? '-' : `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}`;
}

function dashboardRainCardHtml() {
  const rain = productionRainOverview;
  if (!rain) return '<p class="production-empty">Não foi possível carregar a chuva das unidades.</p>';
  const max = Math.max(1, ...rain.units.map(unit => Number(unit.rain_accumulated_mm) || 0), ...rain.units.map(unit => Number(unit.rain_turn_mm) || 0));
  const units = rain.units.map(unit => {
    const informed = unit.rain_turn_mm !== null || unit.rain_accumulated_mm !== null;
    const accumulated = Number(unit.rain_accumulated_mm) || 0;
    const turn = Number(unit.rain_turn_mm) || 0;
    return `<li class="${informed ? '' : 'is-empty'}" title="${escapeHtml(productionUnitLabel(unit.unit))}">
        <span class="pdash-rain-unit"><b>${escapeHtml(unit.unit)}</b><small>${escapeHtml(PRODUCTION_UNIT_NAMES[unit.unit] || '')}</small></span>
        <span class="pdash-rain-bars" aria-hidden="true">
          <i class="is-accumulated" data-rain-width="${Math.round(accumulated * 100 / max)}"></i>
          <i class="is-turn" data-rain-width="${Math.round(turn * 100 / max)}"></i>
        </span>
        <span class="pdash-rain-values">${informed
          ? `<b>${dashboardRainValue(unit.rain_turn_mm)}</b> turno · <b>${dashboardRainValue(unit.rain_accumulated_mm)}</b> acum.`
          : 'Não informada'}</span>
      </li>`;
  }).join('');
  return `<div class="pdash-rain-average">
      <div><span>Média do turno</span><strong>${dashboardRainValue(rain.average_turn_mm)}<small>mm</small></strong></div>
      <div><span>Média acumulada</span><strong>${dashboardRainValue(rain.average_accumulated_mm)}<small>mm</small></strong></div>
    </div>
    <ul class="pdash-rain-units">${units}</ul>
    <p class="pdash-rain-legend"><i class="is-turn"></i>Turno <i class="is-accumulated"></i>Acumulada · ${rain.informed} de ${rain.units.length} unidades informaram</p>`;
}

function renderDashboardRainCard() {
  const card = document.querySelector('#production-rain-card');
  if (!card) return;
  card.innerHTML = `<header><h3>Chuva nas 4 unidades</h3><span>${productionRainOverview ? escapeHtml(formatIsoDateBr(productionRainOverview.work_date)) : ''}</span></header>
    <div class="pdash-rain-body">${dashboardRainCardHtml()}</div>`;
  // A CSP bloqueia "style" no HTML; a largura das barras é aplicada pelo script.
  card.querySelectorAll?.('[data-rain-width]').forEach(bar => { bar.style.width = `${bar.dataset.rainWidth}%`; });
}

// Resumo por grupo só com as frentes atualizadas pelo analista no turno atual:
// informação certeira do momento (o que não foi atualizado no turno não entra na conta).
function dashboardShiftStats(items, shift) {
  const updated = items.filter(item => dashboardUpdatedInShift(item, shift));
  return { ...dashboardGroupStats(updated), shiftUpdated: updated.length, unitTotal: items.length };
}

function renderDashboardOverview(groups, allItems) {
  const box = document.querySelector('#production-overview');
  if (!box) return;
  box.hidden = false;
  const shift = dashboardCurrentShift();
  const totals = dashboardShiftStats(allItems, shift);
  const groupsCard = allItems.length
    ? `<header><h3>Resumo do turno ${shift.name} <small>${shift.label}</small></h3><span>${totals.shiftUpdated} de ${allItems.length} ${allItems.length === 1 ? 'frente atualizada' : 'frentes atualizadas'} no turno</span></header>
      <div class="pdash-overview-scroll"><table class="pdash-overview-table">
        <thead><tr><th scope="col">Grupo</th><th scope="col">Frentes</th><th scope="col">Em atividade</th><th scope="col">Paradas</th>
          <th scope="col">O.S. OK</th><th scope="col">Sem O.S.</th><th scope="col">Sem operação</th><th scope="col">Atualizadas no turno</th></tr></thead>
        <tbody>${groups.map(group => dashboardOverviewRow(group.name, dashboardShiftStats(group.items, shift))).join('')}</tbody>
        <tfoot>${dashboardOverviewRow('Total', totals, true)}</tfoot>
      </table></div>
      ${totals.shiftUpdated ? '' : '<p class="pdash-overview-note">Nenhuma frente foi atualizada neste turno ainda.</p>'}`
    : '<header><h3>Resumo do turno</h3></header><p class="production-empty">Nenhuma frente lançada nesta unidade.</p>';
  box.innerHTML = `<article class="pdash-overview-card">${groupsCard}</article>
    <article id="production-rain-card" class="pdash-overview-card pdash-rain-card"></article>`;
  renderDashboardRainCard();
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
  renderDashboardOverview(ordered, allItems);
  renderDashboardGroupTabs(ordered);
  const selected = ordered.filter(group => String(group.id) === productionPanelGroup);

  cards.innerHTML = selected.map(group => {
    const total = group.items.length;
    const withOperation = group.items.filter(item => dashboardOrderState(item) !== 'no_operation' && item.entry?.sector).length;
    const ok = group.items.filter(item => dashboardOrderState(item) === 'ok').length;
    const noOrder = group.items.filter(item => dashboardOrderState(item) === 'missing').length;
    const noOperation = group.items.filter(item => dashboardOrderState(item) === 'no_operation').length;
    const today = group.items.filter(item => item.is_current_day).length;
    const stopped = group.items.filter(item => dashboardFlags(item).stopped).length;
    // Indicadores do grupo são filtros: clicar mostra só essas frentes; clicar de novo desfaz.
    const kpi = (key, label, value, tone = '') => {
      const active = dashboardPanelFilter.flag === key;
      return `<button type="button" class="pdash-kpi ${tone}${active ? ' is-active' : ''}" data-panel-filter="${key}" aria-pressed="${active}"
        title="${active ? 'Mostrar todas as frentes' : `Filtrar: ${label}`}"><b>${value}</b>${label}</button>`;
    };
    const fronts = [...new Map(group.items.map(item => [String(item.service_front_id), item.service_name])).entries()]
      .sort((a, b) => compareFrontLabels(a[1] || '', b[1] || ''));
    if (dashboardPanelFilter.front && !fronts.some(([id]) => id === dashboardPanelFilter.front)) dashboardPanelFilter.front = '';
    const visible = group.items.filter(item => dashboardMatchesFilter(item));
    const filtering = Boolean(dashboardPanelFilter.flag || dashboardPanelFilter.front);
    return `<article class="pdash-group${stopped ? ' has-stopped' : ''}">
      <header class="pdash-group-header">
        <div class="pdash-group-title">
          <span class="pdash-group-icon" aria-hidden="true">${escapeHtml(dashboardGroupInitials(group.name))}</span>
          <div><h3>${escapeHtml(group.name)}</h3><span>${total} ${total === 1 ? 'frente' : 'frentes'}</span></div>
        </div>
        <div class="pdash-kpis" role="group" aria-label="Filtros do grupo">
          ${kpi('stopped', stopped === 1 ? 'parada' : 'paradas', stopped, stopped ? 'is-red' : '')}
          ${kpi('ok', 'O.S. OK', withOperation ? `${ok}/${withOperation}` : '-', withOperation && ok < withOperation ? 'is-red' : 'is-green')}
          ${kpi('noOrder', 'sem O.S.', noOrder, noOrder ? 'is-red' : '')}
          ${kpi('noOperation', 'sem operação', noOperation, noOperation ? 'is-amber' : '')}
          ${kpi('today', 'atualizadas hoje', `${today}/${total}`, today < total ? 'is-gray' : 'is-green')}
        </div>
      </header>
      <div class="pdash-group-filters">
        <label class="pdash-front-filter">
          <span>Frente</span>
          <select data-panel-front aria-label="Filtrar por frente">
            <option value="">Todas as frentes</option>
            ${fronts.map(([id, name]) => `<option value="${escapeHtml(id)}"${id === dashboardPanelFilter.front ? ' selected' : ''}>${escapeHtml(name || '-')}</option>`).join('')}
          </select>
        </label>
        <span class="pdash-filter-count">${filtering ? `Mostrando ${visible.length} de ${total}` : `${total} ${total === 1 ? 'frente' : 'frentes'}`}</span>
        ${filtering ? '<button type="button" class="pdash-filter-clear" data-panel-filter-clear>Limpar filtros</button>' : ''}
      </div>
      <div class="pdash-group-status">${dashboardStatusBar(group.items)}</div>
      ${visible.length
        ? `<div class="pdash-tiles">${visible.map(dashboardFrontTile).join('')}</div>`
        : '<p class="production-empty pdash-filter-empty">Nenhuma frente neste filtro.</p>'}
    </article>`;
  }).join('');
  // A CSP bloqueia "style" no HTML; o tamanho de cada faixa é aplicado pelo script.
  cards.querySelectorAll?.('[data-weight]').forEach(segment => { segment.style.flexGrow = segment.dataset.weight; });
  fitDashboardTiles();
}

// Blocos das frentes ocupam a largura toda: colunas pelo espaço real (menu lateral,
// zoom e janela contam), ~270px por bloco, com as linhas equilibradas.
const DASHBOARD_TILE_MIN = 270;
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
    const maxColumns = Math.max(1, Math.floor((width + gap) / (DASHBOARD_TILE_MIN + gap)));
    // Poucas frentes (ex.: filtro ligado) mantêm a largura normal do cartão, sem esticar.
    if (quantity <= maxColumns) return { grid, columns: String(maxColumns) };
    return { grid, columns: String(Math.ceil(quantity / Math.ceil(quantity / maxColumns))) };
  });
  plans.forEach(plan => {
    if (plan && plan.grid.style.getPropertyValue('--tile-cols') !== plan.columns) plan.grid.style.setProperty('--tile-cols', plan.columns);
  });
}

document.querySelector('#production-group-tabs')?.addEventListener('click', event => {
  const tab = event.target.closest('[data-panel-group]');
  if (!tab) return;
  productionPanelGroup = tab.dataset.panelGroup;
  dashboardPanelFilter.front = '';
  dashboardPanelFilter.flag = '';
  try { localStorage.setItem(PRODUCTION_PANEL_GROUP_KEY, productionPanelGroup); } catch (_) { /* preferência opcional */ }
  renderProductionDashboard();
});
document.querySelector('#production-group-cards')?.addEventListener('click', event => {
  const filter = event.target.closest('[data-panel-filter]');
  if (filter) {
    dashboardPanelFilter.flag = dashboardPanelFilter.flag === filter.dataset.panelFilter ? '' : filter.dataset.panelFilter;
    renderProductionDashboard();
    return;
  }
  if (event.target.closest('[data-panel-filter-clear]')) {
    dashboardPanelFilter.front = '';
    dashboardPanelFilter.flag = '';
    renderProductionDashboard();
    return;
  }
  const tile = event.target.closest('[data-panel-detail]');
  if (tile) openDashboardFrontDetail(Number(tile.dataset.panelDetail));
});
document.querySelector('#production-group-cards')?.addEventListener('change', event => {
  if (!event.target.matches?.('[data-panel-front]')) return;
  dashboardPanelFilter.front = event.target.value;
  renderProductionDashboard();
});
document.querySelector('#production-front-detail-body')?.addEventListener('click', event => {
  const edit = event.target.closest('[data-panel-edit]');
  const remove = event.target.closest('[data-panel-remove]');
  if (!edit && !remove) return;
  closeModal('production-front-detail-modal');
  if (edit) openEditProductionItem(Number(edit.dataset.panelEdit));
  // Remover pede confirmação (mesma ação que ficava na tabela).
  if (remove) removeProductionItem(Number(remove.dataset.panelRemove));
});

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
