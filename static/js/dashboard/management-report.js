// Posição de Campo: dashboard gerencial das quatro unidades, fixo no topo da página
// (balança + posição de campo). Mesmos números da imagem "Troca de Turno CTT"
// (core/field-indicators.js): resumo geral e comparativo das unidades (clicar numa unidade
// abre o card dela abaixo) e, em "Detalhes", hora a hora, turnos, troca de cana e frentes.
// Dia e horário de fechamento escolhidos; exportação em Excel (/api/weighings/report.xlsx).
// Depende de core/field-indicators.js, dashboard/dashboard.js e dashboard/weighing-panel.js
// (gráfico por hora e diferença).
let managementReportDate = '';
let managementReportTime = '';
let managementReportCustomSummary = null;
let managementDetailsOpen = false;

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

function managementCell(value, digits = 0) {
  return `<td>${escapeHtml(fieldIndicatorNumber(value, digits))}</td>`;
}

function managementDiffCell(delivery, milling) {
  return `<td>${delivery === null || delivery === undefined || milling === null || milling === undefined ? '—' : panelDiff(delivery - milling, '')}</td>`;
}

function managementKpi(label, value, detail, tone = '') {
  return `<article class="mr-kpi ${tone}"><small>${escapeHtml(label)}</small><strong>${value}</strong><span>${escapeHtml(detail)}</span></article>`;
}

