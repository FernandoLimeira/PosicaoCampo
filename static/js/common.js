// Comportamento do layout base: sessão, HTTP, diálogos e notificações.
let currentUser = document.body.dataset.userId ? {
  id: Number(document.body.dataset.userId),
  name: document.body.dataset.userName,
  role: document.body.dataset.userRole,
  base_unit: document.body.dataset.userBaseUnit || 'PPT'
} : null;
let toastTimer;

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }

  if (response.status === 401) {
    window.location.href = '/login';
    const authError = new Error('Sessão expirada.');
    authError.status = 401;
    authError.payload = data;
    throw authError;
  }
  if (!response.ok) {
    const requestError = new Error(data.error || 'Erro de comunicação com o servidor.');
    requestError.status = response.status;
    requestError.payload = data;
    throw requestError;
  }
  return data;
}

async function logout() {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    console.warn('Não foi possível encerrar a sessão no servidor.', error);
  } finally {
    window.location.href = '/login';
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function greetingForHour(hour) {
  return hour >= 5 && hour < 12 ? 'Bom dia!' : hour >= 12 && hour < 18 ? 'Boa tarde!' : 'Boa noite!';
}

function updateDateAndGreeting() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = greetingForHour(hour);
  const date = now.toLocaleDateString('pt-BR');

  const username = currentUser?.name || document.body.dataset.userName || '';
  document.querySelector('#greeting').textContent = username ? `${greeting.slice(0, -1)}, ${username}!` : greeting;
  document.querySelector('#today').textContent = date;
  const clock = document.querySelector('#current-time');
  if (clock) clock.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

const REPORT_UNIT_NAMES = { PPT: 'Paraguaçu Paulista', NRD: 'Narandiba', RBR: 'Rio Brilhante', PST: 'Passa Tempo' };
const REPORT_UNIT_KEY = `posicao-campo-report-unit:${currentUser?.id || 'anonymous'}`;
const baseUnit = REPORT_UNIT_NAMES[currentUser?.base_unit] ? currentUser.base_unit : 'PPT';
let reportUnit = baseUnit;
try { reportUnit = sessionStorage.getItem(REPORT_UNIT_KEY) || reportUnit; } catch (_) { /* Armazenamento opcional. */ }
const requestedUnit = new URLSearchParams(window.location.search).get('unit')?.toUpperCase();
// Abrir o sistema sem escolher uma unidade começa sempre na base da conta.
// Links internos incluem a unidade atual e mantêm a navegação entre relatórios.
if (new URL(window.location.href).pathname === '/' && !requestedUnit) reportUnit = baseUnit;
if (REPORT_UNIT_NAMES[requestedUnit]) reportUnit = requestedUnit;
if (!REPORT_UNIT_NAMES[reportUnit]) reportUnit = 'PPT';

function getReportUnit() { return reportUnit; }

function syncReportUnitContext() {
  document.querySelectorAll('[data-report-unit]').forEach(button => {
    const selected = button.dataset.reportUnit === reportUnit;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  try { sessionStorage.setItem(REPORT_UNIT_KEY, reportUnit); } catch (_) { /* Sem armazenamento, usa a URL. */ }
  const url = new URL(window.location.href);
  url.searchParams.set('unit', reportUnit);
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  document.querySelectorAll('[data-unit-context]').forEach(link => {
    const target = new URL(link.href, window.location.origin);
    target.searchParams.set('unit', reportUnit);
    link.href = `${target.pathname}${target.search}${target.hash}`;
  });
}

function setReportUnit(code) {
  if (!REPORT_UNIT_NAMES[code] || code === reportUnit) return;
  reportUnit = code;
  syncReportUnitContext();
  document.dispatchEvent(new CustomEvent('report-unit-change', { detail: { unit: code } }));
}

function matchesReportUnit(value, code = getReportUnit()) {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const name = REPORT_UNIT_NAMES[code].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return normalized.split(' ').includes(code) || normalized.includes(name);
}

syncReportUnitContext();
document.querySelectorAll('[data-report-unit]').forEach(button => {
  button.addEventListener('click', () => setReportUnit(button.dataset.reportUnit));
});

function compareFrontLabels(a, b) {
  const left = String(a ?? '').trim();
  const right = String(b ?? '').trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

const sidebarFlyouts = [];

function setupSidebarFlyout(toggleSelector, panelSelector) {
  const toggle = document.querySelector(toggleSelector);
  const panelElement = document.querySelector(panelSelector);
  if (!toggle || !panelElement) return null;

  function position() {
    if (panelElement.hidden) return;
    const trigger = toggle.getBoundingClientRect();
    const sidebar = document.querySelector('.app-navbar').getBoundingClientRect();
    const panel = panelElement.getBoundingClientRect();
    const gap = 10;
    const right = sidebar.right + gap;
    const fitsRight = right + panel.width <= window.innerWidth - 12;
    const left = fitsRight ? right : Math.max(12, Math.min(trigger.left, window.innerWidth - panel.width - 12));
    const top = Math.max(12, Math.min(fitsRight ? trigger.top : trigger.bottom + gap, window.innerHeight - panel.height - 12));
    panelElement.style.left = `${left}px`;
    panelElement.style.top = `${top}px`;
  }

  function close(restoreFocus = false) {
    panelElement.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  }

  const flyout = { position, close };
  sidebarFlyouts.push(flyout);
  toggle.addEventListener('click', () => {
    if (!panelElement.hidden) { close(); return; }
    sidebarFlyouts.forEach(other => { if (other !== flyout) other.close(); });
    panelElement.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    position();
    panelElement.querySelector('a')?.focus();
  });
  document.addEventListener('click', event => {
    if (!panelElement.hidden && !panelElement.contains(event.target) && !toggle.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panelElement.hidden) {
      event.preventDefault();
      close(true);
    }
  });
  document.addEventListener('focusin', event => {
    if (!panelElement.hidden && !panelElement.contains(event.target) && !toggle.contains(event.target)) close();
  });
  panelElement.addEventListener('click', event => {
    if (event.target.closest('a')) close();
  });
  close();
  return flyout;
}

const reportsMenu = setupSidebarFlyout('#reports-toggle', '#reports-flyout');
setupSidebarFlyout('#users-toggle', '#users-flyout');
function positionReportsFlyout() { reportsMenu?.position(); }
document.querySelector('.nav-actions')?.addEventListener('scroll', () => sidebarFlyouts.forEach(menu => menu.close()));
window.addEventListener('resize', () => sidebarFlyouts.forEach(menu => menu.position()));
window.addEventListener('scroll', () => sidebarFlyouts.forEach(menu => menu.close()));

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  const focusTarget = modal.querySelector('select, input, textarea, button');
  requestAnimationFrame(() => focusTarget?.focus());
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = true;
  const anyOpen = [...document.querySelectorAll('.modal-backdrop')].some(item => !item.hidden);
  if (!anyOpen) document.body.classList.remove('modal-open');
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(modal => { modal.hidden = true; });
  document.body.classList.remove('modal-open');
}

function showToast(message, error = false) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.toggle('is-error', error);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function formatServerTimestamp(timestamp) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return '-';
  return new Date(numeric * 1000).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function downloadBlobFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelector('#logout-button')?.addEventListener('click', logout);
  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const openModalElement = [...document.querySelectorAll('.modal-backdrop')].find(modal => !modal.hidden);
    if (openModalElement) closeModal(openModalElement.id);
  });

updateDateAndGreeting();
setInterval(updateDateAndGreeting, 1000);
