// Produção Agrícola: popup de lançamento (adicionar e editar frente): grupo/frente, status,
// setores (Polo SP: setor e fazenda; Polo MS: seção e lista de setores), operações com a
// conferência das O.S. abertas do setor, e a gravação. Carregado antes de producao.js.

const productionSectorOptions = new WeakMap();
let productionSectorSequence = 0;
let productionOriginalSectorRow = null;
const productionRemovedSectorIds = new Set();

function renderEntryOperations(row, operations = ['']) {
  const container = row?.querySelector('[data-entry-operation-inputs]');
  if (!container) return;
  container.innerHTML = operations.map((value, index) => `<div class="production-sheet-operation">
      <input data-entry-op="${index}" value="${escapeHtml(value)}" maxlength="40"
        autocomplete="off" inputmode="numeric" placeholder="Cód." aria-label="Operação ${index + 1}" />
      ${index > 0 ? `<button class="production-sheet-op-remove" type="button" data-entry-op-remove="${index}" aria-label="Remover operação ${index + 1}">×</button>` : ''}
    </div>`).join('') + `<button class="production-sheet-op-add" type="button" data-entry-op-add title="Adicionar outra operação"
      aria-label="Adicionar operação" ${operations.length >= 10 ? 'disabled' : ''}>+</button>`;
}

function productionEntryOperationValues(row) {
  return [...row.querySelectorAll('[data-entry-op]')].map(input => input.value);
}

const productionSectorScans = new WeakMap();

function clearProductionSectorScan(row) {
  productionSectorScans.delete(row);
  const target = row?.querySelector('[data-sector-scan]');
  if (target) {
    target.textContent = '';
    target.classList?.remove('is-missing');
  }
  const suggestions = row?.querySelector('[data-entry-operation-suggestions]');
  if (suggestions) suggestions.innerHTML = '';
}

function renderProductionSectorWarning(row, codes) {
  const available = productionSectorScans.get(row)?.operations;
  const target = row.querySelector('[data-sector-scan]');
  if (!available || !target) return;
  const sector = productionSectorField(row, 'sector').value.trim();
  const missing = codes.filter(code => !available.has(productionOperationKey(code)));
  const message = missing.length
    ? `Setor ${sector} sem O.S. aberta para ${missing.length === 1 ? 'a operação' : 'as operações'} ${missing.join(', ')}.`
    : available.size ? '' : `Setor ${sector} sem O.S. aberta.`;
  target.textContent = message;
  target.classList?.toggle('is-missing', Boolean(message));
}

function refreshProductionSectorWarning(row) {
  renderProductionSectorWarning(row, productionEntryOperationValues(row).flatMap(splitProductionOperations));
}

async function scanProductionSector(row) {
  const target = row?.querySelector('[data-sector-scan]');
  if (!target) return;
  clearProductionSectorScan(row);
  const unit = document.querySelector('#production-unit-input')?.value || currentProductionUnit();
  const sector = productionSectorField(row, 'sector').value.trim();
  const sectionField = productionSectorField(row, 'section');
  const section = sectionField.value.trim();
  if (!sector || ((productionUnitUsesSection(unit) || sectionField.required) && !section)) return;
  const request = {};
  productionSectorScans.set(row, request);
  target.textContent = 'Consultando O.S. abertas…';
  const query = new URLSearchParams({ unit, sector, section, summary: '1' });
  try {
    const data = await apiRequest(`/api/production/service-orders?${query}`);
    if (productionSectorScans.get(row) !== request) return;
    const operations = new Map();
    for (const order of data.orders || []) {
      const key = productionOperationKey(order.operation);
      if (key && !operations.has(key)) operations.set(key, order);
    }
    request.operations = operations;
    refreshProductionSectorWarning(row);
    if (productionEditingItemId !== null || !operations.size) return;
    const suggestions = row.querySelector('[data-entry-operation-suggestions]');
    if (!suggestions) return;
    const frontId = document.querySelector('#production-front-input')?.value;
    const defaults = productionFrontDefaultOperations(frontId).map(productionOperationKey);
    const options = [...operations].sort(([a], [b]) => Number(defaults.includes(b)) - Number(defaults.includes(a)));
    suggestions.innerHTML = `<span>Operações com O.S. aberta no setor ${escapeHtml(sector)}</span><div class="production-sector-scan-options">${options.map(([, order]) =>
        `<button type="button" class="production-secondary-button" data-sector-operation="${escapeHtml(order.operation)}">${escapeHtml(serviceOrderOperationLabel(order))}</button>`
      ).join('')}</div>`;
  } catch (error) {
    if (productionSectorScans.get(row) === request) {
      target.innerHTML = '<span>Não foi possível consultar as O.S.</span> <button type="button" class="production-secondary-button" data-retry-sector-scan>Consultar novamente</button>';
    }
  }
}

