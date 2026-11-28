// Fertirrigação: plano do dia da frente (popup). Depende de production-fert.js.

// ---------------------------------------------------------------------------
// Configuração da frente (popup) em etapas: 1) Local — o que vem do sistema (setor, O.S., vazão,
// recomendação) e o que o analista preenche (base e raio); 2) Equipe — só os tratores e CVs da
// frente, com "+ Adicionar" (o que a regra permite) e "+ Cadastrar novo"; 3) Conferir — números da
// frente e ajustes opcionais da conta. O topo mostra os números ao vivo.
// ---------------------------------------------------------------------------
let fertPlanSelection = { tractor: [], truck: [] };
let fertPlanPicker = null;
let fertPlanNewKind = null;
const FERT_PLAN_STEPS = [['place', 'Local', 'base e raio'], ['team', 'Equipe', 'CVs e tratores'], ['params', 'Conferir', 'números e ajustes']];

function fertKindLabel(kind, plural = false) {
  return kind === 'truck' ? (plural ? 'CVs' : 'CV') : (plural ? 'Tratores' : 'Trator');
}

// O que pode entrar na frente: disponíveis e, de outra frente, tratores e CVs com a mesma
// recomendação. Oficina, sem motorista, apoio, inativo e CV de outra recomendação ficam de fora.
function fertPlanCandidates(kind, front) {
  const myKey = front.orders.recommendation_key;
  const keyOf = frontId => fertData.fronts.find(item => item.service_front_id === frontId)?.orders.recommendation_key || '';
  const result = { available: [], elsewhere: [], blocked: 0 };
  for (const item of fertData.equipment.filter(entry => entry.kind === kind && !fertPlanSelection[kind].includes(entry.id))) {
    const elsewhere = item.front && item.front.front_id !== front.service_front_id ? item.front : null;
    if (!['active', 'available'].includes(item.status)) result.blocked += 1;
    else if (!elsewhere) result.available.push(item);
    else if (kind !== 'truck' || (myKey && myKey === keyOf(elsewhere.front_id))) result.elsewhere.push(item);
    else result.blocked += 1;
  }
  return result;
}

function fertTeamRowHtml(item, front, editable, stageOf) {
  const stage = stageOf.get(item.id);
  const info = [];
  if (item.kind === 'truck') {
    if (item.capacity_m3) info.push(`${fertNumber(item.capacity_m3, 0)} m³`);
    if (item.fuel === 'gas') {
      const trips = item.gas_level_pct !== null && front.gas_pct_per_trip ? Math.floor(item.gas_level_pct / front.gas_pct_per_trip + 1e-9) : null;
      info.push(`gás ${item.gas_level_pct === null ? '—' : `${fertNumber(item.gas_level_pct, 0)}%`}${trips !== null ? ` · ${trips} viag.` : ''}`);
    }
  }
  if (item.front && item.front.front_id !== front.service_front_id) info.push(`vem da ${item.front.front}`);
  else if (stage) info.push(FERT_CYCLE_STAGES[stage.stage][0].toLocaleLowerCase('pt-BR'));
  return `<li class="fert-team-row">
      <span class="fert-cv ${stage ? FERT_CYCLE_STAGES[stage.stage][1] : 'is-new'}${item.fuel === 'gas' ? ' is-gas' : ''}">${escapeHtml(item.prefix)}</span>
      <small>${escapeHtml(info.join(' · ') || FERT_STATUS_LABELS[item.status])}</small>
      ${editable ? `<button type="button" class="fert-team-remove" data-fert-remove="${item.kind}|${item.id}" aria-label="Tirar ${escapeHtml(item.prefix)} da frente" title="Tirar da frente">×</button>` : ''}
    </li>`;
}

