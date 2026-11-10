// Painel: observações e detalhes de cada frente (acompanhamento compartilhado entre analistas).
// Ocorrências independentes da posição oficial (status/ATR/chuva/exportação).
let fieldFrontNotesSummary = {};
let fieldNotesRequest = 0;
let fieldCurrentPeriod = null;
let activeFieldFrontContext = null;
const FIELD_FRONT_NOTES_PAGE_SIZE = 3;

function fieldFrontNoteKey(front) {
  const raw = String(front ?? '').trim();
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw.toLocaleLowerCase('pt-BR');
}

function fieldLatestNote(front) {
  return fieldFrontNotesSummary[fieldFrontNoteKey(front)] || null;
}

function fieldObservationText(value, previewOnly = false) {
  const text = String(value || '').replace(/\r\n?/g, '\n').trim();
  const lines = text.split('\n');
  const firstLines = lines.slice(0, 3).join('\n');
  const excerpt = (firstLines.length > 180
    ? firstLines.slice(0, 180).replace(/\s+\S*$/, '') : firstLines).trimEnd();
  if (previewOnly && (text.length > 180 || lines.length > 3)) {
    return `<p class="field-observation-text">${escapeHtml(excerpt)}…</p>`;
  }
  return text.length > 180 || lines.length > 3
    ? `<details class="field-observation-details">
        <summary><span class="field-observation-excerpt">${escapeHtml(excerpt)}…</span>
          <span class="field-observation-expand">Ler observação completa</span>
          <span class="field-observation-collapse">Recolher observação</span></summary>
        <p class="field-observation-text">${escapeHtml(text)}</p>
      </details>`
    : `<p class="field-observation-text">${escapeHtml(text)}</p>`;
}

function fieldObservationPoint(entry) {
  return `<li class="field-observation-point">${fieldObservationText(entry.text, true)}</li>`;
}

function fieldNotePreview(front) {
  const summary = fieldLatestNote(front);
  const highlights = summary?.highlights || [];
  if (!highlights.length) return '';
  const points = highlights.map(fieldObservationPoint).join('');
  const remaining = Math.max(0, summary.highlight_count - highlights.length);
  return `<ul class="field-observation-points" aria-label="Observações em destaque da Frente ${escapeHtml(front)}">${points}</ul>
    <small>${remaining ? `+ ${remaining} ponto${remaining === 1 ? '' : 's'} em aberto · ` : ''}Ver resumo dos acontecimentos</small>`;
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
    if (cell && front !== undefined) cell.innerHTML = fieldNotePreview(front);
  });
  applyFieldViewFilters();
}

function fieldFrontNoteForm() {
  const mayWrite = canEditModule('dashboard');
  if (!mayWrite) return '<p class="field-note-readonly">Você pode consultar o histórico, mas não possui permissão para adicionar observações.</p>';
  return `<form id="field-front-note-form" class="field-front-note-form">
    <label for="field-front-note-text">Nova observação
      <textarea id="field-front-note-text" name="text" rows="2" maxlength="1500" required placeholder="Descreva a ocorrência, a ação necessária ou a previsão de retorno."></textarea>
    </label>
    <label class="field-front-highlight-option"><input type="checkbox" name="highlighted" checked /> Destacar na coluna Observações</label>
    <div class="field-front-note-actions">
      <small id="field-front-note-state" role="status" aria-live="polite"></small>
      <button class="modal-button save" type="submit">Salvar observação</button>
    </div>
  </form>`;
}

function fieldFrontStatusForm(status) {
  if (!canEditModule('dashboard')) return '';
  return `<form id="field-front-status-form" class="field-front-status-form">
    <label for="field-front-status">Situação da frente
      <select id="field-front-status" name="status">${statusOptionsHtml(status, true)}</select>
    </label>
    <button class="modal-button save" type="submit">Salvar situação</button>
    <small id="field-front-status-state" role="status" aria-live="polite"></small>
  </form>`;
}

async function saveFieldFrontStatus(context, status) {
  if (!canEditModule('dashboard')) throw new Error('Você não possui permissão para alterar a situação.');
  if (!statusOptions.some(option => option.label === status)) throw new Error('Situação inválida.');
  const index = units.findIndex(unit => unit.code === context.unit);
  const updatedUnit = clone(context.unitSnapshot);
  const row = updatedUnit.rows[context.index];
  if (index < 0 || !row || row[0] !== context.front || row[1] !== context.sector) {
    throw new Error('A frente foi alterada. Feche e abra os detalhes novamente.');
  }
  row[2] = getStatusColor(status);
  row[3] = status;
  updatedUnit.border = calculateUnitBorder(updatedUnit.rows);
  const saved = await saveUnitToServer(index, updatedUnit, context.version);
  units[index] = normalizeUnitsCollection(units.map((unit, unitIndex) => unitIndex === index ? saved.unit : unit))[index];
  if (saved.meta) unitMeta[context.unit] = saved.meta;
  context.unitSnapshot = clone(units[index]);
  context.version = unitMeta[context.unit]?.version ?? null;
  renderDashboard();
}