function groupsForEntry() {
  return Array.isArray(productionCatalog.groups) ? productionCatalog.groups.filter(group => group.is_active !== false) : [];
}

function renderEntryGroups(selectedGroupId = null, selectedFrontId = null, fallbackItem = null) {
  const groupSelect = document.querySelector('#production-group-input');
  if (!groupSelect) return;
  let groups = groupsForEntry();
  if (fallbackItem && !groups.some(group => Number(group.id) === Number(fallbackItem.group_id))) {
    groups = [...groups, { id: fallbackItem.group_id, name: fallbackItem.group_name, fronts: [] }];
  }
  groupSelect.innerHTML = groups.map(group =>
    `<option value="${group.id}" ${Number(group.id) === Number(selectedGroupId) ? 'selected' : ''}>${escapeHtml(group.name)}</option>`
  ).join('');
  if (!groupSelect.value && groups[0]) groupSelect.value = String(groups[0].id);
  renderEntryFronts(selectedFrontId, fallbackItem);
}

function renderEntryFronts(selectedFrontId = null, fallbackItem = null) {
  const groupSelect = document.querySelector('#production-group-input');
  const frontSelect = document.querySelector('#production-front-input');
  if (!groupSelect || !frontSelect) return;
  const group = groupsForEntry().find(item => Number(item.id) === Number(groupSelect.value));
  let fronts = Array.isArray(group?.fronts) ? group.fronts.filter(front => front.is_active !== false) : [];
  if (fallbackItem && Number(fallbackItem.group_id) === Number(groupSelect.value) && !fronts.some(front => Number(front.id) === Number(fallbackItem.service_front_id))) {
    fronts = [...fronts, { id: fallbackItem.service_front_id, name: fallbackItem.service_name }];
  }
  frontSelect.innerHTML = fronts.length
    ? fronts.map(front => `<option value="${front.id}" ${Number(front.id) === Number(selectedFrontId) ? 'selected' : ''}>${escapeHtml(front.name)}</option>`).join('')
    : '<option value="">Nenhuma frente/serviço cadastrada neste grupo</option>';
}

function setSelectedStatus(value) {
  const select = document.querySelector('[data-production-status-select]');
  if (!select?.options) return;
  if ([...select.options].some(option => option.value === value)) select.value = value;
  select.className = `production-status-select ${statusMeta(select.value).className}`;
}

function selectedStatus() {
  return document.querySelector('[data-production-status-select]')?.value || '';
}

function defaultStatusCode() {
  return productionStatuses.find(status => status.code === 'EM ATIVIDADE')?.code
    || productionStatuses[0]?.code
    || '';
}

function productionSectorField(row, field) {
  return row === document ? document.querySelector(`#production-${field}-input`)
    : row.querySelector(`[data-sector-field="${field}"]`);
}

function productionSectorRows() {
  return [...document.querySelectorAll('[data-production-sector-row]')];
}

function updateProductionSectorRows() {
  const rows = productionSectorRows();
  const add = document.querySelector('#production-add-sector');
  if (add) add.disabled = rows.length >= 100;
  rows.forEach(row => {
    const remove = row.querySelector('[data-remove-sector]');
    if (remove) remove.hidden = rows.length <= 1;
  });
  const note = document.querySelector('#production-entry-removal-note');
  const count = productionRemovedSectorIds.size;
  if (note) note.textContent = count ? `${count} ${count === 1 ? 'setor será removido' : 'setores serão removidos'} ao atualizar.` : '';
}

