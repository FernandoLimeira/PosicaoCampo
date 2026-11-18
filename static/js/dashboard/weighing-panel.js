// Posição de Campo: painel da balança no card da unidade (processado e projeção do dia,
// gráfico hora a hora animado com os turnos, resumo A/B/C e frentes de apoio). Moagem,
// entrega e estoque do turno ficam nos "Indicadores do turno" do card, sem repetir aqui.
// A barra animada (panelGauge) e a diferença também são usadas pela visão das 4 unidades.
// Depende de core/field-indicators.js e dashboard/dashboard.js (resumo da pesagem).
function panelDiff(value, unitLabel) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '<span class="wp-diff">—</span>';
  const tone = Math.round(value) === 0 ? 'is-even' : value > 0 ? 'is-up' : 'is-down';
  const sign = Math.round(value) > 0 ? '+' : '';
  const icon = tone === 'is-up' ? '▲' : tone === 'is-down' ? '▼' : '●';
  const text = tone === 'is-up' ? 'entrega acima' : tone === 'is-down' ? 'entrega abaixo' : 'equilibrado';
  return `<span class="wp-diff ${tone}" title="Entrega − moagem: ${text}"><i aria-hidden="true">${icon}</i>${sign}${fieldIndicatorNumber(value)} ${unitLabel}</span>`;
}

// Barra horizontal animada (cresce da esquerda ao desenhar): fração 0–1 com o tom da faixa
// (good/warning/low da indústria, "day" para processado × projeção). SVG porque a CSP não
// permite largura em style inline.
function panelGauge(fraction, tone) {
  const width = Math.max(0, Math.min(100, (Number(fraction) || 0) * 100));
  return `<svg class="dash-gauge" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
    <rect class="dash-gauge-track" width="100" height="8" rx="1.6" ry="4"></rect>
    ${width ? `<rect class="dash-gauge-fill is-${escapeHtml(tone)}" width="${width.toFixed(1)}" height="8" rx="1.6" ry="4"></rect>` : ''}</svg>`;
}

