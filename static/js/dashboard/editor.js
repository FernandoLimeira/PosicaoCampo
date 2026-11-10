// Painel: editor da posição da unidade (assistente em etapas do modal "Preencher").
let currentEditorStep = 0;
let editorInitialSnapshot = null;
let editorObservationContext = null;
let editorObservationRequest = 0;
const editorSteps = ['Campo', 'Produção', 'Apontamentos e Mudanças', 'Precipitação'];

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

function resetEditorObservations(unit) {
  editorObservationContext = { unitCode: unit.code, edited: false,
    savedPeriod: clone(unit.observation_period || null), appliedPeriod: clone(unit.observation_period || null) };
  editorObservationRequest += 1;
}

async function loadEditorObservations() {
  const context = editorObservationContext;
  if (!context) return;
  const input = document.querySelector('#observation-input');
  if (!input) return;
  const originalText = input.value;
  const request = ++editorObservationRequest;
  const query = new URLSearchParams({ unit: context.unitCode });
  if (context.savedPeriod?.last_note_id !== undefined) query.set('after_id', context.savedPeriod.last_note_id);
  try {
    const data = await apiRequest(`/api/front-notes/shift?${query}`, { cache: 'no-store' });
    if (editorObservationContext !== context || request !== editorObservationRequest || context.edited || input.value !== originalText || document.querySelector('#data-modal')?.hidden) return;
    const samePeriod = context.savedPeriod?.work_date === data.work_date && context.savedPeriod?.shift === data.shift;
    const suggestion = String(data.suggested_text || '').trim();
    // No mesmo turno, preserva a revisão salva e acrescenta somente registros posteriores.
    if (suggestion && !(samePeriod && context.savedPeriod.last_note_id === undefined && originalText.trim())) {
      input.value = samePeriod && originalText.trim() ? `${originalText.trim()}\n\n${suggestion}` : suggestion;
    }
    if (suggestion || samePeriod) context.appliedPeriod = {
      work_date: data.work_date, shift: data.shift, last_note_id: data.last_note_id ?? 0
    };
    context.savedPeriod = clone(context.appliedPeriod);
    autoResizeTextarea(input);
    refreshEditorSaveStatus();
    if (input.value.length > 10000) showToast('A observação excede 10.000 caracteres. Revise o texto antes de salvar.', true);
  } catch (error) {
    if (editorObservationContext === context && request === editorObservationRequest) {
      showToast('Não foi possível carregar os acontecimentos. A observação salva foi mantida.', true);
    }
  }
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
  if (!serverStateReady || !Number.isInteger(unitMeta[units[safeIndex].code]?.version)) {
    showToast('Aguarde o carregamento da posição oficial antes de preencher.', true);
    return;
  }
  loadUnitEditor(safeIndex);
  resetEditorObservations(units[safeIndex]);
  setEditorStep(0);
  editorInitialSnapshot = getEditorSnapshot();
  refreshEditorSaveStatus();
  openModal('data-modal');
  editorObservationContext.loadPromise = loadEditorObservations();
}

function primaryFieldStatus(status) {
  const classification = getFieldStatus(status);
  return classification.group === 'active' ? 'EM ATIVIDADE'
    : classification.group === 'wet' ? 'SOLO ÚMIDO' : '';
}

function statusOptionsHtml(selectedStatus, detailed = false) {
  const normalizedStatus = detailed ? normalizeStatus(selectedStatus) : primaryFieldStatus(selectedStatus);
  const options = detailed ? statusOptions
    : statusOptions.filter(option => ['EM ATIVIDADE', 'SOLO ÚMIDO'].includes(option.label));
  const placeholder = !detailed && !normalizedStatus
    ? '<option value="" disabled selected hidden>Definido em Ver</option>' : '';
  return placeholder + options.map(({ label }) => `
    <option value="${escapeHtml(label)}" ${label === normalizedStatus ? 'selected' : ''}>${escapeHtml(label)}</option>
  `).join('');
}

