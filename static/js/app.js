// Painel: seleção de unidade e editor operacional.



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

let units = clone(defaultUnits);
let unitMeta = {};
let selectedUnitIndex = Math.max(0, units.findIndex(unit => unit.code === getReportUnit()));
let currentEditorStep = 0;
let editorInitialSnapshot = null;
// Filtros apenas de visualização: não alteram os dados enviados ao servidor.
let fieldViewFilter = 'all';
let fieldSearchQuery = '';
let fieldViewUnitCode = '';
let sectorBaseItems = [];
let sectorBaseMap = new Map();
let sectorBaseLoaded = false;
// Ocorrências independentes da posição oficial (status/ATR/chuva/exportação).
let fieldFrontNotesSummary = {};
let fieldNotesRequest = 0;
let fieldCurrentPeriod = null;
let activeFieldFrontContext = null;
let fieldShiftReviewContext = null;
let fieldShiftReviewRequest = 0;



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

function applyServerPayload(data) {
  if (!Array.isArray(data?.units) || data.units.length !== defaultUnits.length) return false;
  units = normalizeUnitsCollection(data.units);
  unitMeta = data.meta && typeof data.meta === 'object' ? data.meta : {};
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

async function saveUnitToServer(index, unit) {
  if (!unit) throw new Error('Unidade inválida.');
  const expectedVersion = unitMeta[unit.code]?.version ?? null;
  return apiRequest(`/api/units/${encodeURIComponent(unit.code)}`, {
    method: 'PUT',
    body: JSON.stringify({ unit, position: index, expected_version: expectedVersion })
  });
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
  const active = rows.filter(row => normalizeStatus(row[3]) === 'EM ATIVIDADE').length;
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

function fieldFrontNoteKey(front) {
  const raw = String(front ?? '').trim();
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw.toLocaleLowerCase('pt-BR');
}

function fieldLatestNote(front) {
  return fieldFrontNotesSummary[fieldFrontNoteKey(front)] || null;
}

function fieldNotePreview(front, index) {
  const summary = fieldLatestNote(front);
  const highlights = summary?.highlights || [];
  if (!highlights.length) return `<button type="button" class="field-note-inline-button is-empty" data-field-front-index="${index}" aria-label="Acompanhar a Frente ${escapeHtml(front)}">${summary?.count ? 'Sem pontos em aberto · Ver histórico' : '+ Adicionar observação'}</button>`;
  const points = highlights.map(entry => `<span role="listitem" title="${escapeHtml(entry.text)}"><span class="field-observation-preview">${escapeHtml(entry.text)}</span></span>`).join('');
  const remaining = Math.max(0, summary.highlight_count - highlights.length);
  return `<button type="button" class="field-note-inline-button" data-field-front-index="${index}" aria-label="Ver observações da Frente ${escapeHtml(front)}">
    <span class="field-observation-points" role="list">${points}</span>
    <small>${remaining ? `+ ${remaining} ponto${remaining === 1 ? '' : 's'} em aberto · ` : ''}Ver acompanhamento</small>
  </button>`;
}

async function refreshFieldFrontNotes(unitCode = units[selectedUnitIndex]?.code) {
  if (!unitCode) return;
  const request = ++fieldNotesRequest;
  let data;
  try {
    data = await apiRequest(`/api/front-notes?unit=${encodeURIComponent(unitCode)}`, { cache: 'no-store' });
  } catch (error) {
    if (request === fieldNotesRequest && units[selectedUnitIndex]?.code === unitCode) {
      fieldCurrentPeriod = null;
      const label = document.querySelector('#preview-unit-shift');
      if (label) label.textContent = 'Turno indisponível';
    }
    throw error;
  }
  if (request !== fieldNotesRequest || units[selectedUnitIndex]?.code !== unitCode) return;
  if (data?.period) {
    fieldCurrentPeriod = data.period;
    renderUnitSelection();
  }
  const summaries = data?.summaries || {};
  if (JSON.stringify(summaries) === JSON.stringify(fieldFrontNotesSummary)) return;
  fieldFrontNotesSummary = summaries;
  // Atualiza só as observações para preservar foco, busca e posição da tabela.
  const grid = document.querySelector('#units-grid');
  grid?.querySelectorAll('.field-front-row').forEach(row => {
    const index = Number(row.dataset.fieldFrontIndex);
    const cell = row.querySelector('.field-observation-cell');
    const front = units[selectedUnitIndex]?.rows[index]?.[0];
    if (cell && front !== undefined) cell.innerHTML = fieldNotePreview(front, index);
  });
  applyFieldViewFilters();
}

function fieldFrontNoteForm() {
  const mayWrite = canEditModule('dashboard');
  if (!mayWrite) return '<p class="field-note-readonly">Você pode consultar o histórico, mas não possui permissão para adicionar observações.</p>';
  return `<form id="field-front-note-form" class="field-front-note-form">
    <h3>Adicionar observação</h3>
    <p class="field-front-note-disclaimer">Registre ocorrências, ações necessárias e previsões de retorno desta frente.</p>
    <label for="field-front-note-text">Observação
      <textarea id="field-front-note-text" name="text" rows="3" maxlength="1500" required placeholder="Digite uma informação sobre esta frente..."></textarea>
    </label>
    <label class="field-front-highlight-option"><input type="checkbox" name="highlighted" checked /> Destacar este ponto na coluna Observações</label>
    <div class="field-front-note-actions">
      <small id="field-front-note-state" role="status" aria-live="polite">Pontos destacados ficam visíveis até serem concluídos.</small>
      <button class="modal-button save" type="submit">Adicionar observação</button>
    </div>
  </form>`;
}

function fieldFrontNotesHistory(data) {
  const entries = data?.entries || [];
  if (!entries.length) return '<p class="field-front-note-empty">Nenhum registro de acompanhamento para esta frente.</p>';
  const body = entries.map(entry => `<li class="field-front-note-event">
    <div class="field-front-note-meta">
      <strong>${escapeHtml(entry.author)}</strong>
      <small>${escapeHtml(formatServerTimestamp(entry.created_at, 'America/Sao_Paulo'))}${entry.shift ? ` · Turno ${escapeHtml(entry.shift)}` : ''}</small>
    </div>
    <p>${escapeHtml(entry.text)}</p>
    <div class="field-note-management">
      <span class="field-note-state">${entry.resolved_at ? 'Concluído' : entry.highlighted ? 'Em destaque' : 'Somente no histórico'}</span>
      ${canEditModule('dashboard') ? `<button type="button" class="field-filter-clear" data-field-note-id="${entry.id}" data-field-note-action="${entry.resolved_at ? 'reopen' : entry.highlighted ? 'resolve' : 'highlight'}">${entry.resolved_at ? 'Reabrir ponto' : entry.highlighted ? 'Concluir ponto' : 'Destacar ponto'}</button>` : ''}
    </div>
    <small>Setor na data: ${escapeHtml(entry.sector)}</small>
  </li>`).join('');
  return `<ol class="field-front-note-timeline">${body}</ol>${data.total > entries.length ? `<small>Exibindo ${entries.length} de ${data.total} registros.</small>` : ''}
    ${data.next_cursor ? '<button type="button" class="field-filter-clear" data-field-notes-more>Carregar anteriores</button>' : ''}`;
}

async function loadFieldFrontHistory(context, older = false) {
  const container = document.querySelector('#field-front-note-history');
  if (!container) return;
  const request = context.historyRequest = (context.historyRequest || 0) + 1;
  if (!older) container.innerHTML = '<p class="field-front-note-empty">Carregando histórico…</p>';
  try {
    const cursor = older && context.history?.next_cursor ? `&before_id=${context.history.next_cursor}` : '';
    const data = await apiRequest(`/api/front-notes?unit=${encodeURIComponent(context.unit)}&front=${encodeURIComponent(context.front)}${cursor}`, { cache: 'no-store' });
    if (activeFieldFrontContext !== context || context.historyRequest !== request) return;
    context.history = { ...data, entries: older ? [...context.history.entries, ...data.entries] : data.entries };
    container.innerHTML = fieldFrontNotesHistory(context.history);
  } catch (error) {
    if (activeFieldFrontContext !== context || context.historyRequest !== request) return;
    if (older) showToast('Não foi possível carregar os registros anteriores. Tente novamente.', true);
    else container.textContent = 'Não foi possível carregar o histórico. Tente abrir os detalhes novamente.';
    console.error(error);
  }
}

function fieldFrontRainKey(value) {
  const raw = String(value ?? '').trim().replace(/^(?:eq(?:uipamento)?|frente)\.?\s*/i, '').trim();
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw.toLocaleLowerCase('pt-BR');
}

function openFieldFrontDetails(index) {
  const unit = units[selectedUnitIndex];
  const row = unit?.rows?.[index];
  const modal = document.querySelector('#field-front-detail-modal');
  const content = document.querySelector('#field-front-detail-content');
  if (!Array.isArray(row) || !modal || !content) return;
  const [front = '', sector = '', color = 'yellow', status = '', atr = ''] = row;
  const farm = fieldFarmFromSector(sector);
  const matchKey = fieldFrontRainKey(front);
  const rainRow = (Array.isArray(unit.rain) ? unit.rain : []).find(item => Array.isArray(item) && fieldFrontRainKey(item[0]) === matchKey);
  const statusClass = normalizeStatus(status) === 'EM ATIVIDADE' ? 'is-active'
    : normalizeStatus(status) === 'SOLO ÚMIDO' ? 'is-wet' : 'is-attention';
  const rainSection = fieldHasRain(unit) && rainRow ? `
    <div class="field-front-detail-section">
      <h3>Precipitação da frente</h3>
      <div class="field-front-detail-grid">
        <div><span>Chuva no turno</span><strong>${escapeHtml(rainRow[1] ?? '—')} mm</strong></div>
        <div><span>Acumulado</span><strong>${escapeHtml(rainRow[2] ?? '—')} mm</strong></div>
      </div>
    </div>` : '';
  content.innerHTML = `
    <div class="field-front-detail-unit">${escapeHtml(unit.code)} · ${escapeHtml(unit.name)}</div>
    <div class="field-front-detail-grid">
      <div><span>Frente</span><strong>${escapeHtml(front)}</strong></div>
      <div><span>Setor</span><strong>${escapeHtml(sector)}</strong></div>
      <div class="field-front-detail-wide"><span>Fazenda</span><strong>${escapeHtml(farm.name)}</strong>
        ${farm.note ? `<small>${escapeHtml(farm.note)}</small>` : ''}</div>
      <div><span>Status</span><strong><span class="field-status-chip ${statusClass}">${escapeHtml(status)}</span></strong></div>
      <div><span>ATR</span><strong>${escapeHtml(atr || '—')}</strong></div>
    </div>
    ${rainSection}
    ${fieldFrontNoteForm()}
    <section class="field-front-detail-section field-front-history-section" aria-label="Histórico de acompanhamento">
      <h3>Histórico de informações</h3>
      <div id="field-front-note-history"></div>
    </section>`;
  const context = { unit: unit.code, front, sector, index };
  activeFieldFrontContext = context;
  const title = document.querySelector('#field-front-detail-title');
  if (title) title.textContent = `Detalhes da Frente ${front}`;
  openModal('field-front-detail-modal');
  loadFieldFrontHistory(context);
}

function unitCard(unit) {
  const summary = fieldUnitSummary(unit);
  const rainVisible = fieldHasRain(unit);
  const rows = unit.rows.length
    ? unit.rows.map(([front, sector, color, status, atr = ''], index) => {
      const normalized = normalizeStatus(status);
      const statusClass = normalized === 'EM ATIVIDADE' ? 'is-active' : normalized === 'SOLO ÚMIDO' ? 'is-wet' : 'is-attention';
      const group = normalized === 'EM ATIVIDADE' ? 'active' : 'attention';
      const farm = fieldFarmFromSector(sector);
      return `
      <tr class="field-front-row" data-field-front-index="${index}" data-field-group="${group}">
        <td data-label="Frente"><span class="front-cell"><i class="status-dot ${escapeHtml(color)}"></i><strong>${escapeHtml(front)}</strong></span></td>
        <td data-label="Setor" class="field-sector-cell">${escapeHtml(sector)}</td>
        <td data-label="Fazenda" class="field-farm-cell" title="${escapeHtml(farm.note || farm.name)}">${escapeHtml(farm.name)}</td>
        <td data-label="Status"><span class="field-status-chip ${statusClass}">${escapeHtml(status)}</span></td>
        <td data-label="ATR" class="field-atr-cell">${escapeHtml(atr || '—')}</td>
        <td data-label="Observações" class="field-observation-cell">${fieldNotePreview(front, index)}</td>
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



function buildUnitSelect() {
  const input = document.querySelector('#unit-select');
  if (!input) return;
  const current = Number(input.value || 0);
  input.value = String(Number.isInteger(current) && units[current] ? current : 0);
}

// Estado local do formulário, usado somente para evitar perder alterações por engano.
function getEditorSnapshot() {
  const form = document.querySelector('#operation-form');
  if (!form) return null;
  return JSON.stringify([...form.querySelectorAll('input:not([type="hidden"]), select, textarea')]
    .filter(field => !field.hasAttribute('data-review-only'))
    .map(field => [field.className, field.value]));
}

function editorHasUnsavedChanges() {
  return editorInitialSnapshot !== null && getEditorSnapshot() !== editorInitialSnapshot;
}

function refreshEditorSaveStatus() {
  const label = document.querySelector('#wizard-save-status');
  if (!label) return;
  const isDirty = editorHasUnsavedChanges();
  label.textContent = isDirty ? 'Alterações ainda não salvas' : 'Sem alterações nesta sessão';
  label.classList.toggle('is-dirty', isDirty);
}

function resetFieldShiftReview(unitCode) {
  fieldShiftReviewContext = { unitCode, loaded: false, appliedPeriod: null };
  fieldShiftReviewRequest += 1;
  document.querySelector('#field-shift-date').value = '';
  document.querySelector('#field-shift-select').value = '';
  document.querySelector('#field-shift-draft').value = '';
  document.querySelector('#field-shift-result').hidden = true;
  document.querySelector('#field-shift-apply').disabled = true;
  document.querySelector('#field-shift-load').disabled = false;
  document.querySelector('#field-shift-state').textContent = 'Horários de Brasília. Consulte os acontecimentos para revisar a observação da imagem.';
}

async function loadFieldShiftReview() {
  const context = fieldShiftReviewContext;
  if (!context) return;
  const state = document.querySelector('#field-shift-state');
  const dateInput = document.querySelector('#field-shift-date');
  const shiftInput = document.querySelector('#field-shift-select');
  const button = document.querySelector('#field-shift-load');
  const apply = document.querySelector('#field-shift-apply');
  const result = document.querySelector('#field-shift-result');
  const date = dateInput.value;
  const shift = shiftInput.value;
  const request = ++fieldShiftReviewRequest;
  context.loadRequest = request;
  context.loaded = true;
  context.period = null;
  apply.disabled = true;
  result.hidden = true;
  if (Boolean(date) !== Boolean(shift)) {
    state.textContent = 'Selecione a data e o turno para consultar.';
    return;
  }
  const query = new URLSearchParams({ unit: context.unitCode });
  if (date) { query.set('date', date); query.set('shift', shift); }
  button.disabled = true;
  state.textContent = 'Consultando os acontecimentos da unidade…';
  try {
    const data = await apiRequest(`/api/front-notes/shift?${query}`, { cache: 'no-store' });
    if (fieldShiftReviewContext !== context || request !== fieldShiftReviewRequest) return;
    dateInput.value = data.work_date;
    shiftInput.value = data.shift;
    context.period = { work_date: data.work_date, shift: data.shift };
    document.querySelector('#field-shift-draft').value = data.suggested_text || '';
    result.hidden = !data.total;
    apply.disabled = !data.total;
    state.textContent = data.total
      ? `${data.total} registro(s) da unidade ${context.unitCode} no turno ${data.shift}. Revise o texto e use na observação. Nenhuma alteração foi salva.`
      : 'Nenhum acontecimento registrado nesta unidade e turno. A observação atual foi mantida.';
  } catch (error) {
    if (fieldShiftReviewContext !== context || request !== fieldShiftReviewRequest) return;
    state.textContent = error.message || 'Não foi possível consultar os acontecimentos. A observação atual foi mantida.';
  } finally {
    if (fieldShiftReviewContext === context && context.loadRequest === request) button.disabled = false;
  }
}

function applyFieldShiftReview() {
  const context = fieldShiftReviewContext;
  if (!context?.period) return;
  const text = document.querySelector('#field-shift-draft').value.trim();
  const state = document.querySelector('#field-shift-state');
  if (!text || text.length > 10000) {
    state.textContent = 'Revise o texto: a observação deve ter de 1 a 10.000 caracteres. Nenhum conteúdo foi cortado.';
    return;
  }
  const input = document.querySelector('#observation-input');
  input.value = text;
  context.appliedPeriod = { ...context.period };
  autoResizeTextarea(input);
  refreshEditorSaveStatus();
  state.textContent = 'Texto transferido para a observação abaixo. Revise e salve a atualização para usar na imagem.';
  input.focus();
}

function setEditorStep(step) {
  const maxStep = editorSteps.length - 1;
  const safeStep = Math.max(0, Math.min(Number(step) || 0, maxStep));
  currentEditorStep = safeStep;
  if (safeStep === 2 && fieldShiftReviewContext && !fieldShiftReviewContext.loaded) loadFieldShiftReview();

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
  resetFieldShiftReview(units[safeIndex].code);
  setEditorStep(0);
  editorInitialSnapshot = getEditorSnapshot();
  refreshEditorSaveStatus();
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

function normalizeSectionLookupKey(value) {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

function rebuildSectorBaseMap() {
  sectorBaseMap = new Map();
  sectorBaseItems.forEach(item => {
    const key = normalizeSectorLookupKey(item?.sector);
    if (!key) return;
    if (!sectorBaseMap.has(key)) sectorBaseMap.set(key, []);
    sectorBaseMap.get(key).push(item);
  });

  sectorBaseMap.forEach(items => {
    items.sort((a, b) => compareFrontLabels(a?.section || '', b?.section || ''));
  });
}

function getSectorBaseItems(value) {
  return sectorBaseMap.get(normalizeSectorLookupKey(value)) || [];
}

function getSectorBaseItem(value, section = '') {
  const items = getSectorBaseItems(value);
  if (!items.length) return null;
  const sectionKey = normalizeSectionLookupKey(section);
  if (sectionKey) {
    return items.find(item => normalizeSectionLookupKey(item?.section) === sectionKey) || null;
  }
  return items[0] || null;
}

function frontRowHtml(front = '', sector = '', status = 'EM ATIVIDADE', atr = '') {
  return `
    <tr class="front-edit-row">
      <td><input class="front-input" type="text" maxlength="12" value="${escapeHtml(front)}" placeholder="Ex.: 402" /></td>
      <td class="sector-input-cell">
        <input class="sector-input" type="text" maxlength="16" value="${escapeHtml(sector)}" placeholder="Ex.: 67620" />
      </td>
      <td><select class="status-input">${statusOptionsHtml(status)}</select></td>
      <td><input class="atr-input" type="text" inputmode="decimal" maxlength="12" value="${escapeHtml(atr)}" placeholder="Ex.: 135,5" aria-label="ATR da frente" /></td>
      <td><button class="row-remove remove-front-row" type="button" aria-label="Remover frente">×</button></td>
    </tr>
  `;
}



function sortFrontRows(rows = []) {
  return [...rows].sort((a, b) => compareFrontLabels(a?.[0], b?.[0]));
}

function renderFrontRows(rows) {
  const tbody = document.querySelector('#front-rows');
  const sortedRows = sortFrontRows(rows);
  tbody.innerHTML = sortedRows.length
    ? sortedRows.map(([front, sector, , status, atr]) => frontRowHtml(front, sector, status, atr)).join('')
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
      const atr = row.querySelector('.atr-input').value.trim();
      return [front, sector, getStatusColor(status), status, atr];
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



async function loadSectorBase({ render = false } = {}) {
  const data = await apiRequest('/api/sector-base');
  sectorBaseItems = Array.isArray(data?.items) ? data.items : [];
  sectorBaseLoaded = true;
  rebuildSectorBaseMap();
  if (render) renderDashboard();
  return sectorBaseItems;
}

function setupEvents() {
  document.querySelector('#field-shift-load')?.addEventListener('click', loadFieldShiftReview);
  document.querySelector('#field-shift-apply')?.addEventListener('click', applyFieldShiftReview);
  ['#field-shift-date', '#field-shift-select'].forEach(selector => {
    document.querySelector(selector)?.addEventListener('change', () => {
      fieldShiftReviewRequest += 1;
      if (fieldShiftReviewContext) fieldShiftReviewContext.period = null;
      document.querySelector('#field-shift-apply').disabled = true;
      document.querySelector('#field-shift-state').textContent = 'Período alterado. Consulte novamente os acontecimentos antes de usar o texto.';
    });
  });
  const fieldView = document.querySelector('#units-grid');
  fieldView?.addEventListener('input', event => {
    if (event.target?.id !== 'field-front-search') return;
    fieldSearchQuery = event.target.value;
    applyFieldViewFilters();
  });
  fieldView?.addEventListener('click', event => {
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
  document.addEventListener('click', event => {
    const fillButton = event.target.closest('#open-data-modal');
    if (!fillButton) return;
    openUnitEditor(selectedUnitIndex);
  });

  document.addEventListener('report-unit-change', () => {
    closeAllModals();
    activeFieldFrontContext = null;
    fieldFrontNotesSummary = {};
    renderDashboard();
    refreshFieldFrontNotes().catch(error => console.error('Falha ao consultar observações.', error));
  });
  document.querySelector('#field-front-detail-modal')?.addEventListener('submit', async event => {
    if (event.target?.id !== 'field-front-note-form') return;
    event.preventDefault();
    const context = activeFieldFrontContext;
    if (!context) return;
    const form = event.target;
    const button = form.querySelector('[type="submit"]');
    const state = form.querySelector('#field-front-note-state');
    const data = new FormData(form);
    if (button.disabled) return;
    button.disabled = true;
    if (state) state.textContent = 'Salvando registro…';
    try {
      await apiRequest('/api/front-notes', {
        method: 'POST',
        body: JSON.stringify({ unit: context.unit, front: context.front, sector: context.sector,
          text: data.get('text'), highlighted: data.get('highlighted') === 'on' })
      });
      if (activeFieldFrontContext !== context) return;
      form.querySelector('textarea[name="text"]').value = '';
      if (state) state.textContent = 'Registro salvo no histórico.';
      const updates = await Promise.allSettled([loadFieldFrontHistory(context), refreshFieldFrontNotes(context.unit)]);
      const failed = updates.some(update => update.status === 'rejected');
      if (failed && state) state.textContent = 'Registro salvo. Atualize a tela para consultar os destaques.';
      showToast(failed ? 'Observação salva. Não foi possível atualizar a tabela agora.' : 'Observação salva no acompanhamento da frente.', failed);
    } catch (error) {
      console.error(error);
      if (state) state.textContent = error?.payload?.error || 'Falha ao salvar o registro.';
      showToast('Não foi possível salvar a informação da frente.', true);
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector('#field-front-detail-modal')?.addEventListener('click', async event => {
    const more = event.target.closest('[data-field-notes-more]');
    if (more && activeFieldFrontContext && !more.disabled) {
      more.disabled = true;
      await loadFieldFrontHistory(activeFieldFrontContext, true);
      more.disabled = false;
      return;
    }
    const button = event.target.closest('[data-field-note-id]');
    const context = activeFieldFrontContext;
    if (!button || !context || button.disabled) return;
    const action = button.dataset.fieldNoteAction;
    button.disabled = true;
    try {
      await apiRequest(`/api/front-notes/${button.dataset.fieldNoteId}`, {
        method: 'PUT',
        body: JSON.stringify(action === 'resolve' ? { resolved: true }
          : action === 'reopen' ? { resolved: false, highlighted: true } : { highlighted: true })
      });
      if (activeFieldFrontContext !== context) return;
      const updates = await Promise.allSettled([loadFieldFrontHistory(context), refreshFieldFrontNotes(context.unit)]);
      const failed = updates.some(update => update.status === 'rejected');
      showToast(failed ? 'Ponto atualizado. Atualize a tela para consultar a tabela.'
        : action === 'resolve' ? 'Ponto concluído e mantido no histórico.' : 'Ponto destacado na tabela.', failed);
    } catch (error) {
      showToast(error.message || 'Não foi possível atualizar o ponto.', true);
    } finally {
      button.disabled = false;
    }
  });
  const editorModal = document.querySelector('#data-modal');
  // O fechamento comum acontece em common.js; a captura evita descartes acidentais.
  document.addEventListener('click', event => {
    const closeButton = event.target.closest('[data-close-modal="data-modal"]');
    if (!closeButton || editorModal?.hidden || !editorHasUnsavedChanges()) return;
    if (!window.confirm('Existem alterações não salvas. Deseja sair sem salvar?')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || editorModal?.hidden || !editorHasUnsavedChanges()) return;
    if (!window.confirm('Existem alterações não salvas. Deseja sair sem salvar?')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  editorModal?.addEventListener('click', event => {
    const indicator = event.target.closest('[data-step-indicator]');
    if (indicator) setEditorStep(Number(indicator.dataset.stepIndicator));
    if (event.target.closest('button')) refreshEditorSaveStatus();
  });
  document.querySelector('#operation-form')?.addEventListener('input', refreshEditorSaveStatus);
  document.querySelector('#operation-form')?.addEventListener('change', refreshEditorSaveStatus);

  document.querySelector('#wizard-prev')?.addEventListener('click', () => {
    setEditorStep(currentEditorStep - 1);
  });

  document.querySelector('#wizard-next')?.addEventListener('click', () => {
    setEditorStep(currentEditorStep + 1);
  });

  document.querySelector('#add-front-row').addEventListener('click', () => {
    document.querySelector('#front-rows').insertAdjacentHTML('beforeend', frontRowHtml());
    document.querySelector('#front-rows tr:last-child .front-input')?.focus();
    refreshEditorSaveStatus();
  });

  document.querySelector('#add-rain-row').addEventListener('click', () => {
    document.querySelector('#rain-form').insertAdjacentHTML('beforeend', rainRowHtml());
    document.querySelector('#rain-form .rain-edit-row:last-child .rain-eq')?.focus();
    refreshEditorSaveStatus();
  });

  document.querySelector('#front-rows').addEventListener('click', event => {
    const button = event.target.closest('.remove-front-row');
    if (!button) return;
    button.closest('.front-edit-row')?.remove();
    reorderFrontForm();
    refreshEditorSaveStatus();
  });

  document.querySelector('#front-rows').addEventListener('change', event => {
    if (!event.target.closest('.front-input')) return;
    reorderFrontForm();
    refreshEditorSaveStatus();
  });

  document.querySelector('#rain-form').addEventListener('click', event => {
    const button = event.target.closest('.remove-rain-row');
    if (!button) return;
    button.closest('.rain-edit-row')?.remove();
    reorderRainForm();
    refreshEditorSaveStatus();
  });

  document.querySelector('#rain-form').addEventListener('change', event => {
    if (!event.target.closest('.rain-eq')) return;
    reorderRainForm();
    refreshEditorSaveStatus();
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
    updatedUnit.observation_period = fieldShiftReviewContext?.appliedPeriod || null;
    updatedUnit.changes = document.querySelector('#changes-input').value.trim() || '-';
    updatedUnit.rain = collectRainRows();
    selectedUnitIndex = index;

    const saveButton = document.querySelector('#wizard-save');
    if (saveButton) saveButton.disabled = true;

    try {
      const saved = await saveUnitToServer(index, updatedUnit);
      units[index] = normalizeUnitsCollection(units.map((unit, unitIndex) => unitIndex === index ? saved.unit : unit))[index];
      if (saved.meta) unitMeta[updatedUnit.code] = saved.meta;
      renderDashboard();
      editorInitialSnapshot = getEditorSnapshot();
      closeModal('data-modal');
      showToast(`${updatedUnit.code} atualizado e salvo no servidor.`);
    } catch (error) {
      console.error(error);
      if (error.status === 409 && error.payload?.current) {
        const current = error.payload.current;
        if (current.unit) units[index] = normalizeUnitsCollection(units.map((unit, unitIndex) => unitIndex === index ? current.unit : unit))[index];
        if (current.meta) unitMeta[updatedUnit.code] = current.meta;
        renderDashboard();
        showToast(`${updatedUnit.code} foi alterado por outro usuário. Revise os dados e salve novamente.`);
      } else {
        showToast('Não foi possível salvar no servidor. Tente novamente.');
      }
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  });

}

async function initializeApp() {
  buildUnitSelect();
  setupEvents();

  try {
    await loadServerState();
    try {
      await loadSectorBase({ render: true });
    } catch (sectorError) {
      console.warn('Não foi possível carregar a base de setores.', sectorError);
    }
    try {
      await refreshFieldFrontNotes();
    } catch (noteError) {
      console.warn('Não foi possível carregar as observações de frente.', noteError);
    }
  } catch (error) {
    console.error(error);
    if (window.location.protocol !== 'file:') {
      showToast('Não foi possível carregar os dados do servidor.');
    }
  }
}

// Compartilha o acompanhamento entre analistas sem recarregar o formulário aberto.
function refreshVisibleFieldNotes() {
  if (document.visibilityState === 'hidden') return;
  refreshFieldFrontNotes().catch(error => console.warn('Não foi possível atualizar o acompanhamento.', error));
}

setInterval(refreshVisibleFieldNotes, 30000);
window.addEventListener('focus', refreshVisibleFieldNotes);
initializeApp();
