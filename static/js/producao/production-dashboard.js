// Painel gerencial da Produção Agrícola: a página da Produção concentra tudo nele.
// Usa os mesmos lançamentos da tabela (productionItems) e os status cadastrados.
// Filtros da unidade, com todos os setores de cada frente visível.
const dashboardPanelFilter = { group: '', front: '', flag: '' };

function dashboardFrontMatchesFlag(sectors, flag) {
  if (flag === 'stopped') return sectors.every(item => dashboardFlags(item).stopped);
  return sectors.some(item => {
    const state = dashboardOrderState(item);
    switch (flag) {
      case 'ok': return state === 'ok';
      case 'noOrder': return state === 'missing';
      case 'noOperation': return state === 'no_operation';
      case 'today': return Boolean(item.is_current_day);
      default: return true;
    }
  });
}

function dashboardFrontGroups(items, groupKey = item => item.service_front_id ?? item.id) {
  const groups = new Map();
  for (const item of items) {
    const key = groupKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()];
}

function dashboardFrontStatus(sectors) {
  return sectors.find(item => statusMeta(item.entry?.status).className === 'is-active')
    || sectors.find(item => !dashboardFlags(item).stopped) || sectors[0];
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
  return Array.isArray(productionItems) ? consolidateProductionItems(productionItems) : [];
}

