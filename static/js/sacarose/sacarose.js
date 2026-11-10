const UNIT_CODES = ['NRD', 'PPT', 'RBR', 'PST'];
const UNIT_NAMES = { NRD: 'Narandiba', PPT: 'Paraguaçu Paulista', RBR: 'Rio Brilhante', PST: 'Passa Tempo' };

let activeUnit = getReportUnit();
if (!UNIT_CODES.includes(activeUnit)) activeUnit = 'NRD';
let sacaroseUnits = {};
// Última versão confirmada pelo servidor; serve para detectar edições pendentes por unidade.
let savedUnits = {};
let versions = {};
let sectorBase = [];
function normalizeKey(value) { return String(value || '').trim().toLocaleLowerCase('pt-BR'); }
function sectorOptions(sector) { const key = normalizeKey(sector); return sectorBase.filter(item => normalizeKey(item.sector) === key); }
function sectorItem(sector, section = '') {
  const options = sectorOptions(sector);
  const sectionKey = normalizeKey(section);
  return (sectionKey ? options.find(item => normalizeKey(item.section) === sectionKey) : options[0]) || null;
}

function setStatus(message = '', error = false) {
  const status = document.querySelector('#save-status');
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function sectionControl(sector, selected = '') {
  const options = sectorOptions(sector);
  if (options.length > 1) {
    const entries = ['<option value="">Selecione</option>', ...options.map(item => {
      const section = String(item.section || '');
      return `<option value="${escapeHtml(section)}" ${normalizeKey(section) === normalizeKey(selected) ? 'selected' : ''}>${escapeHtml(section || '(sem seção)')}</option>`;
    })];
    return `<select class="section-select">${entries.join('')}</select>`;
  }
  const section = selected || options[0]?.section || '';
  return `<span class="lookup section-value" data-section="${escapeHtml(section)}">${escapeHtml(section || '-')}</span>`;
}

function rowHtml(item = {}) {
  const sector = String(item.sector || '');
  const options = sectorOptions(sector);
  const section = String(item.section || (options.length === 1 || !['RBR', 'PST'].includes(activeUnit) ? options[0]?.section : '') || '');
  const needsSection = ['RBR', 'PST'].includes(activeUnit) && options.length > 1 && !section;
  const base = needsSection ? null : sectorItem(sector, section);
  const missing = Boolean(sector && !options.length);
  return `<tr class="data-row${missing ? ' row-error' : ''}">
    <td><input class="front-input" maxlength="12" value="${escapeHtml(item.front || '')}" placeholder="Ex.: 08" /></td>
    <td><input class="sector-input" maxlength="16" value="${escapeHtml(sector)}" placeholder="Ex.: 3803" /></td>
    <td class="section-cell">${sectionControl(sector, section)}</td>
    <td><span class="lookup description-value${missing ? ' is-error' : base?.description ? '' : ' is-muted'}">${escapeHtml(missing ? 'Setor não encontrado na base' : needsSection ? 'Selecione a seção' : base?.description || '-')}</span></td>
    <td><label class="image-toggle"><input class="exclude-input" type="checkbox" ${item.exclude_image ? 'checked' : ''} /> Sim</label></td>
    <td><button class="remove-row" type="button" aria-label="Remover frente">×</button></td>
  </tr>`;
}

function collectRows() {
  return [...document.querySelectorAll('#sacarose-rows .data-row')].map(row => ({
    front: row.querySelector('.front-input')?.value.trim() || '',
    sector: row.querySelector('.sector-input')?.value.trim() || '',
    section: row.querySelector('.section-select')?.value.trim() || row.querySelector('.section-value')?.dataset.section || '',
    exclude_image: Boolean(row.querySelector('.exclude-input')?.checked)
  }));
}

function comparableRows(rows) {
  return JSON.stringify((Array.isArray(rows) ? rows : []).map(item => ({
    front: String(item?.front || '').trim(),
    sector: String(item?.sector || '').trim(),
    section: String(item?.section || '').trim(),
    exclude_image: Boolean(item?.exclude_image)
  })).filter(item => item.front || item.sector || item.section || item.exclude_image));
}

function hasUnsavedChanges(code) {
  const rows = code === activeUnit ? collectRows() : sacaroseUnits[code];
  return comparableRows(rows) !== comparableRows(savedUnits[code]);
}

// Sinaliza no cabeçalho e nos botões de unidade onde há edições ainda não salvas.
function updateUnsavedIndicators() {
  const pending = UNIT_CODES.filter(hasUnsavedChanges);
  const pole = `${['RBR', 'PST'].includes(activeUnit) ? 'Polo MS' : 'Polo SP'} · ${activeUnit}`;
  document.querySelector('#unit-pole').textContent = pending.length
    ? `${pole} · alterações não salvas: ${pending.join(', ')}`
    : pole;
  document.querySelectorAll('[data-report-unit]').forEach(button => {
    const code = button.dataset.reportUnit;
    const dirty = pending.includes(code);
    const label = button.querySelector('span') || button;
    if (!button.dataset.baseTitle) button.dataset.baseTitle = button.getAttribute('title') || code;
    label.textContent = dirty ? `${code}•` : code;
    button.classList.toggle('has-unsaved-changes', dirty);
    button.setAttribute('title', dirty ? `${button.dataset.baseTitle} · alterações não salvas` : button.dataset.baseTitle);
  });
}

function renderUnit() {
  document.querySelector('#unit-title').textContent = UNIT_NAMES[activeUnit];
  const rows = Array.isArray(sacaroseUnits[activeUnit]) ? sacaroseUnits[activeUnit] : [];
  document.querySelector('#sacarose-rows').innerHTML = rows.length ? rows.map(rowHtml).join('') : rowHtml();
  if (!canEditModule('sacarose')) document.querySelectorAll('#sacarose-rows input, #sacarose-rows select, #sacarose-rows button').forEach(input => { input.disabled = true; });
  history.replaceState(null, '', `/sacarose?unit=${activeUnit}`);
  setStatus('');
  updateUnsavedIndicators();
}

function refreshRow(row) {
  const sector = row.querySelector('.sector-input')?.value.trim() || '';
  const previous = row.querySelector('.section-select')?.value || row.querySelector('.section-value')?.dataset.section || '';
  row.querySelector('.section-cell').innerHTML = sectionControl(sector, previous);
  const section = row.querySelector('.section-select')?.value || row.querySelector('.section-value')?.dataset.section || '';
  const options = sectorOptions(sector);
  const needsSection = ['RBR', 'PST'].includes(activeUnit) && options.length > 1 && !section;
  const item = needsSection ? null : sectorItem(sector, section);
  const missing = Boolean(sector && !options.length);
  const description = row.querySelector('.description-value');
  description.textContent = missing ? 'Setor não encontrado na base' : needsSection ? 'Selecione a seção' : item?.description || '-';
  description.className = `lookup description-value${missing ? ' is-error' : item?.description ? '' : ' is-muted'}`;
  row.classList.toggle('row-error', missing || needsSection);
}

function validate(rows) {
  const seen = new Set();
  for (const item of rows) {
    if (!item.front || !item.sector) return `Informe Frente e Setor em ${activeUnit}.`;
    const frontKey = /^\d+$/.test(item.front) ? String(Number(item.front)) : normalizeKey(item.front);
    if (seen.has(frontKey)) return `A frente ${item.front} está repetida em ${activeUnit}.`;
    seen.add(frontKey);
    const options = sectorOptions(item.sector);
    if (!options.length) return `Setor ${item.sector} não encontrado no Cadastro de setores.`;
    if (['RBR', 'PST'].includes(activeUnit) && options.length > 1 && !item.section) return `Selecione a seção do setor ${item.sector}.`;
    if (item.section && !sectorItem(item.sector, item.section)) return `A seção ${item.section} não pertence ao setor ${item.sector}.`;
  }
  return '';
}

async function save(event) {
  event.preventDefault();
  const rows = collectRows();
  const problem = validate(rows);
  if (problem) { showToast(problem, true); setStatus(problem, true); return; }
  const button = document.querySelector('#save-button');
  const savingUnit = activeUnit;
  button.disabled = true;
  setStatus('Salvando…');
  try {
    const result = await apiRequest('/api/sacarose', {
      method: 'POST',
      body: JSON.stringify({ units: { [savingUnit]: rows }, expected_versions: { [savingUnit]: versions[savingUnit]?.version ?? null } })
    });
    const savedRows = result.sacarose?.[savingUnit] || rows;
    savedUnits[savingUnit] = savedRows;
    sacaroseUnits[savingUnit] = savedRows;
    versions = result.meta || versions;
    if (activeUnit === savingUnit) { renderUnit(); setStatus('Alterações salvas.'); }
    else updateUnsavedIndicators();
    showToast(`Sacarose ${savingUnit} salva e sincronizada.`);
  } catch (error) {
    if (error.status === 409) {
      // Atualiza versões e dados do servidor sem descartar o que o usuário digitou.
      const reloaded = await loadData({ keepPendingEdits: true }).then(() => true, () => false);
      const message = reloaded
        ? `A Sacarose ${savingUnit} foi alterada por outro usuário. Suas alterações pendentes foram mantidas; revise-as antes de salvar novamente.`
        : `A Sacarose ${savingUnit} foi alterada por outro usuário e não foi possível carregar a versão mais recente. Suas alterações pendentes foram mantidas; recarregue a página antes de salvar novamente.`;
      setStatus(message, true);
      showToast(message, true);
    } else {
      setStatus(error.message, true);
      showToast(error.message, true);
    }
  } finally { button.disabled = false; }
}

async function loadData({ keepPendingEdits = false } = {}) {
  let pendingUnits = {};
  if (keepPendingEdits) {
    sacaroseUnits[activeUnit] = collectRows();
    pendingUnits = Object.fromEntries(UNIT_CODES.filter(hasUnsavedChanges).map(code => [code, sacaroseUnits[code]]));
  }
  setStatus('Carregando…');
  const [unitPayload, sectorPayload, sacarosePayload] = await Promise.all([
    apiRequest('/api/units/meta'), apiRequest('/api/sector-base'), apiRequest('/api/sacarose')
  ]);
  versions = unitPayload.meta || {};
  sectorBase = Array.isArray(sectorPayload.items) ? sectorPayload.items : [];
  savedUnits = sacarosePayload.units || {};
  sacaroseUnits = { ...savedUnits, ...pendingUnits };
  renderUnit();
}

document.addEventListener('report-unit-change', event => {
  sacaroseUnits[activeUnit] = collectRows();
  activeUnit = event.detail.unit;
  renderUnit();
});
document.querySelector('#export-sacarose-unit').addEventListener('click', async event => {
  const button = event.currentTarget;
  const code = activeUnit;
  const rows = collectRows();
  const problem = validate(rows);
  if (problem) { showToast(problem, true); return; }

  const scale = Number(document.querySelector('#sacarose-export-size')?.value || 1);
  const transparentBackground = Boolean(document.querySelector('#sacarose-export-transparent')?.checked);

  button.disabled = true;
  try {
    const blob = await generateSacaroseReportImageBlob([code], { [code]: rows }, sectorBase, {
      scale,
      transparentBackground
    });
    const dateText = saoPauloDateParts().isoDate.split('-').reverse().join('-');
    const suffix = transparentBackground ? 'transparente' : 'padrao';
    downloadBlobFile(blob, `Sacarose-${code}-${suffix}-${dateText}.png`);
    showToast(`Imagem da Sacarose ${code} emitida.`);
  } catch (error) { showToast(error.message || 'Não foi possível emitir a imagem.', true); }
  finally { button.disabled = false; }
});
document.querySelector('#add-row')?.addEventListener('click', () => {
  document.querySelector('#sacarose-rows').insertAdjacentHTML('beforeend', rowHtml());
  document.querySelector('#sacarose-rows tr:last-child .front-input')?.focus();
});
document.querySelector('#sacarose-rows').addEventListener('click', event => {
  const button = event.target.closest('.remove-row');
  if (button) {
    button.closest('tr')?.remove();
    updateUnsavedIndicators();
  }
});
document.querySelector('#sacarose-rows').addEventListener('input', event => {
  if (event.target.matches('.sector-input')) refreshRow(event.target.closest('tr'));
  updateUnsavedIndicators();
});
document.querySelector('#sacarose-rows').addEventListener('change', event => {
  if (event.target.matches('.section-select')) refreshRow(event.target.closest('tr'));
  updateUnsavedIndicators();
});
document.querySelector('#sacarose-form').addEventListener('submit', save);


loadData().catch(error => { setStatus(error.message, true); showToast(error.message, true); });
