const STORAGE_KEY = 'posicao-campo-v1-state';

const REPORT_BASE_WIDTH = 1024;
const REPORT_BASE_HEIGHT = 1536;
const REPORT_EXPORT_SCALE = 4;
const REPORT_EXPORT_MIME_TYPE = 'image/png';
const REPORT_EXPORT_EXTENSION = REPORT_EXPORT_MIME_TYPE === 'image/png' ? 'png' : 'jpg';

const statusOptions = [
  { label: 'SOLO ÚMIDO', color: 'yellow' },
  { label: 'EM ATIVIDADE', color: 'green' },
  { label: 'MUDANÇA', color: 'yellow' }
];

const metricDefinitions = [
  { icon: '🏭', label: 'INDÚSTRIA', unit: 'TN/H' },
  { icon: '⚙️', label: 'MOAGEM TURNO', unit: 'TN/H' },
  { icon: '🚚', label: 'ENTREGA TURNO', unit: 'TN/H' },
  { icon: '⬡', label: 'ESTOQUE', unit: 'CARGAS', extra: 'stock' },
  { icon: '⚙️', label: 'MOAGEM ÚLTIMAS 3H', unit: 'TN/H' },
  { icon: '🚚', label: 'ENTREGA ÚLTIMAS 3H', unit: 'TN/H' }
];

const defaultUnits = [
  {
    code: 'PPT',
    name: 'PARAGUAÇU PAULISTA',
    border: 'critical',
    rows: [
      ['02', '1563', 'yellow', 'SOLO ÚMIDO'],
      ['03', '1094', 'yellow', 'SOLO ÚMIDO'],
      ['04', '1770', 'yellow', 'SOLO ÚMIDO'],
      ['05', '1770', 'yellow', 'SOLO ÚMIDO'],
      ['06', '1490', 'yellow', 'SOLO ÚMIDO'],
      ['07', '816', 'yellow', 'SOLO ÚMIDO'],
      ['08', '845', 'yellow', 'SOLO ÚMIDO']
    ],
    metrics: makeMetrics([0, 0, 0, 0, 0, 0]),
    observation: '-',
    changes: '-',
    rain: [['Eq. 02', 42, 52], ['Eq. 03', 38, 48], ['Eq. 04', 28, 42], ['Eq. 05', 26, 38], ['Eq. 06', 24, 36], ['Eq. 07', 22, 32], ['Eq. 08', 18, 28]]
  },
  {
    code: 'NRD',
    name: 'NARANDIBA',
    border: 'critical',
    rows: [
      ['08', '3108', 'yellow', 'SOLO ÚMIDO'], ['13', '3119', 'yellow', 'SOLO ÚMIDO'], ['14', '4519', 'yellow', 'SOLO ÚMIDO'],
      ['15', '3829', 'yellow', 'SOLO ÚMIDO'], ['16', '3855', 'yellow', 'SOLO ÚMIDO'], ['17', '3119', 'yellow', 'SOLO ÚMIDO'],
      ['18', '3456', 'yellow', 'SOLO ÚMIDO'], ['19', '3835', 'yellow', 'SOLO ÚMIDO'], ['20', '3826', 'yellow', 'SOLO ÚMIDO'],
      ['21', '3424', 'yellow', 'SOLO ÚMIDO'], ['22', '3428', 'yellow', 'SOLO ÚMIDO']
    ],
    metrics: makeMetrics([0, 0, 0, 0, 0, 0]),
    observation: '-',
    changes: '-',
    rain: [['Eq. 08', 40, 50], ['Eq. 13', 36, 45], ['Eq. 14', 32, 40], ['Eq. 15', 30, 38], ['Eq. 16', 28, 35], ['Eq. 17', 26, 32], ['Eq. 18', 24, 28], ['Eq. 19', 22, 26], ['Eq. 20', 20, 24], ['Eq. 21', 18, 22], ['Eq. 22', 16, 20]]
  },
  {
    code: 'RBR',
    name: 'RIO BRILHANTE',
    border: 'active',
    rows: [
      ['411', '90701', 'green', 'EM ATIVIDADE'], ['412', '90276', 'green', 'EM ATIVIDADE'], ['413', '90265', 'green', 'EM ATIVIDADE'],
      ['414', '90270', 'green', 'EM ATIVIDADE'], ['415', '90278', 'green', 'EM ATIVIDADE'], ['511', '84670', 'yellow', 'SOLO ÚMIDO'],
      ['611', '90441', 'green', 'EM ATIVIDADE']
    ],
    metrics: makeMetrics([958, 972, 872, 4, 985, 863]),
    observation: 'Tivemos chuva nas frentes de colheita 511 e 412.\nFrente 511 parou por solo úmido.',
    changes: 'Sem previsão',
    rain: [['Eq. 411', 12, 18], ['Eq. 412', 14, 22], ['Eq. 413', 16, 26], ['Eq. 414', 18, 28], ['Eq. 415', 20, 32], ['Eq. 511', 24, 40], ['Eq. 611', 16, 24]]
  },
  {
    code: 'PST',
    name: 'PASSA TEMPO',
    border: 'active',
    rows: [
      ['402', '67620', 'yellow', 'SOLO ÚMIDO'], ['402', '84598', 'green', 'EM ATIVIDADE'], ['403', '90284', 'green', 'EM ATIVIDADE'],
      ['404', '67646', 'yellow', 'SOLO ÚMIDO'], ['501', '67680', 'yellow', 'SOLO ÚMIDO']
    ],
    metrics: makeMetrics([450, 401, 583, 52, 377, 615]),
    observation: 'Operação com ajustes. A frente 403 está em atividade.',
    changes: 'Sem previsão',
    rain: [['Eq. 402', 10, 16], ['Eq. 403', 12, 20], ['Eq. 404', 14, 24], ['Eq. 501', 18, 28]]
  }
];

let units = loadState();
let unitMeta = {};
let currentUser = null;
let selectedUnitIndex = 0;
let currentEditorStep = 0;
let toastTimer;
let historyItems = [];
let historyPage = 1;
const HISTORY_PAGE_SIZE = 6;
let excelReportData = null;
let excelFilteredTimeline = [];
let sectorBaseItems = [];
let sectorBaseMap = new Map();
let sectorBasePage = 1;

function getSectorBasePageSize() {
  const width = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 1024);
  const height = Math.max(480, window.innerHeight || document.documentElement.clientHeight || 768);

  let reservedHeight = 390;
  let rowHeight = 38;

  if (width <= 680) {
    reservedHeight = 505;
    rowHeight = 43;
  } else if (width <= 980) {
    reservedHeight = 455;
    rowHeight = 40;
  }

  const fittedRows = Math.floor((height - reservedHeight) / rowHeight);
  return Math.max(4, Math.min(10, fittedRows));
}
let sacaroseUnits = { NRD: [], PPT: [], RBR: [], PST: [] };

const editorSteps = ['Campo', 'Produção', 'Apontamentos e Mudanças', 'Precipitação'];

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
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricNumber(value) {
  const match = String(value ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function normalizeUnitsCollection(collection) {
  if (!Array.isArray(collection) || collection.length !== defaultUnits.length) return clone(defaultUnits);

  return collection.map((unit, index) => {
    const merged = {
      ...clone(defaultUnits[index]),
      ...unit,
      rows: normalizeFrontRows(Array.isArray(unit.rows) ? unit.rows : []),
      metrics: Array.isArray(unit.metrics) && unit.metrics.length === metricDefinitions.length ? unit.metrics : makeMetrics(),
      rain: Array.isArray(unit.rain) ? unit.rain : []
    };

    if (merged.code === 'PST' && (!merged.name || merged.name === 'PARAÍSA TEMPO')) merged.name = 'PASSA TEMPO';
    merged.border = calculateUnitBorder(merged.rows);
    return merged;
  });
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return clone(defaultUnits);
    return normalizeUnitsCollection(JSON.parse(saved));
  } catch (error) {
    console.warn('Não foi possível carregar os dados locais.', error);
    return clone(defaultUnits);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(units));
  } catch (error) {
    console.warn('Não foi possível salvar os dados locais.', error);
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }

  if (response.status === 401) {
    window.location.href = '/login';
    const authError = new Error('Sessão expirada.');
    authError.status = 401;
    authError.payload = data;
    throw authError;
  }
  if (!response.ok) {
    const requestError = new Error(data.error || 'Erro de comunicação com o servidor.');
    requestError.status = response.status;
    requestError.payload = data;
    throw requestError;
  }
  return data;
}

function applyServerPayload(data) {
  if (!Array.isArray(data?.units) || data.units.length !== defaultUnits.length) return false;
  units = normalizeUnitsCollection(data.units);
  unitMeta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  saveState();
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

  const usersButton = document.querySelector('#open-users');
  if (usersButton) usersButton.hidden = !isAdmin;
  const backupButton = document.querySelector('#create-backup');
  if (backupButton) backupButton.hidden = !isAdmin;

  const data = await apiRequest('/api/units');
  if (applyServerPayload(data)) return;

  const synced = await apiRequest('/api/units/sync', {
    method: 'POST',
    body: JSON.stringify({ units })
  });
  applyServerPayload(synced);
}

async function saveUnitToServer(index, unit) {
  if (!unit) throw new Error('Unidade inválida.');
  const expectedVersion = unitMeta[unit.code]?.version ?? null;
  return apiRequest(`/api/units/${encodeURIComponent(unit.code)}`, {
    method: 'PUT',
    body: JSON.stringify({ unit, position: index, expected_version: expectedVersion })
  });
}

async function logout() {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    console.warn('Não foi possível encerrar a sessão no servidor.', error);
  } finally {
    window.location.href = '/login';
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeStatus(status) {
  const value = String(status || '').trim().toUpperCase();
  if (value.includes('SOLO ÚMIDO')) return 'SOLO ÚMIDO';
  if (value === 'EM ATIVIDADE') return 'EM ATIVIDADE';
  return 'MUDANÇA';
}

function getStatusColor(status) {
  const normalizedStatus = normalizeStatus(status);
  return statusOptions.find(option => option.label === normalizedStatus)?.color || 'yellow';
}

function normalizeFrontRows(rows = []) {
  return Array.isArray(rows)
    ? rows.map(row => {
        if (!Array.isArray(row)) return row;
        const [front = '', sector = '', , status = 'EM ATIVIDADE'] = row;
        const normalizedStatus = normalizeStatus(status);
        return [front, sector, getStatusColor(normalizedStatus), normalizedStatus];
      })
    : [];
}

function calculateUnitBorder(rows = []) {
  const validRows = normalizeFrontRows(rows).filter(row =>
    Array.isArray(row) && (String(row[0] || '').trim() || String(row[1] || '').trim())
  );

  if (!validRows.length) return 'active';

  const statuses = validRows.map(row => row[3]);

  // Todas as frentes em atividade = borda verde.
  if (statuses.every(status => status === 'EM ATIVIDADE')) return 'active';

  // Todas as frentes em solo úmido = borda vermelha.
  if (statuses.every(status => status === 'SOLO ÚMIDO')) return 'critical';

  // Qualquer combinação diferente das duas condições acima = borda amarela.
  return 'attention';
}

function getUnitStateLabel(border) {
  if (border === 'critical') return 'Situação crítica';
  if (border === 'attention') return 'Atenção';
  return 'Operação normal';
}

function unitSelectorButton(unit, index) {
  const isSelected = index === selectedUnitIndex;
  return `
    <button
      class="unit-selector-button ${isSelected ? 'selected' : ''} ${escapeHtml(unit.border)}"
      type="button"
      role="tab"
      aria-selected="${isSelected ? 'true' : 'false'}"
      data-unit-index="${index}"
    >
      <strong>${escapeHtml(unit.code)}</strong>
      <span>${escapeHtml(unit.name)}</span>
    </button>`;
}

function renderUnitSelection() {
  if (!units[selectedUnitIndex]) selectedUnitIndex = 0;

  const selector = document.querySelector('#unit-selector');
  if (selector) selector.innerHTML = units.map((unit, index) => unitSelectorButton(unit, index)).join('');

  const unit = units[selectedUnitIndex];
  const previewLabel = document.querySelector('#preview-unit-label');
  if (previewLabel) {
    previewLabel.textContent = `Exibindo ${unit.code} — ${unit.name}`;
  }

  const fillButton = document.querySelector('#open-data-modal');
  if (fillButton) {
    fillButton.textContent = `Preencher ${unit.code}`;
    fillButton.setAttribute('aria-label', `Preencher informações da unidade ${unit.code} — ${unit.name}`);
  }
}

function unitCard(unit) {
  const meta = unitMeta[unit.code] || {};
  const updateText = meta.updated_at
    ? `Atualizado por ${meta.updated_by || '-'} em ${formatServerTimestamp(meta.updated_at)}`
    : 'Aguardando primeira atualização no servidor';

  const rows = unit.rows.length
    ? unit.rows.map(([front, sector, color, status]) => `
      <tr>
        <td><span class="front-cell"><i class="status-dot ${escapeHtml(color)}"></i>${escapeHtml(front)}</span></td>
        <td>${escapeHtml(sector)}</td>
        <td><span class="status-cell ${color === 'green' ? 'active-text' : ''}">${escapeHtml(status)}</span></td>
      </tr>
    `).join('')
    : '<tr class="empty-table-row"><td colspan="3">Aguardando preenchimento do turno</td></tr>';

  const metrics = unit.metrics.map(([, label, value, extra = '']) => `
    <div class="metric ${escapeHtml(extra)}">
      <div class="metric-info">
        <small>${escapeHtml(label)}</small>
        <strong>${escapeHtml(value)}</strong>
      </div>
    </div>
  `).join('');

  const rain = unit.rain.length
    ? unit.rain.map(([eq, turn, accum]) => `
      <div class="rain-row"><span>${escapeHtml(eq)}</span><span>${escapeHtml(turn)}</span><span>/</span><span>${escapeHtml(accum)}</span></div>
    `).join('')
    : '<div class="rain-empty">Sem apontamento de chuva</div>';

  return `
    <article class="unit-card ${escapeHtml(unit.border)}">
      <div class="unit-layout-grid">
        <section class="dashboard-block unit-main-block">
          <div class="unit-header">
            <div class="unit-title">
              <strong>${escapeHtml(unit.code)}</strong>
              <span>${escapeHtml(unit.name)}</span>
            </div>
            <div class="unit-header-status">
              <span class="unit-state">${escapeHtml(getUnitStateLabel(unit.border))}</span>
              <small class="unit-updated">${escapeHtml(updateText)}</small>
            </div>
          </div>

          <div class="table-wrap status-table-wrap">
            <table class="data-table">
              <thead><tr><th>Frente</th><th>Setor</th><th>Status</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>

          <div class="unit-metrics-strip" aria-label="Indicadores da unidade">
            <div class="metrics-grid">${metrics}</div>
          </div>
        </section>

        <div class="unit-side-stack">
          <section class="dashboard-block rain-turn-block">
            <div class="compact-block-title">Chuva turno / acum. (mm)</div>
            <div class="rain-box">${rain}</div>
          </section>

          <section class="dashboard-block notes-changes-block">
            <div class="notes-changes-grid">
              <div class="text-panel">
                <h4>Observação</h4>
                <p>${escapeHtml(unit.observation || '-')}</p>
              </div>
              <div class="text-panel">
                <h4>Mudanças</h4>
                <p>${escapeHtml(unit.changes || '-')}</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </article>
  `;
}

function renderDashboard() {
  units.forEach(unit => { unit.border = calculateUnitBorder(unit.rows); });
  if (!units[selectedUnitIndex]) selectedUnitIndex = 0;

  const selectedUnit = units[selectedUnitIndex];
  document.querySelector('#units-grid').innerHTML = unitCard(selectedUnit);
  renderUnitSelection();
}

function updateDateAndGreeting() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'BOM DIA!' : hour < 18 ? 'BOA TARDE!' : 'BOA NOITE!';
  const date = now.toLocaleDateString('pt-BR');

  document.querySelector('#greeting').textContent = greeting;
  document.querySelector('#today').textContent = `${date} - TC`;
}

function buildUnitSelect() {
  const input = document.querySelector('#unit-select');
  if (!input) return;
  const current = Number(input.value || 0);
  input.value = String(Number.isInteger(current) && units[current] ? current : 0);
}