const DASHBOARD_ICONS = {
  pin: '<path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
function dashboardIcon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DASHBOARD_ICONS[name]}</svg>`;
}

function dashboardStatusBar(items) {
  const fronts = dashboardFrontGroups(items).map(dashboardFrontStatus);
  const counts = productionStatuses.map(status => ({
    status, count: fronts.filter(item => item.entry?.status === status.code).length
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

// Setores lançados juntos na mesma frente (o mesmo cartão do painel).
function dashboardCardKey(item) {
  return item.sector_group_id ? `${item.service_front_id}:${item.sector_group_id}` : item.id;
}

function dashboardFrontSectors(item) {
  const key = dashboardCardKey(item);
  return dashboardItems().filter(other => dashboardCardKey(other) === key)
    .sort((a, b) => compareFrontLabels(a.entry?.sector || '', b.entry?.sector || '')
      || compareFrontLabels(a.entry?.section || '', b.entry?.section || ''));
}

function dashboardPlotsText(plots) {
  return plots.length ? `${plots.length === 1 ? 'Talhão' : 'Talhões'} ${plots.join(', ')}` : '';
}

// Detalhe consolidado de uma frente com vários setores: as operações agrupadas pela
// operação (uma linha por setor), as outras O.S. dos setores e um bloco por setor.
function dashboardConsolidatedDetailHtml(sectors, editable) {
  const front = dashboardFrontStatus(sectors);
  const meta = statusMeta(front.entry?.status);
  const sectionUnit = productionUnitUsesSection(currentProductionUnit());
  const place = item => {
    const entry = item.entry || {};
    return `Setor ${entry.sector || '-'}${sectionUnit && entry.section ? ` / Seção ${entry.section}` : ''}`;
  };
  // Operações: código -> setores em que foi lançada.
  const operations = new Map();
  let checked = 0;
  let withOrder = 0;
  for (const item of sectors) {
    for (const code of splitProductionOperations(item.entry?.operation)) {
      const key = productionOperationKey(code);
      if (!operations.has(key)) operations.set(key, { code, name: '', rows: [] });
      const group = operations.get(key);
      const info = dashboardOperationInfo(item, code);
      group.name ||= info.name;
      group.rows.push({ item, info });
      if (info.tone) checked += 1;
      if (info.tone === 'is-order-ok') withOrder += 1;
    }
  }
  const operationsHtml = [...operations.values()]
    .sort((a, b) => compareFrontLabels(a.code, b.code))
    .map(group => {
      const ok = group.rows.filter(row => row.info.tone === 'is-order-ok').length;
      const tone = group.rows.some(row => row.info.tone) ? (ok === group.rows.length ? 'is-order-ok' : 'is-order-missing') : '';
      const lines = group.rows.map(({ item, info }) => {
        const opened = [...new Set(info.orders.map(order => order.opened_on).filter(Boolean).map(date => serviceOrderDate(date)))];
        const details = [info.label, dashboardPlotsText(info.plots), opened.length ? `Abertura ${opened.join(', ')}` : '']
          .filter(Boolean).join(' · ');
        return `<p class="pfd-op-line ${info.tone}"><b>${escapeHtml(place(item))}</b>${escapeHtml(details)}</p>`;
      }).join('');
      return `<article class="pfd-op ${tone}">
        <header>
          <span class="pfd-op-code">${escapeHtml(group.code)}</span>
          <span class="pfd-op-name">${escapeHtml(group.name || 'Operação sem nome no cadastro')}</span>
          <span class="pfd-op-badge ${tone}">${ok}/${group.rows.length} ${group.rows.length === 1 ? 'setor' : 'setores'} com O.S.</span>
        </header>
        ${lines}
      </article>`;
    }).join('');

  // Outras O.S. abertas nos setores (que não conferem com o lançado), agrupadas pela operação.
  const others = new Map();
  for (const item of sectors) {
    for (const order of (item.service_order?.orders || []).filter(order => !order.matches)) {
      const key = productionOperationKey(order.operation);
      if (!others.has(key)) others.set(key, { code: order.operation || '-', name: order.operation_name || '', rows: [] });
      const group = others.get(key);
      group.name ||= order.operation_name || '';
      group.rows.push({ item, order });
    }
  }
  const otherCount = [...others.values()].reduce((sum, group) => sum + group.rows.length, 0);
  const othersHtml = [...others.values()]
    .sort((a, b) => compareFrontLabels(a.code, b.code))
    .map(group => `<article class="pfd-op is-other">
        <header>
          <span class="pfd-op-code">${escapeHtml(group.code)}</span>
          <span class="pfd-op-name">${escapeHtml(group.name || 'Operação sem nome no cadastro')}</span>
          <span class="pfd-op-badge">${group.rows.length} O.S.</span>
        </header>
        ${group.rows.map(({ item, order }) => {
          const details = [`O.S. ${order.number}`, dashboardPlotsText(order.plots || []),
            sectionUnit && order.section ? `Seção ${order.section}` : '',
            order.opened_on ? `Abertura ${serviceOrderDate(order.opened_on)}` : ''].filter(Boolean).join(' · ');
          return `<p class="pfd-op-line"><b>${escapeHtml(place(item))}</b>${escapeHtml(details)}</p>`;
        }).join('')}
      </article>`).join('');

  // Um bloco por setor: situação, fazenda, atualização, operações e anotações.
  const sectorsHtml = sectors.map(item => {
    const entry = item.entry || {};
    const sectorMeta = statusMeta(entry.status);
    const codes = splitProductionOperations(entry.operation);
    const updated = dashboardUpdateText(item);
    return `<article class="pfd-sector ${sectorMeta.className}">
        <header>
          <strong>${escapeHtml(place(item))}</strong>
          <span class="pdash-status ${sectorMeta.className}">${escapeHtml(sectorMeta.name)}</span>
          ${item.is_current_day ? '' : `<span class="pdash-stale">${dashboardIcon('clock')}Não atualizado hoje</span>`}
        </header>
        <p class="pfd-op-line"><b>Fazenda</b>${escapeHtml(entry.farm || '-')}</p>
        <p class="pfd-op-line"><b>Operações</b>${escapeHtml(codes.join(', ') || 'Sem operação')}</p>
        ${dashboardSectionWarning(item)}
        ${updated ? `<p class="pfd-op-line"><b>Atualização</b>${escapeHtml(updated.replace(/^Atualização /, ''))}</p>` : ''}
        ${editable ? `<div class="pfd-sector-actions"><button class="modal-button danger" type="button" data-panel-remove="${item.id}">Remover setor</button></div>` : ''}
      </article>`;
  }).join('');

  const stale = sectors.filter(item => !item.is_current_day).length;
  const check = checked
    ? `<span class="pfd-hero-check ${withOrder === checked ? 'is-order-ok' : 'is-order-missing'}">${withOrder}/${checked} operações com O.S.</span>`
    : '<span class="pfd-hero-check">Sem operação informada</span>';
  const tab = (key, label, count, active = false) => `<button type="button" role="tab" class="pfd-tab${active ? ' is-active' : ''}"
      aria-selected="${active}" data-pfd-tab="${key}">${label}${count ? ` <small>${count}</small>` : ''}</button>`;
  return `<div class="pfd-hero ${meta.className}">
      <span class="pdash-status ${meta.className}">${escapeHtml(meta.name)}</span>
      <span class="pfd-hero-check">${sectors.length} setores</span>
      ${check}
      ${stale ? `<span class="pdash-stale">${dashboardIcon('clock')}${stale === 1 ? '1 setor não atualizado hoje' : `${stale} setores não atualizados hoje`}</span>` : ''}
    </div>
    <dl class="pfd-info">
      <div><dt>Setores</dt><dd>${escapeHtml(sectors.map(item => item.entry?.sector || '-').join(', '))}</dd></div>
      <div><dt>Equipe do turno</dt><dd>${productionResponsibleHtml(front, undefined, true)}</dd></div>
    </dl>
    <div class="pfd-tabs" role="tablist" aria-label="Detalhe da frente">
      ${tab('operations', 'Operações', operations.size, true)}
      ${tab('others', 'Outras O.S. nos setores', otherCount)}
      ${tab('sectors', 'Setores', sectors.length)}
    </div>
    <section class="pfd-section" data-pfd-panel="operations">
      ${operationsHtml || '<p class="production-empty">Nenhuma operação informada nos setores desta frente.</p>'}
    </section>
    <section class="pfd-section" data-pfd-panel="others" hidden>
      ${othersHtml || '<p class="production-empty">Nenhuma outra O.S. aberta nos setores desta frente.</p>'}
    </section>
    <section class="pfd-section" data-pfd-panel="sectors" hidden>${sectorsHtml}</section>
    ${editable ? `<div class="pdash-detail-actions">
      <span class="pfd-actions-note">Remover um setor fica na aba Setores.</span>
      <button class="modal-button save" type="button" data-panel-edit="${front.id}">Editar frente</button>
    </div>` : ''}`;
}

// Popup "Detalhe da frente": situação, dados do local e cada operação com a O.S. e os talhões.
// Frente com vários setores lançados juntos: um detalhe só, consolidado.
function openDashboardFrontDetail(itemId) {
  const item = findProductionItem(itemId);
  const body = document.querySelector('#production-front-detail-body');
  if (!item || !body) return;
  const entry = item.entry || {};
  const editable = canFillProduction();
  const sectors = dashboardFrontSectors(item);
  if (sectors.length > 1) {
    const title = document.querySelector('#production-front-detail-title');
    if (title) title.textContent = item.service_name || 'Frente';
    const context = document.querySelector('#production-front-detail-context');
    if (context) context.textContent = productionUnitLabel(currentProductionUnit());
    renderDashboardDetail(body, dashboardConsolidatedDetailHtml(sectors, editable), sectors, editable);
    openModal('production-front-detail-modal');
    return;
  }
  const meta = statusMeta(entry.status);
  const codes = splitProductionOperations(entry.operation);
  const title = document.querySelector('#production-front-detail-title');
  if (title) title.textContent = item.service_name || 'Frente';
  const context = document.querySelector('#production-front-detail-context');
  if (context) context.textContent = productionUnitLabel(currentProductionUnit());
  const info = [
    ['Setor', entry.sector || '-'],
    ...(productionUnitUsesSection(currentProductionUnit()) ? [['Seção', entry.section || '-']] : []),
    ['Fazenda', entry.farm || '-'],
    ['Atualização', entry.work_date ? formatIsoDateBr(entry.work_date) : 'Sem registro'],
    ['Equipe do turno', { html: productionResponsibleHtml(item, undefined, true) }]
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
  // Outras O.S. abertas no setor (as que não conferem com as operações do lançamento): mostram
  // se o setor tem O.S. de outra operação ou de outra seção.
  const others = (item.service_order?.orders || []).filter(order => !order.matches)
    .sort((a, b) => compareFrontLabels(a.operation || '', b.operation || '') || compareFrontLabels(a.number || '', b.number || ''));
  const otherOrders = others.map(order => `<article class="pfd-op is-other">
        <header>
          <span class="pfd-op-code">${escapeHtml(order.operation || '-')}</span>
          <span class="pfd-op-name">${escapeHtml(order.operation_name || 'Operação sem nome no cadastro')}</span>
          <span class="pfd-op-badge">O.S. ${escapeHtml(order.number)}</span>
        </header>
        ${(order.plots || []).length ? `<p class="pfd-op-line"><b>${order.plots.length === 1 ? 'Talhão' : `Talhões (${order.plots.length})`}</b>${escapeHtml(order.plots.join(', '))}</p>` : ''}
        ${productionUnitUsesSection(currentProductionUnit()) ? `<p class="pfd-op-line"><b>Seção</b>${escapeHtml(order.section || '-')}${order.opened_on ? ` · aberta em ${escapeHtml(serviceOrderDate(order.opened_on))}` : ''}</p>`
          : order.opened_on ? `<p class="pfd-op-line"><b>Abertura</b>${escapeHtml(serviceOrderDate(order.opened_on))}</p>` : ''}
      </article>`).join('');
  const check = codes.length
    ? `<span class="pfd-hero-check ${okCount === codes.length ? 'is-order-ok' : 'is-order-missing'}">${okCount}/${codes.length} ${codes.length === 1 ? 'operação' : 'operações'} com O.S.</span>`
    : '<span class="pfd-hero-check">Sem operação informada</span>';
  renderDashboardDetail(body, `<div class="pfd-hero ${meta.className}">
      <span class="pdash-status ${meta.className}">${escapeHtml(meta.name)}</span>
      ${check}
      ${item.is_current_day ? '' : `<span class="pdash-stale">${dashboardIcon('clock')}Não atualizada hoje</span>`}
    </div>
    <dl class="pfd-info">${info.map(([label, value]) => `<div><dt>${label}</dt><dd>${value?.html ?? escapeHtml(value)}</dd></div>`).join('')}</dl>
    ${dashboardSectionWarning(item)}
    ${entry.sector ? `<div class="pfd-tabs" role="tablist" aria-label="O.S. da frente">
      <button type="button" role="tab" class="pfd-tab is-active" aria-selected="true" data-pfd-tab="operations">Operações${codes.length ? ` <small>${codes.length}</small>` : ''}</button>
      <button type="button" role="tab" class="pfd-tab" aria-selected="false" data-pfd-tab="others">Outras O.S. no setor${others.length ? ` <small>${others.length}</small>` : ''}</button>
    </div>` : ''}
    <section class="pfd-section" data-pfd-panel="operations">
      ${entry.sector ? '' : `<h3>Operações ${codes.length ? `<small>${codes.length}</small>` : ''}</h3>`}
      ${operations || '<p class="production-empty">Nenhuma operação informada neste lançamento.</p>'}
    </section>
    ${entry.sector ? `<section class="pfd-section" data-pfd-panel="others" hidden>
      ${otherOrders || `<p class="production-empty">Nenhuma outra O.S. aberta no setor ${escapeHtml(entry.sector)}.</p>`}
    </section>` : ''}
    ${editable ? `<div class="pdash-detail-actions">
      <button class="modal-button danger" type="button" data-panel-remove="${item.id}">Remover</button>
      <button class="modal-button save" type="button" data-panel-edit="${item.id}">Editar frente</button>
    </div>` : ''}`, [item], editable);
  openModal('production-front-detail-modal');
}

// Ícone de cada status (ao lado do nome da frente) e das operações (✓ com O.S., ✕ sem).
const DASHBOARD_STATUS_ICONS = {
  'is-active': '<path d="M8 5.5v13l10.5-6.5z"/>',
  'is-wet': '<path d="M12 3.5s6 6.4 6 10.6a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5z"/>',
  'is-waiting': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  'is-stopped': '<rect x="7" y="7" width="10" height="10" rx="1.5"/>'
};
const DASHBOARD_ORDER_ICONS = {
  'is-order-ok': '<path d="m5 12.5 4.2 4.2L19 7"/>',
  'is-order-missing': '<path d="M7 7l10 10M17 7 7 17"/>'
};
function dashboardSvg(paths, filled = false) {
  return `<svg viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function dashboardUpdateText(item) {
  const entry = item.entry || {};
  if (!entry.updated_at) return '';
  const when = new Date(entry.updated_at * 1000);
  const time = when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const day = item.is_current_day ? `hoje ${time}` : `${formatIsoDateBr(entry.work_date || '').slice(0, 5)} ${time}`;
  return `Atualização ${day}`;
}

