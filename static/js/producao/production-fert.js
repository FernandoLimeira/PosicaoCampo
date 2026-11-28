// Fertirrigação (Polo SP): painel gerencial único — dimensionamento de CVs por frente, plano do
// dia, frota com situação de cada CV/trator, recomendação de produtos (O.S. do PIMS) e as
// movimentações do dia. A conta é a da planilha "Logística Fertirrigação" (mesma do servidor,
// backend/services/fert_dimensioning.py); aqui ela roda só para a prévia do popup.
const FERT_UNITS = ['PPT', 'NRD'];
const FERT_PARAM_FIELDS = [
  ['hours', 'Horas trabalhadas', 'h'], ['ha_per_hour', 'ha por hora (trator)', 'ha/h'],
  ['capacity_m3', 'Capacidade por viagem', 'm³'], ['speed_loaded', 'Velocidade carregado', 'km/h'],
  ['speed_empty', 'Velocidade vazio', 'km/h'], ['aux_h', 'Tempo auxiliar', 'h'],
  ['load_h', 'Carregamento', 'h'], ['unload_h', 'Descarregamento', 'h']
];
const FERT_REDUCED_TRATOS = ['TRATOS RUA MAE', 'TRATOS PLANTIO', 'TRATOS MEIOSI'];
const FERT_STATUS_LABELS = { active: 'Operando', available: 'Disponível', workshop: 'Oficina', no_driver: 'Sem motorista', support: 'Apoio', inactive: 'Inativo' };
const FERT_EVENT_LABELS = { allocate: 'Alocado', move: 'Troca de frente', release: 'Saiu da frente', status: 'Situação', gas: 'Gás', create: 'Cadastro', delete: 'Exclusão' };
// BASE GERAL: vazão (m³/ha) → velocidade de aplicação (km/h) e espaçamento (entrelinha × seções).
const FERT_APPLICATION_SPEED = { 12: 9, 13: 9, 14: 9, 15: 8.5, 16: 8.5, 17: 8.5, 18: 8.5, 19: 8.5, 20: 8.5, 21: 8, 22: 8, 23: 8,
  24: 7.5, 25: 7.5, 26: 7.5, 27: 7, 28: 7, 29: 6.5, 30: 6, 31: 6, 32: 5.5, 33: 5.5, 34: 5.5, 35: 5, 36: 5, 37: 5, 38: 4.5,
  39: 4.5, 40: 4, 41: 4, 42: 3.5, 43: 3.5, 44: 3.5, 45: 3.5, 46: 3, 47: 3, 48: 3, 49: 3, 50: 2 };
const FERT_SPACINGS = { simples: { label: 'Simples (1,5 m · 10 seções)', spacing: 1.5, sections: 10 },
  combinado: { label: 'Combinado (2,4 m · 5 seções)', spacing: 2.4, sections: 5 } };
function fertApplicationSpeed(flow) {
  return flow === null || flow === undefined || flow === '' ? null : FERT_APPLICATION_SPEED[Math.floor(Number(flow) + 0.5)] ?? null;
}
function fertHaPerHourFromSpeed(speed, spacing) {
  const layout = FERT_SPACINGS[spacing];
  return speed === null || !layout ? null : speed * layout.spacing * layout.sections / 10;
}
let fertData = null;
let fertEditing = null;
let fertLoadSeq = 0;
let fertFleetKind = 'truck';

function fertPageActive() {
  return String(globalThis.location?.pathname || '').startsWith('/producao/fertirrigacao');
}