function setEditorStep(step) {
  const maxStep = editorSteps.length - 1;
  const safeStep = Math.max(0, Math.min(Number(step) || 0, maxStep));
  currentEditorStep = safeStep;

  document.querySelectorAll('[data-step-panel]').forEach(panel => {
    const isActive = Number(panel.dataset.stepPanel) === safeStep;
    panel.hidden = !isActive;
    panel.classList.toggle('is-active', isActive);
  });

  document.querySelectorAll('[data-step-indicator]').forEach(indicator => {
    const indicatorStep = Number(indicator.dataset.stepIndicator);
    const isActive = indicatorStep === safeStep;
    indicator.classList.toggle('is-active', isActive);
    indicator.classList.toggle('is-complete', indicatorStep < safeStep);
    if (isActive) indicator.setAttribute('aria-current', 'step');
    else indicator.removeAttribute('aria-current');
  });

  const prevButton = document.querySelector('#wizard-prev');
  const nextButton = document.querySelector('#wizard-next');
  const saveButton = document.querySelector('#wizard-save');
  const stepLabel = document.querySelector('#wizard-step-label');

  if (prevButton) prevButton.hidden = safeStep === 0;
  if (nextButton) nextButton.hidden = safeStep === maxStep;
  if (saveButton) saveButton.hidden = safeStep !== maxStep;
  if (stepLabel) stepLabel.textContent = `Etapa ${safeStep + 1} de ${editorSteps.length} · ${editorSteps[safeStep]}`;

  const activePanel = document.querySelector(`[data-step-panel="${safeStep}"]`);
  const focusTarget = activePanel?.querySelector('input:not([type="hidden"]), select, textarea, button');
  requestAnimationFrame(() => focusTarget?.focus());
}

function openUnitEditor(index) {
  const safeIndex = Number(index);
  if (!Number.isInteger(safeIndex) || !units[safeIndex]) return;
  loadUnitEditor(safeIndex);
  setEditorStep(0);
  openModal('data-modal');
}

function statusOptionsHtml(selectedStatus) {
  const normalizedStatus = normalizeStatus(selectedStatus);
  return statusOptions.map(({ label }) => `
    <option value="${escapeHtml(label)}" ${label === normalizedStatus ? 'selected' : ''}>${escapeHtml(label)}</option>
  `).join('');
}

function normalizeSectorLookupKey(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return /^-?\d+\.0+$/.test(text) ? text.split('.', 1)[0].toLocaleLowerCase('pt-BR') : text.toLocaleLowerCase('pt-BR');
}

function rebuildSectorBaseMap() {
  sectorBaseMap = new Map();
  sectorBaseItems.forEach(item => {
    const key = normalizeSectorLookupKey(item?.sector);
    if (key) sectorBaseMap.set(key, item);
  });
}

function getSectorBaseItem(value) {
  return sectorBaseMap.get(normalizeSectorLookupKey(value)) || null;
}

function frontRowHtml(front = '', sector = '', status = 'EM ATIVIDADE') {
  return `
    <tr class="front-edit-row">
      <td><input class="front-input" type="text" maxlength="12" value="${escapeHtml(front)}" placeholder="Ex.: 402" /></td>
      <td class="sector-input-cell">
        <input class="sector-input" type="text" maxlength="16" value="${escapeHtml(sector)}" placeholder="Ex.: 67620" />
      </td>
      <td><select class="status-input">${statusOptionsHtml(status)}</select></td>
      <td><button class="row-remove remove-front-row" type="button" aria-label="Remover frente">×</button></td>
    </tr>
  `;
}

function compareFrontLabels(a, b) {
  const left = String(a ?? '').trim();
  const right = String(b ?? '').trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

function sortFrontRows(rows = []) {
  return [...rows].sort((a, b) => compareFrontLabels(a?.[0], b?.[0]));
}

function renderFrontRows(rows) {
  const tbody = document.querySelector('#front-rows');
  const sortedRows = sortFrontRows(rows);
  tbody.innerHTML = sortedRows.length
    ? sortedRows.map(([front, sector, , status]) => frontRowHtml(front, sector, status)).join('')
    : frontRowHtml();
}

function reorderFrontForm() {
  renderFrontRows(collectFrontRows());
}

function renderMetricsForm(unit) {
  const container = document.querySelector('#metrics-form');
  container.innerHTML = metricDefinitions.map((definition, index) => `
    <div class="metric-field">
      <label>
        <span>${escapeHtml(definition.label)}</span>
        <div class="metric-input-wrap">
          <input class="metric-input" data-metric-index="${index}" type="number" step="0.01" min="0" value="${metricNumber(unit.metrics[index]?.[2])}" />
          <small>${escapeHtml(definition.unit)}</small>
        </div>
      </label>
    </div>
  `).join('');
}

function rainRowHtml(eq = '', turn = 0, accum = 0) {
  return `
    <div class="rain-edit-row">
      <label>
        <span>Equipamento / frente</span>
        <input class="rain-eq" type="text" maxlength="20" value="${escapeHtml(eq)}" placeholder="Ex.: Eq. 402" />
      </label>
      <label>
        <span>Chuva turno (mm)</span>
        <input class="rain-turn" type="number" min="0" step="0.1" value="${normalizeNumber(turn)}" />
      </label>
      <label>
        <span>Acumulado (mm)</span>
        <input class="rain-accum" type="number" min="0" step="0.1" value="${normalizeNumber(accum)}" />
      </label>
      <button class="row-remove remove-rain-row" type="button" aria-label="Remover equipamento">×</button>
    </div>
  `;
}

function rainSortKey(value) {
  return String(value ?? '')
    .trim()
    .replace(/^eq(?:uipamento)?[.\s:-]*/i, '')
    .trim();
}

function sortRainRows(rain = []) {
  return [...rain].sort((a, b) => compareFrontLabels(rainSortKey(a?.[0]), rainSortKey(b?.[0])));
}

function renderRainForm(rain) {
  const container = document.querySelector('#rain-form');
  const sortedRain = sortRainRows(rain);
  container.innerHTML = sortedRain.length
    ? sortedRain.map(([eq, turn, accum]) => rainRowHtml(eq, turn, accum)).join('')
    : rainRowHtml();
}

function reorderRainForm() {
  renderRainForm(collectRainRows());
}

function autoResizeTextarea(textarea) {
  if (!textarea) return;
  // O CSS usa field-sizing: content. Ajustar rows mantém um fallback sem
  // criar style inline, que é bloqueado pela Content Security Policy.
  const value = String(textarea.value || '');
  const explicitLines = Math.max(1, value.split(/\r?\n/).length);
  textarea.rows = Math.max(3, explicitLines);
}

function resizeEditorTextareas() {
  autoResizeTextarea(document.querySelector('#observation-input'));
  autoResizeTextarea(document.querySelector('#changes-input'));
}

function loadUnitEditor(index) {
  const unit = units[index];
  if (!unit) return;

  const unitSelect = document.querySelector('#unit-select');
  const formUnitName = document.querySelector('#form-unit-name');
  const observationInput = document.querySelector('#observation-input');
  const changesInput = document.querySelector('#changes-input');

  if (unitSelect) unitSelect.value = String(index);
  unit.border = calculateUnitBorder(unit.rows);
  if (formUnitName) formUnitName.textContent = `${unit.code} — ${unit.name}`;
  if (observationInput) observationInput.value = unit.observation === '-' ? '' : unit.observation || '';
  if (changesInput) changesInput.value = unit.changes === '-' ? '' : unit.changes || '';
  resizeEditorTextareas();

  renderFrontRows(unit.rows);
  renderMetricsForm(unit);
  renderRainForm(unit.rain);
}

function collectFrontRows() {
  const rows = [...document.querySelectorAll('.front-edit-row')]
    .map(row => {
      const front = row.querySelector('.front-input').value.trim();
      const sector = row.querySelector('.sector-input').value.trim();
      const status = normalizeStatus(row.querySelector('.status-input').value);
      return [front, sector, getStatusColor(status), status];
    })
    .filter(([front, sector]) => front || sector);

  return sortFrontRows(rows);
}

function collectMetrics() {
  return metricDefinitions.map((definition, index) => {
    const input = document.querySelector(`.metric-input[data-metric-index="${index}"]`);
    const value = normalizeNumber(input?.value);
    return [definition.icon, definition.label, `${value} ${definition.unit}`, definition.extra || ''];
  });
}

function collectRainRows() {
  const rows = [...document.querySelectorAll('.rain-edit-row')]
    .map(row => {
      const eq = row.querySelector('.rain-eq').value.trim();
      const turn = normalizeNumber(row.querySelector('.rain-turn').value);
      const accum = normalizeNumber(row.querySelector('.rain-accum').value);
      return [eq, turn, accum];
    })
    .filter(([eq, turn, accum]) => eq || turn || accum);

  return sortRainRows(rows);
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  const focusTarget = modal.querySelector('select, input, textarea, button');
  requestAnimationFrame(() => focusTarget?.focus());
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = true;
  const anyOpen = [...document.querySelectorAll('.modal-backdrop')].some(item => !item.hidden);
  if (!anyOpen) document.body.classList.remove('modal-open');
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(modal => { modal.hidden = true; });
  document.body.classList.remove('modal-open');
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function formatServerTimestamp(timestamp) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return '-';
  return new Date(numeric * 1000).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function historyItemHtml(item) {
  return `
    <article class="history-item">
      <div class="history-item-main">
        <strong>${escapeHtml(item.unit_code || '-')} — ${escapeHtml(item.unit_name || '')}</strong>
        <span>${escapeHtml(item.action || 'atualização')} · versão ${escapeHtml(item.version ?? '-')}</span>
      </div>
      <div class="history-item-meta">
        <strong>${escapeHtml(item.user_name || 'Usuário')}</strong>
        <span>${escapeHtml(formatServerTimestamp(item.created_at))}</span>
      </div>
    </article>`;
}

function renderHistoryPage() {
  const list = document.querySelector('#history-list');
  const pagination = document.querySelector('#history-pagination');
  const pageInfo = document.querySelector('#history-page-info');
  const previousButton = document.querySelector('#history-page-prev');
  const nextButton = document.querySelector('#history-page-next');
  if (!list || !pagination || !pageInfo || !previousButton || !nextButton) return;

  const totalItems = historyItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / HISTORY_PAGE_SIZE));
  historyPage = Math.min(Math.max(historyPage, 1), totalPages);

  if (!totalItems) {
    list.innerHTML = '<div class="history-empty">Nenhuma alteração registrada.</div>';
    pagination.hidden = true;
    return;
  }

  const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
  const pageItems = historyItems.slice(start, start + HISTORY_PAGE_SIZE);
  list.innerHTML = pageItems.map(historyItemHtml).join('');

  const firstItem = start + 1;
  const lastItem = Math.min(start + HISTORY_PAGE_SIZE, totalItems);
  pageInfo.textContent = `${firstItem}–${lastItem} de ${totalItems} · Página ${historyPage} de ${totalPages}`;
  previousButton.disabled = historyPage <= 1;
  nextButton.disabled = historyPage >= totalPages;
  pagination.hidden = totalPages <= 1;
}

async function loadHistory({ resetPage = true } = {}) {
  const list = document.querySelector('#history-list');
  const pagination = document.querySelector('#history-pagination');
  if (!list) return;
  const unit = document.querySelector('#history-unit-filter')?.value || '';
  if (resetPage) historyPage = 1;
  list.innerHTML = '<div class="history-loading">Carregando histórico...</div>';
  if (pagination) pagination.hidden = true;

  try {
    const query = new URLSearchParams({ limit: '150' });
    if (unit) query.set('unit', unit);
    const data = await apiRequest(`/api/history?${query.toString()}`);
    historyItems = Array.isArray(data.history) ? data.history : [];
    renderHistoryPage();
  } catch (error) {
    console.error(error);
    historyItems = [];
    list.innerHTML = '<div class="history-empty">Não foi possível carregar o histórico.</div>';
    if (pagination) pagination.hidden = true;
  }
}

async function openHistoryModal() {
  openModal('history-modal');
  await loadHistory();
}

async function createManualBackup() {
  const button = document.querySelector('#create-backup');
  if (button) button.disabled = true;
  try {
    const data = await apiRequest('/api/backup', { method: 'POST' });
    showToast(data.backup ? `Backup criado: ${data.backup}` : 'Backup concluído.');
  } catch (error) {
    console.error(error);
    showToast('Não foi possível criar o backup.');
  } finally {
    if (button) button.disabled = false;
  }
}



function normalizeUserSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function filterUsersList() {
  const input = document.querySelector('#users-search');
  const list = document.querySelector('#users-list');
  const count = document.querySelector('#users-search-count');
  const empty = document.querySelector('#users-search-empty');
  if (!list) return;

  const items = Array.from(list.querySelectorAll('.user-list-item'));
  const term = normalizeUserSearch(input?.value);
  let visible = 0;

  items.forEach(item => {
    const matches = !term || normalizeUserSearch(item.textContent).includes(term);
    item.hidden = !matches;
    if (matches) visible += 1;
  });

  if (count) {
    if (!items.length) count.textContent = '';
    else if (term) count.textContent = `${visible} de ${items.length} ${items.length === 1 ? 'usuário' : 'usuários'}`;
    else count.textContent = `${items.length} ${items.length === 1 ? 'usuário' : 'usuários'}`;
  }

  if (empty) empty.hidden = !term || visible > 0 || items.length === 0;
}

function userItemHtml(user) {
  const isCurrent = Number(user.id) === Number(currentUser?.id);
  const isAdmin = user.role === 'admin';
  const isActive = user.is_active !== false;
  const actions = (!isCurrent && !isAdmin) ? `
      <div class="user-actions">
        <button class="user-action" type="button" data-user-action="toggle" data-user-id="${escapeHtml(user.id)}" data-active="${isActive ? 'true' : 'false'}">${isActive ? 'Desativar' : 'Ativar'}</button>
        <button class="user-action" type="button" data-user-action="password" data-user-id="${escapeHtml(user.id)}">Redefinir senha</button>
        <button class="user-delete" type="button" data-user-action="delete" data-user-id="${escapeHtml(user.id)}">Excluir</button>
      </div>
      <form class="user-password-form" data-user-id="${escapeHtml(user.id)}" hidden>
        <input class="user-password-input" type="password" autocomplete="new-password" required placeholder="Nova senha" aria-label="Nova senha para ${escapeHtml(user.name || 'usuário')}" />
        <button class="user-action user-action-primary" type="submit">Salvar senha</button>
        <button class="user-action" type="button" data-user-action="cancel-password">Cancelar</button>
      </form>` : '';
  return `
    <article class="user-list-item ${isActive ? '' : 'is-disabled'}" data-user-id="${escapeHtml(user.id)}">
      <div class="user-list-copy">
        <strong>${escapeHtml(user.name || 'Usuário')}${isCurrent ? ' · conectado' : ''}</strong>
        <span class="user-badges">
          <i class="user-role-badge ${isAdmin ? 'is-admin' : ''}">${isAdmin ? 'Administrador' : 'Usuário'}</i>
          <i class="user-status-badge ${isActive ? 'is-active' : 'is-disabled'}">${isActive ? 'Ativo' : 'Desativado'}</i>
        </span>
        <span>Cadastrado em ${escapeHtml(formatServerTimestamp(user.created_at))}</span>
      </div>
      ${actions}
    </article>`;
}

async function loadUsers() {
  const list = document.querySelector('#users-list');
  if (!list) return;
  if (currentUser?.role !== 'admin') {
    list.innerHTML = '<div class="history-empty">Acesso exclusivo do Administrador.</div>';
    return;
  }
  list.innerHTML = '<div class="history-loading">Carregando usuários...</div>';
  const count = document.querySelector('#users-search-count');
  const empty = document.querySelector('#users-search-empty');
  if (count) count.textContent = '';
  if (empty) empty.hidden = true;
  try {
    const data = await apiRequest('/api/users');
    const usersList = Array.isArray(data.users) ? data.users : [];
    list.innerHTML = usersList.length
      ? usersList.map(userItemHtml).join('')
      : '<div class="history-empty">Nenhum usuário cadastrado.</div>';
    filterUsersList();
  } catch (error) {
    console.error(error);
    list.innerHTML = `<div class="history-empty">${escapeHtml(error.message || 'Não foi possível carregar os usuários.')}</div>`;
    const count = document.querySelector('#users-search-count');
    if (count) count.textContent = '';
  }
}

async function openUsersModal() {
  if (currentUser?.role !== 'admin') {
    showToast('Acesso exclusivo do Administrador.');
    return;
  }
  const searchInput = document.querySelector('#users-search');
  if (searchInput) searchInput.value = '';
  openModal('users-modal');
  await loadUsers();
}

async function createQuickUser(event) {
  event.preventDefault();
  if (currentUser?.role !== 'admin') return;
  const nameInput = document.querySelector('#quick-user-name');
  const passwordInput = document.querySelector('#quick-user-password');
  const name = nameInput?.value.trim() || '';
  const password = passwordInput?.value || '';
  if (!name || !password) {
    showToast('Informe nome e senha.');
    return;
  }
  try {
    await apiRequest('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name, password })
    });
    if (nameInput) nameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    showToast(`Conta de ${name} criada.`);
    await loadUsers();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível criar a conta.');
  }
}

async function deleteUserFromList(button) {
  const userId = Number(button?.dataset.userId);
  if (!Number.isInteger(userId) || userId <= 0) return;
  const item = button.closest('.user-list-item');
  const name = item?.querySelector('strong')?.textContent?.replace(' · conectado', '') || 'este usuário';
  if (!window.confirm(`Excluir ${name}?`)) return;
  button.disabled = true;
  try {
    await apiRequest(`/api/users/${userId}`, { method: 'DELETE' });
    showToast('Usuário excluído.');
    await loadUsers();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível excluir o usuário.');
    button.disabled = false;
  }
}