function addProductionSector(item = null) {
  const rows = productionSectorRows();
  if (!rows.length || rows.length >= 100) return;
  const row = rows[0].cloneNode(true);
  const suffix = `-${++productionSectorSequence}`;
  row.querySelectorAll('[id]').forEach(element => { element.id += suffix; });
  row.querySelectorAll('label[for]').forEach(label => { label.htmlFor += suffix; });
  delete row.dataset.linkedItemId;
  clearProductionSectorScan(row);
  document.querySelector('#production-sector-rows').append(row);
  updateProductionSectorRows();
  if (item) {
    fillProductionSectorRow(row, item);
    return;
  }
  productionSectorField(row, 'sector').value = '';
  productionSectorField(row, 'farm').value = '';
  renderEntryOperations(row);
  resetSectorFields(row);
  productionSectorField(row, productionEntryUsesSection() ? 'section' : 'sector').focus();
}

function resetSectorFields(row = document) {
  productionSectorOptions.set(row, []);
  const section = productionSectorField(row, 'section');
  if (productionEntryUsesSection()) {
    if (section) section.value = '';
    renderProductionSectorChoices(row);
    return;
  }
  if (section) {
    section.innerHTML = '<option value="">Sem seção</option>';
    showProductionSectionChoice(row, section, false);
  }
}

function productionRegisteredSectionOptions(options, selected = '') {
  return '<option value="">Confirme a seção</option>' + options.map(item =>
    `<option value="${escapeHtml(item.section)}"${item.section === selected ? ' selected' : ''}>${escapeHtml(item.section)}${item.farm ? ` — ${escapeHtml(item.farm)}` : ''}</option>`
  ).join('');
}

function showProductionSectionChoice(row, section, visible) {
  const label = section.closest?.('label');
  if (label) label.hidden = !visible;
  section.required = visible;
  row.classList?.toggle('shows-section', visible);
}

async function resolveSectorFromBase(row = document, { keep = false } = {}) {
  const unit = document.querySelector('#production-unit-input')?.value || currentProductionUnit();
  const input = productionSectorField(row, 'sector');
  const sector = input?.value.trim() || '';
  const section = productionSectorField(row, 'section');
  const farm = productionSectorField(row, 'farm');
  const previous = keep ? section?.value || '' : '';
  const request = {};
  if (!keep) {
    resetSectorFields(row);
    if (farm) farm.value = '';
  }
  productionSectorOptions.set(row, request);
  if (!sector) return;
  try {
    request.promise = apiRequest(`/api/production/sector-options?unit=${encodeURIComponent(unit)}&sector=${encodeURIComponent(sector)}`);
    const data = await request.promise;
    if (productionSectorOptions.get(row) !== request || input.value.trim() !== sector ||
        document.querySelector('#production-unit-input')?.value !== unit) return;
    const options = Array.isArray(data.items) ? data.items : [];
    const sections = options.filter(item => item.section);
    productionSectorOptions.set(row, sections);
    if (!section) return;
    showProductionSectionChoice(row, section, sections.length > 1);
    if (sections.length) {
      const selected = sections.length === 1 ? sections[0] : sections.find(item => item.section === previous);
      section.innerHTML = productionRegisteredSectionOptions(sections, selected?.section);
      section.value = selected?.section || '';
      if (farm && (selected?.section !== previous || !farm.value)) farm.value = selected?.farm || '';
    } else if (farm && !farm.value) {
      farm.value = options[0]?.farm || '';
    }
  } catch (error) {
    console.warn(error);
  }
}

// Polo MS (PST e RBR): vários setores dividem a mesma seção, então a seção é digitada
// e o setor é escolhido numa lista com os setores cadastrados daquela seção.
// No Polo SP são exibidos apenas o setor e a fazenda.
const PRODUCTION_SECTION_UNITS = new Set(['PST', 'RBR']);
function productionUnitUsesSection(unit) {
  return PRODUCTION_SECTION_UNITS.has(String(unit || '').toUpperCase());
}

