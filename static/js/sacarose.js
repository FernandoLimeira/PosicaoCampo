const UNIT_CODES = ['NRD', 'PPT', 'RBR', 'PST'];
const UNIT_NAMES = { NRD: 'Narandiba', PPT: 'Paraguaçu Paulista', RBR: 'Rio Brilhante', PST: 'Passa Tempo' };

let activeUnit = getReportUnit();
if (!UNIT_CODES.includes(activeUnit)) activeUnit = 'NRD';
let units = {};
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

function renderUnit() {
  document.querySelector('#unit-pole').textContent = `${['RBR', 'PST'].includes(activeUnit) ? 'Polo MS' : 'Polo SP'} · ${activeUnit}`;
  document.querySelector('#unit-title').textContent = UNIT_NAMES[activeUnit];
  const rows = Array.isArray(units[activeUnit]) ? units[activeUnit] : [];
  document.querySelector('#sacarose-rows').innerHTML = rows.length ? rows.map(rowHtml).join('') : rowHtml();
  history.replaceState(null, '', `/sacarose?unit=${activeUnit}`);
  setStatus('');
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
    units[savingUnit] = result.sacarose?.[savingUnit] || rows;
    versions = result.meta || versions;
    if (activeUnit === savingUnit) { renderUnit(); setStatus('Alterações salvas.'); }
    showToast(`Sacarose ${savingUnit} salva e sincronizada.`);
  } catch (error) {
    if (error.status === 409) await loadData().catch(() => {});
    setStatus(error.message, true);
    showToast(error.status === 409 ? 'Dados atualizados por outro usuário. Recarregamos a versão mais recente.' : error.message, true);
  } finally { button.disabled = false; }
}

async function loadData() {
  setStatus('Carregando…');
  const [unitPayload, sectorPayload, sacarosePayload] = await Promise.all([
    apiRequest('/api/units'), apiRequest('/api/sector-base'), apiRequest('/api/sacarose')
  ]);
  versions = unitPayload.meta || {};
  sectorBase = Array.isArray(sectorPayload.items) ? sectorPayload.items : [];
  units = sacarosePayload.units || {};
  renderUnit();
}

document.addEventListener('report-unit-change', event => {
  units[activeUnit] = collectRows();
  activeUnit = event.detail.unit;
  renderUnit();
});
document.querySelector('#add-row').addEventListener('click', () => {
  document.querySelector('#sacarose-rows').insertAdjacentHTML('beforeend', rowHtml());
  document.querySelector('#sacarose-rows tr:last-child .front-input')?.focus();
});
document.querySelector('#sacarose-rows').addEventListener('click', event => {
  const button = event.target.closest('.remove-row');
  if (button) button.closest('tr')?.remove();
});
document.querySelector('#sacarose-rows').addEventListener('input', event => {
  if (event.target.matches('.sector-input')) refreshRow(event.target.closest('tr'));
});
document.querySelector('#sacarose-rows').addEventListener('change', event => {
  if (event.target.matches('.section-select')) refreshRow(event.target.closest('tr'));
});
document.querySelector('#sacarose-form').addEventListener('submit', save);


loadData().catch(error => { setStatus(error.message, true); showToast(error.message, true); });