function fertTeamHtml(front, editable) {
  const byId = new Map(fertData.equipment.map(item => [item.id, item]));
  const stageOf = new Map((fertCyclePositions(front, fertData.defaults)?.trucks || []).map(item => [item.truck.id, item]));
  const block = kind => {
    const selected = fertPlanSelection[kind].map(id => byId.get(id)).filter(Boolean);
    const candidates = fertPlanCandidates(kind, front);
    const pickerOpen = fertPlanPicker === kind;
    const pick = item => `<button type="button" class="fert-pick" data-fert-add="${kind}|${item.id}">
        <b>${escapeHtml(item.prefix)}</b><small>${item.front ? `da ${escapeHtml(item.front.front)}` : 'disponível'}${item.kind === 'truck' && item.fuel === 'gas' ? ` · gás ${item.gas_level_pct ?? '—'}%` : ''}</small></button>`;
    const newForm = fertPlanNewKind === kind ? `<div class="fert-new" data-fert-new-form="${kind}">
        <label class="field"><span>Prefixo</span><input data-new="prefix" maxlength="20" autocomplete="off" placeholder="Ex.: ${kind === 'truck' ? '630' : '1060'}" /></label>
        ${kind === 'truck' ? `<label class="field"><span>Capacidade</span><input data-new="capacity_m3" inputmode="decimal" placeholder="${fertNumber(fertData.defaults.capacity_m3, 0)} m³" /></label>
        <label class="field"><span>Combustível</span><select data-new="fuel"><option value="diesel">Diesel</option><option value="gas">Gás</option></select></label>
        <label class="field"><span>Gás no tanque</span><input data-new="gas_level_pct" type="number" min="0" max="100" placeholder="% (se a gás)" /></label>` : ''}
        <div class="fert-new-actions"><button type="button" class="modal-button secondary" data-fert-new-cancel>Cancelar</button>
          <button type="button" class="modal-button save" data-fert-create="${kind}">Cadastrar e colocar na frente</button></div>
        <p class="fert-new-status" data-fert-new-status></p>
      </div>` : '';
    return `<section class="fert-team-block">
        <header><h3>${fertKindLabel(kind, true)} da frente <small>${selected.length}</small></h3>
          ${editable ? `<div class="fert-team-actions">
            <button type="button" class="production-secondary-button" data-fert-picker="${kind}" aria-expanded="${pickerOpen}">+ Adicionar</button>
            <button type="button" class="production-secondary-button" data-fert-new="${kind}">+ Cadastrar novo</button></div>` : ''}
        </header>
        ${selected.length ? `<ul class="fert-team-list">${selected.map(item => fertTeamRowHtml(item, front, editable, stageOf)).join('')}</ul>`
          : `<p class="fert-meta">Nenhum ${fertKindLabel(kind).toLocaleLowerCase('pt-BR')} na frente.</p>`}
        ${pickerOpen ? `<div class="fert-picker">
          ${candidates.available.length ? `<p class="fert-picker-title">Disponíveis</p><div class="fert-picks">${candidates.available.map(pick).join('')}</div>` : ''}
          ${candidates.elsewhere.length ? `<p class="fert-picker-title">De outra frente${kind === 'truck' ? ' (mesma recomendação)' : ''}</p><div class="fert-picks">${candidates.elsewhere.map(pick).join('')}</div>` : ''}
          ${!candidates.available.length && !candidates.elsewhere.length ? `<p class="fert-meta">Nenhum ${fertKindLabel(kind).toLocaleLowerCase('pt-BR')} livre para esta frente.</p>` : ''}
          ${candidates.blocked ? `<p class="fert-meta">${candidates.blocked} indisponíve${candidates.blocked === 1 ? 'l' : 'is'} (oficina, sem motorista, apoio, inativo${kind === 'truck' ? ' ou outra recomendação' : ''}).</p>` : ''}
        </div>` : ''}
        ${newForm}
      </section>`;
  };
  return `${block('truck')}${block('tractor')}
    <p class="fert-meta">Um CV de outra frente só entra se a recomendação de produtos for a mesma.</p>`;
}

function renderFertTeam() {
  const box = document.querySelector('#production-fert-team');
  if (box && fertEditing) box.innerHTML = fertTeamHtml(fertEditing, fertData.permissions.edit);
  renderFertPreview();
}

// Item da recomendação para a tela: "FERTILIZANTE SOLO H1 · 0,5 L/ha" (dose no padrão brasileiro).
function fertRecLabel(label) {
  const match = String(label).match(/^(.*) = ([\d.]+) (\S+)$/);
  if (!match) return label;
  const amount = Number(match[2]);
  const unit = { M3: 'm³/ha', L: 'L/ha', KG: 'kg/ha' }[match[3]] || match[3];
  return `${match[1]} · ${fertNumber(amount, amount % 1 ? (Math.round(amount * 10) === amount * 10 ? 1 : 2) : 0)} ${unit}`;
}

