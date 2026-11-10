let historyItems = [];
let historyPage = 1;
let historyRequest = 0;
const HISTORY_PAGE_SIZE = 6;

function historyItemHtml(item) {
  const isNote = item.kind === 'front_note';
  const description = isNote
    ? `Frente ${item.front || '—'} · Setor ${item.sector || '—'}`
    : `${item.action || 'Atualização'} · versão ${item.version ?? '—'}`;
  return `
    <article class="history-item${isNote ? ' history-item-occurrence' : ''}">
      <div class="history-item-main">
        <strong>${escapeHtml(item.unit_code || '-')} — ${escapeHtml(item.unit_name || '')}</strong>
        <span>${escapeHtml(description)}</span>
      </div>
      <div class="history-item-meta">
        <span>Registrado por</span>
        <strong class="history-analyst">${escapeHtml(item.user_name || 'Usuário')}</strong>
        <span>${escapeHtml(formatServerTimestamp(item.created_at, 'America/Sao_Paulo'))}${item.shift ? ` · Turno ${escapeHtml(item.shift)}` : ''}</span>
      </div>
      ${isNote ? `<div class="history-occurrence-content">
        <span class="history-occurrence-label">Acontecimento da frente · ${item.resolved_at ? 'Concluído' : item.highlighted ? 'Em destaque no painel' : 'Registrado no histórico'}</span>
        <p>${escapeHtml(item.text || '')}</p>
      </div>` : ''}
    </article>`;
}

function renderHistoryPage() {
  const list = document.querySelector('#history-list');
  const pagination = document.querySelector('#history-pagination');
  const pageInfo = document.querySelector('#history-page-info');
  const previousButton = document.querySelector('#history-page-prev');
  const nextButton = document.querySelector('#history-page-next');
  if (!list || !pagination || !pageInfo || !previousButton || !nextButton) return;

  const totalItems = historyItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / HISTORY_PAGE_SIZE));
  historyPage = Math.min(Math.max(historyPage, 1), totalPages);

  if (!totalItems) {
    list.innerHTML = '<div class="history-empty">Nenhum registro encontrado.</div>';
    pagination.hidden = true;
    return;
  }

  const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
  const pageItems = historyItems.slice(start, start + HISTORY_PAGE_SIZE);
  let lastDay = '';
  list.innerHTML = pageItems.map(item => {
    const day = item.work_date ? item.work_date.split('-').reverse().join('/')
      : new Date(Number(item.created_at) * 1000).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const group = `${day}${item.shift ? ` · Turno ${item.shift}` : ''}`;
    const heading = group !== lastDay ? `<h2 class="history-day-heading">${escapeHtml(group)}</h2>` : '';
    lastDay = group;
    return heading + historyItemHtml(item);
  }).join('');

  const firstItem = start + 1;
  const lastItem = Math.min(start + HISTORY_PAGE_SIZE, totalItems);
  pageInfo.textContent = `${firstItem}–${lastItem} de ${totalItems} · Página ${historyPage} de ${totalPages}`;
  previousButton.disabled = historyPage <= 1;
  nextButton.disabled = historyPage >= totalPages;
  pagination.hidden = totalPages <= 1;
}

async function loadHistory({ resetPage = true } = {}) {
  const list = document.querySelector('#history-list');
  const pagination = document.querySelector('#history-pagination');
  if (!list) return;
  const unit = getReportUnit();
  const request = ++historyRequest;
  if (resetPage) historyPage = 1;
  list.innerHTML = '<div class="history-loading">Carregando histórico...</div>';
  if (pagination) pagination.hidden = true;

  try {
    const query = new URLSearchParams({ limit: '150' });
    if (unit) query.set('unit', unit);
    const data = await apiRequest(`/api/history?${query.toString()}`);
    if (request !== historyRequest || getReportUnit() !== unit) return;
    historyItems = Array.isArray(data.history) ? data.history : [];
    renderHistoryPage();
  } catch (error) {
    if (request !== historyRequest || getReportUnit() !== unit) return;
    console.error(error);
    historyItems = [];
    list.innerHTML = '<div class="history-empty">Não foi possível carregar o histórico.</div>';
    if (pagination) pagination.hidden = true;
  }
}

document.querySelector('#history-page-prev')?.addEventListener('click', () => {
  if (historyPage <= 1) return;
  historyPage -= 1;
  renderHistoryPage();
});
document.querySelector('#history-page-next')?.addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(historyItems.length / HISTORY_PAGE_SIZE));
  if (historyPage >= totalPages) return;
  historyPage += 1;
  renderHistoryPage();
});

document.addEventListener('report-unit-change', () => loadHistory());
loadHistory();
