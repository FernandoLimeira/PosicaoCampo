// Posição de Campo: visão geral das quatro unidades, fixa no topo da página (balança +
// posição de campo). Mesmos números da imagem "Troca de Turno CTT" (core/field-indicators.js):
// indicadores consolidados e um card por unidade com barras animadas (clicar abre a unidade
// abaixo). Dia e horário de fechamento escolhidos; o detalhe por hora, turno, troca de cana e
// frente vai no Excel (/api/weighings/report.xlsx).
// Depende de core/field-indicators.js, dashboard/dashboard.js e dashboard/weighing-panel.js
// (barra animada e diferença entrega × moagem).
let managementReportDate = '';
let managementReportTime = '';
let managementReportCustomSummary = null;

function managementReportQuery() {
  const query = new URLSearchParams({ date: managementReportDate || weighingSummary?.work_date || '' });
  if (managementReportTime) query.set('hora', managementReportTime);
  return query;
}

// Sem dia/horário escolhidos, o relatório usa o mesmo resumo ao vivo da tela.
function managementReportSummary() {
  return managementReportCustomSummary || weighingSummary;
}

async function loadManagementReport() {
  const live = (!managementReportDate || managementReportDate === weighingSummary?.work_date) && !managementReportTime;
  managementReportCustomSummary = live ? null : await apiRequest(`/api/weighings/summary?${managementReportQuery()}`);
}

function managementKpi(label, value, detail, tone = '') {
  return `<article class="mr-kpi ${tone}"><small>${escapeHtml(label)}</small><strong>${value}</strong><span>${escapeHtml(detail)}</span></article>`;
}

