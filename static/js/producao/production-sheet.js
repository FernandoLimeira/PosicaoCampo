// Popup "Atualização de Status Operacional": todas as frentes da unidade em
// linhas editáveis (frente, seção, setor, status, operação e observação).
// A frente vem do cadastro do sistema; a operação é digitada (um código por campo,
// o botão "+" acrescenta outra) e o sistema confere com as O.S. ao salvar.
// Ao salvar, só as linhas novas ou alteradas e as excluídas são enviadas.
let productionSheetRows = [];
let productionSheetSequence = 0;
let productionSheetUnit = '';
let productionSheetSaving = '';
let productionSheetSectorBase = []; // setores cadastrados: { sector, section, farm }

// Polo SP (PPT e NRD) trabalha só com setor; no Polo MS (PST e RBR) vários setores
// dividem a mesma seção, então o popup mostra também a coluna Seção.
function sheetShowsSection(unit = productionSheetUnit) {
  return productionUnitUsesSection(unit);
}

// Lista com rolagem (datalist) dos setores cadastrados; no Polo MS filtra pela seção da linha.
let productionSheetSectorLists = new Map();

function sheetSectorListId(row) {
  const section = sheetShowsSection() ? row.section.trim().toLocaleLowerCase('pt-BR') : '';
  if (!productionSheetSectorLists.has(section)) {
    const id = `sheet-sectors-${productionSheetSectorLists.size + 1}`;
    productionSheetSectorLists.set(section, id);
    const holder = document.querySelector('#sheet-sector-lists');
    if (holder?.insertAdjacentHTML) holder.insertAdjacentHTML('beforeend', `<datalist id="${id}">${sheetSectorSuggestions(row)}</datalist>`);
  }
  return productionSheetSectorLists.get(section);
}

function resetSheetSectorLists() {
  productionSheetSectorLists = new Map();
  const holder = document.querySelector('#sheet-sector-lists');
  if (holder) holder.innerHTML = '';
}

