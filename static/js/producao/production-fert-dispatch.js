// Fertirrigação: quadro de alocação dos CVs (padrão de despacho). Depende de production-fert.js.
// Uma coluna de CVs disponíveis e uma coluna por frente, com a receita (frentes com a mesma
// recomendação de produtos ganham a mesma etiqueta e trocam CVs entre si), a meta de CVs e cada CV
// na etapa do ciclo: carregando, indo carregado, descarregando ou voltando vazio. Arrastar o CV
// aloca, troca de frente ou libera; o servidor confere a receita de novo.
const FERT_VIEWS = ['dispatch', 'cycle', 'fronts', 'week', 'fleet', 'events'];
const FERT_STAGE_SHORT = { loading: 'Carregando', loaded: 'Indo carregado', unloading: 'Descarregando', empty: 'Voltando vazio' };
let fertDrag = null;

// Receita A, B, C…: uma por recomendação de produtos diferente, na ordem das frentes.
function fertRecipes() {
  const recipes = new Map();
  for (const front of fertData?.fronts || []) {
    const key = front.orders.recommendation_key;
    if (key && !recipes.has(key)) recipes.set(key, recipes.size);
  }
  return recipes;
}

function fertRecipeTag(front, recipes) {
  const key = front.orders.recommendation_key;
  if (!key) return '<span class="fert-recipe is-none" title="Sem recomendação de produtos na O.S.">Sem receita</span>';
  const index = recipes.get(key);
  return `<span class="fert-recipe is-r${index % 6}" title="${escapeHtml(front.orders.recommendation.join(' · '))}">Receita ${String.fromCharCode(65 + (index % 26))}</span>`;
}

function fertGasShort(item, front) {
  if (item.fuel !== 'gas') return '';
  const level = item.gas_level_pct;
  const trips = level !== null && front?.gas_pct_per_trip ? Math.floor(level / front.gas_pct_per_trip + 1e-9) : null;
  const low = level !== null && (level < 25 || trips === 0);
  return `<span class="fert-col-gas${low ? ' is-low' : ''}">gás ${level === null ? '—' : `${fertNumber(level, 0)}%`}${trips !== null ? ` · ${trips} viag.` : ''}</span>`;
}

function fertDispatchCvHtml(item, stage, front, editable) {
  const working = ['active', 'available'].includes(item.status);
  const label = stage ? FERT_STAGE_SHORT[stage.stage] : front ? (working ? 'Na frente' : FERT_STATUS_LABELS[item.status]) : 'Disponível';
  const detail = stage ? fertStageText(stage).split(' · ').slice(1).join(' · ')
    : front ? (working ? 'configure base e raio para ver o ciclo' : 'fora de operação') : `${fertNumber(item.capacity_m3 || fertData.defaults.capacity_m3, 0)} m³`;
  const tone = stage ? FERT_CYCLE_STAGES[stage.stage][1] : 'is-idle';
  return `<li class="fert-col-cv" data-fert-drag="${item.id}" tabindex="0"${fertData.permissions.edit && editable ? ' draggable="true"' : ''}
      title="${escapeHtml(`${item.prefix} · ${label}${detail ? ` · ${detail}` : ''}`)}">
      <span class="fert-cv ${tone}${item.fuel === 'gas' ? ' is-gas' : ''}">${escapeHtml(item.prefix)}</span>
      <span class="fert-col-cv-text"><b>${escapeHtml(label)}</b><small>${escapeHtml(detail)}</small>${fertGasShort(item, front)}</span>
    </li>`;
}

function fertDispatchFrontHtml(front, recipes, byId, editable) {
  const positions = fertCyclePositions(front, fertData.defaults);
  const stageOf = new Map((positions?.trucks || []).map(item => [item.truck.id, item]));
  const order = { loading: 0, loaded: 1, unloading: 2, empty: 3 };
  const trucks = front.trucks.map(id => byId.get(id)).filter(Boolean).sort((a, b) =>
    (order[stageOf.get(a.id)?.stage] ?? 9) - (order[stageOf.get(b.id)?.stage] ?? 9)
    || a.prefix.localeCompare(b.prefix, 'pt-BR', { numeric: true }));
  const calc = front.calc;
  const needed = calc.trucks_needed;
  const missing = [!front.base && 'a base', front.radius_km === null && 'o raio', front.flow_m3_ha === null && 'a vazão',
    front.orders.missing_order && `a O.S. (${front.orders.missing_order} não está aberta)`].filter(Boolean);
  const tone = calc.balance === null ? '' : calc.balance < 0 ? ' is-short' : calc.balance > 0 ? ' is-over' : ' is-ok';
  return `<article class="fert-col${tone}" data-fert-drop="${front.service_front_id}">
      <header class="fert-col-head">
        <div class="fert-col-title"><strong>${escapeHtml(front.name)}</strong>${fertRecipeTag(front, recipes)}</div>
        <p>Setor ${escapeHtml(front.sector || '—')} · ${escapeHtml(front.base || 'sem base')}${front.radius_km !== null ? ` · ${fertNumber(front.radius_km, 1)} km` : ''}</p>
        ${front.orders.recommendation.length ? fertRecommendationShortHtml(front.orders.recommendation) : ''}
        <div class="fert-col-meter"><span>CVs <b>${calc.trucks}</b> de ${needed ?? '—'}</span>${fertBalanceHtml(calc.balance)}</div>
        <i class="fert-meter" data-meter="${needed ? Math.min(100, (calc.trucks / needed) * 100) : 0}" aria-hidden="true"></i>
      </header>
      ${missing.length ? `<p class="fert-col-warn">Falta ${escapeHtml(missing.join(', '))}.</p>` : ''}
      <ul class="fert-col-list">${trucks.map(item => fertDispatchCvHtml(item, stageOf.get(item.id), front, true)).join('')
        || `<li class="fert-col-empty">${editable ? 'Arraste um CV para cá' : 'Nenhum CV'}</li>`}</ul>
      <footer><button type="button" class="production-secondary-button" data-fert-configure="${front.service_front_id}">Configurar frente</button></footer>
    </article>`;
}