function fertNumber(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fertPlain(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function fertTime(seconds) {
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

// Mesma conta do servidor (fert_dimensioning.calculate).
function fertCalculate({ tractors, trucks, flow, radius, tratos = '', roundTrip = false, params = {} }, defaults) {
  const value = key => (params[key] !== null && params[key] !== undefined && params[key] !== '' ? Number(params[key]) : defaults[key]);
  const unload = roundTrip ? defaults.unload_round_trip_h : value('unload_h');
  const reduced = FERT_REDUCED_TRATOS.some(name => fertPlain(tratos).includes(name));
  const yieldHa = value('hours') * tractors * value('ha_per_hour') / (reduced ? 3 : 1);
  const result = { tractors, trucks, yieldHa, reduced, volume: null, cvHour: null, cycle: null, trips: null, interval: null, needed: null, balance: null };
  if (flow !== null && flow !== undefined) {
    result.volume = flow * yieldHa;
    result.cvHour = result.volume / value('capacity_m3') / 24;
    if (result.cvHour > 0) result.interval = 60 / result.cvHour;
  }
  if (radius !== null && radius !== undefined) {
    result.cycle = radius / value('speed_loaded') + radius / value('speed_empty') + value('aux_h') + value('load_h') + unload;
    result.trips = result.cycle > 0 ? 24 / result.cycle : null;
  }
  if (result.cvHour !== null && result.cycle !== null) {
    result.needed = Math.ceil(Math.round(result.cvHour * result.cycle * 1e9) / 1e9);
    result.balance = trucks - result.needed;
  }
  return result;
}

function fertBalanceHtml(balance) {
  if (balance === null || balance === undefined) return '<span class="fert-balance is-pending">—</span>';
  const tone = balance < 0 ? 'is-short' : balance > 0 ? 'is-over' : 'is-ok';
  const label = balance < 0 ? `faltam ${-balance}` : balance > 0 ? `sobram ${balance}` : 'ok';
  return `<span class="fert-balance ${tone}">${escapeHtml(label)}</span>`;
}

function fertStatusBadge(status) {
  return `<span class="fert-status is-${escapeHtml(status)}">${escapeHtml(FERT_STATUS_LABELS[status] || status)}</span>`;
}

function fertEquipmentPrefixes(ids) {
  const byId = new Map((fertData?.equipment || []).map(item => [item.id, item]));
  return ids.map(id => byId.get(id)?.prefix).filter(Boolean);
}

function fertRecommendationText(orders) {
  return orders?.recommendation?.length ? orders.recommendation.join(' + ') : '';
}

// Recomendação resumida para as tabelas: o produto em m³ e o fertilizante de maior dose
// (sem o "FERTILIZANTE" na frente), mais quantos itens faltam; a lista completa fica no título.
function fertRecommendationShortHtml(recommendation) {
  if (!recommendation?.length) return '';
  const parsed = recommendation.map(label => {
    const match = label.match(/^(.*) = ([\d.]+) (\S+)$/);
    return { label, name: (match?.[1] || label).replace(/^FERTILIZANTE\s+/i, ''), amount: Number(match?.[2] || 0), unit: match?.[3] || '' };
  });
  const flow = parsed.find(item => item.unit === 'M3');
  const main = parsed.filter(item => item.unit !== 'M3').sort((a, b) => b.amount - a.amount)[0];
  const shown = [flow, main].filter(Boolean);
  const rest = parsed.length - shown.length;
  const text = shown.map(item => `${item.name} ${fertNumber(item.amount, item.amount % 1 ? 1 : 0)} ${item.unit === 'M3' ? 'm³' : item.unit}`).join(' · ');
  return `<span class="fert-rec" title="${escapeHtml(recommendation.join(' · '))}">${escapeHtml(text)}${rest > 0 ? ` <b>+${rest}</b>` : ''}</span>`;
}

// ---------------------------------------------------------------------------
// Painel: indicadores, frentes, frota do dia e movimentações.
// ---------------------------------------------------------------------------
function renderFertKpis() {
  const kpis = document.querySelector('#production-fert-kpis');
  const totals = fertData.totals;
  const short = totals.balance !== null && totals.balance < 0;
  const card = (label, value, detail = '', tone = '') => `<article class="fert-kpi ${tone}"><small>${escapeHtml(label)}</small>
    <strong>${value}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</article>`;
  const fleet = fertData.fleet.truck;
  const outOfService = fleet.workshop + fleet.no_driver + fleet.support;
  kpis.innerHTML = [
    card('CVs necessários', escapeHtml(totals.trucks_needed ?? '—'), totals.incomplete ? `${totals.incomplete} frente(s) sem vazão ou raio` : 'para atender as frentes'),
    card('CVs nas frentes', escapeHtml(totals.trucks), `${fleet.available} disponíveis · ${outOfService} fora de operação`),
    card('Saldo de CVs', totals.balance === null ? '—' : escapeHtml(totals.balance > 0 ? `+${totals.balance}` : totals.balance),
      short ? `faltam ${-totals.balance} CVs${fleet.available ? ` · ${fleet.available} disponíveis` : ''}` : totals.balance > 0 ? 'CVs sobrando' : 'frota ajustada',
      short ? 'is-short' : totals.balance > 0 ? 'is-over' : 'is-ok'),
    card('Volume do dia', `${fertNumber(totals.volume_m3, 0)} <em>m³</em>`, `vazão média ${fertNumber(totals.flow_m3_ha, 1)} m³/ha`),
    card('Área do dia', `${fertNumber(totals.yield_ha, 1)} <em>ha</em>`, `${totals.tractors} tratores · raio médio ${fertNumber(totals.radius_km, 1)} km`)
  ].join('');
}

function renderFertFronts() {
  const body = document.querySelector('#production-fert-body');
  const meta = document.querySelector('#production-fert-meta');
  if (meta) meta.textContent = `${fertData.totals.fronts} ${fertData.totals.fronts === 1 ? 'frente' : 'frentes'} · ${formatIsoDateBr(fertData.work_date)} · clique na frente para configurar`;
  body.innerHTML = fertData.fronts.map(front => {
    const calc = front.calc;
    const missing = calc.trucks_needed === null
      ? `<small class="fert-missing">Informe ${escapeHtml([front.flow_m3_ha === null ? 'a vazão' : '', front.radius_km === null ? (front.base ? 'o raio' : 'a base') : ''].filter(Boolean).join(' e '))}</small>` : '';
    const recommendation = fertRecommendationText(front.orders);
    return `<tr tabindex="0" data-fert-front="${front.service_front_id}" class="${calc.balance !== null && calc.balance < 0 ? 'is-short' : ''}">
      <td><strong>${escapeHtml(front.name)}</strong><small>${escapeHtml(statusMeta(front.status).name)}${front.plan_carried ? ` · plano de ${escapeHtml(formatIsoDateBr(front.plan_date))}` : ''}</small></td>
      <td>${escapeHtml(front.sector)}<small>${escapeHtml(front.farm || '-')}</small></td>
      <td class="fert-rec-cell">${recommendation ? fertRecommendationShortHtml(front.orders.recommendation) : '<small class="fert-missing">Sem recomendação na O.S.</small>'}<small>O.S. ${escapeHtml(front.orders.orders[0] || '—')}</small></td>
      <td>${escapeHtml(front.base || '—')}<small>${front.radius_km !== null ? `${fertNumber(front.radius_km, 1)} km` : 'sem raio'}</small>${missing}</td>
      <td>${front.flow_m3_ha !== null ? `${fertNumber(front.flow_m3_ha, 0)} m³/ha` : '—'}<small>${escapeHtml(front.flow_source || '')}</small></td>
      <td class="is-number">${calc.tractors}</td>
      <td class="is-number">${fertNumber(calc.yield_ha, 1)}${calc.reduced_yield ? '<small>÷ 3 (tratos)</small>' : ''}</td>
      <td class="is-number">${fertNumber(calc.volume_m3, 0)}</td>
      <td class="is-number">${calc.cycle_h !== null ? `${fertNumber(calc.cycle_h, 2)} h` : '—'}</td>
      <td class="is-number">${calc.interval_min !== null ? `${fertNumber(calc.interval_min, 0)} min` : '—'}</td>
      <td class="is-number is-strong">${calc.trucks_needed ?? '—'}</td>
      <td class="is-number">${calc.trucks}<small>${escapeHtml(fertEquipmentPrefixes(front.trucks).join(', '))}</small></td>
      <td>${fertBalanceHtml(calc.balance)}</td>
    </tr>`;
  }).join('');
  document.querySelector('#production-fert-empty').hidden = fertData.fronts.length > 0;
}

function renderFertEvents() {
  const box = document.querySelector('#production-fert-events');
  if (!box) return;
  const events = fertData.events;
  box.innerHTML = `<header class="catalog-section-header"><div><h2>Movimentações do dia</h2>
      <p class="fert-meta">Alocações, trocas de frente e mudanças de situação, com quem fez.</p></div></header>
    ${events.length ? `<ol class="fert-events">${events.map(event => `<li>
      <time>${escapeHtml(fertTime(event.created_at).slice(-5))}</time>
      <strong>${escapeHtml(event.kind === 'truck' ? 'CV' : event.kind === 'tractor' ? 'Trator' : '')} ${escapeHtml(event.prefix)}</strong>
      <span class="fert-event-type is-${escapeHtml(event.action)}">${escapeHtml(FERT_EVENT_LABELS[event.action] || event.action)}</span>
      <span>${escapeHtml(event.detail)}</span><small>${escapeHtml(event.user)}</small></li>`).join('')}</ol>`
    : '<p class="production-empty">Nenhuma movimentação hoje.</p>'}`;
}

// ---------------------------------------------------------------------------
// Ciclo dos CVs (estimado): cada frente vira uma "estrada" base → frente. Sem GPS, a posição
// de cada CV vem do ciclo planejado da frente: os CVs saem da base espaçados igualmente
// (intervalo de saída) e percorrem carregamento, ida carregado, descarregamento e volta vazio.
// ---------------------------------------------------------------------------
const FERT_CYCLE_STAGES = {
  loading: ['Carregando na base', 'is-loading'], loaded: ['Indo carregado', 'is-loaded'],
  unloading: ['Descarregando na frente', 'is-unloading'], empty: ['Voltando vazio', 'is-empty']
};

// Etapas do ciclo da frente (horas), na ordem: base (carregamento + auxiliar), ida, frente, volta.
function fertCycleLegs(front, defaults) {
  if (front.radius_km === null || front.radius_km === undefined) return null;
  const value = key => (front.params[key] !== null && front.params[key] !== undefined ? Number(front.params[key]) : defaults[key]);
  const unload = front.params.round_trip ? defaults.unload_round_trip_h : value('unload_h');
  const legs = { loading: value('load_h') + value('aux_h'), loaded: front.radius_km / value('speed_loaded'),
    unloading: unload, empty: front.radius_km / value('speed_empty') };
  const cycle = legs.loading + legs.loaded + legs.unloading + legs.empty;
  return cycle > 0 ? { legs, cycle } : null;
}

// Onde está cada CV agora (estimativa): etapa, avanço na etapa (0–1) e minutos para terminar.
function fertCyclePositions(front, defaults, now = new Date()) {
  const plan = fertCycleLegs(front, defaults);
  if (!plan) return null;
  const trucks = fertData.equipment.filter(item => front.trucks.includes(item.id) && ['active', 'available'].includes(item.status))
    .sort((a, b) => a.prefix.localeCompare(b.prefix, 'pt-BR', { numeric: true }));
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map(part => [part.type, part.value]));
  const hours = Number(parts.hour) + Number(parts.minute) / 60;
  return { ...plan, trucks: trucks.map((truck, index) => {
    let t = ((hours + index * plan.cycle / trucks.length) % plan.cycle + plan.cycle) % plan.cycle;
    for (const stage of ['loading', 'loaded', 'unloading', 'empty']) {
      if (t < plan.legs[stage] || stage === 'empty') {
        const length = plan.legs[stage] || 1;
        return { truck, stage, progress: Math.min(1, t / length), minutesLeft: Math.max(0, Math.round((length - t) * 60)) };
      }
      t -= plan.legs[stage];
    }
    return null;
  }).filter(Boolean) };
}

// Etapa do CV no ciclo e quanto falta: "Indo carregado · chega na frente em 12 min".
function fertStageText(item) {
  const left = `${item.minutesLeft} min`;
  const next = { loaded: `chega na frente em ${left}`, empty: `chega na base em ${left}`, loading: `sai da base em ${left}` }[item.stage]
    || `termina em ${left}`;
  return `${FERT_CYCLE_STAGES[item.stage][0]} · ${next}`;
}

function renderFertCycle() {
  const box = document.querySelector('#production-fert-cycle');
  if (!box || !fertData) return;
  const lanes = fertData.fronts.map(front => ({ front, positions: fertCyclePositions(front, fertData.defaults) }));
  const counts = { loading: 0, loaded: 0, unloading: 0, empty: 0 };
  lanes.forEach(({ positions }) => positions?.trucks.forEach(item => { counts[item.stage] += 1; }));
  const chip = (item, where) => `<span class="fert-cv ${FERT_CYCLE_STAGES[item.stage][1]}${item.truck.fuel === 'gas' ? ' is-gas' : ''}" data-fert-cv="${item.truck.id}" data-cv-progress="${where === 'road' ? item.progress : ''}"
      data-cv-stage="${item.stage}" title="CV ${escapeHtml(item.truck.prefix)} · ${escapeHtml(fertStageText(item).toLocaleLowerCase('pt-BR'))}">${escapeHtml(item.truck.prefix)}</span>`;
  box.innerHTML = `<header class="catalog-section-header">
      <div><h2>Ciclo dos CVs agora</h2>
        <p class="fert-meta">Posição estimada pelo ciclo planejado de cada frente (sem GPS): os CVs saem da base no intervalo de saída. Passe o mouse no CV para ver o tempo.</p></div>
    </header>
    <div class="fert-cycle-counts">${Object.entries(FERT_CYCLE_STAGES).map(([stage, [label, tone]]) =>
      `<div class="fert-cycle-count ${tone}"><i aria-hidden="true"></i><strong>${counts[stage]}</strong><span>${escapeHtml(label)}</span></div>`).join('')}</div>
    <div class="fert-lanes">${lanes.map(({ front, positions }) => {
      const head = `<div class="fert-lane-head"><strong>${escapeHtml(front.name)}</strong>
          <span>${escapeHtml(front.base || 'sem base')} → setor ${escapeHtml(front.sector)}${front.radius_km !== null ? ` · ${fertNumber(front.radius_km, 1)} km` : ''}</span>
          <span>${positions ? `ciclo ${fertNumber(positions.cycle, 2)} h · saída a cada ${front.calc.interval_min !== null ? `${fertNumber(front.calc.interval_min, 0)} min` : '—'}` : ''}</span>
          <span class="fert-lane-trucks">${front.calc.trucks} de ${front.calc.trucks_needed ?? '—'} CVs ${fertBalanceHtml(front.calc.balance)}</span></div>`;
      if (!positions) return `<article class="fert-lane is-pending">${head}<p class="fert-missing">Informe a base e o raio no plano para ver o ciclo.</p></article>`;
      const at = stage => positions.trucks.filter(item => item.stage === stage);
      return `<article class="fert-lane" data-fert-front="${front.service_front_id}" tabindex="0">${head}
        <div class="fert-route">
          <div class="fert-stop is-base"><small>Base</small><b>${escapeHtml(front.base || '—')}</b><div class="fert-stop-cvs">${at('loading').map(item => chip(item, 'stop')).join('') || '<em>—</em>'}</div></div>
          <div class="fert-road">
            <div class="fert-track is-go"><span class="fert-track-label">carregado →</span>${at('loaded').map(item => chip(item, 'road')).join('')}</div>
            <div class="fert-track is-back"><span class="fert-track-label">← vazio</span>${at('empty').map(item => chip(item, 'road')).join('')}</div>
          </div>
          <div class="fert-stop is-front"><small>Frente</small><b>Setor ${escapeHtml(front.sector)}</b><div class="fert-stop-cvs">${at('unloading').map(item => chip(item, 'stop')).join('') || '<em>—</em>'}</div></div>
        </div>
      </article>`;
    }).join('') || '<p class="production-empty">Nenhuma frente de fertirrigação lançada.</p>'}</div>`;
  // A CSP bloqueia "style" no HTML: a posição de cada CV na estrada é aplicada aqui.
  box.querySelectorAll('[data-cv-progress]').forEach(element => {
    if (element.dataset.cvProgress === '') return;
    const progress = Number(element.dataset.cvProgress);
    const percent = element.dataset.cvStage === 'empty' ? 100 - progress * 100 : progress * 100;
    element.style.left = `calc(${Math.min(96, Math.max(4, percent))}% - 18px)`;
  });
}

function renderFertOverview() {
  if (!fertData || !document.querySelector('#production-fert-body')) return;
  renderFertKpis();
  renderFertDispatch();
  renderFertCycle();
  renderFertFronts();
  renderFertWeek();
  renderFertBoard();
  renderFertEvents();
}

function showFertMessage(message) {
  const box = document.querySelector('#production-fert-message');
  if (!box) return;
  box.textContent = message;
  box.hidden = !message;
  for (const selector of ['#production-fert-kpis', '#production-fert-views']) {
    const element = document.querySelector(selector);
    if (element) element.hidden = Boolean(message);
  }
}

async function loadFertOverview() {
  if (!fertPageActive()) return;
  const unit = currentProductionUnit();
  const seq = ++fertLoadSeq;
  if (!FERT_UNITS.includes(unit)) {
    fertData = null;
    showFertMessage('A fertirrigação está disponível para o Polo SP: escolha PPT ou NRD no menu de unidades.');
    return;
  }
  try {
    const data = await apiRequest(`/api/production/fert?unit=${encodeURIComponent(unit)}&date=${encodeURIComponent(saoPauloIsoDate())}`);
    if (seq !== fertLoadSeq) return;
    fertData = data;
    showFertMessage('');
    renderFertOverview();
    if (!document.querySelector('#production-fert-fleet-modal')?.hidden) renderFertFleet();
  } catch (error) {
    if (seq !== fertLoadSeq) return;
    console.error(error);
    showFertMessage(error.message || 'Não foi possível carregar a fertirrigação.');
  }
}

// Abrir o plano da frente pela tabela e pelo ciclo.
document.querySelector('#production-fert-body')?.addEventListener('click', event => {
  const row = event.target.closest('[data-fert-front]');
  if (row) openFertPlan(Number(row.dataset.fertFront));
});
document.querySelector('#production-fert-body')?.addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key) || !event.target.matches?.('[data-fert-front]')) return;
  event.preventDefault();
  openFertPlan(Number(event.target.dataset.fertFront));
});
document.querySelector('#production-fert-cycle')?.addEventListener('click', event => {
  const cv = event.target.closest('[data-fert-cv]');
  if (cv) {
    openFertCv(Number(cv.dataset.fertCv));
    return;
  }
  const lane = event.target.closest('[data-fert-front]');
  if (lane) openFertPlan(Number(lane.dataset.fertFront));
});

document.addEventListener('report-unit-change', () => {
  if (fertPageActive()) window.setTimeout(loadFertOverview, 0);
});
if (fertPageActive()) {
  loadFertOverview();
  // O ciclo anda com o relógio: redesenha a cada minuto só na tela (sem consultar o servidor).
  globalThis.setInterval?.(() => { if (fertData && document.visibilityState !== 'hidden') renderFertCycle(); }, 60000);
}
