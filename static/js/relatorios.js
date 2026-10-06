let excelReportData = null;
let excelFilteredTimeline = [];

function formatReportDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours >= 100) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatReportPercent(value) {
  const numeric = Number(value) || 0;
  return `${numeric.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatReportDate(isoDate) {
  if (!isoDate) return '-';
  const [year, month, day] = String(isoDate).split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(isoDate);
}

function formatReportClock(isoDateTime) {
  if (!isoDateTime) return '-';
  const text = String(isoDateTime);
  const timePart = text.includes('T') ? text.split('T')[1] : text;
  return timePart.slice(0, 5);
}

function reportScopeText(report) {
  const unitsText = Array.isArray(report.units) && report.units.length ? report.units.join(', ') : '-';
  const frontsText = Array.isArray(report.fronts) && report.fronts.length ? report.fronts.join(', ') : '-';
  return `${unitsText} · ${frontsText}`;
}

const EXCEL_METRIC_KEYS = ['total', 'productive', 'maintenance', 'improductive', 'climate', 'auxiliary', 'other'];
let excelSelectedDetail = null;

function emptyExcelTotals() {
  return Object.fromEntries(EXCEL_METRIC_KEYS.map(key => [key, 0]));
}

function addExcelTotals(target, source) {
  EXCEL_METRIC_KEYS.forEach(key => {
    target[key] += Number(source?.[key] || 0);
  });
  return target;
}

function finalizeExcelTotals(target) {
  const result = { ...target };
  result.utilization_pct = result.total ? (result.productive / result.total) * 100 : 0;
  const withoutClimate = Math.max(0, result.total - result.climate);
  result.utilization_without_climate_pct = withoutClimate ? (result.productive / withoutClimate) * 100 : 0;
  result.recoverable_loss = result.maintenance + result.improductive;
  return result;
}

function excelKpiHtml(label, value, detail, tone = 'neutral') {
  return `<article class="excel-kpi is-${tone}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></article>`;
}

function getExcelFilterValues() {
  return {
    unit: getReportUnit(),
    front: document.querySelector('#excel-filter-front')?.value || '',
    shift: document.querySelector('#excel-filter-shift')?.value || '',
    operator: document.querySelector('#excel-filter-operator')?.value || '',
    equipment: document.querySelector('#excel-filter-equipment')?.value || '',
    team: document.querySelector('#excel-filter-team')?.value || '',
    date: document.querySelector('#excel-filter-date')?.value || ''
  };
}

function setExcelFilterOptions(selector, items, valueKey, labelFn, defaultLabel) {
  const select = document.querySelector(selector);
  if (!select) return;
  const options = [`<option value="">${escapeHtml(defaultLabel)}</option>`];
  items.forEach(item => {
    const value = typeof valueKey === 'function' ? valueKey(item) : item?.[valueKey];
    options.push(`<option value="${escapeHtml(String(value ?? ''))}">${escapeHtml(labelFn(item))}</option>`);
  });
  select.innerHTML = options.join('');
}