// Problemas primeiro (parada, sem O.S., sem operação ou registro de outro dia).
function dashboardTilePriority(item) {
  const flags = dashboardFlags(item);
  if (flags.stopped) return 0;
  if (flags.noOrder) return 1;
  if (flags.noOperation) return 2;
  if (flags.stale) return 3;
  return 4;
}
function dashboardSortTiles(items) {
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => dashboardTilePriority(a.item) - dashboardTilePriority(b.item)
      || compareFrontLabels(a.item.service_name || '', b.item.service_name || '') || a.index - b.index)
    .map(({ item }) => item);
}

const DASHBOARD_NOTE_FIELDS = { observation: ['Observação', 'Adicionar observação'], changes: ['Previsão de mudança', 'Adicionar previsão'] };

function dashboardSectionWarning(item) {
  const warning = item.section_warning;
  if (!warning) return '';
  const detail = warning.saved ? `Seção gravada ${warning.saved} · Cadastro ${warning.choices.join(', ')}` : 'Confirme a seção no cadastro';
  return `<span class="pdash-os is-missing">${escapeHtml(detail)}</span>`;
}

// frontStatus: o status já mostrado no cabeçalho do cartão; o setor só repete o status
// quando é diferente (ex.: um setor em atividade e outro com solo úmido).
function dashboardSectorRow(item, frontStatus = null) {
  const entry = item.entry || {};
  const meta = statusMeta(entry.status);
  const showStatus = !frontStatus || entry.status !== frontStatus;
  const codes = splitProductionOperations(entry.operation);
  // Cada operação numa linha: ✓/✕, código colorido e o nome (menor).
  const operations = codes.length
    ? codes.map(code => {
      const tone = productionOperationTone(item, code);
      const name = productionOperationName(item, code);
      return `<span class="pdash-tile-op ${tone}" title="${escapeHtml(productionOperationTitle(tone, item))}">
          <i class="pdash-tile-op-icon">${DASHBOARD_ORDER_ICONS[tone] ? dashboardSvg(DASHBOARD_ORDER_ICONS[tone]) : ''}</i>
          <span class="pdash-op ${tone}">${escapeHtml(code)}</span><span class="pdash-tile-op-name">${escapeHtml(name || '-')}</span></span>`;
    }).join('')
    : '<span class="pdash-tile-op is-empty"><span class="pdash-op is-empty">Sem operação</span></span>';
  const section = item.service_order?.needs_section
    ? '<span class="pdash-os is-missing" title="No Polo MS a O.S. confere por setor e seção">Informe a seção</span>' : dashboardSectionWarning(item);
  const stale = item.is_current_day ? ''
    : `<span class="pdash-stale">${dashboardIcon('clock')}${entry.work_date ? `Último registro ${escapeHtml(formatIsoDateBr(entry.work_date))}` : 'Sem registro'}</span>`;
  const place = productionPlaceLabel(entry);
  return `<section class="pdash-sector-row" aria-label="${escapeHtml(place)}">
    <div class="pdash-tile-meta">
      <h5 class="pdash-place">${dashboardIcon('pin')}<span>${escapeHtml(place)}</span></h5>
      ${showStatus ? `<span class="pdash-status ${meta.className}">${escapeHtml(meta.name)}</span>` : ''}
      ${stale}
    </div>
    <div class="pdash-tile-ops">${operations}</div>
    ${section ? `<div class="pdash-sector-footer">${section}</div>` : ''}
  </section>`;
}