async function toggleUserActive(button) {
  const userId = Number(button?.dataset.userId);
  if (!Number.isInteger(userId) || userId <= 0) return;
  const currentlyActive = button.dataset.active === 'true';
  button.disabled = true;
  try {
    await apiRequest(`/api/users/${userId}/active`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !currentlyActive })
    });
    showToast(currentlyActive ? 'Usuário desativado.' : 'Usuário ativado.');
    await loadUsers();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível alterar o usuário.');
    button.disabled = false;
  }
}

function togglePasswordForm(button, visible) {
  const item = button.closest('.user-list-item');
  const form = item?.querySelector('.user-password-form');
  if (!form) return;
  form.hidden = !visible;
  if (visible) form.querySelector('.user-password-input')?.focus();
  else {
    const input = form.querySelector('.user-password-input');
    if (input) input.value = '';
  }
}

async function resetUserPassword(form) {
  const userId = Number(form?.dataset.userId);
  const input = form?.querySelector('.user-password-input');
  const password = input?.value || '';
  if (!Number.isInteger(userId) || userId <= 0) return;
  if (!password) {
    showToast('Informe a nova senha.');
    input?.focus();
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  try {
    await apiRequest(`/api/users/${userId}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password })
    });
    showToast('Senha redefinida. O usuário deverá entrar novamente.');
    if (input) input.value = '';
    form.hidden = true;
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível redefinir a senha.');
  } finally {
    if (submit) submit.disabled = false;
  }
}

function getHeaderDataForExport(generatedAt = new Date()) {
  const safeDate = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  const hour = safeDate.getHours();
  return {
    greeting: hour < 12 ? 'BOM DIA!' : hour < 18 ? 'BOA TARDE!' : 'BOA NOITE!',
    date: safeDate.toLocaleDateString('pt-BR')
  };
}

function normalizeReportUnit(unit, index) {
  const fallbackNames = ['PARAGUAÇU PAULISTA', 'NARANDIBA', 'RIO BRILHANTE', 'PASSA TEMPO'];
  const fallbackCodes = ['PPT', 'NRD', 'RBR', 'PST'];
  const source = unit || {};
  const cloned = clone(source);
  const normalized = {
    code: cloned.code || fallbackCodes[index] || `UN${index + 1}`,
    name: cloned.name || fallbackNames[index] || 'UNIDADE',
    border: ['active', 'attention', 'critical'].includes(cloned.border) ? cloned.border : 'active',
    rows: Array.isArray(cloned.rows) ? cloned.rows : [],
    metrics: Array.isArray(cloned.metrics) && cloned.metrics.length === metricDefinitions.length ? cloned.metrics : makeMetrics(),
    observation: String(cloned.observation || '-'),
    changes: String(cloned.changes || '-'),
    rain: Array.isArray(cloned.rain) ? cloned.rain : []
  };

  if (normalized.code === 'PST' && (!normalized.name || normalized.name === 'PARAÍSA TEMPO')) normalized.name = 'PASSA TEMPO';
  normalized.border = calculateUnitBorder(normalized.rows);
  return normalized;
}

async function loadImageAsset(path, errorMessage) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'force-cache' });
  if (!response.ok) throw new Error(errorMessage);
  const blob = await response.blob();

  if ('createImageBitmap' in window) {
    return createImageBitmap(blob);
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(errorMessage));
    };
    image.src = objectUrl;
  });
}

function loadReportTemplateImage() {
  return loadImageAsset('/assets/report-template.jpg', 'Não foi possível carregar a imagem-base do relatório.');
}

function loadSacaroseHeaderIconImage() {
  return loadImageAsset('/assets/sacarose-icon.png', 'Não foi possível carregar o ícone da posição de colheita.');
}

function loadReportUnitIconImage() {
  return loadImageAsset('/assets/report-unit-icon.png', 'Não foi possível carregar o ícone das unidades do relatório.');
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillRoundedRect(ctx, x, y, width, height, radius, color) {
  ctx.save();
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function strokeRoundedRect(ctx, x, y, width, height, radius, color, lineWidth = 4) {
  ctx.save();
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

function prepareCardBody(ctx, layout, unit, borderColor, unitIconImage = null) {
  // Primeiro cobre totalmente a borda antiga da arte-base para evitar mistura de cores.
  fillRoundedRect(ctx, layout.x - 4, layout.y - 4, layout.w + 8, layout.h + 8, 20, '#012d36');

  const background = ctx.createLinearGradient(layout.x, layout.y, layout.x + layout.w, layout.y + layout.h);
  background.addColorStop(0, '#003842');
  background.addColorStop(0.52, '#00323b');
  background.addColorStop(1, '#002a33');
  fillRoundedRect(ctx, layout.x, layout.y, layout.w, layout.h, 16, background);

  ctx.save();
  roundedRectPath(ctx, layout.x, layout.y, layout.w, layout.h, 16);
  ctx.clip();
  const headerGlow = ctx.createLinearGradient(layout.x, layout.y, layout.x, layout.y + 90);
  headerGlow.addColorStop(0, 'rgba(0, 92, 97, 0.26)');
  headerGlow.addColorStop(1, 'rgba(0, 46, 58, 0)');
  ctx.fillStyle = headerGlow;
  ctx.fillRect(layout.x, layout.y, layout.w, 90);
  ctx.restore();

  strokeRoundedRect(ctx, layout.x + 1.5, layout.y + 1.5, layout.w - 3, layout.h - 3, 15, borderColor, 6);

  if (unitIconImage) {
    const iconH = 44;
    const iconW = Math.round(iconH * (unitIconImage.width / Math.max(1, unitIconImage.height)));
    const iconX = layout.x + 18;
    const iconY = layout.y + 10;
    ctx.drawImage(unitIconImage, iconX, iconY, iconW, iconH);
  } else {
    drawReportUnitIcon(ctx, layout.x + 18, layout.y + 9, 42, 46);
  }

  drawFittedText(ctx, unit.code || '', layout.x + 83, layout.y + 28, 118, 'bold 29px Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, unit.name || '', layout.x + 83, layout.y + 54, layout.w - 110, '22px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
}

function drawFittedText(ctx, text, x, y, maxWidth, font, color = '#ffffff', baseline = 'alphabetic') {
  const value = String(text ?? '');
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = baseline;
  const measured = Math.max(1, ctx.measureText(value).width);
  const scaleX = Math.min(1, maxWidth / measured);
  ctx.translate(x, y);
  ctx.scale(scaleX, 1);
  ctx.fillText(value, 0, 0);
  ctx.restore();
}

function borderColorForState(border) {
  if (border === 'critical') return '#ff3a45';
  if (border === 'attention') return '#ffe11a';
  return '#56ef3b';
}

function statusColorValue(color) {
  if (color === 'green') return '#7dff4c';
  if (color === 'red') return '#ff4758';
  return '#ffe11a';
}

function statusTextColor(color) {
  return color === 'green' ? '#73ff48' : '#ffffff';
}

function drawReportUnitIcon(ctx, x, y, width = 40, height = 46) {
  ctx.save();
  ctx.fillStyle = '#74f23a';
  ctx.strokeStyle = '#74f23a';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const drawBlade = (points) => {
    ctx.beginPath();
    ctx.moveTo(x + points[0][0] * width, y + points[0][1] * height);
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      if (p.length === 2) {
        ctx.lineTo(x + p[0] * width, y + p[1] * height);
      } else if (p.length === 4) {
        ctx.quadraticCurveTo(x + p[0] * width, y + p[1] * height, x + p[2] * width, y + p[3] * height);
      }
    }
    ctx.closePath();
    ctx.fill();
  };

  // lâmina esquerda
  drawBlade([
    [0.10, 0.98],
    [0.10, 0.52, 0.08, 0.22],
    [0.14, 0.04, 0.29, 0.04],
    [0.22, 0.22, 0.20, 0.58],
    [0.22, 0.98]
  ]);

  // lâmina central
  drawBlade([
    [0.40, 0.98],
    [0.38, 0.56, 0.36, 0.20],
    [0.48, 0.02, 0.66, 0.02],
    [0.58, 0.24, 0.56, 0.52],
    [0.56, 0.98]
  ]);

  // lâmina direita
  drawBlade([
    [0.74, 0.98],
    [0.74, 0.62, 0.72, 0.36],
    [0.79, 0.16, 0.94, 0.08],
    [0.85, 0.30, 0.84, 0.54],
    [0.84, 0.98]
  ]);

  ctx.restore();
}

function drawLeafMark(ctx, x, y, scale = 1) {
  drawReportUnitIcon(ctx, x, y, 40 * scale, 46 * scale);
}

function wrapTextLines(ctx, text, maxWidth) {
  const content = String(text || '-').replace(/\r/g, '');
  const paragraphs = content.split('\n');
  const lines = [];

  const splitLongWord = word => {
    const parts = [];
    let current = '';
    Array.from(word).forEach(char => {
      const trial = `${current}${char}`;
      if (current && ctx.measureText(trial).width > maxWidth) {
        parts.push(current);
        current = char;
      } else {
        current = trial;
      }
    });
    if (current) parts.push(current);
    return parts.length ? parts : [''];
  };

  paragraphs.forEach(paragraph => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      return;
    }

    let current = '';
    words.forEach(word => {
      const pieces = ctx.measureText(word).width > maxWidth ? splitLongWord(word) : [word];
      pieces.forEach((piece, pieceIndex) => {
        const trial = current ? `${current} ${piece}` : piece;
        if (ctx.measureText(trial).width <= maxWidth || !current) {
          current = trial;
        } else {
          lines.push(current);
          current = piece;
        }

        if (pieces.length > 1 && pieceIndex < pieces.length - 1) {
          lines.push(current);
          current = '';
        }
      });
    });
    if (current) lines.push(current);
  });

  return lines.length ? lines : ['-'];
}

function getWrappedTextLineCount(ctx, text, maxWidth, fontSize) {
  ctx.save();
  ctx.font = `${fontSize}px "Arial Narrow", Arial, sans-serif`;
  const count = wrapTextLines(ctx, text, maxWidth).length;
  ctx.restore();
  return Math.max(1, count);
}

function getWrappedTextHeight(ctx, text, maxWidth, fontSize, lineRatio = 1.22, family = '"Arial Narrow", Arial, sans-serif') {
  ctx.save();
  ctx.font = `${fontSize}px ${family}`;
  const lines = wrapTextLines(ctx, text, maxWidth);
  ctx.restore();
  return Math.max(1, lines.length) * fontSize * lineRatio;
}

function drawWrappedTextFit(ctx, text, x, y, maxWidth, maxHeight, options = {}) {
  const maxFontSize = Number(options.maxFontSize) || 13;
  const minFontSize = Number(options.minFontSize) || 4;
  const color = options.color || '#ffffff';
  const family = options.family || '"Arial Narrow", Arial, sans-serif';
  const lineRatio = Number(options.lineRatio) || 1.22;
  const availableHeight = Math.max(1, maxHeight);

  let fitted = null;
  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 0.5) {
    ctx.save();
    ctx.font = `${fontSize}px ${family}`;
    const lines = wrapTextLines(ctx, text, maxWidth);
    ctx.restore();
    const lineHeight = fontSize * lineRatio;
    if (lines.length * lineHeight <= availableHeight) {
      fitted = { fontSize, lineHeight, lines };
      break;
    }
  }

  if (!fitted) {
    let fontSize = minFontSize;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      ctx.save();
      ctx.font = `${fontSize}px ${family}`;
      const lines = wrapTextLines(ctx, text, maxWidth);
      ctx.restore();
      const requiredHeight = Math.max(1, lines.length * fontSize * lineRatio);
      if (requiredHeight <= availableHeight) {
        fitted = { fontSize, lineHeight: fontSize * lineRatio, lines };
        break;
      }
      fontSize = Math.max(2.5, fontSize * (availableHeight / requiredHeight) * 0.98);
    }

    if (!fitted) {
      ctx.save();
      ctx.font = `${fontSize}px ${family}`;
      const lines = wrapTextLines(ctx, text, maxWidth);
      ctx.restore();
      fitted = {
        fontSize,
        lineHeight: Math.min(fontSize * lineRatio, availableHeight / Math.max(1, lines.length)),
        lines
      };
    }
  }

  ctx.save();
  ctx.font = `${fitted.fontSize}px ${family}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  fitted.lines.forEach((line, index) => {
    ctx.fillText(line || ' ', x, y + index * fitted.lineHeight);
  });
  ctx.restore();

  return fitted.lines.length * fitted.lineHeight;
}

function drawMetricIcon(ctx, type, x, y, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  if (type === 'stock') {
    ctx.strokeRect(x + 2, y + 3, size - 6, size - 6);
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 3);
    ctx.lineTo(x + size / 2, y - 1);
    ctx.lineTo(x + size - 4, y + 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y - 1);
    ctx.lineTo(x + size / 2, y + size - 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 2, y + size / 2);
    ctx.lineTo(x + size / 2, y + size / 2 + 4);
    ctx.lineTo(x + size - 4, y + size / 2);
    ctx.stroke();
  } else if (type === 'industry') {
    ctx.fillRect(x + 2, y + 10, 5, size - 12);
    ctx.fillRect(x + 10, y + 14, 5, size - 16);
    ctx.fillRect(x + 18, y + 6, 5, size - 8);
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 10);
    ctx.lineTo(x + 10, y + 4);
    ctx.lineTo(x + 17, y + 10);
    ctx.stroke();
  } else if (type === 'delivery') {
    ctx.strokeRect(x + 2, y + 8, size - 12, size - 12);
    ctx.strokeRect(x + size - 10, y + 12, 8, size - 16);
    ctx.beginPath();
    ctx.arc(x + 8, y + size - 2, 3, 0, Math.PI * 2);
    ctx.arc(x + size - 6, y + size - 2, 3, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2 - 3, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI * 2 * i) / 8;
      ctx.beginPath();
      ctx.moveTo(x + size / 2 + Math.cos(angle) * (size / 2 - 3), y + size / 2 + Math.sin(angle) * (size / 2 - 3));
      ctx.lineTo(x + size / 2 + Math.cos(angle) * (size / 2 + 2), y + size / 2 + Math.sin(angle) * (size / 2 + 2));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getReportGeometry(ctx, layout, unit) {
  const metricHeight = layout.lower ? 48 : 55;
  const metricGapY = layout.lower ? 8 : 9;
  const metricY = layout.y + (layout.lower ? 246 : 295);
  const metricsBottom = metricY + metricHeight * 2 + metricGapY;
  const contentTop = metricsBottom + 8;
  const cardBottom = layout.y + layout.h;
  const innerLeft = layout.x + 18;
  const innerRight = layout.x + layout.w - 18;
  const notesGap = layout.lower ? 10 : 12;
  const defaultNotesW = layout.lower ? 245 : 214;
  const minRainW = layout.lower ? 150 : 170;
  const maxNotesW = layout.lower ? 286 : 272;
  const maxBodyFont = layout.lower ? 11.5 : 13;
  const observationLines = getWrappedTextLineCount(ctx, unit?.observation || '-', defaultNotesW, maxBodyFont);
  const changesLines = getWrappedTextLineCount(ctx, unit?.changes || '-', defaultNotesW, maxBodyFont);
  const extraWidthDemand = Math.max(0, observationLines - 3) * 10 + Math.max(0, changesLines - 2) * 6;
  let notesW = clampValue(defaultNotesW + extraWidthDemand, defaultNotesW, maxNotesW);
  let rainW = innerRight - innerLeft - notesGap - notesW;
  if (rainW < minRainW) {
    rainW = minRainW;
    notesW = innerRight - innerLeft - notesGap - rainW;
  }

  const fixedRainH = layout.lower ? 125 : 174;

  return {
    metricY,
    metricHeight,
    metricGapY,
    metricsBottom,
    contentTop,
    cardBottom,
    innerLeft,
    innerRight,
    fullNotesW: innerRight - innerLeft,
    tableTop: layout.y + (layout.lower ? 112 : 114),
    tableBottom: metricY - (layout.lower ? 12 : 14),
    rainX: innerRight - rainW,
    rainY: contentTop,
    rainW,
    rainH: fixedRainH,
    rainBottom: contentTop + fixedRainH,
    notesX: innerLeft,
    notesY: contentTop + 2,
    notesW,
    notesGap
  };
}

function drawMetricBox(ctx, x, y, width, height, metric, type) {
  const borderColor = '#ff3a45';
  fillRoundedRect(ctx, x, y, width, height, 8, '#002b33');
  strokeRoundedRect(ctx, x, y, width, height, 8, borderColor, 3);

  const compact = height < 52;
  const iconSize = compact ? 20 : 22;
  const iconY = y + (compact ? 12 : 13);
  drawMetricIcon(ctx, type, x + 9, iconY, iconSize, '#ffffff');

  const labelX = x + 42;
  const labelY = y + (compact ? 14 : 16);
  const valueY = y + (compact ? 35 : 40);
  drawFittedText(ctx, metric?.[1] || '', labelX, labelY, width - 50, compact ? '10px "Arial Narrow", Arial, sans-serif' : '11px "Arial Narrow", Arial, sans-serif', '#ffffff');
  drawFittedText(ctx, metric?.[2] || '0', labelX, valueY, width - 50, compact ? 'bold 16px "Arial Narrow", Arial, sans-serif' : 'bold 18px "Arial Narrow", Arial, sans-serif', '#ffffff');
}

function drawRows(ctx, unit, layout, geometry) {
  const left = layout.x + 18;
  const right = layout.x + layout.w - 18;
  const availableHeight = Math.max(1, geometry.tableBottom - geometry.tableTop);
  const preferredMinRowHeight = layout.lower ? 16 : 15;
  const maxVisibleRows = Math.max(1, Math.floor(availableHeight / preferredMinRowHeight) + 1);
  const requestedRows = unit.rows.slice(0, Math.min(layout.maxRows || maxVisibleRows, maxVisibleRows));
  const hiddenCount = Math.max(0, unit.rows.length - requestedRows.length);
  const rows = requestedRows.slice();

  if (hiddenCount > 0 && rows.length) {
    rows[rows.length - 1] = ['…', '…', 'yellow', `+${hiddenCount + 1} FRENTES`];
  }

  const rowCount = rows.length;
  const lastCenterLimit = geometry.tableBottom - 8;
  const rowHeight = rowCount > 1
    ? Math.min(layout.lower ? 18 : 18, Math.max(preferredMinRowHeight, (lastCenterLimit - geometry.tableTop) / (rowCount - 1)))
    : 18;
  const fontSize = Math.max(12.4, Math.min(15.4, rowHeight - 1.2));
  const statusFontSize = Math.max(11.8, fontSize - 0.2);
  const dotRadius = Math.max(5.5, Math.min(7.25, rowHeight * 0.36));
  const lineOffset = Math.min(8, rowHeight * 0.44);

  ctx.save();
  ctx.strokeStyle = 'rgba(125, 177, 185, 0.42)';
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(left, layout.y + 73);
  ctx.lineTo(right, layout.y + 73);
  ctx.stroke();

  drawFittedText(ctx, 'FRENTE', layout.x + 20, layout.y + 93, 86, 'bold 14.2px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, 'SETOR', layout.x + 153, layout.y + 93, 90, 'bold 14.2px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, 'STATUS', layout.x + 323, layout.y + 93, 135, 'bold 14.2px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');

  ctx.beginPath();
  ctx.moveTo(left, layout.y + 104);
  ctx.lineTo(right, layout.y + 104);
  ctx.stroke();

  rows.forEach(([front = '', sector = '', color = 'yellow', status = ''], index) => {
    const cy = geometry.tableTop + index * rowHeight;

    ctx.beginPath();
    ctx.arc(layout.x + 35, cy, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = statusColorValue(color);
    ctx.fill();

    drawFittedText(ctx, front, layout.x + 55, cy + 0.5, 72, `${fontSize}px "Arial Narrow", Arial, sans-serif`, '#ffffff', 'middle');
    drawFittedText(ctx, sector, layout.x + 155, cy + 0.5, 112, `${fontSize}px "Arial Narrow", Arial, sans-serif`, '#ffffff', 'middle');
    drawFittedText(ctx, status, layout.x + 305, cy + 0.5, right - (layout.x + 305) - 8, `${statusFontSize}px "Arial Narrow", Arial, sans-serif`, statusTextColor(color), 'middle');

    ctx.beginPath();
    ctx.moveTo(left, Math.min(geometry.tableBottom, cy + lineOffset));
    ctx.lineTo(right, Math.min(geometry.tableBottom, cy + lineOffset));
    ctx.stroke();
  });
  ctx.restore();
}

function drawRainBox(ctx, unit, layout, geometry) {
  const { rainX, rainY, rainW, rainH } = geometry;
  const maxLines = layout.lower ? 7 : 11;
  const rows = unit.rain.slice(0, maxLines).map(item => Array.isArray(item) ? [...item] : item);
  const hiddenRainCount = Math.max(0, unit.rain.length - rows.length);
  if (hiddenRainCount > 0 && rows.length) {
    rows[rows.length - 1] = [`+${hiddenRainCount + 1} eq.`, '…', '…'];
  }
  const headerHeight = 30;
  const usableRowsHeight = Math.max(42, rainH - headerHeight - 8);
  const rowHeight = Math.min(layout.lower ? 14 : 13, usableRowsHeight / Math.max(maxLines, 1));

  fillRoundedRect(ctx, rainX, rainY, rainW, rainH, 10, '#003a49');
  strokeRoundedRect(ctx, rainX, rainY, rainW, rainH, 10, 'rgba(150, 219, 230, 0.9)', 2);

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(150, 201, 210, 0.34)';
  drawFittedText(ctx, '☁', rainX + 12, rainY + 17, 20, 'bold 16px Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, 'CHUVA TURNO / ACUM. (mm)', rainX + 37, rainY + 17, rainW - 48, 'bold 12.2px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
  ctx.beginPath();
  ctx.moveTo(rainX + 9, rainY + headerHeight);
  ctx.lineTo(rainX + rainW - 9, rainY + headerHeight);
  ctx.stroke();

  rows.forEach(([eq = '', turn = '-', accum = '-'], index) => {
    const cy = rainY + headerHeight + 8 + index * rowHeight;
    const fontSize = Math.max(10.4, Math.min(12.4, rowHeight - 1.0));
    drawFittedText(ctx, eq, rainX + 39, cy, 78, `bold ${fontSize}px "Arial Narrow", Arial, sans-serif`, '#ffffff', 'middle');
    drawFittedText(ctx, turn, rainX + rainW - 88, cy, 28, `${fontSize}px "Arial Narrow", Arial, sans-serif`, '#ffffff', 'middle');
    drawFittedText(ctx, '/', rainX + rainW - 59, cy, 10, `${fontSize}px Arial, sans-serif`, '#ffffff', 'middle');
    drawFittedText(ctx, accum, rainX + rainW - 45, cy, 32, `${fontSize}px "Arial Narrow", Arial, sans-serif`, '#ffffff', 'middle');

    const dividerY = Math.min(rainY + rainH - 5, cy + rowHeight / 2);
    ctx.beginPath();
    ctx.moveTo(rainX + 9, dividerY);
    ctx.lineTo(rainX + rainW - 9, dividerY);
    ctx.stroke();
  });
  ctx.restore();
}

function getReportLayoutBase(lower = false) {
  return lower
    ? { x: 13, y: 886, w: 492, h: 491, lower: true, maxRows: 7 }
    : { x: 13, y: 271, w: 492, h: 604, lower: false, maxRows: 11 };
}

function getSequentialNotesMetrics(ctx, unit, notesWidth, lower = false) {
  const titleFontSize = lower ? 18 : 20;
  const titleHeight = Math.ceil(titleFontSize * 1.12);
  const titleToBodyGap = lower ? 20 : 22;
  const sectionGap = lower ? 7 : 9;
  const observationFontSize = lower ? 12.8 : 14.6;
  const changesFontSize = Math.max(11.8, observationFontSize - 0.2);
  const lineRatio = 1.18;

  ctx.save();
  ctx.font = `${observationFontSize}px "Arial Narrow", Arial, sans-serif`;
  const observationLines = wrapTextLines(ctx, unit?.observation || '-', notesWidth);
  ctx.restore();

  ctx.save();
  ctx.font = `${changesFontSize}px "Arial Narrow", Arial, sans-serif`;
  const changesLines = wrapTextLines(ctx, unit?.changes || '-', notesWidth);
  ctx.restore();

  const observationLineHeight = observationFontSize * lineRatio;
  const changesLineHeight = changesFontSize * lineRatio;
  const observationHeight = observationLines.length * observationLineHeight;
  const changesHeight = changesLines.length * changesLineHeight;
  const totalHeight = titleHeight + titleToBodyGap + observationHeight + sectionGap + titleHeight + titleToBodyGap + changesHeight;

  return {
    titleFontSize,
    titleHeight,
    titleToBodyGap,
    sectionGap,
    observationFontSize,
    changesFontSize,
    lineRatio,
    observationLines,
    changesLines,
    observationLineHeight,
    changesLineHeight,
    totalHeight
  };
}

function layoutNoteBodySegments(ctx, text, startY, geometry, fontSize, lineHeight) {
  const narrowX = geometry.notesX;
  const narrowW = geometry.notesW;
  const wideX = geometry.notesX;
  const wideW = geometry.fullNotesW;
  const rainBottom = geometry.rainBottom;
  const belowRainGap = 10;
  const content = String(text || '-');
  const segments = [];

  ctx.save();
  ctx.font = `${fontSize}px "Arial Narrow", Arial, sans-serif`;

  if (startY >= rainBottom) {
    const wideLines = wrapTextLines(ctx, content, wideW);
    ctx.restore();
    segments.push({ x: wideX, y: startY, width: wideW, lines: wideLines });
    return { segments, endY: startY + wideLines.length * lineHeight };
  }

  const narrowLines = wrapTextLines(ctx, content, narrowW);
  const fitCount = Math.max(0, Math.floor((rainBottom - startY) / lineHeight));

  if (narrowLines.length <= fitCount || fitCount <= 0) {
    if (fitCount <= 0) {
      const wideLines = wrapTextLines(ctx, content, wideW);
      ctx.restore();
      segments.push({ x: wideX, y: rainBottom + belowRainGap, width: wideW, lines: wideLines });
      return { segments, endY: rainBottom + belowRainGap + wideLines.length * lineHeight };
    }
    ctx.restore();
    segments.push({ x: narrowX, y: startY, width: narrowW, lines: narrowLines });
    return { segments, endY: startY + narrowLines.length * lineHeight };
  }

  const topLines = narrowLines.slice(0, fitCount);
  const remainingText = narrowLines.slice(fitCount).join(' ');
  const wideLines = wrapTextLines(ctx, remainingText, wideW);
  ctx.restore();

  if (topLines.length) {
    segments.push({ x: narrowX, y: startY, width: narrowW, lines: topLines });
  }
  segments.push({ x: wideX, y: rainBottom + belowRainGap, width: wideW, lines: wideLines });
  return {
    segments,
    endY: rainBottom + belowRainGap + wideLines.length * lineHeight
  };
}

function computeSequentialNotesLayout(ctx, unit, geometry, lower = false) {
  const titleFontSize = lower ? 16 : 18;
  const titleToBodyGap = lower ? 20 : 22;
  const sectionGap = lower ? 7 : 9;
  const observationFontSize = lower ? 11.5 : 13;
  const changesFontSize = Math.max(10.5, observationFontSize - 0.4);
  const lineRatio = 1.18;
  const observationLineHeight = observationFontSize * lineRatio;
  const changesLineHeight = changesFontSize * lineRatio;

  let cursorY = geometry.notesY;
  const observationTitleY = cursorY;
  const observationBodyY = cursorY + titleToBodyGap;
  const observation = layoutNoteBodySegments(ctx, unit?.observation || '-', observationBodyY, geometry, observationFontSize, observationLineHeight);
  cursorY = observation.endY + sectionGap;

  const changesTitleY = cursorY;
  const changesBodyY = cursorY + titleToBodyGap;
  const changes = layoutNoteBodySegments(ctx, unit?.changes || '-', changesBodyY, geometry, changesFontSize, changesLineHeight);
  cursorY = changes.endY;

  return {
    titleFontSize,
    titleToBodyGap,
    observationFontSize,
    changesFontSize,
    observationLineHeight,
    changesLineHeight,
    observationTitleY,
    changesTitleY,
    observationSegments: observation.segments,
    changesSegments: changes.segments,
    totalHeight: cursorY - geometry.notesY
  };
}

function drawWrappedTextFixed(ctx, lines, x, y, fontSize, lineHeight, color = '#ffffff', family = '"Arial Narrow", Arial, sans-serif') {
  ctx.save();
  ctx.font = `${fontSize}px ${family}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  lines.forEach((line, index) => {
    ctx.fillText(line || ' ', x, y + index * lineHeight);
  });
  ctx.restore();
  return lines.length * lineHeight;
}

function estimateReportCardHeight(ctx, unit, lower = false) {
  const layout = getReportLayoutBase(lower);
  const geometry = getReportGeometry(ctx, layout, unit);
  const notesLayout = computeSequentialNotesLayout(ctx, unit, geometry, lower);
  const fixedOffsetToNotes = geometry.notesY - layout.y;
  const contentHeight = Math.max(geometry.rainH, notesLayout.totalHeight);
  const requiredHeight = Math.ceil(fixedOffsetToNotes + contentHeight + 12);
  return Math.max(layout.h, requiredHeight);
}

function buildDynamicReportLayouts(ctx, normalizedUnits) {
  const topLeftH = estimateReportCardHeight(ctx, normalizedUnits[0], false);
  const topRightH = estimateReportCardHeight(ctx, normalizedUnits[1], false);
  const topRowHeight = Math.max(topLeftH, topRightH);
  const lowerY = 886 + Math.max(0, topRowHeight - 604);

  const bottomLeftH = estimateReportCardHeight(ctx, normalizedUnits[2], true);
  const bottomRightH = estimateReportCardHeight(ctx, normalizedUnits[3], true);
  const bottomRowHeight = Math.max(bottomLeftH, bottomRightH);
  const footerMargin = 1536 - (886 + 491);

  return {
    lowerY,
    topRowHeight,
    bottomRowHeight,
    layouts: [
      { x: 13, y: 271, w: 492, h: topRowHeight, lower: false, maxRows: 11 },
      { x: 519, y: 271, w: 492, h: topRowHeight, lower: false, maxRows: 11 },
      { x: 13, y: lowerY, w: 492, h: bottomRowHeight, lower: true, maxRows: 7 },
      { x: 519, y: lowerY, w: 492, h: bottomRowHeight, lower: true, maxRows: 7 }
    ],
    canvasHeight: Math.max(REPORT_BASE_HEIGHT, lowerY + bottomRowHeight + footerMargin)
  };
}

function drawUnitOnCanvas(ctx, unit, layout, unitIconImage = null) {
  const geometry = getReportGeometry(ctx, layout, unit);
  prepareCardBody(ctx, layout, unit, borderColorForState(unit.border), unitIconImage);
  drawRows(ctx, unit, layout, geometry);

  const metricWidth = 148;
  const gapX = 8;
  const metricTypes = ['industry', 'gear', 'delivery', 'stock', 'gear', 'delivery'];
  unit.metrics.forEach((metric, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    drawMetricBox(
      ctx,
      layout.x + 15 + col * (metricWidth + gapX),
      geometry.metricY + row * (geometry.metricHeight + geometry.metricGapY),
      metricWidth,
      geometry.metricHeight,
      metric,
      metricTypes[index]
    );
  });

  const notesLayout = computeSequentialNotesLayout(ctx, unit, geometry, layout.lower);

  ctx.save();
  ctx.fillStyle = '#ffe11a';
  ctx.font = `bold ${notesLayout.titleFontSize}px "Arial Narrow", Arial, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText('OBSERVAÇÃO', geometry.notesX, notesLayout.observationTitleY);
  ctx.fillText('MUDANÇAS', geometry.notesX, notesLayout.changesTitleY);
  ctx.restore();

  notesLayout.observationSegments.forEach(segment => {
    drawWrappedTextFixed(
      ctx,
      segment.lines,
      segment.x,
      segment.y,
      notesLayout.observationFontSize,
      notesLayout.observationLineHeight,
      '#ffffff'
    );
  });

  notesLayout.changesSegments.forEach(segment => {
    drawWrappedTextFixed(
      ctx,
      segment.lines,
      segment.x,
      segment.y,
      notesLayout.changesFontSize,
      notesLayout.changesLineHeight,
      '#ffffff'
    );
  });

  drawRainBox(ctx, unit, layout, geometry);
}

function removeReportHeaderLogo(ctx, template) {
  // Reaproveita uma faixa limpa do próprio cabeçalho para cobrir somente o logo Cocal.
  // A transição da borda esquerda é suavizada para não criar uma emenda visível.
  ctx.drawImage(template, 520, 0, 244, 64, 780, 0, 244, 64);

  ctx.save();
  for (let offset = 0; offset < 30; offset += 1) {
    ctx.globalAlpha = (offset + 1) / 30;
    ctx.drawImage(template, 490 + offset, 0, 1, 64, 750 + offset, 0, 1, 64);
  }
  ctx.restore();
}

function paintReportGapBackground(ctx, y, height) {
  if (height <= 0) return;

  const background = ctx.createLinearGradient(0, y, 0, y + height);
  background.addColorStop(0, '#032a34');
  background.addColorStop(0.5, '#032f39');
  background.addColorStop(1, '#02242d');
  ctx.fillStyle = background;
  ctx.fillRect(0, y, REPORT_BASE_WIDTH, height);

  ctx.save();
  ctx.globalAlpha = 0.28;
  const glow = ctx.createRadialGradient(REPORT_BASE_WIDTH * 0.18, y + height * 0.2, 0, REPORT_BASE_WIDTH * 0.18, y + height * 0.2, REPORT_BASE_WIDTH * 0.3);
  glow.addColorStop(0, 'rgba(70, 161, 72, 0.45)');
  glow.addColorStop(1, 'rgba(70, 161, 72, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, y, REPORT_BASE_WIDTH, height);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(124, 230, 55, 0.55)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-20, y + height - 24);
  ctx.bezierCurveTo(REPORT_BASE_WIDTH * 0.18, y + height - 42, REPORT_BASE_WIDTH * 0.42, y + height + 18, REPORT_BASE_WIDTH * 0.7, y + height - 14);
  ctx.bezierCurveTo(REPORT_BASE_WIDTH * 0.85, y + height - 30, REPORT_BASE_WIDTH * 0.95, y + height - 22, REPORT_BASE_WIDTH + 20, y + height - 34);
  ctx.stroke();
  ctx.restore();
}

async function generateReportImageBlob() {
  const normalizedUnits = units.map((unit, index) => normalizeReportUnit(unit, index));

  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = REPORT_BASE_WIDTH;
  measureCanvas.height = REPORT_BASE_HEIGHT;
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) throw new Error('Canvas não suportado neste navegador.');

  const dynamicReport = buildDynamicReportLayouts(measureCtx, normalizedUnits);
  const canvas = document.createElement('canvas');
  canvas.width = REPORT_BASE_WIDTH * REPORT_EXPORT_SCALE;
  canvas.height = dynamicReport.canvasHeight * REPORT_EXPORT_SCALE;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas não suportado neste navegador.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(REPORT_EXPORT_SCALE, REPORT_EXPORT_SCALE);

  const template = await loadReportTemplateImage();
  const reportUnitIcon = await loadReportUnitIconImage();
  ctx.drawImage(template, 0, 0, REPORT_BASE_WIDTH, REPORT_BASE_HEIGHT);

  // Quando os cards precisam crescer, cobrimos as áreas antigas do template
  // para evitar “fantasmas” das unidades originais aparecendo entre os blocos.
  if (dynamicReport.lowerY > 886) {
    paintReportGapBackground(ctx, 886, dynamicReport.lowerY - 886);
  }
  if (dynamicReport.canvasHeight > REPORT_BASE_HEIGHT) {
    paintReportGapBackground(ctx, REPORT_BASE_HEIGHT, dynamicReport.canvasHeight - REPORT_BASE_HEIGHT);
  }

  removeReportHeaderLogo(ctx, template);
  if (typeof template.close === 'function') template.close();

  const { greeting, date } = getHeaderDataForExport(new Date());
  ctx.fillStyle = 'rgba(2, 33, 40, 0.98)';
  ctx.fillRect(26, 20, 175, 36);
  ctx.fillRect(262, 20, 205, 36);
  drawFittedText(ctx, greeting, 28, 38, 165, 'bold 31px Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, `${date} - TC`, 260, 38, 195, 'bold 28px Arial, sans-serif', '#ffffff', 'middle');

  dynamicReport.layouts.forEach((layout, index) => drawUnitOnCanvas(ctx, normalizedUnits[index], layout, reportUnitIcon));
  if (typeof reportUnitIcon?.close === 'function') reportUnitIcon.close();

  return new Promise((resolve, reject) => {
    if (REPORT_EXPORT_MIME_TYPE === 'image/png') {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Não foi possível converter o relatório para PNG.'));
      }, 'image/png');
      return;
    }

    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Não foi possível converter o relatório para JPG.'));
    }, 'image/jpeg', 0.98);
  });
}

function downloadBlobFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveJpgReport() {
  closeAllModals();
  showToast(`Gerando imagem ${REPORT_EXPORT_EXTENSION.toUpperCase()} em alta definição...`);
  try {
    const blob = await generateReportImageBlob();
    const today = new Date().toLocaleDateString('pt-BR').replaceAll('/', '-');
    downloadBlobFile(blob, `Posicao-de-Campo-${today}.${REPORT_EXPORT_EXTENSION}`);
    showToast(`Imagem ${REPORT_EXPORT_EXTENSION.toUpperCase()} gerada com sucesso.`);
  } catch (error) {
    console.error(error);
    showToast(`Não foi possível gerar a imagem ${REPORT_EXPORT_EXTENSION.toUpperCase()}. Verifique a imagem-base do relatório.`);
  }
}

function openExportImageModal() {
  openModal('export-image-modal');
}

function getSacaroseExportRows(unitCode) {
  // Prioriza o que está atualmente preenchido no popup da Sacarose.
  // Assim o checkbox "Não exibir" é respeitado imediatamente na imagem.
  const tbody = document.querySelector(`#sacarose-rows-${unitCode}`);
  const editorRows = tbody?.querySelector('.sacarose-row')
    ? collectSacaroseRows(unitCode)
    : [];

  const source = editorRows.length
    ? editorRows
    : (Array.isArray(sacaroseUnits[unitCode]) && sacaroseUnits[unitCode].length
      ? sacaroseUnits[unitCode]
      : sacaroseRowsFromCurrentUnit(unitCode));

  return [...source]
    .map(item => {
      const sector = String(item?.sector || '').trim();
      const baseItem = getSectorBaseItem(sector);
      return {
        front: String(item?.front || '').trim(),
        sector,
        section: String(baseItem?.section || item?.section || '').trim(),
        description: String(baseItem?.description || item?.description || '').trim(),
        exclude_image: Boolean(item?.exclude_image)
      };
    })
    .filter(item => !item.exclude_image && (item.front || item.sector))
    .sort((a, b) => compareFrontLabels(a.front, b.front));
}

function getSacaroseExportConfig() {
  const selectedCode = String(units[selectedUnitIndex]?.code || '').toUpperCase();
  const isPoloMS = ['RBR', 'PST'].includes(selectedCode);

  return {
    poloLabel: isPoloMS ? 'MS' : 'SP',
    exportUnits: isPoloMS ? ['RBR', 'PST'] : ['NRD', 'PPT']
  };
}

function drawSacaroseHeaderIcon(ctx, iconImage, x, y, size) {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(iconImage, x, y, size, size);
  ctx.restore();
}

function drawSacaroseExportBackground(ctx, width, height) {
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#edf3ef');
  bg.addColorStop(1, '#f4f7f5');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(170, 0);
  ctx.lineTo(0, 170);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  ctx.moveTo(width, height);
  ctx.lineTo(width - 210, height);
  ctx.lineTo(width, height - 210);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSacaroseExportUnit(ctx, code, rows, x, y, width, iconImage) {
  const headerH = 66;
  const columnsH = 36;
  const rowH = 60;
  const emptyH = 66;
  const bodyH = rows.length ? rows.length * rowH : emptyH;
  const height = headerH + columnsH + bodyH;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = '#d7e3da';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.restore();

  const headerFill = ctx.createLinearGradient(x, y, x + width, y);
  headerFill.addColorStop(0, '#8dd24f');
  headerFill.addColorStop(1, '#b5e698');
  ctx.save();
  ctx.fillStyle = headerFill;
  ctx.fillRect(x, y, width, headerH);
  ctx.restore();

  const iconSize = 44;
  const iconX = x + 18;
  const iconY = y + 11;
  drawSacaroseHeaderIcon(ctx, iconImage, iconX, iconY, iconSize);

  ctx.save();
  ctx.strokeStyle = 'rgba(56, 102, 55, 0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(iconX + iconSize + 18, y + 13);
  ctx.lineTo(iconX + iconSize + 18, y + headerH - 13);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = '#0b2417';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.fillText(`POSIÇÃO DE COLHEITA ${code}`, x + width / 2, y + headerH / 2 + 2);
  ctx.restore();

  const colY = y + headerH;
  ctx.save();
  ctx.fillStyle = '#40556b';
  ctx.fillRect(x, colY, width, columnsH);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px Arial, sans-serif';
  const colFront = x + 86;
  const colSection = x + 342;
  const colSector = x + 590;
  const colFarm = x + 910;
  ctx.fillText('Frente', colFront, colY + columnsH / 2);
  ctx.fillText('Seção', colSection, colY + columnsH / 2);
  ctx.fillText('Setor', colSector, colY + columnsH / 2);
  ctx.fillText('Fazenda', colFarm, colY + columnsH / 2);
  ctx.restore();

  // subtle vertical separators matching the reference layout
  ctx.save();
  ctx.strokeStyle = '#dce5df';
  ctx.lineWidth = 1;
  [x + 220, x + 465, x + 705].forEach(separatorX => {
    ctx.beginPath();
    ctx.moveTo(separatorX, colY);
    ctx.lineTo(separatorX, y + height);
    ctx.stroke();
  });
  ctx.restore();

  if (!rows.length) {
    ctx.save();
    ctx.fillStyle = '#6c7d71';
    ctx.font = '16px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Nenhuma frente informada.', x + 22, colY + columnsH + emptyH / 2);
    ctx.restore();
    return height;
  }

  rows.forEach((item, index) => {
    const rowY = colY + columnsH + index * rowH;
    ctx.save();
    ctx.fillStyle = index % 2 === 0 ? '#f9fbfa' : '#f1f6f3';
    ctx.fillRect(x, rowY, width, rowH);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#eef3ef';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, rowY + rowH);
    ctx.lineTo(x + width, rowY + rowH);
    ctx.stroke();
    ctx.restore();

    drawFittedText(ctx, item.front || '-', colFront - 32, rowY + rowH / 2, 64, 'bold 18px Arial, sans-serif', '#0d3c28', 'middle');
    drawFittedText(ctx, item.section || '-', colSection - 54, rowY + rowH / 2, 108, '17px Arial, sans-serif', '#1a2435', 'middle');
    drawFittedText(ctx, item.sector || '-', colSector - 54, rowY + rowH / 2, 108, '17px Arial, sans-serif', '#1a2435', 'middle');
    drawWrappedTextFit(ctx, item.description || '-', colFarm - 180, rowY + 8, 360, rowH - 16, {
      maxFontSize: 15,
      minFontSize: 10,
      color: '#162234',
      family: 'Arial, sans-serif',
      lineRatio: 1.06
    });
  });

  return height;
}

async function generateSacaroseReportImageBlob() {
  if (!sectorBaseItems.length) await loadSectorBase({ render: false });

  const { exportUnits } = getSacaroseExportConfig();

  // Evita recarregar os dados do servidor por cima da seleção atual
  // do checkbox "Não exibir". Só busca do servidor se não houver
  // dados nem no formulário nem na memória.
  const hasEditorRows = exportUnits.some(code =>
    Boolean(document.querySelector(`#sacarose-rows-${code} .sacarose-row`))
  );
  const hasMemoryRows = exportUnits.some(code =>
    Array.isArray(sacaroseUnits[code]) && sacaroseUnits[code].length
  );

  if (!hasEditorRows && !hasMemoryRows) {
    await loadSacaroseData();
  }

  const sacaroseIcon = await loadSacaroseHeaderIconImage();

  const exportRows = exportUnits.map(code => ({
    code,
    rows: getSacaroseExportRows(code)
  }));

  const unitHeight = rows => 66 + 36 + (rows.length ? rows.length * 60 : 66);
  const baseWidth = 1145;
  const topMargin = 74;
  const sideMargin = 32;
  const gap = 42;
  const bottomMargin = 34;
  const totalUnitsHeight = exportRows.reduce((sum, item, index) => (
    sum + unitHeight(item.rows) + (index < exportRows.length - 1 ? gap : 0)
  ), 0);
  const baseHeight = Math.max(1374, topMargin + totalUnitsHeight + bottomMargin);
  const scale = REPORT_EXPORT_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = baseWidth * scale;
  canvas.height = baseHeight * scale;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas não suportado neste navegador.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(scale, scale);

  drawSacaroseExportBackground(ctx, baseWidth, baseHeight);

  const { date } = getHeaderDataForExport(new Date());
  ctx.save();
  ctx.fillStyle = '#3b4d63';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 24px Arial, sans-serif';
  ctx.fillText(date, baseWidth - 34, 40);
  ctx.restore();

  let y = 102;
  exportRows.forEach((item, index) => {
    y += drawSacaroseExportUnit(ctx, item.code, item.rows, sideMargin, y, baseWidth - sideMargin * 2, sacaroseIcon);
    if (index < exportRows.length - 1) y += gap;
  });
  if (typeof sacaroseIcon.close === 'function') sacaroseIcon.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Não foi possível converter a posição da Sacarose para PNG.'));
    }, 'image/png');
  });
}