function panelAverage(hours, key) {
  const values = hours.map(item => item[key]).filter(value => value !== null && value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

// Faixas dos turnos da unidade (shift_hours do resumo; Polo MS: turno C a partir das 15h).
const DEFAULT_SHIFT_HOURS = { A: [0, 7], B: [7, 16], C: [16, 24] };

function weighingHourChart(hours, shiftHours = DEFAULT_SHIFT_HOURS) {
  const width = 960, height = 250, left = 46, right = 12, top = 14, bottom = 34;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const slot = plotWidth / 24;
  const maxValue = Math.max(0, ...hours.flatMap(item => [item.milling_t || 0, item.delivery_t || 0]));
  const step = maxValue > 1500 ? 500 : maxValue > 600 ? 250 : maxValue > 200 ? 100 : 50;
  const yMax = Math.max(step, Math.ceil((maxValue * 1.08) / step) * step);
  const y = value => top + plotHeight - (value / yMax) * plotHeight;
  const x = hour => left + hour * slot;
  const bands = Object.entries(shiftHours).map(([code, [from, to]]) => `
    <rect class="wp-band wp-band-${code}" x="${x(from)}" y="${top}" width="${(to - from) * slot}" height="${plotHeight}"></rect>
    <text class="wp-band-label" x="${x(from) + 6}" y="${top + 12}">Turno ${code}</text>`).join('');
  const grid = Array.from({ length: Math.floor(yMax / step) + 1 }, (_, index) => index * step).map(value => `
    <line class="wp-grid" x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"></line>
    <text class="wp-axis" x="${left - 6}" y="${y(value) + 4}" text-anchor="end">${fieldIndicatorNumber(value)}</text>`).join('');
  const ticks = Array.from({ length: 24 }, (_, hour) => hour % 2 === 0
    ? `<text class="wp-axis" x="${x(hour) + slot / 2}" y="${height - bottom + 16}" text-anchor="middle">${String(hour).padStart(2, '0')}h</text>` : '').join('');
  const barWidth = Math.max(4, slot - 8);
  const bars = hours.map(item => {
    const value = item.milling_t || 0;
    const barHeight = Math.max(0, top + plotHeight - y(value));
    // Topo arredondado (4 px) e base reta na linha de zero.
    const r = Math.min(4, barHeight, barWidth / 2);
    return barHeight > 0 ? `<path class="wp-bar" d="M${x(item.hour) + 4},${top + plotHeight} v${-(barHeight - r)} q0,-${r} ${r},-${r} h${barWidth - 2 * r} q${r},0 ${r},${r} v${barHeight - r} z"></path>` : '';
  }).join('');
  const points = hours.filter(item => item.delivery_t !== null && item.delivery_t !== undefined)
    .map(item => [x(item.hour) + slot / 2, y(item.delivery_t), item]);
  const line = points.length > 1 ? `<polyline class="wp-line" pathLength="1" points="${points.map(([px, py]) => `${px},${py}`).join(' ')}"></polyline>` : '';
  const dots = points.map(([px, py]) => `<circle class="wp-dot" cx="${px}" cy="${py}" r="4"></circle>`).join('');
  const last = points.at(-1);
  const lastBar = hours.at(-1);
  // Rótulos diretos só na última hora fechada (o resto fica no tooltip e na tabela).
  const labels = last && lastBar ? `
    <text class="wp-direct wp-direct-line" x="${Math.min(last[0] + 8, width - right - 4)}" y="${last[1] - 8}" text-anchor="${last[0] > width - 90 ? 'end' : 'start'}">Entrega ${fieldIndicatorNumber(last[2].delivery_t)}</text>
    <text class="wp-direct" x="${Math.min(x(lastBar.hour) + slot / 2, width - right - 4)}" y="${y(lastBar.milling_t || 0) + 16}" text-anchor="middle">${fieldIndicatorNumber(lastBar.milling_t)}</text>` : '';
  // Áreas de toque maiores que as marcas: cada hora mostra moagem, entrega e CVs.
  const hits = hours.map(item => `<rect class="wp-hit" x="${x(item.hour)}" y="${top}" width="${slot}" height="${plotHeight}" tabindex="0"
      aria-label="${String(item.hour).padStart(2, '0')}h: moagem ${fieldIndicatorNumber(item.milling_t)} t, entrega ${fieldIndicatorNumber(item.delivery_t)} t, ${fieldIndicatorNumber(item.trucks, Number.isInteger(item.trucks) ? 0 : 1)} CVs">
      <title>${String(item.hour).padStart(2, '0')}:00 · Turno ${item.shift}
Moagem ${fieldIndicatorNumber(item.milling_t, 1)} t (${fieldIndicatorNumber(item.loads)} cargas)
Cana entregue ${fieldIndicatorNumber(item.delivery_t, 1)} t (${fieldIndicatorNumber(item.trucks, Number.isInteger(item.trucks) ? 0 : 1)} CVs)
Densidade ${fieldIndicatorNumber(item.density_t, 2)} t</title></rect>`).join('');
  return `<svg class="wp-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Moagem e cana entregue por hora (t)">
    ${bands}${grid}<line class="wp-baseline" x1="${left}" x2="${width - right}" y1="${top + plotHeight}" y2="${top + plotHeight}"></line>
    <g class="wp-bars">${bars}</g>${line}<g class="wp-dots">${dots}</g>${labels}${ticks}${hits}</svg>`;
}

function weighingPanel(unit) {
  const weighing = unitWeighing(unit.code);
  if (!weighing?.hours?.length) return '';
  const hours = weighing.hours;
  const projectionStopped = fieldProjectionStopped(fieldFilledRows(unit), weighing);
  const shiftCode = weighing.shift || hours.at(-1).shift;
  const total = key => hours.reduce((sum, item) => sum + (item[key] || 0), 0);
  const projectionHint = unit.code === 'NRD' ? 'média dos turnos × 24 h' : 'média do dia × 24 h';
  const measures = [['Dia', `00h às ${String(hours.at(-1).hour).padStart(2, '0')}h`, weighing.milling_day_t, weighing.delivery_day_t, 't']];
  if (!projectionStopped) {
    measures.push(['Projeção do dia', projectionHint, weighing.milling_projection_t, weighing.delivery_projection_t, 't']);
  }
  const groups = measures.map(([title, hint, milling, delivery, unitLabel]) => `
    <div class="wp-kpi-group">
      <div class="wp-kpi-title"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(hint)}</small></div>
      <div class="wp-kpi-values">
        <div><small><svg class="wp-key" width="10" height="10" aria-hidden="true"><rect class="wp-bar" width="10" height="10" rx="2"></rect></svg>Moagem</small><strong>${fieldIndicatorNumber(milling)}</strong><span>${unitLabel}</span></div>
        <div><small><svg class="wp-key" width="14" height="10" aria-hidden="true"><line class="wp-line" x1="1" x2="13" y1="5" y2="5"></line></svg>Entrega</small><strong>${fieldIndicatorNumber(delivery)}</strong><span>${unitLabel}</span></div>
      </div>
      ${panelDiff(delivery !== null && milling !== null ? delivery - milling : null, unitLabel)}
    </div>`).join('');
  const previous = hours.at(-2);
  const lastHour = hours.at(-1);
  const trend = previous ? (lastHour.milling_t || 0) - (previous.milling_t || 0) : null;
  const shifts = ['A', 'B', 'C'].map(code => {
    const rows = hours.filter(item => item.shift === code);
    if (!rows.length) return '';
    const milling = rows.reduce((sum, item) => sum + (item.milling_t || 0), 0);
    const delivery = rows.reduce((sum, item) => sum + (item.delivery_t || 0), 0);
    return `<tr${code === shiftCode ? ' class="is-current"' : ''}><th scope="row">Turno ${code}<small>${rows.length} ${rows.length === 1 ? 'hora' : 'horas'}</small></th>
      <td>${fieldIndicatorNumber(milling)}</td><td>${fieldIndicatorNumber(delivery)}</td><td>${panelDiff(delivery - milling, 't')}</td>
      <td>${fieldIndicatorNumber(panelAverage(rows, 'milling_t'))}</td><td>${fieldIndicatorNumber(panelAverage(rows, 'delivery_t'))}</td></tr>`;
  }).join('');
  const hourRows = hours.map(item => `<tr><th scope="row">${String(item.hour).padStart(2, '0')}:00</th><td>${fieldIndicatorNumber(item.milling_t, 1)}</td>
      <td>${fieldIndicatorNumber(item.loads)}</td><td>${fieldIndicatorNumber(item.density_t, 2)}</td><td>${fieldIndicatorNumber(item.trucks, Number.isInteger(item.trucks) ? 0 : 1)}</td><td>${fieldIndicatorNumber(item.delivery_t, 1)}</td></tr>`).join('');
  const support = (weighing.received || []).map(front => `<li><strong>Frente ${escapeHtml(front.front)}</strong> de ${escapeHtml(front.home_unit)}
      · ${fieldIndicatorNumber(front.tons)} t · ${fieldIndicatorNumber(front.loads)} cargas${front.atr ? ` · ATR ${fieldIndicatorNumber(front.atr, 2)}` : ''}</li>`).join('');
  return `
    <section class="dashboard-block weighing-panel" aria-labelledby="weighing-panel-title">
      <header class="wp-header">
        <div><h3 id="weighing-panel-title">Painel gerencial · Balança</h3>
          <p>Moagem pela saída da balança e entrega pelos CVs × 2 × densidade · dados até ${escapeHtml(weighingReferenceTime(unit.code))}</p></div>
      </header>
      <div class="wp-kpis">${groups}
        ${projectionStopped ? '<div class="wp-kpi-group"><div class="wp-kpi-title"><strong>Projeção do dia</strong></div><strong>Unidade parada</strong></div>' : ''}
        <div class="wp-kpi-group wp-kpi-stat"><small>Última hora (${String(lastHour.hour).padStart(2, '0')}h)</small>
          <strong>${fieldIndicatorNumber(lastHour.milling_t)}<span>t</span></strong>${trend === null ? '' : panelDiff(trend, 't').replace(/title="[^"]*"/, 'title="Moagem da última hora em relação à anterior"')}</div>
        <div class="wp-kpi-group wp-kpi-stat"><small>ATR do dia</small><strong>${fieldIndicatorNumber(weighing.atr, 2)}<span>kg/t</span></strong></div>
      </div>
      <figure class="wp-chart">
        <figcaption><strong>Hora a hora (t)</strong>
          <span class="wp-legend"><span><svg class="wp-key" width="10" height="10" aria-hidden="true"><rect class="wp-bar" width="10" height="10" rx="2"></rect></svg>Moagem</span><span><svg class="wp-key" width="14" height="10" aria-hidden="true"><line class="wp-line" x1="1" x2="13" y1="5" y2="5"></line></svg>Cana entregue</span></span></figcaption>
        <div class="wp-chart-wrap">${weighingHourChart(hours, weighing.shift_hours)}</div>
      </figure>
      <div class="wp-bottom">
        <div class="table-wrap"><table class="wp-table">
          <thead><tr><th>Turno</th><th>Moagem (t)</th><th>Entrega (t)</th><th>Diferença</th><th>Média moagem</th><th>Média entrega</th></tr></thead>
          <tbody>${shifts}
            <tr class="is-total"><th scope="row">Dia</th><td>${fieldIndicatorNumber(total('milling_t'))}</td><td>${fieldIndicatorNumber(total('delivery_t'))}</td>
              <td>${panelDiff(total('delivery_t') - total('milling_t'), 't')}</td><td>${fieldIndicatorNumber(panelAverage(hours, 'milling_t'))}</td><td>${fieldIndicatorNumber(panelAverage(hours, 'delivery_t'))}</td></tr>
          </tbody></table></div>
        ${support ? `<div class="wp-support"><h4>Frentes de apoio entregando aqui</h4><ul>${support}</ul></div>` : ''}
      </div>
      <details class="wp-hours"><summary>Ver tabela hora a hora</summary>
        <div class="table-wrap"><table class="wp-table">
          <thead><tr><th>Hora</th><th>Moagem (t)</th><th>Cargas</th><th>Densidade (t)</th><th>Qtd. CVs</th><th>Cana entregue (t)</th></tr></thead>
          <tbody>${hourRows}</tbody></table></div></details>
    </section>`;
}