function dashboardFrontTile(sectors, shift) {
  const front = dashboardFrontStatus(sectors);
  const meta = statusMeta(front.entry?.status);
  const ordered = [...sectors].sort((a, b) => compareFrontLabels(a.entry?.sector || '', b.entry?.sector || '')
    || compareFrontLabels(a.entry?.section || '', b.entry?.section || ''));
  // Observações por último, depois de todos os setores (com o setor quando há mais de um).
  // O mesmo texto em todos os setores (observação da frente) aparece uma vez, sem o setor.
  const observations = ordered.map(item => ({ item, text: String(item.entry?.observation || '').trim() }))
    .filter(note => note.text);
  const distinct = [...new Set(observations.map(note => note.text))];
  const shared = distinct.length === 1 && observations.length === ordered.length;
  const notes = observations.length ? `<dl class="pdash-sector-notes pdash-front-notes"><div><dt>Observação</dt>${shared
    ? `<dd><span class="pdash-note">${escapeHtml(distinct[0])}</span></dd>`
    : observations.map(({ item, text }) =>
      `<dd>${ordered.length > 1 ? `<b>${escapeHtml(productionPlaceLabel({ ...item.entry, farm: '' }))}</b> ` : ''}<span class="pdash-note">${escapeHtml(text)}</span></dd>`).join('')}</div></dl>` : '';
  // O cartão inteiro abre o detalhe (clique, Enter ou Espaço); o botão Editar abre a edição.
  const label = `Ver detalhes · ${front.service_name || 'frente'}${ordered.length > 1 ? ` · ${ordered.length} setores` : ''}`;
  return `<article class="pdash-tile is-clickable ${meta.className}" data-panel-front-card="${front.service_front_id ?? front.id}"
    data-panel-detail="${ordered[0].id}" tabindex="0" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
    <header class="pdash-front-card-header">
      <div class="pdash-tile-name">
        <i class="pdash-status-icon ${meta.className}">${dashboardSvg(DASHBOARD_STATUS_ICONS[meta.className] || DASHBOARD_STATUS_ICONS['is-waiting'], meta.className !== 'is-waiting')}</i>
        <h4>${escapeHtml(front.service_name || '-')}</h4>
      </div>
      <div class="pdash-tile-who">${productionResponsibleHtml(front, shift)}</div>
      <span class="pdash-status ${meta.className}">${escapeHtml(meta.name)}</span>
    </header>
    ${ordered.map(item => dashboardSectorRow(item, front.entry?.status)).join('')}
    ${notes}
    ${canFillProduction() ? `<footer class="pdash-front-card-footer">
      <button type="button" class="pdash-sector-detail" data-panel-card-edit="${ordered[0].id}"
        aria-label="Editar ${escapeHtml(front.service_name || 'frente')}">Editar</button>
    </footer>` : ''}
  </article>`;
}