function managementReportHtml() {
  const summary = managementReportSummary();
  const items = units.map(unit => fieldUnitIndicators(unit, summary));
  const totals = fieldIndicatorTotals(items);
  const weighingByCode = new Map((summary?.units || []).map(unit => [unit.code, unit]));
  const closedText = code => {
    const unit = weighingByCode.get(code);
    return unit?.closed_until ? new Date((unit.closed_until - 1) * 1000).toLocaleTimeString('pt-BR', {
      timeZone: unit.timezone || 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '—';
  };

  const kpis = [
    managementKpi('Frentes em atividade', `${totals.active} <em>de ${totals.fronts}</em>`, `${totals.units} unidades`, 'is-green'),
    managementKpi('Indústrias', `${totals.running} <em>de ${totals.units}</em>`,
      totals.running === totals.units ? 'todas em operação' : `${totals.units - totals.running} parada(s)`),
    managementKpi('Moagem turno', `${fieldIndicatorNumber(totals.milling)} <em>t/h</em>`,
      `entrega ${fieldIndicatorNumber(totals.delivery)} t/h · estoque ${fieldIndicatorNumber(totals.stock)} cargas`),
    managementKpi('ATR médio geral', `${fieldIndicatorNumber(totals.atr, 2)} <em>kg/t</em>`,
      totals.atrUnits ? `média das ${totals.atrUnits} unidades` : 'sem pesagem', 'is-atr'),
    managementKpi('Processado dia', `${fieldIndicatorNumber(totals.day)} <em>t</em>`, `cana entregue ${fieldIndicatorNumber(totals.deliveryDay)} t`),
    managementKpi('Projeção de moagem dia', `${fieldIndicatorNumber(totals.projection)} <em>t</em>`, 'média do dia × 24 h', 'is-projection')
  ].join('');

  const unitRows = units.map((unit, index) => {
    const item = items[index];
    const share = fieldIndustryShare(item);
    const selected = unit.code === getReportUnit();
    return `<tr class="mr-unit-row${selected ? ' is-selected' : ''}" data-overview-unit="${escapeHtml(unit.code)}" tabindex="0"
      aria-label="Abrir ${escapeHtml(unit.code)} abaixo"${selected ? ' aria-current="true"' : ''}>
      <th scope="row">${escapeHtml(unit.code)}<small>${escapeHtml(unit.name)}</small></th>
      <td>${item.active}/${item.rows.length}</td>${managementCell(item.industry)}
      ${managementCell(item.millingShift)}<td>${share ? `<span class="mr-share is-${share.level}">${share.percent}%</span>` : '—'}</td>
      ${managementCell(item.deliveryShift)}${managementDiffCell(item.deliveryShift, item.millingShift)}
      ${managementCell(item.milling3h)}${managementCell(item.delivery3h)}${managementCell(item.stock)}${managementCell(item.atr, 2)}
      ${managementCell(item.day)}${managementCell(item.deliveryDay)}${managementCell(item.projection)}<td>${escapeHtml(closedText(unit.code))}</td></tr>`;
  }).join('');

  const shiftRows = units.flatMap((unit, index) => ['A', 'B', 'C'].map(code => {
    const hours = items[index].hours.filter(item => item.shift === code);
    if (!hours.length) return '';
    const milling = hours.reduce((sum, item) => sum + (item.milling_t || 0), 0);
    const delivery = hours.reduce((sum, item) => sum + (item.delivery_t || 0), 0);
    return `<tr><th scope="row">${escapeHtml(unit.code)} · Turno ${code}<small>${hours.length} ${hours.length === 1 ? 'hora' : 'horas'}</small></th>
      ${managementCell(milling)}${managementCell(delivery)}${managementDiffCell(delivery, milling)}
      ${managementCell(panelAverage(hours, 'milling_t'))}${managementCell(panelAverage(hours, 'delivery_t'))}</tr>`;
  })).join('');

  const charts = units.map((unit, index) => {
    const hours = items[index].hours;
    return `<figure class="wp-chart mr-chart"><figcaption><strong>${escapeHtml(unit.code)} · hora a hora (t)</strong>
        <span class="wp-legend"><span><svg class="wp-key" width="10" height="10" aria-hidden="true"><rect class="wp-bar" width="10" height="10" rx="2"></rect></svg>Moagem</span>
        <span><svg class="wp-key" width="14" height="10" aria-hidden="true"><line class="wp-line" x1="1" x2="13" y1="5" y2="5"></line></svg>Cana entregue</span></span></figcaption>
      ${hours.length ? `<div class="wp-chart-wrap">${weighingHourChart(hours)}</div>` : '<p class="mr-empty">Sem pesagem fechada.</p>'}</figure>`;
  }).join('');

  const exchange = (summary?.support || []).map(item => `<tr><th scope="row">FT ${escapeHtml(fieldFrontNumber(item.front))}</th>
      <td>${escapeHtml(item.from_unit)}</td><td>${escapeHtml(item.to_unit)}</td>${managementCell(item.loads)}${managementCell(item.tons)}
      ${managementCell(item.atr, 2)}<td>${escapeHtml(item.to_unit)}</td></tr>`).join('');

  const fronts = units.map((unit, index) => {
    const rows = items[index].fronts.map(front => `<tr><th scope="row">FT ${escapeHtml(fieldFrontNumber(front.front))}${front.external
        ? ` <span class="mr-tag">${escapeHtml(front.home_unit)}</span>` : ''}</th><td>${escapeHtml(front.sector || '—')}${front.section ? ` / ${escapeHtml(front.section)}` : ''}</td>
        ${managementCell(front.loads)}${managementCell(front.tons)}${managementCell(front.atr, 2)}</tr>`).join('');
    return `<details class="mr-fronts"><summary>${escapeHtml(unit.code)} · ${items[index].fronts.length} frentes pesadas</summary>
      ${rows ? `<div class="table-wrap"><table class="wp-table"><thead><tr><th>Frente</th><th>Setor</th><th>Cargas</th><th>Toneladas</th><th>ATR</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<p class="mr-empty">Sem pesagem fechada.</p>'}</details>`;
  }).join('');

  const today = saoPauloIsoDate();
  const shownDay = managementReportDate || summary?.work_date || today;
  const dataUntil = (summary?.units || []).map(unit => unit.data_until).filter(Boolean);
  const until = dataUntil.length ? new Date(Math.max(...dataUntil) * 1000).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '';
  const source = summary?.reference_at
    ? `Balança do SELECT importado${until ? ` · dados até ${escapeHtml(until)}` : ''}${managementReportTime
      ? ` · fechamento às ${escapeHtml(managementReportTime)}` : ''}. Polo MS no horário de lá.`
    : 'Nenhuma pesagem importada para este dia: os indicadores vêm do Preencher.';
  return `<section class="dashboard-block management-report" aria-labelledby="management-report-title">
    <header class="mr-header">
      <div><h2 id="management-report-title">Indicadores das 4 unidades</h2>
        <p>${source} Clique numa unidade para ver o card dela abaixo.</p></div>
      <div class="mr-controls">
        <label class="field"><span>Dia</span><input id="management-report-date" type="date" max="${today}" value="${escapeHtml(shownDay)}" /></label>
        <label class="field" title="Mostra o dia como estava neste horário (para conferir com uma planilha de fechamento). Em branco: até a última hora importada."><span>Fechamento às</span>
          <input id="management-report-time" type="time" value="${escapeHtml(managementReportTime)}" /></label>
      </div>
    </header>
    <div class="mr-kpis">${kpis}</div>
    <div class="table-wrap"><table class="wp-table mr-table">
      <thead><tr><th>Unidade</th><th>Frentes</th><th>Indústria</th><th>Moagem turno</th><th>% ind.</th><th>Entrega turno</th><th>Diferença</th>
        <th>Moagem 3 h</th><th>Entrega 3 h</th><th>Estoque</th><th>ATR</th><th>Processado dia</th><th>Entregue dia</th><th>Projeção</th><th>Até</th></tr></thead>
      <tbody>${unitRows}</tbody></table></div>
    <details id="management-details" class="mr-details"${managementDetailsOpen ? ' open' : ''}>
      <summary>Detalhes: hora a hora, turnos, troca de cana e frentes</summary>
      <div class="mr-charts">${charts}</div>
      <div class="mr-bottom">
        <div class="table-wrap"><table class="wp-table">
          <thead><tr><th>Turno</th><th>Moagem (t)</th><th>Entrega (t)</th><th>Diferença</th><th>Média moagem</th><th>Média entrega</th></tr></thead>
          <tbody>${shiftRows || '<tr><td colspan="6">Sem horas fechadas.</td></tr>'}</tbody></table></div>
        <div class="table-wrap"><table class="wp-table">
          <caption>Troca de cana · o ATR entra na média da unidade que recebeu</caption>
          <thead><tr><th>Frente</th><th>Dona</th><th>Entregou em</th><th>Cargas</th><th>Toneladas</th><th>ATR</th><th>Média de</th></tr></thead>
          <tbody>${exchange || '<tr><td colspan="7">Nenhuma frente entregou em outra unidade.</td></tr>'}</tbody></table></div>
      </div>
      <div class="mr-front-list">${fronts}</div>
    </details>
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
  // Mantém "Detalhes" aberto ou fechado entre as atualizações do dashboard.
  document.addEventListener('toggle', event => {
    if (event.target?.id === 'management-details') managementDetailsOpen = event.target.open;
  }, true);
  // Clicar (ou Enter) numa unidade da tabela abre o card dela abaixo do dashboard.
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
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.closest?.('[data-overview-unit]')) openUnit(event);
  });
}
