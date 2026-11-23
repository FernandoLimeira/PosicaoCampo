// Visão geral da unidade selecionada, com os indicadores do fechamento.
let managementReportDate = '';
let managementReportTime = '';
let managementClosing = null;
let managementClosingRequest = 0;

function managementReportWeighing(summary) {
  return summary?.units?.find(item => item.code === getReportUnit());
}

function managementReportLiveDay() {
  return managementReportWeighing(weighingSummary)?.work_date || weighingSummary?.work_date || '';
}

function managementReportHistorical() {
  return Boolean(managementReportTime || (managementReportDate && managementReportDate !== managementReportLiveDay()));
}

function managementReportQuery() {
  const date = managementReportDate || managementReportLiveDay() || saoPauloIsoDate();
  const query = new URLSearchParams({ date });
  if (managementReportTime) query.set('hora', managementReportTime);
  return query;
}

function managementClosingKey(code) {
  return `${code}?${managementReportQuery()}`;
}

function managementReportView(base = units[selectedUnitIndex]) {
  if (!base) return {};
  if (!managementReportHistorical()) return {
    unit: base, summary: weighingSummary, meta: unitMeta[base.code], period: fieldCurrentPeriod,
    notes: fieldFrontNotesSummary, ready: true, historical: false
  };
  const closing = managementClosing?.key === managementClosingKey(base.code) ? managementClosing : null;
  const data = closing?.data;
  return {
    unit: data?.position?.unit || null, summary: data, meta: data?.position?.meta,
    period: data?.period, notes: data?.note_summaries || {}, cutoff: data?.units?.[0]?.position_until,
    ready: Boolean(data), error: closing?.error, historical: true
  };
}

async function loadManagementReport() {
  const request = ++managementClosingRequest;
  managementClosing = null;
  if (!managementReportHistorical()) return;
  const code = getReportUnit();
  const key = managementClosingKey(code);
  const query = managementReportQuery();
  query.set('unit', code);
  query.set('position', '1');
  const isCurrent = () => request === managementClosingRequest && key === managementClosingKey(getReportUnit());
  try {
    const data = await apiRequest(`/api/weighings/summary?${query}`, { cache: 'no-store' });
    if (!isCurrent()) return;
    if (data?.units?.[0]?.code !== code) throw new Error('Fechamento da unidade indisponível.');
    if (data.position?.unit) {
      data.position.unit = normalizeDashboardUnit(data.position.unit, units.findIndex(unit => unit.code === code));
    }
    managementClosing = { key, data };
  } catch (error) {
    if (!isCurrent()) return;
    managementClosing = { key, error: true };
    throw error;
  }
}

async function renderManagementClosing() {
  const loading = loadManagementReport();
  renderDashboard();
  try {
    await loading;
  } finally {
    renderDashboard();
  }
}

function managementKpi(label, value, detail = '', tone = '') {
  return `<article class="mr-kpi ${tone}"><small>${escapeHtml(label)}</small><strong>${value}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</article>`;
}

function managementReportHtml(view) {
  const base = units.find(item => item.code === getReportUnit());
  if (!base) return '';
  view ||= managementReportView(base);
  const unit = view.unit || { code: base.code, rows: [] };
  const summary = view.summary;
  const weighing = managementReportWeighing(summary);
  const item = fieldUnitIndicators(unit, summary);
  const share = fieldIndustryShare(item);
  const measure = (value, label, digits = 0) => value == null ? '—' : `${fieldIndicatorNumber(value, digits)} <em>${label}</em>`;
  const projection = item.projectionStopped ? 'Unidade parada' : measure(item.projection, 't');
  const kpis = [
    managementKpi('Moagem no turno', measure(item.millingShift, 't/h'), share ? `${share.percent}% da indústria` : '', 'is-green'),
    managementKpi('Entrega no turno', measure(item.deliveryShift, 't/h')),
    managementKpi('Estoque de pátio', measure(item.stock, 'cargas')),
    managementKpi('ATR parcial', measure(item.atr, 'kg/t', 2), '', 'is-atr'),
    managementKpi('Processado no dia', measure(item.day, 't')),
    managementKpi('Projeção de moagem', projection, '', item.projectionStopped ? '' : 'is-projection')
  ].join('');

  const today = saoPauloIsoDate();
  const shownDay = managementReportDate || weighing?.work_date || summary?.work_date || today;
  const timeZone = weighing?.timezone || 'America/Sao_Paulo';
  const until = item.closingRef && weighing?.closed_until
    ? new Date((weighing.closed_until - 1) * 1000).toLocaleString('pt-BR', {
      timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    }).replace(',', '') : '';
  const loadCount = ['PPT', 'NRD'].includes(unit.code) && Number.isInteger(weighing?.loads_day)
    ? ` · ${fieldIndicatorNumber(weighing.loads_day)} ${weighing.loads_day === 1 ? 'carga pesada' : 'cargas pesadas'}` : '';
  const source = view.error ? 'Fechamento indisponível.'
    : !view.ready ? 'Carregando fechamento…'
    : until ? `Balança até ${escapeHtml(until)}${timeZone === 'America/Sao_Paulo' ? '' : ' (MS)'}${loadCount}`
    : view.historical ? 'Sem pesagem neste dia no arquivo importado.'
    : view.unit ? 'Sem pesagem no fechamento. Indicadores do Preencher.' : 'Sem pesagem ou posição no fechamento.';
  // Dia escolhido sem pesagem: fica vazio, sem indicadores de outros dias.
  const showKpis = view.ready && !(view.historical && !until);
  return `<section class="dashboard-block management-report" aria-labelledby="management-report-title">
    <header class="mr-header">
      <div><h2 id="management-report-title">Visão geral · ${escapeHtml(unit.code)}</h2><p>${source}</p></div>
      <div class="mr-controls">
        <label class="field"><span>Dia</span><input id="management-report-date" type="date" max="${today}" value="${escapeHtml(shownDay)}" /></label>
        <label class="field" title="Em branco, usa a última hora fechada da balança."><span>Fechamento (Brasília)</span>
          <input id="management-report-time" type="time" value="${escapeHtml(managementReportTime)}" /></label>
      </div>
    </header>
    ${showKpis ? `<div class="mr-kpis">${kpis}</div>` : ''}
  </section>`;
}

function renderManagementReport(view) {
  const overview = document.querySelector('#field-overview');
  if (overview) overview.innerHTML = managementReportHtml(view);
}

function setupManagementReportEvents() {
  // Eventos pelo documento: o dashboard é redesenhado a cada atualização da pesagem.
  document.addEventListener('change', async event => {
    if (!['management-report-date', 'management-report-time'].includes(event.target?.id)) return;
    managementReportDate = document.querySelector('#management-report-date')?.value || '';
    managementReportTime = document.querySelector('#management-report-time')?.value || '';
    try {
      await renderManagementClosing();
      if (!managementReportHistorical()) await refreshFieldFrontNotes();
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Não foi possível carregar o fechamento.', true);
    }
  });
}