function fertOrderOption(front, number) {
  return front.orders.options?.find(item => item.order === number) || front.orders;
}

// O que vem da O.S. escolhida: setor, fazenda, tratos, vazão, talhões e a recomendação completa.
function fertAutoHtml(front, info) {
  const auto = (label, value) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
  return `<dl class="fert-os-grid">
      ${auto('Setor', escapeHtml(front.sector || '—'))}${auto('Fazenda', escapeHtml(front.farm || '—'))}
      ${auto('Tratos', escapeHtml(info.tratos || '—'))}
      ${auto('Vazão', info.flow_m3_ha !== null && info.flow_m3_ha !== undefined ? `${fertNumber(info.flow_m3_ha, 0)} m³/ha` : '<span class="fert-missing">sem vazão na O.S.</span>')}
      ${auto('Talhões', escapeHtml(info.plots?.join(', ') || '—'))}
    </dl>
    ${info.recommendation?.length ? `<ul class="fert-rec-list">${info.recommendation.map(item => `<li>${escapeHtml(fertRecLabel(item))}</li>`).join('')}</ul>`
      : '<p class="fert-missing">Sem componentes na O.S.: os CVs não podem trocar de frente.</p>'}`;
}

function fertFormState() {
  const form = document.querySelector('#production-fert-plan-form');
  const field = name => form.querySelector(`[name="${name}"]`)?.value ?? '';
  const params = Object.fromEntries(FERT_PARAM_FIELDS.map(([key]) => [key, field(key).trim().replace(',', '.')]));
  return {
    base: field('base'), flow: field('flow_m3_ha').trim().replace(',', '.'), radius: field('radius_km').trim().replace(',', '.'),
    order: field('order_number'),
    roundTrip: Boolean(form.querySelector('[name="round_trip"]')?.checked), params,
    gasPerTrip: field('gas_pct_per_trip').trim().replace(',', '.'),
    spacing: field('spacing') || 'simples', haMode: form.querySelector('[name="ha_mode"]')?.checked ? 'speed' : 'typed',
    tractors: [...fertPlanSelection.tractor], trucks: [...fertPlanSelection.truck]
  };
}

// Prévia ao vivo: números no topo e linha de CVs no rodapé.
function renderFertPreview() {
  const front = fertEditing;
  const head = document.querySelector('#production-fert-plan-kpis');
  const foot = document.querySelector('#production-fert-plan-preview');
  if (!front || !head) return;
  const state = fertFormState();
  const info = fertOrderOption(front, state.order);
  const flow = state.flow !== '' ? Number(state.flow) : info.flow_m3_ha ?? null;
  const radius = state.radius !== '' ? Number(state.radius) : null;
  const active = ids => ids.filter(id => ['active', 'available'].includes(fertData.equipment.find(item => item.id === id)?.status)).length;
  const speed = fertApplicationSpeed(flow);
  const speedHa = fertHaPerHourFromSpeed(speed, state.spacing);
  const hint = document.querySelector('#production-fert-speed-hint');
  if (hint) hint.textContent = speed === null ? 'Vazão fora da tabela da BASE GERAL (12 a 50 m³/ha): use o ha/hora digitado.'
    : `Vazão ${fertNumber(flow, 0)} m³/ha → ${fertNumber(speed, 1)} km/h → ${fertNumber(speedHa, 2)} ha/h por trator.`;
  const params = state.haMode === 'speed' && speedHa !== null ? { ...state.params, ha_per_hour: speedHa } : state.params;
  const calc = fertCalculate({ tractors: active(state.tractors), trucks: active(state.trucks), flow, radius,
    tratos: info.tratos || '', roundTrip: state.roundTrip, params }, fertData.defaults);
  const kpi = (label, value) => `<span class="fert-plan-kpi"><small>${escapeHtml(label)}</small><b>${value}</b></span>`;
  head.innerHTML = `${kpi('CVs', `${calc.trucks} de ${calc.needed ?? '—'}`)}${fertBalanceHtml(calc.balance)}
    ${kpi('Tratores', calc.tractors)}${kpi('Área', `${fertNumber(calc.yieldHa, 1)} ha`)}${kpi('Volume', `${fertNumber(calc.volume, 0)} m³`)}
    ${kpi('Ciclo', calc.cycle !== null ? `${fertNumber(calc.cycle, 2)} h` : '—')}${kpi('Saída a cada', calc.interval !== null ? `${fertNumber(calc.interval, 0)} min` : '—')}`;
  const done = { place: Boolean(state.base) && radius !== null && flow !== null, team: calc.trucks > 0 && calc.tractors > 0, params: calc.needed !== null };
  document.querySelectorAll('#production-fert-plan-form [data-fert-plan-tab]').forEach(step => step.classList.toggle('is-done', done[step.dataset.fertPlanTab]));
  if (foot) foot.innerHTML = flow === null || radius === null
    ? `<span class="fert-missing">Falta ${[flow === null ? 'a vazão' : '', radius === null ? 'o raio' : ''].filter(Boolean).join(' e ')}: etapa 1 (Local).</span>`
    : `<span>Necessários <b>${calc.needed}</b></span><span>Alocados <b>${calc.trucks}</b></span>${fertBalanceHtml(calc.balance)}`;
}

