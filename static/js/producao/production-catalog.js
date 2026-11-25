// Página "Cadastros" da Produção Agrícola (menu lateral): grupos, frentes/serviços,
// status e operações. Grupos, frentes e status usam producao/production-config.js;
// aqui ficam a abertura da página e o cadastro de operações (código da O.S.).
let productionOperations = [];
let productionResponsibilities = [];
let productionResponsibilityRoles = [];
let productionResponsibilityPermissions = {};
let productionResponsibilityUnit = '';
let productionResponsibilityState = 'loading';
let productionResponsibilityBatch = [];
const RESPONSIBILITY_SCHEDULE_FIELDS = ['kind', 'role_id', 'shift', 'work_date', 'responsible_name', 'relief_name',
  'responsible_whatsapp', 'relief_whatsapp'];

function productionCatalogPageActive() {
  return String(globalThis.location?.pathname || '').startsWith('/producao/cadastros');
}

function operationFrontOptions(selected = '') {
  const groups = Array.isArray(productionConfigCatalog.groups) ? productionConfigCatalog.groups : [];
  return '<option value="">Sem vínculo</option>' + groups.map(group => `<optgroup label="${escapeHtml(group.name)}">${
    (group.fronts || []).map(front => `<option value="${front.id}" ${String(front.id) === String(selected) ? 'selected' : ''}>${escapeHtml(front.name)}</option>`).join('')
  }</optgroup>`).join('');
}

function renderProductionOperations() {
  const list = document.querySelector('#production-operations-list');
  if (!list) return;
  const visible = productionOperations;
  const editable = canConfigureProduction();
  list.innerHTML = visible.map(item => `
    <div class="production-config-list-item ${item.is_active ? '' : 'is-inactive'}">
      <div class="production-config-list-item-copy">
        <strong>${escapeHtml(item.code)} — ${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.front_name || 'Sem frente vinculada')}${item.in_use ? ' · em uso' : ''}${item.is_active ? '' : ' · inativa'}</span>
      </div>
      ${editable ? `<div class="production-config-list-actions">
        <button class="icon-edit-button" type="button" data-operation-action="edit" data-operation-id="${item.id}" title="Editar" aria-label="Editar operação ${escapeHtml(item.code)}">${PENCIL_ICON}</button>
        <button class="is-delete icon-delete-button" type="button" data-operation-action="delete" data-operation-id="${item.id}" title="Apagar" aria-label="Apagar operação ${escapeHtml(item.code)}">${TRASH_ICON}</button>
      </div>` : ''}
    </div>`).join('') || '<div class="production-empty"><span>Nenhuma operação cadastrada. Importe as O.S. ou cadastre manualmente.</span></div>';
}

async function loadProductionOperations() {
  const data = await apiRequest('/api/production/operations?include_inactive=1');
  productionOperations = Array.isArray(data?.operations) ? data.operations : [];
  renderProductionOperations();
}

function clearOperationForm({ keepOpen = false } = {}) {
  document.querySelector('#production-operation-form')?.reset();
  document.querySelector('#production-operation-id').value = '';
  const front = document.querySelector('#production-operation-front');
  if (front) front.innerHTML = operationFrontOptions();
  document.querySelector('#production-operation-editor-title').textContent = 'Nova operação';
  document.querySelector('#production-operation-submit').textContent = 'Adicionar operação';
  const editor = document.querySelector('#production-operation-editor');
  if (editor && !keepOpen) editor.open = false;
}

function editProductionOperation(operationId) {
  const item = productionOperations.find(operation => Number(operation.id) === Number(operationId));
  if (!item) return;
  document.querySelector('#production-operation-id').value = item.id;
  document.querySelector('#production-operation-code').value = item.code;
  document.querySelector('#production-operation-name').value = item.name;
  document.querySelector('#production-operation-front').innerHTML = operationFrontOptions(item.service_front_id ?? '');
  document.querySelector('#production-operation-position').value = item.position;
  document.querySelector('#production-operation-active').checked = item.is_active;
  document.querySelector('#production-operation-editor-title').textContent = `Editar operação ${item.code}`;
  document.querySelector('#production-operation-submit').textContent = 'Salvar alterações';
  const editor = document.querySelector('#production-operation-editor');
  if (editor) editor.open = true;
  document.querySelector('#production-operation-name')?.focus();
}