// Turno atual no horário de Brasília (mesmo calendário do campo: A 00:00–07:20,
// B 07:20–15:40, C 15:40–00:00).
const DASHBOARD_SHIFTS = [['A', 0, 440], ['B', 440, 940], ['C', 940, 1440]];
function dashboardCurrentShift(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(part => [part.type, part.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const [name] = DASHBOARD_SHIFTS.find(([, from, to]) => minutes >= from && minutes < to) || DASHBOARD_SHIFTS[0];
  return { name };
}

function startProductionResponsibilityClock() {
  if (!/^\/producao\/?$/.test(window.location?.pathname || '') || typeof window.setInterval !== 'function') return;
  const periodKey = () => `${saoPauloIsoDate()} ${dashboardCurrentShift().name}`;
  let period = periodKey();
  let loading = false;
  async function refreshResponsibilityPanel(force = false) {
    const nextPeriod = periodKey();
    if (document.hidden || loading || (!force && nextPeriod === period)) return;
    loading = true;
    try {
      if (await loadProductionItems(currentProductionUnit())) period = nextPeriod;
    } catch (error) {
      console.error(error);
    } finally {
      loading = false;
    }
  }
  const resume = () => refreshResponsibilityPanel(true);
  window.setInterval(() => refreshResponsibilityPanel(), 15000);
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pageshow', event => {
    if (event.persisted) return resume();
  });
}
document.addEventListener('production-page-ready', startProductionResponsibilityClock, { once: true });

// Busca de ordens de serviço abertas por setor.
const dashboardSectorSearch = { term: '', orders: [], loading: false, error: '' };
let dashboardSectorSearchTimer = null;
let dashboardSectorSearchSeq = 0;
const dashboardSectorKey = value => String(value ?? '').trim().replace(/^0+(?=\d)/, '').toLocaleUpperCase('pt-BR');

function dashboardSectorSearchHtml() {
  const { term, orders, loading, error } = dashboardSectorSearch;
  const head = `<header><h3>O.S. do setor ${escapeHtml(term)}</h3></header>`;
  if (loading) return `${head}<p class="production-empty">Buscando O.S. do setor…</p>`;
  if (error) return `${head}<p class="production-empty">${escapeHtml(error)}</p>`;
  return `${head}<div class="pdash-sector-result">${orders.length ? serviceOrdersPanelHtml(orders)
    : `<p class="production-empty">Nenhuma O.S. aberta para o setor ${escapeHtml(term)}.</p>`}</div>`;
}

