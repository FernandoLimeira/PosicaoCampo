// Testes do comportamento do formulário sem dependências JavaScript externas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createLogin() {
  const elements = new Map();
  for (const id of ['login-form', 'auth-error', 'submit-button', 'password',
    'toggle-password', 'remember-me', 'name', 'eye-show', 'eye-hide']) {
    elements.set(`#${id}`, {
      value: '', checked: false, hidden: false, disabled: false,
      type: id === 'password' ? 'password' : '', attributes: {}, listeners: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(event, listener) { this.listeners[event] = listener; }
    });
  }
  const requests = [];
  const context = vm.createContext({
    document: { querySelector: selector => elements.get(selector) },
    window: { location: { href: '/login' } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return context.response;
    }
  });
  context.response = {
    ok: true, headers: { get: () => 'application/json; charset=utf-8' },
    json: async () => ({ user: { id: 1, base_unit: 'NRD' } })
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js/login.js'), 'utf8'), context);
  return { elements, requests, context };
}

async function main() {
  const { elements, requests, context } = createLogin();
  const password = elements.get('#password');
  const toggle = elements.get('#toggle-password');
  const form = elements.get('#login-form');
  password.value = 'Senha real com espaços';
  elements.get('#name').value = ' Operador ';
  toggle.listeners.click();
  assert.equal(password.type, 'text');
  assert.equal(toggle.attributes['aria-pressed'], 'true');
  assert.equal(toggle.attributes['aria-label'], 'Ocultar senha');
  assert.equal(elements.get('#eye-show').hidden, true);
  toggle.listeners.click();
  assert.equal(password.type, 'password');
  assert.equal(toggle.attributes['aria-label'], 'Mostrar senha');
  assert.equal(elements.get('#eye-hide').hidden, true);
  assert.equal(password.value, 'Senha real com espaços');

  for (const remember of [false, true]) {
    elements.get('#remember-me').checked = remember;
    toggle.listeners.click();
    let prevented = false;
    await form.listeners.submit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(password.type, 'password');
    assert.equal(requests.at(-1).url, '/api/auth/login');
    assert.equal(requests.at(-1).options.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(requests.at(-1).options.body), {
      name: 'Operador', password: 'Senha real com espaços', remember_me: remember
    });
    assert.equal(context.window.location.href, '/?unit=NRD');
    assert.equal(elements.get('#submit-button').disabled, false);
  }

  for (const [base_unit, expected] of [['PPT','PPT'], ['NRD','NRD'], ['RBR','RBR'], ['PST','PST'], ['invalid','PPT'], [null,'PPT']]) {
    context.response = { ok:true, headers:{get:()=>'application/json'}, json:async()=>({user:{base_unit}}) };
    await form.listeners.submit({preventDefault() {}});
    assert.equal(context.window.location.href, `/?unit=${expected}`);
  }

  context.window.location.href = '/login';
  context.response = { ok: false, headers: { get: () => 'application/json' }, json: async () => ({ error: 'Nome ou senha inválidos.' }) };
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(elements.get('#auth-error').textContent, 'Nome ou senha inválidos.');
  assert.equal(elements.get('#auth-error').hidden, false);
  assert.equal(context.window.location.href, '/login');
  context.response = { ok: false, headers: { get: () => 'text/html' } };
  await form.listeners.submit({ preventDefault() {} });
  assert.match(elements.get('#auth-error').textContent, /servidor não respondeu corretamente/);
  assert.equal(elements.get('#submit-button').disabled, false);
  console.log('Login JS: olho, lembrar de mim, envio, sucesso e erros OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