async function submitProductionOperation(event) {
  event.preventDefault();
  const id = document.querySelector('#production-operation-id').value;
  const payload = {
    code: document.querySelector('#production-operation-code').value.trim(),
    name: document.querySelector('#production-operation-name').value.trim(),
    service_front_id: document.querySelector('#production-operation-front').value || null,
    position: Number(document.querySelector('#production-operation-position').value || 0),
    is_active: document.querySelector('#production-operation-active').checked
  };
  try {
    await apiRequest(id ? `/api/production/operations/${id}` : '/api/production/operations', {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(payload)
    });
    showToast(id ? 'Operação atualizada.' : 'Operação cadastrada.');
    clearOperationForm();
    await loadProductionOperations();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar a operação.', true);
  }
}

async function deleteProductionOperation(operationId) {
  const item = productionOperations.find(operation => Number(operation.id) === Number(operationId));
  if (!item || !await askConfirmation({
    kicker: 'Cadastros', title: `Apagar a operação ${item.code}?`,
    message: 'Operações já usadas em lançamentos não podem ser apagadas; nesse caso, inative-as.',
    confirmLabel: 'Apagar operação'
  })) return;
  try {
    await apiRequest(`/api/production/operations/${item.id}`, { method: 'DELETE' });
    showToast('Operação apagada.');
    await loadProductionOperations();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível apagar a operação.', true);
  }
}

function canEditProductionResponsibility(action) {
  return productionResponsibilityState === 'ready' && productionResponsibilityUnit === currentProductionUnit()
    && Boolean(productionResponsibilityPermissions[action]);
}

function renderProductionResponsibilityControls() {
  document.querySelectorAll('[data-responsibility-permission]').forEach(control => {
    const allowed = canEditProductionResponsibility(control.dataset.responsibilityPermission);
    if (control.tagName === 'BUTTON') {
      control.disabled = !allowed;
    } else {
      control.hidden = !allowed;
      if (!allowed && control.open) control.open = false;
    }
  });
  const feedback = document.querySelector('#production-responsibility-feedback');
  const status = document.querySelector('#production-responsibility-status');
  const retry = document.querySelector('#production-responsibility-retry');
  if (!feedback || !status || !retry) return;
  const schedules = canEditProductionResponsibility('edit_schedules');
  const roles = canEditProductionResponsibility('edit_roles');
  const messages = {
    loading: 'Carregando responsáveis e cargos…',
    error: 'Não foi possível carregar responsáveis e cargos.',
    ready: schedules && roles ? '' : schedules ? 'Seu perfil pode cadastrar responsáveis e consultar os cargos.'
      : roles ? 'Seu perfil pode cadastrar cargos e consultar os responsáveis.' : 'Seu perfil tem acesso de consulta a responsáveis e cargos.'
  };
  status.textContent = messages[productionResponsibilityState];
  feedback.hidden = !status.textContent;
  retry.hidden = productionResponsibilityState !== 'error';
}

function renderProductionResponsibilityRoles() {
  const list = document.querySelector('#production-responsibility-roles-list');
  if (!list) return;
  const editable = canEditProductionResponsibility('edit_roles');
  list.innerHTML = productionResponsibilityRoles.map(role => `<div class="production-config-list-item">
    <div class="production-config-list-item-copy"><strong>${escapeHtml(role.name)}</strong>
      <span>${role.role_type === 'lead' ? 'Responsável pelo turno' : 'Apoio à frente'}</span></div>
    ${editable ? `<div class="production-config-list-actions" data-responsibility-actions>
      <button class="icon-edit-button" type="button" data-responsibility-role-edit="${role.id}" title="Editar cargo" aria-label="Editar ${escapeHtml(role.name)}">${PENCIL_ICON}</button>
    </div>` : ''}</div>`).join('') || '<p class="production-empty">Nenhum cargo cadastrado.</p>';
}

function openProductionResponsibilityRoleForm(role = null, { keepOpen = false } = {}) {
  const form = document.querySelector('#production-responsibility-role-form');
  if (!form) return;
  form.reset();
  form.elements.role_id.value = role?.id ?? '';
  form.elements.name.value = role?.name ?? '';
  form.elements.role_type.value = role?.role_type ?? '';
  document.querySelector('#production-responsibility-role-title').textContent = role ? 'Editar cargo' : 'Cadastrar cargo';
  document.querySelector('#production-responsibility-role-editor').open = keepOpen;
}