// Card de cada unidade (clicar abre a unidade abaixo): moagem do turno contra a indústria e
// processado do dia contra a projeção, em barras animadas, com entrega, estoque e ATR.
function managementUnitTile(unit, item, weighing) {
  const number = fieldIndicatorNumber;
  const share = fieldIndustryShare(item);
  const selected = unit.code === getReportUnit();
  const until = weighing?.closed_until ? new Date((weighing.closed_until - 1) * 1000).toLocaleTimeString('pt-BR', {
    timeZone: weighing.timezone || 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '';
  const ms = weighing?.timezone && weighing.timezone !== 'America/Sao_Paulo' ? ' (MS)' : '';
  const shareText = share ? `${share.percent}% da ind. ${number(item.industry)}`
    : item.industry > 0 ? `ind. ${number(item.industry)}` : 'indústria —';
  const delivery = item.deliveryShift !== null && item.deliveryShift !== undefined && item.millingShift !== null && item.millingShift !== undefined
    ? panelDiff(item.deliveryShift - item.millingShift, '') : '';
  const dayShare = item.day > 0 && item.projection > 0 ? item.day / item.projection : 0;
  return `<button type="button" class="ov-unit is-${escapeHtml(unit.border)}${selected ? ' is-selected' : ''}" data-overview-unit="${escapeHtml(unit.code)}"
      aria-pressed="${selected}" aria-label="Abrir ${escapeHtml(unit.code)} abaixo">
    <span class="ov-unit-head"><span><strong>${escapeHtml(unit.code)}</strong><small>${escapeHtml(unit.name)}</small></span>
      <span class="ov-chip">${item.active}/${item.rows.length} frentes</span></span>
    <span class="ov-unit-main"><span><small>Moagem turno</small><b>${number(item.millingShift)} <em>t/h</em></b></span>
      <span class="ov-share is-${share?.level || 'none'}">${escapeHtml(shareText)}</span></span>
    ${panelGauge(share ? share.share : 0, share?.level || 'none')}
    <span class="ov-unit-grid">
      <span><small>Entrega turno</small><b>${number(item.deliveryShift)}</b>${delivery}</span>
      <span><small>Estoque</small><b>${number(item.stock)}</b><i>cargas</i></span>
      <span><small>ATR</small><b>${number(item.atr, 2)}</b><i>kg/t</i></span>
    </span>
    <span class="ov-unit-day"><span><small>Processado dia</small><b>${number(item.day)} <em>t</em></b></span>
      <span><small>Projeção</small><b class="is-projection">${number(item.projection)} <em>t</em></b></span></span>
    ${panelGauge(dayShare, 'day')}
    <span class="ov-unit-foot">${until ? `Balança até ${escapeHtml(until)}${ms}` : 'Sem pesagem: indicadores do Preencher'}</span>
  </button>`;
}

function managementReportHtml() {
  const summary = managementReportSummary();
  const items = units.map(unit => fieldUnitIndicators(unit, summary));
  const totals = fieldIndicatorTotals(items);
  const weighingByCode = new Map((summary?.units || []).map(unit => [unit.code, unit]));

  const kpis = [
    managementKpi('Frentes em atividade', `${totals.active} <em>de ${totals.fronts}</em>`, `${totals.units} unidades`, 'is-green'),
    managementKpi('Indústrias', `${totals.running} <em>de ${totals.units}</em>`,
      totals.running === totals.units ? 'todas em operação' : `${totals.units - totals.running} parada(s)`),
    managementKpi('Moagem turno', `${fieldIndicatorNumber(totals.milling)} <em>t/h</em>`,
      `entrega ${fieldIndicatorNumber(totals.delivery)} t/h · estoque ${fieldIndicatorNumber(totals.stock)} cargas`),
    managementKpi('ATR médio geral', `${fieldIndicatorNumber(totals.atr, 2)} <em>kg/t</em>`,
      totals.atrUnits ? `média das ${totals.atrUnits} unidades` : 'sem pesagem', 'is-atr'),
    managementKpi('Processado dia', `${fieldIndicatorNumber(totals.day)} <em>t</em>`, 'soma das 4 unidades'),
    managementKpi('Projeção de moagem dia', `${fieldIndicatorNumber(totals.projection)} <em>t</em>`, 'média do dia × 24 h', 'is-projection')
  ].join('');
  const tiles = units.map((unit, index) => managementUnitTile(unit, items[index], weighingByCode.get(unit.code))).join('');

  const today = saoPauloIsoDate();
  const shownDay = managementReportDate || summary?.work_date || today;
  const dataUntil = (summary?.units || []).map(unit => unit.data_until).filter(Boolean);
  const until = dataUntil.length ? new Date(Math.max(...dataUntil) * 1000).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '';
  const source = summary?.reference_at
    ? `Balança do SELECT importado${until ? ` · dados até ${escapeHtml(until)}` : ''}${managementReportTime
      ? ` · fechamento às ${escapeHtml(managementReportTime)}` : ''}.`
    : 'Nenhuma pesagem importada para este dia: os indicadores vêm do Preencher.';
  return `<section class="dashboard-block management-report" aria-labelledby="management-report-title">
    <header class="mr-header">
      <div><h2 id="management-report-title">Visão geral das 4 unidades</h2>
        <p>${source} Clique numa unidade para abrir os detalhes dela abaixo.</p></div>
      <div class="mr-controls">
        <label class="field"><span>Dia</span><input id="management-report-date" type="date" max="${today}" value="${escapeHtml(shownDay)}" /></label>
        <label class="field" title="Mostra o dia como estava neste horário (para conferir com uma planilha de fechamento). Em branco: até a última hora importada."><span>Fechamento às</span>
          <input id="management-report-time" type="time" value="${escapeHtml(managementReportTime)}" /></label>
      </div>
    </header>
    <div class="mr-kpis">${kpis}</div>
    <div class="ov-units">${tiles}</div>
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
  // Clicar numa unidade (botão: Enter e espaço também) abre o card dela abaixo do dashboard.
  const openUnit = event => {
    const row = event.target.closest?.('[data-overview-unit]');
    if (!row) return;
    setReportUnit(row.dataset.overviewUnit);
    document.querySelector('#units-grid')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  document.addEventListener('click', event => {
    const exportButton = event.target.closest?.('#management-report-export');
    if (exportButton) exportManagementReport(exportButton);
    else openUnit(event);
  });
}