function productionEntryUsesSection() {
  return productionUnitUsesSection(document.querySelector('#production-unit-input')?.value || currentProductionUnit());
}

// Base de setores da unidade ({ sector, section, farm }), carregada uma vez por unidade.
const productionSectorBaseCache = new Map();
function loadProductionSectorBase(unit, { refresh = false } = {}) {
  const key = String(unit || '').toUpperCase();
  if (refresh || !productionSectorBaseCache.has(key)) {
    const promise = apiRequest(`/api/production/sector-base?unit=${encodeURIComponent(key)}`)
      .then(base => (Array.isArray(base?.items) ? base.items : []))
      .catch(error => {
        if (productionSectorBaseCache.get(key) === promise) productionSectorBaseCache.delete(key);
        throw error;
      });
    productionSectorBaseCache.set(key, promise);
  }
  return productionSectorBaseCache.get(key);
}

function productionSectionSectors(base, section) {
  const key = String(section || '').trim().toLocaleLowerCase('pt-BR');
  if (!key) return [];
  const bySector = new Map();
  (base || [])
    .filter(item => String(item.section || '').trim().toLocaleLowerCase('pt-BR') === key)
    .forEach(item => { if (!bySector.has(item.sector)) bySector.set(item.sector, item); });
  return [...bySector.values()].sort((a, b) => compareFrontLabels(a.sector, b.sector));
}

// Opções do seletor de setor (Polo MS); um setor salvo fora do cadastro continua na lista.
function productionSectorSelectOptions(base, section, current) {
  const sectors = productionSectionSectors(base, section);
  const value = String(current || '').trim();
  const placeholder = !String(section || '').trim() ? 'Digite a seção' : (sectors.length ? 'Selecione' : 'Seção sem setores');
  const known = sectors.some(item => item.sector === value);
  return `<option value="" ${value ? '' : 'selected'}>${placeholder}</option>`
    + (value && !known ? `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)}</option>` : '')
    + sectors.map(item => `<option value="${escapeHtml(item.sector)}" ${item.sector === value ? 'selected' : ''}>${
      escapeHtml([item.sector, item.farm].filter(Boolean).join(' · '))}</option>`).join('');
}

// Troca o campo entre texto e lista mantendo id e o vínculo data-sector-field.
function swapProductionSectorField(row, field, tag) {
  const current = productionSectorField(row, field);
  if (!current?.tagName || current.tagName.toLowerCase() === tag) return;
  const next = document.createElement(tag);
  next.id = current.id;
  next.dataset.sectorField = field;
  if (tag === 'input') {
    next.type = 'text';
    next.maxLength = 32;
    next.autocomplete = 'off';
    next.placeholder = field === 'section' ? 'Ex.: 3190' : 'Ex.: 3392';
  }
  next.required = field === 'sector';
  current.replaceWith(next);
}

// Ajusta todas as linhas de setor do popup ao polo da unidade escolhida.
function applyProductionLocationMode() {
  const usesSection = productionEntryUsesSection();
  productionSectorRows().forEach(row => {
    swapProductionSectorField(row, 'section', usesSection ? 'input' : 'select');
    swapProductionSectorField(row, 'sector', usesSection ? 'select' : 'input');
    const sectorLabel = productionSectorField(row, 'sector')?.closest?.('label');
    const sectionLabel = productionSectorField(row, 'section')?.closest?.('label');
    if (!sectorLabel || !sectionLabel) return;
    sectionLabel.hidden = !usesSection;
    row.classList.toggle('shows-section', usesSection);
    // Polo MS: a seção vem primeiro, porque filtra a lista de setores.
    if (usesSection) sectorLabel.before(sectionLabel);
    else sectionLabel.before(sectorLabel);
  });
}