function fieldFrontNotesHistory(data, page = 1, summaryOnly = false) {
  const entries = data?.entries || [];
  if (!entries.length) return `<p class="field-front-note-empty">${summaryOnly ? 'Nenhum acontecimento em aberto para esta frente.' : 'Nenhum registro de acompanhamento para esta frente.'}</p>`;
  const pageCount = Math.ceil(entries.length / FIELD_FRONT_NOTES_PAGE_SIZE);
  const currentPage = Math.max(1, Math.min(Number(page) || 1, pageCount));
  const start = (currentPage - 1) * FIELD_FRONT_NOTES_PAGE_SIZE;
  const visibleEntries = summaryOnly ? entries : entries.slice(start, start + FIELD_FRONT_NOTES_PAGE_SIZE);
  const body = visibleEntries.map(entry => `<li class="field-front-note-event">
    <div class="field-front-note-copy">${fieldObservationText(entry.text)}</div>
      ${!summaryOnly && canEditModule('dashboard') ? `<button type="button" class="field-note-action" data-field-note-id="${entry.id}" data-field-note-action="${entry.resolved_at ? 'reopen' : entry.highlighted ? 'resolve' : 'highlight'}">${entry.resolved_at ? 'Reabrir ponto' : entry.highlighted ? 'Concluir ponto' : 'Destacar ponto'}</button>` : ''}
  </li>`).join('');
  const pagination = !summaryOnly && (data.total > FIELD_FRONT_NOTES_PAGE_SIZE || entries.length > FIELD_FRONT_NOTES_PAGE_SIZE || data.next_cursor)
    ? `<nav class="field-notes-pagination" aria-label="Páginas das observações">
        <small>${start + 1}–${Math.min(start + FIELD_FRONT_NOTES_PAGE_SIZE, entries.length)} de ${data.total || entries.length} observações</small>
        <div><button type="button" class="field-note-action" data-field-notes-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>Anteriores</button>
          <button type="button" class="field-note-action" data-field-notes-page="${currentPage + 1}" ${currentPage === pageCount && !data.next_cursor ? 'disabled' : ''}>Próximas</button></div>
      </nav>` : '';
  return `<ul class="field-front-note-timeline" aria-label="Observações da frente">${body}</ul>${pagination}`;
}

async function loadFieldFrontHistory(context, older = false) {
  const container = document.querySelector('#field-front-note-history');
  if (!container) return;
  const request = context.historyRequest = (context.historyRequest || 0) + 1;
  if (!older) container.innerHTML = '<p class="field-front-note-empty">Carregando histórico…</p>';
  try {
    const cursor = older && context.history?.next_cursor ? `&before_id=${context.history.next_cursor}` : '';
    const path = `/api/front-notes?unit=${encodeURIComponent(context.unit)}&front=${encodeURIComponent(context.front)}${context.summaryOnly ? '&open_only=1' : ''}`;
    let data = await apiRequest(`${path}${cursor}`, { cache: 'no-store' });
    if (activeFieldFrontContext !== context || context.historyRequest !== request) return;
    const entries = older ? [...context.history.entries, ...data.entries] : [...data.entries];
    // O resumo reúne também os lotes seguintes da API antes de mostrar a lista completa.
    while (context.summaryOnly && data.next_cursor) {
      const beforeId = data.next_cursor;
      data = await apiRequest(`${path}&before_id=${beforeId}`, { cache: 'no-store' });
      if (activeFieldFrontContext !== context || context.historyRequest !== request) return;
      if (data.next_cursor && data.next_cursor >= beforeId) throw new Error('Página de observações inválida.');
      entries.push(...data.entries);
    }
    context.history = { ...data, entries };
    context.historyPage = Math.max(1, Math.min(context.historyPage || 1, Math.ceil(context.history.entries.length / FIELD_FRONT_NOTES_PAGE_SIZE)));
    container.innerHTML = fieldFrontNotesHistory(context.history, context.historyPage, context.summaryOnly);
  } catch (error) {
    if (activeFieldFrontContext !== context || context.historyRequest !== request) return;
    if (older) showToast('Não foi possível carregar os registros anteriores. Tente novamente.', true);
    else container.textContent = 'Não foi possível carregar o histórico. Tente abrir os detalhes novamente.';
    console.error(error);
  }
}