async function saveSacaroseReport() {
  closeAllModals();
  showToast('Gerando imagem da Sacarose em alta definição...');
  try {
    const blob = await generateSacaroseReportImageBlob();
    const today = new Date().toLocaleDateString('pt-BR').replaceAll('/', '-');
    downloadBlobFile(blob, `Posicao-Sacarose-${today}.png`);
    showToast('Imagem da Sacarose gerada com sucesso.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível gerar a imagem da Sacarose.');
  }
}

function formatReportDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours >= 100) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatReportPercent(value) {
  const numeric = Number(value) || 0;
  return `${numeric.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatReportDate(isoDate) {
  if (!isoDate) return '-';
  const [year, month, day] = String(isoDate).split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(isoDate);
}

function formatReportClock(isoDateTime) {
  if (!isoDateTime) return '-';
  const text = String(isoDateTime);
  const timePart = text.includes('T') ? text.split('T')[1] : text;
  return timePart.slice(0, 5);
}

function reportScopeText(report) {
  const unitsText = Array.isArray(report.units) && report.units.length ? report.units.join(', ') : '-';
  const frontsText = Array.isArray(report.fronts) && report.fronts.length ? report.fronts.join(', ') : '-';
  return `${unitsText} · ${frontsText}`;
}

const EXCEL_METRIC_KEYS = ['total', 'productive', 'maintenance', 'improductive', 'climate', 'auxiliary', 'other'];
let excelSelectedDetail = null;

function emptyExcelTotals() {
  return Object.fromEntries(EXCEL_METRIC_KEYS.map(key => [key, 0]));
}

function addExcelTotals(target, source) {
  EXCEL_METRIC_KEYS.forEach(key => {
    target[key] += Number(source?.[key] || 0);
  });
  return target;
}

function finalizeExcelTotals(target) {
  const result = { ...target };
  result.utilization_pct = result.total ? (result.productive / result.total) * 100 : 0;
  const withoutClimate = Math.max(0, result.total - result.climate);
  result.utilization_without_climate_pct = withoutClimate ? (result.productive / withoutClimate) * 100 : 0;
  result.recoverable_loss = result.maintenance + result.improductive;
  return result;
}

function excelKpiHtml(label, value, detail, tone = 'neutral') {
  return `<article class="excel-kpi is-${tone}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></article>`;
}

