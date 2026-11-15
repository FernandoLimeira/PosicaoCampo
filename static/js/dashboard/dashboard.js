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

// Pesagem da balança (Entrega CTT): moagem, entrega e estoque calculados a partir
// do Excel importado. Quando a unidade tem cargas no dia, esses indicadores vêm da
// balança; "Indústria" continua sendo o valor digitado no Preencher.
let weighingSummary = null;
const WEIGHING_METRIC_FIELDS = {
  1: 'milling_shift_tph', 2: 'delivery_shift_tph', 3: 'stock_loads',
  4: 'milling_last3h_tph', 5: 'delivery_last3h_tph'
};

// Dia pela regra "hora atual − 1 h" (weighingWorkDate, core/format.js): às 00:31 ainda vale
// o dia anterior; sem isso, a tela voltava aos valores digitados no Preencher.
async function loadWeighingSummary() {
  try {
    weighingSummary = await apiRequest(`/api/weighings/summary?date=${encodeURIComponent(weighingWorkDate())}`);
  } catch (error) {
    console.warn('Não foi possível consultar a pesagem.', error);
    weighingSummary = null;
  }
  return weighingSummary;
}

function unitWeighing(code) {
  if (!weighingSummary?.reference_at) return null;
  const unit = (weighingSummary.units || []).find(item => item.code === code);
  return unit && unit.loads_day > 0 ? unit : null;
}