async function submitProductionResponsibilityRole(event) {
  event.preventDefault();
  if (!canEditProductionResponsibility('edit_roles')) return;
  const form = event.currentTarget;
  const { role_id: id, name, role_type } = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  try {
    await apiRequest(`/api/production/catalog/responsibility-roles${id ? `/${id}` : ''}`, {
      method: id ? 'PUT' : 'POST', body: JSON.stringify({ name, role_type })
    });
    openProductionResponsibilityRoleForm();
    await loadProductionResponsibilities();
    const roles = document.querySelector('#production-responsibility-roles');
    if (roles && productionResponsibilityState === 'ready') roles.open = true;
    showToast('Cargo salvo.');
  } catch (error) {
    showToast(error.message || 'Não foi possível salvar o cargo.', true);
  } finally {
    button.disabled = false;
  }
}

function groupedResponsibilityRules() {
  const groups = new Map();
  for (const rule of productionResponsibilities) {
    const key = JSON.stringify(RESPONSIBILITY_SCHEDULE_FIELDS.map(field => rule[field]));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rule);
  }
  return [...groups.values()].sort(([first], [second]) => first.responsible_name.localeCompare(second.responsible_name, 'pt-BR'));
}

function renderProductionResponsibilities() {
  const list = document.querySelector('#production-responsibilities-list');
  if (!list) return;
  const editable = canEditProductionResponsibility('edit_schedules');
  list.innerHTML = groupedResponsibilityRules().map(rules => {
    const [rule] = rules;
    const grouped = rules.length > 1;
    const date = formatIsoDateBr(rule.work_date);
    const details = {
      replacement: `Substituição em ${date}`,
      day_off: `Folga em ${date}`,
      fixed: `Fixo · Início em ${date}`,
      cycle: `Ciclo 5×1 · Início em ${date} · Folguista ${rule.relief_name || 'sem cobertura'}`
    }[rule.kind];
    const reliefWhatsapp = rule.kind === 'cycle' ? whatsappLinkHtml(rule.relief_whatsapp, rule.relief_name, true) : '';
    const fronts = rules.map(front => `<div class="catalog-responsibility-front-row">
      <span>${escapeHtml(front.service_name)}</span>
      ${editable ? `<div class="catalog-responsibility-front-actions" data-responsibility-actions>
        ${grouped ? `<button class="production-inline-text-button" type="button" data-responsibility-edit="${front.id}" aria-label="Editar escala de ${escapeHtml(front.service_name)}">Editar só esta</button>` : ''}
        <button class="production-inline-text-button" type="button" data-responsibility-delete="${front.id}" aria-label="Remover escala de ${escapeHtml(front.service_name)}">Remover</button>
      </div>` : ''}</div>`).join('');
    return `<article class="production-config-list-item catalog-responsibility-record">
      <header class="catalog-responsibility-record-header">
        <div class="production-config-list-item-copy"><strong>${escapeHtml(rule.responsible_name || 'Folga sem cobertura')}${whatsappLinkHtml(rule.responsible_whatsapp, rule.responsible_name, true)}</strong>
          <span>${escapeHtml(rule.role_name)} · Turno ${escapeHtml(rule.shift)} · ${escapeHtml(details)}${reliefWhatsapp}</span>
        </div>
        ${editable ? `<button class="production-secondary-button" type="button" ${grouped ? 'data-responsibility-group-edit' : 'data-responsibility-edit'}="${rule.id}">${grouped ? 'Editar em conjunto' : 'Editar escala'}</button>` : ''}
      </header>
      ${grouped ? `<details class="catalog-responsibility-front-list"><summary>${rules.length} frentes</summary>${fronts}</details>` : fronts}
    </article>`;
  }).join('') || '<p class="production-empty">Nenhuma escala cadastrada nesta unidade.</p>';
}