function openFieldFrontDetails(index, summaryOnly = false) {
  const unit = units[selectedUnitIndex];
  const row = unit?.rows?.[index];
  const modal = document.querySelector('#field-front-detail-modal');
  const content = document.querySelector('#field-front-detail-content');
  if (!Array.isArray(row) || !modal || !content) return;
  const [front = '', sector = '', , status = '', atr = ''] = row;
  const farm = fieldFarmFromSector(sector);
  const matchKey = canonicalFieldFrontKey(front);
  const rainRow = (Array.isArray(unit.rain) ? unit.rain : []).find(item => Array.isArray(item) && canonicalFieldFrontKey(item[0]) === matchKey);
  const statusClass = fieldStatusClass(status);
  const rainSection = rainRow ? `<p class="field-front-detail-rain"><strong>Chuva:</strong>
    turno ${escapeHtml(rainRow[1] ?? '—')} mm · acumulado ${escapeHtml(rainRow[2] ?? '—')} mm</p>` : '';
  content.innerHTML = `
    <div class="field-front-detail-unit">
      <span>${escapeHtml(unit.code)} · ${escapeHtml(unit.name)}</span>
      <span id="field-front-current-status" class="field-status-chip ${statusClass}">${escapeHtml(status)}</span>
    </div>
    <dl class="field-front-detail-grid">
      <div><dt>Setor</dt><dd>${escapeHtml(sector)}</dd></div>
      <div><dt>Fazenda</dt><dd>${escapeHtml(farm.name)}
        ${farm.note ? `<small>${escapeHtml(farm.note)}</small>` : ''}</dd></div>
      <div><dt>ATR</dt><dd>${escapeHtml(atr || '—')}</dd></div>
    </dl>
    ${rainSection}
    ${summaryOnly ? '' : `<div class="field-front-edit-row">
      ${fieldFrontStatusForm(status)}
      ${fieldFrontNoteForm()}
    </div>`}
    <section class="field-front-detail-section" aria-label="${summaryOnly ? 'Observações' : 'Observações da frente'}">
      <h3>${summaryOnly ? 'Observações' : 'Observações da frente'}</h3>
      <div id="field-front-note-history"></div>
    </section>`;
  const context = { unit: unit.code, front, sector, index, summaryOnly, unitSnapshot: clone(unit),
    version: unitMeta[unit.code]?.version ?? null };
  activeFieldFrontContext = context;
  const title = document.querySelector('#field-front-detail-title');
  if (title) title.textContent = `${summaryOnly ? 'Resumo' : 'Detalhes'} da Frente ${front}`;
  openModal('field-front-detail-modal');
  loadFieldFrontHistory(context);
}

// Formulários do modal de detalhes da frente (situação, observações e paginação).
function setupFieldNotesEvents() {
  document.querySelector('#field-front-detail-modal')?.addEventListener('submit', async event => {
    if (event.target?.id === 'field-front-status-form') {
      event.preventDefault();
      const context = activeFieldFrontContext;
      const form = event.target;
      const button = form.querySelector('[type="submit"]');
      const state = form.querySelector('#field-front-status-state');
      const status = form.querySelector('[name="status"]').value;
      if (!context || button.disabled) return;
      button.disabled = true;
      state.textContent = 'Salvando situação…';
      try {
        await saveFieldFrontStatus(context, status);
        if (activeFieldFrontContext !== context) return;
        const chip = document.querySelector('#field-front-current-status');
        chip.textContent = status;
        chip.className = `field-status-chip ${fieldStatusClass(status)}`;
        state.textContent = 'Situação salva e atualizada para a emissão da imagem.';
        showToast('Situação da frente atualizada.');
      } catch (error) {
        state.textContent = error.status === 409
          ? 'A unidade foi atualizada por outro analista. Atualize a página e revise a situação antes de salvar novamente.'
          : error.message || 'Não foi possível salvar a situação.';
      } finally {
        button.disabled = false;
      }
      return;
    }
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
      context.historyPage = 1;
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
    const pageButton = event.target.closest('[data-field-notes-page]');
    if (pageButton && activeFieldFrontContext && !pageButton.disabled) {
      const context = activeFieldFrontContext;
      const page = Number(pageButton.dataset.fieldNotesPage);
      if (!Number.isInteger(page) || page < 1) return;
      pageButton.disabled = true;
      if (page > Math.ceil((context.history?.entries?.length || 0) / FIELD_FRONT_NOTES_PAGE_SIZE) && context.history?.next_cursor) {
        await loadFieldFrontHistory(context, true);
      }
      if (activeFieldFrontContext === context && page <= Math.ceil((context.history?.entries?.length || 0) / FIELD_FRONT_NOTES_PAGE_SIZE)) {
        context.historyPage = page;
        document.querySelector('#field-front-note-history').innerHTML = fieldFrontNotesHistory(context.history, page, context.summaryOnly);
      }
      pageButton.disabled = false;
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
}
