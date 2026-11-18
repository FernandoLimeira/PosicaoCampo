// Painel: editor da posição da unidade (assistente em etapas do modal "Preencher").
let currentEditorStep = 0;
let editorInitialSnapshot = null;
let editorUnitVersion = null;
let editorObservationContext = null;
let editorObservationRequest = 0;
const editorSteps = ['Campo', 'Produção', 'Apontamentos e Mudanças'];

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

// Fechamento da balança sobre o qual os "Indicadores do turno" do formulário foram montados.
let editorWeighingRef = null;

// A tela não se atualiza sozinha (botão "Atualizar dados"): ao salvar, confere se outra pessoa
// importou um SELECT novo enquanto o Preencher estava aberto.
async function refreshEditorWeighing() {
  const before = weighingSummary?.last_import?.imported_at ?? null;
  const summary = await loadWeighingSummary();
  if (summary && (summary.last_import?.imported_at ?? null) !== before && serverStateReady) renderDashboard();
  return summary;
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

// Indicadores do turno (etapa Produção). Sem pesagem, os valores são digitados. Com pesagem,
// vêm da balança (mesmo cálculo da imagem e do relatório, core/field-indicators.js) e podem ser
// corrigidos aqui se houver inconsistência: a correção vale só para o fechamento importado
// (some quando outro SELECT é importado). ATR, processado do dia e projeção só existem com balança.
const METRIC_OVERRIDE_KEYS = { 1: 'millingShift', 2: 'deliveryShift', 3: 'stock', 4: 'milling3h', 5: 'delivery3h' };
const BALANCE_ONLY_FIELDS = [['atr', 'ATR PARCIAL', 'KG/T', 2], ['day', 'PROCESSADO DIA', 'T', 0], ['projection', 'PROJEÇÃO', 'T', 0]];

// Valor do campo como o card mostra (inteiro; ATR com 2 casas), sem separador de milhar.
function metricInputValue(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '';
  return String(digits ? Number(Number(value).toFixed(digits)) : Math.round(Number(value)));
}

function metricFieldHtml({ label, unit, value, key = '', balance = '', corrected = false, index = null, digits = 0, source = 'Balança' }) {
  const hint = key ? `<em>${escapeHtml(source)}: ${escapeHtml(fieldIndicatorNumber(balance === '' ? null : Number(balance), digits))}${corrected ? ' · corrigido' : ''}</em>` : '';
  return `
    <div class="metric-field${corrected ? ' is-corrected' : ''}">
      <label>
        <span>${escapeHtml(label)}</span>
        <div class="metric-input-wrap">
          <input class="metric-input" ${index === null ? '' : `data-metric-index="${index}" `}${key ? `data-override-key="${key}" data-balance="${escapeHtml(balance)}" ` : ''}type="number" step="${digits ? '0.01' : '1'}" min="0" value="${escapeHtml(value)}" />
          <small>${escapeHtml(unit)}</small>
        </div>
        ${hint}
      </label>
    </div>`;
}

function renderMetricsForm(unit) {
  const container = document.querySelector('#metrics-form');
  const item = fieldUnitIndicators(unit, weighingSummary);
  editorWeighingRef = item.closingRef;
  if (!item.closingRef) {
    container.innerHTML = metricDefinitions.map((definition, index) => metricFieldHtml({
      label: definition.label, unit: definition.unit, value: metricNumber(unit.metrics[index]?.[2]), index })).join('');
    return;
  }
  const note = `<div class="metrics-weighing-note">
      <button id="metrics-balance-reset" class="modal-button secondary" type="button">Usar valores da balança</button>
    </div>`;
  const typed = metricDefinitions.map((definition, index) => {
    const key = METRIC_OVERRIDE_KEYS[index];
    if (!key) return metricFieldHtml({ label: definition.label, unit: definition.unit, value: metricNumber(unit.metrics[index]?.[2]), index });
    return metricFieldHtml({ label: definition.label, unit: definition.unit, value: metricInputValue(item[key]), index, key,
      balance: metricInputValue(item.balance[key]), corrected: item.corrected.includes(key) });
  });
  const balanceOnly = BALANCE_ONLY_FIELDS.map(([key, label, suffix, digits]) => metricFieldHtml({ label, unit: suffix,
    value: metricInputValue(item[key], digits), key, balance: metricInputValue(item.balance[key], digits),
    corrected: item.corrected.includes(key), digits,
    source: key === 'atr' && item.atrSource === 'frentes' ? 'Média das frentes' : 'Balança' }));
  container.innerHTML = note + typed.join('') + balanceOnly.join('');
}

// Correções dos "Indicadores do turno": só os campos diferentes do valor da balança, presos ao
// fechamento atual (``ref``). Sem diferença, nada é gravado e a imagem segue a balança.
function collectImageOverrides(unit, ref = fieldUnitIndicators(unit, weighingSummary).closingRef) {
  if (!ref) return null;
  const values = {};
  document.querySelectorAll('#metrics-form [data-override-key]').forEach(input => {
    const text = input.value.trim();
    if (!text) return;
    const value = Number(text);
    const balance = input.dataset.balance === '' ? null : Number(input.dataset.balance);
    if (Number.isFinite(value) && value >= 0 && (balance === null || Math.abs(value - balance) > 1e-9)) {
      values[input.dataset.overrideKey] = value;
    }
  });
  return Object.keys(values).length ? { ref, values } : null;
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
  autoResizeTextarea(document.querySelector('#support-input'));
}

function loadUnitEditor(index) {
  const unit = units[index];
  if (!unit) return;
  editorUnitVersion = unitMeta[unit.code]?.version ?? null;

  const unitSelect = document.querySelector('#unit-select');
  const formUnitName = document.querySelector('#form-unit-name');
  const observationInput = document.querySelector('#observation-input');
  const changesInput = document.querySelector('#changes-input');
  const supportInput = document.querySelector('#support-input');

  if (unitSelect) unitSelect.value = String(index);
  unit.border = calculateUnitBorder(unit.rows);
  if (formUnitName) formUnitName.textContent = `${unit.code} — ${unit.name}`;
  if (observationInput) observationInput.value = unit.observation === '-' ? '' : unit.observation || '';
  if (changesInput) changesInput.value = unit.changes === '-' ? '' : unit.changes || '';
  if (supportInput) supportInput.value = unit.support === '-' ? '' : unit.support || '';
  resizeEditorTextareas();

  renderFrontRows(unit.rows);
  renderMetricsForm(unit);
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

// Assistente de preenchimento: etapas, linhas dinâmicas, proteção contra descarte e gravação.
function setupEditorEvents() {
  const editorModal = document.querySelector('#data-modal');
  // O fechamento comum acontece em common.js; a captura evita descartes acidentais:
  // o fechamento é interrompido e só acontece se o usuário confirmar o descarte.
  const confirmDiscard = async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const discard = await askConfirmation({
      kicker: 'Alterações não salvas',
      title: 'Sair sem salvar?',
      message: 'As alterações feitas nesta unidade ainda não foram salvas e serão perdidas.',
      confirmLabel: 'Sair sem salvar',
      cancelLabel: 'Continuar editando',
      tone: 'warning'
    });
    if (discard) closeModal('data-modal');
  };
  document.addEventListener('click', event => {
    const closeButton = event.target.closest('[data-close-modal="data-modal"]');
    if (!closeButton || editorModal?.hidden || !editorHasUnsavedChanges()) return;
    confirmDiscard(event);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || isConfirmationOpen() || editorModal?.hidden || !editorHasUnsavedChanges()) return;
    confirmDiscard(event);
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

  document.querySelector('#metrics-form')?.addEventListener('click', event => {
    if (!event.target.closest('#metrics-balance-reset')) return;
    document.querySelectorAll('#metrics-form [data-override-key]').forEach(input => { input.value = input.dataset.balance; });
    refreshEditorSaveStatus();
  });

  document.querySelector('#add-front-row').addEventListener('click', () => {
    document.querySelector('#front-rows').insertAdjacentHTML('beforeend', frontRowHtml());
    document.querySelector('#front-rows tr:last-child .front-input')?.focus();
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

  ['#observation-input', '#changes-input', '#support-input'].forEach(selector => {
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
    const expectedVersion = editorUnitVersion;
    if (!currentUnit) {
      if (saveButton) saveButton.disabled = false;
      return;
    }
    // Pesagem importada por outra pessoa com o formulário aberto: os indicadores do formulário
    // são de outro fechamento. As correções feitas (campos diferentes da balança) não se perdem:
    // com a confirmação, passam para o fechamento novo; os demais campos seguem a balança nova.
    let overridesRef;
    if (editorWeighingRef) {
      await refreshEditorWeighing();
      const currentRef = fieldUnitIndicators(currentUnit, weighingSummary).closingRef;
      if (currentRef !== editorWeighingRef) {
        const corrections = collectImageOverrides(currentUnit, editorWeighingRef);
        const keep = corrections && currentRef ? await askConfirmation({
          kicker: 'Nova pesagem importada',
          title: 'Manter as correções no novo fechamento?',
          message: `Outra pessoa importou um SELECT novo (dados até ${weighingReferenceTime(currentUnit.code)}) com o Preencher aberto. `
            + 'As correções dos indicadores do turno passam para o novo fechamento; os demais valores seguem a balança nova.',
          confirmLabel: 'Manter correções',
          cancelLabel: 'Revisar valores',
          tone: 'warning'
        }) : false;
        if (!keep) {
          renderMetricsForm(currentUnit);
          setEditorStep(1);
          refreshEditorSaveStatus();
          showToast(`Nova pesagem importada (dados até ${weighingReferenceTime(currentUnit.code)}). Confira os indicadores do turno e salve.`, true);
          if (saveButton) saveButton.disabled = false;
          return;
        }
        overridesRef = currentRef;
      }
    }

    const updatedUnit = clone(currentUnit);
    updatedUnit.rows = collectFrontRows();
    updatedUnit.border = calculateUnitBorder(updatedUnit.rows);
    updatedUnit.metrics = collectMetrics();
    updatedUnit.observation = document.querySelector('#observation-input').value.trim() || '-';
    updatedUnit.observation_period = editorObservationContext?.appliedPeriod || currentUnit.observation_period || null;
    updatedUnit.changes = document.querySelector('#changes-input').value.trim() || '-';
    updatedUnit.support = document.querySelector('#support-input')?.value.trim() || '-';
    // Correções = campos alterados em relação ao valor mostrado; presas ao fechamento atual.
    const imageOverrides = collectImageOverrides(updatedUnit, overridesRef || editorWeighingRef);
    if (imageOverrides) updatedUnit.image_overrides = imageOverrides;
    else delete updatedUnit.image_overrides;
    selectedUnitIndex = index;

    try {
      const saved = await saveUnitToServer(index, updatedUnit, expectedVersion);
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