// Fechamento: último segundo da última hora fechada (ex.: 20:59), no horário local da
// unidade (Polo MS: uma hora a menos que Brasília); sem ele, a referência.
function weighingReferenceTime(code) {
  const unit = code ? (weighingSummary?.units || []).find(item => item.code === code) : null;
  const closedUntil = unit ? unit.closed_until : weighingSummary?.closed_until;
  const closed = closedUntil ? closedUntil - 1 : weighingSummary?.reference_at;
  const timeZone = unit?.timezone || 'America/Sao_Paulo';
  const text = closed ? new Date(closed * 1000).toLocaleTimeString('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }) : '';
  return text && timeZone !== 'America/Sao_Paulo' ? `${text} (horário do MS)` : text;
}

// Indicadores exibidos (e sugeridos no Preencher): os da balança substituem os digitados.
function displayMetrics(unit) {
  const weighing = unitWeighing(unit.code);
  if (!weighing) return unit.metrics;
  return unit.metrics.map((metric, index) => {
    const value = weighing[WEIGHING_METRIC_FIELDS[index]];
    if (value === null || value === undefined) return metric;
    // Sem separador de milhar: "1.243" seria lido como 1,243 no Preencher (metricNumber).
    const text = String(Math.round(value));
    return [metric[0], metric[1], `${text} ${metricDefinitions[index].unit}`, metric[3]];
  });
}

// ATR da frente pela balança desta unidade (média ponderada pelo peso), usado quando não foi
// digitado. Cana da frente pesada em outra unidade entra no ATR daquela (troca de cana).
function weighingFrontAtr(unitCode, front) {
  const weighing = unitWeighing(unitCode);
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

// ---------------------------------------------------------------------------
// Painel gerencial da balança: dia, turno e últimas 3 h (moagem x entrega), gráfico
// hora a hora com os turnos, resumo dos turnos A/B/C e frentes de apoio. Usa as horas
// fechadas do resumo da pesagem (hora atual − 1 h, no horário local da unidade).
// ---------------------------------------------------------------------------
function panelNumber(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function panelDiff(value, unitLabel) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '<span class="wp-diff">—</span>';
  const tone = Math.round(value) === 0 ? 'is-even' : value > 0 ? 'is-up' : 'is-down';
  const sign = Math.round(value) > 0 ? '+' : '';
  const icon = tone === 'is-up' ? '▲' : tone === 'is-down' ? '▼' : '●';
  const text = tone === 'is-up' ? 'entrega acima' : tone === 'is-down' ? 'entrega abaixo' : 'equilibrado';
  return `<span class="wp-diff ${tone}" title="Entrega − moagem: ${text}"><i aria-hidden="true">${icon}</i>${sign}${panelNumber(value)} ${unitLabel}</span>`;
}

function panelAverage(hours, key) {
  const values = hours.map(item => item[key]).filter(value => value !== null && value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function weighingHourChart(hours) {
  const width = 960, height = 250, left = 46, right = 12, top = 14, bottom = 34;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const slot = plotWidth / 24;
  const maxValue = Math.max(0, ...hours.flatMap(item => [item.milling_t || 0, item.delivery_t || 0]));
  const step = maxValue > 1500 ? 500 : maxValue > 600 ? 250 : maxValue > 200 ? 100 : 50;
  const yMax = Math.max(step, Math.ceil((maxValue * 1.08) / step) * step);
  const y = value => top + plotHeight - (value / yMax) * plotHeight;
  const x = hour => left + hour * slot;
  const bands = [['A', 0, 7], ['B', 7, 16], ['C', 16, 24]].map(([code, from, to]) => `
    <rect class="wp-band wp-band-${code}" x="${x(from)}" y="${top}" width="${(to - from) * slot}" height="${plotHeight}"></rect>
    <text class="wp-band-label" x="${x(from) + 6}" y="${top + 12}">Turno ${code}</text>`).join('');
  const grid = Array.from({ length: Math.floor(yMax / step) + 1 }, (_, index) => index * step).map(value => `
    <line class="wp-grid" x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"></line>
    <text class="wp-axis" x="${left - 6}" y="${y(value) + 4}" text-anchor="end">${panelNumber(value)}</text>`).join('');
  const ticks = Array.from({ length: 24 }, (_, hour) => hour % 2 === 0
    ? `<text class="wp-axis" x="${x(hour) + slot / 2}" y="${height - bottom + 16}" text-anchor="middle">${String(hour).padStart(2, '0')}h</text>` : '').join('');
  const barWidth = Math.max(4, slot - 8);
  const bars = hours.map(item => {
    const value = item.milling_t || 0;
    const barHeight = Math.max(0, top + plotHeight - y(value));
    // Topo arredondado (4 px) e base reta na linha de zero.
    const r = Math.min(4, barHeight, barWidth / 2);
    return barHeight > 0 ? `<path class="wp-bar" d="M${x(item.hour) + 4},${top + plotHeight} v${-(barHeight - r)} q0,-${r} ${r},-${r} h${barWidth - 2 * r} q${r},0 ${r},${r} v${barHeight - r} z"></path>` : '';
  }).join('');
  const points = hours.filter(item => item.delivery_t !== null && item.delivery_t !== undefined)
    .map(item => [x(item.hour) + slot / 2, y(item.delivery_t), item]);
  const line = points.length > 1 ? `<polyline class="wp-line" points="${points.map(([px, py]) => `${px},${py}`).join(' ')}"></polyline>` : '';
  const dots = points.map(([px, py]) => `<circle class="wp-dot" cx="${px}" cy="${py}" r="4"></circle>`).join('');
  const last = points.at(-1);
  const lastBar = hours.at(-1);
  // Rótulos diretos só na última hora fechada (o resto fica no tooltip e na tabela).
  const labels = last && lastBar ? `
    <text class="wp-direct wp-direct-line" x="${Math.min(last[0] + 8, width - right - 4)}" y="${last[1] - 8}" text-anchor="${last[0] > width - 90 ? 'end' : 'start'}">Entrega ${panelNumber(last[2].delivery_t)}</text>
    <text class="wp-direct" x="${Math.min(x(lastBar.hour) + slot / 2, width - right - 4)}" y="${y(lastBar.milling_t || 0) + 16}" text-anchor="middle">${panelNumber(lastBar.milling_t)}</text>` : '';
  // Áreas de toque maiores que as marcas: cada hora mostra moagem, entrega e CVs.
  const hits = hours.map(item => `<rect class="wp-hit" x="${x(item.hour)}" y="${top}" width="${slot}" height="${plotHeight}" tabindex="0"
      aria-label="${String(item.hour).padStart(2, '0')}h: moagem ${panelNumber(item.milling_t)} t, entrega ${panelNumber(item.delivery_t)} t, ${panelNumber(item.trucks)} CVs">
      <title>${String(item.hour).padStart(2, '0')}:00 · Turno ${item.shift}
Moagem ${panelNumber(item.milling_t, 1)} t (${panelNumber(item.loads)} cargas)
Cana entregue ${panelNumber(item.delivery_t, 1)} t (${panelNumber(item.trucks)} CVs)
Densidade ${panelNumber(item.density_t, 2)} t</title></rect>`).join('');
  return `<svg class="wp-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Moagem e cana entregue por hora (t)">
    ${bands}${grid}<line class="wp-baseline" x1="${left}" x2="${width - right}" y1="${top + plotHeight}" y2="${top + plotHeight}"></line>
    ${bars}${line}${dots}${labels}${ticks}${hits}</svg>`;
}

function weighingPanel(unit) {
  const weighing = unitWeighing(unit.code);
  if (!weighing?.hours?.length) return '';
  const hours = weighing.hours;
  const shiftCode = weighing.shift || hours.at(-1).shift;
  const shiftHours = hours.filter(item => item.shift === shiftCode);
  const recent = hours.slice(-3);
  const total = key => hours.reduce((sum, item) => sum + (item[key] || 0), 0);
  const groups = [
    ['Dia', `00h às ${String(hours.at(-1).hour).padStart(2, '0')}h`, weighing.milling_day_t, weighing.delivery_day_t, 't'],
    [`Turno ${shiftCode}`, 'média por hora', weighing.milling_shift_tph, weighing.delivery_shift_tph, 't/h'],
    ['Últimas 3 h', 'média por hora', weighing.milling_last3h_tph, weighing.delivery_last3h_tph, 't/h'],
    // Projeção (quadro "Projeções" da planilha): média por hora do dia × 24.
    ['Projeção do dia', 'média do dia × 24 h', weighing.milling_projection_t, weighing.delivery_projection_t, 't'],
  ].map(([title, hint, milling, delivery, unitLabel]) => `
    <div class="wp-kpi-group">
      <div class="wp-kpi-title"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(hint)}</small></div>
      <div class="wp-kpi-values">
        <div><small><svg class="wp-key" width="10" height="10" aria-hidden="true"><rect class="wp-bar" width="10" height="10" rx="2"></rect></svg>Moagem</small><strong>${panelNumber(milling)}</strong><span>${unitLabel}</span></div>
        <div><small><svg class="wp-key" width="14" height="10" aria-hidden="true"><line class="wp-line" x1="1" x2="13" y1="5" y2="5"></line></svg>Entrega</small><strong>${panelNumber(delivery)}</strong><span>${unitLabel}</span></div>
      </div>
      ${panelDiff(delivery !== null && milling !== null ? delivery - milling : null, unitLabel)}
    </div>`).join('');
  const previous = hours.at(-2);
  const lastHour = hours.at(-1);
  const trend = previous ? (lastHour.milling_t || 0) - (previous.milling_t || 0) : null;
  const shifts = ['A', 'B', 'C'].map(code => {
    const rows = hours.filter(item => item.shift === code);
    if (!rows.length) return '';
    const milling = rows.reduce((sum, item) => sum + (item.milling_t || 0), 0);
    const delivery = rows.reduce((sum, item) => sum + (item.delivery_t || 0), 0);
    return `<tr${code === shiftCode ? ' class="is-current"' : ''}><th scope="row">Turno ${code}<small>${rows.length} ${rows.length === 1 ? 'hora' : 'horas'}</small></th>
      <td>${panelNumber(milling)}</td><td>${panelNumber(delivery)}</td><td>${panelDiff(delivery - milling, 't')}</td>
      <td>${panelNumber(panelAverage(rows, 'milling_t'))}</td><td>${panelNumber(panelAverage(rows, 'delivery_t'))}</td></tr>`;
  }).join('');
  const hourRows = hours.map(item => `<tr><th scope="row">${String(item.hour).padStart(2, '0')}:00</th><td>${panelNumber(item.milling_t, 1)}</td>
      <td>${panelNumber(item.loads)}</td><td>${panelNumber(item.density_t, 2)}</td><td>${panelNumber(item.trucks)}</td><td>${panelNumber(item.delivery_t, 1)}</td></tr>`).join('');
  const support = (weighing.received || []).map(front => `<li><strong>Frente ${escapeHtml(front.front)}</strong> de ${escapeHtml(front.home_unit)}
      · ${panelNumber(front.tons)} t · ${panelNumber(front.loads)} cargas${front.atr ? ` · ATR ${panelNumber(front.atr, 2)}` : ''}</li>`).join('');
  return `
    <section class="dashboard-block weighing-panel" aria-labelledby="weighing-panel-title">
      <header class="wp-header">
        <div><h3 id="weighing-panel-title">Painel gerencial · Balança</h3>
          <p>Moagem pela saída da balança e entrega pelos CVs × 2 × densidade · dados até ${escapeHtml(weighingReferenceTime(unit.code))}</p></div>
        <div class="wp-side-stats">
          <div><small>Estoque no pátio</small><strong>${panelNumber(weighing.stock_loads)}</strong><span>cargas</span></div>
          <div><small>Última hora (${String(lastHour.hour).padStart(2, '0')}h)</small><strong>${panelNumber(lastHour.milling_t)}</strong><span>t ${trend === null ? '' : panelDiff(trend, 't').replace('wp-diff', 'wp-diff wp-trend').replace(/title="[^"]*"/, 'title="Moagem da última hora em relação à anterior"')}</span></div>
          <div><small>ATR do dia</small><strong>${panelNumber(weighing.atr, 2)}</strong><span>kg/t</span></div>
        </div>
      </header>
      <div class="wp-kpis">${groups}</div>
      <figure class="wp-chart">
        <figcaption><strong>Hora a hora (t)</strong>
          <span class="wp-legend"><span><svg class="wp-key" width="10" height="10" aria-hidden="true"><rect class="wp-bar" width="10" height="10" rx="2"></rect></svg>Moagem</span><span><svg class="wp-key" width="14" height="10" aria-hidden="true"><line class="wp-line" x1="1" x2="13" y1="5" y2="5"></line></svg>Cana entregue</span></span></figcaption>
        <div class="wp-chart-wrap">${weighingHourChart(hours)}</div>
      </figure>
      <div class="wp-bottom">
        <div class="table-wrap"><table class="wp-table">
          <thead><tr><th>Turno</th><th>Moagem (t)</th><th>Entrega (t)</th><th>Diferença</th><th>Média moagem</th><th>Média entrega</th></tr></thead>
          <tbody>${shifts}
            <tr class="is-total"><th scope="row">Dia</th><td>${panelNumber(total('milling_t'))}</td><td>${panelNumber(total('delivery_t'))}</td>
              <td>${panelDiff(total('delivery_t') - total('milling_t'), 't')}</td><td>${panelNumber(panelAverage(hours, 'milling_t'))}</td><td>${panelNumber(panelAverage(hours, 'delivery_t'))}</td></tr>
          </tbody></table></div>
        ${support ? `<div class="wp-support"><h4>Frentes de apoio entregando aqui</h4><ul>${support}</ul></div>` : ''}
      </div>
      <details class="wp-hours"><summary>Ver tabela hora a hora</summary>
        <div class="table-wrap"><table class="wp-table">
          <thead><tr><th>Hora</th><th>Moagem (t)</th><th>Cargas</th><th>Densidade (t)</th><th>Qtd. CVs</th><th>Cana entregue (t)</th></tr></thead>
          <tbody>${hourRows}</tbody></table></div></details>
    </section>`;
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
        <td data-label="ATR" class="field-atr-cell"${!atr && weighingFrontAtr(unit.code, front) ? ' title="ATR da balança (Entrega CTT)"' : ''}>${escapeHtml(atr || weighingFrontAtr(unit.code, front) || '—')}</td>
        <td data-label="Observações" class="field-observation-cell" data-field-summary-index="${index}" tabindex="0" aria-label="Ver acontecimentos em aberto da Frente ${escapeHtml(front)}">${fieldNotePreview(front)}</td>
        <td data-label="Detalhes" class="field-front-action-cell"><button type="button" class="field-front-details-button" data-field-front-index="${index}" aria-label="Ver detalhes da Frente ${escapeHtml(front)}" title="Ver detalhes da Frente ${escapeHtml(front)}">Ver</button></td>
      </tr>`;
    }).join('')
    : '';

  const weighing = unitWeighing(unit.code);
  const metrics = displayMetrics(unit).map(([, label, value, extra = ''], index) => `
    <div class="metric ${escapeHtml(extra)}${weighing && WEIGHING_METRIC_FIELDS[index] ? ' is-weighing' : ''}">
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
            <div class="field-subsection-title">Indicadores de produção${weighing
              ? ` <small class="metrics-source">Moagem, entrega e estoque da balança · dados até ${escapeHtml(weighingReferenceTime(unit.code))}</small>` : ''}</div>
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
      ${weighingPanel(unit)}
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
  // Relatório gerencial (dashboard/management-report.js): as 4 unidades no lugar do card.
  if (managementReportOpen) renderManagementReport();
  else {
    document.querySelector('#units-grid').innerHTML = unitCard(selectedUnit);
    applyFieldViewFilters();
  }
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
