// Indicadores da unidade e totais das quatro unidades, num só cálculo para o relatório
// gerencial da Posição de Campo e a emissão da imagem "Troca de Turno CTT".
// Moagem, entrega, estoque, ATR, processado e projeção vêm da pesagem da balança (resumo de
// /api/weighings/summary: dia e horas do último SELECT importado); sem pesagem da unidade, valem
// os indicadores digitados no Preencher. "Indústria" é sempre a digitada. Inconsistência na
// balança: a etapa "Imagem CTT" do Preencher grava correções (unit.image_overrides) que valem
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

const FIELD_IMAGE_OVERRIDE_KEYS = ['millingShift', 'deliveryShift', 'milling3h', 'delivery3h', 'stock', 'atr', 'day', 'projection'];

// Correções salvas para o fechamento atual da balança da unidade (vazio se o fechamento mudou).
function fieldImageOverrides(unit, weighing) {
  const saved = unit?.image_overrides;
  if (!weighing?.data_until || !saved || saved.ref !== weighing.data_until) return {};
  return Object.fromEntries(Object.entries(saved.values || {})
    .filter(([key, value]) => FIELD_IMAGE_OVERRIDE_KEYS.includes(key) && value !== null && value !== '' && Number.isFinite(Number(value)))
    .map(([key, value]) => [key, Number(value)]));
}

function fieldUnitIndicators(unit, summary) {
  const weighing = (summary?.units || []).find(item => item.code === unit.code);
  const hasWeighing = Boolean(summary?.reference_at && weighing && weighing.loads_day > 0);
  const typed = index => fieldLeadingNumber(unit.metrics?.[index]?.[2]);
  const pick = (key, index) => (hasWeighing && weighing[key] !== null && weighing[key] !== undefined ? weighing[key] : typed(index));
  const overrides = hasWeighing ? fieldImageOverrides(unit, weighing) : {};
  // Valores da balança (sem as correções), mostrados ao lado das correções no Preencher.
  const balance = {
    millingShift: pick('milling_shift_tph', 1), deliveryShift: pick('delivery_shift_tph', 2),
    milling3h: pick('milling_last3h_tph', 4), delivery3h: pick('delivery_last3h_tph', 5),
    stock: pick('stock_loads', 3), atr: hasWeighing ? weighing.atr : null,
    day: hasWeighing ? weighing.milling_day_t : null, projection: hasWeighing ? weighing.milling_projection_t : null
  };
  const value = key => (key in overrides ? overrides[key] : balance[key]);
  const rows = fieldFilledRows(unit);
  // ATR da frente na balança desta unidade. Cana desta frente pesada em outra unidade (troca
  // de cana) entra no ATR daquela unidade, como "ATR recebido" lá.
  const frontAtr = new Map((hasWeighing ? weighing.fronts || [] : [])
    .map(front => [canonicalFieldFrontKey(front.front), front.atr]));
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
    day: value('day'),
    deliveryDay: hasWeighing ? weighing.delivery_day_t : null,
    projection: value('projection'),
    balance,
    corrected: Object.keys(overrides),
    closingRef: hasWeighing ? weighing.data_until || null : null,
    hours: hasWeighing ? weighing.hours || [] : [],
    fronts: hasWeighing ? weighing.fronts || [] : [],
    // ATR digitado na frente; sem ele, o ATR da balança da frente.
    frontAtr: row => String(row[4] ?? '').trim() || (frontAtr.get(canonicalFieldFrontKey(row[0])) != null
      ? fieldIndicatorNumber(frontAtr.get(canonicalFieldFrontKey(row[0])), 2) : ''),
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
// ATR médio geral (média das unidades com pesagem), processado e projeção do dia.
function fieldIndicatorTotals(items) {
  const atrValues = items.map(item => item.atr).filter(value => value !== null && value !== undefined);
  return {
    units: items.length,
    fronts: items.reduce((sum, item) => sum + item.rows.length, 0),
    active: items.reduce((sum, item) => sum + item.active, 0),
    running: items.filter(item => item.industry > 0).length,
    milling: fieldIndicatorSum(items.map(item => item.millingShift)),
    delivery: fieldIndicatorSum(items.map(item => item.deliveryShift)),
    stock: fieldIndicatorSum(items.map(item => item.stock)),
    atr: atrValues.length ? atrValues.reduce((sum, value) => sum + value, 0) / atrValues.length : null,
    atrUnits: atrValues.length,
    day: fieldIndicatorSum(items.map(item => item.day)),
    deliveryDay: fieldIndicatorSum(items.map(item => item.deliveryDay)),
    projection: fieldIndicatorSum(items.map(item => item.projection))
  };
}