async function searchDashboardSector(value, { delay = 0 } = {}) {
  clearTimeout(dashboardSectorSearchTimer);
  const term = String(value || '').trim();
  const seq = ++dashboardSectorSearchSeq;
  Object.assign(dashboardSectorSearch, { term, orders: [], loading: Boolean(term), error: '' });
  const clear = document.querySelector('#production-sector-clear');
  if (clear) clear.hidden = !term;
  renderDashboardSectorCard();
  if (!term) return;
  if (delay) {
    dashboardSectorSearchTimer = setTimeout(() => loadDashboardSectorOrders(term, seq), delay);
    return;
  }
  await loadDashboardSectorOrders(term, seq);
}

async function loadDashboardSectorOrders(term, seq) {
  try {
    const params = new URLSearchParams({ unit: currentProductionUnit(), search: dashboardSectorKey(term), summary: '1' });
    const data = await apiRequest(`/api/production/service-orders?${params}`);
    if (seq !== dashboardSectorSearchSeq) return;
    // A busca do servidor procura em vários campos; aqui fica só o setor igual ao digitado.
    dashboardSectorSearch.orders = (data.orders || []).filter(order => dashboardSectorKey(order.sector) === dashboardSectorKey(term));
  } catch (error) {
    if (seq !== dashboardSectorSearchSeq) return;
    dashboardSectorSearch.error = error.message || 'Não foi possível buscar as O.S. do setor.';
  }
  dashboardSectorSearch.loading = false;
  renderDashboardSectorCard();
}

function renderDashboardSectorCard() {
  const card = document.querySelector('#production-sector-card');
  if (!card) return;
  card.hidden = !dashboardSectorSearch.term;
  card.innerHTML = card.hidden ? '' : dashboardSectorSearchHtml();
}

function renderDashboardGroupSelector(items) {
  const tabs = document.querySelector('#production-group-tabs');
  if (!tabs) return;
  const groups = new Map();
  for (const item of items) {
    if (item.group_id != null) groups.set(String(item.group_id), item.group_name || 'Sem grupo');
  }
  // Lista vazia (a página está recarregando depois de salvar): mantém o grupo, a frente e o
  // indicador escolhidos, para o painel voltar igual quando os lançamentos chegarem.
  if (groups.size && !groups.has(dashboardPanelFilter.group)) {
    const group = groups.keys().next().value ?? '';
    if (group !== dashboardPanelFilter.group) Object.assign(dashboardPanelFilter, { group, front: '', flag: '' });
  }
  tabs.hidden = !groups.size;
  tabs.innerHTML = [...groups].map(([id, name]) =>
    `<button type="button" class="pdash-group-tab" data-panel-group="${escapeHtml(id)}" aria-pressed="${id === dashboardPanelFilter.group}" aria-controls="production-front-cards">${escapeHtml(name)}</button>`
  ).join('');
}

function renderProductionDashboard() {
  const cards = document.querySelector('#production-front-cards');
  if (!cards) return;
  const shift = dashboardCurrentShift();
  const allItems = dashboardItems();
  renderDashboardGroupSelector(allItems);
  const items = dashboardPanelFilter.group
    ? allItems.filter(item => String(item.group_id) === dashboardPanelFilter.group) : allItems;
  const blocks = dashboardFrontGroups(dashboardSortTiles(items), dashboardCardKey);
  const total = blocks.length;
  if (!total) {
    cards.innerHTML = '<p class="production-empty">Nenhuma frente lançada nesta unidade.</p>';
    return;
  }
  const options = [...new Map(blocks.map(([item]) => [String(item.service_front_id ?? item.id), item.service_name]))]
    .sort((a, b) => compareFrontLabels(a[1] || '', b[1] || ''));
  if (!options.some(([id]) => id === dashboardPanelFilter.front)) dashboardPanelFilter.front = '';
  const filters = [
    ['stopped', 'Paradas', 'is-red'], ['ok', 'O.S. OK', 'is-green'], ['noOrder', 'Sem O.S.', 'is-red'],
    ['noOperation', 'Sem operação', 'is-amber'], ['today', 'Atualizadas hoje', 'is-green']
  ];
  const counts = Object.fromEntries(filters.map(([key]) => [key, blocks.filter(sectors => dashboardFrontMatchesFlag(sectors, key)).length]));
  if (!counts[dashboardPanelFilter.flag]) dashboardPanelFilter.flag = '';
  const visible = blocks.filter(sectors => {
    const [item] = sectors;
    return (!dashboardPanelFilter.front || String(item.service_front_id ?? item.id) === dashboardPanelFilter.front)
      && dashboardFrontMatchesFlag(sectors, dashboardPanelFilter.flag);
  });
  const filtering = Boolean(dashboardPanelFilter.flag || dashboardPanelFilter.front);
  cards.innerHTML = `<section class="pdash-group" aria-label="Frentes da unidade">
    <header class="pdash-group-header">
      <h3>Frentes e serviços</h3>
      <div class="pdash-kpis" role="group" aria-label="Filtros da unidade">
        ${filters.filter(([key]) => counts[key]).map(([key, label, tone]) => {
          const active = dashboardPanelFilter.flag === key;
          return `<button type="button" class="pdash-kpi ${tone}${active ? ' is-active' : ''}"
            data-panel-filter="${key}" aria-pressed="${active}"><b>${counts[key]}</b>${label}</button>`;
        }).join('')}
      </div>
    </header>
    <div class="pdash-group-filters">
      <label class="pdash-front-filter"><span>Frente</span>
        <select data-panel-front>
          <option value="">Todas as frentes</option>
          ${options.map(([id, name]) => `<option value="${escapeHtml(id)}"${id === dashboardPanelFilter.front ? ' selected' : ''}>${escapeHtml(name || '-')}</option>`).join('')}
        </select>
      </label>
      <span class="pdash-filter-count">${filtering ? `Mostrando ${visible.length} de ${total}` : `${total} ${total === 1 ? 'lançamento' : 'lançamentos'}`}</span>
      ${filtering ? '<button type="button" class="pdash-filter-clear" data-panel-filter-clear>Limpar filtros</button>' : ''}
    </div>
    <div class="pdash-group-status">${dashboardStatusBar(items)}</div>
    ${visible.length
      ? `<div class="pdash-tiles">${visible.map(sectors => dashboardFrontTile(sectors, shift.name)).join('')}</div>`
      : '<p class="production-empty pdash-filter-empty">Nenhuma frente neste filtro.</p>'}
  </section>`;
  cards.querySelectorAll?.('[data-weight]').forEach(segment => { segment.style.flexGrow = segment.dataset.weight; });
}

