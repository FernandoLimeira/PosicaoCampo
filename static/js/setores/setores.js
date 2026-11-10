// Cadastro de setores: listagem paginada, edição manual e importação da planilha.
// O estado e a indexação da base ficam em core/sector-base.js.
let sectorBasePage = 1;

function getSectorBasePageSize() {
  const tableWrap = document.querySelector('.sector-base-table-wrap');
  const tableHead = document.querySelector('.sector-base-table thead');
  if (tableWrap && tableHead) {
    const available = tableWrap.clientHeight - tableHead.getBoundingClientRect().height - 2;
    if (available > 0) return Math.max(1, Math.min(10, Math.floor(available / 43)));
  }
  const width = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 1024);
  const height = Math.max(480, window.innerHeight || document.documentElement.clientHeight || 768);

  let reservedHeight = 390;
  let rowHeight = 43;

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

// Apagar/substituir a base inteira exige a permissão própria "Apagar base de setores".
function canPurgeSectorBase() {
  return currentUser?.role === 'admin' || Boolean(moduleAccess.sectors_purge?.view);
}

function sectorCountLabel(count) {
  return `${count} ${count === 1 ? 'setor' : 'setores'}`;
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
  const purgeButton = document.querySelector('#sector-base-purge');
  if (purgeButton) purgeButton.disabled = sectorBaseItems.length === 0;
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
        ${canEditModule('sectors') ? `<button class="sector-base-action" type="button" data-sector-base-action="edit" data-sector="${escapeHtml(item.sector)}" data-section="${escapeHtml(item.section || '')}">Editar</button>
        <button class="sector-base-action danger" type="button" data-sector-base-action="delete" data-sector="${escapeHtml(item.sector)}" data-section="${escapeHtml(item.section || '')}">Excluir</button>` : '<span aria-label="Somente consulta">—</span>'}
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
  await fetchSectorBase();
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
  sectorInput?.removeAttribute('data-editing-section');
  if (sectorInput) sectorInput.readOnly = false;
}

