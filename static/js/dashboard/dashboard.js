// Painel (Posição de Campo): estado das unidades, consulta ao servidor e tabela de frentes.
const statusOptions = fieldStatusOptions;

const metricDefinitions = [
  { icon: '🏭', label: 'INDÚSTRIA', unit: 'TN/H' },
  { icon: '⚙️', label: 'MOAGEM TURNO', unit: 'TN/H' },
  { icon: '🚚', label: 'ENTREGA TURNO', unit: 'TN/H' },
  { icon: '⬡', label: 'ESTOQUE', unit: 'CARGAS', extra: 'stock' },
  { icon: '⚙️', label: 'MOAGEM ÚLTIMAS 3H', unit: 'TN/H' },
  { icon: '🚚', label: 'ENTREGA ÚLTIMAS 3H', unit: 'TN/H' }
];

// Apenas a identificação das unidades. Os dados operacionais vêm sempre do
// servidor: nada fictício pode ser exibido ou salvo por engano.
const defaultUnits = [
  ['PPT', 'PARAGUAÇU PAULISTA'],
  ['NRD', 'NARANDIBA'],
  ['RBR', 'RIO BRILHANTE'],
  ['PST', 'PASSA TEMPO']
].map(([code, name]) => ({
  code,
  name,
  border: 'active',
  rows: [],
  metrics: makeMetrics(),
  observation: '-',
  changes: '-',
  rain: []
}));

let units = clone(defaultUnits);
let unitMeta = {};
// Só libera edição depois que a posição oficial foi carregada do servidor.
let serverStateReady = false;
let selectedUnitIndex = Math.max(0, units.findIndex(unit => unit.code === getReportUnit()));
// Filtros apenas de visualização: não alteram os dados enviados ao servidor.
let fieldViewFilter = 'all';
let fieldSearchQuery = '';
let fieldViewUnitCode = '';

