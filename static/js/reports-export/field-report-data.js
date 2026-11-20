// Normalização das unidades para a emissão da Posição de Campo.
// Depende de core/common.js.
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
    ...(cloned.image_overrides ? { image_overrides: cloned.image_overrides } : {})
  };

  if (normalized.code === 'PST' && (!normalized.name || normalized.name === 'PARAÍSA TEMPO')) normalized.name = 'PASSA TEMPO';
  const statuses = normalized.rows.filter(row => String(row?.[0] || '').trim() || String(row?.[1] || '').trim())
    .map(row => row[3]);
  normalized.border = fieldUnitBorder(statuses);
  return normalized;
}
