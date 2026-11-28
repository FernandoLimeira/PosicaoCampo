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
  support: '-',
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

// Pesagem da balança: moagem, entrega e estoque calculados a partir do Excel importado.
// Quando a unidade tem cargas no dia, esses indicadores vêm da balança (core/field-indicators.js);
// "Indústria" continua sendo o valor digitado no Preencher.
let weighingSummary = null;
// Sem data, o servidor devolve o dia da última pesagem importada, até a última hora do
// SELECT: a importação vale até a próxima, a qualquer hora (inclusive depois da meia-noite).
async function loadWeighingSummary() {
  try {
    weighingSummary = await apiRequest('/api/weighings/summary');
  } catch (error) {
    console.warn('Não foi possível consultar a pesagem.', error);
    weighingSummary = null;
  }
  return weighingSummary;
}

function unitWeighing(code, summary = weighingSummary) {
  if (!summary?.reference_at) return null;
  const unit = (summary.units || []).find(item => item.code === code);
  return unit && (unit.loads_day > 0 || unit.zero_milling_at_latest_close) ? unit : null;
}

// Último dado do SELECT importado (dia e hora), no horário local da unidade (Polo MS: uma
// hora a menos que Brasília). Ex.: "14/11 22:29".
function weighingReferenceTime(code, summary = weighingSummary, closed = false) {
  const unit = code ? (summary?.units || []).find(item => item.code === code) : null;
  const moment = closed && unit?.closed_until ? unit.closed_until - 1 : unit?.data_until || summary?.reference_at;
  const timeZone = unit?.timezone || 'America/Sao_Paulo';
  const text = moment ? new Date(moment * 1000).toLocaleString('pt-BR', {
    timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '';
  return text && timeZone !== 'America/Sao_Paulo' ? `${text} (horário do MS)` : text;
}

// ATR da frente pela balança desta unidade (média ponderada pelo peso), usado quando não foi
// digitado. Cana da frente pesada em outra unidade entra no ATR daquela (troca de cana).
function weighingFrontAtr(unitCode, front, summary = weighingSummary) {
  const weighing = unitWeighing(unitCode, summary);
  const key = canonicalFieldFrontKey(front);
  const match = key && weighing?.fronts?.find(item => canonicalFieldFrontKey(item.front) === key);
  return match?.atr ? match.atr.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
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

function normalizeDashboardUnit(unit, index) {
  const merged = {
    ...clone(defaultUnits[index]),
    ...unit,
    rows: normalizeFrontRows(Array.isArray(unit.rows) ? unit.rows : []),
    metrics: Array.isArray(unit.metrics) && unit.metrics.length === metricDefinitions.length ? unit.metrics : makeMetrics()
  };
  if (merged.code === 'PST' && (!merged.name || merged.name === 'PARAÍSA TEMPO')) merged.name = 'PASSA TEMPO';
  merged.border = calculateUnitBorder(merged.rows);
  return merged;
}

function normalizeUnitsCollection(collection) {
  if (!Array.isArray(collection) || collection.length !== defaultUnits.length) return clone(defaultUnits);
  return collection.map(normalizeDashboardUnit);
}

function applyServerPayload(data) {
  if (!Array.isArray(data?.units) || data.units.length !== defaultUnits.length) return false;
  units = normalizeUnitsCollection(data.units);
  unitMeta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  serverStateReady = true;
  renderDashboard();
  return true;
}

// Depois de salvar, busca as quatro unidades de novo: quem salvou passa a ver também o que os
// colegas salvaram nas outras unidades (sem consulta periódica; só quando há um salvamento).
async function refreshUnitsAfterSave() {
  try {
    applyServerPayload(await apiRequest('/api/units', { cache: 'no-store' }));
  } catch (error) {
    console.error(error);
  }
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

async function refreshDashboardUnit(code) {
  const query = new URLSearchParams({ unit: code });
  const [position, balance] = await Promise.all([
    apiRequest(`/api/units?${query}`, { cache: 'no-store' }),
    apiRequest(`/api/weighings/summary?${query}`, { cache: 'no-store' })
  ]);
  const index = units.findIndex(unit => unit.code === code);
  const updated = position.units?.find(unit => unit.code === code);
  const meta = position.meta?.[code];
  const updatedWeighing = balance.units?.find(unit => unit.code === code);
  if (index < 0 || !updated || !Number.isInteger(meta?.version) || !updatedWeighing) {
    throw new Error('Não foi possível obter os dados da unidade selecionada.');
  }
  if (meta.version > (unitMeta[code]?.version ?? 0)) {
    units[index] = normalizeDashboardUnit(updated, index);
    unitMeta[code] = meta;
  }
  if ((balance.last_import?.imported_at ?? 0) >= (weighingSummary?.last_import?.imported_at ?? 0)) {
    const cached = (weighingSummary?.units || []).filter(unit => unit.code !== code);
    const summaries = [...cached, updatedWeighing];
    const reference = Math.max(0, ...summaries.map(unit => unit.reference_at || 0));
    weighingSummary = { ...balance, reference_at: reference || null, units: summaries };
  }
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

function renderUnitSelection(view) {
  selectedUnitIndex = Math.max(0, units.findIndex(unit => unit.code === getReportUnit()));
  if (!units[selectedUnitIndex]) selectedUnitIndex = 0;

  const unit = units[selectedUnitIndex];
  view ||= managementReportView(unit);
  const previewLabel = document.querySelector('#preview-unit-label');
  if (previewLabel) previewLabel.textContent = `${unit.code} — ${unit.name}`;
  const shiftLabel = document.querySelector('#preview-unit-shift');
  if (shiftLabel) {
    const period = view.period;
    shiftLabel.textContent = period ? `Turno ${period.shift} · ${period.work_date.split('-').reverse().join('/')}`
      : view.historical ? 'Fechamento selecionado' : 'Consultando turno…';
    const hours = { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo', hour12: false };
    const range = period ? [period.start_at, period.end_at].map(time => new Date(time * 1000).toLocaleTimeString('pt-BR', hours)).join('–') : '';
    shiftLabel.setAttribute('title', range ? `${range} · Horário de Brasília` : '');
  }

  const meta = view.meta || {};
  const updatedAt = document.querySelector('#preview-unit-updated');
  if (updatedAt) {
    updatedAt.textContent = meta.updated_at
      ? `Posição atualizada: ${formatServerTimestamp(meta.updated_at, 'America/Sao_Paulo')}`
      : view.error ? 'Fechamento indisponível' : !view.ready ? 'Consultando posição…'
        : view.historical ? 'Sem posição salva no corte' : 'Posição ainda não atualizada';
    updatedAt.setAttribute('title', meta.updated_at ? `Atualização feita por ${meta.updated_by || '-'}` : '');
  }
  const state = document.querySelector('#preview-unit-state');
  if (state) {
    state.textContent = view.unit ? getUnitStateLabel(view.unit.border) : !view.ready && !view.error ? 'Consultando situação…' : 'Posição indisponível';
    state.className = `unit-state dashboard-unit-state ${view.unit?.border || ''}`;
  }

  const fillButton = document.querySelector('#open-data-modal');
  if (fillButton) {
    fillButton.hidden = view.historical;
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

// "Indicadores do turno" do card: moagem do turno contra a indústria (barra animada), entrega
// (com a diferença para a moagem), estoque e últimas 3 h. Da balança quando há pesagem (com as
// correções do Preencher); senão, os digitados.
function panelDiff(value, unitLabel) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '<span class="wp-diff">—</span>';
  const tone = Math.round(value) === 0 ? 'is-even' : value > 0 ? 'is-up' : 'is-down';
  const sign = Math.round(value) > 0 ? '+' : '';
  const icon = tone === 'is-up' ? '▲' : tone === 'is-down' ? '▼' : '●';
  const text = tone === 'is-up' ? 'entrega acima' : tone === 'is-down' ? 'entrega abaixo' : 'equilibrado';
  return `<span class="wp-diff ${tone}" title="Entrega − moagem: ${text}"><i aria-hidden="true">${icon}</i>${sign}${fieldIndicatorNumber(value)} ${unitLabel}</span>`;
}

function panelGauge(fraction, tone) {
  const width = Math.max(0, Math.min(100, (Number(fraction) || 0) * 100));
  return `<svg class="dash-gauge" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
    <rect class="dash-gauge-track" width="100" height="8" rx="1.6" ry="4"></rect>
    ${width ? `<rect class="dash-gauge-fill is-${escapeHtml(tone)}" width="${width.toFixed(1)}" height="8" rx="1.6" ry="4"></rect>` : ''}</svg>`;
}

function unitIndicatorsHtml(unit, view) {
  const summary = view ? view.summary : weighingSummary;
  const item = fieldUnitIndicators(unit, summary);
  const number = fieldIndicatorNumber;
  const share = fieldIndustryShare(item);
  const corrected = key => (item.corrected?.includes(key) ? ' <span class="uc-corrected" title="Corrigido no Preencher">corrigido</span>' : '');
  const diff = (delivery, milling) => (delivery !== null && delivery !== undefined && milling !== null && milling !== undefined
    ? panelDiff(delivery - milling, 't/h') : '');
  const cell = (label, value, unitLabel, key, extra = '') => `<div class="uc-metric"><small>${escapeHtml(label)}${corrected(key)}</small>
      <strong>${number(value)} <em>${escapeHtml(unitLabel)}</em></strong>${extra}</div>`;
  const source = item.closingRef ? `Balança até ${escapeHtml(weighingReferenceTime(unit.code, summary, view?.historical))}`
    : view && !view.unit ? 'Sem registro no fechamento' : 'Digitados no Preencher';
  return `<section class="dashboard-block uc-indicators" aria-label="Indicadores do turno">
      <header class="uc-indicators-head"><h3>Indicadores do turno</h3><small>${source}</small></header>
      <div class="uc-milling">
        <div><small>Moagem turno${corrected('millingShift')}</small><strong>${number(item.millingShift)} <em>t/h</em></strong></div>
        <span class="ov-share is-${share?.level || 'none'}">${share ? `${share.percent}% da indústria` : 'indústria'} · ${number(item.industry)} t/h</span>
      </div>
      ${panelGauge(share ? share.share : 0, share?.level || 'none')}
      <div class="uc-metric-grid">
        ${cell('Entrega turno', item.deliveryShift, 't/h', 'deliveryShift', diff(item.deliveryShift, item.millingShift))}
        ${cell('Estoque', item.stock, 'cargas', 'stock')}
        ${cell('Moagem últ. 3 h', item.milling3h, 't/h', 'milling3h')}
        ${cell('Entrega últ. 3 h', item.delivery3h, 't/h', 'delivery3h', diff(item.delivery3h, item.milling3h))}
      </div>
    </section>`;
}

function unitCard(unit, view) {
  const summary = fieldUnitSummary(unit);
  const filters = [
    ['all', 'Todas', summary.total],
    ['active', 'Em atividade', summary.active],
    ['attention', 'Em atenção', summary.attention]
  ].map(([filter, label, count]) => {
    const selected = fieldViewFilter === filter;
    return `<button type="button" class="field-filter-button${selected ? ' is-selected' : ''}" data-field-filter="${filter}" aria-pressed="${selected}">
      <span>${label}</span><b class="field-filter-count">${count}</b></button>`;
  }).join('');
  const rows = unit.rows.length
    ? unit.rows.map(([front, sector, color, status, atr = ''], index) => {
      const statusClass = fieldDashboardStatusClass(status);
      const group = getFieldStatus(status).group === 'active' ? 'active' : 'attention';
      const farm = fieldFarmFromSector(sector);
      const weighedAtr = atr ? '' : weighingFrontAtr(unit.code, front, view ? view.summary : weighingSummary);
      return `
      <tr class="field-front-row" data-field-front-index="${index}" data-field-group="${group}">
        <td data-label="Frente" class="field-front-id-cell"><span class="front-cell"><i class="status-dot ${escapeHtml(color)}" aria-hidden="true"></i><strong>${escapeHtml(front)}</strong></span></td>
        <td data-label="Setor" class="field-sector-cell">${escapeHtml(sector)}</td>
        <td data-label="Fazenda" class="field-farm-cell" title="${escapeHtml(farm.note || farm.name)}">${escapeHtml(farm.name)}</td>
        <td data-label="Status" class="field-front-status-cell"><span class="field-status-chip ${statusClass}">${escapeHtml(status)}</span></td>
        <td data-label="ATR" class="field-atr-cell"${weighedAtr ? ' title="ATR da balança (Entrega CTT)"' : ''}>${escapeHtml(atr || weighedAtr || '—')}</td>
        <td data-label="Observações" class="field-observation-cell" data-field-summary-index="${index}" tabindex="0" aria-label="Ver acontecimentos${view?.historical ? '' : ' em aberto'} da Frente ${escapeHtml(front)}">${fieldNotePreview(front, view)}</td>
        <td data-label="Detalhes" class="field-front-action-cell"><button type="button" class="field-front-details-button" data-field-front-index="${index}" aria-label="Ver detalhes da Frente ${escapeHtml(front)}" title="Ver detalhes da Frente ${escapeHtml(front)}">Ver</button></td>
      </tr>`;
    }).join('')
    : '';

  const indicators = unitIndicatorsHtml(unit, view);
  const empty = view?.historical && !view.unit ? 'Sem posição registrada antes deste fechamento.' : 'Aguardando preenchimento do turno';

  return `
    <article class="unit-card ${escapeHtml(unit.border)}">
      <div class="unit-layout-grid">
        <section class="dashboard-block unit-main-block" aria-labelledby="field-fronts-title">
          <header class="field-list-heading">
            <h3 id="field-fronts-title">Frentes de campo</h3>
            <div class="field-search" role="search" aria-label="Buscar frentes de campo">
              <label class="field-search-label" for="field-front-search">
                <span class="field-search-icon" aria-hidden="true"></span>
                <input id="field-front-search" type="search" aria-label="Buscar por frente, setor, fazenda ou observação" placeholder="Buscar frente, setor ou fazenda" autocomplete="off" value="${escapeHtml(fieldSearchQuery)}" />
              </label>
            </div>
          </header>
          <div class="field-toolbar">
            <div class="field-status-filters" role="group" aria-label="Filtrar por situação operacional">${filters}</div>
            <div class="field-toolbar-meta">
              <small id="field-result-count" class="field-result-count" role="status" aria-live="polite"></small>
              <button type="button" id="field-filter-clear" class="field-filter-clear" ${fieldViewFilter === 'all' && !fieldSearchQuery ? 'hidden' : ''}>Limpar filtros</button>
            </div>
          </div>

          <div class="table-wrap status-table-wrap">
            <table class="data-table field-data-table">
              <thead><tr><th scope="col">Frente</th><th scope="col">Setor</th><th scope="col">Fazenda</th><th scope="col">Status</th><th scope="col">ATR</th><th scope="col">Observações</th><th scope="col">Ação</th></tr></thead>
              <tbody>${rows || `<tr class="field-table-empty"><td colspan="7">${empty}</td></tr>`}
                <tr class="field-filter-empty" hidden><td colspan="7">Nenhuma frente encontrada para este filtro.</td></tr>
              </tbody>
            </table>
          </div>

        </section>

        <div class="unit-side-stack">
          ${indicators}
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
  if (count) count.textContent = fieldViewFilter !== 'all' || search ? `Exibindo ${visible} de ${rows.length} frentes` : '';
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
  const view = managementReportView(selectedUnit);
  if (fieldViewUnitCode !== selectedUnit.code) {
    fieldViewUnitCode = selectedUnit.code;
    fieldViewFilter = 'all';
    fieldSearchQuery = '';
  }
  // Resumo e detalhes da unidade selecionada.
  renderManagementReport(view);
  const unit = view.unit || { code: selectedUnit.code, name: selectedUnit.name, rows: [], metrics: [], border: 'active' };
  document.querySelector('#units-grid').innerHTML = view.ready ? unitCard(unit, view) : '';
  applyFieldViewFilters();
  renderUnitSelection(view);
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