// Polo MS: monta a lista de setores da seção digitada. Um setor que não é da
// seção é limpo, a não ser que seja o valor já salvo do lançamento (keep).
async function renderProductionSectorChoices(row = document, { keep = '' } = {}) {
  const select = productionSectorField(row, 'sector');
  const sectionInput = productionSectorField(row, 'section');
  if (!select || !sectionInput) return;
  const unit = document.querySelector('#production-unit-input')?.value || currentProductionUnit();
  const request = {};
  productionSectorOptions.set(row, request);
  const previous = keep || select.value;
  const draw = (base, loaded) => {
    const section = sectionInput.value.trim();
    // Antes da base carregar, mantém o valor; depois, só se for da seção (ou o salvo).
    const current = keep || !loaded || productionSectionSectors(base, section).some(item => item.sector === previous) ? previous : '';
    select.innerHTML = productionSectorSelectOptions(base, section, current);
    select.value = current;
  };
  draw([], false);
  try {
    request.promise = loadProductionSectorBase(unit);
    const base = await request.promise;
    if (productionSectorOptions.get(row) !== request) return;
    request.base = base;
    draw(base, true);
    syncFarmFromSectorChoice(row);
  } catch (error) {
    console.warn(error);
  }
}

function syncFarmFromSectorChoice(row = document) {
  const base = productionSectorOptions.get(row)?.base;
  const farm = productionSectorField(row, 'farm');
  if (!farm || !Array.isArray(base)) return;
  const sector = productionSectorField(row, 'sector')?.value || '';
  if (!sector) farm.value = '';
  const selected = productionSectionSectors(base, productionSectorField(row, 'section')?.value)
    .find(item => item.sector === sector);
  if (selected) farm.value = selected.farm || '';
}

function showEntryPane() {
  document.querySelector('#production-entry-pane').hidden = false;
  document.querySelector('#production-entry-footer').hidden = false;

  const editingItemId = productionEditingItemId;
  const configButton = document.querySelector('#production-config-toggle');
  if (configButton) configButton.hidden = Boolean(editingItemId) || !canConfigureProduction();

  const modalTitle = document.querySelector('#production-modal-title');
  if (modalTitle) modalTitle.textContent = editingItemId ? 'Editar frente' : 'Adicionar frente';
}

function setProductionEntryEditMode(isEditing) {
  const serviceSection = document.querySelector('#production-service-section');
  if (serviceSection) serviceSection.hidden = Boolean(isEditing);

  const configButton = document.querySelector('#production-config-toggle');
  if (configButton) configButton.hidden = Boolean(isEditing) || !canConfigureProduction();

  const modalTitle = document.querySelector('#production-modal-title');
  if (modalTitle) modalTitle.textContent = isEditing ? 'Editar frente' : 'Adicionar frente';
  const kicker = document.querySelector('#production-modal-kicker');
  if (kicker) kicker.textContent = isEditing ? 'Editar frente' : 'Produção Agrícola';
  const subtitle = document.querySelector('#production-modal-subtitle');
  if (subtitle) subtitle.hidden = !isEditing;
  // Na edição, só setores, status e operações: o popup fica mais estreito. Observação e
  // previsão de mudança ficam no Detalhe da frente (lateral).
  document.querySelector('#production-entry-form')?.classList?.toggle('is-editing', Boolean(isEditing));
  document.querySelector('#production-entry-modal .production-editor-modal')?.classList?.toggle('is-editing', Boolean(isEditing));

  const submit = document.querySelector('#production-entry-submit');
  if (submit) submit.textContent = isEditing ? 'Atualizar' : 'Adicionar';
  const removeFront = document.querySelector('#production-remove-front');
  if (removeFront) removeFront.hidden = !isEditing;

  const hint = document.querySelector('#production-entry-hint');
  if (hint) hint.textContent = isEditing ? 'Enter atualiza' : 'Enter adiciona';
}

