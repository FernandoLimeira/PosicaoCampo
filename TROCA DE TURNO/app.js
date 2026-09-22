const STORAGE_KEY = 'posicao-campo-v1-state';

const REPORT_TEMPLATE_URL = '/assets/report-template.jpg';

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
let serverStateReady = false;
let selectedUnitIndex = 0;
let currentEditorStep = 0;
let toastTimer;

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

function setServerStateReady(ready, message = '') {
  serverStateReady = Boolean(ready);
  const status = document.querySelector('#connection-status');
  if (status) {
    status.hidden = serverStateReady;
    status.textContent = serverStateReady ? '' : (message || 'Dados locais em cache. Conexão com o servidor não confirmada.');
  }

  ['open-data-modal', 'save-jpg', 'open-history'].forEach(id => {
    const button = document.querySelector(`#${id}`);
    if (button) button.disabled = !serverStateReady;
  });

  if (!serverStateReady) {
    const backupButton = document.querySelector('#create-backup');
    if (backupButton) backupButton.disabled = true;
    const usersButton = document.querySelector('#open-users');
    if (usersButton) usersButton.disabled = true;
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
  setServerStateReady(true);
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
  if (usersButton) {
    usersButton.hidden = !isAdmin;
    usersButton.disabled = false;
  }
  const backupButton = document.querySelector('#create-backup');
  if (backupButton) {
    backupButton.hidden = !isAdmin;
    backupButton.disabled = false;
  }

  const data = await apiRequest('/api/units');
  if (applyServerPayload(data)) return;

  if (!isAdmin) {
    throw new Error('As unidades ainda não foram inicializadas pelo Administrador.');
  }

  // Banco novo: inicializa sempre com os valores-padrão do sistema.
  // Dados antigos existentes no localStorage deste navegador nunca são enviados nessa etapa.
  const synced = await apiRequest('/api/units/sync', {
    method: 'POST',
    body: JSON.stringify({ units: clone(defaultUnits) })
  });
  if (!applyServerPayload(synced)) {
    throw new Error('O servidor não retornou as quatro unidades após a inicialização.');
  }
}

async function saveUnitToServer(index, unit) {
  if (!serverStateReady) throw new Error('Conexão com o servidor não confirmada.');
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

  const previewLabel = document.querySelector('#preview-unit-label');
  if (previewLabel) {
    const unit = units[selectedUnitIndex];
    previewLabel.textContent = `Exibindo ${unit.code} — ${unit.name}`;
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

      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Frente</th><th>Setor</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div class="metrics-grid">${metrics}</div>

      <div class="unit-bottom">
        <div class="notes">
          <h3>Observação</h3><p>${escapeHtml(unit.observation || '-')}</p>
          <h3>Mudanças</h3><p>${escapeHtml(unit.changes || '-')}</p>
        </div>
        <div class="rain-box">
          <div class="rain-title">Chuva turno / acum. (mm)</div>
          ${rain}
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

function frontRowHtml(front = '', sector = '', status = 'EM ATIVIDADE') {
  return `
    <tr class="front-edit-row">
      <td><input class="front-input" type="text" maxlength="12" value="${escapeHtml(front)}" placeholder="Ex.: 402" /></td>
      <td><input class="sector-input" type="text" maxlength="16" value="${escapeHtml(sector)}" placeholder="Ex.: 67620" /></td>
      <td><select class="status-input">${statusOptionsHtml(status)}</select></td>
      <td><button class="row-remove remove-front-row" type="button" aria-label="Remover frente">×</button></td>
    </tr>
  `;
}

function renderFrontRows(rows) {
  const tbody = document.querySelector('#front-rows');
  tbody.innerHTML = rows.length
    ? rows.map(([front, sector, , status]) => frontRowHtml(front, sector, status)).join('')
    : frontRowHtml();
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

function renderRainForm(rain) {
  const container = document.querySelector('#rain-form');
  container.innerHTML = rain.length
    ? rain.map(([eq, turn, accum]) => rainRowHtml(eq, turn, accum)).join('')
    : rainRowHtml();
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

  renderFrontRows(unit.rows);
  renderMetricsForm(unit);
  renderRainForm(unit.rain);
}

function collectFrontRows() {
  return [...document.querySelectorAll('.front-edit-row')]
    .map(row => {
      const front = row.querySelector('.front-input').value.trim();
      const sector = row.querySelector('.sector-input').value.trim();
      const status = normalizeStatus(row.querySelector('.status-input').value);
      return [front, sector, getStatusColor(status), status];
    })
    .filter(([front, sector]) => front || sector);
}

function collectMetrics() {
  return metricDefinitions.map((definition, index) => {
    const input = document.querySelector(`.metric-input[data-metric-index="${index}"]`);
    const value = normalizeNumber(input?.value);
    return [definition.icon, definition.label, `${value} ${definition.unit}`, definition.extra || ''];
  });
}

function collectRainRows() {
  return [...document.querySelectorAll('.rain-edit-row')]
    .map(row => {
      const eq = row.querySelector('.rain-eq').value.trim();
      const turn = normalizeNumber(row.querySelector('.rain-turn').value);
      const accum = normalizeNumber(row.querySelector('.rain-accum').value);
      return [eq, turn, accum];
    })
    .filter(([eq, turn, accum]) => eq || turn || accum);
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

async function loadHistory() {
  const list = document.querySelector('#history-list');
  if (!list) return;
  const unit = document.querySelector('#history-unit-filter')?.value || '';
  list.innerHTML = '<div class="history-loading">Carregando histórico...</div>';
  try {
    const query = new URLSearchParams({ limit: '150' });
    if (unit) query.set('unit', unit);
    const data = await apiRequest(`/api/history?${query.toString()}`);
    const history = Array.isArray(data.history) ? data.history : [];
    list.innerHTML = history.length
      ? history.map(historyItemHtml).join('')
      : '<div class="history-empty">Nenhuma alteração registrada.</div>';
  } catch (error) {
    console.error(error);
    list.innerHTML = '<div class="history-empty">Não foi possível carregar o histórico.</div>';
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
        <input class="user-password-input" type="password" autocomplete="new-password" minlength="8" maxlength="256" required placeholder="Nova senha (mín. 8 caracteres)" aria-label="Nova senha para ${escapeHtml(user.name || 'usuário')}" />
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
  try {
    const data = await apiRequest('/api/users');
    const usersList = Array.isArray(data.users) ? data.users : [];
    list.innerHTML = usersList.length
      ? usersList.map(userItemHtml).join('')
      : '<div class="history-empty">Nenhum usuário cadastrado.</div>';
  } catch (error) {
    console.error(error);
    list.innerHTML = `<div class="history-empty">${escapeHtml(error.message || 'Não foi possível carregar os usuários.')}</div>`;
  }
}

async function openUsersModal() {
  if (currentUser?.role !== 'admin') {
    showToast('Acesso exclusivo do Administrador.');
    return;
  }
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
  if (password.length < 8) {
    showToast('A senha deve ter pelo menos 8 caracteres.');
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

async function loadReportTemplateImage() {
  const response = await fetch(REPORT_TEMPLATE_URL, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error('Não foi possível carregar a imagem-base do relatório JPG.');
  }

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
      reject(new Error('Não foi possível decodificar a imagem-base do relatório JPG.'));
    };
    image.src = objectUrl;
  });
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

function prepareCardBody(ctx, layout, unit, borderColor) {
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

  drawLeafMark(ctx, layout.x + 18, layout.y + 9, 1);
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

function drawLeafMark(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.lineWidth = 2.2 * scale;
  ctx.strokeStyle = '#6ff334';

  const leaves = [
    [x + 10 * scale, y + 42 * scale, x + 8 * scale, y + 24 * scale, x + 16 * scale, y + 6 * scale, x + 18 * scale, y + 42 * scale],
    [x + 20 * scale, y + 46 * scale, x + 18 * scale, y + 22 * scale, x + 30 * scale, y + 4 * scale, x + 30 * scale, y + 46 * scale],
    [x + 32 * scale, y + 44 * scale, x + 36 * scale, y + 26 * scale, x + 42 * scale, y + 11 * scale, x + 40 * scale, y + 44 * scale]
  ];

  leaves.forEach(([sx, sy, cx1, cy1, cx2, cy2, ex, ey]) => {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx1, cy1, cx2, cy2);
    ctx.quadraticCurveTo(ex - 4 * scale, cy2 + 6 * scale, ex, ey);
    ctx.stroke();
  });
  ctx.restore();
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

function getReportGeometry(layout) {
  const metricHeight = layout.lower ? 48 : 55;
  const metricGapY = layout.lower ? 8 : 9;
  const metricY = layout.y + (layout.lower ? 246 : 295);
  const metricsBottom = metricY + metricHeight * 2 + metricGapY;
  const contentTop = metricsBottom + 8;
  const cardBottom = layout.y + layout.h;

  return {
    metricY,
    metricHeight,
    metricGapY,
    metricsBottom,
    contentTop,
    cardBottom,
    tableTop: layout.y + (layout.lower ? 112 : 114),
    tableBottom: metricY - (layout.lower ? 12 : 14),
    rainX: layout.x + (layout.lower ? 278 : 248),
    rainY: contentTop,
    rainW: layout.lower ? 204 : 230,
    rainH: Math.max(96, cardBottom - contentTop - 8),
    notesX: layout.x + 18,
    notesY: contentTop + 2,
    notesW: layout.lower ? 245 : 214
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
  const fontSize = Math.max(11, Math.min(14, rowHeight - 2.5));
  const statusFontSize = Math.max(10.5, fontSize - 0.5);
  const dotRadius = Math.max(5.5, Math.min(7.25, rowHeight * 0.36));
  const lineOffset = Math.min(8, rowHeight * 0.44);

  ctx.save();
  ctx.strokeStyle = 'rgba(125, 177, 185, 0.42)';
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(left, layout.y + 73);
  ctx.lineTo(right, layout.y + 73);
  ctx.stroke();

  drawFittedText(ctx, 'FRENTE', layout.x + 20, layout.y + 93, 86, 'bold 13px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, 'SETOR', layout.x + 153, layout.y + 93, 90, 'bold 13px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, 'STATUS', layout.x + 323, layout.y + 93, 135, 'bold 13px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');

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
  drawFittedText(ctx, 'CHUVA TURNO / ACUM. (mm)', rainX + 37, rainY + 17, rainW - 48, 'bold 11px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
  ctx.beginPath();
  ctx.moveTo(rainX + 9, rainY + headerHeight);
  ctx.lineTo(rainX + rainW - 9, rainY + headerHeight);
  ctx.stroke();

  rows.forEach(([eq = '', turn = '-', accum = '-'], index) => {
    const cy = rainY + headerHeight + 8 + index * rowHeight;
    const fontSize = Math.max(9, Math.min(11, rowHeight - 2));
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

function drawUnitOnCanvas(ctx, unit, layout) {
  const geometry = getReportGeometry(layout);
  prepareCardBody(ctx, layout, unit, borderColorForState(unit.border));
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

  const titleFontSize = layout.lower ? 16 : 18;
  const titleToBodyGap = layout.lower ? 21 : 24;
  const sectionGap = layout.lower ? 6 : 8;
  const maxBodyFont = layout.lower ? 11.5 : 13;
  const notesBottom = geometry.cardBottom - 10;
  const totalNotesHeight = Math.max(52, notesBottom - geometry.notesY);
  const bodyHeightTotal = Math.max(20, totalNotesHeight - titleToBodyGap * 2 - sectionGap);

  const observationText = unit.observation || '-';
  const changesText = unit.changes || '-';
  const observationWeight = getWrappedTextLineCount(ctx, observationText, geometry.notesW, maxBodyFont);
  const changesWeight = getWrappedTextLineCount(ctx, changesText, geometry.notesW, maxBodyFont);
  const combinedWeight = Math.max(2, observationWeight + changesWeight);
  const minBodyHeight = Math.min(18, bodyHeightTotal / 2);

  let observationBodyHeight = Math.max(minBodyHeight, bodyHeightTotal * (observationWeight / combinedWeight));
  let changesBodyHeight = bodyHeightTotal - observationBodyHeight;
  if (changesBodyHeight < minBodyHeight) {
    changesBodyHeight = minBodyHeight;
    observationBodyHeight = Math.max(minBodyHeight, bodyHeightTotal - changesBodyHeight);
  }

  const observationBodyY = geometry.notesY + titleToBodyGap;
  const changesTitleY = observationBodyY + observationBodyHeight + sectionGap;
  const changesBodyY = changesTitleY + titleToBodyGap;

  ctx.save();
  ctx.fillStyle = '#ffe11a';
  ctx.font = `bold ${titleFontSize}px "Arial Narrow", Arial, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText('OBSERVAÇÃO', geometry.notesX, geometry.notesY);
  ctx.fillText('MUDANÇAS', geometry.notesX, changesTitleY);
  ctx.restore();

  drawWrappedTextFit(
    ctx,
    observationText,
    geometry.notesX,
    observationBodyY,
    geometry.notesW,
    observationBodyHeight,
    { maxFontSize: maxBodyFont, minFontSize: 4, color: '#ffffff' }
  );

  drawWrappedTextFit(
    ctx,
    changesText,
    geometry.notesX,
    changesBodyY,
    geometry.notesW,
    changesBodyHeight,
    { maxFontSize: maxBodyFont, minFontSize: 4, color: '#ffffff' }
  );

  drawRainBox(ctx, unit, layout, geometry);
}

async function generateReportJpegBlob() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1536;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas não suportado neste navegador.');

  const template = await loadReportTemplateImage();
  ctx.drawImage(template, 0, 0, canvas.width, canvas.height);
  if (typeof template.close === 'function') template.close();

  const { greeting, date } = getHeaderDataForExport(new Date());
  ctx.fillStyle = 'rgba(2, 33, 40, 0.98)';
  ctx.fillRect(26, 20, 175, 36);
  ctx.fillRect(262, 20, 205, 36);
  drawFittedText(ctx, greeting, 28, 38, 165, 'bold 31px Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, `${date} - TC`, 260, 38, 195, 'bold 28px Arial, sans-serif', '#ffffff', 'middle');

  const normalizedUnits = units.map((unit, index) => normalizeReportUnit(unit, index));
  const layouts = [
    { x: 13, y: 271, w: 492, h: 604, lower: false, maxRows: 11 },
    { x: 519, y: 271, w: 492, h: 604, lower: false, maxRows: 11 },
    { x: 13, y: 886, w: 492, h: 491, lower: true, maxRows: 7 },
    { x: 519, y: 886, w: 492, h: 491, lower: true, maxRows: 7 }
  ];
  layouts.forEach((layout, index) => drawUnitOnCanvas(ctx, normalizedUnits[index], layout));

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Não foi possível converter o relatório para JPG.'));
    }, 'image/jpeg', 0.96);
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
  showToast('Gerando imagem JPG...');
  try {
    const blob = await generateReportJpegBlob();
    const today = new Date().toLocaleDateString('pt-BR').replaceAll('/', '-');
    downloadBlobFile(blob, `Posicao-de-Campo-${today}.jpg`);
    showToast('Imagem JPG gerada com sucesso.');
  } catch (error) {
    console.error(error);
    showToast('Não foi possível gerar o JPG. Verifique a imagem-base do relatório.');
  }
}

function setupEvents() {
  document.addEventListener('click', event => {
    const fillButton = event.target.closest('#open-data-modal');
    if (!fillButton) return;
    openUnitEditor(selectedUnitIndex);
  });

  document.querySelector('#save-jpg').addEventListener('click', saveJpgReport);
  document.querySelector('#open-history')?.addEventListener('click', openHistoryModal);
  document.querySelector('#open-users')?.addEventListener('click', openUsersModal);
  document.querySelector('#history-unit-filter')?.addEventListener('change', loadHistory);
  document.querySelector('#create-backup')?.addEventListener('click', createManualBackup);
  document.querySelector('#quick-user-form')?.addEventListener('submit', createQuickUser);
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
  });


  document.querySelector('#rain-form').addEventListener('click', event => {
    const button = event.target.closest('.remove-rain-row');
    if (!button) return;
    button.closest('.rain-edit-row')?.remove();
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

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('mousedown', event => {
      if (event.target === backdrop) closeModal(backdrop.id);
    });
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const openModalElement = [...document.querySelectorAll('.modal-backdrop')].find(modal => !modal.hidden);
    if (openModalElement) closeModal(openModalElement.id);
  });
}

async function initializeApp() {
  setServerStateReady(false, 'Verificando conexão com o servidor… Os dados exibidos ainda não estão confirmados.');
  renderDashboard();
  buildUnitSelect();
  updateDateAndGreeting();
  setupEvents();
  setInterval(updateDateAndGreeting, 60000);

  try {
    await loadServerState();
  } catch (error) {
    console.error(error);
    setServerStateReady(false, 'ATENÇÃO: dados em cache. Não foi possível confirmar informações atuais com o servidor.');
    if (window.location.protocol !== 'file:') {
      showToast(error.message || 'Não foi possível carregar os dados do servidor.');
    }
  }
}

initializeApp();