function getExcelFilterValues() {
  return {
    front: document.querySelector('#excel-filter-front')?.value || '',
    shift: document.querySelector('#excel-filter-shift')?.value || '',
    operator: document.querySelector('#excel-filter-operator')?.value || '',
    equipment: document.querySelector('#excel-filter-equipment')?.value || '',
    team: document.querySelector('#excel-filter-team')?.value || '',
    date: document.querySelector('#excel-filter-date')?.value || ''
  };
}

function setExcelFilterOptions(selector, items, valueKey, labelFn, defaultLabel) {
  const select = document.querySelector(selector);
  if (!select) return;
  const options = [`<option value="">${escapeHtml(defaultLabel)}</option>`];
  items.forEach(item => {
    const value = typeof valueKey === 'function' ? valueKey(item) : item?.[valueKey];
    options.push(`<option value="${escapeHtml(String(value ?? ''))}">${escapeHtml(labelFn(item))}</option>`);
  });
  select.innerHTML = options.join('');
}

function populateExcelReportFilters(report) {
  const fronts = [...new Set((report.performance_rows || []).map(item => item.front).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const operatorsMap = new Map();
  (report.performance_rows || []).forEach(item => {
    if (!operatorsMap.has(item.operator_key)) operatorsMap.set(item.operator_key, item);
  });
  const operators = [...operatorsMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const fleets = Array.isArray(report.fleets) ? report.fleets : [];
  const dates = [...new Set((report.dates || []).filter(Boolean))].sort();

  setExcelFilterOptions('#excel-filter-front', fronts, item => item, item => item, 'Todas');
  setExcelFilterOptions('#excel-filter-operator', operators, 'operator_key', item => `${item.name}${item.code ? ` · ${item.code}` : ''}`, 'Todos');
  setExcelFilterOptions('#excel-filter-equipment', fleets, item => item.code || item.name || item.label, item => item.label || item.code || item.name, 'Todas');
  setExcelFilterOptions('#excel-filter-date', dates, item => item, item => formatReportDate(item), 'Todas');
  ['#excel-filter-shift', '#excel-filter-team'].forEach(selector => {
    const select = document.querySelector(selector);
    if (select) select.value = '';
  });
}

function filterExcelPerformanceRows(report, filters) {
  return (report.performance_rows || []).filter(item => {
    if (filters.front && item.front !== filters.front) return false;
    if (filters.shift && item.shift !== filters.shift) return false;
    if (filters.operator && item.operator_key !== filters.operator) return false;
    if (filters.equipment && item.equipment_key !== filters.equipment && item.equipment_code !== filters.equipment) return false;
    if (filters.date && item.date !== filters.date) return false;
    if (filters.team === 'team' && !item.team_member) return false;
    if (filters.team === 'occasional' && item.team_member) return false;
    return true;
  });
}

function filterExcelTimeline(report, filters) {
  return (report.timeline || []).filter(item => {
    if (filters.front && item.front !== filters.front) return false;
    if (filters.shift && item.shift !== filters.shift) return false;
    if (filters.operator && item.operator_key !== filters.operator) return false;
    if (filters.equipment && item.equipment_key !== filters.equipment && item.equipment_code !== filters.equipment) return false;
    if (filters.date && item.date !== filters.date) return false;
    if (filters.team === 'team' && !item.team_member) return false;
    if (filters.team === 'occasional' && item.team_member) return false;
    return true;
  });
}

function summarizeExcelRows(rows, keyFn, seedFn) {
  const grouped = new Map();
  rows.forEach(row => {
    const key = keyFn(row);
    if (!grouped.has(key)) {
      grouped.set(key, { ...seedFn(row), ...emptyExcelTotals(), operatorKeys: new Set(), equipmentKeys: new Set(), dates: new Set() });
    }
    const item = grouped.get(key);
    addExcelTotals(item, row);
    if (row.operator_key) item.operatorKeys.add(row.operator_key);
    if (row.equipment_key) item.equipmentKeys.add(row.equipment_key);
    if (row.date) item.dates.add(row.date);
  });
  return [...grouped.values()].map(item => ({
    ...item,
    operators_count: item.operatorKeys.size,
    equipments_count: item.equipmentKeys.size,
    dates_list: [...item.dates].sort(),
    ...finalizeExcelTotals(item)
  }));
}

function renderExcelKpis(rows) {
  const totals = finalizeExcelTotals(rows.reduce((acc, item) => addExcelTotals(acc, item), emptyExcelTotals()));
  const operators = new Set(rows.map(item => item.operator_key).filter(Boolean));
  const fleets = new Set(rows.map(item => item.equipment_key).filter(Boolean));
  const target = document.querySelector('#excel-kpis');
  if (!target) return;
  target.innerHTML = [
    excelKpiHtml('Tempo analisado', formatReportDuration(totals.total), 'Dentro dos filtros atuais'),
    excelKpiHtml('Produtivo', formatReportDuration(totals.productive), 'Horas classificadas como produtivas', 'positive'),
    excelKpiHtml('Aprov. sem clima', formatReportPercent(totals.utilization_without_climate_pct), 'Produtivo ÷ tempo sem clima', 'positive'),
    excelKpiHtml('Perda recuperável', formatReportDuration(totals.recoverable_loss), 'Manutenção + improdutividade', totals.recoverable_loss ? 'warning' : 'neutral'),
    excelKpiHtml('Operadores', String(operators.size), 'Presentes no filtro'),
    excelKpiHtml('Frotas', String(fleets.size), 'Equipamentos utilizados')
  ].join('');
}

function entityButtonHtml(type, item) {
  const label = type === 'fleet' ? item.equipment_label : item.name;
  const secondary = type === 'fleet'
    ? `${item.operators_count} operador(es) · ${formatReportDuration(item.total)}`
    : `${item.equipments_count} frota(s) · ${formatReportDuration(item.total)}`;
  const key = type === 'fleet' ? item.equipment_key : item.operator_key;
  return `
    <button class="excel-entity-row" type="button" data-report-entity="${type}" data-report-key="${escapeHtml(key)}">
      <span class="excel-entity-icon" aria-hidden="true">${type === 'fleet' ? '🚜' : '👤'}</span>
      <span class="excel-entity-copy"><strong>${escapeHtml(label || '-')}</strong><small>${escapeHtml(secondary)}</small></span>
      <span class="excel-entity-metric"><strong>${escapeHtml(formatReportPercent(item.utilization_without_climate_pct))}</strong><small>aprov.</small></span>
      <span class="excel-entity-chevron" aria-hidden="true">›</span>
    </button>`;
}

function renderExcelEntityLists(rows) {
  const fleets = summarizeExcelRows(rows, row => row.equipment_key, row => ({
    equipment_key: row.equipment_key,
    equipment_code: row.equipment_code,
    equipment_name: row.equipment_name,
    equipment_label: row.equipment_label || row.equipment_key
  })).sort((a, b) => String(a.equipment_label).localeCompare(String(b.equipment_label), 'pt-BR'));

  const operators = summarizeExcelRows(rows, row => row.operator_key, row => ({
    operator_key: row.operator_key,
    code: row.code,
    name: row.name,
    is_generic: Boolean(row.is_generic)
  })).filter(item => !item.is_generic).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));

  const fleetList = document.querySelector('#excel-fleet-list');
  const operatorList = document.querySelector('#excel-operator-list');
  if (fleetList) fleetList.innerHTML = fleets.length ? fleets.map(item => entityButtonHtml('fleet', item)).join('') : '<div class="excel-empty-state">Nenhuma frota nos filtros atuais.</div>';
  if (operatorList) operatorList.innerHTML = operators.length ? operators.map(item => entityButtonHtml('operator', item)).join('') : '<div class="excel-empty-state">Nenhum operador nos filtros atuais.</div>';
  document.querySelector('#excel-fleet-list-count').textContent = String(fleets.length);
  document.querySelector('#excel-operator-list-count').textContent = String(operators.length);
}

function reportTimestamp(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function equipmentMatches(item, key) {
  return item.equipment_key === key || item.equipment_code === key;
}

function findPrimaryFleetForOperator(rows, operatorKey) {
  const totals = new Map();
  rows.filter(row => row.operator_key === operatorKey).forEach(row => {
    totals.set(row.equipment_key, (totals.get(row.equipment_key) || 0) + Number(row.total || 0));
  });
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function buildThreeOperatorComparison(rows, fleetKey) {
  const fleetRows = rows.filter(row => equipmentMatches(row, fleetKey));
  const byShiftOperator = summarizeExcelRows(
    fleetRows,
    row => `${row.shift}|${row.operator_key}`,
    row => ({ shift: row.shift, operator_key: row.operator_key, name: row.name, code: row.code, equipment_label: row.equipment_label || row.equipment_key, is_generic: Boolean(row.is_generic) })
  ).filter(item => !item.is_generic);

  return ['A', 'B', 'C'].map(shift => {
    const candidates = byShiftOperator.filter(item => item.shift === shift).sort((a, b) => b.total - a.total || b.productive - a.productive);
    return candidates[0] || { shift, empty: true };
  });
}

function renderThreeOperatorComparison(rows, fleetKey) {
  const container = document.querySelector('#excel-three-operator-comparison');
  if (!container) return;
  const comparison = buildThreeOperatorComparison(rows, fleetKey);
  const valid = comparison.filter(item => !item.empty && (item.total - item.climate) > 0);
  const best = [...valid].sort((a, b) => b.utilization_without_climate_pct - a.utilization_without_climate_pct || b.productive - a.productive)[0];
  const lowest = valid.length > 1 ? [...valid].sort((a, b) => a.utilization_without_climate_pct - b.utilization_without_climate_pct || a.productive - b.productive)[0] : null;

  container.innerHTML = comparison.map(item => {
    if (item.empty) return `<article class="excel-comparison-card is-empty"><span>Turno ${item.shift}</span><strong>Sem operador</strong><small>Não há dados neste turno para a frota selecionada.</small></article>`;
    const isBest = best && best.operator_key === item.operator_key && best.shift === item.shift;
    const isLow = lowest && lowest.operator_key === item.operator_key && lowest.shift === item.shift && !isBest;
    return `
      <article class="excel-comparison-card ${isBest ? 'is-best' : (isLow ? 'is-low' : '')}">
        <div class="excel-comparison-card-head"><span>Turno ${escapeHtml(item.shift)}</span>${isBest ? '<b>Maior aproveitamento</b>' : (isLow ? '<b>Menor aproveitamento</b>' : '')}</div>
        <h4>${escapeHtml(item.name)}</h4>
        <p>${escapeHtml(item.equipment_label || fleetKey)}</p>
        <div class="excel-comparison-metrics">
          <span><small>Aprov. sem clima</small><strong>${escapeHtml(formatReportPercent(item.utilization_without_climate_pct))}</strong></span>
          <span><small>Produtivo</small><strong>${escapeHtml(formatReportDuration(item.productive))}</strong></span>
          <span><small>Manutenção</small><strong>${escapeHtml(formatReportDuration(item.maintenance))}</strong></span>
          <span><small>Improdutivo</small><strong>${escapeHtml(formatReportDuration(item.improductive))}</strong></span>
        </div>
      </article>`;
  }).join('');
}

function categoryIcon(category) {
  if (category === 'productive') return '✅';
  if (category === 'maintenance') return '🔧';
  if (category === 'improductive') return '⚠';
  if (category === 'climate') return '🌧';
  return 'ℹ';
}

function occurrenceItem(icon, text, meta = '', tone = 'neutral') {
  return { icon, text, meta, tone };
}

function buildShiftChangeOccurrences(events) {
  const items = [];
  const byFleet = new Map();
  events.forEach(event => {
    const key = event.equipment_key || event.equipment_code;
    if (!key) return;
    if (!byFleet.has(key)) byFleet.set(key, []);
    byFleet.get(key).push(event);
  });

  byFleet.forEach(fleetEvents => {
    fleetEvents.sort((a, b) => reportTimestamp(a.start) - reportTimestamp(b.start));
    for (let index = 1; index < fleetEvents.length; index += 1) {
      const previous = fleetEvents[index - 1];
      const current = fleetEvents[index];
      if (previous.shift === current.shift) continue;
      const gapSeconds = Math.max(0, Math.round((reportTimestamp(current.start) - reportTimestamp(previous.end)) / 1000));
      if (gapSeconds > 180) {
        items.push(occurrenceItem('⚠', `Troca de turno durou ${formatReportDuration(gapSeconds)}, acima do limite de 3 minutos.`, `${formatReportDate(current.date)} · Turno ${previous.shift} → ${current.shift} · ${current.equipment_code || current.equipment_key}`, 'warning'));
      }

      const boundary = reportTimestamp(current.start);
      const windowStart = boundary - 3600 * 1000;
      const hourEvents = fleetEvents.filter(event => reportTimestamp(event.start) < boundary && reportTimestamp(event.end) > windowStart && reportTimestamp(event.end) <= boundary + 1000);
      let lastProductiveIndex = -1;
      hourEvents.forEach((event, eventIndex) => { if (event.category === 'productive') lastProductiveIndex = eventIndex; });
      if (lastProductiveIndex >= 0) {
        const afterProductive = hourEvents.slice(lastProductiveIndex + 1);
        const onlyImproductive = afterProductive.length && afterProductive.every(event => event.category === 'improductive');
        const reachesBoundary = afterProductive.length && Math.abs(boundary - reportTimestamp(afterProductive[afterProductive.length - 1].end)) <= 5 * 60 * 1000;
        if (onlyImproductive && reachesBoundary) {
          const total = afterProductive.reduce((sum, event) => sum + Number(event.seconds || 0), 0);
          const operations = [...new Set(afterProductive.map(event => event.operation).filter(Boolean))].join(', ');
          items.push(occurrenceItem('⚠', `Na hora anterior à troca de turno, o equipamento saiu de atividade produtiva, entrou somente em atividade(s) improdutiva(s) (${operations || 'sem descrição'}) e permaneceu assim até a troca, totalizando ${formatReportDuration(total)} de parada improdutiva.`, `${formatReportDate(current.date)} · ${current.equipment_code || current.equipment_key}`, 'warning'));
        }
      }
    }
  });
  return items;
}

function buildEventOccurrences(events) {
  const items = [];
  const sorted = [...events].sort((a, b) => reportTimestamp(a.start) - reportTimestamp(b.start));
  sorted.forEach(event => {
    const seconds = Number(event.seconds || 0);
    if (event.category === 'productive' && seconds < 1800) return;
    if (['maintenance', 'improductive'].includes(event.category) && seconds < 300) return;
    if (event.category === 'climate' && seconds < 900) return;
    if (['auxiliary', 'other'].includes(event.category) && seconds < 1200) return;
    const operator = event.operator_name ? ` · ${event.operator_name}` : '';
    const fleet = event.equipment_code || event.equipment_key || 'sem frota';
    items.push(occurrenceItem(
      categoryIcon(event.category),
      `${formatReportDate(event.date)} · ${formatReportClock(event.start)}–${formatReportClock(event.end)} · ${event.operation || event.category_label || 'Atividade'} por ${formatReportDuration(seconds)}.`,
      `Turno ${event.shift} · Frota ${fleet}${operator}`,
      event.category === 'productive' ? 'positive' : (['maintenance', 'improductive'].includes(event.category) ? 'warning' : 'neutral')
    ));
  });
  return items;
}

function renderOccurrenceList(events) {
  const container = document.querySelector('#excel-occurrence-list');
  if (!container) return;
  const occurrences = [...buildShiftChangeOccurrences(events), ...buildEventOccurrences(events)];
  if (!occurrences.length) {
    container.innerHTML = '<div class="excel-empty-state">Nenhum acontecimento relevante foi identificado para esta seleção.</div>';
    return;
  }
  container.innerHTML = occurrences.slice(0, 60).map(item => `
    <article class="excel-occurrence-item is-${item.tone}">
      <span class="excel-occurrence-icon" aria-hidden="true">${item.icon}</span>
      <div><p>${escapeHtml(item.text)}</p>${item.meta ? `<small>${escapeHtml(item.meta)}</small>` : ''}</div>
    </article>`).join('');
}

function renderDetailKpis(rows) {
  const totals = finalizeExcelTotals(rows.reduce((acc, item) => addExcelTotals(acc, item), emptyExcelTotals()));
  const target = document.querySelector('#excel-detail-kpis');
  if (!target) return;
  target.innerHTML = [
    excelKpiHtml('Tempo', formatReportDuration(totals.total), 'Tempo analisado'),
    excelKpiHtml('Produtivo', formatReportDuration(totals.productive), 'Horas produtivas', 'positive'),
    excelKpiHtml('Aprov. sem clima', formatReportPercent(totals.utilization_without_climate_pct), 'Indicador comparável', 'positive'),
    excelKpiHtml('Manutenção', formatReportDuration(totals.maintenance), 'Paradas de manutenção', totals.maintenance ? 'warning' : 'neutral'),
    excelKpiHtml('Improdutivo', formatReportDuration(totals.improductive), 'Perdas operacionais', totals.improductive ? 'warning' : 'neutral')
  ].join('');
}

function openExcelDetail(type, key) {
  if (!excelReportData) return;
  const filters = getExcelFilterValues();
  const allRows = filterExcelPerformanceRows(excelReportData, filters);
  const allEvents = filterExcelTimeline(excelReportData, filters);
  let detailRows = [];
  let detailEvents = [];
  let fleetKey = '';
  let title = '';
  let subtitle = '';

  if (type === 'fleet') {
    fleetKey = key;
    detailRows = allRows.filter(row => equipmentMatches(row, key));
    detailEvents = allEvents.filter(event => equipmentMatches(event, key));
    const first = detailRows[0] || detailEvents[0];
    title = first?.equipment_label || (first?.equipment_name ? `${first?.equipment_code || key} · ${first.equipment_name}` : key);
    subtitle = 'Comparação dos operadores que utilizaram esta frota nos turnos A, B e C.';
    document.querySelector('#excel-detail-kicker').textContent = 'Frota selecionada';
  } else {
    detailRows = allRows.filter(row => row.operator_key === key);
    detailEvents = allEvents.filter(event => event.operator_key === key);
    fleetKey = findPrimaryFleetForOperator(allRows, key);
    const first = detailRows[0] || detailEvents[0];
    title = first?.name || first?.operator_name || key;
    const fleetLabel = detailRows.find(row => row.equipment_key === fleetKey)?.equipment_label || fleetKey || 'sem frota principal';
    subtitle = `Comparativo com os operadores dos outros turnos na frota predominante: ${fleetLabel}.`;
    document.querySelector('#excel-detail-kicker').textContent = 'Operador selecionado';
  }

  if (!detailRows.length && !detailEvents.length) {
    showToast('Não há dados para essa seleção dentro dos filtros atuais.');
    return;
  }

  excelSelectedDetail = { type, key, fleetKey };
  document.querySelector('#excel-detail-title').textContent = title || '-';
  document.querySelector('#excel-detail-subtitle').textContent = subtitle;
  renderDetailKpis(detailRows);
  renderThreeOperatorComparison(allRows, fleetKey);
  renderOccurrenceList(detailEvents);
  excelFilteredTimeline = detailEvents;
  openModal('excel-detail-modal');
}

function closeExcelDetail() {
  excelSelectedDetail = null;
  excelFilteredTimeline = [];
  closeModal('excel-detail-modal');
}

function applyExcelReportFilters() {
  if (!excelReportData) return;
  const filters = getExcelFilterValues();
  const rows = filterExcelPerformanceRows(excelReportData, filters);
  renderExcelKpis(rows);
  renderExcelEntityLists(rows);
  closeExcelDetail();
}

function renderExcelReport(report) {
  excelReportData = report;
  const results = document.querySelector('#excel-report-results');
  if (!results) return;
  document.querySelector('#excel-meta-file').textContent = report.file || '-';
  const start = formatReportDate(report.period?.start);
  const end = formatReportDate(report.period?.end);
  document.querySelector('#excel-meta-period').textContent = start === end ? start : `${start} a ${end}`;
  document.querySelector('#excel-meta-scope').textContent = reportScopeText(report);
  document.querySelector('#excel-meta-counts').textContent = `${report.records || 0} registros · ${report.operators_count || 0} operadores · ${report.equipments_count || 0} frotas`;
  populateExcelReportFilters(report);

  const unclassified = document.querySelector('#excel-unclassified');
  if (unclassified) {
    const operations = Array.isArray(report.unclassified_operations) ? report.unclassified_operations : [];
    unclassified.hidden = !operations.length;
    unclassified.innerHTML = operations.length ? `<strong>Operações ainda não classificadas:</strong> ${operations.map(escapeHtml).join(', ')}.` : '';
  }

  results.hidden = false;
  applyExcelReportFilters();
}

function showAppView(viewName) {
  const dashboardView = document.querySelector('#dashboard-view');
  const excelView = document.querySelector('#excel-report-view');
  const reportsButton = document.querySelector('#open-excel-reports');
  const showExcel = viewName === 'excel';
  dashboardView?.classList.toggle('is-active', !showExcel);
  excelView?.classList.toggle('is-active', showExcel);
  dashboardView?.setAttribute('aria-hidden', String(showExcel));
  excelView?.setAttribute('aria-hidden', String(!showExcel));
  reportsButton?.classList.toggle('is-active', showExcel);
  if (showExcel) closeAllModals();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function setupAppViewNavigation() {
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-app-view-target]');
    if (!trigger) return;
    event.preventDefault();
    showAppView(trigger.dataset.appViewTarget);
  });
}

function excelFileValidation(file) {
  if (!file) return { valid: false, message: 'Selecione um arquivo CSV ou Excel para processar.' };
  const filename = String(file.name || '').trim().toLocaleLowerCase('pt-BR');
  if (filename.endsWith('.csv') || filename.endsWith('.xlsx') || filename.endsWith('.xlsm')) {
    return { valid: true, message: '' };
  }
  if (filename.endsWith('.xls')) {
    return { valid: false, message: 'O formato .xls antigo não é suportado. Salve o arquivo como .xlsx, .xlsm ou CSV.' };
  }
  return { valid: false, message: 'Selecione um arquivo CSV, .xlsx ou .xlsm.' };
}

function excelFileTypeLabel(file) {
  const filename = String(file?.name || '').trim().toLocaleLowerCase('pt-BR');
  if (filename.endsWith('.csv')) return 'CSV';
  if (filename.endsWith('.xlsm')) return 'Excel XLSM';
  if (filename.endsWith('.xlsx')) return 'Excel XLSX';
  return 'Arquivo';
}

function updateExcelFileLabel(inputElement = null) {
  const input = inputElement?.matches?.('#excel-report-file') ? inputElement : document.querySelector('#excel-report-file');
  const label = document.querySelector('#excel-report-file-name');
  const status = document.querySelector('#excel-report-status');
  if (!label) return;
  const file = input?.files?.[0];
  if (!file) {
    label.textContent = 'Nenhum arquivo selecionado';
    return;
  }
  label.textContent = `${file.name} · ${(file.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
  const validation = excelFileValidation(file);
  if (status) {
    status.className = validation.valid ? 'excel-report-status is-success' : 'excel-report-status is-error';
    status.textContent = validation.valid ? `${excelFileTypeLabel(file)} identificado: ${file.name}` : validation.message;
  }
}

function setupExcelReportFileHandling() {
  document.addEventListener('change', event => {
    if (!event.target?.matches?.('#excel-report-file')) return;
    updateExcelFileLabel(event.target);
  });
  document.addEventListener('submit', event => {
    if (!event.target?.matches?.('#excel-report-form')) return;
    processExcelReport(event);
  });
  document.addEventListener('click', event => {
    const entity = event.target.closest('[data-report-entity]');
    if (entity) {
      openExcelDetail(entity.dataset.reportEntity, entity.dataset.reportKey || '');
      return;
    }
  });
}

async function processExcelReport(event) {
  event.preventDefault();
  const input = document.querySelector('#excel-report-file');
  const file = input?.files?.[0];
  const button = document.querySelector('#excel-report-process');
  const status = document.querySelector('#excel-report-status');
  const validation = excelFileValidation(file);
  if (!validation.valid) {
    if (status) {
      status.className = 'excel-report-status is-error';
      status.textContent = validation.message;
    }
    return;
  }
  if (button) button.disabled = true;
  if (status) {
    status.className = 'excel-report-status';
    status.textContent = `Processando ${excelFileTypeLabel(file)}, turnos, operadores, frotas e acontecimentos...`;
  }
  try {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const response = await fetch('/api/reports/excel/analyze', { method: 'POST', body: formData });
    let payload = {};
    try { payload = await response.json(); } catch (error) { payload = {}; }
    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!response.ok) throw new Error(payload.error || 'Não foi possível processar o arquivo importado.');
    renderExcelReport(payload.report || {});
    if (status) {
      status.className = 'excel-report-status is-success';
      status.textContent = `${excelFileTypeLabel(file)} processado: ${payload.report?.records || 0} registros válidos · ${payload.report?.operators_count || 0} operadores · ${payload.report?.equipments_count || 0} frotas.`;
    }
  } catch (error) {
    console.error(error);
    if (status) {
      status.className = 'excel-report-status is-error';
      status.textContent = error.message || 'Não foi possível processar o arquivo importado.';
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function resetExcelReportFilters() {
  ['#excel-filter-front', '#excel-filter-shift', '#excel-filter-operator', '#excel-filter-equipment', '#excel-filter-team', '#excel-filter-date'].forEach(selector => {
    const field = document.querySelector(selector);
    if (field) field.value = '';
  });
  applyExcelReportFilters();
}

function csvReportValue(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text.trimStart())) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadExcelTimelineCsv() {
  if (!excelReportData || !excelFilteredTimeline.length) {
    showToast('Abra uma frota ou operador antes de baixar a linha do tempo.');
    return;
  }
  const headers = ['Data', 'Frente', 'Turno', 'Operador', 'Frota', 'Início', 'Fim', 'Operação', 'Classificação', 'Duração'];
  const rows = excelFilteredTimeline.map(item => [formatReportDate(item.date), item.front, item.shift, item.operator_name, item.equipment_code || item.equipment_key || '', formatReportClock(item.start), formatReportClock(item.end), item.operation, item.category_label, formatReportDuration(item.seconds)]);
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvReportValue).join(';')).join('\r\n');
  downloadBlobFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `Linha-do-Tempo-${excelReportData.period?.start || 'relatorio'}.csv`);
}



function formatSectorBaseUpdatedAt(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return '-';
  return new Date(value * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function sectorBaseSourceLabel(source) {
  return source === 'excel' ? 'Excel' : 'Manual';
}

function renderSectorBaseList() {
  const tbody = document.querySelector('#sector-base-list');
  const empty = document.querySelector('#sector-base-empty');
  const count = document.querySelector('#sector-base-count');
  const pagination = document.querySelector('#sector-base-pagination');
  const pageInfo = document.querySelector('#sector-base-page-info');
  const prevButton = document.querySelector('#sector-base-page-prev');
  const nextButton = document.querySelector('#sector-base-page-next');
  if (!tbody) return;

  const query = String(document.querySelector('#sector-base-search')?.value || '').trim().toLocaleLowerCase('pt-BR');
  const filtered = sectorBaseItems.filter(item => {
    if (!query) return true;
    return [item.sector, item.section, item.description]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query));
  });

  const pageSize = getSectorBasePageSize();
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  sectorBasePage = Math.max(1, Math.min(sectorBasePage, totalPages));
  const startIndex = (sectorBasePage - 1) * pageSize;
  const pageItems = filtered.slice(startIndex, startIndex + pageSize);
  const visibleStart = filtered.length ? startIndex + 1 : 0;
  const visibleEnd = Math.min(startIndex + pageItems.length, filtered.length);

  if (count) count.textContent = String(sectorBaseItems.length);
  tbody.innerHTML = pageItems.map(item => `
    <tr data-sector="${escapeHtml(item.sector)}">
      <td><strong>${escapeHtml(item.sector)}</strong></td>
      <td>${escapeHtml(item.section || '-')}</td>
      <td>
        <span class="sector-base-description">${escapeHtml(item.description || '-')}</span>
        <small>${escapeHtml(formatSectorBaseUpdatedAt(item.updated_at))} · ${escapeHtml(item.updated_by || '-')}</small>
      </td>
      <td><span class="sector-base-source ${item.source === 'excel' ? 'is-excel' : 'is-manual'}">${escapeHtml(sectorBaseSourceLabel(item.source))}</span></td>
      <td class="sector-base-actions-cell">
        <button class="sector-base-action" type="button" data-sector-base-action="edit" data-sector="${escapeHtml(item.sector)}">Editar</button>
        <button class="sector-base-action danger" type="button" data-sector-base-action="delete" data-sector="${escapeHtml(item.sector)}">Excluir</button>
      </td>
    </tr>
  `).join('');

  if (empty) empty.hidden = filtered.length > 0;
  if (pagination) pagination.hidden = filtered.length === 0;
  if (pageInfo) pageInfo.textContent = `${visibleStart}–${visibleEnd} de ${filtered.length} · Página ${sectorBasePage} de ${totalPages}`;
  if (prevButton) prevButton.disabled = sectorBasePage <= 1;
  if (nextButton) nextButton.disabled = sectorBasePage >= totalPages;
}

async function loadSectorBase({ render = true } = {}) {
  const data = await apiRequest('/api/sector-base');
  sectorBaseItems = Array.isArray(data?.items) ? data.items : [];
  rebuildSectorBaseMap();
  if (render) renderSectorBaseList();
  return sectorBaseItems;
}

async function openSectorBaseModal() {
  sectorBasePage = 1;
  openModal('sector-base-modal');
  try {
    await loadSectorBase({ render: true });
  } catch (error) {
    console.error(error);
    showToast('Não foi possível carregar a base de setores.');
  }
}

function clearSectorBaseManualForm() {
  const form = document.querySelector('#sector-base-manual-form');
  if (form) form.reset();
  const title = document.querySelector('#sector-base-manual-title');
  if (title) title.textContent = 'Adicionar ou atualizar setor';
  const sectorInput = document.querySelector('#sector-base-sector');
  sectorInput?.removeAttribute('data-editing-sector');
  if (sectorInput) sectorInput.readOnly = false;
}

function editSectorBaseItem(sector) {
  const item = getSectorBaseItem(sector);
  if (!item) return;
  const sectorInput = document.querySelector('#sector-base-sector');
  const sectionInput = document.querySelector('#sector-base-section');
  const descriptionInput = document.querySelector('#sector-base-description');
  if (sectorInput) {
    sectorInput.value = item.sector || '';
    sectorInput.dataset.editingSector = item.sector || '';
    sectorInput.readOnly = true;
  }
  if (sectionInput) sectionInput.value = item.section || '';
  if (descriptionInput) descriptionInput.value = item.description || '';
  const title = document.querySelector('#sector-base-manual-title');
  if (title) title.textContent = `Editando setor ${item.sector}`;
  sectorInput?.focus();
}

async function saveSectorBaseManual(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const sector = document.querySelector('#sector-base-sector')?.value.trim() || '';
  const section = document.querySelector('#sector-base-section')?.value.trim() || '';
  const description = document.querySelector('#sector-base-description')?.value.trim() || '';
  if (!sector) {
    showToast('Informe o setor.');
    return;
  }

  if (button) button.disabled = true;
  try {
    const payload = await apiRequest('/api/sector-base', {
      method: 'POST',
      body: JSON.stringify({ sector, section, description })
    });
    const saved = payload?.item;
    if (saved) {
      const key = normalizeSectorLookupKey(saved.sector);
      const index = sectorBaseItems.findIndex(item => normalizeSectorLookupKey(item.sector) === key);
      if (index >= 0) sectorBaseItems[index] = saved;
      else sectorBaseItems.push(saved);
      sectorBaseItems.sort((a, b) => compareFrontLabels(a.sector, b.sector));
      rebuildSectorBaseMap();
          renderSectorBaseList();
    } else {
      await loadSectorBase({ render: true });
    }
    clearSectorBaseManualForm();
    showToast(`Setor ${sector} salvo na base.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar o setor.');
  } finally {
    if (button) button.disabled = false;
  }
}

