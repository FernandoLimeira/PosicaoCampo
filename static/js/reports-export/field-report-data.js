// Emissão da Posição de Campo: normalização das unidades, chuva por frente e ícones das métricas.
// Depende de core/field-fronts.js e reports-export/shared-drawing.js.
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
    rain: standardizeFieldRainLabels(cloned.code || fallbackCodes[index], cloned.rows, cloned.rain)
  };

  if (normalized.code === 'PST' && (!normalized.name || normalized.name === 'PARAÍSA TEMPO')) normalized.name = 'PASSA TEMPO';
  const statuses = normalized.rows.filter(row => String(row?.[0] || '').trim() || String(row?.[1] || '').trim())
    .map(row => row[3]);
  normalized.border = fieldUnitBorder(statuses);
  return normalized;
}

// O símbolo é incorporado ao código para não depender de um arquivo de imagem
// separado no servidor. Isso mantém o desenho aprovado e evita o 404 do ícone.
const REPORT_UNIT_SYMBOL_PNG_BASE64 = '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';

async function loadEmbeddedReportUnitSymbol() {
  const binary = atob(REPORT_UNIT_SYMBOL_PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/png' });

  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const icon = new Image();
    icon.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(icon);
    };
    icon.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Não foi possível carregar o símbolo de cana incorporado.'));
    };
    icon.src = objectUrl;
  });
}

function statusColorValue(color) {
  if (color === 'green') return '#7ae44f';
  if (color === 'red') return '#ff6b57';
  return '#f3d21c';
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

// Os valores informados de produção ficam verdes apenas quando há quantidade positiva.
// Aceita números com vírgula decimal e valores acompanhados de t/h ou cargas.
function globalMetricHasPositiveValue(value) {
  const raw = String(value ?? '').trim();
  const found = raw.match(/^([+-]?\d+(?:[.,]\d+)?)/);
  if (!found) return false;
  const quantity = Number(found[1].replace(',', '.'));
  return Number.isFinite(quantity) && quantity > 0;
}

function drawMetricIcon(ctx, type, x, y, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  if (type === 'stock') {
    ctx.strokeRect(x + 2, y + 3, size - 6, size - 6);
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 3);
    ctx.lineTo(x + size / 2, y - 1);
    ctx.lineTo(x + size - 4, y + 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y - 1);
    ctx.lineTo(x + size / 2, y + size - 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 2, y + size / 2);
    ctx.lineTo(x + size / 2, y + size / 2 + 4);
    ctx.lineTo(x + size - 4, y + size / 2);
    ctx.stroke();
  } else if (type === 'industry') {
    ctx.fillRect(x + 2, y + 10, 5, size - 12);
    ctx.fillRect(x + 10, y + 14, 5, size - 16);
    ctx.fillRect(x + 18, y + 6, 5, size - 8);
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 10);
    ctx.lineTo(x + 10, y + 4);
    ctx.lineTo(x + 17, y + 10);
    ctx.stroke();
  } else if (type === 'delivery') {
    ctx.strokeRect(x + 2, y + 8, size - 12, size - 12);
    ctx.strokeRect(x + size - 10, y + 12, 8, size - 16);
    ctx.beginPath();
    ctx.arc(x + 8, y + size - 2, 3, 0, Math.PI * 2);
    ctx.arc(x + size - 6, y + size - 2, 3, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2 - 3, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI * 2 * i) / 8;
      ctx.beginPath();
      ctx.moveTo(x + size / 2 + Math.cos(angle) * (size / 2 - 3), y + size / 2 + Math.sin(angle) * (size / 2 - 3));
      ctx.lineTo(x + size / 2 + Math.cos(angle) * (size / 2 + 2), y + size / 2 + Math.sin(angle) * (size / 2 + 2));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
