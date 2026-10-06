const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function context(role = 'admin') {
  const elements = new Map();
  for (const id of ['quick-user-form', 'quick-user-name', 'quick-user-password', 'quick-user-email', 'quick-user-role', 'quick-user-base-unit', 'quick-user-active', 'create-user-button', 'user-create-status']) {
    elements.set(`#${id}`, {
      value: '', textContent: '', disabled: false, listeners: {},
      classList: { toggle(name, enabled) { this[name] = enabled; } },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      focus() { this.focused = true; }
    });
  }
  const requests = [];
  elements.get('#quick-user-role').value = 'analyst';
  elements.get('#quick-user-base-unit').value = 'PPT';
  elements.get('#quick-user-active').value = 'active';
  const ctx = vm.createContext({
    console: { error() {} },
    currentUser: { id: 1, role },
    document: { querySelector: selector => elements.get(selector) || null },
    apiRequest: async (url, options) => { requests.push({ url, options }); return {}; },
    showToast() {},
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    formatServerTimestamp: () => '06/10/2026',
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js/usuarios.js'), 'utf8'), ctx);
  return { ctx, elements, requests };
}

async function main() {
  const { ctx, elements, requests } = context();
  const name = elements.get('#quick-user-name');
  const password = elements.get('#quick-user-password');
  const submit = elements.get('#create-user-button');
  const status = elements.get('#user-create-status');
  const send = () => elements.get('#quick-user-form').listeners.submit({ preventDefault() {} });
  assert.equal(requests.length, 0, 'Cadastro não deve consultar a listagem');
  await send();
  assert.equal(requests.length, 0);
  assert.equal(status.textContent, 'Informe usuário e senha.');
  name.value = '  Operador Teste  ';
  password.value = 'test-password-42';
  elements.get('#quick-user-email').value = ' operador@example.com ';
  elements.get('#quick-user-role').value = 'coordinator';
  elements.get('#quick-user-base-unit').value = 'RBR';
  elements.get('#quick-user-active').value = 'inactive';
  await send();
  assert.equal(requests[0].url, '/api/users');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), { name: 'Operador Teste', password: 'test-password-42', email: 'operador@example.com', role: 'coordinator', base_unit: 'RBR', is_active: false });
  assert.equal(name.value, '');
  assert.equal(password.value, '');
  assert.equal(elements.get('#quick-user-email').value, '');
  assert.equal(elements.get('#quick-user-role').value, 'analyst');
  assert.equal(elements.get('#quick-user-active').value, 'active');
  assert.equal(name.focused, true);
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
  console.log('OK: cadastro separado, mensagens, erros, envio único e restrição administrativa.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
