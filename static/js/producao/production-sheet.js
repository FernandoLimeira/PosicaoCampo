// Popup "Atualização de Status Operacional": todas as frentes da unidade em
// linhas editáveis (frente, seção, setor, status, operação e observação).
// A frente vem do cadastro do sistema; as operações vêm das O.S. abertas do setor
// (o botão "+" acrescenta outra operação quando o setor tem mais de uma O.S.).
// Ao salvar, só as linhas novas ou alteradas e as excluídas são enviadas.
let productionSheetRows = [];
let productionSheetSequence = 0;
let productionSheetOrders = new Map();
let productionSheetUnit = '';

function sheetSectorKey(value) {
  const text = String(value ?? '').trim();
  return /^\d+(\.0+)?$/.test(text) ? String(Number.parseInt(text, 10)) : text.toLocaleLowerCase('pt-BR');
}

function sheetOperationKey(value) {
  const match = String(value ?? '').match(/^\s*(\d+)/);
  return match ? String(Number.parseInt(match[1], 10)) : String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

function sheetSplitOperations(value) {
  const parts = String(value || '').split(/[,;+]/).map(part => part.trim()).filter(Boolean);
  return parts.length ? [...new Set(parts)] : [''];
}

function sheetOperationsValue(row) {
  return [...new Set(row.operations.map(value => value.trim()).filter(Boolean))].join(', ');
}

function sheetFronts() {
  return groupsForEntry().flatMap(group => (group.fronts || [])
    .filter(front => front.is_active !== false)
    .map(front => ({ ...front, group_id: group.id, group_name: group.name })));
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

// Operações das O.S. abertas do setor (código — descrição), sem repetir.
function sheetOperationsFor(sector) {
  const operations = new Map();
  (productionSheetOrders.get(sheetSectorKey(sector)) || []).forEach(order => {
    const key = sheetOperationKey(order.operation);
    if (!operations.has(key)) operations.set(key, { key, label: [order.operation, order.operation_name].filter(Boolean).join(' — ') });
  });
  return [...operations.values()].sort((a, b) => compareFrontLabels(a.key, b.key));
}

// Todas as operações escolhidas precisam ter O.S. no setor.
function sheetOrderState(row) {
  if (!row.sector.trim()) return '';
  const orders = productionSheetOrders.get(sheetSectorKey(row.sector)) || [];
  if (!orders.length) return 'missing';
  const available = new Set(orders.map(order => sheetOperationKey(order.operation)));
  const wanted = row.operations.filter(Boolean).map(sheetOperationKey);
  return wanted.every(key => available.has(key)) ? 'ok' : 'missing';
}

function sheetFrontOptions(row) {
  const fronts = sheetFronts();
  const groups = new Map();
  fronts.forEach(front => {
    if (!groups.has(front.group_id)) groups.set(front.group_id, { name: front.group_name, fronts: [] });
    groups.get(front.group_id).fronts.push(front);
  });
  const known = fronts.some(front => String(front.id) === row.frontId);
  const fallback = row.frontId && !known
    ? `<option value="${escapeHtml(row.frontId)}" selected>${escapeHtml(row.frontName || 'Frente inativa')}</option>` : '';
  return (row.frontId ? '' : '<option value="">Selecione</option>') + fallback + [...groups.values()].map(group =>
    `<optgroup label="${escapeHtml(group.name)}">${group.fronts.map(front =>
      `<option value="${front.id}" ${String(front.id) === row.frontId ? 'selected' : ''}>${escapeHtml(front.name)}</option>`).join('')}</optgroup>`
  ).join('');
}

function sheetOperationOptions(row, index) {
  const value = row.operations[index] || '';
  const taken = new Set(row.operations.filter((item, position) => item && position !== index).map(sheetOperationKey));
  const operations = sheetOperationsFor(row.sector).filter(item => !taken.has(item.key));
  const current = value ? sheetOperationKey(value) : '';
  const extra = current && !operations.some(item => item.key === current)
    ? `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)} (sem O.S.)</option>` : '';
  const placeholder = operations.length ? 'Selecione' : (row.sector.trim() ? 'Sem O.S. no setor' : 'Informe o setor');
  return `<option value="">${placeholder}</option>${extra}${operations.map(item =>
    `<option value="${escapeHtml(item.key)}" ${item.key === current ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}`;
}

function sheetRowVisible(row) {
  const group = document.querySelector('#production-sheet-group')?.value || '';
  const front = document.querySelector('#production-sheet-front')?.value || '';
  const fronts = sheetFronts();
  const groupId = fronts.find(item => String(item.id) === row.frontId)?.group_id ?? row.groupId;
  return (!group || String(groupId) === group) && (!front || row.frontId === front);
}

function sheetRowHtml(row) {
  const style = statusMeta(row.status).className;
  const orderState = sheetOrderState(row);
  const stateLabel = orderState === 'ok' ? 'O.S. OK' : orderState === 'missing' ? 'Sem O.S.' : '';
  return `<tr data-sheet-row="${row.key}" class="${row.removed ? 'is-removed' : ''} ${sheetRowChanged(row) && !row.removed ? 'is-changed' : ''}">
    <td><div class="production-sheet-front ${style}">
      <select data-sheet-field="frontId" aria-label="Frente" ${row.removed ? 'disabled' : ''}>${sheetFrontOptions(row)}</select></div></td>
    <td><input data-sheet-field="section" value="${escapeHtml(row.section)}" maxlength="32" aria-label="Seção" ${row.removed ? 'disabled' : ''} /></td>
    <td><input data-sheet-field="sector" value="${escapeHtml(row.sector)}" maxlength="32" aria-label="Setor" ${row.removed ? 'disabled' : ''} /></td>
    <td><select data-sheet-field="status" aria-label="Status" ${row.removed ? 'disabled' : ''}>${productionStatuses.map(status =>
      `<option value="${escapeHtml(status.code)}" ${status.code === row.status ? 'selected' : ''}>${escapeHtml(status.name)}</option>`).join('')}</select></td>
    <td><div class="production-sheet-operations">
      ${row.operations.map((_, index) => `<div class="production-sheet-operation">
        <select data-sheet-op="${index}" aria-label="Operação ${index + 1}" ${row.removed ? 'disabled' : ''}>${sheetOperationOptions(row, index)}</select>
        ${index > 0 && !row.removed ? `<button class="production-sheet-op-remove" type="button" data-sheet-action="remove-op" data-op-index="${index}" aria-label="Remover operação ${index + 1}">×</button>` : ''}
      </div>`).join('')}
      <div class="production-sheet-op-footer">
        ${row.removed ? '' : `<button class="production-sheet-op-add" type="button" data-sheet-action="add-op"
          title="Adicionar outra operação neste setor" aria-label="Adicionar operação" ${row.operations.length >= 10 ? 'disabled' : ''}>+</button>`}
        ${stateLabel ? `<span class="production-sheet-os is-${orderState}" title="${stateLabel}">${stateLabel}</span>` : ''}
      </div></div></td>
    <td><input data-sheet-field="observation" value="${escapeHtml(row.observation)}" maxlength="2000" aria-label="Observação" ${row.removed ? 'disabled' : ''} /></td>
    <td>${row.removed
      ? '<button class="production-sheet-undo" type="button" data-sheet-action="undo">Desfazer</button>'
      : '<button class="production-sheet-remove" type="button" data-sheet-action="remove">Excluir</button>'}</td>
  </tr>`;
}

function renderProductionSheet() {
  const body = document.querySelector('#production-sheet-rows');
  if (!body) return;
  const visible = productionSheetRows.filter(sheetRowVisible);
  body.innerHTML = visible.map(sheetRowHtml).join('');
  const empty = document.querySelector('#production-sheet-empty');
  if (empty) empty.hidden = visible.length > 0;
  updateProductionSheetStatus();
}

function updateProductionSheetStatus() {
  const status = document.querySelector('#production-sheet-status');
  if (!status) return;
  const changed = productionSheetRows.filter(row => (row.id ? sheetRowChanged(row) : true)).length;
  status.textContent = changed ? `${changed} ${changed === 1 ? 'alteração' : 'alterações'} para salvar.` : 'Revise antes de salvar.';
}

function renderSheetFilters() {
  const groupSelect = document.querySelector('#production-sheet-group');
  const frontSelect = document.querySelector('#production-sheet-front');
  if (!groupSelect || !frontSelect) return;
  const groupValue = groupSelect.value;
  groupSelect.innerHTML = '<option value="">Todos os grupos</option>' + groupsForEntry().map(group =>
    `<option value="${group.id}">${escapeHtml(group.name)}</option>`).join('');
  groupSelect.value = groupsForEntry().some(group => String(group.id) === groupValue) ? groupValue : '';
  const frontValue = frontSelect.value;
  const fronts = sheetFronts().filter(front => !groupSelect.value || String(front.group_id) === groupSelect.value);
  frontSelect.innerHTML = '<option value="">Todas as frentes</option>' + fronts.map(front =>
    `<option value="${front.id}">${escapeHtml(front.name)}</option>`).join('');
  frontSelect.value = fronts.some(front => String(front.id) === frontValue) ? frontValue : '';
}

async function loadProductionSheetOrders(unit) {
  productionSheetOrders = new Map();
  try {
    const data = await apiRequest(`/api/production/service-orders?unit=${encodeURIComponent(unit)}`);
    (data?.orders || []).forEach(order => {
      const key = sheetSectorKey(order.sector);
      if (!productionSheetOrders.has(key)) productionSheetOrders.set(key, []);
      productionSheetOrders.get(key).push(order);
    });
  } catch (error) {
    console.error(error);
    showToast('Não foi possível carregar as O.S.; a operação pode ser preenchida depois.', true);
  }
}

async function openProductionSheet() {
  if (!canFillProduction()) return;
  const unit = currentProductionUnit();
  productionSheetUnit = unit;
  const label = document.querySelector('#production-sheet-unit');
  if (label) label.textContent = productionUnitLabel(unit).toLocaleUpperCase('pt-BR');
  const configure = document.querySelector('#production-sheet-configure');
  if (configure) configure.hidden = !canConfigureProduction();
  productionSheetRows = visibleProductionItems().map(sheetRowFromItem);
  if (!productionSheetRows.length) addProductionSheetRow({ render: false });
  renderSheetFilters();
  renderProductionSheet();
  openModal('production-sheet-modal');
  await loadProductionSheetOrders(unit);
  if (productionSheetUnit === unit) renderProductionSheet();
}

function addProductionSheetRow({ render = true } = {}) {
  const frontFilter = document.querySelector('#production-sheet-front')?.value || '';
  const groupFilter = document.querySelector('#production-sheet-group')?.value || '';
  const front = sheetFronts().find(item => (frontFilter ? String(item.id) === frontFilter : !groupFilter || String(item.group_id) === groupFilter));
  productionSheetRows.unshift({
    key: `row-${++productionSheetSequence}`, id: null, groupId: front?.group_id ?? null,
    frontId: front ? String(front.id) : '', frontName: front?.name || '', section: '', sector: '',
    status: defaultStatusCode(), operations: [''], observation: '', farm: '', removed: false, original: ''
  });
  if (!render) return;
  renderProductionSheet();
  document.querySelector(`[data-sheet-row="${productionSheetRows[0].key}"] [data-sheet-field="sector"]`)?.focus();
}

function findSheetRow(element) {
  const key = element.closest('[data-sheet-row]')?.dataset.sheetRow;
  return productionSheetRows.find(row => row.key === key);
}

async function saveProductionSheet() {
  const button = document.querySelector('#production-sheet-save');
  const unit = productionSheetUnit;
  const pending = productionSheetRows.filter(row => !row.removed && sheetRowChanged(row));
  const removed = productionSheetRows.filter(row => row.removed && row.id).map(row => row.id);
  if (!pending.length && !removed.length) {
    showToast('Nenhuma alteração para salvar.');
    return;
  }
  const invalid = pending.find(row => !row.frontId || !row.sector.trim());
  if (invalid) {
    showToast('Preencha a frente e o setor de todas as linhas novas ou alteradas.', true);
    document.querySelector(`[data-sheet-row="${invalid.key}"] [data-sheet-field="${invalid.frontId ? 'sector' : 'frontId'}"]`)?.focus();
    return;
  }
  if (removed.length && !await askConfirmation({
    kicker: 'Produção Agrícola',
    title: `Excluir ${removed.length} ${removed.length === 1 ? 'lançamento' : 'lançamentos'}?`,
    message: 'As frentes marcadas saem da unidade. O histórico é preservado.',
    confirmLabel: 'Salvar e excluir'
  })) return;
  if (button) button.disabled = true;
  try {
    const original = new Map(productionItems.map(item => [item.id, item.entry || {}]));
    const result = await apiRequest('/api/production/my-items/sheet', {
      method: 'POST',
      body: JSON.stringify({
        unit_code: unit, work_date: saoPauloIsoDate(), removed,
        rows: pending.map(row => {
          const entry = original.get(row.id) || {};
          const sameLocation = row.id && entry.sector === row.sector.trim() && (entry.section || '') === row.section.trim();
          return {
            id: row.id, service_front_id: Number(row.frontId), sector: row.sector.trim(), section: row.section.trim(),
            status: row.status, operation: sheetOperationsValue(row), observation: row.observation.trim(),
            // Setor/seção alterados: o servidor busca a fazenda na base de setores.
            farm: sameLocation ? (entry.farm || '') : ''
          };
        })
      })
    });
    productionSheetRows = [];
    closeModal('production-sheet-modal');
    showToast(`${result.saved} ${result.saved === 1 ? 'frente salva' : 'frentes salvas'}${result.removed ? ` · ${result.removed} excluída(s)` : ''}.`);
    try {
      await refreshProductionPage(unit, { keepFilters: true });
    } catch (error) {
      console.error(error);
      showToast(PRODUCTION_REFRESH_WARNING, true);
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar a atualização.', true);
  } finally {
    if (button) button.disabled = false;
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
document.querySelector('#production-sheet-save')?.addEventListener('click', saveProductionSheet);
document.querySelector('#production-sheet-configure')?.addEventListener('click', async () => {
  if (productionSheetDirty() && !await askConfirmation({
    kicker: 'Alterações não salvas', title: 'Sair sem salvar?', tone: 'warning',
    message: 'Para configurar frentes, o popup será fechado e as alterações não salvas serão perdidas.',
    confirmLabel: 'Configurar frentes', cancelLabel: 'Continuar editando'
  })) return;
  productionSheetRows = [];
  closeModal('production-sheet-modal');
  await openNewProductionItem();
  await showConfigPane();
});
document.querySelector('#production-sheet-group')?.addEventListener('change', () => { renderSheetFilters(); renderProductionSheet(); });
document.querySelector('#production-sheet-front')?.addEventListener('change', renderProductionSheet);

const productionSheetBody = document.querySelector('#production-sheet-rows');
productionSheetBody?.addEventListener('input', event => {
  const field = event.target.dataset.sheetField;
  const row = field && findSheetRow(event.target);
  if (!row) return;
  row[field] = event.target.value;
  event.target.closest('tr')?.classList.toggle('is-changed', sheetRowChanged(row));
  updateProductionSheetStatus();
});
productionSheetBody?.addEventListener('change', event => {
  if (event.target.dataset.sheetOp !== undefined) {
    const row = findSheetRow(event.target);
    if (!row) return;
    row.operations[Number(event.target.dataset.sheetOp)] = event.target.value;
    const tr = event.target.closest('tr');
    if (tr) tr.outerHTML = sheetRowHtml(row);
    updateProductionSheetStatus();
    return;
  }
  const field = event.target.dataset.sheetField;
  const row = field && findSheetRow(event.target);
  if (!row) return;
  row[field] = event.target.value;
  if (field === 'frontId') row.frontName = event.target.selectedOptions?.[0]?.textContent || '';
  // Setor e status mudam as opções de operação, o aviso de O.S. e a cor da linha.
  if (['sector', 'status', 'frontId'].includes(field)) {
    const tr = event.target.closest('tr');
    if (tr) {
      tr.outerHTML = sheetRowHtml(row);
      if (field === 'sector') document.querySelector(`[data-sheet-row="${row.key}"] [data-sheet-field="status"]`)?.focus();
    }
  }
  updateProductionSheetStatus();
});
productionSheetBody?.addEventListener('click', event => {
  const action = event.target.closest('[data-sheet-action]')?.dataset.sheetAction;
  const row = action && findSheetRow(event.target);
  if (!row) return;
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
  if (!close || document.querySelector('#production-sheet-modal')?.hidden || !productionSheetDirty()) return;
  confirmDiscardProductionSheet(event);
}, true);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || isConfirmationOpen() || document.querySelector('#production-sheet-modal')?.hidden
    || !productionSheetDirty()) return;
  confirmDiscardProductionSheet(event);
}, true);