async function loadProductionResponsibilities(unit = currentProductionUnit()) {
  if (unit !== currentProductionUnit()) return;
  const epoch = productionPageEpoch;
  productionResponsibilityState = 'loading';
  if (productionResponsibilityUnit !== unit) {
    productionResponsibilities = [];
    productionResponsibilityRoles = [];
    productionResponsibilityPermissions = {};
    productionResponsibilityUnit = '';
  }
  renderProductionResponsibilityControls();
  renderProductionResponsibilityRoles();
  renderProductionResponsibilities();
  try {
    const data = await apiRequest(`/api/production/catalog/responsibilities?unit=${encodeURIComponent(unit)}`);
    if (!isCurrentProductionRequest(unit, epoch)) return;
    if (!Array.isArray(data?.rules) || !Array.isArray(data?.roles)
      || typeof data.permissions?.edit_schedules !== 'boolean' || typeof data.permissions?.edit_roles !== 'boolean') {
      throw new Error('Resposta incompleta do cadastro de responsáveis.');
    }
    productionResponsibilities = data.rules;
    productionResponsibilityRoles = data.roles;
    productionResponsibilityPermissions = data.permissions;
    productionResponsibilityUnit = unit;
    productionResponsibilityState = 'ready';
  } catch (error) {
    if (!isCurrentProductionRequest(unit, epoch)) return;
    console.warn(error);
    productionResponsibilityState = 'error';
  }
  renderProductionResponsibilityControls();
  renderProductionResponsibilityRoles();
  renderProductionResponsibilities();
}

function updateProductionResponsibilityFields(form) {
  const kind = form.elements.kind.value;
  const cycle = kind === 'cycle';
  document.querySelector('#production-responsibility-date-label').textContent = {
    cycle: 'Primeiro dia de trabalho', fixed: 'Válido a partir de', replacement: 'Data da substituição', day_off: 'Data da folga'
  }[kind];
  document.querySelector('#production-responsibility-name-label').textContent = {
    cycle: 'Titular', fixed: 'Pessoa escalada', replacement: 'Substituto', day_off: 'Quem cobre a folga (opcional)'
  }[kind];
  form.elements.responsible_name.required = kind !== 'day_off';
  document.querySelector('#production-responsibility-whatsapp-label').textContent = {
    cycle: 'WhatsApp do titular (opcional)', fixed: 'WhatsApp (opcional)', replacement: 'WhatsApp do substituto (opcional)',
    day_off: 'WhatsApp de quem cobre (opcional)'
  }[kind];
  document.querySelector('#production-responsibility-relief').hidden = !cycle;
  form.elements.relief_name.disabled = !cycle;
  document.querySelector('#production-responsibility-relief-whatsapp').hidden = !cycle;
  form.elements.relief_whatsapp.disabled = !cycle;
}

let productionResponsibilityFrontRequest = 0;

function updateResponsibilityFrontSummary(form) {
  const selected = form.querySelectorAll('#production-responsibility-fronts input:checked');
  form.querySelector('#production-responsibility-front-summary').textContent = selected.length === 1
    ? selected[0].nextElementSibling.textContent
    : selected.length ? `${selected.length} frentes selecionadas` : 'Selecione';
}

function renderResponsibilityFrontChoices(form, groups, selected = null) {
  const choices = form.querySelector('#production-responsibility-fronts');
  const picker = form.querySelector('#production-responsibility-front-picker');
  const type = form.elements.rule_id.value ? 'radio' : 'checkbox';
  picker.open = false;
  choices.innerHTML = groups.filter(group => group.is_active !== false).map(group => {
    const fronts = (group.fronts || []).filter(front => front.is_active !== false);
    return fronts.length ? `<div><strong>${escapeHtml(group.name)}</strong>${fronts.map(front => `
      <label><input type="${type}" name="service_front_id" value="${escapeHtml(front.id)}"${front.id === selected ? ' checked' : ''} />
        <span>${escapeHtml(front.name)}</span></label>`).join('')}</div>` : '';
  }).join('');
  updateResponsibilityFrontSummary(form);
  return Boolean(choices.innerHTML);
}

function showResponsibilityUnitStatus(message = '') {
  const status = document.querySelector('#production-responsibility-unit-status');
  status.textContent = message;
  status.hidden = !message;
}

