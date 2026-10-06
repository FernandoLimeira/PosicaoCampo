const form = document.querySelector('#login-form');
const errorBox = document.querySelector('#auth-error');
const submitButton = document.querySelector('#submit-button');
const passwordInput = document.querySelector('#password');
const passwordToggle = document.querySelector('#toggle-password');
const rememberInput = document.querySelector('#remember-me');

function setPasswordVisible(visible) {
  passwordInput.type = visible ? 'text' : 'password';
  const label = visible ? 'Ocultar senha' : 'Mostrar senha';
  passwordToggle.setAttribute('aria-label', label);
  passwordToggle.setAttribute('title', label);
  passwordToggle.setAttribute('aria-pressed', String(visible));
  document.querySelector('#eye-show').hidden = visible;
  document.querySelector('#eye-hide').hidden = !visible;
}

passwordToggle.addEventListener('click', () => {
  setPasswordVisible(passwordInput.type === 'password');
});

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  showError('');
  submitButton.disabled = true;
  setPasswordVisible(false);

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.querySelector('#name').value.trim(),
        password: passwordInput.value,
        remember_me: rememberInput.checked
      })
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('O servidor não respondeu corretamente. Verifique a conexão e tente novamente.');
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível entrar.');
    const baseUnit = ['PPT', 'NRD', 'RBR', 'PST'].includes(data.user?.base_unit) ? data.user.base_unit : 'PPT';
    window.location.href = `/?unit=${baseUnit}`;
  } catch (error) {
    showError(error.message || 'Não foi possível entrar.');
  } finally {
    submitButton.disabled = false;
  }
});