function frontRowHtml(front = '', sector = '', status = 'EM ATIVIDADE', atr = '') {
  return `
    <tr class="front-edit-row">
      <td><input class="front-input" type="text" maxlength="12" value="${escapeHtml(front)}" placeholder="Ex.: 402" /></td>
      <td class="sector-input-cell">
        <input class="sector-input" type="text" maxlength="24" value="${escapeHtml(sector)}" placeholder="Ex.: 67620" />
      </td>
      <td><select class="status-input" data-original-status="${escapeHtml(normalizeStatus(status))}">${statusOptionsHtml(status)}</select></td>
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
        <span>Frente</span>
        <input class="rain-eq" type="text" maxlength="20" value="${escapeHtml(eq)}" placeholder="Ex.: FT 06" />
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

function sortRainRows(rain = []) {
  return [...rain].sort((a, b) => compareFrontLabels(canonicalFieldFrontKey(a?.[0]), canonicalFieldFrontKey(b?.[0])));
}

function renderRainForm(rain) {
  const container = document.querySelector('#rain-form');
  const index = Number(document.querySelector('#unit-select')?.value ?? selectedUnitIndex);
  const unit = units[index] || units[selectedUnitIndex];
  const sortedRain = sortRainRows(standardizeFieldRainLabels(unit?.code, unit?.rows, rain));
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
      const input = row.querySelector('.status-input');
      const status = collectPrimaryFieldStatus(input);
      const atr = row.querySelector('.atr-input').value.trim();
      return [front, sector, getStatusColor(status), status, atr];
    })
    .filter(([front, sector]) => front || sector);

  return sortFrontRows(rows);
}

function collectPrimaryFieldStatus(input) {
  const original = input.dataset.originalStatus;
  // Salvar outros campos ou reordenar frentes não pode apagar uma situação detalhada.
  return original && input.value === primaryFieldStatus(original)
    ? normalizeStatus(original) : normalizeStatus(input.value);
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

// Assistente de preenchimento: etapas, linhas dinâmicas, proteção contra descarte e gravação.
function setupEditorEvents() {
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
    textarea?.addEventListener('input', () => {
      if (selector === '#observation-input' && editorObservationContext) editorObservationContext.edited = true;
      autoResizeTextarea(textarea);
    });
  });

  document.querySelector('#operation-form').addEventListener('submit', async event => {
    event.preventDefault();

    if (currentEditorStep < editorSteps.length - 1) {
      setEditorStep(currentEditorStep + 1);
      return;
    }

    const saveButton = document.querySelector('#wizard-save');
    if (saveButton?.disabled) return;
    if (saveButton) saveButton.disabled = true;
    const observationContext = editorObservationContext;
    await observationContext?.loadPromise;
    if (editorObservationContext !== observationContext) {
      if (saveButton) saveButton.disabled = false;
      return;
    }

    const index = Number(document.querySelector('#unit-select').value);
    const currentUnit = units[index];
    if (!currentUnit) {
      if (saveButton) saveButton.disabled = false;
      return;
    }

    const updatedUnit = clone(currentUnit);
    updatedUnit.rows = collectFrontRows();
    updatedUnit.border = calculateUnitBorder(updatedUnit.rows);
    updatedUnit.metrics = collectMetrics();
    updatedUnit.observation = document.querySelector('#observation-input').value.trim() || '-';
    updatedUnit.observation_period = editorObservationContext?.appliedPeriod || currentUnit.observation_period || null;
    updatedUnit.changes = document.querySelector('#changes-input').value.trim() || '-';
    updatedUnit.rain = collectRainRows();
    selectedUnitIndex = index;

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
        // Recarrega o formulário com a versão atual: salvar de novo nunca
        // pode reaplicar silenciosamente os dados antigos sobre os do colega.
        loadUnitEditor(index);
        editorInitialSnapshot = getEditorSnapshot();
        refreshEditorSaveStatus();
        showToast(`${updatedUnit.code} foi alterado por outro usuário. O formulário foi atualizado; refaça suas alterações.`, true);
      } else {
        showToast('Não foi possível salvar no servidor. Tente novamente.', true);
      }
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  });
}
