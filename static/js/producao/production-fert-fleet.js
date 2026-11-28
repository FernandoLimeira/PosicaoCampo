// Fertirrigação: frota (quadro do dia, ficha do CV, cadastro) e raio setor × base. Depende de production-fert.js.

// Gás do CV: % do tanque (editável pelo analista) e as viagens que ainda faz no raio da frente.
function fertGasHtml(item, editable) {
  if (item.fuel !== 'gas') return '<span class="fert-fuel">Diesel</span>';
  const level = item.gas_level_pct;
  const tone = level === null ? '' : level < 25 ? 'is-low' : level < 50 ? 'is-mid' : 'is-ok';
  const trips = item.gas_trips === null || item.gas_trips === undefined ? ''
    : `<small class="fert-gas-trips ${item.gas_trips < 1 ? 'is-low' : ''}">${item.gas_trips < 1 ? 'não completa 1 viagem' : `≈ ${item.gas_trips} ${item.gas_trips === 1 ? 'viagem' : 'viagens'}`}</small>`;
  return `<div class="fert-gas ${tone}"><span class="fert-fuel is-gas">Gás</span>
    ${editable ? `<label class="fert-gas-input"><input type="number" min="0" max="100" step="1" inputmode="numeric" value="${level ?? ''}"
        data-fert-gas="${item.id}" aria-label="Gás do ${escapeHtml(item.prefix)} em %" placeholder="—" /><em>%</em></label>`
      : `<b>${level === null ? '—' : `${fertNumber(level, 0)}%`}</b>`}
    <i class="fert-gas-bar" data-gas-level="${level ?? 0}" aria-hidden="true"></i>${trips}</div>`;
}

function applyFertGasBars(root) {
  root.querySelectorAll('[data-gas-level]').forEach(bar => bar.style.setProperty('--gas', `${Math.max(0, Math.min(100, Number(bar.dataset.gasLevel)))}%`));
}

function renderFertBoard() {
  const board = document.querySelector('#production-fert-board');
  if (!board) return;
  const editable = fertData.permissions.edit;
  const fleet = fertData.fleet[fertFleetKind];
  const items = fertData.equipment.filter(item => item.kind === fertFleetKind);
  const chips = Object.entries(FERT_STATUS_LABELS).filter(([key]) => fleet[key])
    .map(([key, label]) => `<span class="fert-status is-${key}">${escapeHtml(label)} <b>${fleet[key]}</b></span>`).join('');
  board.innerHTML = `<header class="catalog-section-header fert-board-header">
      <div><h2>Frota do dia</h2><p class="fert-meta">Situação de cada ${fertFleetKind === 'truck' ? 'CV' : 'trator'}, onde está e quem mudou por último.</p></div>
      <div class="fert-kind-tabs" role="tablist" aria-label="Tipo de equipamento">
        <button type="button" role="tab" data-fert-kind="truck" aria-selected="${fertFleetKind === 'truck'}" class="${fertFleetKind === 'truck' ? 'is-active' : ''}">CVs <small>${fertData.equipment.filter(item => item.kind === 'truck').length}</small></button>
        <button type="button" role="tab" data-fert-kind="tractor" aria-selected="${fertFleetKind === 'tractor'}" class="${fertFleetKind === 'tractor' ? 'is-active' : ''}">Tratores <small>${fertData.equipment.filter(item => item.kind === 'tractor').length}</small></button>
      </div>
    </header>
    <div class="fert-status-strip">${chips || '<span class="fert-meta">Nenhum cadastrado. Use “Frota e raio”.</span>'}</div>
    ${items.length ? `<div class="fert-table-scroll"><table class="fert-table fert-board-table">
      <thead><tr><th>Prefixo</th><th>Situação</th><th>Frente</th>${fertFleetKind === 'truck' ? '<th>Combustível</th><th>Recomendação</th>' : ''}<th>Última mudança</th></tr></thead>
      <tbody>${items.map(item => `<tr class="is-${item.status}">
        <td><button type="button" class="fert-prefix" data-fert-cv="${item.id}" title="Ver a ficha do ${escapeHtml(item.prefix)}">${escapeHtml(item.prefix)}</button>${item.kind === 'truck' && item.capacity_m3 ? `<small>${fertNumber(item.capacity_m3, 0)} m³</small>` : ''}</td>
        <td>${editable ? `<select data-fert-status="${item.id}" aria-label="Situação do ${escapeHtml(item.prefix)}">
            ${Object.entries(FERT_STATUS_LABELS).map(([key, label]) => `<option value="${key}"${item.status === key ? ' selected' : ''}>${label}</option>`).join('')}
          </select>` : fertStatusBadge(item.status)}${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ''}</td>
        <td>${item.front ? escapeHtml(item.front.front) : '<small>—</small>'}</td>
        ${item.kind === 'truck' ? `<td>${fertGasHtml(item, editable)}</td>
        <td class="fert-rec-cell">${item.front?.recommendation?.length ? fertRecommendationShortHtml(item.front.recommendation) : '<small>—</small>'}</td>` : ''}
        <td><small>${item.status_changed_at ? `${escapeHtml(fertTime(item.status_changed_at))}${item.status_changed_by ? ` · ${escapeHtml(item.status_changed_by)}` : ''}` : '—'}</small></td>
      </tr>`).join('')}</tbody></table></div>` : ''}`;
  applyFertGasBars(board);
}