async function importSectorBaseExcel(event) {
  event.preventDefault();
  const fileInput = document.querySelector('#sector-base-file');
  const button = document.querySelector('#sector-base-import-button');
  const file = fileInput?.files?.[0];
  if (!file) {
    showToast('Selecione a planilha da base de setores.');
    return;
  }
  const lowerName = String(file.name || '').toLocaleLowerCase('pt-BR');
  if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xlsm')) {
    showToast('Use um arquivo Excel XLSX ou XLSM.');
    return;
  }

  if (button) button.disabled = true;
  try {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const response = await fetch('/api/sector-base/import', { method: 'POST', body: formData });
    let payload = {};
    try { payload = await response.json(); } catch (error) { payload = {}; }
    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!response.ok) throw new Error(payload.error || 'Não foi possível importar a planilha.');
    await loadSectorBase({ render: true });
    if (fileInput) fileInput.value = '';
    const fileName = document.querySelector('#sector-base-file-name');
    if (fileName) fileName.textContent = 'Nenhum arquivo selecionado';
    showToast(`${payload.total || 0} setores processados · ${payload.created || 0} novos · ${payload.updated || 0} atualizados.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível importar a base de setores.');
  } finally {
    if (button) button.disabled = false;
  }
}

async function deleteSectorBaseItemFromList(sector) {
  if (!sector) return;
  const accepted = window.confirm(`Excluir o setor ${sector} da base?`);
  if (!accepted) return;
  try {
    await apiRequest(`/api/sector-base/${encodeURIComponent(sector)}`, { method: 'DELETE' });
    sectorBaseItems = sectorBaseItems.filter(item => normalizeSectorLookupKey(item.sector) !== normalizeSectorLookupKey(sector));
    rebuildSectorBaseMap();
      renderSectorBaseList();
    showToast(`Setor ${sector} removido da base.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível excluir o setor.');
  }
}



