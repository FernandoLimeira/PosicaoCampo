// Indicadores da unidade e totais das quatro unidades, num só cálculo para o relatório
// gerencial da Posição de Campo e a emissão da imagem "Troca de Turno CTT".
// Moagem, entrega, estoque, ATR, processado e projeção vêm da pesagem da balança (resumo de
// /api/weighings/summary: dia e horas do último SELECT importado); sem pesagem da unidade, valem
// os indicadores digitados no Preencher. "Indústria" é sempre a digitada. Inconsistência na
// balança: os "Indicadores do turno" do Preencher gravam correções (unit.image_overrides) que valem
// só para o fechamento em que foram feitas (``ref`` = "dados até" da pesagem da unidade).
// Depende de core/format.js, core/common.js e core/field-fronts.js.

// Número no padrão brasileiro; ausente ou inválido vira "—" (sem dado enviado).
function fieldIndicatorNumber(value, digits = 0) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Primeiro número de um indicador digitado ("850 TN/H", "1.243", "48 cargas").
function fieldLeadingNumber(text) {
  const found = String(text ?? '').match(/-?\d[\d.,]*/);
  if (!found) return null;
  const number = parseBrNumber(found[0].replace(/[.,]$/, ''));
  return Number.isFinite(number) ? number : null;
}

function fieldFilledRows(unit) {
  return (unit?.rows || []).filter(row => String(row?.[0] || '').trim() || String(row?.[1] || '').trim());
}

function fieldProjectionStopped(rows, weighing) {
  return weighing?.zero_milling_at_latest_close === true && rows.length > 0
    && rows.every(row => getFieldStatus(row[3]).group === 'stopped');
}

const FIELD_IMAGE_OVERRIDE_KEYS = ['millingShift', 'deliveryShift', 'milling3h', 'delivery3h', 'stock', 'atr', 'day', 'projection'];

// Correções salvas para o fechamento atual da balança da unidade (vazio se o fechamento mudou).
function fieldImageOverrides(unit, weighing) {
  const saved = unit?.image_overrides;
  if (!weighing?.data_until || !saved || saved.ref !== weighing.data_until) return {};
  // O relatório pode consultar um corte anterior dentro da mesma importação.
  if (weighing.closed_until && weighing.closed_until <= saved.ref) return {};
  return Object.fromEntries(Object.entries(saved.values || {})
    .filter(([key, value]) => FIELD_IMAGE_OVERRIDE_KEYS.includes(key) && value !== null && value !== '' && Number.isFinite(Number(value)))
    .map(([key, value]) => [key, Number(value)]));
}

// ATR médio ponderado pela tonelada de cana: soma(ATR × t) ÷ soma(t), só com os pares que
// têm ATR e tonelada. Sem tonelada em nenhum, média simples dos ATR (preenchimento manual).
function fieldWeightedAtr(pairs) {
  const valid = pairs.filter(([atr]) => atr !== null && atr !== undefined && Number(atr) > 0);
  if (!valid.length) return { atr: null, count: 0, weighted: false };
  const weighed = valid.filter(([, tons]) => Number(tons) > 0);
  if (weighed.length) {
    const tons = weighed.reduce((sum, [, value]) => sum + Number(value), 0);
    return { atr: weighed.reduce((sum, [atr, value]) => sum + Number(atr) * Number(value), 0) / tons, count: weighed.length, weighted: true };
  }
  return { atr: valid.reduce((sum, [atr]) => sum + Number(atr), 0) / valid.length, count: valid.length, weighted: false };
}

