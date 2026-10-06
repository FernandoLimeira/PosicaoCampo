let historyItems = [];
let historyPage = 1;
const HISTORY_PAGE_SIZE = 6;

function historyItemHtml(item) {
  return `
    <article class="history-item">
      <div class="history-item-main">
        <strong>${escapeHtml(item.unit_code || '-')} — ${escapeHtml(item.unit_name || '')}</strong>
        <span>${escapeHtml(item.action || 'atualização')} · versão ${escapeHtml(item.version ?? '-')}</span>
      </div>
      <div class="history-item-meta">
        <strong>${escapeHtml(item.user_name || 'Usuário')}</strong>
        <span>${escapeHtml(formatServerTimestamp(item.created_at))}</span>
      </div>
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
    list.innerHTML = '<div class="history-empty">Nenhuma alteração registrada.</div>';
    pagination.hidden = true;
    return;
  }

  const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
  const pageItems = historyItems.slice(start, start + HISTORY_PAGE_SIZE);
  list.innerHTML = pageItems.map(historyItemHtml).join('');

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
  if (resetPage) historyPage = 1;
  list.innerHTML = '<div class="history-loading">Carregando histórico...</div>';
  if (pagination) pagination.hidden = true;

  try {
    const query = new URLSearchParams({ limit: '150' });
    if (unit) query.set('unit', unit);
    const data = await apiRequest(`/api/history?${query.toString()}`);
    historyItems = Array.isArray(data.history) ? data.history : [];
    renderHistoryPage();
  } catch (error) {
    console.error(error);
    historyItems = [];
    list.innerHTML = '<div class="history-empty">Não foi possível carregar o histórico.</div>';
    if (pagination) pagination.hidden = true;
  }
}

  document.querySelector('#history-unit-filter')?.addEventListener('change', () => loadHistory({ resetPage: true }));
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