function sacaroseRowHtml(unitCode, item = {}) {
  const front = String(item.front ?? '').trim();
  const sector = String(item.sector ?? '').trim();
  const baseItem = getSectorBaseItem(sector);
  const section = baseItem?.section || item.section || '';
  const description = baseItem?.description || item.description || '';
  const hasSector = Boolean(sector);
  const missing = hasSector && !baseItem;
  const excludeImage = Boolean(item.exclude_image);
  return `
    <tr class="sacarose-row${missing ? ' has-missing-sector' : ''}" data-unit-code="${escapeHtml(unitCode)}">
      <td><input class="sacarose-front" type="text" maxlength="12" value="${escapeHtml(front)}" placeholder="Ex.: 08" /></td>
      <td><input class="sacarose-sector" type="text" maxlength="16" value="${escapeHtml(sector)}" placeholder="Ex.: 3803" /></td>
      <td><span class="sacarose-section sacarose-lookup-value${section ? '' : ' is-muted'}">${escapeHtml(section || '-')}</span></td>
      <td><span class="sacarose-description sacarose-lookup-value${missing ? ' is-missing' : description ? '' : ' is-muted'}">${escapeHtml(missing ? 'Setor não encontrado na base' : description || '-')}</span></td>
      <td class="sacarose-image-toggle-cell">
        <label class="sacarose-image-toggle" title="Marque para não mostrar esta frente na imagem da Sacarose">
          <input class="sacarose-exclude-image" type="checkbox" ${excludeImage ? 'checked' : ''} />
          <span>Ocultar</span>
        </label>
      </td>
      <td><button class="sacarose-remove-row" type="button" aria-label="Remover frente">×</button></td>
    </tr>
  `;
}

function sacaroseRowsFromCurrentUnit(unitCode) {
  const unit = units.find(item => item.code === unitCode);
  if (!unit || !Array.isArray(unit.rows)) return [];
  return sortFrontRows(unit.rows).map(row => ({
    front: row?.[0] || '',
    sector: row?.[1] || '',
    exclude_image: false
  }));
}