// Ficha do CV (clique no CV): situação, frente, etapa do ciclo, gás, recomendação e histórico do dia.
function openFertCv(equipmentId) {
  const item = fertData?.equipment.find(entry => entry.id === equipmentId);
  const body = document.querySelector('#production-fert-cv-body');
  if (!item || !body) return;
  const editable = fertData.permissions.edit;
  const front = item.front ? fertData.fronts.find(entry => entry.service_front_id === item.front.front_id) : null;
  const stage = front ? fertCyclePositions(front, fertData.defaults)?.trucks.find(entry => entry.truck.id === item.id) : null;
  document.querySelector('#production-fert-cv-title').textContent = `${item.kind === 'truck' ? 'CV' : 'Trator'} ${item.prefix}`;
  document.querySelector('#production-fert-cv-context').textContent = [item.kind === 'truck' ? (item.fuel === 'gas' ? 'A gás' : 'Diesel') : '',
    item.capacity_m3 ? `${fertNumber(item.capacity_m3, 0)} m³` : '', FERT_STATUS_LABELS[item.status]].filter(Boolean).join(' · ');
  const events = fertData.events.filter(event => event.prefix === item.prefix && event.kind === item.kind);
  const stat = (label, value) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
  const stageText = stage ? fertStageText(stage) : '—';
  body.innerHTML = `<dl class="fert-summary-grid">
      ${stat('Situação', editable ? `<select data-fert-status="${item.id}" aria-label="Situação">${Object.entries(FERT_STATUS_LABELS)
        .map(([key, label]) => `<option value="${key}"${item.status === key ? ' selected' : ''}>${label}</option>`).join('')}</select>` : fertStatusBadge(item.status))}
      ${stat('Frente', front ? `<button type="button" class="fert-link" data-fert-open-front="${front.service_front_id}">${escapeHtml(front.name)} · setor ${escapeHtml(front.sector)}</button>` : 'Sem frente')}
      ${stat('Agora (estimado)', escapeHtml(stageText))}
      ${stat('Base · raio', front ? `${escapeHtml(front.base || '—')} · ${front.radius_km !== null ? `${fertNumber(front.radius_km, 1)} km` : '—'}` : '—')}
      ${item.kind === 'truck' ? stat('Gás', fertGasHtml(item, editable)) : ''}
      ${item.kind === 'truck' && item.fuel === 'gas' ? stat('Consumo por viagem', front?.gas_pct_per_trip ? `${fertNumber(front.gas_pct_per_trip, 1)}% do tanque` : 'sem frente') : ''}
      ${stat('Última mudança', item.status_changed_at ? `${escapeHtml(fertTime(item.status_changed_at))}${item.status_changed_by ? ` · ${escapeHtml(item.status_changed_by)}` : ''}` : '—')}
      ${item.notes ? stat('Observação', escapeHtml(item.notes)) : ''}
    </dl>
    ${front?.orders.recommendation.length ? `<section class="fert-plan-section"><h3>Recomendação que está levando</h3>
      <ul class="fert-rec-list">${front.orders.recommendation.map(entry => `<li>${escapeHtml(entry.replace(/ = /, ' · '))}</li>`).join('')}</ul></section>` : ''}
    <section class="fert-plan-section"><h3>Movimentações de hoje</h3>
      ${events.length ? `<ol class="fert-events">${events.map(event => `<li><time>${escapeHtml(fertTime(event.created_at).slice(-5))}</time>
        <span class="fert-event-type is-${escapeHtml(event.action)}">${escapeHtml(FERT_EVENT_LABELS[event.action] || event.action)}</span>
        <span>${escapeHtml(event.detail)}</span><small>${escapeHtml(event.user)}</small></li>`).join('')}</ol>` : '<p class="fert-meta">Nenhuma movimentação hoje.</p>'}
    </section>`;
  applyFertGasBars(body);
  openModal('production-fert-cv-modal');
}

