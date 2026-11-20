// Visão geral da unidade selecionada, com os indicadores do fechamento.
// O Excel gerencial continua disponível no botão Exportar Excel.
let managementReportDate = '';
let managementReportTime = '';
let managementReportCustomSummary = null;

function managementReportWeighing(summary) {
  return summary?.units?.find(item => item.code === getReportUnit());
}

function managementReportLiveDay() {
  return managementReportWeighing(weighingSummary)?.work_date || weighingSummary?.work_date || '';
}

function managementReportQuery() {
  const date = managementReportDate || managementReportLiveDay();
  const query = new URLSearchParams({ date });
  if (managementReportTime) query.set('hora', managementReportTime);
  return query;
}

async function loadManagementReport() {
  managementReportCustomSummary = managementReportDate || managementReportTime
    ? await apiRequest(`/api/weighings/summary?${managementReportQuery()}`) : null;
}

function managementKpi(label, value, detail = '', tone = '') {
  return `<article class="mr-kpi ${tone}"><small>${escapeHtml(label)}</small><strong>${value}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</article>`;
}

function managementReportHtml() {
  const unit = units.find(item => item.code === getReportUnit());
  if (!unit) return '';
  const live = !managementReportTime && (!managementReportDate || managementReportDate === managementReportLiveDay());
  const summary = live ? weighingSummary : managementReportCustomSummary || weighingSummary;
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
  const source = until
    ? `Balança até ${escapeHtml(until)}${timeZone === 'America/Sao_Paulo' ? '' : ' (MS)'}${loadCount}`
    : 'Sem pesagem no fechamento. Indicadores do Preencher.';
  return `<section class="dashboard-block management-report" aria-labelledby="management-report-title">
    <header class="mr-header">
      <div><h2 id="management-report-title">Visão geral · ${escapeHtml(unit.code)}</h2><p>${source}</p></div>
      <div class="mr-controls">
        <label class="field"><span>Dia</span><input id="management-report-date" type="date" max="${today}" value="${escapeHtml(shownDay)}" /></label>
        <label class="field" title="Em branco, usa a última hora fechada da balança."><span>Fechamento (Brasília)</span>
          <input id="management-report-time" type="time" value="${escapeHtml(managementReportTime)}" /></label>
      </div>
    </header>
    <div class="mr-kpis">${kpis}</div>
  </section>`;
}

function renderManagementReport() {
  const overview = document.querySelector('#field-overview');
  if (overview) overview.innerHTML = managementReportHtml();
}

async function exportManagementReport(button) {
  button.disabled = true;
  try {
    const response = await fetch(`/api/weighings/report.xlsx?${managementReportQuery()}`, { credentials: 'same-origin' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Não foi possível gerar o Excel.');
    }
    const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || 'Relatorio-gerencial.xlsx';
    downloadBlobFile(await response.blob(), name);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível gerar o Excel.', true);
  } finally {
    button.disabled = false;
  }
}

function setupManagementReportEvents() {
  // Eventos pelo documento: o dashboard é redesenhado a cada atualização da pesagem.
  document.addEventListener('change', async event => {
    if (!['management-report-date', 'management-report-time'].includes(event.target?.id)) return;
    managementReportDate = document.querySelector('#management-report-date')?.value || '';
    managementReportTime = document.querySelector('#management-report-time')?.value || '';
    try {
      await loadManagementReport();
      renderManagementReport();
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Não foi possível carregar os indicadores.', true);
    }
  });
  document.addEventListener('click', event => {
    const exportButton = event.target.closest?.('#management-report-export');
    if (exportButton) exportManagementReport(exportButton);
  });
}