function clearEntryForm(defaultUnit = selectedNavbarProductionUnit()) {
  const rows = productionSectorRows();
  productionOriginalSectorRow ||= rows[0];
  const first = productionOriginalSectorRow;
  rows.forEach(row => {
    productionSectorOptions.delete(row);
    clearProductionSectorScan(row);
    if (row !== first) row.remove();
  });
  if (first && !rows.includes(first)) document.querySelector('#production-sector-rows').prepend(first);
  if (first?.dataset) delete first.dataset.linkedItemId;
  productionRemovedSectorIds.clear();
  updateProductionSectorRows();
  const form = document.querySelector('#production-entry-form');
  form?.reset();
  productionEditingItemId = null;
  // Mantém compatibilidade com abas que ainda usam o campo de identificação.
  const itemInput = document.querySelector('#production-item-id');
  if (itemInput) itemInput.value = '';
  document.querySelector('#production-work-date').value = saoPauloIsoDate();
  setProductionEntryUnit(defaultUnit);
  applyProductionLocationMode();
  renderEntryGroups();
  setSelectedStatus(defaultStatusCode());
  if (first) resetSectorFields(first);
  renderEntryOperations(first);
  setProductionEntryEditMode(false);
}

function fillProductionSectorRow(row, item) {
  const entry = item.entry || {};
  if (row !== document) {
    row.dataset.linkedItemId = String(item.id);
    const operations = splitProductionOperations(entry.operation);
    renderEntryOperations(row, operations.length ? operations : ['']);
  }
  const section = productionSectorField(row, 'section');
  productionSectorField(row, 'sector').value = entry.sector || '';
  productionSectorField(row, 'farm').value = entry.farm || '';
  if (productionEntryUsesSection()) {
    section.value = entry.section || '';
    renderProductionSectorChoices(row, { keep: entry.sector || '' });
  } else {
    resetSectorFields(row);
    section.innerHTML = `<option value="${escapeHtml(entry.section || '')}">${escapeHtml(entry.section || 'Sem seção')}</option>`;
    section.value = entry.section || '';
    if (entry.sector) {
      resolveSectorFromBase(row, { keep: true }).then(() => {
        if (row.isConnected) scanProductionSector(row);
      });
      return;
    }
  }
  scanProductionSector(row);
}

function openEditProductionItem(itemId) {
  if (!canFillProduction()) return;
  const item = findProductionItem(itemId);
  if (!item) return;
  showEntryPane();
  clearEntryForm();
  const entry = item.entry || {};
  productionEditingItemId = Number(item.id);
  const itemInput = document.querySelector('#production-item-id');
  if (itemInput) itemInput.value = String(item.id);
  document.querySelector('#production-work-date').value = saoPauloIsoDate();
  setProductionEntryUnit(currentProductionUnit());
  applyProductionLocationMode();
  renderEntryGroups(item.group_id, item.service_front_id, item);
  const [row = document] = productionSectorRows();
  fillProductionSectorRow(row, item);
  setSelectedStatus(entry.status || defaultStatusCode());
  if (item.sector_group_id) {
    productionItems.filter(other => other.id !== item.id && other.service_front_id === item.service_front_id
      && other.sector_group_id === item.sector_group_id && other.entry).forEach(addProductionSector);
  }
  setProductionEntryEditMode(true);
  // O nome da frente em edição fica em destaque no topo do popup.
  document.querySelector('#production-modal-title').textContent = item.service_name || 'Frente';
  const subtitle = document.querySelector('#production-modal-subtitle');
  if (subtitle) {
    subtitle.textContent = [productionUnitLabel(currentProductionUnit()), item.group_name,
      entry.sector ? productionPlaceLabel(entry) : '',
      item.owner_name ? `Analista: ${item.owner_name}` : ''].filter(Boolean).join(' · ');
  }
  if (!item.is_own) {
    document.querySelector('#production-modal-kicker').textContent = 'Atualizar frente';
    document.querySelector('#production-entry-submit').textContent = 'Salvar atualização';
  }
  openModal('production-entry-modal');
  document.querySelector(productionEntryUsesSection() ? '#production-section-input' : '#production-sector-input')?.focus();
}