// Observações na lateral do "Detalhe da frente": um campo de observação e um de previsão de
// mudança para a frente inteira, com qualquer número de setores. Cada setor guarda o texto no
// seu lançamento; ao salvar, o mesmo texto vai para todos os setores da frente, conferindo o
// texto que estava na tela (outro analista pode ter alterado: a gravação para e avisa).
let dashboardNotesDraft = null;

// Texto da frente: os textos diferentes dos setores (na ordem dos setores), um por linha.
function dashboardFrontNote(sectors, field) {
  return [...new Set(sectors.map(item => String(item.entry?.[field] || '').trim()).filter(Boolean))].join('\n');
}

function dashboardNotesAsideHtml(sectors, editable) {
  const withEntry = sectors.filter(item => item.entry);
  if (!withEntry.length) return '';
  const fields = Object.entries(DASHBOARD_NOTE_FIELDS).map(([field, [label, addLabel]]) => {
    const value = dashboardFrontNote(withEntry, field);
    const id = `pfd-note-${field}`;
    return `<label class="pfd-note-field" for="${id}"><span>${label}</span>${editable
      ? `<textarea id="${id}" rows="${field === 'observation' ? 5 : 4}" maxlength="2000" placeholder="${escapeHtml(addLabel)}"
          data-note-field="${field}">${escapeHtml(value)}</textarea>`
      : `<p class="pfd-note-text${value ? '' : ' is-empty'}">${escapeHtml(value || 'Sem registro')}</p>`}</label>`;
  }).join('');
  const scope = withEntry.length > 1 ? `<p class="pfd-notes-scope">Vale para os ${withEntry.length} setores da frente.</p>` : '';
  return `<aside class="pfd-aside" aria-label="Observações">
      <h3>Observações</h3>
      ${editable ? `<form class="pfd-notes-form" data-pfd-notes>
        ${fields}${scope}
        <p class="pfd-notes-status" role="status" hidden></p>
        <button class="modal-button save" type="submit">Salvar observações</button>
      </form>` : fields + scope}
    </aside>`;
}

// Monta o popup: conteúdo à esquerda e observações na lateral.
function renderDashboardDetail(body, main, sectors, editable) {
  const aside = dashboardNotesAsideHtml(sectors, editable);
  body.innerHTML = `<div class="pfd-layout${aside ? ' has-aside' : ''}"><div class="pfd-main">${main}</div>${aside}</div>`;
  const withEntry = sectors.filter(item => item.entry);
  dashboardNotesDraft = editable ? {
    unit: currentProductionUnit(), date: saoPauloIsoDate(), itemId: sectors[0]?.id,
    itemIds: withEntry.map(item => item.id),
    initial: Object.fromEntries(Object.keys(DASHBOARD_NOTE_FIELDS).map(field => [field, dashboardFrontNote(withEntry, field)])),
    expected: Object.fromEntries(withEntry.flatMap(item => Object.keys(DASHBOARD_NOTE_FIELDS)
      .map(field => [`${item.id}:${field}`, String(item.entry[field] || '')])))
  } : null;
}

function showDashboardNotesStatus(form, message = '', isError = true) {
  const status = form.querySelector('.pfd-notes-status');
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle('is-error', isError);
}