function setFertPlanTab(tab) {
  document.querySelectorAll('#production-fert-plan-form [data-fert-plan-tab]').forEach(button => {
    const active = button.dataset.fertPlanTab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'step' : 'false');
  });
  document.querySelectorAll('#production-fert-plan-form [data-fert-plan-panel]').forEach(panel => {
    panel.hidden = panel.dataset.fertPlanPanel !== tab;
  });
  const index = FERT_PLAN_STEPS.findIndex(([key]) => key === tab);
  const back = document.querySelector('#production-fert-plan-back');
  const next = document.querySelector('#production-fert-plan-next');
  if (back) back.hidden = index <= 0;
  if (next) next.hidden = index >= FERT_PLAN_STEPS.length - 1;
}

function stepFertPlan(offset) {
  const current = document.querySelector('#production-fert-plan-form [data-fert-plan-tab].is-active')?.dataset.fertPlanTab;
  const index = FERT_PLAN_STEPS.findIndex(([key]) => key === current) + offset;
  if (FERT_PLAN_STEPS[index]) setFertPlanTab(FERT_PLAN_STEPS[index][0]);
}

function openFertPlan(frontId) {
  const front = fertData?.fronts.find(item => item.service_front_id === frontId);
  const form = document.querySelector('#production-fert-plan-form');
  if (!front || !form) return;
  fertEditing = front;
  fertPlanSelection = { tractor: [...front.tractors], truck: [...front.trucks] };
  fertPlanPicker = null;
  fertPlanNewKind = null;
  const editable = fertData.permissions.edit;
  const meta = statusMeta(front.status);
  document.querySelector('#production-fert-plan-title').textContent = front.name;
  document.querySelector('#production-fert-plan-context').textContent =
    `${productionUnitLabel(fertData.unit)} · ${formatIsoDateBr(fertData.work_date)}`;
  const orders = front.orders;
  const bases = front.base_options;
  const hasCurrent = front.base && !bases.some(item => fertPlain(item.base) === fertPlain(front.base));
  const input = (name, label, unit, value, placeholder) => `<label class="field fert-field"><span>${escapeHtml(label)}</span>
      <div class="fert-input"><input name="${name}" ${name === 'radius_km' ? 'id="production-fert-radius"' : ''} inputmode="decimal" autocomplete="off"
        value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(placeholder)}" ${editable ? '' : 'disabled'} /><em>${escapeHtml(unit)}</em></div></label>`;
  const firstStep = front.base && front.radius_km !== null ? 'team' : 'place';
  form.innerHTML = `<div class="fert-plan-head">
      <div class="fert-plan-place">
        <span class="pdash-status ${meta.className}">${escapeHtml(meta.name)}</span>
        <strong>Setor ${escapeHtml(front.sector || '—')}</strong>${front.farm ? `<span>${escapeHtml(front.farm)}</span>` : ''}
        <span>${escapeHtml(front.base || 'sem base')} · ${front.radius_km !== null ? `${fertNumber(front.radius_km, 1)} km` : 'sem raio'}</span>
        ${orders.recommendation.length ? fertRecommendationShortHtml(orders.recommendation) : '<span class="fert-missing">sem recomendação na O.S.</span>'}
      </div>
      <div class="fert-plan-kpis" id="production-fert-plan-kpis" aria-live="polite"></div>
    </div>
    <ol class="fert-steps" aria-label="Etapas da configuração">${FERT_PLAN_STEPS.map(([key, label, hint], index) => `<li>
      <button type="button" class="fert-step${key === firstStep ? ' is-active' : ''}" data-fert-plan-tab="${key}" aria-current="${key === firstStep ? 'step' : 'false'}">
        <i aria-hidden="true">${index + 1}</i><span><b>${label}</b><small>${hint}</small></span></button></li>`).join('')}</ol>
    <div data-fert-plan-panel="place" class="fert-plan-panel"${firstStep === 'place' ? '' : ' hidden'}>
      <section class="fert-fill">
        <h3>Você preenche</h3>
        <div class="fert-grid">
          <label class="field fert-field"><span>Base de carregamento</span>
            <select name="base" ${editable ? '' : 'disabled'}>
              <option value="">Selecione</option>
              ${hasCurrent ? `<option value="${escapeHtml(front.base)}" selected>${escapeHtml(front.base)}</option>` : ''}
              ${bases.map(item => `<option value="${escapeHtml(item.base)}"${fertPlain(item.base) === fertPlain(front.base) ? ' selected' : ''}>${escapeHtml(item.base)}${item.radius_km != null ? ` · ${fertNumber(item.radius_km, 1)} km` : ''}</option>`).join('')}
            </select></label>
          ${input('radius_km', 'Raio do setor até a base', 'km', front.radius_km, 'Digite o raio')}
        </div>
        <p class="fert-meta">O raio fica guardado para este setor e base: na próxima vez que a frente vier para cá, ele já aparece.</p>
      </section>
      <section class="fert-auto">
        <h3>Vem do sistema <small>lançamento da frente e O.S. do PIMS</small></h3>
        ${orders.options?.length > 1 ? `<label class="field fert-field fert-order-pick"><span>O.S. em aplicação <small>${orders.options.length} O.S. de fert abertas no setor</small></span>
          <select name="order_number" ${editable ? '' : 'disabled'}>${orders.options.map(option => `<option value="${escapeHtml(option.order)}"${option.order === orders.order ? ' selected' : ''}>${escapeHtml(option.order)} · aberta ${escapeHtml(option.opened_on ? formatIsoDateBr(option.opened_on) : '—')} · ${option.plots.length} ${option.plots.length === 1 ? 'talhão' : 'talhões'}${option.recommendation_key === orders.recommendation_key ? '' : ' · outra receita'}</option>`).join('')}</select></label>`
          : `<input type="hidden" name="order_number" value="${escapeHtml(orders.order || '')}" /><p class="fert-meta">O.S. ${escapeHtml(orders.order || '— (sem O.S. de fertirrigação no setor)')}</p>`}
        ${orders.missing_order ? `<p class="fert-col-warn">A O.S. ${escapeHtml(orders.missing_order)} escolhida antes não está mais aberta${orders.order ? `: usando a ${escapeHtml(orders.order)} (mais recente do setor). Salve para confirmar.` : '.'}</p>` : ''}
        <div id="production-fert-auto">${fertAutoHtml(front, orders)}</div>
        <details class="fert-more"${front.flow_source === 'plano' || orders.flow_m3_ha === null ? ' open' : ''}><summary>Corrigir a vazão${orders.flow_m3_ha === null ? ' (obrigatório sem O.S.)' : ''}</summary>
          <div class="fert-grid">${input('flow_m3_ha', 'Vazão', 'm³/ha', front.flow_source === 'plano' ? front.flow_m3_ha : '', orders.flow_m3_ha !== null ? `${fertNumber(orders.flow_m3_ha, 0)} (O.S.)` : 'Informe a vazão')}</div>
        </details>
      </section>
    </div>
    <div data-fert-plan-panel="team" class="fert-plan-panel" id="production-fert-team"${firstStep === 'team' ? '' : ' hidden'}></div>
    <div data-fert-plan-panel="params" class="fert-plan-panel" hidden>
      <p class="fert-meta">Os números no topo são o resultado da frente. Os ajustes abaixo são opcionais: em branco vale o padrão da planilha.</p>
      <details class="fert-more"><summary>Ajustes da conta (opcional)</summary>
        <div class="fert-grid">${FERT_PARAM_FIELDS.map(([key, label, unit]) => input(key, label, unit, front.params[key], fertNumber(fertData.defaults[key], 2))).join('')}
          ${input('gas_pct_per_trip', 'Gás por viagem (CV a gás)', '% tanque', front.params.gas_pct_per_trip,
            front.radius_km ? `${fertNumber(front.radius_km * 0.85, 1)} (raio × 0,85)` : 'raio × 0,85')}
          <label class="field fert-field"><span>Espaçamento</span>
            <select name="spacing" ${editable ? '' : 'disabled'}>${Object.entries(FERT_SPACINGS).map(([key, item]) =>
              `<option value="${key}"${front.spacing === key ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>
        </div>
        <label class="fert-check"><input type="checkbox" name="round_trip" ${front.params.round_trip ? 'checked' : ''} ${editable ? '' : 'disabled'} />
          Bate/volta (descarregamento ${fertNumber(fertData.defaults.unload_round_trip_h, 1)} h)</label>
        <label class="fert-check"><input type="checkbox" name="ha_mode" ${front.ha_mode === 'speed' ? 'checked' : ''} ${editable ? '' : 'disabled'} />
          Calcular ha/hora pela velocidade da vazão</label>
        <p class="fert-meta" id="production-fert-speed-hint"></p>
      </details>
    </div>`;
  document.querySelector('#production-fert-plan-save').hidden = !editable;
  const status = document.querySelector('#production-fert-plan-status');
  status.classList.remove('is-error');
  status.textContent = front.plan_carried ? `Plano copiado de ${formatIsoDateBr(front.plan_date)}: salve para confirmar o dia.`
    : front.plan_updated_at ? `Atualizado ${fertTime(front.plan_updated_at)}${front.plan_updated_by ? ` por ${front.plan_updated_by}` : ''}.` : '';
  renderFertTeam();
  setFertPlanTab(firstStep);
  openModal('production-fert-plan-modal');
}

// Cadastra o equipamento pelo popup e já coloca na frente (o plano é salvo no "Salvar plano").
async function createFertEquipmentFromPlan(kind) {
  const box = document.querySelector(`[data-fert-new-form="${kind}"]`);
  if (!box || !fertData?.permissions.edit) return;
  const value = name => box.querySelector(`[data-new="${name}"]`)?.value.trim() ?? '';
  const status = box.querySelector('[data-fert-new-status]');
  if (!value('prefix')) {
    status.textContent = 'Informe o prefixo.';
    return;
  }
  const button = box.querySelector('[data-fert-create]');
  button.disabled = true;
  try {
    const result = await apiRequest('/api/production/fert/equipment', { method: 'POST', body: JSON.stringify({
      unit_code: fertData.unit, work_date: fertData.work_date, kind, prefix: value('prefix'), status: 'available',
      capacity_m3: value('capacity_m3'), fuel: value('fuel') || 'diesel', gas_level_pct: value('gas_level_pct')
    }) });
    fertData.equipment.push({ ...result.equipment, front: null, gas_trips: null });
    fertPlanSelection[kind].push(result.equipment.id);
    fertPlanNewKind = null;
    showToast(`${fertKindLabel(kind)} ${result.equipment.prefix} cadastrado. Salve o plano para confirmar na frente.`);
    renderFertTeam();
  } catch (error) {
    status.textContent = error.message || 'Não foi possível cadastrar.';
    button.disabled = false;
  }
}

async function saveFertPlan(event) {
  event.preventDefault();
  const front = fertEditing;
  if (!front || !fertData?.permissions.edit) return;
  const state = fertFormState();
  const button = document.querySelector('#production-fert-plan-save');
  const status = document.querySelector('#production-fert-plan-status');
  button.disabled = true;
  try {
    const result = await apiRequest('/api/production/fert/plan', { method: 'PUT', body: JSON.stringify({
      unit_code: fertData.unit, work_date: fertData.work_date, service_front_id: front.service_front_id,
      version: front.plan_version || '',
      params: { ...state.params, base: state.base, order_number: state.order, flow_m3_ha: state.flow, radius_km: state.radius, round_trip: state.roundTrip,
        gas_pct_per_trip: state.gasPerTrip, spacing: state.spacing, ha_mode: state.haMode },
      tractors: state.tractors, trucks: state.trucks
    }) });
    closeModal('production-fert-plan-modal');
    showToast(result.moved ? `Plano salvo · ${result.moved} equipamento(s) mudou(aram) de frente.` : 'Plano da frente salvo.');
    await loadFertOverview();
  } catch (error) {
    status.classList.add('is-error');
    status.textContent = error.message || 'Não foi possível salvar o plano.';
  } finally {
    button.disabled = false;
  }
}

document.querySelector('#production-fert-plan-form')?.addEventListener('submit', saveFertPlan);
document.querySelector('#production-fert-plan-back')?.addEventListener('click', () => stepFertPlan(-1));
document.querySelector('#production-fert-plan-next')?.addEventListener('click', () => stepFertPlan(1));
document.querySelector('#production-fert-plan-form')?.addEventListener('input', renderFertPreview);
// Trocar a base traz o raio já guardado do setor até ela (ou deixa em branco para digitar).
document.querySelector('#production-fert-plan-form')?.addEventListener('change', event => {
  if (event.target.name === 'order_number' && fertEditing) {
    const box = document.querySelector('#production-fert-auto');
    if (box) box.innerHTML = fertAutoHtml(fertEditing, fertOrderOption(fertEditing, event.target.value));
  }
  if (event.target.name === 'base' && fertEditing) {
    const option = fertEditing.base_options.find(item => fertPlain(item.base) === fertPlain(event.target.value));
    const radius = document.querySelector('#production-fert-radius');
    if (radius) radius.value = option?.radius_km ?? '';
  }
  renderFertPreview();
});
document.querySelector('#production-fert-plan-form')?.addEventListener('click', event => {
  const tab = event.target.closest('[data-fert-plan-tab]');
  if (tab) return setFertPlanTab(tab.dataset.fertPlanTab);
  const remove = event.target.closest('[data-fert-remove]');
  const add = event.target.closest('[data-fert-add]');
  if (remove || add) {
    const [kind, id] = (remove || add).dataset[remove ? 'fertRemove' : 'fertAdd'].split('|');
    fertPlanSelection[kind] = remove ? fertPlanSelection[kind].filter(item => item !== Number(id)) : [...fertPlanSelection[kind], Number(id)];
    return renderFertTeam();
  }
  const picker = event.target.closest('[data-fert-picker]');
  if (picker) {
    fertPlanPicker = fertPlanPicker === picker.dataset.fertPicker ? null : picker.dataset.fertPicker;
    fertPlanNewKind = null;
    return renderFertTeam();
  }
  const newButton = event.target.closest('[data-fert-new]');
  if (newButton) {
    fertPlanNewKind = fertPlanNewKind === newButton.dataset.fertNew ? null : newButton.dataset.fertNew;
    fertPlanPicker = null;
    renderFertTeam();
    document.querySelector(`[data-fert-new-form="${fertPlanNewKind}"] [data-new="prefix"]`)?.focus();
    return;
  }
  if (event.target.closest('[data-fert-new-cancel]')) {
    fertPlanNewKind = null;
    return renderFertTeam();
  }
  const create = event.target.closest('[data-fert-create]');
  if (create) createFertEquipmentFromPlan(create.dataset.fertCreate);
});
// Enter no cadastro rápido cadastra (sem enviar o plano).
document.querySelector('#production-fert-plan-form')?.addEventListener('keydown', event => {
  const box = event.target.closest?.('[data-fert-new-form]');
  if (!box || event.key !== 'Enter') return;
  event.preventDefault();
  createFertEquipmentFromPlan(box.dataset.fertNewForm);
});