function sheetSectorSuggestions(row) {
  const section = row.section.trim().toLocaleLowerCase('pt-BR');
  const seen = new Set();
  return productionSheetSectorBase
    .filter(item => !sheetShowsSection() || !section || item.section.toLocaleLowerCase('pt-BR') === section)
    .filter(item => {
      const key = `${item.sector}|${sheetShowsSection() ? item.section : ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(item => `<option value="${escapeHtml(item.sector)}">${escapeHtml([sheetShowsSection() && item.section ? `Seção ${item.section}` : '', item.farm].filter(Boolean).join(' · '))}</option>`)
    .join('');
}

// Polo MS: a seção é digitada e o setor é escolhido numa lista com os setores
// cadastrados daquela seção.
function sheetSectionSectors(section) {
  return productionSectionSectors(productionSheetSectorBase, section);
}

function sheetSectorSelectOptions(row) {
  return productionSectorSelectOptions(productionSheetSectorBase, row.section, row.sector);
}

function sheetSplitOperations(value) {
  const parts = splitProductionOperations(value);
  return parts.length ? [...new Set(parts)] : [''];
}

function sheetDefaultOperations(frontId) {
  const operations = productionFrontDefaultOperations(frontId);
  return operations.length ? operations : [''];
}

function sheetOperationsValue(row) {
  return [...new Set(row.operations.map(value => value.trim()).filter(Boolean))].join(', ');
}

let sheetFrontsCache = { catalog: null, fronts: [] };
function sheetFronts() {
  if (sheetFrontsCache.catalog !== productionCatalog) {
    sheetFrontsCache = {
      catalog: productionCatalog,
      fronts: groupsForEntry().flatMap(group => (group.fronts || [])
        .filter(front => front.is_active !== false)
        .map(front => ({ ...front, group_id: group.id, group_name: group.name })))
    };
  }
  return sheetFrontsCache.fronts;
}

function sheetRowFromItem(item) {
  const entry = item.entry || {};
  const row = {
    key: `row-${++productionSheetSequence}`, id: item.id, groupId: item.group_id,
    frontId: String(item.service_front_id), frontName: item.service_name,
    section: entry.section || '', sector: entry.sector || '', status: entry.status || defaultStatusCode(),
    operations: sheetSplitOperations(entry.operation), observation: entry.observation || '', farm: entry.farm || '', removed: false
  };
  row.original = sheetSnapshot(row);
  return row;
}

function sheetSnapshot(row) {
  return JSON.stringify([row.frontId, row.section.trim(), row.sector.trim(), row.status, sheetOperationsValue(row), row.observation.trim()]);
}

function sheetRowChanged(row) {
  return !row.id || row.removed || sheetSnapshot(row) !== row.original;
}

function productionSheetDirty() {
  return productionSheetRows.some(row => (row.id ? sheetRowChanged(row) : true));
}

// Só as frentes do grupo escolhido no filtro do popup (sem grupo, o da própria linha).
function sheetFrontOptions(row) {
  const allFronts = sheetFronts();
  const rowGroup = String(allFronts.find(front => String(front.id) === row.frontId)?.group_id ?? row.groupId ?? '');
  const group = document.querySelector('#production-sheet-group')?.value || rowGroup;
  const fronts = allFronts.filter(front => !group || String(front.group_id) === group);
  const known = fronts.some(front => String(front.id) === row.frontId);
  const current = allFronts.find(front => String(front.id) === row.frontId);
  const fallback = row.frontId && !known
    ? `<option value="${escapeHtml(row.frontId)}" selected>${escapeHtml(current?.name || row.frontName || 'Frente inativa')}</option>` : '';
  return (row.frontId ? '' : '<option value="">Selecione</option>') + fallback + fronts.map(front =>
    `<option value="${front.id}" ${String(front.id) === row.frontId ? 'selected' : ''}>${escapeHtml(front.name)}</option>`).join('');
}


function sheetRowVisible(row) {
  const group = document.querySelector('#production-sheet-group')?.value || '';
  const front = document.querySelector('#production-sheet-front')?.value || '';
  const fronts = sheetFronts();
  const groupId = fronts.find(item => String(item.id) === row.frontId)?.group_id ?? row.groupId;
  // Linha nova ainda sem frente aparece em qualquer grupo.
  if (!row.frontId && !row.id) return true;
  return (!group || String(groupId) === group) && (!front || row.frontId === front);
}

function sheetRowHtml(row) {
  const style = statusMeta(row.status).className;
  const saving = productionSheetSaving === row.key;
  const disabled = row.removed || saving ? 'disabled' : '';
  return `<tr data-sheet-row="${row.key}" class="${row.removed ? 'is-removed' : ''} ${sheetRowChanged(row) && !row.removed ? 'is-changed' : ''}">
    <td><div class="production-sheet-front ${style}">
      <select data-sheet-field="frontId" aria-label="Frente" ${disabled}>${sheetFrontOptions(row)}</select></div></td>
    <td class="production-sheet-section-cell"><input data-sheet-field="section" value="${escapeHtml(row.section)}" maxlength="32"
      autocomplete="off" placeholder="Seção" aria-label="Seção" ${disabled} /></td>
    <td>${sheetShowsSection()
      ? `<select data-sheet-field="sector" aria-label="Setor" ${disabled}>${sheetSectorSelectOptions(row)}</select>`
      : `<input data-sheet-field="sector" value="${escapeHtml(row.sector)}" maxlength="32" list="${sheetSectorListId(row)}" autocomplete="off"
        placeholder="Setor" aria-label="Setor" ${disabled} />`}</td>
    <td><select data-sheet-field="status" aria-label="Status" ${disabled}>${productionStatuses.map(status =>
      `<option value="${escapeHtml(status.code)}" ${status.code === row.status ? 'selected' : ''}>${escapeHtml(status.name)}</option>`).join('')}</select></td>
    <td><div class="production-sheet-operations">
      ${row.operations.map((value, index) => `<div class="production-sheet-operation">
        <input data-sheet-op="${index}" value="${escapeHtml(value)}" maxlength="40" autocomplete="off"
          inputmode="numeric" placeholder="Cód." title="Código da operação" aria-label="Operação ${index + 1}" ${disabled} />
        ${index > 0 && !row.removed ? `<button class="production-sheet-op-remove" type="button" data-sheet-action="remove-op" data-op-index="${index}" aria-label="Remover operação ${index + 1}" ${disabled}>×</button>` : ''}
      </div>`).join('')}
      ${row.removed ? '' : `<button class="production-sheet-op-add" type="button" data-sheet-action="add-op"
        title="Adicionar outra operação neste setor" aria-label="Adicionar operação" ${saving || row.operations.length >= 10 ? 'disabled' : ''}>+</button>`}
    </div></td>
    <td><input data-sheet-field="observation" value="${escapeHtml(row.observation)}" maxlength="2000" aria-label="Observação" ${disabled} /></td>
    <td>${row.removed
      ? '<button class="production-sheet-undo" type="button" data-sheet-action="undo">Desfazer</button>'
      : `<div class="production-sheet-row-actions">
          <button class="production-secondary-button production-sheet-update" type="button" data-sheet-action="update" ${productionSheetSaving ? 'disabled' : ''}>${saving ? 'Salvando…' : 'Atualizar'}</button>
          <button class="production-sheet-remove icon-delete-button" type="button" data-sheet-action="remove" title="Excluir" aria-label="Excluir linha" ${disabled}>${TRASH_ICON}</button>
        </div>`}</td>
  </tr>`;
}

function renderProductionSheet() {
  const body = document.querySelector('#production-sheet-rows');
  if (!body) return;
  body.closest('table')?.classList.toggle('shows-section', sheetShowsSection());
  const visible = productionSheetRows.filter(sheetRowVisible);
  body.innerHTML = visible.map(sheetRowHtml).join('');
  const empty = document.querySelector('#production-sheet-empty');
  if (empty) empty.hidden = visible.length > 0;
  updateProductionSheetStatus();
}

function updateProductionSheetStatus() {
  const status = document.querySelector('#production-sheet-status');
  const save = document.querySelector('#production-sheet-save');
  if (save) save.disabled = Boolean(productionSheetSaving);
  const add = document.querySelector('#production-sheet-add');
  if (add) add.disabled = productionSheetSaving === 'all';
  const body = document.querySelector('#production-sheet-rows');
  if (body) body.inert = productionSheetSaving === 'all';
  body?.querySelectorAll?.('[data-sheet-action="update"]').forEach(button => { button.disabled = Boolean(productionSheetSaving); });
  if (!status) return;
  if (productionSheetSaving) {
    status.textContent = productionSheetSaving === 'all' ? 'Salvando alterações…' : 'Salvando lançamento…';
    return;
  }
  const changed = productionSheetRows.filter(row => (row.id ? sheetRowChanged(row) : true)).length;
  status.textContent = changed ? `${changed} ${changed === 1 ? 'alteração' : 'alterações'} para salvar.` : 'Revise antes de salvar.';
}

// preferred: { group, front } escolhidos no painel; sem eles, mantém o que estava no popup.
function renderSheetFilters(preferred = {}) {
  const groupSelect = document.querySelector('#production-sheet-group');
  const frontSelect = document.querySelector('#production-sheet-front');
  if (!groupSelect || !frontSelect) return;
  const groupValue = preferred.group || groupSelect.value;
  const groups = groupsForEntry();
  groupSelect.innerHTML = groups.map(group => `<option value="${group.id}">${escapeHtml(group.name)}</option>`).join('');
  // Sem "Todos": mantém o grupo escolhido ou abre no primeiro grupo que tem frentes lançadas.
  const allFronts = sheetFronts();
  const groupOf = row => String(allFronts.find(item => String(item.id) === row.frontId)?.group_id ?? row.groupId);
  const withRows = groups.find(group => productionSheetRows.some(row => groupOf(row) === String(group.id)));
  groupSelect.value = groups.some(group => String(group.id) === groupValue)
    ? groupValue : String((withRows || groups[0])?.id ?? '');
  const frontValue = preferred.group ? preferred.front || '' : frontSelect.value;
  const fronts = sheetFronts().filter(front => !groupSelect.value || String(front.group_id) === groupSelect.value);
  frontSelect.innerHTML = '<option value="">Todas as frentes</option>' + fronts.map(front =>
    `<option value="${front.id}">${escapeHtml(front.name)}</option>`).join('');
  frontSelect.value = fronts.some(front => String(front.id) === frontValue) ? frontValue : '';
}

// Base de setores para a lista do campo Setor. A operação é digitada livre (sem lista);
// o sistema confere com as O.S. ao salvar.
async function loadProductionSheetSectorBase(unit) {
  resetSheetSectorLists();
  try {
    productionSheetSectorBase = await loadProductionSectorBase(unit);
  } catch (error) {
    console.error(error);
    productionSheetSectorBase = [];
  }
}

// Grupo e frente escolhidos no painel da Produção (a frente define o grupo quando só ela vem).
function productionSheetPanelFilter() {
  if (typeof dashboardPanelFilter !== 'object' || !dashboardPanelFilter) return {};
  const front = String(dashboardPanelFilter.front || '');
  const frontGroup = front ? sheetFronts().find(item => String(item.id) === front)?.group_id : null;
  const group = String(frontGroup ?? dashboardPanelFilter.group ?? '');
  return group ? { group, front } : {};
}

async function openProductionSheet() {
  if (!canFillProduction()) return;
  const unit = currentProductionUnit();
  productionSheetUnit = unit;
  const label = document.querySelector('#production-sheet-unit');
  if (label) label.textContent = productionUnitLabel(unit).toLocaleUpperCase('pt-BR');
  productionSheetRows = visibleProductionItems().map(sheetRowFromItem);
  // Abre no grupo e na frente filtrados no painel (Frentes e serviços); sem linha nesse
  // filtro, já começa com uma linha nova daquela frente.
  renderSheetFilters(productionSheetPanelFilter());
  if (!productionSheetRows.some(sheetRowVisible)) addProductionSheetRow({ render: false });
  renderProductionSheet();
  openModal('production-sheet-modal');
  await loadProductionSheetSectorBase(unit);
  if (productionSheetUnit === unit) renderProductionSheet();
}

function addProductionSheetRow({ render = true } = {}) {
  const frontFilter = document.querySelector('#production-sheet-front')?.value || '';
  const groupFilter = document.querySelector('#production-sheet-group')?.value || '';
  const front = sheetFronts().find(item => (frontFilter ? String(item.id) === frontFilter : !groupFilter || String(item.group_id) === groupFilter));
  productionSheetRows.unshift({
    key: `row-${++productionSheetSequence}`, id: null, groupId: front?.group_id ?? null,
    frontId: front ? String(front.id) : '', frontName: front?.name || '', section: '', sector: '',
    status: defaultStatusCode(), operations: front ? sheetDefaultOperations(front.id) : [''], observation: '', farm: '', removed: false, original: ''
  });
  if (!render) return;
  renderProductionSheet();
  document.querySelector(`[data-sheet-row="${productionSheetRows[0].key}"] [data-sheet-field="${sheetShowsSection() ? 'section' : 'sector'}"]`)?.focus();
}

function findSheetRow(element) {
  const key = element.closest('[data-sheet-row]')?.dataset.sheetRow;
  return productionSheetRows.find(row => row.key === key);
}

function markProductionSheetRowSaved(row, id) {
  const existing = productionSheetRows.find(item => item !== row && item.id === id);
  // Uma linha nova pode atualizar um lançamento que já está na planilha.
  const saved = existing && sheetRowChanged(existing) ? existing : row;
  saved.id = id;
  saved.original = sheetSnapshot(row);
  const duplicate = saved === row ? existing : row;
  if (duplicate) {
    productionSheetRows = productionSheetRows.filter(item => item !== duplicate);
    document.querySelector(`[data-sheet-row="${duplicate.key}"]`)?.remove();
  }
}

async function saveProductionSheet(row = null) {
  if (productionSheetSaving || row?.removed || !canFillProduction()) return;
  const unit = productionSheetUnit;
  const pending = row ? [row] : productionSheetRows.filter(item => !item.removed && sheetRowChanged(item));
  const removed = row ? [] : productionSheetRows.filter(item => item.removed && item.id).map(item => item.id);
  if (!pending.length && !removed.length) {
    showToast('Nenhuma alteração para salvar.');
    return;
  }
  const invalid = pending.find(row => !row.frontId || !row.sector.trim());
  if (invalid) {
    showToast(row ? 'Preencha a frente e o setor desta linha.' : 'Preencha a frente e o setor de todas as linhas novas ou alteradas.', true);
    document.querySelector(`[data-sheet-row="${invalid.key}"] [data-sheet-field="${invalid.frontId ? 'sector' : 'frontId'}"]`)?.focus();
    return;
  }
  if (removed.length && !await askConfirmation({
    kicker: 'Produção Agrícola',
    title: `Excluir ${removed.length} ${removed.length === 1 ? 'lançamento' : 'lançamentos'}?`,
    message: 'As frentes marcadas saem da unidade. O histórico é preservado.',
    confirmLabel: 'Salvar e excluir'
  })) return;
  productionSheetSaving = row?.key || 'all';
  const rowSelector = row ? `[data-sheet-row="${row.key}"]` : '';
  const originalRow = row && document.querySelector(rowSelector);
  if (originalRow) originalRow.outerHTML = sheetRowHtml(row);
  updateProductionSheetStatus();
  try {
    const original = new Map(productionItems.map(item => [item.id, item.entry || {}]));
    const result = await apiRequest('/api/production/my-items/sheet', {
      method: 'POST',
      body: JSON.stringify({
        unit_code: unit, work_date: saoPauloIsoDate(), removed,
        rows: pending.map(item => {
          const entry = original.get(item.id) || {};
          const sameLocation = item.id && entry.sector === item.sector.trim() && (entry.section || '') === item.section.trim();
          return {
            id: item.id, service_front_id: Number(item.frontId), sector: item.sector.trim(), section: item.section.trim(),
            status: item.status, operation: sheetOperationsValue(item), observation: item.observation.trim(),
            // Setor/seção alterados: o servidor busca a fazenda na base de setores.
            farm: sameLocation ? (entry.farm || '') : ''
          };
        })
      })
    });
    if (row) {
      markProductionSheetRowSaved(row, result.item_ids[0]);
      showToast('Lançamento atualizado.');
    } else {
      productionSheetRows = [];
      closeModal('production-sheet-modal');
      showToast(`${result.saved} ${result.saved === 1 ? 'frente salva' : 'frentes salvas'}${result.removed ? ` · ${result.removed} excluída(s)` : ''}.`);
    }
    try {
      if (unit === currentProductionUnit()) {
        if (row) await loadProductionItems(unit);
        else await refreshProductionPage(unit, { keepFilters: true });
      }
    } catch (error) {
      console.error(error);
      showToast(PRODUCTION_REFRESH_WARNING, true);
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar a atualização.', true);
  } finally {
    productionSheetSaving = '';
    const savedRow = row && document.querySelector(rowSelector);
    if (savedRow) savedRow.outerHTML = sheetRowHtml(row);
    updateProductionSheetStatus();
  }
}

async function confirmDiscardProductionSheet(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  const discard = await askConfirmation({
    kicker: 'Alterações não salvas',
    title: 'Sair sem salvar?',
    message: 'As alterações feitas nas frentes ainda não foram salvas e serão perdidas.',
    confirmLabel: 'Sair sem salvar',
    cancelLabel: 'Continuar editando',
    tone: 'warning'
  });
  if (discard) {
    productionSheetRows = [];
    closeModal('production-sheet-modal');
  }
}

document.querySelector('#production-add-button')?.addEventListener('click', openProductionSheet);
document.querySelector('#production-sheet-add')?.addEventListener('click', () => addProductionSheetRow());
document.querySelector('#production-sheet-save')?.addEventListener('click', () => saveProductionSheet());
document.querySelector('#production-sheet-group')?.addEventListener('change', () => { renderSheetFilters(); renderProductionSheet(); });
document.querySelector('#production-sheet-front')?.addEventListener('change', renderProductionSheet);

const productionSheetBody = document.querySelector('#production-sheet-rows');
productionSheetBody?.addEventListener('input', event => {
  if (event.target.dataset.sheetOp !== undefined) {
    const row = findSheetRow(event.target);
    if (!row) return;
    row.operations[Number(event.target.dataset.sheetOp)] = event.target.value;
    event.target.closest('tr')?.classList.toggle('is-changed', sheetRowChanged(row));
    updateProductionSheetStatus();
    return;
  }
  const field = event.target.dataset.sheetField;
  const row = field && findSheetRow(event.target);
  if (!row) return;
  row[field] = event.target.value;
  event.target.closest('tr')?.classList.toggle('is-changed', sheetRowChanged(row));
  updateProductionSheetStatus();
});
productionSheetBody?.addEventListener('change', event => {
  if (event.target.dataset.sheetOp !== undefined) return;  // tratado no "input"
  const field = event.target.dataset.sheetField;
  const row = field && findSheetRow(event.target);
  if (!row) return;
  row[field] = event.target.value;
  const tr = event.target.closest('tr');
  if (field === 'frontId') {
    row.frontName = event.target.selectedOptions?.[0]?.textContent || '';
    // Linha sem operação recebe as operações padrão da frente escolhida (ex.: Fert convencional).
    if (!row.operations.some(value => value.trim())) row.operations = sheetDefaultOperations(row.frontId);
    if (tr) tr.outerHTML = sheetRowHtml(row);
  } else if (field === 'section' && sheetShowsSection()) {
    // Polo MS: trocar a seção limpa o setor que não pertence a ela.
    if (row.sector.trim() && !sheetSectionSectors(row.section).some(item => item.sector === row.sector.trim())) row.sector = '';
    const sector = tr?.querySelector('[data-sheet-field="sector"]');
    if (sector) {
      sector.innerHTML = sheetSectorSelectOptions(row);
      sector.focus();
    }
  } else if (field === 'status') {
    const front = tr?.querySelector('.production-sheet-front');
    if (front) front.className = `production-sheet-front ${statusMeta(row.status).className}`;
  } else if (field === 'sector') {
    tr?.querySelector('[data-sheet-field="status"]')?.focus();
  }
  if (field !== 'frontId') tr?.classList.toggle('is-changed', sheetRowChanged(row));
  updateProductionSheetStatus();
});
productionSheetBody?.addEventListener('click', event => {
  const action = event.target.closest('[data-sheet-action]')?.dataset.sheetAction;
  const row = action && findSheetRow(event.target);
  if (!row) return;
  if (action === 'update') return saveProductionSheet(row);
  if (action === 'add-op' || action === 'remove-op') {
    if (action === 'add-op') row.operations.push('');
    else row.operations.splice(Number(event.target.closest('[data-op-index]').dataset.opIndex), 1);
    const tr = event.target.closest('tr');
    if (tr) tr.outerHTML = sheetRowHtml(row);
    if (action === 'add-op') {
      document.querySelector(`[data-sheet-row="${row.key}"] [data-sheet-op="${row.operations.length - 1}"]`)?.focus();
    }
    updateProductionSheetStatus();
    return;
  }
  if (action === 'remove' && !row.id) productionSheetRows = productionSheetRows.filter(item => item !== row);
  else row.removed = action === 'remove';
  renderProductionSheet();
});

// Fechar com alterações pendentes pede confirmação (botões de fechar e Esc).
document.addEventListener('click', event => {
  const close = event.target.closest('[data-close-modal="production-sheet-modal"]');
  if (!close || document.querySelector('#production-sheet-modal')?.hidden) return;
  if (productionSheetSaving) {
    event.preventDefault();
    event.stopImmediatePropagation();
  } else if (productionSheetDirty()) confirmDiscardProductionSheet(event);
}, true);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || isConfirmationOpen() || document.querySelector('#production-sheet-modal')?.hidden) return;
  if (productionSheetSaving) {
    event.preventDefault();
    event.stopImmediatePropagation();
  } else if (productionSheetDirty()) confirmDiscardProductionSheet(event);
}, true);