async function changeProductionResponsibilityUnit(event) {
  const form = event.currentTarget.form;
  const unit = event.currentTarget.value;
  const request = ++productionResponsibilityFrontRequest;
  const submit = form.querySelector('button[type="submit"]');
  form.dataset.scheduleUnit = '';
  submit.disabled = true;
  renderResponsibilityFrontChoices(form, []);
  showResponsibilityUnitStatus('Carregando frentes da unidade…');
  try {
    let groups = groupsForEntry();
    if (unit !== currentProductionUnit()) {
      const query = encodeURIComponent(unit);
      const [catalog, schedules] = await Promise.all([
        apiRequest(`/api/production/catalog?unit=${query}`),
        apiRequest(`/api/production/catalog/responsibilities?unit=${query}`)
      ]);
      if (request !== productionResponsibilityFrontRequest || form.dataset.unit !== currentProductionUnit()) return;
      if (!schedules.permissions?.edit_schedules) {
        showResponsibilityUnitStatus('Seu perfil tem acesso de consulta nesta unidade.');
        return;
      }
      groups = Array.isArray(catalog.groups) ? catalog.groups : [];
    }
    const hasFronts = renderResponsibilityFrontChoices(form, groups);
    form.dataset.scheduleUnit = unit;
    submit.disabled = !hasFronts;
    showResponsibilityUnitStatus(submit.disabled ? 'Nenhuma frente cadastrada nesta unidade.' : '');
  } catch (error) {
    if (request === productionResponsibilityFrontRequest) showResponsibilityUnitStatus(error.message || 'Não foi possível carregar as frentes.');
  }
}

function openProductionResponsibilityForm(rule = null, { keepOpen = false, batch = [] } = {}) {
  const form = document.querySelector('#production-responsibility-form');
  if (!form) return;
  const fields = form.elements;
  ++productionResponsibilityFrontRequest;
  form.reset();
  productionResponsibilityBatch = batch;
  form.dataset.unit = currentProductionUnit();
  form.dataset.scheduleUnit = form.dataset.unit;
  fields.rule_id.value = rule?.id ?? '';
  fields.unit_code.innerHTML = allowedProductionUnits().map(unit => `<option value="${escapeHtml(unit)}">${escapeHtml(productionUnitLabel(unit))}</option>`).join('');
  fields.unit_code.value = form.dataset.unit;
  fields.unit_code.disabled = Boolean(rule);
  fields.role_id.innerHTML = '<option value="">Selecione</option>' + productionResponsibilityRoles.map(role =>
    `<option value="${role.id}">${escapeHtml(role.name)}</option>`).join('');
  const editingBatch = batch.length > 0;
  const hasFronts = renderResponsibilityFrontChoices(form, editingBatch ? [] : groupsForEntry(), rule?.service_front_id) || editingBatch;
  const selectedFronts = form.querySelector('#production-responsibility-batch-fronts');
  selectedFronts.hidden = !editingBatch;
  selectedFronts.textContent = batch.map(item => item.service_name).join(', ');
  form.querySelector('#production-responsibility-front-picker').hidden = editingBatch;
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = !hasFronts;
  submit.textContent = editingBatch ? `Salvar para ${batch.length} frentes` : 'Salvar';
  showResponsibilityUnitStatus(hasFronts ? '' : 'Nenhuma frente cadastrada nesta unidade.');
  if (rule) {
    for (const key of RESPONSIBILITY_SCHEDULE_FIELDS) {
      fields[key].value = key.endsWith('whatsapp') ? formatWhatsapp(rule[key]) : rule[key] ?? '';
    }
  }
  document.querySelector('#production-responsibility-title').textContent = editingBatch ? `Editar escala · ${batch.length} frentes`
    : rule ? 'Editar escala' : 'Cadastrar responsável';
  updateProductionResponsibilityFields(form);
  document.querySelector('#production-responsibility-editor').open = keepOpen;
}

