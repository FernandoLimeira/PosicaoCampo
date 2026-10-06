let returnLayoutsState = { units: [] };
let returnLastReport = null;
let returnLayoutsLoading = false;
let returnLastInput = null;
let returnAnalysisEpoch = 0;
let returnAnalysisBusy = false;
let returnPresentationBusy = false;

function updateReturnPresentationButton() {
  const button = document.querySelector('#return-generate-presentation');
  if (button) button.disabled = !returnLastInput || returnAnalysisBusy || returnPresentationBusy;
  const processButton = document.querySelector('#return-analysis-process');
  if (processButton) processButton.disabled = returnAnalysisBusy || returnPresentationBusy;
}

function invalidateReturnAnalysis() {
  returnAnalysisEpoch += 1;
  returnLastReport = null;
  returnLastInput = null;
  const results = document.querySelector('#return-analysis-results');
  if (results) results.hidden = true;
  returnSetStatus('#return-presentation-status', '');
  updateReturnPresentationButton();
}

function returnUnitByCode(code) {
  return (returnLayoutsState.units || []).find(unit => unit.code === code) || null;
}

function returnFormatDate(value) {
  if (!value) return '-';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return String(value);
}

function returnFormatPeriod(start, end) {
  const first = returnFormatDate(start);
  const last = returnFormatDate(end);
  return first === last ? first : `${first} a ${last}`;
}

function returnCountText(counts) {
  const items = Array.isArray(counts) ? counts : [];
  return items.length ? items.map(item => `${item.front}: ${item.count}`).join(' · ') : '-';
}

function returnSetStatus(selector, message = '', type = '') {
  const element = document.querySelector(selector);
  if (!element) return;
  element.className = 'excel-report-status';
  if (type) element.classList.add(type === 'error' ? 'is-error' : 'is-success');
  element.textContent = message;
}

function returnFillSelect(element, options, preferred = '') {
  if (!element) return;
  const previous = preferred || element.value;
  element.innerHTML = options.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
  if (previous && options.some(option => option.value === previous)) element.value = previous;
}

function renderReturnUnitSelects() {
  const options = (returnLayoutsState.units || []).map(unit => ({
    value: unit.code,
    label: `${unit.code} — ${unit.name}`,
  }));
  const layoutSelect = document.querySelector('#return-layout-unit');
  const analysisSelect = document.querySelector('#return-analysis-unit');
  const preferredUnit = getReportUnit();
  returnFillSelect(layoutSelect, options, layoutSelect?.value || preferredUnit);
  returnFillSelect(analysisSelect, options, preferredUnit);
  renderReturnLayoutRows();
  updateReturnLayoutUnitHint();
  renderReturnAnalysisFronts();
}

function updateReturnLayoutUnitHint() {
  const select = document.querySelector('#return-layout-unit');
  const title = document.querySelector('#return-layout-unit-title');
  const hint = document.querySelector('#return-layout-unit-hint');
  const unit = returnUnitByCode(select?.value || '');
  if (title) title.textContent = unit ? `Layouts de ${unit.code}` : 'Layout por unidade';
  if (hint) {
    hint.textContent = unit
      ? `As alterações abaixo serão salvas somente em ${unit.code} — ${unit.name}.`
      : 'As alterações são salvas somente na unidade selecionada.';
  }
}

async function openReturnLayoutsModal() {
  const analysisUnit = document.querySelector('#return-analysis-unit')?.value || '';
  const preferredUnit = analysisUnit || new URLSearchParams(window.location.search).get('unit') || '';
  await loadReturnLayouts(false, preferredUnit);
  const layoutSelect = document.querySelector('#return-layout-unit');
  if (preferredUnit && [...(layoutSelect?.options || [])].some(option => option.value === preferredUnit)) {
    layoutSelect.value = preferredUnit;
  }
  renderReturnLayoutRows();
  updateReturnLayoutUnitHint();
  returnSetStatus('#return-layout-status', '');
  openModal('return-layout-modal');
}

function renderReturnLayoutRows() {
  const list = document.querySelector('#return-layout-list');
  const select = document.querySelector('#return-layout-unit');
  if (!list || !select) return;
  const unit = returnUnitByCode(select.value);
  list.innerHTML = '';
  if (!unit) {
    list.innerHTML = '<div class="return-layout-empty">Nenhuma unidade disponível.</div>';
    return;
  }
  const fronts = Array.isArray(unit.fronts) ? unit.fronts : [];
  if (!fronts.length) {
    list.innerHTML = '<div class="return-layout-empty">Nenhuma frente cadastrada nesta unidade. Clique em “Adicionar frente”.</div>';
    return;
  }
  fronts.forEach(front => appendReturnLayoutRow(front));
}