async function saveDashboardNotes(form) {
  const draft = dashboardNotesDraft;
  if (!draft || !canFillProduction() || draft.unit !== currentProductionUnit()) return;
  if (draft.date !== saoPauloIsoDate()) {
    showDashboardNotesStatus(form, 'A data operacional mudou. Feche e abra o detalhe para salvar no dia atual.');
    return;
  }
  // Só os campos alterados na tela; cada um vai para os setores que ainda não têm esse texto.
  const changes = [...form.querySelectorAll('[data-note-field]')]
    .map(input => ({ field: input.dataset.noteField, value: input.value.trim() }))
    .filter(change => change.value !== (draft.initial[change.field] ?? ''))
    .flatMap(change => draft.itemIds.map(itemId => ({ ...change, itemId,
      expected: draft.expected[`${itemId}:${change.field}`] ?? '' })))
    .filter(change => change.value !== change.expected.trim());
  if (!changes.length) {
    showDashboardNotesStatus(form, 'Nenhuma alteração para salvar.', false);
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  showDashboardNotesStatus(form);
  try {
    for (const change of changes) {
      await apiRequest(`/api/production/my-items/${change.itemId}`, { method: 'PATCH', body: JSON.stringify({
        unit_code: draft.unit, work_date: draft.date, field: change.field, expected: change.expected, value: change.value
      }) });
      draft.expected[`${change.itemId}:${change.field}`] = change.value;
    }
  } catch (error) {
    if (dashboardNotesDraft === draft) {
      button.disabled = false;
      showDashboardNotesStatus(form, error.message || 'Não foi possível salvar as observações.');
    }
    if (error.status === 409 && draft.unit === currentProductionUnit()) await loadProductionItems(draft.unit).catch(console.error);
    return;
  }
  showToast('Observações salvas.');
  if (draft.unit !== currentProductionUnit()) return;
  try {
    await loadProductionItems(draft.unit);
  } catch (error) {
    console.error(error);
    showToast(PRODUCTION_REFRESH_WARNING, true);
  }
  // Continua no detalhe, já com o texto salvo.
  if (dashboardNotesDraft === draft && !document.querySelector('#production-front-detail-modal')?.hidden) {
    openDashboardFrontDetail(draft.itemId);
  }
}

document.querySelector('#production-front-detail-body')?.addEventListener('submit', event => {
  const form = event.target.closest?.('[data-pfd-notes]');
  if (!form) return;
  event.preventDefault();
  saveDashboardNotes(form);
});
document.querySelector('#production-group-tabs')?.addEventListener('click', event => {
  const tab = event.target.closest('[data-panel-group]');
  if (!tab || tab.dataset.panelGroup === dashboardPanelFilter.group) return;
  const group = tab.dataset.panelGroup;
  Object.assign(dashboardPanelFilter, { group, front: '', flag: '' });
  renderProductionDashboard();
  const selected = [...event.currentTarget.querySelectorAll('[data-panel-group]')]
    .find(button => button.dataset.panelGroup === dashboardPanelFilter.group);
  selected?.focus();
});
document.querySelector('#production-front-cards')?.addEventListener('click', event => {
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
  // O ícone do WhatsApp abre a conversa, sem abrir o detalhe do cartão.
  if (event.target.closest('[data-whatsapp-link]')) return;
  const edit = event.target.closest('[data-panel-card-edit]');
  if (edit) {
    openEditProductionItem(Number(edit.dataset.panelCardEdit));
    return;
  }
  const detail = event.target.closest('[data-panel-detail]');
  if (detail) openDashboardFrontDetail(Number(detail.dataset.panelDetail));
});
// Teclado: Enter ou Espaço no cartão (não no botão Editar) abre o detalhe.
document.querySelector('#production-front-cards')?.addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key) || !event.target.matches?.('[data-panel-front-card][data-panel-detail]')) return;
  event.preventDefault();
  openDashboardFrontDetail(Number(event.target.dataset.panelDetail));
});

const dashboardSectorInput = document.querySelector('#production-sector-search');

function clearDashboardSectorSearch() {
  if (!dashboardSectorInput) return;
  dashboardSectorInput.value = '';
  searchDashboardSector('');
  dashboardSectorInput.focus();
}

dashboardSectorInput?.addEventListener('input', event => searchDashboardSector(event.target.value, { delay: 300 }));
document.querySelector('#production-sector-form')?.addEventListener('submit', event => {
  event.preventDefault();
  searchDashboardSector(dashboardSectorInput?.value);
});
document.querySelector('#production-sector-clear')?.addEventListener('click', clearDashboardSectorSearch);
dashboardSectorInput?.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !dashboardSectorSearch.term) return;
  event.preventDefault();
  clearDashboardSectorSearch();
});
// Abas do detalhe da frente: Operações do lançamento e Outras O.S. no setor.
document.querySelector('#production-front-detail-body')?.addEventListener('click', event => {
  const tab = event.target.closest?.('[data-pfd-tab]');
  if (!tab) return;
  const body = event.currentTarget;
  body.querySelectorAll('[data-pfd-tab]').forEach(button => {
    const active = button === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  body.querySelectorAll('[data-pfd-panel]').forEach(panel => { panel.hidden = panel.dataset.pfdPanel !== tab.dataset.pfdTab; });
});
document.querySelector('#production-front-cards')?.addEventListener('change', event => {
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

// Refaz as colunas dos indicadores quando a janela muda de tamanho ou de zoom.
let dashboardResizeFrame = 0;
globalThis.addEventListener?.('resize', () => {
  if (dashboardResizeFrame) return;
  dashboardResizeFrame = requestAnimationFrame(() => {
    dashboardResizeFrame = 0;
    if (typeof fitProductionSummaryColumns === 'function') fitProductionSummaryColumns();
  });
});