// ---------------------------------------------------------------------------
// Frota (cadastro) e raio setor × base.
// ---------------------------------------------------------------------------
function renderFertFleet() {
  const body = document.querySelector('#production-fert-fleet-body');
  if (!body || !fertData) return;
  const editable = fertData.permissions.edit;
  const list = kind => {
    const items = fertData.equipment.filter(item => item.kind === kind);
    return items.length ? `<ul class="fert-fleet-list">${items.map(item => `<li class="is-${item.status}">
        <strong>${escapeHtml(item.prefix)}</strong><span>${kind === 'truck' ? `${item.capacity_m3 ? `${fertNumber(item.capacity_m3, 0)} m³` : 'padrão'}${item.fuel === 'gas' ? ' · gás' : ''}` : ''}</span>
        ${fertStatusBadge(item.status)}
        ${editable ? `<button type="button" class="icon-delete-button" data-fert-delete="${item.id}" aria-label="Excluir ${escapeHtml(item.prefix)}" title="Excluir">${TRASH_ICON}</button>` : '<span></span>'}
      </li>`).join('')}</ul>` : '<p class="production-empty">Nenhum cadastrado.</p>';
  };
  const count = kind => fertData.equipment.filter(item => item.kind === kind).length;
  body.innerHTML = `${editable ? `<form id="production-fert-equipment-form" class="fert-equipment-form">
      <label class="field"><span>Tipo</span><select name="kind"><option value="truck">CV (caminhão)</option><option value="tractor">Trator</option></select></label>
      <label class="field"><span>Prefixo</span><input name="prefix" maxlength="20" required autocomplete="off" placeholder="Ex.: 612" /></label>
      <label class="field"><span>Capacidade (CV)</span><input name="capacity_m3" inputmode="decimal" autocomplete="off" placeholder="${fertNumber(fertData.defaults.capacity_m3, 0)} m³" /></label>
      <label class="field"><span>Combustível</span><select name="fuel"><option value="diesel">Diesel</option><option value="gas">Gás (biometano)</option></select></label>
      <label class="field"><span>Gás no tanque</span><input name="gas_level_pct" type="number" min="0" max="100" step="1" inputmode="numeric" placeholder="% (CV a gás)" /></label>
      <label class="field"><span>Situação</span><select name="status">${Object.entries(FERT_STATUS_LABELS).filter(([key]) => key !== 'active')
        .map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
      <button class="production-primary-button" type="submit">Adicionar</button>
    </form>` : ''}
    <p class="fert-meta">A situação de cada equipamento muda no quadro “Frota do dia” do painel.</p>
    <div class="fert-fleet-columns">
      <section><h3>CVs <small>${count('truck')}</small></h3>${list('truck')}</section>
      <section><h3>Tratores <small>${count('tractor')}</small></h3>${list('tractor')}</section>
    </div>
    <section class="fert-radius-box">
      <h3>Raio setor × base</h3>
      <p>${fertData.radius.sectors ? `${fertData.radius.sectors} setores com raio${fertData.radius.imported_at ? ` · importado em ${escapeHtml(fertTime(fertData.radius.imported_at))}` : ''}.` : 'Nenhum raio importado.'}
        Use a aba RAIO da planilha (SETOR, FAZENDA, MUNICIPIO, BASE CARREGAMENTO e RAIO), exportada em um arquivo só.</p>
      ${fertData.permissions.configure ? `<form id="production-fert-radius-form" class="fert-radius-form">
        <input name="file" type="file" accept=".xlsx,.xlsm" required aria-label="Arquivo com o raio" />
        <button class="production-secondary-button" type="submit">Importar raio</button>
      </form>` : '<p class="fert-meta">A importação do raio é feita por quem configura a Produção.</p>'}
    </section>`;
}

async function fertEquipmentRequest(url, options, success) {
  try {
    await apiRequest(url, options);
    if (success) showToast(success);
  } catch (error) {
    showToast(error.message || 'Não foi possível salvar a frota.', true);
  }
  await loadFertOverview();
}

document.querySelector('#production-fert-fleet')?.addEventListener('click', () => {
  renderFertFleet();
  openModal('production-fert-fleet-modal');
});
// Quadro "Frota do dia": troca de aba (CVs/Tratores) e situação de cada equipamento.
document.querySelector('#production-fert-board')?.addEventListener('click', event => {
  const cv = event.target.closest('[data-fert-cv]');
  if (cv) {
    openFertCv(Number(cv.dataset.fertCv));
    return;
  }
  const tab = event.target.closest('[data-fert-kind]');
  if (!tab) return;
  fertFleetKind = tab.dataset.fertKind;
  renderFertBoard();
});
document.querySelector('#production-fert-board')?.addEventListener('change', onFertEquipmentChange);
document.querySelector('#production-fert-fleet-body')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const unit = fertData?.unit;
  if (!unit) return;
  if (form.id === 'production-fert-equipment-form') {
    const data = Object.fromEntries(new FormData(form));
    await fertEquipmentRequest('/api/production/fert/equipment', { method: 'POST',
      body: JSON.stringify({ ...data, unit_code: unit, work_date: fertData.work_date }) },
      `${data.kind === 'truck' ? 'CV' : 'Trator'} ${data.prefix} cadastrado.`);
    return;
  }
  if (form.id === 'production-fert-radius-form') {
    const file = form.querySelector('[type="file"]').files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file, file.name);
    try {
      const result = await apiRequest(`/api/production/fert/radius/import?unit=${encodeURIComponent(unit)}`, { method: 'POST', body });
      showToast(`Raio importado: ${result.imported} linhas, ${result.sectors} setores.`);
    } catch (error) {
      showToast(error.message || 'Não foi possível importar o raio.', true);
    }
    await loadFertOverview();
  }
});
document.querySelector('#production-fert-fleet-body')?.addEventListener('click', async event => {
  const button = event.target.closest('[data-fert-delete]');
  if (!button) return;
  const item = fertData.equipment.find(entry => entry.id === Number(button.dataset.fertDelete));
  if (!item || !await askConfirmation({ kicker: 'Frota', title: `Excluir ${item.prefix}?`,
    message: 'O equipamento sai da frota e das frentes onde estava alocado.', confirmLabel: 'Excluir' })) return;
  fertEquipmentRequest(`/api/production/fert/equipment/${item.id}?unit=${encodeURIComponent(fertData.unit)}`, { method: 'DELETE' }, `${item.prefix} excluído.`);
});