function appendReturnLayoutRow(front = {}) {
  const list = document.querySelector('#return-layout-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'return-layout-row';
  row.innerHTML = `
    <label class="return-field return-front-code-field">
      <span>Frente</span>
      <input class="return-front-code" type="text" maxlength="12" value="${escapeHtml(front.code || '')}" placeholder="02" />
    </label>
    <label class="return-field return-front-name-field">
      <span>Nome</span>
      <input class="return-front-name" type="text" maxlength="80" value="${escapeHtml(front.name || '')}" placeholder="Frente 02" />
    </label>
    <label class="return-field return-equipment-field">
      <span>Colhedoras do layout</span>
      <input class="return-front-equipment" type="text" value="${escapeHtml((front.equipment || []).join(', '))}" placeholder="4300157, 4300155, 4300153, 4300161" />
    </label>
    <button class="return-remove-front" type="button" aria-label="Remover frente">Remover</button>
  `;
  list.appendChild(row);
}

function collectReturnLayoutRows() {
  const rows = [...document.querySelectorAll('#return-layout-list .return-layout-row')];
  return rows.map(row => {
    let code = row.querySelector('.return-front-code')?.value.trim() || '';
    if (/^\d+$/.test(code)) code = code.padStart(2, '0');
    const name = row.querySelector('.return-front-name')?.value.trim() || (code ? `Frente ${code}` : '');
    const equipmentRaw = row.querySelector('.return-front-equipment')?.value || '';
    const equipment = [...new Set(
      equipmentRaw
        .split(/[;,\s]+/)
        .map(value => Number(value.trim()))
        .filter(value => Number.isInteger(value) && value > 0)
    )];
    return { code, name, equipment };
  }).filter(front => front.code || front.name || front.equipment.length);
}

async function saveReturnLayouts() {
  const unitCode = document.querySelector('#return-layout-unit')?.value || '';
  const button = document.querySelector('#return-save-layouts');
  if (!unitCode) return;
  const fronts = collectReturnLayoutRows();
  if (!fronts.length) {
    returnSetStatus('#return-layout-status', 'Cadastre pelo menos uma frente antes de salvar.', 'error');
    return;
  }
  const codes = new Set();
  const equipmentOwners = new Map();
  for (const front of fronts) {
    if (!front.code) {
      returnSetStatus('#return-layout-status', 'Todas as frentes precisam de um código.', 'error');
      return;
    }
    const key = front.code.toLocaleLowerCase('pt-BR');
    if (codes.has(key)) {
      returnSetStatus('#return-layout-status', `A frente ${front.code} está duplicada.`, 'error');
      return;
    }
    codes.add(key);
    for (const equipment of front.equipment) {
      const owner = equipmentOwners.get(equipment);
      if (owner && owner !== front.code) {
        returnSetStatus('#return-layout-status', `A colhedora ${equipment} aparece nas frentes ${owner} e ${front.code}.`, 'error');
        return;
      }
      equipmentOwners.set(equipment, front.code);
    }
  }

  if (button) button.disabled = true;
  returnSetStatus('#return-layout-status', 'Salvando layouts...');
  try {
    await apiRequest(`/api/return-analysis/layouts/${encodeURIComponent(unitCode)}`, {
      method: 'PUT',
      body: JSON.stringify({ fronts }),
    });
    if (unitCode === getReportUnit()) invalidateReturnAnalysis();
    await loadReturnLayouts(true, unitCode);
    returnSetStatus('#return-layout-status', `Layouts de ${unitCode} salvos no banco da Posição de Campo.`, 'success');
    showToast(`Layouts de ${unitCode} atualizados.`);
  } catch (error) {
    console.error(error);
    returnSetStatus('#return-layout-status', error.message || 'Não foi possível salvar os layouts.', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function renderReturnAnalysisFronts() {
  const unitCode = document.querySelector('#return-analysis-unit')?.value || '';
  const unit = returnUnitByCode(unitCode);
  const frontSelect = document.querySelector('#return-analysis-front');
  const options = (unit?.fronts || []).map(front => ({ value: front.code, label: `${front.code} — ${front.name}` }));
  returnFillSelect(frontSelect, options);
}

async function loadReturnLayouts(force = false, preferredUnit = '') {
  if (returnLayoutsLoading && !force) return;
  if (returnLayoutsState.units?.length && !force) {
    renderReturnUnitSelects();
    return;
  }
  returnLayoutsLoading = true;
  try {
    const payload = await apiRequest('/api/return-analysis/layouts');
    returnLayoutsState = payload && Array.isArray(payload.units) ? payload : { units: [] };
    renderReturnUnitSelects();
    if (preferredUnit) {
      const layoutSelect = document.querySelector('#return-layout-unit');
      const analysisSelect = document.querySelector('#return-analysis-unit');
      if ([...(layoutSelect?.options || [])].some(option => option.value === preferredUnit)) layoutSelect.value = preferredUnit;
      if ([...(analysisSelect?.options || [])].some(option => option.value === preferredUnit)) analysisSelect.value = preferredUnit;
      renderReturnLayoutRows();
      renderReturnAnalysisFronts();
    }
  } catch (error) {
    console.error(error);
    returnSetStatus('#return-layout-status', error.message || 'Não foi possível carregar os layouts.', 'error');
  } finally {
    returnLayoutsLoading = false;
  }
}
window.loadReturnLayouts = loadReturnLayouts;
document.addEventListener('report-unit-change', () => {
  renderReturnUnitSelects();
  invalidateReturnAnalysis();
  document.querySelector('#return-analysis-status').textContent = '';
  closeAllModals();
});

function validateReturnFile(file) {
  if (!file) return { valid: false, message: 'Selecione uma planilha Excel.' };
  const name = String(file.name || '').toLocaleLowerCase('pt-BR');
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm') || name.endsWith('.xls')) return { valid: true, message: '' };
  return { valid: false, message: 'Use um arquivo .xlsx, .xlsm ou .xls.' };
}

function updateReturnFileLabel() {
  const input = document.querySelector('#return-analysis-file');
  const label = document.querySelector('#return-analysis-file-name');
  const file = input?.files?.[0];
  if (!label) return;
  if (!file) {
    label.textContent = 'Nenhum arquivo selecionado';
    return;
  }
  label.textContent = `${file.name} · ${(file.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
  const validation = validateReturnFile(file);
  returnSetStatus('#return-analysis-status', validation.valid ? `Planilha pronta para processar: ${file.name}` : validation.message, validation.valid ? 'success' : 'error');
}

async function processReturnAnalysis(event) {
  event.preventDefault();
  if (returnAnalysisBusy || returnPresentationBusy) return;
  const unitCode = document.querySelector('#return-analysis-unit')?.value || '';
  const frontCode = document.querySelector('#return-analysis-front')?.value || '';
  const minGap = Math.max(1, Number(document.querySelector('#return-min-gap')?.value || 1));
  const file = document.querySelector('#return-analysis-file')?.files?.[0];
  const validation = validateReturnFile(file);
  if (!validation.valid) {
    returnSetStatus('#return-analysis-status', validation.message, 'error');
    return;
  }
  if (!unitCode || !frontCode) {
    returnSetStatus('#return-analysis-status', 'Selecione a unidade e a frente analisada.', 'error');
    return;
  }
  const button = document.querySelector('#return-analysis-process');
  invalidateReturnAnalysis();
  const epoch = returnAnalysisEpoch;
  returnAnalysisBusy = true;
  updateReturnPresentationButton();
  if (button) button.disabled = true;
  returnSetStatus('#return-analysis-status', 'Processando períodos, layouts e retornos...');
  try {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const query = new URLSearchParams({ unit: unitCode, front: frontCode, min_gap: String(minGap) });
    const response = await fetch(`/api/return-analysis/analyze?${query.toString()}`, { method: 'POST', body: formData });
    let payload = {};
    try { payload = await response.json(); } catch (error) { payload = {}; }
    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!response.ok) throw new Error(payload.error || 'Não foi possível processar a planilha.');
    if (getReportUnit() !== unitCode || epoch !== returnAnalysisEpoch) return;
    returnLastReport = payload.report || null;
    if (!returnLastReport || !payload.report_digest) throw new Error('A análise não retornou os dados para gerar a apresentação.');
    returnLastInput = { file, unitCode, frontCode, minGap, digest: payload.report_digest };
    renderReturnAnalysisResult(returnLastReport);
    returnSetStatus(
      '#return-analysis-status',
      `${file.name} processado: ${returnLastReport?.records || 0} registros válidos · ${returnLastReport?.returns_count || 0} retornos reais · ${returnLastReport?.possible_soil_wet_count || 0} possível(is) parada(s) por solo úmido.`,
      'success'
    );
  } catch (error) {
    console.error(error);
    if (epoch === returnAnalysisEpoch) returnSetStatus('#return-analysis-status', error.message || 'Não foi possível processar a planilha.', 'error');
  } finally {
    returnAnalysisBusy = false;
    if (button) button.disabled = false;
    updateReturnPresentationButton();
  }
}

async function generateReturnPresentation() {
  if (!returnLastInput || returnAnalysisBusy || returnPresentationBusy) return;
  const snapshot = returnLastInput;
  const epoch = returnAnalysisEpoch;
  if (getReportUnit() !== snapshot.unitCode) {
    invalidateReturnAnalysis();
    return;
  }
  returnPresentationBusy = true;
  const button = document.querySelector('#return-generate-presentation');
  if (button) button.textContent = 'Gerando apresentação...';
  updateReturnPresentationButton();
  returnSetStatus('#return-presentation-status', 'Preparando o PowerPoint no modelo CTT...');
  try {
    const formData = new FormData();
    formData.append('file', snapshot.file, snapshot.file.name);
    const query = new URLSearchParams({ unit: snapshot.unitCode, front: snapshot.frontCode, min_gap: String(snapshot.minGap), digest: snapshot.digest });
    const response = await fetch(`/api/return-analysis/presentation?${query}`, {
      method: 'POST', credentials: 'same-origin', body: formData,
    });
    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!response.ok) {
      let payload = {};
      try { payload = await response.json(); } catch (_) { /* Non-JSON gateway errors. */ }
      throw new Error(payload.error || 'Não foi possível gerar a apresentação.');
    }
    const mime = response.headers.get('Content-Type') || '';
    if (!mime.startsWith('application/vnd.openxmlformats-officedocument.presentationml.presentation')) {
      throw new Error('O servidor não retornou um arquivo PowerPoint. Tente novamente.');
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('O servidor retornou uma apresentação vazia.');
    // Não baixe o relatório anterior se a seleção mudou durante a geração.
    if (epoch !== returnAnalysisEpoch || returnLastInput !== snapshot) return;
    const match = (response.headers.get('Content-Disposition') || '').match(/filename="([A-Za-z0-9._-]+\.pptx)"/);
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = match?.[1] || 'analise-mudancas-area.pptx';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    returnSetStatus('#return-presentation-status', `Apresentação de ${snapshot.unitCode} / frente ${snapshot.frontCode} gerada.`, 'success');
    showToast('Apresentação gerada.');
  } catch (error) {
    if (epoch === returnAnalysisEpoch) returnSetStatus('#return-presentation-status', error.message || 'Não foi possível gerar a apresentação.', 'error');
  } finally {
    returnPresentationBusy = false;
    if (button) button.textContent = 'Gerar apresentação';
    updateReturnPresentationButton();
  }
}

function renderReturnKpis(report) {
  const container = document.querySelector('#return-kpis');
  if (!container) return;
  const kpis = [
    ['Retornos reais', report?.returns_count || 0, 'Com trabalho em outro setor no intervalo'],
    ['Possível solo úmido', report?.possible_soil_wet_count || 0, 'Sem atividade da frente no intervalo'],
    ['Setores com retorno', report?.return_sectors_count || 0, 'Setores distintos com retorno real'],
    ['Outras frentes', report?.other_front_periods_count || 0, 'Períodos atribuídos a outra frente'],
    ['Empates', report?.ties_count || 0, 'Períodos sem frente única'],
    ['Sem cadastro', report?.unknown_equipment_count || 0, 'Equipamentos fora da base de layouts'],
  ];
  container.innerHTML = kpis.map(([label, value, hint], index) => `
    <article class="excel-kpi ${index === 0 ? 'is-positive' : index === 1 && Number(value) ? 'is-warning' : index > 3 && Number(value) ? 'is-warning' : ''}">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(hint)}</span>
    </article>
  `).join('');
}

function renderReturnRows(report) {
  const body = document.querySelector('#return-results-body');
  if (!body) return;
  const rows = Array.isArray(report?.returns) ? report.returns : [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="return-table-empty">Nenhum retorno real identificado.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(item => `
    <tr>
      <td><strong>${escapeHtml(item.sector)}</strong></td>
      <td>${escapeHtml(returnFormatDate(item.entry_date))}</td>
      <td>${escapeHtml(returnFormatDate(item.exit_date))}</td>
      <td>${escapeHtml(returnFormatDate(item.return_date))}</td>
      <td>${escapeHtml(item.days_out)}</td>
      <td>${escapeHtml((item.sectors_during_absence || []).length ? item.sectors_during_absence.join(', ') : 'Sem registro de outro setor')}</td>
      <td>${escapeHtml(returnCountText(item.return_counts))}</td>
    </tr>
  `).join('');
}

function renderPossibleSoilWetRows(report) {
  const body = document.querySelector('#return-soil-wet-body');
  if (!body) return;
  const rows = Array.isArray(report?.possible_soil_wet) ? report.possible_soil_wet : [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="return-table-empty">Nenhum caso pendente de verificação por possível solo úmido.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(item => `
    <tr>
      <td><strong>${escapeHtml(item.sector)}</strong></td>
      <td>${escapeHtml(returnFormatDate(item.exit_date))}</td>
      <td>${escapeHtml(returnFormatDate(item.return_date))}</td>
      <td>${escapeHtml(item.days_out)}</td>
      <td>Sem registro da frente em outro setor</td>
      <td><strong>Possível parada por solo úmido — verificar</strong></td>
    </tr>
  `).join('');
}

function renderReturnOtherRows(report) {
  const body = document.querySelector('#return-other-body');
  if (!body) return;
  const rows = Array.isArray(report?.other_front_periods) ? report.other_front_periods : [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="return-table-empty">Nenhum período atribuído a outra frente.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(item => `
    <tr>
      <td>${escapeHtml(returnFormatPeriod(item.start, item.end))}</td>
      <td><strong>${escapeHtml(item.sector)}</strong></td>
      <td>${escapeHtml(item.assigned_front)}</td>
      <td>${escapeHtml(returnCountText(item.counts))}</td>
      <td>${escapeHtml((item.equipment || []).join(', '))}</td>
    </tr>
  `).join('');
}

function renderReturnAnalysisResult(report) {
  const results = document.querySelector('#return-analysis-results');
  if (!results || !report) return;
  document.querySelector('#return-meta-file').textContent = report.file || '-';
  document.querySelector('#return-meta-period').textContent = returnFormatPeriod(report.period?.start, report.period?.end);
  document.querySelector('#return-meta-scope').textContent = `${report.unit?.code || '-'} / ${report.target_front?.name || '-'}`;
  document.querySelector('#return-meta-count').textContent = `${report.returns_count || 0} retorno(s)`;
  document.querySelector('#return-report-text').textContent = report.report || '-';
  renderReturnKpis(report);
  renderReturnRows(report);
  renderPossibleSoilWetRows(report);
  renderReturnOtherRows(report);
  results.hidden = false;
}

async function copyReturnReport() {
  const text = returnLastReport?.report || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Resumo copiado.');
  } catch (error) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    showToast('Resumo copiado.');
  }
}

function setupReturnAnalysis() {
  document.querySelector('#return-open-layouts')?.addEventListener('click', openReturnLayoutsModal);
  document.querySelector('#return-layout-unit')?.addEventListener('change', () => {
    renderReturnLayoutRows();
    updateReturnLayoutUnitHint();
    returnSetStatus('#return-layout-status', '');
  });
  document.querySelector('#return-analysis-unit')?.addEventListener('change', () => { invalidateReturnAnalysis(); renderReturnAnalysisFronts(); });
  document.querySelector('#return-analysis-front')?.addEventListener('change', invalidateReturnAnalysis);
  document.querySelector('#return-min-gap')?.addEventListener('input', invalidateReturnAnalysis);
  document.querySelector('#return-add-front')?.addEventListener('click', () => appendReturnLayoutRow({}));
  document.querySelector('#return-save-layouts')?.addEventListener('click', saveReturnLayouts);
  document.querySelector('#return-layout-list')?.addEventListener('click', event => {
    const button = event.target.closest('.return-remove-front');
    if (!button) return;
    button.closest('.return-layout-row')?.remove();
  });
  document.querySelector('#return-analysis-file')?.addEventListener('change', () => { invalidateReturnAnalysis(); updateReturnFileLabel(); });
  document.querySelector('#return-analysis-form')?.addEventListener('submit', processReturnAnalysis);
  document.querySelector('#return-copy-report')?.addEventListener('click', copyReturnReport);
  document.querySelector('#return-generate-presentation')?.addEventListener('click', generateReturnPresentation);
  updateReturnPresentationButton();
}

setupReturnAnalysis();

loadReturnLayouts();