function populateExcelReportFilters(report) {
  report = { ...report, performance_rows: (report.performance_rows || []).filter(item => matchesReportUnit(item.unit)) };
  const fronts = [...new Set((report.performance_rows || []).map(item => item.front).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const operatorsMap = new Map();
  (report.performance_rows || []).forEach(item => {
    if (!operatorsMap.has(item.operator_key)) operatorsMap.set(item.operator_key, item);
  });
  const operators = [...operatorsMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const equipmentKeys = new Set(report.performance_rows.map(item => item.equipment_key));
  const fleets = (report.fleets || []).filter(item => equipmentKeys.has(item.code || item.name || item.label));
  const dates = [...new Set(report.performance_rows.map(item => item.date).filter(Boolean))].sort();

  setExcelFilterOptions('#excel-filter-front', fronts, item => item, item => item, 'Todas');
  setExcelFilterOptions('#excel-filter-operator', operators, 'operator_key', item => `${item.name}${item.code ? ` · ${item.code}` : ''}`, 'Todos');
  setExcelFilterOptions('#excel-filter-equipment', fleets, item => item.code || item.name || item.label, item => item.label || item.code || item.name, 'Todas');
  setExcelFilterOptions('#excel-filter-date', dates, item => item, item => formatReportDate(item), 'Todas');
  ['#excel-filter-shift', '#excel-filter-team'].forEach(selector => {
    const select = document.querySelector(selector);
    if (select) select.value = '';
  });
}

function filterExcelPerformanceRows(report, filters) {
  return (report.performance_rows || []).filter(item => {
    if (filters.unit && !matchesReportUnit(item.unit, filters.unit)) return false;
    if (filters.front && item.front !== filters.front) return false;
    if (filters.shift && item.shift !== filters.shift) return false;
    if (filters.operator && item.operator_key !== filters.operator) return false;
    if (filters.equipment && item.equipment_key !== filters.equipment && item.equipment_code !== filters.equipment) return false;
    if (filters.date && item.date !== filters.date) return false;
    if (filters.team === 'team' && !item.team_member) return false;
    if (filters.team === 'occasional' && item.team_member) return false;
    return true;
  });
}

function filterExcelTimeline(report, filters) {
  return (report.timeline || []).filter(item => {
    if (filters.unit && !matchesReportUnit(item.unit, filters.unit)) return false;
    if (filters.front && item.front !== filters.front) return false;
    if (filters.shift && item.shift !== filters.shift) return false;
    if (filters.operator && item.operator_key !== filters.operator) return false;
    if (filters.equipment && item.equipment_key !== filters.equipment && item.equipment_code !== filters.equipment) return false;
    if (filters.date && item.date !== filters.date) return false;
    if (filters.team === 'team' && !item.team_member) return false;
    if (filters.team === 'occasional' && item.team_member) return false;
    return true;
  });
}

function summarizeExcelRows(rows, keyFn, seedFn) {
  const grouped = new Map();
  rows.forEach(row => {
    const key = keyFn(row);
    if (!grouped.has(key)) {
      grouped.set(key, { ...seedFn(row), ...emptyExcelTotals(), operatorKeys: new Set(), equipmentKeys: new Set(), dates: new Set() });
    }
    const item = grouped.get(key);
    addExcelTotals(item, row);
    if (row.operator_key) item.operatorKeys.add(row.operator_key);
    if (row.equipment_key) item.equipmentKeys.add(row.equipment_key);
    if (row.date) item.dates.add(row.date);
  });
  return [...grouped.values()].map(item => ({
    ...item,
    operators_count: item.operatorKeys.size,
    equipments_count: item.equipmentKeys.size,
    dates_list: [...item.dates].sort(),
    ...finalizeExcelTotals(item)
  }));
}

function renderExcelKpis(rows) {
  const totals = finalizeExcelTotals(rows.reduce((acc, item) => addExcelTotals(acc, item), emptyExcelTotals()));
  const operators = new Set(rows.map(item => item.operator_key).filter(Boolean));
  const fleets = new Set(rows.map(item => item.equipment_key).filter(Boolean));
  const target = document.querySelector('#excel-kpis');
  if (!target) return;
  target.innerHTML = [
    excelKpiHtml('Tempo analisado', formatReportDuration(totals.total), 'Dentro dos filtros atuais'),
    excelKpiHtml('Produtivo', formatReportDuration(totals.productive), 'Horas classificadas como produtivas', 'positive'),
    excelKpiHtml('Aprov. sem clima', formatReportPercent(totals.utilization_without_climate_pct), 'Produtivo ÷ tempo sem clima', 'positive'),
    excelKpiHtml('Perda recuperável', formatReportDuration(totals.recoverable_loss), 'Manutenção + improdutividade', totals.recoverable_loss ? 'warning' : 'neutral'),
    excelKpiHtml('Operadores', String(operators.size), 'Presentes no filtro'),
    excelKpiHtml('Frotas', String(fleets.size), 'Equipamentos utilizados')
  ].join('');
}

function entityButtonHtml(type, item) {
  const label = type === 'fleet' ? item.equipment_label : item.name;
  const secondary = type === 'fleet'
    ? `${item.operators_count} operador(es) · ${formatReportDuration(item.total)}`
    : `${item.equipments_count} frota(s) · ${formatReportDuration(item.total)}`;
  const key = type === 'fleet' ? item.equipment_key : item.operator_key;
  return `
    <button class="excel-entity-row" type="button" data-report-entity="${type}" data-report-key="${escapeHtml(key)}">
      <span class="excel-entity-icon" aria-hidden="true">${type === 'fleet' ? '🚜' : '👤'}</span>
      <span class="excel-entity-copy"><strong>${escapeHtml(label || '-')}</strong><small>${escapeHtml(secondary)}</small></span>
      <span class="excel-entity-metric"><strong>${escapeHtml(formatReportPercent(item.utilization_without_climate_pct))}</strong><small>aprov.</small></span>
      <span class="excel-entity-chevron" aria-hidden="true">›</span>
    </button>`;
}

function renderExcelEntityLists(rows) {
  const fleets = summarizeExcelRows(rows, row => row.equipment_key, row => ({
    equipment_key: row.equipment_key,
    equipment_code: row.equipment_code,
    equipment_name: row.equipment_name,
    equipment_label: row.equipment_label || row.equipment_key
  })).sort((a, b) => String(a.equipment_label).localeCompare(String(b.equipment_label), 'pt-BR'));

  const operators = summarizeExcelRows(rows, row => row.operator_key, row => ({
    operator_key: row.operator_key,
    code: row.code,
    name: row.name,
    is_generic: Boolean(row.is_generic)
  })).filter(item => !item.is_generic).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));

  const fleetList = document.querySelector('#excel-fleet-list');
  const operatorList = document.querySelector('#excel-operator-list');
  if (fleetList) fleetList.innerHTML = fleets.length ? fleets.map(item => entityButtonHtml('fleet', item)).join('') : '<div class="excel-empty-state">Nenhuma frota nos filtros atuais.</div>';
  if (operatorList) operatorList.innerHTML = operators.length ? operators.map(item => entityButtonHtml('operator', item)).join('') : '<div class="excel-empty-state">Nenhum operador nos filtros atuais.</div>';
  document.querySelector('#excel-fleet-list-count').textContent = String(fleets.length);
  document.querySelector('#excel-operator-list-count').textContent = String(operators.length);
}

function reportTimestamp(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function equipmentMatches(item, key) {
  return item.equipment_key === key || item.equipment_code === key;
}

function findPrimaryFleetForOperator(rows, operatorKey) {
  const totals = new Map();
  rows.filter(row => row.operator_key === operatorKey).forEach(row => {
    totals.set(row.equipment_key, (totals.get(row.equipment_key) || 0) + Number(row.total || 0));
  });
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function buildThreeOperatorComparison(rows, fleetKey) {
  const fleetRows = rows.filter(row => equipmentMatches(row, fleetKey));
  const byShiftOperator = summarizeExcelRows(
    fleetRows,
    row => `${row.shift}|${row.operator_key}`,
    row => ({ shift: row.shift, operator_key: row.operator_key, name: row.name, code: row.code, equipment_label: row.equipment_label || row.equipment_key, is_generic: Boolean(row.is_generic) })
  ).filter(item => !item.is_generic);

  return ['A', 'B', 'C'].map(shift => {
    const candidates = byShiftOperator.filter(item => item.shift === shift).sort((a, b) => b.total - a.total || b.productive - a.productive);
    return candidates[0] || { shift, empty: true };
  });
}

function renderThreeOperatorComparison(rows, fleetKey) {
  const container = document.querySelector('#excel-three-operator-comparison');
  if (!container) return;
  const comparison = buildThreeOperatorComparison(rows, fleetKey);
  const valid = comparison.filter(item => !item.empty && (item.total - item.climate) > 0);
  const best = [...valid].sort((a, b) => b.utilization_without_climate_pct - a.utilization_without_climate_pct || b.productive - a.productive)[0];
  const lowest = valid.length > 1 ? [...valid].sort((a, b) => a.utilization_without_climate_pct - b.utilization_without_climate_pct || a.productive - b.productive)[0] : null;

  container.innerHTML = comparison.map(item => {
    if (item.empty) return `<article class="excel-comparison-card is-empty"><span>Turno ${item.shift}</span><strong>Sem operador</strong><small>Não há dados neste turno para a frota selecionada.</small></article>`;
    const isBest = best && best.operator_key === item.operator_key && best.shift === item.shift;
    const isLow = lowest && lowest.operator_key === item.operator_key && lowest.shift === item.shift && !isBest;
    return `
      <article class="excel-comparison-card ${isBest ? 'is-best' : (isLow ? 'is-low' : '')}">
        <div class="excel-comparison-card-head"><span>Turno ${escapeHtml(item.shift)}</span>${isBest ? '<b>Maior aproveitamento</b>' : (isLow ? '<b>Menor aproveitamento</b>' : '')}</div>
        <h4>${escapeHtml(item.name)}</h4>
        <p>${escapeHtml(item.equipment_label || fleetKey)}</p>
        <div class="excel-comparison-metrics">
          <span><small>Aprov. sem clima</small><strong>${escapeHtml(formatReportPercent(item.utilization_without_climate_pct))}</strong></span>
          <span><small>Produtivo</small><strong>${escapeHtml(formatReportDuration(item.productive))}</strong></span>
          <span><small>Manutenção</small><strong>${escapeHtml(formatReportDuration(item.maintenance))}</strong></span>
          <span><small>Improdutivo</small><strong>${escapeHtml(formatReportDuration(item.improductive))}</strong></span>
        </div>
      </article>`;
  }).join('');
}

function categoryIcon(category) {
  if (category === 'productive') return '✅';
  if (category === 'maintenance') return '🔧';
  if (category === 'improductive') return '⚠';
  if (category === 'climate') return '🌧';
  return 'ℹ';
}

function occurrenceItem(icon, text, meta = '', tone = 'neutral') {
  return { icon, text, meta, tone };
}

function buildShiftChangeOccurrences(events) {
  const items = [];
  const byFleet = new Map();
  events.forEach(event => {
    const key = event.equipment_key || event.equipment_code;
    if (!key) return;
    if (!byFleet.has(key)) byFleet.set(key, []);
    byFleet.get(key).push(event);
  });

  byFleet.forEach(fleetEvents => {
    fleetEvents.sort((a, b) => reportTimestamp(a.start) - reportTimestamp(b.start));
    for (let index = 1; index < fleetEvents.length; index += 1) {
      const previous = fleetEvents[index - 1];
      const current = fleetEvents[index];
      if (previous.shift === current.shift) continue;
      const gapSeconds = Math.max(0, Math.round((reportTimestamp(current.start) - reportTimestamp(previous.end)) / 1000));
      if (gapSeconds > 180) {
        items.push(occurrenceItem('⚠', `Troca de turno durou ${formatReportDuration(gapSeconds)}, acima do limite de 3 minutos.`, `${formatReportDate(current.date)} · Turno ${previous.shift} → ${current.shift} · ${current.equipment_code || current.equipment_key}`, 'warning'));
      }

      const boundary = reportTimestamp(current.start);
      const windowStart = boundary - 3600 * 1000;
      const hourEvents = fleetEvents.filter(event => reportTimestamp(event.start) < boundary && reportTimestamp(event.end) > windowStart && reportTimestamp(event.end) <= boundary + 1000);
      let lastProductiveIndex = -1;
      hourEvents.forEach((event, eventIndex) => { if (event.category === 'productive') lastProductiveIndex = eventIndex; });
      if (lastProductiveIndex >= 0) {
        const afterProductive = hourEvents.slice(lastProductiveIndex + 1);
        const onlyImproductive = afterProductive.length && afterProductive.every(event => event.category === 'improductive');
        const reachesBoundary = afterProductive.length && Math.abs(boundary - reportTimestamp(afterProductive[afterProductive.length - 1].end)) <= 5 * 60 * 1000;
        if (onlyImproductive && reachesBoundary) {
          const total = afterProductive.reduce((sum, event) => sum + Number(event.seconds || 0), 0);
          const operations = [...new Set(afterProductive.map(event => event.operation).filter(Boolean))].join(', ');
          items.push(occurrenceItem('⚠', `Na hora anterior à troca de turno, o equipamento saiu de atividade produtiva, entrou somente em atividade(s) improdutiva(s) (${operations || 'sem descrição'}) e permaneceu assim até a troca, totalizando ${formatReportDuration(total)} de parada improdutiva.`, `${formatReportDate(current.date)} · ${current.equipment_code || current.equipment_key}`, 'warning'));
        }
      }
    }
  });
  return items;
}

function buildEventOccurrences(events) {
  const items = [];
  const sorted = [...events].sort((a, b) => reportTimestamp(a.start) - reportTimestamp(b.start));
  sorted.forEach(event => {
    const seconds = Number(event.seconds || 0);
    if (event.category === 'productive' && seconds < 1800) return;
    if (['maintenance', 'improductive'].includes(event.category) && seconds < 300) return;
    if (event.category === 'climate' && seconds < 900) return;
    if (['auxiliary', 'other'].includes(event.category) && seconds < 1200) return;
    const operator = event.operator_name ? ` · ${event.operator_name}` : '';
    const fleet = event.equipment_code || event.equipment_key || 'sem frota';
    items.push(occurrenceItem(
      categoryIcon(event.category),
      `${formatReportDate(event.date)} · ${formatReportClock(event.start)}–${formatReportClock(event.end)} · ${event.operation || event.category_label || 'Atividade'} por ${formatReportDuration(seconds)}.`,
      `Turno ${event.shift} · Frota ${fleet}${operator}`,
      event.category === 'productive' ? 'positive' : (['maintenance', 'improductive'].includes(event.category) ? 'warning' : 'neutral')
    ));
  });
  return items;
}

function renderOccurrenceList(events) {
  const container = document.querySelector('#excel-occurrence-list');
  if (!container) return;
  const occurrences = [...buildShiftChangeOccurrences(events), ...buildEventOccurrences(events)];
  if (!occurrences.length) {
    container.innerHTML = '<div class="excel-empty-state">Nenhum acontecimento relevante foi identificado para esta seleção.</div>';
    return;
  }
  container.innerHTML = occurrences.slice(0, 60).map(item => `
    <article class="excel-occurrence-item is-${item.tone}">
      <span class="excel-occurrence-icon" aria-hidden="true">${item.icon}</span>
      <div><p>${escapeHtml(item.text)}</p>${item.meta ? `<small>${escapeHtml(item.meta)}</small>` : ''}</div>
    </article>`).join('');
}

function renderDetailKpis(rows) {
  const totals = finalizeExcelTotals(rows.reduce((acc, item) => addExcelTotals(acc, item), emptyExcelTotals()));
  const target = document.querySelector('#excel-detail-kpis');
  if (!target) return;
  target.innerHTML = [
    excelKpiHtml('Tempo', formatReportDuration(totals.total), 'Tempo analisado'),
    excelKpiHtml('Produtivo', formatReportDuration(totals.productive), 'Horas produtivas', 'positive'),
    excelKpiHtml('Aprov. sem clima', formatReportPercent(totals.utilization_without_climate_pct), 'Indicador comparável', 'positive'),
    excelKpiHtml('Manutenção', formatReportDuration(totals.maintenance), 'Paradas de manutenção', totals.maintenance ? 'warning' : 'neutral'),
    excelKpiHtml('Improdutivo', formatReportDuration(totals.improductive), 'Perdas operacionais', totals.improductive ? 'warning' : 'neutral')
  ].join('');
}

function openExcelDetail(type, key) {
  if (!excelReportData) return;
  const filters = getExcelFilterValues();
  const allRows = filterExcelPerformanceRows(excelReportData, filters);
  const allEvents = filterExcelTimeline(excelReportData, filters);
  let detailRows = [];
  let detailEvents = [];
  let fleetKey = '';
  let title = '';
  let subtitle = '';

  if (type === 'fleet') {
    fleetKey = key;
    detailRows = allRows.filter(row => equipmentMatches(row, key));
    detailEvents = allEvents.filter(event => equipmentMatches(event, key));
    const first = detailRows[0] || detailEvents[0];
    title = first?.equipment_label || (first?.equipment_name ? `${first?.equipment_code || key} · ${first.equipment_name}` : key);
    subtitle = 'Comparação dos operadores que utilizaram esta frota nos turnos A, B e C.';
    document.querySelector('#excel-detail-kicker').textContent = 'Frota selecionada';
  } else {
    detailRows = allRows.filter(row => row.operator_key === key);
    detailEvents = allEvents.filter(event => event.operator_key === key);
    fleetKey = findPrimaryFleetForOperator(allRows, key);
    const first = detailRows[0] || detailEvents[0];
    title = first?.name || first?.operator_name || key;
    const fleetLabel = detailRows.find(row => row.equipment_key === fleetKey)?.equipment_label || fleetKey || 'sem frota principal';
    subtitle = `Comparativo com os operadores dos outros turnos na frota predominante: ${fleetLabel}.`;
    document.querySelector('#excel-detail-kicker').textContent = 'Operador selecionado';
  }

  if (!detailRows.length && !detailEvents.length) {
    showToast('Não há dados para essa seleção dentro dos filtros atuais.');
    return;
  }

  excelSelectedDetail = { type, key, fleetKey };
  document.querySelector('#excel-detail-title').textContent = title || '-';
  document.querySelector('#excel-detail-subtitle').textContent = subtitle;
  renderDetailKpis(detailRows);
  renderThreeOperatorComparison(allRows, fleetKey);
  renderOccurrenceList(detailEvents);
  excelFilteredTimeline = detailEvents;
  openModal('excel-detail-modal');
}

function closeExcelDetail() {
  excelSelectedDetail = null;
  excelFilteredTimeline = [];
  closeModal('excel-detail-modal');
}

function applyExcelReportFilters() {
  if (!excelReportData) return;
  const filters = getExcelFilterValues();
  const rows = filterExcelPerformanceRows(excelReportData, filters);
  const notice = document.querySelector('#excel-unit-notice');
  if (notice) {
    notice.hidden = rows.length > 0;
    notice.textContent = `Sem dados para ${filters.unit} nos filtros atuais. Confira a coluna Unidade da planilha ou ajuste os filtros.`;
  }
  document.querySelector('#excel-meta-scope').textContent = `${filters.unit} · ${[...new Set(rows.map(row => row.front).filter(Boolean))].join(', ') || 'Sem dados para esta unidade'}`;
  document.querySelector('#excel-meta-counts').textContent = `${rows.length} agrupamentos · ${new Set(rows.map(row => row.operator_key)).size} operadores · ${new Set(rows.map(row => row.equipment_key)).size} frotas`;
  renderExcelKpis(rows);
  renderExcelEntityLists(rows);
  closeExcelDetail();
}

document.addEventListener('report-unit-change', () => {
  if (excelReportData) populateExcelReportFilters(excelReportData);
  applyExcelReportFilters();
});

function renderExcelReport(report) {
  excelReportData = report;
  const results = document.querySelector('#excel-report-results');
  if (!results) return;
  document.querySelector('#excel-meta-file').textContent = report.file || '-';
  const start = formatReportDate(report.period?.start);
  const end = formatReportDate(report.period?.end);
  document.querySelector('#excel-meta-period').textContent = start === end ? start : `${start} a ${end}`;
  document.querySelector('#excel-meta-scope').textContent = reportScopeText(report);
  document.querySelector('#excel-meta-counts').textContent = `${report.records || 0} registros · ${report.operators_count || 0} operadores · ${report.equipments_count || 0} frotas`;
  populateExcelReportFilters(report);

  const unclassified = document.querySelector('#excel-unclassified');
  if (unclassified) {
    const operations = Array.isArray(report.unclassified_operations) ? report.unclassified_operations : [];
    unclassified.hidden = !operations.length;
    unclassified.innerHTML = operations.length ? `<strong>Operações ainda não classificadas:</strong> ${operations.map(escapeHtml).join(', ')}.` : '';
  }

  results.hidden = false;
  applyExcelReportFilters();
}



function excelFileValidation(file) {
  if (!file) return { valid: false, message: 'Selecione um arquivo CSV ou Excel para processar.' };
  const filename = String(file.name || '').trim().toLocaleLowerCase('pt-BR');
  if (filename.endsWith('.csv') || filename.endsWith('.xlsx') || filename.endsWith('.xlsm')) {
    return { valid: true, message: '' };
  }
  if (filename.endsWith('.xls')) {
    return { valid: false, message: 'O formato .xls antigo não é suportado. Salve o arquivo como .xlsx, .xlsm ou CSV.' };
  }
  return { valid: false, message: 'Selecione um arquivo CSV, .xlsx ou .xlsm.' };
}

function excelFileTypeLabel(file) {
  const filename = String(file?.name || '').trim().toLocaleLowerCase('pt-BR');
  if (filename.endsWith('.csv')) return 'CSV';
  if (filename.endsWith('.xlsm')) return 'Excel XLSM';
  if (filename.endsWith('.xlsx')) return 'Excel XLSX';
  return 'Arquivo';
}

function updateExcelFileLabel(inputElement = null) {
  const input = inputElement?.matches?.('#excel-report-file') ? inputElement : document.querySelector('#excel-report-file');
  const label = document.querySelector('#excel-report-file-name');
  const status = document.querySelector('#excel-report-status');
  if (!label) return;
  const file = input?.files?.[0];
  if (!file) {
    label.textContent = 'Nenhum arquivo selecionado';
    return;
  }
  label.textContent = `${file.name} · ${(file.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
  const validation = excelFileValidation(file);
  if (status) {
    status.className = validation.valid ? 'excel-report-status is-success' : 'excel-report-status is-error';
    status.textContent = validation.valid ? `${excelFileTypeLabel(file)} identificado: ${file.name}` : validation.message;
  }
}

function setupExcelReportFileHandling() {
  document.addEventListener('change', event => {
    if (!event.target?.matches?.('#excel-report-file')) return;
    updateExcelFileLabel(event.target);
  });
  document.addEventListener('submit', event => {
    if (!event.target?.matches?.('#excel-report-form')) return;
    processExcelReport(event);
  });
  document.addEventListener('click', event => {
    const entity = event.target.closest('[data-report-entity]');
    if (entity) {
      openExcelDetail(entity.dataset.reportEntity, entity.dataset.reportKey || '');
      return;
    }
  });
}

async function processExcelReport(event) {
  event.preventDefault();
  const input = document.querySelector('#excel-report-file');
  const file = input?.files?.[0];
  const button = document.querySelector('#excel-report-process');
  const status = document.querySelector('#excel-report-status');
  const validation = excelFileValidation(file);
  if (!validation.valid) {
    if (status) {
      status.className = 'excel-report-status is-error';
      status.textContent = validation.message;
    }
    return;
  }
  if (button) button.disabled = true;
  if (status) {
    status.className = 'excel-report-status';
    status.textContent = `Processando ${excelFileTypeLabel(file)}, turnos, operadores, frotas e acontecimentos...`;
  }
  try {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const response = await fetch('/api/reports/excel/analyze', { method: 'POST', body: formData });
    let payload = {};
    try { payload = await response.json(); } catch (error) { payload = {}; }
    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!response.ok) throw new Error(payload.error || 'Não foi possível processar o arquivo importado.');
    renderExcelReport(payload.report || {});
    if (status) {
      status.className = 'excel-report-status is-success';
      status.textContent = `${excelFileTypeLabel(file)} processado: ${payload.report?.records || 0} registros válidos · ${payload.report?.operators_count || 0} operadores · ${payload.report?.equipments_count || 0} frotas.`;
    }
  } catch (error) {
    console.error(error);
    if (status) {
      status.className = 'excel-report-status is-error';
      status.textContent = error.message || 'Não foi possível processar o arquivo importado.';
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function resetExcelReportFilters() {
  ['#excel-filter-front', '#excel-filter-shift', '#excel-filter-operator', '#excel-filter-equipment', '#excel-filter-team', '#excel-filter-date'].forEach(selector => {
    const field = document.querySelector(selector);
    if (field) field.value = '';
  });
  applyExcelReportFilters();
}

function csvReportValue(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text.trimStart())) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadExcelTimelineCsv() {
  if (!excelReportData || !excelFilteredTimeline.length) {
    showToast('Abra uma frota ou operador antes de baixar a linha do tempo.');
    return;
  }
  const headers = ['Data', 'Frente', 'Turno', 'Operador', 'Frota', 'Início', 'Fim', 'Operação', 'Classificação', 'Duração'];
  const rows = excelFilteredTimeline.map(item => [formatReportDate(item.date), item.front, item.shift, item.operator_name, item.equipment_code || item.equipment_key || '', formatReportClock(item.start), formatReportClock(item.end), item.operation, item.category_label, formatReportDuration(item.seconds)]);
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvReportValue).join(';')).join('\r\n');
  downloadBlobFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `Linha-do-Tempo-${excelReportData.period?.start || 'relatorio'}.csv`);
}

  document.querySelector('#excel-download-timeline-csv')?.addEventListener('click', downloadExcelTimelineCsv);
  document.querySelector('#excel-filter-reset')?.addEventListener('click', resetExcelReportFilters);
  ['#excel-filter-front', '#excel-filter-shift', '#excel-filter-operator', '#excel-filter-equipment', '#excel-filter-team', '#excel-filter-date'].forEach(selector => {
    document.querySelector(selector)?.addEventListener('change', applyExcelReportFilters);
  });


setupExcelReportFileHandling();