function fieldUnitIndicators(unit, summary) {
  const weighing = (summary?.units || []).find(item => item.code === unit.code);
  const rows = fieldFilledRows(unit);
  const projectionStopped = fieldProjectionStopped(rows, weighing);
  const hasWeighing = Boolean(summary?.reference_at && weighing && (weighing.loads_day > 0 || weighing.zero_milling_at_latest_close));
  const typed = index => fieldLeadingNumber(unit.metrics?.[index]?.[2]);
  const pick = (key, index) => (hasWeighing && weighing[key] !== null && weighing[key] !== undefined ? weighing[key] : typed(index));
  const overrides = hasWeighing ? fieldImageOverrides(unit, weighing) : {};
  // ATR da frente na balança desta unidade. Cana desta frente pesada em outra unidade (troca
  // de cana) entra no ATR daquela unidade, como "ATR recebido" lá.
  const weighedFronts = new Map((hasWeighing ? weighing.fronts || [] : [])
    .map(front => [canonicalFieldFrontKey(front.front), front]));
  const weighedFrontAtr = new Map([...weighedFronts].map(([key, front]) => [key, front.atr]));
  // ATR digitado na frente; sem ele, o ATR da balança da frente.
  const frontAtr = row => String(row[4] ?? '').trim() || (weighedFrontAtr.get(canonicalFieldFrontKey(row[0])) != null
    ? fieldIndicatorNumber(weighedFrontAtr.get(canonicalFieldFrontKey(row[0])), 2) : '');
  // ATR da unidade: o da balança (média ponderada pelo peso) quando o SELECT traz o ATR das
  // cargas; sem ele, a média do ATR das frentes ponderada pela tonelada de cada frente na balança.
  const frontsAtr = fieldWeightedAtr(rows.map(row => [fieldLeadingNumber(frontAtr(row)),
    weighedFronts.get(canonicalFieldFrontKey(row[0]))?.tons])).atr;
  const weighedAtr = hasWeighing && weighing.atr !== null && weighing.atr !== undefined ? weighing.atr : null;
  // Valores da balança (sem as correções), mostrados ao lado das correções no Preencher.
  const balance = {
    millingShift: pick('milling_shift_tph', 1), deliveryShift: pick('delivery_shift_tph', 2),
    milling3h: pick('milling_last3h_tph', 4), delivery3h: pick('delivery_last3h_tph', 5),
    stock: pick('stock_loads', 3), atr: weighedAtr ?? frontsAtr,
    day: hasWeighing ? weighing.milling_day_t : null, projection: hasWeighing ? weighing.milling_projection_t : null
  };
  const value = key => (key in overrides ? overrides[key] : balance[key]);
  return {
    rows,
    active: rows.filter(row => getFieldStatus(row[3]).group === 'active').length,
    industry: typed(0),
    millingShift: value('millingShift'),
    deliveryShift: value('deliveryShift'),
    stock: value('stock'),
    milling3h: value('milling3h'),
    delivery3h: value('delivery3h'),
    atr: value('atr'),
    atrSource: weighedAtr !== null ? 'balança' : frontsAtr !== null ? 'frentes' : null,
    day: value('day'),
    deliveryDay: hasWeighing ? weighing.delivery_day_t : null,
    projection: projectionStopped ? null : value('projection'),
    projectionStopped,
    balance,
    corrected: Object.keys(overrides),
    closingRef: hasWeighing ? weighing.data_until || null : null,
    hours: hasWeighing ? weighing.hours || [] : [],
    fronts: hasWeighing ? weighing.fronts || [] : [],
    frontAtr,
    received: hasWeighing ? (weighing.received || []) : []
  };
}

// Moagem do turno ÷ indústria: "good" ≥ 100%, "warning" 90–99%, "low" < 90%.
// O percentual é truncado (99,6% → 99%) para nunca contradizer a faixa.
function fieldIndustryShare(item) {
  if (!(item.industry > 0) || item.millingShift === null || item.millingShift === undefined) return null;
  const share = item.millingShift / item.industry;
  return { share, percent: Math.floor(share * 100), level: share >= 1 ? 'good' : share >= .9 ? 'warning' : 'low' };
}

function fieldIndicatorSum(values) {
  const numbers = values.filter(value => value !== null && value !== undefined && Number.isFinite(Number(value)));
  return numbers.length ? numbers.reduce((sum, value) => sum + Number(value), 0) : null;
}

// Totais das unidades: frentes, indústrias em operação, moagem/entrega/estoque do turno,
// ATR médio geral (média do ATR das unidades ponderada pelo processado do dia de cada uma),
// processado e projeção do dia.
function fieldIndicatorTotals(items, balanceItems = items) {
  const atr = fieldWeightedAtr(balanceItems.map(item => [item.atr, item.day]));
  return {
    units: items.length,
    fronts: items.reduce((sum, item) => sum + item.rows.length, 0),
    active: items.reduce((sum, item) => sum + item.active, 0),
    running: items.filter(item => item.industry > 0).length,
    milling: fieldIndicatorSum(balanceItems.map(item => item.millingShift)),
    delivery: fieldIndicatorSum(balanceItems.map(item => item.deliveryShift)),
    stock: fieldIndicatorSum(balanceItems.map(item => item.stock)),
    atr: atr.atr,
    atrUnits: atr.count,
    atrWeighted: atr.weighted,
    day: fieldIndicatorSum(balanceItems.map(item => item.day)),
    deliveryDay: fieldIndicatorSum(balanceItems.map(item => item.deliveryDay)),
    projection: fieldIndicatorSum(balanceItems.map(item => item.projection))
  };
}