function renderFertDispatch() {
  const box = document.querySelector('#production-fert-dispatch');
  if (!box || !fertData) return;
  const editable = fertData.permissions.edit;
  const recipes = fertRecipes();
  const byId = new Map(fertData.equipment.map(item => [item.id, item]));
  const trucks = fertData.equipment.filter(item => item.kind === 'truck');
  const free = trucks.filter(item => !item.front && ['active', 'available'].includes(item.status))
    .sort((a, b) => a.prefix.localeCompare(b.prefix, 'pt-BR', { numeric: true }));
  const out = Object.entries(FERT_STATUS_LABELS).filter(([key]) => !['active', 'available'].includes(key))
    .map(([key, label]) => [label, trucks.filter(item => item.status === key).length]).filter(([, count]) => count);
  const counts = { loading: 0, loaded: 0, unloading: 0, empty: 0 };
  fertData.fronts.forEach(front => fertCyclePositions(front, fertData.defaults)?.trucks.forEach(item => { counts[item.stage] += 1; }));
  box.innerHTML = `<header class="catalog-section-header fert-dispatch-head">
      <div><h2>Alocação dos CVs</h2>
        <p class="fert-meta">${editable ? 'Arraste o CV entre as colunas (ou use “Alocar em” na ficha do CV). ' : ''}Frentes com a mesma receita trocam CVs entre si.</p></div>
      <div class="fert-legend">${Object.entries(FERT_STAGE_SHORT).map(([stage, label]) =>
        `<span><i class="fert-dot ${FERT_CYCLE_STAGES[stage][1]}" aria-hidden="true"></i>${escapeHtml(label)} <b>${counts[stage]}</b></span>`).join('')}</div>
    </header>
    <div class="fert-board-cols">
      <article class="fert-col is-pool" data-fert-drop="pool">
        <header class="fert-col-head">
          <div class="fert-col-title"><strong>Disponíveis</strong><span class="fert-col-count">${free.length}</span></div>
          <p>${editable ? 'Arraste para uma frente' : 'CVs sem frente'}</p>
        </header>
        <ul class="fert-col-list">${free.map(item => fertDispatchCvHtml(item, null, null, true)).join('')
          || '<li class="fert-col-empty">Nenhum CV livre</li>'}</ul>
        ${out.length ? `<footer class="fert-col-out">Fora de operação: ${out.map(([label, count]) => `${escapeHtml(label)} <b>${count}</b>`).join(' · ')}</footer>` : ''}
      </article>
      ${fertData.fronts.map(front => fertDispatchFrontHtml(front, recipes, byId, editable)).join('')
        || '<p class="production-empty">Nenhuma frente de fertirrigação na Posição de Campo desta unidade.</p>'}
    </div>`;
  // A CSP bloqueia "style" no HTML: o preenchimento da meta é aplicado aqui.
  box.querySelectorAll('[data-meter]').forEach(bar => bar.style.setProperty('--fill', `${Number(bar.dataset.meter) || 0}%`));
}

// Para onde o CV pode ir: do "Disponíveis" para qualquer frente; de uma frente para outra só com a
// mesma receita; de volta para o "Disponíveis" (libera).
function fertCanDrop(target) {
  if (!fertDrag) return false;
  if (target === 'pool') return fertDrag.from !== null;
  const to = Number(target);
  if (to === fertDrag.from) return false;
  if (fertDrag.from === null || fertDrag.kind !== 'truck') return true;
  const key = id => fertData.fronts.find(front => front.service_front_id === id)?.orders.recommendation_key || '';
  return Boolean(key(fertDrag.from)) && key(fertDrag.from) === key(to);
}

