const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const moduleKeys = ['dashboard','emission','sacarose','reports','returns','sectors','history','users'];

function context(role = 'admin') {
  const elements = new Map();
  for (const id of ['quick-user-form', 'quick-user-name', 'quick-user-password', 'quick-user-email', 'quick-user-role', 'quick-user-base-unit', 'quick-user-active', 'create-user-button', 'user-create-status']) {
    elements.set(`#${id}`, {
      value: '', textContent: '', disabled: false, listeners: {},
      classList: { toggle(name, enabled) { this[name] = enabled; }, remove(name) { this[name] = false; } },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      focus() { this.focused = true; }
    });
  }
  const moduleViews = moduleKeys.filter(key => key !== 'emission').map(key => ({ dataset:{moduleView:key}, checked:true, disabled:false }));
  const moduleEdits = moduleKeys.filter(key => !['emission','reports','history'].includes(key))
    .map(key => ({ dataset:{moduleEdit:key}, checked:true, disabled:false }));
  function mockAccessForm(form) {
    form.dataset = {};
    const master = {checked:true,disabled:false};
    const configure = {checked:false,disabled:false};
    const rows = ['PPT','NRD','RBR','PST'].map(unit => {
      const fill = {checked:true,disabled:false};
      const summary = {checked:true,disabled:false};
      const badge = {hidden:true};
      return {hidden:true,dataset:{productionUnitRow:unit},querySelector(selector) {
        if (selector === '[data-production-unit-fill]') return fill;
        if (selector === '[data-production-unit-summary]') return summary;
        if (selector === '[data-unit-base-label]') return badge;
        return null;
      }, fill, summary};
    });
    const options = rows.map(row => ({value:row.dataset.productionUnitRow,disabled:false}));
    const picker = {value:'PPT',querySelectorAll:()=>options,get selectedOptions(){return options.filter(option => option.value === this.value);}};
    const add = {disabled:false};
    const empty = {hidden:true};
    const selectors = {
      '[data-production-access-enabled]':master,'[data-production-access-configure]':configure,
      '[data-production-unit-picker]':picker,'[data-production-add-unit]':add,
      '[data-production-unit-empty]':empty
    };
    form.querySelector = selector => {
      const unit = selector.match(/^\[data-production-unit-row="([^"]+)"\]$/);
      if (unit) return rows.find(row => row.dataset.productionUnitRow===unit[1]) || null;
      const edit = selector.match(/^\[data-module-edit="([^"]+)"\]$/);
      if (edit) return moduleEdits.find(input => input.dataset.moduleEdit===edit[1]) || null;
      return selectors[selector] || null;
    };
    form.querySelectorAll = selector => {
      if (selector === '[data-production-unit-row]') return rows;
      if (selector === '[data-module-view]') return moduleViews;
      if (selector.includes('[data-production-unit-fill]')) return [configure,picker,add,...rows.flatMap(row=>[row.fill,row.summary])];
      if (selector === '[data-production-access-configure], [data-production-unit-picker], [data-production-add-unit], [data-production-unit-fill], [data-production-unit-summary], [data-production-remove-unit]') return [configure,picker,add,...rows.flatMap(row=>[row.fill,row.summary])];
      return [];
    };
    return {master,configure,rows,picker,add};
  }
  const form = elements.get('#quick-user-form');
  const production = mockAccessForm(form);
  form.querySelector = ((previous) => (selector) => {
    if (selector === '#quick-user-base-unit') return elements.get('#quick-user-base-unit');
    return previous(selector);
  })(form.querySelector);
  form.reset = () => {
    for (const key of ['quick-user-name', 'quick-user-password', 'quick-user-email']) elements.get(`#${key}`).value = '';
    elements.get('#quick-user-role').value = 'analyst';
    elements.get('#quick-user-base-unit').value = 'PPT';
    elements.get('#quick-user-active').value = 'active';
    production.master.checked = true;
    production.configure.checked = false;
    moduleViews.forEach(input=>input.checked=input.dataset.moduleView!=='users');
    moduleEdits.forEach(input=>input.checked=input.dataset.moduleEdit!=='users');
  };
  elements.set('#user-create-modal', { hidden: true });
  elements.set('#open-user-create', { focused: false, focus() { this.focused = true; }, listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; } });
  const requests = [];
  elements.get('#quick-user-role').value = 'analyst';
  elements.get('#quick-user-base-unit').value = 'PPT';
  elements.get('#quick-user-active').value = 'active';
  const ctx = vm.createContext({
    console: {error() {}},
    currentUser: { id: 1, role },
    window: { location: { search: '', href: 'https://test.invalid/usuarios' }, history: { replaceState() {} } },
    URLSearchParams,
    URL,
    requestAnimationFrame(callback) { callback(); },
    openModal(id) { elements.get(`#${id}`).hidden = false; },
    closeModal(id) { elements.get(`#${id}`).hidden = true; },
    document: {
      querySelector(selector) {
        if (selector === '#production-access-enabled, [data-production-access-enabled]') return productionEnabled;
        if (selector === '#production-access-fill, [data-production-access-fill]') return productionFill;
        return elements.get(selector) || null;
      },
      querySelectorAll(selector) {
        if (selector === '[data-production-access-unit]:checked') return productionUnits.filter(input => input.checked);
        if (selector === '[data-production-access-unit]') return productionUnits;
        if (selector.includes('[data-production-access-unit]')) return [productionFill, ...productionUnits];
        return [];
      }
    },
    apiRequest: async (url, options) => { requests.push({ url, options }); return {}; },
    showToast() {},
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    formatServerTimestamp: () => '06/10/2026',
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js/usuarios.js'), 'utf8'), ctx);
  return { ctx, elements, requests, productionUnits:production.rows, production, mockAccessForm, moduleViews, moduleEdits };
}

async function main() {
  const { ctx, elements, requests, productionUnits, mockAccessForm } = context();
  const name = elements.get('#quick-user-name');
  const password = elements.get('#quick-user-password');
  const submit = elements.get('#create-user-button');
  const status = elements.get('#user-create-status');
  const send = () => elements.get('#quick-user-form').listeners.submit({ preventDefault() {} });
  assert.equal(requests.length, 0, 'Cadastro não deve consultar a listagem');
  elements.get('#open-user-create').listeners.click();
  assert.equal(elements.get('#user-create-modal').hidden, false, 'Botão deve abrir modal');
  assert.equal(name.focused, true, 'Foco começa no campo de usuário');
  await send();
  assert.equal(requests.length, 0);
  assert.equal(status.textContent, 'Informe usuário e senha.');
  name.value = '  Operador Teste  ';
  password.value = 'test-password-42';
  elements.get('#quick-user-email').value = ' operador@example.com ';
  elements.get('#quick-user-role').value = 'coordinator';
  elements.get('#quick-user-base-unit').value = 'RBR';
  elements.get('#quick-user-base-unit').listeners.change({ target: elements.get('#quick-user-base-unit') });
  elements.get('#quick-user-active').value = 'inactive';
  await send();
  assert.equal(requests[0].url, '/api/users');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    name: 'Operador Teste', password: 'test-password-42', email: 'operador@example.com',
    role: 'coordinator', base_unit: 'RBR', is_active: false,
    production_access: { enabled: true, permissions: { view: true, fill: true, configure: false, summary: true }, units: ['RBR'],
      unit_permissions: {RBR:{view:true,fill:true,summary:true}} },
    module_access: Object.fromEntries(moduleKeys.map(key => [key, {view:key!=='users', edit:!['emission','reports','history','users'].includes(key)}]))
  });
  assert.equal(name.value, '');
  assert.equal(password.value, '');
  assert.equal(elements.get('#quick-user-email').value, '');
  assert.equal(elements.get('#quick-user-role').value, 'analyst');
  assert.equal(elements.get('#quick-user-active').value, 'active');
  assert.deepEqual(productionUnits.filter(row => !row.hidden).map(row => row.dataset.productionUnitRow), ['PPT']);
  assert.equal(elements.get('#open-user-create').focused, true);
  assert.equal(elements.get('#user-create-modal').hidden, true);
  assert.equal(submit.disabled, false);
  assert.equal(status.textContent, 'Usuário Operador Teste cadastrado com sucesso.');
  assert.equal(status.classList['is-error'], false);

  name.value = 'AdminPelaTela';
  password.value = 'test-password-42';
  elements.get('#quick-user-role').value = 'admin';
  const beforeAdminAttempt = requests.length;
  await send();
  assert.equal(requests.length, beforeAdminAttempt);
  assert(status.textContent.includes('Administradores não podem ser cadastrados por esta tela'));
  assert.equal(submit.disabled, false);
  elements.get('#quick-user-role').value = 'analyst';

  name.value = 'Duplicado';
  password.value = 'test-password-42';
  ctx.apiRequest = async () => { throw new Error('Usuário já cadastrado.'); };
  await send();
  assert.equal(status.textContent, 'Usuário já cadastrado.');
  assert.equal(status.classList['is-error'], true);
  assert.equal(name.value, 'Duplicado');
  assert.equal(submit.disabled, false);

  let finish;
  let calls = 0;
  ctx.apiRequest = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const pending = send();
  assert.equal(submit.disabled, true);
  await send();
  assert.equal(calls, 1, 'Impede envio duplicado durante a requisição');
  finish({});
  await pending;
  assert.equal(submit.disabled, false);

  const denied = context('user');
  denied.elements.get('#quick-user-name').value = 'Sem permissão';
  denied.elements.get('#quick-user-password').value = 'test-password-42';
  await denied.ctx.createQuickUser({ preventDefault() {} });
  assert.equal(denied.requests.length, 0);
  for (const [role, label] of [['admin','Administrador'], ['coordinator','Coordenador'], ['analyst','Analista'], ['user','Usuário padrão']]) {
    const html = ctx.userItemHtml({id:role==='admin'?1:2, name:'Teste', role, is_active:true, base_unit:'NRD', email:'teste@example.com'});
    assert(html.includes(label));
    assert(html.includes('Unidade base: NRD'));
    assert(html.includes('E-mail: teste@example.com'));
    if (role !== 'admin') assert(html.includes('>Desativar</button>'));
    if (role === 'admin') assert(!html.includes('data-user-action="delete"'));
  }
  assert.equal(ctx.userItemHtml({id:2, role:'admin', is_active:true}), '');
  assert.equal(ctx.userItemHtml({id:2, role:'admin', is_active:false}), '');
  assert(ctx.userItemHtml({id:2, role:'analyst', is_active:false}).includes('>Ativar</button>'));
  assert(!ctx.userItemHtml({id:1, role:'admin', is_active:true}).includes('data-user-action="toggle"'));
  assert(!ctx.userItemHtml({id:2, email:'<script>alert(1)</script>', base_unit:'<img>', role:'analyst'}).includes('<script>'));
  const managed = ctx.userItemHtml({id:2, name:'Analista', role:'analyst', is_active:true});
  assert(managed.includes('Gerenciar acessos'));
  assert(!managed.includes('user-access-panel'));
  assert(!managed.includes('Cadastrado em'));
  const updates = [];
  ctx.apiRequest = async (url, options) => { updates.push({url, options}); return {}; };
  for (const active of ['true', 'false']) {
    const button = {dataset:{userId:'2',active},disabled:false};
    await ctx.toggleUserActive(button);
    assert.equal(updates.at(-1).url, '/api/users/2/active');
    assert.equal(updates.at(-1).options.method, 'PUT');
    assert.deepEqual(JSON.parse(updates.at(-1).options.body), {is_active:active!=='true'});
  }
  const list = {innerHTML:'',querySelectorAll:()=>[]};
  elements.set('#users-list', list);
  ctx.apiRequest = async () => ({users:[
    {id:1,role:'admin',name:'MeuAdmin'},
    {id:2,role:'admin',name:'OutroAdmin',email:'oculto@example.com'},
    {id:3,role:'admin',name:'AdminInativo',is_active:false},
    {id:4,role:'analyst',name:'AnalistaVisivel'},
  ]});
  await ctx.loadUsers();
  assert(list.innerHTML.includes('MeuAdmin'));
  assert(list.innerHTML.includes('AnalistaVisivel'));
  assert(!list.innerHTML.includes('OutroAdmin'));
  assert(!list.innerHTML.includes('oculto@example.com'));
  assert(!list.innerHTML.includes('AdminInativo'));
  const accessForm = {hidden:true,dataset:{},listeners:{}, addEventListener(type,handler){this.listeners[type]=handler;},
    querySelector(selector) {if (selector === 'summary') return {focus(){}}; return null;} };
  const accessInputs = mockAccessForm(accessForm);
  const configuredModules = Object.fromEntries(
    ['dashboard','emission','sacarose','reports','returns','sectors','history','users'].map(key => [key, {view:true,edit:!['emission','reports','history'].includes(key)}])
  );
  // A edição usa a mesma configuração compartilhada do cadastro.
  const accessModal = {hidden:true};
  const accessLoading = {hidden:true, textContent:''};
  const accessSave = {disabled:false};
  const accessName = {textContent:''};
  const accessStatus = {textContent:''};
  const originalQuerySelector = ctx.document.querySelector;
  ctx.document.querySelector = selector => ({
    '#user-access-modal':accessModal, '#user-access-form':accessForm,
    '#user-access-loading':accessLoading, '#user-access-save':accessSave,
    '#user-access-modal-name':accessName, '#user-access-status':accessStatus
  })[selector] || originalQuerySelector(selector);
  ctx.openModal = () => { accessModal.hidden = false; };
  ctx.closeModal = () => { accessModal.hidden = true; };
  const accessRequests = [];
  ctx.apiRequest = async (url, options) => {
    accessRequests.push({url, options});
    if (url.endsWith('/access') && !options) return {access:{modules:configuredModules, production:{enabled:true, permissions:{view:true,fill:false,configure:false,summary:true},
      units:['NRD','RBR'],unit_permissions:{NRD:{view:true,fill:false,summary:true},RBR:{view:true,fill:false,summary:true}}}}};
    if (url === '/api/users') return {users:[]};
    return {};
  };
  await ctx.openAccessModal({dataset:{userId:'2'}, closest:() => ({dataset:{userBaseUnit:'NRD'},querySelector:() => ({textContent:'Analista'})})});
  assert.equal(accessModal.hidden, false);
  assert.equal(accessName.textContent, 'Analista');
  assert.equal(accessForm.hidden, false);
  assert.equal(accessInputs.master.checked, true);
  assert.equal(accessInputs.rows.find(row=>row.dataset.productionUnitRow==='NRD').fill.checked, false);
  assert.deepEqual(accessInputs.rows.filter(row=>!row.hidden).map(row=>row.dataset.productionUnitRow), ['NRD','RBR']);
  await ctx.saveAccessForm(accessForm);
  const savedAccess = accessRequests.find(request => request.options?.method === 'PUT');
  assert.equal(savedAccess.url, '/api/users/2/access');
  assert.deepEqual(JSON.parse(savedAccess.options.body), {access:{modules:configuredModules, production:{enabled:true, permissions:{view:true,fill:false,configure:false,summary:true}, units:['NRD','RBR'],
    unit_permissions:{NRD:{view:true,fill:false,summary:true},RBR:{view:true,fill:false,summary:true}}}}});
  assert.equal(accessModal.hidden, true);
  // Os painéis visuais não recriam campos nem alteram dados ao trocar de módulo.
  const panels = ['reports','ctt','production','emission','sectors','history','users'].map(key =>
    ({dataset:{permissionPanel:key},hidden:key!=='reports'}));
  const navs = panels.map(panel => ({dataset:{permissionTarget:panel.dataset.permissionPanel},
    attributes:{},classList:{toggle(name, on){this[name]=on;}},
    setAttribute(name, value){this.attributes[name]=value;},focus(){this.focused=true;}}));
  const picker = {value:'reports'};
  const workspace = {querySelectorAll(selector) {
      if (selector==='[data-permission-panel]') return panels;
      if (selector==='[data-permission-target]') return navs;
      return [];
    },querySelector(selector){if (selector==='[data-permission-picker]') return picker;return null;}};
  const stages = ['identity','permissions'].map(step => ({dataset:{userStep:step},hidden:step!=='identity'}));
  const steps = stages.map(stage => ({dataset:{userStepButton:stage.dataset.userStep},
    classList:{toggle(name,on){this[name]=on;}},setAttribute(){},removeAttribute(){}}));
  const back = {hidden:true}, next = {hidden:false}, create = {hidden:true}, help = {textContent:''};
  const invalidField = {checkValidity:()=>false,focus(){this.focused=true;},reportValidity(){this.reported=true;}};
  const uiForm = {querySelector(selector) {
    if (selector==='[data-permission-workspace]') return workspace;
    if (selector==='[data-user-step-next]') return next;
    if (selector==='[data-user-step-back]') return back;
    if (selector==='#create-user-button') return create;
    if (selector==='[data-user-step-help]') return help;
    if (selector==='[data-permission-target="reports"]') return navs[0];
    return null;
  }, querySelectorAll(selector) {
    if (selector==='[data-user-step]') return stages;
    if (selector==='[data-user-step-button]') return steps;
    if (selector==='.user-create-fields input, .user-create-fields select') return [invalidField];
    return [];
  }};
  ctx.selectPermissionPanel(uiForm,'production');
  assert.equal(panels.filter(panel=>!panel.hidden).length,1);
  assert.equal(panels.find(panel=>!panel.hidden).dataset.permissionPanel,'production');
  assert.equal(navs[2].attributes['aria-pressed'],'true');
  assert.equal(picker.value,'production');
  ctx.setCreateStep(uiForm,'permissions');
  assert.equal(stages[0].hidden,true);
  assert.equal(stages[1].hidden,false);
  assert.equal(next.hidden,true);
  assert.equal(create.hidden,false);
  assert.equal(ctx.validateCreateFields(uiForm),false);
  assert.equal(stages[0].hidden,false,'Dados inválidos voltam à primeira etapa');
  assert.equal(invalidField.focused,true);
  assert.equal(invalidField.reported,true);
  assert.equal(create.hidden,true);
  console.log('OK: cadastro, permissões, etapas, seleção de módulos e restrição administrativa.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