async function submitProductionResponsibility(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = form.elements;
  const unit = fields.unit_code.value;
  if (!canEditProductionResponsibility('edit_schedules') || form.dataset.unit !== currentProductionUnit()
    || !unit || form.dataset.scheduleUnit !== unit) return;
  const id = fields.rule_id.value;
  const batch = productionResponsibilityBatch;
  const editingBatch = batch.length > 0;
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  const data = new FormData(form);
  const frontIds = data.getAll('service_front_id').map(Number);
  if (!editingBatch && !frontIds.length) {
    showToast('Selecione pelo menos uma frente ou serviço.', true);
    form.querySelector('#production-responsibility-front-picker').open = true;
    form.querySelector('#production-responsibility-fronts input')?.focus();
    return;
  }
  const payload = { ...Object.fromEntries(data), unit_code: unit };
  if (editingBatch) {
    payload.targets = batch.map(({ id, service_front_id }) => ({ id, service_front_id }));
    payload.previous = Object.fromEntries(RESPONSIBILITY_SCHEDULE_FIELDS.map(field => [field, batch[0][field]]));
  } else if (!id) {
    delete payload.service_front_id;
    payload.service_front_ids = frontIds;
  }
  const request = ++productionResponsibilityFrontRequest;
  fields.unit_code.disabled = true;
  button.disabled = true;
  try {
    await apiRequest(`/api/production/catalog/responsibilities${id && !editingBatch ? `/${id}` : ''}`, {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(payload)
    });
    const count = editingBatch ? batch.length : frontIds.length;
    const message = count === 1 ? `Escala salva em ${productionUnitLabel(unit)}.`
      : `Escala salva para ${count} frentes em ${productionUnitLabel(unit)}.`;
    const future = payload.work_date > saoPauloIsoDate() ? ` Vigência programada para ${formatIsoDateBr(payload.work_date)}.` : '';
    showToast(message + future);
    if (request === productionResponsibilityFrontRequest) openProductionResponsibilityForm();
    if (unit === currentProductionUnit()) {
      await loadProductionResponsibilities(unit);
    }
  } catch (error) {
    showToast(error.message || 'Não foi possível salvar a escala.', true);
  } finally {
    if (request === productionResponsibilityFrontRequest) {
      fields.unit_code.disabled = Boolean(id);
      button.disabled = false;
    }
  }
}

async function removeProductionResponsibility(rule) {
  const unit = productionResponsibilityUnit;
  if (unit !== currentProductionUnit() || !await askConfirmation({
    kicker: 'Responsáveis por frente', title: 'Remover escala desta frente?',
    message: [rule.service_name, rule.responsible_name, rule.role_name, `Turno ${rule.shift}`].filter(Boolean).join(' · '),
    confirmLabel: 'Remover'
  })) return;
  try {
    await apiRequest(`/api/production/catalog/responsibilities/${rule.id}?unit=${encodeURIComponent(unit)}`, { method: 'DELETE' });
    if (unit === currentProductionUnit()) await loadProductionResponsibilities(unit);
    showToast('Escala removida.');
  } catch (error) {
    showToast(error.message || 'Não foi possível remover a escala.', true);
  }
}

async function initializeProductionCatalogPage() {
  const editable = canConfigureProduction();
  const readonly = document.querySelector('#production-catalog-readonly');
  if (readonly) readonly.hidden = editable;
  // Sem a configuração global, a página só consulta: os formulários ficam ocultos.
  document.querySelectorAll('.catalog-editor:not([data-responsibility-permission]), #production-catalog-panel .catalog-new:not([data-responsibility-permission])')
    .forEach(element => { element.hidden = !editable; });
  document.querySelector('#production-catalog-panel')?.classList.toggle('is-readonly', !editable);
  const tasks = [loadProductionOperations(), loadProductionResponsibilities()];
  if (editable) {
    tasks.push(loadProductionConfigCatalog().then(() => {
      clearGroupConfigForm();
      clearFrontConfigForm();
      clearOperationForm();
      renderProductionOperations();
    }));
    tasks.push(loadProductionConfigStatuses().then(() => clearStatusConfigForm()));
  } else {
    productionConfigCatalog = productionCatalog;
    renderProductionConfigLists();
    productionConfigStatuses = productionStatuses;
    renderProductionStatusConfigList();
  }
  const results = await Promise.allSettled(tasks);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) showToast(failed.reason?.message || 'Não foi possível carregar os cadastros.', true);
}

document.querySelector('#production-operation-form')?.addEventListener('submit', submitProductionOperation);
document.querySelector('#production-operation-clear')?.addEventListener('click', () => clearOperationForm());
document.querySelector('#production-operations-list')?.addEventListener('click', event => {
  const button = event.target.closest('[data-operation-action]');
  if (!button) return;
  if (button.dataset.operationAction === 'edit') editProductionOperation(button.dataset.operationId);
  if (button.dataset.operationAction === 'delete') deleteProductionOperation(button.dataset.operationId);
});
// ---- Abas, contadores, busca e botão "Novo" -------------------------------
const CATALOG_TAB_KEY = 'posicao-campo-production-catalog-tab';
const CATALOG_EDITOR_IDS = {
  groups: '#production-group-editor',
  operations: '#production-operation-editor', status: '#production-status-editor',
  responsibilities: '#production-responsibility-editor', 'responsibility-roles': '#production-responsibility-role-editor'
};
const CATALOG_NEW_ACTIONS = {
  groups: () => clearGroupConfigForm({ keepOpen: true }),
  operations: () => clearOperationForm({ keepOpen: true }),
  status: () => clearStatusConfigForm({ keepOpen: true }),
  responsibilities: () => openProductionResponsibilityForm(null, { keepOpen: true }),
  'responsibility-roles': () => openProductionResponsibilityRoleForm(null, { keepOpen: true })
};