// Ficha do CV: situação, gás e abrir a frente.
function fertSaveEquipment(item, changes, message) {
  return fertEquipmentRequest(`/api/production/fert/equipment/${item.id}`, { method: 'PUT', body: JSON.stringify({
    unit_code: fertData.unit, work_date: fertData.work_date, kind: item.kind, prefix: item.prefix,
    capacity_m3: item.capacity_m3, status: item.status, notes: item.notes, ...changes
  }) }, message);
}
async function onFertEquipmentChange(event) {
  const status = event.target.closest('[data-fert-status]');
  const gas = event.target.closest('[data-fert-gas]');
  if (!fertData || (!status && !gas)) return;
  const item = fertData.equipment.find(entry => entry.id === Number((status || gas).dataset[status ? 'fertStatus' : 'fertGas']));
  if (!item) return;
  const inModal = Boolean(event.target.closest('#production-fert-cv-modal'));
  if (status) {
    await fertSaveEquipment(item, { status: status.value },
      `${item.kind === 'truck' ? 'CV' : 'Trator'} ${item.prefix}: ${FERT_STATUS_LABELS[status.value].toLocaleLowerCase('pt-BR')}.`);
  } else {
    await fertSaveEquipment(item, { gas_level_pct: gas.value }, `CV ${item.prefix}: gás ${gas.value || '—'}%.`);
  }
  if (inModal) openFertCv(item.id);
}
document.querySelector('#production-fert-cv-body')?.addEventListener('change', onFertEquipmentChange);
document.querySelector('#production-fert-cv-body')?.addEventListener('click', event => {
  const open = event.target.closest('[data-fert-open-front]');
  if (!open) return;
  closeModal('production-fert-cv-modal');
  openFertPlan(Number(open.dataset.fertOpenFront));
});
