// Emissão da Posição de Campo: normalização das unidades e chuva por frente.
// Depende de core/common.js e core/field-fronts.js.
const REPORT_METRICS = [
  ['🏭', 'INDÚSTRIA PARADA', 'TN/H'], ['⚙️', 'MOAGEM TURNO', 'TN/H'],
  ['🚚', 'ENTREGA TURNO', 'TN/H'], ['⬡', 'ESTOQUE', 'CARGAS', 'stock'],
  ['⚙️', 'MOAGEM ÚLT. 3 H', 'TN/H'], ['🚚', 'ENTREGA ÚLT. 3 H', 'TN/H']
];

function normalizeReportUnit(unit, index) {
  const fallbackNames = ['PARAGUAÇU PAULISTA', 'NARANDIBA', 'RIO BRILHANTE', 'PASSA TEMPO'];
  const fallbackCodes = ['PPT', 'NRD', 'RBR', 'PST'];
  const source = unit || {};
  const cloned = JSON.parse(JSON.stringify(source));
  const normalized = {
    code: cloned.code || fallbackCodes[index] || `UN${index + 1}`,
    name: cloned.name || fallbackNames[index] || 'UNIDADE',
    border: ['active', 'attention', 'critical'].includes(cloned.border) ? cloned.border : 'active',
    rows: Array.isArray(cloned.rows) ? cloned.rows.map(row => {
      const [front = '', sector = '', , status = 'EM ATIVIDADE', atr = ''] = row;
      const classification = getFieldStatus(status);
      return [front, sector, classification.color, classification.image_status, atr];
    }) : [],
    metrics: Array.isArray(cloned.metrics) && cloned.metrics.length === REPORT_METRICS.length ? cloned.metrics : REPORT_METRICS.map(([icon, label, suffix, extra = '']) => [icon, label, `0 ${suffix}`, extra]),
    observation: String(cloned.observation || '-'),
    changes: String(cloned.changes || '-'),
    support: String(cloned.support || '-'),
    // Correções da imagem (etapa Imagem CTT), válidas só no fechamento em que foram feitas.
    ...(cloned.image_overrides ? { image_overrides: cloned.image_overrides } : {}),
    rain: standardizeFieldRainLabels(cloned.code || fallbackCodes[index], cloned.rows, cloned.rain)
  };

  if (normalized.code === 'PST' && (!normalized.name || normalized.name === 'PARAÍSA TEMPO')) normalized.name = 'PASSA TEMPO';
  const statuses = normalized.rows.filter(row => String(row?.[0] || '').trim() || String(row?.[1] || '').trim())
    .map(row => row[3]);
  normalized.border = fieldUnitBorder(statuses);
  return normalized;
}

function parseRainValue(value) {
  const match = String(value ?? '').match(/-?\d[\d.,]*/);
  const number = match ? parseBrNumber(match[0]) : NaN;
  return Number.isFinite(number) ? number : 0;
}

// Só considera chuva das frentes que realmente aparecem no informativo.
// Cadastros antigos de outras frentes não podem criar colunas preenchidas
// apenas com traços. Vazios, traços, valores inválidos e zeros não as ativam.
function reportHasRainData(unit) {
  const lookup = buildRainLookup(unit, { rawValues: true });
  const positiveRain = value => {
    const text = String(value ?? '').trim().replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(text)) return false;
    const number = Number(text);
    return Number.isFinite(number) && number > 0;
  };
  return (Array.isArray(unit?.rows) ? unit.rows : []).some(row => {
    if (!Array.isArray(row)) return false;
    const key = canonicalFieldFrontKey(row[0]);
    const rain = key ? lookup.get(key) : null;
    return rain && (positiveRain(rain.turn) || positiveRain(rain.accum));
  });
}

function buildRainLookup(unit, { rawValues = false } = {}) {
  const lookup = new Map();
  // Cadastro legado de NRD (EQ 3–12 = frentes 13–22; FT 8 = frente 08) é
  // convertido pela mesma regra do painel e do backend (core/field-fronts.js).
  standardizeFieldRainLabels(unit?.code ?? '', unit?.rows, unit?.rain).filter(Array.isArray).forEach(entry => {
    // Valor ausente fica vazio (não vira zero) para não entrar nas médias.
    const [front = '', turn = '', accum = ''] = entry;
    const key = canonicalFieldFrontKey(front);
    if (!key) return;
    lookup.set(key, rawValues ? { turn, accum }
      : { turn: parseRainValue(turn), accum: parseRainValue(accum) });
  });
  return lookup;
}