function selectCatalogTab(tab) {
  if (tab === 'responsibility-roles') {
    tab = 'responsibilities';
    const roles = document.querySelector('#production-responsibility-roles');
    if (roles) roles.open = true;
  }
  const sections = [...document.querySelectorAll('[data-catalog-section]')];
  if (!sections.some(section => section.dataset.catalogSection === tab)) tab = 'groups';
  document.querySelectorAll('[data-catalog-tab]').forEach(button => {
    const active = button.dataset.catalogTab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  sections.forEach(section => { section.hidden = section.dataset.catalogSection !== tab; });
  try { localStorage.setItem(CATALOG_TAB_KEY, tab); } catch (_) { /* preferência opcional */ }
}

// Busca simples sobre os itens já desenhados de cada lista.
function applyCatalogSearch(key) {
  if (key === 'groups') {
    renderProductionConfigGroups();
    return;
  }
  const term = String(document.querySelector(`[data-catalog-search="${key}"]`)?.value || '').trim().toLocaleLowerCase('pt-BR');
  const list = document.querySelector(`[data-catalog-list="${key}"]`);
  if (!list) return;
  let visible = 0;
  list.querySelectorAll('.production-config-list-item').forEach(item => {
    const match = !term || item.textContent.toLocaleLowerCase('pt-BR').includes(term);
    item.hidden = !match;
    if (match) visible += 1;
  });
  let empty = list.querySelector('.catalog-search-empty');
  if (term && !visible && list.querySelector('.production-config-list-item')) {
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'production-empty catalog-search-empty';
      empty.textContent = 'Nada encontrado nesta busca.';
      list.appendChild(empty);
    }
  } else {
    empty?.remove();
  }
}

function updateCatalogCount(key) {
  const count = document.querySelector(`[data-catalog-count="${key}"]`);
  const list = document.querySelector(`[data-catalog-list="${key}"]`);
  if (count && list) count.textContent = String(list.querySelectorAll('.production-config-list-item').length);
}

if (productionCatalogPageActive()) {
  document.addEventListener('production-page-ready', initializeProductionCatalogPage);
  const responsibilityForm = document.querySelector('#production-responsibility-form');
  responsibilityForm?.addEventListener('submit', submitProductionResponsibility);
  responsibilityForm?.elements?.kind?.addEventListener('change', () => updateProductionResponsibilityFields(responsibilityForm));
  responsibilityForm?.elements?.unit_code?.addEventListener('change', changeProductionResponsibilityUnit);
  const frontPicker = responsibilityForm?.querySelector('#production-responsibility-front-picker');
  frontPicker?.addEventListener('change', () => updateResponsibilityFrontSummary(responsibilityForm));
  frontPicker?.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !frontPicker.open) return;
    event.stopPropagation();
    frontPicker.open = false;
    frontPicker.querySelector('summary').focus();
  });
  responsibilityForm?.addEventListener('click', event => {
    if (frontPicker?.open && !frontPicker.contains(event.target)) frontPicker.open = false;
  });
  document.querySelector('#production-responsibility-clear')?.addEventListener('click', () => openProductionResponsibilityForm());
  document.querySelector('#production-responsibility-retry')?.addEventListener('click', () => loadProductionResponsibilities());
  document.querySelector('#production-responsibility-role-form')?.addEventListener('submit', submitProductionResponsibilityRole);
  document.querySelector('#production-responsibility-role-clear')?.addEventListener('click', () => openProductionResponsibilityRoleForm());
  document.querySelector('#production-responsibility-roles-list')?.addEventListener('click', event => {
    const button = event.target.closest('[data-responsibility-role-edit]');
    if (!button || !canEditProductionResponsibility('edit_roles')) return;
    const role = productionResponsibilityRoles.find(item => item.id === Number(button.dataset.responsibilityRoleEdit));
    if (role) openProductionResponsibilityRoleForm(role, { keepOpen: true });
  });
  document.querySelector('#production-responsibilities-list')?.addEventListener('click', event => {
    const button = event.target.closest('[data-responsibility-group-edit], [data-responsibility-edit], [data-responsibility-delete]');
    if (!button || !canEditProductionResponsibility('edit_schedules')) return;
    if (button.dataset.responsibilityGroupEdit) {
      const batch = groupedResponsibilityRules().find(([rule]) => rule.id === Number(button.dataset.responsibilityGroupEdit));
      if (batch) openProductionResponsibilityForm(batch[0], { keepOpen: true, batch });
      return;
    }
    const id = Number(button.dataset.responsibilityEdit || button.dataset.responsibilityDelete);
    const rule = productionResponsibilities.find(item => item.id === id);
    if (!rule) return;
    if (button.dataset.responsibilityEdit) openProductionResponsibilityForm(rule, { keepOpen: true });
    else removeProductionResponsibility(rule);
  });
  let savedTab = 'groups';
  try { savedTab = localStorage.getItem(CATALOG_TAB_KEY) || 'groups'; } catch (_) { /* sem armazenamento */ }
  selectCatalogTab(savedTab);
  document.querySelectorAll('[data-catalog-tab]').forEach(button => {
    button.addEventListener('click', () => selectCatalogTab(button.dataset.catalogTab));
  });
  document.querySelectorAll('[data-catalog-search]').forEach(input => {
    input.addEventListener('input', () => applyCatalogSearch(input.dataset.catalogSearch));
  });
  document.querySelectorAll('[data-catalog-new]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.catalogNew;
      if (button.dataset.responsibilityPermission && !canEditProductionResponsibility(button.dataset.responsibilityPermission)) return;
      CATALOG_NEW_ACTIONS[key]?.();
      const editor = document.querySelector(CATALOG_EDITOR_IDS[key]);
      if (editor) editor.open = true;
      editor?.querySelector('input:not([type="hidden"]), select')?.focus();
    });
  });
  // Formulários de "Novo"/"Editar" abrem como popup simples: fecha no ×, no Esc ou fora do quadro.
  const CANCEL_BUTTONS = {
    'production-group-editor': '#production-group-clear', 'production-front-editor': '#production-front-clear',
    'production-operation-editor': '#production-operation-clear', 'production-status-editor': '#production-status-clear',
    'production-responsibility-editor': '#production-responsibility-clear',
    'production-responsibility-role-editor': '#production-responsibility-role-clear'
  };
  const closeCatalogEditor = editor => {
    document.querySelector(CANCEL_BUTTONS[editor.id])?.click();
    editor.open = false;
  };
  document.querySelectorAll('.catalog-editor').forEach(editor => {
    // O popup fica direto no <body> para cobrir a tela inteira (fora das seções da página).
    document.body.appendChild(editor);
    const summary = editor.querySelector('summary');
    summary?.setAttribute('role', 'heading');
    summary?.addEventListener('click', event => event.preventDefault());
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'catalog-editor-close';
    close.setAttribute('aria-label', 'Fechar');
    close.textContent = '×';
    close.addEventListener('click', event => { event.preventDefault(); closeCatalogEditor(editor); });
    summary?.appendChild(close);
    editor.addEventListener('mousedown', event => { if (event.target === editor) closeCatalogEditor(editor); });
    editor.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCatalogEditor(editor); }
    });
    editor.addEventListener('toggle', () => {
      document.body.classList.toggle('modal-open', Boolean(document.querySelector('.catalog-editor[open]')));
      if (editor.open) requestAnimationFrame(() => editor.querySelector('input:not([type="hidden"]), select')?.focus());
    });
  });
  // "Cancelar" fecha o formulário em todas as abas (na frente, o botão antigo só limpava).
  document.querySelector('#production-front-clear')?.addEventListener('click', () => {
    const editor = document.querySelector('#production-front-editor');
    if (editor) editor.open = false;
  });
  // Contador e busca acompanham cada redesenho das listas.
  if (typeof MutationObserver === 'function') {
    document.querySelectorAll('[data-catalog-list]').forEach(list => {
      const key = list.dataset.catalogList;
      new MutationObserver(() => { updateCatalogCount(key); applyCatalogSearch(key); }).observe(list, { childList: true });
    });
  }
}