function editSectorBaseItem(sector, section = '') {
  const item = getSectorBaseItem(sector, section);
  if (!item) return;
  const sectorInput = document.querySelector('#sector-base-sector');
  const sectionInput = document.querySelector('#sector-base-section');
  const descriptionInput = document.querySelector('#sector-base-description');
  if (sectorInput) {
    sectorInput.value = item.sector || '';
    sectorInput.dataset.editingSector = item.sector || '';
    sectorInput.dataset.editingSection = item.section || '';
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
  const editingSection = document.querySelector('#sector-base-sector')?.dataset.editingSection;
  if (!sector) {
    showToast('Informe o setor.', true);
    return;
  }

  if (button) button.disabled = true;
  try {
    const payload = await apiRequest('/api/sector-base', {
      method: 'POST',
      body: JSON.stringify({
        sector,
        section,
        description,
        ...(editingSection !== undefined ? { original_section: editingSection } : {})
      })
    });
    const saved = payload?.item;
    if (saved) {
      const key = normalizeSectorLookupKey(saved.sector);
      const matches = sectionValue => item => normalizeSectorLookupKey(item.sector) === key
        && normalizeSectionLookupKey(item.section) === normalizeSectionLookupKey(sectionValue);
      // Ao trocar a seção na edição, o servidor remove o registro original; reflete isso na lista.
      if (editingSection !== undefined
        && normalizeSectionLookupKey(editingSection) !== normalizeSectionLookupKey(saved.section)) {
        sectorBaseItems = sectorBaseItems.filter(item => !matches(editingSection)(item));
      }
      const index = sectorBaseItems.findIndex(matches(saved.section));
      if (index >= 0) sectorBaseItems[index] = saved;
      else sectorBaseItems.push(saved);
      sectorBaseItems.sort((a, b) => compareFrontLabels(a.sector, b.sector)
        || compareFrontLabels(a.section || '', b.section || ''));
      rebuildSectorBaseMap();
      renderSectorBaseList();
    } else {
      await loadSectorBase({ render: true });
    }
    clearSectorBaseManualForm();
    showToast(`Setor ${sector} salvo na base.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível salvar o setor.', true);
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
    showToast('Selecione a planilha da base de setores.', true);
    return;
  }
  const lowerName = String(file.name || '').toLocaleLowerCase('pt-BR');
  if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xlsm')) {
    showToast('Use um arquivo Excel XLSX ou XLSM.', true);
    return;
  }

  const replace = canPurgeSectorBase() && Boolean(document.querySelector('#sector-base-replace')?.checked);
  if (replace && !await askConfirmation({
    kicker: 'Cadastro de setores',
    title: 'Substituir a base de setores?',
    message: `A base atual será apagada e trocada pelos setores da planilha “${file.name}”.`,
    details: [
      `${sectorCountLabel(sectorBaseItems.length)} cadastrados hoje serão removidos, inclusive os cadastrados manualmente.`,
      'Se a planilha tiver algum erro, nada é apagado.'
    ],
    confirmLabel: 'Substituir base'
  })) return;

  if (button) button.disabled = true;
  try {
    const formData = new FormData();
    formData.append('file', file, file.name);
    let payload;
    try {
      payload = await apiRequest(`/api/sector-base/import${replace ? '?replace=1' : ''}`, { method: 'POST', body: formData });
    } catch (error) {
      // apiRequest já redireciona para o login quando a sessão expira.
      if (error.status === 401) return;
      if (error.status && !error.payload?.error) error.message = 'Não foi possível importar a planilha.';
      throw error;
    }
    await loadSectorBase({ render: true });
    if (fileInput) fileInput.value = '';
    const fileName = document.querySelector('#sector-base-file-name');
    if (fileName) fileName.textContent = 'Nenhum arquivo selecionado';
    const replaceInput = document.querySelector('#sector-base-replace');
    if (replaceInput) replaceInput.checked = false;
    showToast(payload.replaced
      ? `Base substituída: ${payload.removed || 0} removidos · ${payload.total || 0} importados.`
      : `${payload.total || 0} setores processados · ${payload.created || 0} novos · ${payload.updated || 0} atualizados.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível importar a base de setores.', true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function deleteSectorBaseItemFromList(sector, section = '') {
  if (!sector) return;
  const sectionLabel = section || '(sem seção)';
  const item = getSectorBaseItem(sector, section);
  const accepted = await askConfirmation({
    kicker: 'Cadastro de setores',
    title: `Excluir o setor ${sector}?`,
    message: `O setor ${sector} da seção ${sectionLabel}${item?.description ? ` (${item.description})` : ''} será removido da base.`,
    confirmLabel: 'Excluir setor'
  });
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
    showToast(error.message || 'Não foi possível excluir o setor.', true);
  }
}

async function purgeSectorBase() {
  if (!canPurgeSectorBase()) return;
  const total = sectorBaseItems.length;
  if (!total) {
    showToast('A base de setores já está vazia.');
    return;
  }
  const accepted = await askConfirmation({
    kicker: 'Cadastro de setores',
    title: 'Apagar toda a base de setores?',
    message: 'Esta ação não pode ser desfeita.',
    details: [
      `${sectorCountLabel(total)} serão removidos permanentemente.`,
      'Ao digitar um setor nas frentes, o sistema deixa de sugerir seção e fazenda até uma nova importação.'
    ],
    confirmLabel: 'Apagar base',
    requireText: 'APAGAR'
  });
  if (!accepted) return;
  const button = document.querySelector('#sector-base-purge');
  if (button) button.disabled = true;
  try {
    const payload = await apiRequest('/api/sector-base', { method: 'DELETE', body: JSON.stringify({ confirm: 'APAGAR' }) });
    sectorBaseItems = [];
    rebuildSectorBaseMap();
    sectorBasePage = 1;
    clearSectorBaseManualForm();
    renderSectorBaseList();
    showToast(`Base de setores apagada: ${sectorCountLabel(payload?.removed ?? total)} removidos.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível apagar a base de setores.', true);
    await loadSectorBase({ render: true }).catch(() => {});
  }
}

  document.querySelector('#sector-base-purge')?.addEventListener('click', purgeSectorBase);
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
    if (button.dataset.sectorBaseAction === 'edit') editSectorBaseItem(sector, section);
    if (button.dataset.sectorBaseAction === 'delete') deleteSectorBaseItemFromList(sector, section);
  });


loadSectorBase().catch(error => showToast(error.message || 'Não foi possível carregar a base de setores.', true));
