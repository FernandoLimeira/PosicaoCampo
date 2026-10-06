let sectorBaseItems = [];
let sectorBaseMap = new Map();
let sectorBasePage = 1;

function getSectorBasePageSize() {
  const width = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 1024);
  const height = Math.max(480, window.innerHeight || document.documentElement.clientHeight || 768);

  let reservedHeight = 390;
  let rowHeight = 38;

  if (width <= 680) {
    reservedHeight = 505;
    rowHeight = 43;
  } else if (width <= 980) {
    reservedHeight = 455;
    rowHeight = 40;
  }

  const fittedRows = Math.floor((height - reservedHeight) / rowHeight);
  return Math.max(4, Math.min(10, fittedRows));
}

function normalizeSectorLookupKey(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return /^-?\d+\.0+$/.test(text) ? text.split('.', 1)[0].toLocaleLowerCase('pt-BR') : text.toLocaleLowerCase('pt-BR');
}

function normalizeSectionLookupKey(value) {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

function rebuildSectorBaseMap() {
  sectorBaseMap = new Map();
  sectorBaseItems.forEach(item => {
    const key = normalizeSectorLookupKey(item?.sector);
    if (!key) return;
    if (!sectorBaseMap.has(key)) sectorBaseMap.set(key, []);
    sectorBaseMap.get(key).push(item);
  });

  sectorBaseMap.forEach(items => {
    items.sort((a, b) => compareFrontLabels(a?.section || '', b?.section || ''));
  });
}

function getSectorBaseItems(value) {
  return sectorBaseMap.get(normalizeSectorLookupKey(value)) || [];
}

function getSectorBaseItem(value, section = '') {
  const items = getSectorBaseItems(value);
  if (!items.length) return null;
  const sectionKey = normalizeSectionLookupKey(section);
  if (sectionKey) {
    return items.find(item => normalizeSectionLookupKey(item?.section) === sectionKey) || null;
  }
  return items[0] || null;
}

function formatSectorBaseUpdatedAt(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return '-';
  return new Date(value * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function sectorBaseSourceLabel(source) {
  return source === 'excel' ? 'Excel' : 'Manual';
}

function renderSectorBaseList() {
  const tbody = document.querySelector('#sector-base-list');
  const empty = document.querySelector('#sector-base-empty');
  const count = document.querySelector('#sector-base-count');
  const pagination = document.querySelector('#sector-base-pagination');
  const pageInfo = document.querySelector('#sector-base-page-info');
  const prevButton = document.querySelector('#sector-base-page-prev');
  const nextButton = document.querySelector('#sector-base-page-next');
  if (!tbody) return;

  const query = String(document.querySelector('#sector-base-search')?.value || '').trim().toLocaleLowerCase('pt-BR');
  const filtered = sectorBaseItems.filter(item => {
    if (!query) return true;
    return [item.sector, item.section, item.description]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query));
  });

  const pageSize = getSectorBasePageSize();
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  sectorBasePage = Math.max(1, Math.min(sectorBasePage, totalPages));
  const startIndex = (sectorBasePage - 1) * pageSize;
  const pageItems = filtered.slice(startIndex, startIndex + pageSize);
  const visibleStart = filtered.length ? startIndex + 1 : 0;
  const visibleEnd = Math.min(startIndex + pageItems.length, filtered.length);

  if (count) count.textContent = String(sectorBaseItems.length);
  tbody.innerHTML = pageItems.map(item => `
    <tr data-sector="${escapeHtml(item.sector)}" data-section="${escapeHtml(item.section || '')}">
      <td><strong>${escapeHtml(item.sector)}</strong></td>
      <td>${escapeHtml(item.section || '-')}</td>
      <td>
        <span class="sector-base-description">${escapeHtml(item.description || '-')}</span>
        <small>${escapeHtml(formatSectorBaseUpdatedAt(item.updated_at))} · ${escapeHtml(item.updated_by || '-')}</small>
      </td>
      <td><span class="sector-base-source ${item.source === 'excel' ? 'is-excel' : 'is-manual'}">${escapeHtml(sectorBaseSourceLabel(item.source))}</span></td>
      <td class="sector-base-actions-cell">
        <button class="sector-base-action" type="button" data-sector-base-action="edit" data-sector="${escapeHtml(item.sector)}">Editar</button>
        <button class="sector-base-action danger" type="button" data-sector-base-action="delete" data-sector="${escapeHtml(item.sector)}" data-section="${escapeHtml(item.section || '')}">Excluir</button>
      </td>
    </tr>
  `).join('');

  if (empty) empty.hidden = filtered.length > 0;
  if (pagination) pagination.hidden = filtered.length === 0;
  if (pageInfo) pageInfo.textContent = `${visibleStart}–${visibleEnd} de ${filtered.length} · Página ${sectorBasePage} de ${totalPages}`;
  if (prevButton) prevButton.disabled = sectorBasePage <= 1;
  if (nextButton) nextButton.disabled = sectorBasePage >= totalPages;
}

async function loadSectorBase({ render = true } = {}) {
  const data = await apiRequest('/api/sector-base');
  sectorBaseItems = Array.isArray(data?.items) ? data.items : [];
  rebuildSectorBaseMap();
  if (render) renderSectorBaseList();
  return sectorBaseItems;
}

function clearSectorBaseManualForm() {
  const form = document.querySelector('#sector-base-manual-form');
  if (form) form.reset();
  const title = document.querySelector('#sector-base-manual-title');
  if (title) title.textContent = 'Adicionar ou atualizar setor';
  const sectorInput = document.querySelector('#sector-base-sector');
  sectorInput?.removeAttribute('data-editing-sector');
  if (sectorInput) sectorInput.readOnly = false;
}

function editSectorBaseItem(sector) {
  const item = getSectorBaseItem(sector);
  if (!item) return;
  const sectorInput = document.querySelector('#sector-base-sector');
  const sectionInput = document.querySelector('#sector-base-section');
  const descriptionInput = document.querySelector('#sector-base-description');
  if (sectorInput) {
    sectorInput.value = item.sector || '';
    sectorInput.dataset.editingSector = item.sector || '';
    sectorInput.readOnly = true;
  }
  if (sectionInput) sectionInput.value = item.section || '';
  if (descriptionInput) descriptionInput.value = item.description || '';
  const title = document.querySelector('#sector-base-manual-title');
  if (title) title.textContent = `Editando setor ${item.sector}`;
  sectorInput?.focus();
}

async function saveSectorBaseManual(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const sector = document.querySelector('#sector-base-sector')?.value.trim() || '';
  const section = document.querySelector('#sector-base-section')?.value.trim() || '';
  const description = document.querySelector('#sector-base-description')?.value.trim() || '';
  if (!sector) {
    showToast('Informe o setor.');
    return;
  }

  if (button) button.disabled = true;
  try {
    const payload = await apiRequest('/api/sector-base', {
      method: 'POST',
      body: JSON.stringify({ sector, section, description })
    });
    const saved = payload?.item;
    if (saved) {
      const key = normalizeSectorLookupKey(saved.sector);
      const index = sectorBaseItems.findIndex(item => normalizeSectorLookupKey(item.sector) === key);
      if (index >= 0) sectorBaseItems[index] = saved;
      else sectorBaseItems.push(saved);
      sectorBaseItems.sort((a, b) => compareFrontLabels(a.sector, b.sector));
      rebuildSectorBaseMap();
          renderSectorBaseList();
    } else {
      await loadSectorBase({ render: true });
    }
    clearSectorBaseManualForm();
    showToast(`Setor ${sector} salvo na base.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar o setor.');
  } finally {
    if (button) button.disabled = false;
  }
}

async function importSectorBaseExcel(event) {
  event.preventDefault();
  const fileInput = document.querySelector('#sector-base-file');
  const button = document.querySelector('#sector-base-import-button');
  const file = fileInput?.files?.[0];
  if (!file) {
    showToast('Selecione a planilha da base de setores.');
    return;
  }
  const lowerName = String(file.name || '').toLocaleLowerCase('pt-BR');
  if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xlsm')) {
    showToast('Use um arquivo Excel XLSX ou XLSM.');
    return;
  }

  if (button) button.disabled = true;
  try {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const response = await fetch('/api/sector-base/import', { method: 'POST', body: formData });
    let payload = {};
    try { payload = await response.json(); } catch (error) { payload = {}; }
    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!response.ok) throw new Error(payload.error || 'Não foi possível importar a planilha.');
    await loadSectorBase({ render: true });
    if (fileInput) fileInput.value = '';
    const fileName = document.querySelector('#sector-base-file-name');
    if (fileName) fileName.textContent = 'Nenhum arquivo selecionado';
    showToast(`${payload.total || 0} setores processados · ${payload.created || 0} novos · ${payload.updated || 0} atualizados.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível importar a base de setores.');
  } finally {
    if (button) button.disabled = false;
  }
}

async function deleteSectorBaseItemFromList(sector, section = '') {
  if (!sector) return;
  const sectionLabel = section || '(sem seção)';
  const accepted = window.confirm(`Excluir o setor ${sector} da seção ${sectionLabel}?`);
  if (!accepted) return;
  try {
    const url = `/api/sector-base/${encodeURIComponent(sector)}?section=${encodeURIComponent(section)}`;
    await apiRequest(url, { method: 'DELETE' });
    const sectorKey = normalizeSectorLookupKey(sector);
    const sectionKey = String(section || '').trim().toLocaleLowerCase('pt-BR');
    sectorBaseItems = sectorBaseItems.filter(item => {
      const sameSector = normalizeSectorLookupKey(item.sector) === sectorKey;
      const sameSection = String(item.section || '').trim().toLocaleLowerCase('pt-BR') === sectionKey;
      return !(sameSector && sameSection);
    });
    rebuildSectorBaseMap();
    renderSectorBaseList();
    showToast(`Setor ${sector} da seção ${sectionLabel} removido da base.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível excluir o setor.');
  }
}

  document.querySelector('#sector-base-search')?.addEventListener('input', () => {
    sectorBasePage = 1;
    renderSectorBaseList();
  });
  let sectorBaseResizeTimer = null;
  window.addEventListener('resize', () => {
    window.clearTimeout(sectorBaseResizeTimer);
    sectorBaseResizeTimer = window.setTimeout(() => {
      sectorBasePage = 1;
      renderSectorBaseList();
    }, 120);
  });
  document.querySelector('#sector-base-page-prev')?.addEventListener('click', () => {
    if (sectorBasePage <= 1) return;
    sectorBasePage -= 1;
    renderSectorBaseList();
  });
  document.querySelector('#sector-base-page-next')?.addEventListener('click', () => {
    sectorBasePage += 1;
    renderSectorBaseList();
  });
  document.querySelector('#sector-base-import-form')?.addEventListener('submit', importSectorBaseExcel);
  document.querySelector('#sector-base-manual-form')?.addEventListener('submit', saveSectorBaseManual);
  document.querySelector('#sector-base-manual-clear')?.addEventListener('click', clearSectorBaseManualForm);
  document.querySelector('#sector-base-file')?.addEventListener('change', event => {
    const name = event.target.files?.[0]?.name || 'Nenhum arquivo selecionado';
    const label = document.querySelector('#sector-base-file-name');
    if (label) label.textContent = name;
  });
  document.querySelector('#sector-base-list')?.addEventListener('click', event => {
    const button = event.target.closest('[data-sector-base-action]');
    if (!button) return;
    const sector = button.dataset.sector || '';
    const section = button.dataset.section || '';
    if (button.dataset.sectorBaseAction === 'edit') editSectorBaseItem(sector);
    if (button.dataset.sectorBaseAction === 'delete') deleteSectorBaseItemFromList(sector, section);
  });


loadSectorBase().catch(error => showToast(error.message));
