// Fertirrigação: planejamento da semana (aba PLANEJAMENTO - SEMANAL). Depende de production-fert.js.

// ---------------------------------------------------------------------------
// Planejamento da semana (aba PLANEJAMENTO - SEMANAL): setor de cada frente por dia, CVs
// necessários e raio planejado (ponderado pela vazão) × orçado.
// ---------------------------------------------------------------------------
let fertWeekEditing = null;
const FERT_WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

function renderFertWeek() {
  const box = document.querySelector('#production-fert-week');
  const week = fertData?.week;
  if (!box || !week) return;
  const editable = fertData.permissions.edit;
  const dayLabel = day => {
    const date = new Date(`${day}T12:00:00`);
    return `${FERT_WEEKDAYS[date.getDay()]} <small>${escapeHtml(formatIsoDateBr(day).slice(0, 5))}</small>`;
  };
  const cell = (row, day) => {
    const item = row.cells[day];
    if (!item) return `<td class="fert-week-cell is-empty">${editable ? `<button type="button" data-fert-week="${row.service_front_id}|${day}" aria-label="Planejar ${escapeHtml(row.name)} em ${escapeHtml(formatIsoDateBr(day))}">+</button>` : '—'}</td>`;
    const content = `<strong>${escapeHtml(item.sector)}</strong><small>${escapeHtml(item.farm || '-')}</small>
      <span class="fert-week-meta">${item.radius_km !== null ? `${fertNumber(item.radius_km, 1)} km` : 'sem raio'} · ${item.flow_m3_ha !== null ? `${fertNumber(item.flow_m3_ha, 0)} m³` : 'sem vazão'}</span>
      <span class="fert-week-cvs">${item.trucks_needed ?? '—'} CVs</span>`;
    return `<td class="fert-week-cell${item.saved ? ' is-saved' : ' is-today'}">${editable
      ? `<button type="button" data-fert-week="${row.service_front_id}|${day}">${content}</button>` : `<div>${content}</div>`}</td>`;
  };
  const totals = week.totals;
  const diffTone = value => value === null ? '' : value > 0 ? 'is-over' : 'is-ok';
  box.innerHTML = `<header class="catalog-section-header">
      <div><h2>Planejamento da semana</h2>
        <p class="fert-meta">Setor de cada frente nos próximos dias. Hoje vem do lançamento; clique no dia para planejar.</p></div>
      <label class="fert-budget">Raio orçado <input type="number" min="1" max="200" step="0.1" value="${escapeHtml(week.budget_radius_km)}"
        data-fert-budget ${editable ? '' : 'disabled'} aria-label="Raio orçado em km" /> km</label>
    </header>
    <div class="fert-table-scroll"><table class="fert-table fert-week-table">
      <thead><tr><th>Frente</th>${week.days.map(day => `<th>${dayLabel(day)}</th>`).join('')}</tr></thead>
      <tbody>${week.rows.map(row => `<tr><th scope="row">${escapeHtml(row.name)}</th>${week.days.map(day => cell(row, day)).join('')}</tr>`).join('')}</tbody>
      <tfoot>
        <tr><th scope="row">CVs necessários</th>${week.days.map(day => `<td class="is-number is-strong">${totals[day].trucks_needed ?? '—'}</td>`).join('')}</tr>
        <tr><th scope="row">Área · volume</th>${week.days.map(day => `<td class="is-number">${totals[day].fronts ? `${fertNumber(totals[day].yield_ha, 0)} ha<small>${fertNumber(totals[day].volume_m3, 0)} m³</small>` : '—'}</td>`).join('')}</tr>
        <tr><th scope="row">Raio planejado</th>${week.days.map(day => {
          const total = totals[day];
          return `<td class="is-number">${total.planned_radius_km !== null ? `${fertNumber(total.planned_radius_km, 1)} km<small class="fert-radius-diff ${diffTone(total.radius_difference_km)}">${total.radius_difference_km > 0 ? '+' : ''}${fertNumber(total.radius_difference_km, 1)} km do orçado</small>` : '—'}</td>`;
        }).join('')}</tr>
      </tfoot>
    </table></div>`;
}

function openFertWeek(frontId, day) {
  const row = fertData.week.rows.find(item => item.service_front_id === frontId);
  const form = document.querySelector('#production-fert-week-form');
  if (!row || !form) return;
  const item = row.cells[day];
  fertWeekEditing = { frontId, day };
  document.querySelector('#production-fert-week-title').textContent = row.name;
  document.querySelector('#production-fert-week-context').textContent = `${productionUnitLabel(fertData.unit)} · ${formatIsoDateBr(day)}`;
  form.elements.sector.value = item?.saved ? item.sector : (item?.sector || '');
  form.elements.flow_m3_ha.value = item?.saved && item.flow_source === 'planejado' ? item.flow_m3_ha : '';
  form.elements.tractors.value = item?.saved ? item.tractors : '';
  document.querySelector('#production-fert-week-status').textContent = item && !item.saved ? 'Hoje vem do lançamento; salvar fixa o planejamento do dia.' : '';
  openModal('production-fert-week-modal');
  form.elements.sector.focus();
}

async function saveFertWeek(event) {
  event.preventDefault();
  if (!fertWeekEditing || !fertData?.permissions.edit) return;
  const form = event.currentTarget;
  const status = document.querySelector('#production-fert-week-status');
  try {
    await apiRequest('/api/production/fert/week', { method: 'PUT', body: JSON.stringify({
      unit_code: fertData.unit, work_date: fertWeekEditing.day, service_front_id: fertWeekEditing.frontId,
      sector: form.elements.sector.value.trim(), flow_m3_ha: form.elements.flow_m3_ha.value.trim().replace(',', '.'),
      tractors: form.elements.tractors.value
    }) });
    closeModal('production-fert-week-modal');
    showToast(form.elements.sector.value.trim() ? 'Dia planejado.' : 'Dia apagado do planejamento.');
    await loadFertOverview();
  } catch (error) {
    status.classList.add('is-error');
    status.textContent = error.message || 'Não foi possível salvar o planejamento.';
  }
}

document.querySelector('#production-fert-week')?.addEventListener('click', event => {
  const cell = event.target.closest('[data-fert-week]');
  if (!cell) return;
  const [frontId, day] = cell.dataset.fertWeek.split('|');
  openFertWeek(Number(frontId), day);
});
document.querySelector('#production-fert-week')?.addEventListener('change', async event => {
  const budget = event.target.closest('[data-fert-budget]');
  if (!budget || !fertData) return;
  try {
    await apiRequest('/api/production/fert/settings', { method: 'PUT', body: JSON.stringify({ unit_code: fertData.unit, budget_radius_km: budget.value }) });
    showToast(`Raio orçado: ${budget.value} km.`);
  } catch (error) {
    showToast(error.message || 'Não foi possível salvar o raio orçado.', true);
  }
  await loadFertOverview();
});
document.querySelector('#production-fert-week-form')?.addEventListener('submit', saveFertWeek);