function markFertDropTargets(active) {
  document.querySelectorAll('#production-fert-dispatch [data-fert-drop]').forEach(column => {
    const target = column.dataset.fertDrop;
    const allowed = active && fertCanDrop(target);
    const home = active && (target === 'pool' ? fertDrag.from === null : Number(target) === fertDrag.from);
    column.classList.toggle('is-allowed', Boolean(allowed));
    column.classList.toggle('is-blocked', Boolean(active && !allowed && !home));
    column.classList.remove('is-target');
  });
}

async function fertAllocate(equipmentId, target) {
  const item = fertData?.equipment.find(entry => entry.id === equipmentId);
  if (!item || !fertData.permissions.edit) return;
  const front = target === 'pool' ? null : fertData.fronts.find(entry => entry.service_front_id === Number(target));
  try {
    const result = await apiRequest('/api/production/fert/allocate', { method: 'PUT', body: JSON.stringify({
      unit_code: fertData.unit, work_date: fertData.work_date, equipment_id: equipmentId,
      service_front_id: front ? front.service_front_id : null
    }) });
    showToast(front ? `${fertKindLabel(item.kind)} ${item.prefix} ${result.moved ? 'mudou para' : 'alocado na'} ${front.name}.`
      : `${fertKindLabel(item.kind)} ${item.prefix} liberado.`);
  } catch (error) {
    showToast(error.message || 'Não foi possível alocar.', true);
  }
  await loadFertOverview();
}

function setFertView(view) {
  const selected = FERT_VIEWS.includes(view) ? view : 'dispatch';
  document.querySelectorAll('.fert-view-tabs [data-fert-view]').forEach(button => {
    const active = button.dataset.fertView === selected;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('#production-fert-views [data-fert-view-panel]').forEach(panel => {
    panel.hidden = panel.dataset.fertViewPanel !== selected;
  });
  try { globalThis.localStorage?.setItem('fert-view', selected); } catch { /* sem armazenamento: só não lembra a aba */ }
}

document.querySelector('.fert-view-tabs')?.addEventListener('click', event => {
  const tab = event.target.closest('[data-fert-view]');
  if (tab) setFertView(tab.dataset.fertView);
});
const fertDispatchBox = document.querySelector('#production-fert-dispatch');
fertDispatchBox?.addEventListener('click', event => {
  const configure = event.target.closest('[data-fert-configure]');
  if (configure) return openFertPlan(Number(configure.dataset.fertConfigure));
  const cv = event.target.closest('[data-fert-drag]');
  if (cv) openFertCv(Number(cv.dataset.fertDrag));
});
fertDispatchBox?.addEventListener('keydown', event => {
  const cv = event.target.closest?.('[data-fert-drag]');
  if (!cv || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  openFertCv(Number(cv.dataset.fertDrag));
});
fertDispatchBox?.addEventListener('dragstart', event => {
  const cv = event.target.closest?.('[data-fert-drag]');
  const item = cv && fertData?.equipment.find(entry => entry.id === Number(cv.dataset.fertDrag));
  if (!item) return;
  fertDrag = { id: item.id, kind: item.kind, from: item.front ? item.front.front_id : null };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(item.id));
  cv.classList.add('is-dragging');
  markFertDropTargets(true);
});
fertDispatchBox?.addEventListener('dragover', event => {
  const column = event.target.closest('[data-fert-drop]');
  if (!column || !fertCanDrop(column.dataset.fertDrop)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  column.classList.add('is-target');
});
fertDispatchBox?.addEventListener('dragleave', event => {
  const column = event.target.closest('[data-fert-drop]');
  if (column && !column.contains(event.relatedTarget)) column.classList.remove('is-target');
});
fertDispatchBox?.addEventListener('drop', event => {
  const column = event.target.closest('[data-fert-drop]');
  if (!column || !fertDrag || !fertCanDrop(column.dataset.fertDrop)) return;
  event.preventDefault();
  const { id } = fertDrag;
  fertDrag = null;
  markFertDropTargets(false);
  fertAllocate(id, column.dataset.fertDrop);
});
fertDispatchBox?.addEventListener('dragend', () => {
  fertDrag = null;
  document.querySelectorAll('#production-fert-dispatch .is-dragging').forEach(element => element.classList.remove('is-dragging'));
  markFertDropTargets(false);
});
// Ficha do CV: "Alocar em" (alternativa ao arrastar, para celular e teclado).
document.querySelector('#production-fert-cv-body')?.addEventListener('change', async event => {
  const select = event.target.closest('[data-fert-allocate]');
  if (!select || !select.value) return;
  const id = Number(select.dataset.fertAllocate);
  await fertAllocate(id, select.value);
  openFertCv(id);
});
if (fertDispatchBox) {
  let saved = 'dispatch';
  try { saved = globalThis.localStorage?.getItem('fert-view') || 'dispatch'; } catch { /* sem armazenamento */ }
  setFertView(saved);
}