function renderSacaroseRows(unitCode, rows) {
  const tbody = document.querySelector(`#sacarose-rows-${unitCode}`);
  if (!tbody) return;
  const sorted = [...(Array.isArray(rows) ? rows : [])].sort((a, b) => compareFrontLabels(a?.front, b?.front));
  tbody.innerHTML = sorted.length ? sorted.map(item => sacaroseRowHtml(unitCode, item)).join('') : sacaroseRowHtml(unitCode);
}

function updateSacaroseLookup(row) {
  if (!row) return;
  const sectorInput = row.querySelector('.sacarose-sector');
  const sectionTarget = row.querySelector('.sacarose-section');
  const descriptionTarget = row.querySelector('.sacarose-description');
  const sector = sectorInput?.value.trim() || '';
  const item = getSectorBaseItem(sector);
  const missing = Boolean(sector) && !item;
  row.classList.toggle('has-missing-sector', missing);
  if (sectionTarget) {
    sectionTarget.textContent = item?.section || '-';
    sectionTarget.classList.toggle('is-muted', !item?.section);
  }
  if (descriptionTarget) {
    descriptionTarget.textContent = missing ? 'Setor não encontrado na base' : item?.description || '-';
    descriptionTarget.classList.toggle('is-missing', missing);
    descriptionTarget.classList.toggle('is-muted', !missing && !item?.description);
  }
}

function collectSacaroseRows(unitCode) {
  const tbody = document.querySelector(`#sacarose-rows-${unitCode}`);
  if (!tbody) return [];
  const rows = [...tbody.querySelectorAll('.sacarose-row')].map(row => ({
    front: row.querySelector('.sacarose-front')?.value.trim() || '',
    sector: row.querySelector('.sacarose-sector')?.value.trim() || '',
    exclude_image: Boolean(row.querySelector('.sacarose-exclude-image')?.checked)
  })).filter(item => item.front || item.sector);
  return rows.sort((a, b) => compareFrontLabels(a.front, b.front));
}

function reorderSacaroseRows(unitCode) {
  renderSacaroseRows(unitCode, collectSacaroseRows(unitCode));
}

function setActiveSacaroseUnit(unitCode) {
  const code = ['NRD', 'PPT', 'RBR', 'PST'].includes(unitCode) ? unitCode : null;
  if (!code) return false;
  document.querySelectorAll('[data-sacarose-unit]').forEach(card => {
    card.hidden = card.dataset.sacaroseUnit !== code;
  });

  const kicker = document.querySelector('#sacarose-modal-kicker');
  if (kicker) kicker.textContent = `${['RBR', 'PST'].includes(code) ? 'Polo MS' : 'Polo SP'} · ${code}`;
  const title = document.querySelector('#sacarose-modal-title');
  if (title) title.textContent = `Posição da Sacarose · ${code}`;
  return true;
}

function preferredSacaroseUnit() {
  const selectedCode = String(units[selectedUnitIndex]?.code || '').toUpperCase();
  return ['NRD', 'PPT', 'RBR', 'PST'].includes(selectedCode) ? selectedCode : null;
}

async function loadSacaroseData() {
  const payload = await apiRequest('/api/sacarose');
  const remote = payload?.units || {};
  ['NRD', 'PPT', 'RBR', 'PST'].forEach(code => {
    const saved = Array.isArray(remote[code]) ? remote[code] : [];
    sacaroseUnits[code] = saved.length ? saved : sacaroseRowsFromCurrentUnit(code);
    renderSacaroseRows(code, sacaroseUnits[code]);
  });
}

async function openSacaroseModal() {
  const initialCode = preferredSacaroseUnit();
  if (!initialCode) {
    showToast('Selecione uma unidade na barra de navegação para abrir a Sacarose.');
    return;
  }

  setActiveSacaroseUnit(initialCode);
  openModal('sacarose-modal');
  try {
    if (!sectorBaseItems.length) await loadSectorBase({ render: false });
    await loadSacaroseData();
    setActiveSacaroseUnit(initialCode);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível carregar a posição da Sacarose.');
  }
}

async function saveSacarose(event) {
  event.preventDefault();
  const button = document.querySelector('#sacarose-save');
  const code = preferredSacaroseUnit();
  if (!code) {
    showToast('Selecione uma unidade antes de salvar a Sacarose.');
    return;
  }

  const rows = collectSacaroseRows(code);
  const seen = new Set();
  for (const item of rows) {
    if (!item.front || !item.sector) {
      showToast(`Informe Frente e Setor em ${code}.`);
      return;
    }
    const frontKey = /^\d+$/.test(item.front) ? String(Number(item.front)) : item.front.toLocaleLowerCase('pt-BR');
    if (seen.has(frontKey)) {
      showToast(`A frente ${item.front} está repetida em ${code}.`);
      return;
    }
    seen.add(frontKey);
    if (!getSectorBaseItem(item.sector)) {
      showToast(`Setor ${item.sector} de ${code} não encontrado na Base de Setores.`);
      return;
    }
  }

  if (button) button.disabled = true;
  try {
    const result = await apiRequest('/api/sacarose', {
      method: 'POST',
      body: JSON.stringify({
        units: { [code]: rows },
        expected_versions: { [code]: unitMeta[code]?.version ?? null }
      })
    });

    if (Array.isArray(result?.units)) {
      units = normalizeUnitsCollection(result.units);
      unitMeta = result.meta && typeof result.meta === 'object' ? result.meta : unitMeta;
      saveState();
      renderDashboard();
    } else {
      await loadServerState();
    }

    sacaroseUnits = result?.sacarose || sacaroseUnits;
    closeModal('sacarose-modal');
    showToast(`Sacarose ${code} salva e sincronizada com a Posição de Campo.`);
  } catch (error) {
    console.error(error);
    if (error.status === 409) {
      await loadServerState().catch(() => {});
      await loadSacaroseData().catch(() => {});
      setActiveSacaroseUnit(code);
      showToast('Esta unidade foi atualizada por outro usuário. Os dados foram recarregados; revise antes de salvar novamente.');
    } else {
      showToast(error.message || 'Não foi possível salvar a posição da Sacarose.');
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function setupEvents() {
  document.addEventListener('click', event => {
    const fillButton = event.target.closest('#open-data-modal');
    if (!fillButton) return;
    openUnitEditor(selectedUnitIndex);
  });

  document.querySelector('#save-jpg').addEventListener('click', openExportImageModal);
  document.querySelector('#export-position-image')?.addEventListener('click', saveJpgReport);
  document.querySelector('#export-sacarose-image')?.addEventListener('click', saveSacaroseReport);
  document.querySelector('#open-history')?.addEventListener('click', openHistoryModal);
  document.querySelector('#open-sacarose')?.addEventListener('click', openSacaroseModal);
  document.querySelector('#open-sector-base')?.addEventListener('click', openSectorBaseModal);
  document.querySelector('#open-users')?.addEventListener('click', openUsersModal);
  document.querySelector('#history-unit-filter')?.addEventListener('change', () => loadHistory({ resetPage: true }));
  document.querySelector('#history-page-prev')?.addEventListener('click', () => {
    if (historyPage <= 1) return;
    historyPage -= 1;
    renderHistoryPage();
  });
  document.querySelector('#history-page-next')?.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(historyItems.length / HISTORY_PAGE_SIZE));
    if (historyPage >= totalPages) return;
    historyPage += 1;
    renderHistoryPage();
  });
  document.querySelector('#create-backup')?.addEventListener('click', createManualBackup);
  document.querySelector('#excel-download-timeline-csv')?.addEventListener('click', downloadExcelTimelineCsv);
  document.querySelector('#excel-filter-reset')?.addEventListener('click', resetExcelReportFilters);
  ['#excel-filter-front', '#excel-filter-shift', '#excel-filter-operator', '#excel-filter-equipment', '#excel-filter-team', '#excel-filter-date'].forEach(selector => {
    document.querySelector(selector)?.addEventListener('change', applyExcelReportFilters);
  });
  document.querySelector('#sector-base-search')?.addEventListener('input', () => {
    sectorBasePage = 1;
    renderSectorBaseList();
  });
  let sectorBaseResizeTimer = null;
  window.addEventListener('resize', () => {
    if (document.querySelector('#sector-base-modal')?.hidden !== false) return;
    window.clearTimeout(sectorBaseResizeTimer);
    sectorBaseResizeTimer = window.setTimeout(() => {
      sectorBasePage = 1;
      renderSectorBaseList();
    }, 120);
  });
  document.querySelector('#sector-base-page-prev')?.addEventListener('click', () => {
    if (sectorBasePage <= 1) return;
    sectorBasePage -= 1;
    renderSectorBaseList();
  });
  document.querySelector('#sector-base-page-next')?.addEventListener('click', () => {
    sectorBasePage += 1;
    renderSectorBaseList();
  });
  document.querySelector('#sector-base-import-form')?.addEventListener('submit', importSectorBaseExcel);
  document.querySelector('#sector-base-manual-form')?.addEventListener('submit', saveSectorBaseManual);
  document.querySelector('#sector-base-manual-clear')?.addEventListener('click', clearSectorBaseManualForm);
  document.querySelector('#sector-base-file')?.addEventListener('change', event => {
    const name = event.target.files?.[0]?.name || 'Nenhum arquivo selecionado';
    const label = document.querySelector('#sector-base-file-name');
    if (label) label.textContent = name;
  });
  document.querySelector('#sector-base-list')?.addEventListener('click', event => {
    const button = event.target.closest('[data-sector-base-action]');
    if (!button) return;
    const sector = button.dataset.sector || '';
    if (button.dataset.sectorBaseAction === 'edit') editSectorBaseItem(sector);
    if (button.dataset.sectorBaseAction === 'delete') deleteSectorBaseItemFromList(sector);
  });
  document.querySelector('#sacarose-form')?.addEventListener('submit', saveSacarose);
  document.querySelectorAll('.sacarose-add-row').forEach(button => {
    button.addEventListener('click', () => {
      const code = button.dataset.unitCode;
      const tbody = document.querySelector(`#sacarose-rows-${code}`);
      if (!tbody) return;
      tbody.insertAdjacentHTML('beforeend', sacaroseRowHtml(code));
      tbody.querySelector('.sacarose-row:last-child .sacarose-front')?.focus();
    });
  });
  ['NRD', 'PPT', 'RBR', 'PST'].forEach(code => {
    const tbody = document.querySelector(`#sacarose-rows-${code}`);
    tbody?.addEventListener('click', event => {
      const button = event.target.closest('.sacarose-remove-row');
      if (!button) return;
      button.closest('.sacarose-row')?.remove();
      reorderSacaroseRows(code);
    });
    tbody?.addEventListener('input', event => {
      const sector = event.target.closest('.sacarose-sector');
      if (!sector) return;
      updateSacaroseLookup(sector.closest('.sacarose-row'));
      sacaroseUnits[code] = collectSacaroseRows(code);
    });
    tbody?.addEventListener('change', event => {
      if (event.target.closest('.sacarose-exclude-image')) {
        // O checkbox afeta apenas a imagem, mas passa a valer imediatamente.
        sacaroseUnits[code] = collectSacaroseRows(code);
        return;
      }
      if (!event.target.closest('.sacarose-front')) return;
      reorderSacaroseRows(code);
      sacaroseUnits[code] = collectSacaroseRows(code);
    });
  });
  document.querySelector('#quick-user-form')?.addEventListener('submit', createQuickUser);
  document.querySelector('#users-search')?.addEventListener('input', filterUsersList);
  document.querySelector('#users-list')?.addEventListener('click', event => {
    const button = event.target.closest('[data-user-action]');
    if (!button) return;
    const action = button.dataset.userAction;
    if (action === 'delete') deleteUserFromList(button);
    if (action === 'toggle') toggleUserActive(button);
    if (action === 'password') togglePasswordForm(button, true);
    if (action === 'cancel-password') togglePasswordForm(button, false);
  });
  document.querySelector('#users-list')?.addEventListener('submit', event => {
    const form = event.target.closest('.user-password-form');
    if (!form) return;
    event.preventDefault();
    resetUserPassword(form);
  });
  document.querySelector('#logout-button')?.addEventListener('click', logout);

  document.querySelector('#wizard-prev')?.addEventListener('click', () => {
    setEditorStep(currentEditorStep - 1);
  });

  document.querySelector('#wizard-next')?.addEventListener('click', () => {
    setEditorStep(currentEditorStep + 1);
  });

  document.querySelector('#unit-selector').addEventListener('click', event => {
    const button = event.target.closest('.unit-selector-button');
    if (!button) return;
    const index = Number(button.dataset.unitIndex);
    if (!Number.isInteger(index) || !units[index]) return;
    selectedUnitIndex = index;
    showAppView('dashboard');
    renderDashboard();
  });

  document.querySelector('#add-front-row').addEventListener('click', () => {
    document.querySelector('#front-rows').insertAdjacentHTML('beforeend', frontRowHtml());
    document.querySelector('#front-rows tr:last-child .front-input')?.focus();
  });

  document.querySelector('#add-rain-row').addEventListener('click', () => {
    document.querySelector('#rain-form').insertAdjacentHTML('beforeend', rainRowHtml());
    document.querySelector('#rain-form .rain-edit-row:last-child .rain-eq')?.focus();
  });

  document.querySelector('#front-rows').addEventListener('click', event => {
    const button = event.target.closest('.remove-front-row');
    if (!button) return;
    button.closest('.front-edit-row')?.remove();
    reorderFrontForm();
  });

  document.querySelector('#front-rows').addEventListener('change', event => {
    if (!event.target.closest('.front-input')) return;
    reorderFrontForm();
  });

  document.querySelector('#front-rows').addEventListener('input', event => {
    const input = event.target.closest('.sector-input');
    if (!input) return;
  });

  document.querySelector('#rain-form').addEventListener('click', event => {
    const button = event.target.closest('.remove-rain-row');
    if (!button) return;
    button.closest('.rain-edit-row')?.remove();
    reorderRainForm();
  });

  document.querySelector('#rain-form').addEventListener('change', event => {
    if (!event.target.closest('.rain-eq')) return;
    reorderRainForm();
  });

  ['#observation-input', '#changes-input'].forEach(selector => {
    const textarea = document.querySelector(selector);
    textarea?.addEventListener('input', () => autoResizeTextarea(textarea));
  });

  document.querySelector('#operation-form').addEventListener('submit', async event => {
    event.preventDefault();

    if (currentEditorStep < editorSteps.length - 1) {
      setEditorStep(currentEditorStep + 1);
      return;
    }

    const index = Number(document.querySelector('#unit-select').value);
    const currentUnit = units[index];
    if (!currentUnit) return;

    const updatedUnit = clone(currentUnit);
    updatedUnit.rows = collectFrontRows();
    updatedUnit.border = calculateUnitBorder(updatedUnit.rows);
    updatedUnit.metrics = collectMetrics();
    updatedUnit.observation = document.querySelector('#observation-input').value.trim() || '-';
    updatedUnit.changes = document.querySelector('#changes-input').value.trim() || '-';
    updatedUnit.rain = collectRainRows();
    selectedUnitIndex = index;

    const saveButton = document.querySelector('#wizard-save');
    if (saveButton) saveButton.disabled = true;

    try {
      const saved = await saveUnitToServer(index, updatedUnit);
      units[index] = normalizeUnitsCollection(units.map((unit, unitIndex) => unitIndex === index ? saved.unit : unit))[index];
      if (saved.meta) unitMeta[updatedUnit.code] = saved.meta;
      saveState();
      renderDashboard();
      closeModal('data-modal');
      showToast(`${updatedUnit.code} atualizado e salvo no servidor.`);
    } catch (error) {
      console.error(error);
      if (error.status === 409 && error.payload?.current) {
        const current = error.payload.current;
        if (current.unit) units[index] = normalizeUnitsCollection(units.map((unit, unitIndex) => unitIndex === index ? current.unit : unit))[index];
        if (current.meta) unitMeta[updatedUnit.code] = current.meta;
        saveState();
        renderDashboard();
        showToast(`${updatedUnit.code} foi alterado por outro usuário. Revise os dados e salve novamente.`);
      } else {
        showToast('Não foi possível salvar no servidor. Tente novamente.');
      }
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  });

  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const openModalElement = [...document.querySelectorAll('.modal-backdrop')].find(modal => !modal.hidden);
    if (openModalElement) closeModal(openModalElement.id);
  });
}

async function initializeApp() {
  setupAppViewNavigation();
  setupExcelReportFileHandling();
  renderDashboard();
  buildUnitSelect();
  updateDateAndGreeting();
  setupEvents();
  setInterval(updateDateAndGreeting, 60000);

  try {
    await loadServerState();
    try {
      await loadSectorBase({ render: false });
    } catch (sectorError) {
      console.warn('Não foi possível carregar a base de setores.', sectorError);
    }
  } catch (error) {
    console.error(error);
    if (window.location.protocol !== 'file:') {
      showToast('Não foi possível carregar os dados do servidor.');
    }
  }
}

initializeApp();