async function submitProductionEntry(event) {
  event.preventDefault();
  if (!canFillProduction()) return;
  const submit = document.querySelector('#production-entry-submit');
  if (submit?.disabled) return;
  const itemId = productionEditingItemId;
  if (itemId !== null && (!Number.isInteger(itemId) || itemId <= 0)) {
    showToast('Não foi possível identificar o lançamento. Feche e abra a edição novamente.', true);
    return;
  }
  const unit = document.querySelector('#production-unit-input')?.value || currentProductionUnit();
  const frontId = Number(document.querySelector('#production-front-input')?.value || 0);
  if (!frontId) {
    showToast('Selecione uma frente ou serviço.', true);
    return;
  }
  const payload = {
    unit_code: unit,
    service_front_id: frontId,
    work_date: saoPauloIsoDate()
  };
  let sectors;
  if (submit) submit.disabled = true;
  try {
    await Promise.allSettled(productionSectorRows().map(row => productionSectorOptions.get(row)?.promise));
    sectors = collectProductionSectors();
  } catch (error) {
    if (submit) submit.disabled = false;
    showToast(error.message, true);
    return;
  }
  payload.sectors = sectors;
  if (itemId) payload.removed_sector_ids = [...productionRemovedSectorIds];
  try {
    await apiRequest(itemId ? `/api/production/my-items/${itemId}` : '/api/production/my-items/batch', {
      method: itemId ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar a frente.', true);
    if (submit) submit.disabled = false;
    return;
  }
  closeModal('production-entry-modal');
  showToast(itemId ? 'Frente atualizada.' : `${sectors.length} ${sectors.length === 1 ? 'setor salvo' : 'setores salvos'} na frente.`);
  try {
    await refreshProductionPage(unit, { keepFilters: true });
  } catch (error) {
    console.error(error);
    showToast(PRODUCTION_REFRESH_WARNING, true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

function collectProductionSectors() {
  const rows = productionSectorRows();
  const status = selectedStatus();
  if (!status) throw new Error('Selecione o status da frente.');
  const seen = new Set();
  return rows.map(row => {
    const input = productionSectorField(row, 'sector');
    const sector = input.value.trim();
    if (!sector || seen.has(sector.toLocaleUpperCase('pt-BR'))) {
      input.focus();
      throw new Error(sector ? `O setor ${sector} está repetido nesta frente.` : 'Informe o setor.');
    }
    seen.add(sector.toLocaleUpperCase('pt-BR'));
    const section = productionSectorField(row, 'section');
    if (section.required && !section.value.trim()) {
      section.focus();
      throw new Error(`Confirme a seção do setor ${sector}.`);
    }
    const linkedItemId = row.dataset?.linkedItemId;
    const operation = productionEntryOperationValues(row).map(value => value.trim()).filter(Boolean).join(', ');
    return { sector, section: section.value.trim(),
      farm: productionSectorField(row, 'farm').value.trim(), status,
      ...(linkedItemId ? { id: Number(linkedItemId) } : {}),
      ...(operation || linkedItemId ? { operation } : {}) };
  });
}

async function removeProductionFront() {
  const itemId = productionEditingItemId;
  const item = findProductionItem(itemId);
  const submit = document.querySelector('#production-entry-submit');
  const button = document.querySelector('#production-remove-front');
  if (!item || !canFillProduction() || !submit || !button || submit.disabled) return;
  const unit = currentProductionUnit();
  const itemIds = new Set([itemId, ...productionRemovedSectorIds]);
  for (const row of productionSectorRows()) {
    if (row.dataset.linkedItemId) itemIds.add(Number(row.dataset.linkedItemId));
  }
  submit.disabled = true;
  button.disabled = true;
  try {
    if (!await askConfirmation({
      kicker: 'Produção Agrícola', title: 'Remover a frente inteira?',
      message: `Remover ${item.service_name} e todos os setores vinculados a este lançamento em ${productionUnitLabel(unit)}? O histórico será preservado.`,
      confirmLabel: 'Remover frente inteira'
    })) return;
    await apiRequest(`/api/production/my-items/${itemId}?scope=front`, {
      method: 'DELETE', body: JSON.stringify({ item_ids: [...itemIds] })
    });
    closeModal('production-entry-modal');
    showToast('Frente removida da unidade.');
    try {
      if (unit === currentProductionUnit()) await refreshProductionPage(unit, { keepFilters: true });
    } catch (error) {
      console.error(error);
      showToast(PRODUCTION_REFRESH_WARNING, true);
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível remover a frente.', true);
  } finally {
    submit.disabled = false;
    button.disabled = false;
  }
}

document.querySelector('#production-entry-form')?.addEventListener('submit', submitProductionEntry);
document.querySelector('#production-status-options')?.addEventListener('change', event => setSelectedStatus(event.target.value));

document.querySelector('#production-group-input')?.addEventListener('change', () => renderEntryFronts());

document.querySelector('#production-add-sector')?.addEventListener('click', () => addProductionSector());
document.querySelector('#production-remove-front')?.addEventListener('click', removeProductionFront);

document.querySelector('#production-sector-rows')?.addEventListener('click', event => {
  const row = event.target.closest('[data-production-sector-row]');
  if (!row) return;
  const button = event.target.closest('[data-remove-sector]');
  if (button && productionSectorRows().length > 1 && !document.querySelector('#production-entry-submit')?.disabled) {
    if (row.dataset.linkedItemId) productionRemovedSectorIds.add(Number(row.dataset.linkedItemId));
    productionSectorOptions.delete(row);
    clearProductionSectorScan(row);
    row.remove();
    updateProductionSectorRows();
    productionSectorField(productionSectorRows()[0], 'sector')?.focus();
    return;
  }
  if (event.target.closest('[data-retry-sector-scan]')) {
    scanProductionSector(row);
    return;
  }
  const add = event.target.closest('[data-entry-op-add]');
  const remove = event.target.closest('[data-entry-op-remove]');
  const suggestion = event.target.closest('[data-sector-operation]');
  if (!add && !remove && !suggestion) return;
  const operations = productionEntryOperationValues(row);
  if (remove) operations.splice(Number(remove.dataset.entryOpRemove), 1);
  else if (suggestion) {
    const code = suggestion.dataset.sectorOperation;
    if (operations.some(value => productionOperationKey(value) === productionOperationKey(code))) return;
    const blank = operations.findIndex(value => !value.trim());
    if (blank >= 0) operations[blank] = code;
    else if (operations.length < 10) operations.push(code);
    else return;
  } else if (operations.length < 10) operations.push('');
  renderEntryOperations(row, operations);
  renderProductionSectorWarning(row, operations.flatMap(splitProductionOperations));
  if (add) row.querySelector(`[data-entry-op="${operations.length - 1}"]`)?.focus();
});

document.querySelector('#production-sector-rows')?.addEventListener('input', event => {
  const row = event.target.closest('[data-production-sector-row]');
  if (!row) return;
  if (event.target.matches('[data-entry-op]')) {
    refreshProductionSectorWarning(row);
    return;
  }
  if (!event.target.matches('input[data-sector-field="sector"], input[data-sector-field="section"]')) return;
  productionSectorOptions.delete(row);
  clearProductionSectorScan(row);
});

document.querySelector('#production-sector-rows')?.addEventListener('change', async event => {
  const row = event.target.closest('[data-production-sector-row]');
  if (!row) return;
  const field = event.target.dataset.sectorField;
  const value = event.target.value;
  if (field === 'sector' || field === 'section') clearProductionSectorScan(row);
  if (productionEntryUsesSection()) {
    // Polo MS: a seção digitada refaz a lista de setores; o setor escolhido traz a fazenda.
    if (field === 'section') {
      const choices = renderProductionSectorChoices(row);
      productionSectorField(row, 'sector')?.focus();
      await choices;
    }
    if (field === 'sector') syncFarmFromSectorChoice(row);
  } else if (field === 'sector') await resolveSectorFromBase(row);
  else if (field === 'section') {
    const options = productionSectorOptions.get(row);
    if (Array.isArray(options)) productionSectorField(row, 'farm').value = options.find(item => item.section === value)?.farm || '';
  }
  if ((field === 'sector' || field === 'section') && row.isConnected && event.target.value === value) scanProductionSector(row);
});

document.querySelector('#production-entry-form')?.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.target instanceof HTMLTextAreaElement) return;
  if (event.target.closest('button')) return;
  event.preventDefault();
  if (event.target.matches('input[data-sector-field]')) event.target.blur();
  event.currentTarget.requestSubmit();
});