function makeMetrics(values = []) {
  return metricDefinitions.map((definition, index) => [
    definition.icon,
    definition.label,
    `${normalizeNumber(values[index] ?? 0)} ${definition.unit}`,
    definition.extra || ''
  ]);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeNumber(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : parseBrNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Lê o número do início de textos como "1.234,5 TN/H" (pt-BR) ou "958 TN/H".
function metricNumber(value) {
  const match = String(value ?? '').match(/-?\d[\d.,]*/);
  const parsed = match ? parseBrNumber(match[0].replace(/[.,]$/, '')) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeUnitsCollection(collection) {
  if (!Array.isArray(collection) || collection.length !== defaultUnits.length) return clone(defaultUnits);

  return collection.map((unit, index) => {
    const merged = {
      ...clone(defaultUnits[index]),
      ...unit,
      rows: normalizeFrontRows(Array.isArray(unit.rows) ? unit.rows : []),
      metrics: Array.isArray(unit.metrics) && unit.metrics.length === metricDefinitions.length ? unit.metrics : makeMetrics(),
      rain: standardizeFieldRainLabels(unit.code || defaultUnits[index].code, unit.rows, unit.rain)
    };

    if (merged.code === 'PST' && (!merged.name || merged.name === 'PARAÍSA TEMPO')) merged.name = 'PASSA TEMPO';
    merged.border = calculateUnitBorder(merged.rows);
    return merged;
  });
}

function applyServerPayload(data) {
  if (!Array.isArray(data?.units) || data.units.length !== defaultUnits.length) return false;
  units = normalizeUnitsCollection(data.units);
  unitMeta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  serverStateReady = true;
  renderDashboard();
  return true;
}

async function loadServerState() {
  const auth = await apiRequest('/api/auth/me');
  const userLabel = document.querySelector('#current-user');
  currentUser = auth.user || null;
  const isAdmin = currentUser?.role === 'admin';
  if (userLabel) userLabel.textContent = isAdmin
    ? `${currentUser?.name || 'Administrador'} · Admin`
    : (currentUser?.name || 'Usuário');

  const data = await apiRequest('/api/units');
  if (!applyServerPayload(data)) throw new Error('Resposta de unidades inválida.');
}

async function saveUnitToServer(index, unit, expectedVersion = unitMeta[unit?.code]?.version ?? null) {
  if (!unit) throw new Error('Unidade inválida.');
  if (!Number.isInteger(expectedVersion)) throw new Error('Versão da unidade desconhecida. Recarregue a página.');
  return apiRequest(`/api/units/${encodeURIComponent(unit.code)}`, {
    method: 'PUT',
    body: JSON.stringify({ unit, position: index, expected_version: expectedVersion })
  });
}

function normalizeStatus(status) {
  return getFieldStatus(status).label;
}

function getStatusColor(status) {
  return getFieldStatus(status).color;
}

function normalizeFrontRows(rows = []) {
  return Array.isArray(rows)
    ? rows.map(row => {
        if (!Array.isArray(row)) return row;
        const [front = '', sector = '', , status = 'EM ATIVIDADE', atr = ''] = row;
        const normalizedStatus = normalizeStatus(status);
        return [front, sector, getStatusColor(normalizedStatus), normalizedStatus, String(atr ?? '').trim()];
      })
    : [];
}

function calculateUnitBorder(rows = []) {
  const validRows = normalizeFrontRows(rows).filter(row =>
    Array.isArray(row) && (String(row[0] || '').trim() || String(row[1] || '').trim())
  );

  return fieldUnitBorder(validRows.map(row => row[3]));
}

function getUnitStateLabel(border) {
  if (border === 'critical') return 'Situação crítica';
  if (border === 'attention') return 'Atenção';
  return 'Operação normal';
}

function renderUnitSelection() {
  selectedUnitIndex = Math.max(0, units.findIndex(unit => unit.code === getReportUnit()));
  if (!units[selectedUnitIndex]) selectedUnitIndex = 0;

  const unit = units[selectedUnitIndex];
  const previewLabel = document.querySelector('#preview-unit-label');
  if (previewLabel) previewLabel.textContent = `${unit.code} — ${unit.name}`;
  const shiftLabel = document.querySelector('#preview-unit-shift');
  if (shiftLabel && fieldCurrentPeriod) {
    shiftLabel.textContent = `Turno ${fieldCurrentPeriod.shift} · ${fieldCurrentPeriod.work_date.split('-').reverse().join('/')}`;
    const hours = { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo', hour12: false };
    const start = new Date(fieldCurrentPeriod.start_at * 1000).toLocaleTimeString('pt-BR', hours);
    const end = new Date(fieldCurrentPeriod.end_at * 1000).toLocaleTimeString('pt-BR', hours);
    shiftLabel.setAttribute('title', `${start}–${end} · Horário de Brasília`);
  }

  const meta = unitMeta[unit.code] || {};
  const updatedAt = document.querySelector('#preview-unit-updated');
  if (updatedAt) {
    updatedAt.textContent = meta.updated_at
      ? `Posição atualizada: ${formatServerTimestamp(meta.updated_at, 'America/Sao_Paulo')}`
      : 'Posição ainda não atualizada';
    updatedAt.setAttribute('title', meta.updated_at ? `Atualização feita por ${meta.updated_by || '-'}` : 'Aguardando primeira atualização no servidor');
  }
  const state = document.querySelector('#preview-unit-state');
  if (state) {
    state.textContent = getUnitStateLabel(unit.border);
    state.className = `unit-state dashboard-unit-state ${unit.border}`;
  }

  const fillButton = document.querySelector('#open-data-modal');
  if (fillButton) {
    fillButton.textContent = `Preencher ${unit.code}`;
    fillButton.setAttribute('aria-label', `Preencher informações da unidade ${unit.code} — ${unit.name}`);
  }
}

function fieldUnitSummary(unit) {
  const rows = (Array.isArray(unit.rows) ? unit.rows : [])
    .filter(row => Array.isArray(row) && (String(row[0] ?? '').trim() || String(row[1] ?? '').trim()));
  const active = rows.filter(row => getFieldStatus(row[3]).group === 'active').length;
  return { total: rows.length, active, attention: rows.length - active };
}

function fieldHasRain(unit) {
  return (Array.isArray(unit.rain) ? unit.rain : []).some(row => Array.isArray(row) &&
    (normalizeNumber(row[1]) > 0 || normalizeNumber(row[2]) > 0));
}

function fieldNoteContent(raw, label) {
  const value = String(raw ?? '').trim();
  if (!value || value === '-') return '<p class="field-note-empty">Nenhum registro informado.</p>';
  // Textos extensos são acessíveis por expansão, sem remover conteúdo salvo.
  if (value.length > 230) {
    return `<p class="field-note-preview">${escapeHtml(value.slice(0, 180).trimEnd())}…</p>
      <details class="field-note-details"><summary>Ver ${escapeHtml(label)} completa</summary><p>${escapeHtml(value)}</p></details>`;
  }
  return `<p>${escapeHtml(value)}</p>`;
}

// A base cadastra descrições por Setor + Seção, mas a Posição de Campo
// informa apenas Setor. Usamos o nome somente quando não há ambiguidade.
function fieldFarmFromSector(sector) {
  if (!sectorBaseLoaded) return { name: 'Base indisponível', note: 'Não foi possível consultar a base de setores.' };
  const entries = getSectorBaseItems(sector);
  const names = new Map();
  entries.forEach(entry => {
    const name = String(entry?.description ?? '').trim();
    if (!name || name === '-') return;
    const key = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
    if (!names.has(key)) names.set(key, name);
  });
  if (names.size > 1) return {
    name: 'Verificar seção',
    note: 'Este setor possui descrições diferentes na base. A frente não informa a seção; confirme antes de associar uma fazenda.'
  };
  if (names.size === 1) return { name: names.values().next().value, note: '' };
  return { name: 'Não cadastrada', note: 'Setor sem descrição de fazenda na base.' };
}

function fieldDashboardStatusClass(status) {
  const normalized = normalizeStatus(status);
  if (normalized.startsWith('MUDANÇA')) return 'is-moving';
  if (normalized.startsWith('TRAJETO TRAVADO')) return 'is-blocked';
  if (normalized === 'AGUARDANDO PIPA') return 'is-waiting';
  return fieldStatusClass(normalized);
}

function unitCard(unit) {
  const summary = fieldUnitSummary(unit);
  const rainVisible = fieldHasRain(unit);
  const rows = unit.rows.length
    ? unit.rows.map(([front, sector, color, status, atr = ''], index) => {
      const statusClass = fieldDashboardStatusClass(status);
      const group = getFieldStatus(status).group === 'active' ? 'active' : 'attention';
      const farm = fieldFarmFromSector(sector);
      return `
      <tr class="field-front-row" data-field-front-index="${index}" data-field-group="${group}">
        <td data-label="Frente"><span class="front-cell"><i class="status-dot ${escapeHtml(color)}"></i><strong>${escapeHtml(front)}</strong></span></td>
        <td data-label="Setor" class="field-sector-cell">${escapeHtml(sector)}</td>
        <td data-label="Fazenda" class="field-farm-cell" title="${escapeHtml(farm.note || farm.name)}">${escapeHtml(farm.name)}</td>
        <td data-label="Status"><span class="field-status-chip ${statusClass}">${escapeHtml(status)}</span></td>
        <td data-label="ATR" class="field-atr-cell">${escapeHtml(atr || '—')}</td>
        <td data-label="Observações" class="field-observation-cell" data-field-summary-index="${index}" tabindex="0" aria-label="Ver acontecimentos em aberto da Frente ${escapeHtml(front)}">${fieldNotePreview(front)}</td>
        <td data-label="Detalhes" class="field-front-action-cell"><button type="button" class="field-front-details-button" data-field-front-index="${index}" aria-label="Ver detalhes da Frente ${escapeHtml(front)}" title="Ver detalhes da Frente ${escapeHtml(front)}">Ver</button></td>
      </tr>`;
    }).join('')
    : '';

  const metrics = unit.metrics.map(([, label, value, extra = '']) => `
    <div class="metric ${escapeHtml(extra)}">
      <div class="metric-info">
        <small>${escapeHtml(label)}</small>
        <strong>${escapeHtml(value)}</strong>
      </div>
    </div>
  `).join('');

  const rain = rainVisible
    ? unit.rain.filter(([eq, turn, accum]) => String(eq ?? '').trim() || normalizeNumber(turn) > 0 || normalizeNumber(accum) > 0).map(([eq, turn, accum]) => `
      <div class="rain-row"><span>${escapeHtml(eq)}</span><span>${escapeHtml(turn)}</span><span>/</span><span>${escapeHtml(accum)}</span></div>
    `).join('')
    : '';

  return `
    <article class="unit-card ${escapeHtml(unit.border)}">
      <div class="unit-layout-grid">
        <section class="dashboard-block unit-main-block" aria-label="Frentes e indicadores da unidade">
          <div class="field-overview" aria-label="Resumo das frentes desta unidade">
            <div class="field-overview-item is-total"><span>Total de frentes</span><strong>${summary.total}</strong></div>
            <div class="field-overview-item is-active"><span>Em atividade</span><strong>${summary.active}</strong></div>
            <div class="field-overview-item is-attention"><span>Em atenção</span><strong>${summary.attention}</strong></div>
          </div>

          <div class="field-list-heading">
            <div><h3>Frentes de campo</h3><p>Frentes, setores e situação operacional.</p></div>
          </div>
          <div class="field-toolbar" role="search" aria-label="Filtrar frentes de campo">
            <label class="field-search-label" for="field-front-search">
              <span class="field-search-icon" aria-hidden="true">⌕</span>
              <input id="field-front-search" type="search" placeholder="Buscar frente, setor, fazenda ou observação" autocomplete="off" value="${escapeHtml(fieldSearchQuery)}" />
            </label>
            <div class="field-status-filters" aria-label="Filtrar por condição">
              <button type="button" class="field-filter-button ${fieldViewFilter === 'all' ? 'is-selected' : ''}" data-field-filter="all" aria-pressed="${fieldViewFilter === 'all'}">Todas</button>
              <button type="button" class="field-filter-button ${fieldViewFilter === 'active' ? 'is-selected' : ''}" data-field-filter="active" aria-pressed="${fieldViewFilter === 'active'}">Em atividade</button>
              <button type="button" class="field-filter-button ${fieldViewFilter === 'attention' ? 'is-selected' : ''}" data-field-filter="attention" aria-pressed="${fieldViewFilter === 'attention'}">Em atenção</button>
            </div>
            <button type="button" id="field-filter-clear" class="field-filter-clear" ${fieldViewFilter === 'all' && !fieldSearchQuery ? 'hidden' : ''}>Limpar filtros</button>
            <small id="field-result-count" class="field-result-count" role="status" aria-live="polite"></small>
          </div>

          <div class="table-wrap status-table-wrap">
            <table class="data-table field-data-table">
              <thead><tr><th>Frente</th><th>Setor</th><th>Fazenda</th><th>Status</th><th>ATR</th><th>Observações</th><th>Ação</th></tr></thead>
              <tbody>${rows || '<tr class="field-table-empty"><td colspan="7">Aguardando preenchimento do turno</td></tr>'}
                <tr class="field-filter-empty" hidden><td colspan="7">Nenhuma frente encontrada para este filtro.</td></tr>
              </tbody>
            </table>
          </div>

          <div class="unit-metrics-strip" aria-label="Indicadores da unidade">
            <div class="field-subsection-title">Indicadores de produção</div>
            <div class="metrics-grid">${metrics}</div>
          </div>
        </section>

        <div class="unit-side-stack ${rainVisible ? '' : 'has-no-rain'}">
          ${rainVisible ? `<section class="dashboard-block rain-turn-block">
            <div class="compact-block-title">Chuva turno / acum. (mm)</div>
            <div class="rain-box">${rain}</div>
          </section>` : ''}

          <section class="dashboard-block notes-changes-block">
            <div class="notes-changes-grid">
              <div class="text-panel">
                <h4>Observação para emissão</h4>
                ${fieldNoteContent(unit.observation, 'observação')}
              </div>
              <div class="text-panel">
                <h4>Mudanças registradas</h4>
                ${fieldNoteContent(unit.changes, 'lista de mudanças')}
              </div>
            </div>
          </section>
        </div>
      </div>
    </article>
  `;
}

function applyFieldViewFilters() {
  const grid = document.querySelector('#units-grid');
  if (!grid || typeof grid.querySelectorAll !== 'function') return;
  const rows = [...grid.querySelectorAll('.field-front-row')];
  const search = fieldSearchQuery.trim().toLocaleLowerCase('pt-BR');
  let visible = 0;
  rows.forEach(row => {
    const front = row.querySelector('.front-cell')?.textContent || '';
    const sector = row.querySelector('.field-sector-cell')?.textContent || '';
    const farm = row.querySelector('.field-farm-cell')?.textContent || '';
    const note = row.querySelector('.field-observation-cell')?.textContent || '';
    const matchesText = !search || `${front} ${sector} ${farm} ${note}`.toLocaleLowerCase('pt-BR').includes(search);
    const matchesStatus = fieldViewFilter === 'all' || row.dataset.fieldGroup === fieldViewFilter;
    row.hidden = !(matchesText && matchesStatus);
    if (!row.hidden) visible += 1;
  });
  const noResults = grid.querySelector('.field-filter-empty');
  if (noResults) noResults.hidden = visible !== 0 || rows.length === 0;
  const count = grid.querySelector('#field-result-count');
  if (count) count.textContent = `Exibindo ${visible} de ${rows.length} frentes`;
  const clear = grid.querySelector('#field-filter-clear');
  if (clear) clear.hidden = fieldViewFilter === 'all' && !fieldSearchQuery.trim();
  grid.querySelectorAll('[data-field-filter]').forEach(button => {
    const selected = button.dataset.fieldFilter === fieldViewFilter;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function renderDashboard() {
  selectedUnitIndex = Math.max(0, units.findIndex(unit => unit.code === getReportUnit()));
  units.forEach(unit => { unit.border = calculateUnitBorder(unit.rows); });
  if (!units[selectedUnitIndex]) selectedUnitIndex = 0;

  const selectedUnit = units[selectedUnitIndex];
  if (fieldViewUnitCode !== selectedUnit.code) {
    fieldViewUnitCode = selectedUnit.code;
    fieldViewFilter = 'all';
    fieldSearchQuery = '';
  }
  document.querySelector('#units-grid').innerHTML = unitCard(selectedUnit);
  applyFieldViewFilters();
  renderUnitSelection();
  document.querySelectorAll('[data-unit-context]').forEach(link => {
    link.href = `${link.pathname}?unit=${encodeURIComponent(selectedUnit.code)}`;
  });
}

async function loadSectorBase({ render = false } = {}) {
  await fetchSectorBase();
  if (render) renderDashboard();
  return sectorBaseItems;
}

// Busca, filtros e abertura dos detalhes na tabela de frentes.
function setupFieldViewEvents() {
  const fieldView = document.querySelector('#units-grid');
  fieldView?.addEventListener('input', event => {
    if (event.target?.id !== 'field-front-search') return;
    fieldSearchQuery = event.target.value;
    applyFieldViewFilters();
  });
  fieldView?.addEventListener('click', event => {
    const summaryCell = event.target.closest('[data-field-summary-index]');
    if (summaryCell && fieldView.contains(summaryCell) && !event.target.closest('details, button, a')) {
      openFieldFrontDetails(Number(summaryCell.dataset.fieldSummaryIndex), true);
      return;
    }
    const detailButton = event.target.closest('button[data-field-front-index]');
    if (detailButton && fieldView.contains(detailButton)) {
      openFieldFrontDetails(Number(detailButton.dataset.fieldFrontIndex));
      return;
    }
    const clearButton = event.target.closest('#field-filter-clear');
    if (clearButton && fieldView.contains(clearButton)) {
      fieldViewFilter = 'all';
      fieldSearchQuery = '';
      const search = fieldView.querySelector('#field-front-search');
      if (search) search.value = '';
      applyFieldViewFilters();
      search?.focus();
      return;
    }
    const button = event.target.closest('[data-field-filter]');
    if (!button || !fieldView.contains(button)) return;
    fieldViewFilter = button.dataset.fieldFilter;
    applyFieldViewFilters();
  });
  fieldView?.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key) || !event.target.matches('[data-field-summary-index]')) return;
    event.preventDefault();
    openFieldFrontDetails(Number(event.target.dataset.fieldSummaryIndex), true);
  });
}
