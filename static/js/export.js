// Renderização e download das imagens do painel e da Sacarose.
const REPORT_BASE_WIDTH = 1024;
const REPORT_BASE_HEIGHT = 1536;
const REPORT_EXPORT_SCALE = 4;
const SACAROSE_REPORT_EXPORT_SCALE = 0.65;
const REPORT_EXPORT_MIME_TYPE = 'image/png';
const REPORT_EXPORT_EXTENSION = REPORT_EXPORT_MIME_TYPE === 'image/png' ? 'png' : 'jpg';
const REPORT_METRICS = [
  ['🏭', 'INDÚSTRIA PARADA', 'TN/H'], ['⚙️', 'MOAGEM TURNO', 'TN/H'],
  ['🚚', 'ENTREGA TURNO', 'TN/H'], ['⬡', 'ESTOQUE', 'CARGAS', 'stock'],
  ['⚙️', 'MOAGEM ÚLT. 3 H', 'TN/H'], ['🚚', 'ENTREGA ÚLT. 3 H', 'TN/H']
];

function getHeaderDataForExport(generatedAt = new Date()) {
  const safeDate = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  const hour = safeDate.getHours();
  return {
    greeting: greetingForHour(hour).toUpperCase(),
    date: safeDate.toLocaleDateString('pt-BR')
  };
}

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
    rain: Array.isArray(cloned.rain) ? cloned.rain : []
  };

  if (normalized.code === 'PST' && (!normalized.name || normalized.name === 'PARAÍSA TEMPO')) normalized.name = 'PASSA TEMPO';
  const statuses = normalized.rows.filter(row => String(row?.[0] || '').trim() || String(row?.[1] || '').trim())
    .map(row => row[3]);
  normalized.border = fieldUnitBorder(statuses);
  return normalized;
}

async function loadImageAsset(path, errorMessage) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'force-cache' });
  if (!response.ok) throw new Error(errorMessage);
  const blob = await response.blob();

  if ('createImageBitmap' in window) {
    return createImageBitmap(blob);
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(errorMessage));
    };
    image.src = objectUrl;
  });
}

function loadReportTemplateImage() {
  return loadImageAsset('/assets/report-template.jpg', 'Não foi possível carregar a imagem-base do relatório.');
}

function loadSacaroseHeaderIconImage() {
  return loadImageAsset('/assets/sacarose-icon.png', 'Não foi possível carregar o ícone da posição de colheita.');
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

function loadReportUnitIconImage() {
  return loadEmbeddedReportUnitSymbol();
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillRoundedRect(ctx, x, y, width, height, radius, color) {
  ctx.save();
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function strokeRoundedRect(ctx, x, y, width, height, radius, color, lineWidth = 4) {
  ctx.save();
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

function prepareCardBody(ctx, layout, unit, borderColor, unitIconImage = null) {
  // Primeiro cobre totalmente a borda antiga da arte-base para evitar mistura de cores.
  fillRoundedRect(ctx, layout.x - 4, layout.y - 4, layout.w + 8, layout.h + 8, 20, '#012d36');

  const background = ctx.createLinearGradient(layout.x, layout.y, layout.x + layout.w, layout.y + layout.h);
  background.addColorStop(0, '#083844');
  background.addColorStop(0.52, '#072f39');
  background.addColorStop(1, '#052832');
  fillRoundedRect(ctx, layout.x, layout.y, layout.w, layout.h, 16, background);

  ctx.save();
  roundedRectPath(ctx, layout.x, layout.y, layout.w, layout.h, 16);
  ctx.clip();
  const headerGlow = ctx.createLinearGradient(layout.x, layout.y, layout.x, layout.y + 90);
  headerGlow.addColorStop(0, 'rgba(22, 116, 115, 0.18)');
  headerGlow.addColorStop(1, 'rgba(0, 46, 58, 0)');
  ctx.fillStyle = headerGlow;
  ctx.fillRect(layout.x, layout.y, layout.w, 90);
  ctx.restore();

  strokeRoundedRect(ctx, layout.x + 1.5, layout.y + 1.5, layout.w - 3, layout.h - 3, 15, borderColor, 5);

  if (unitIconImage) {
    const iconH = 44;
    const iconW = Math.round(iconH * (unitIconImage.width / Math.max(1, unitIconImage.height)));
    const iconX = layout.x + 18;
    const iconY = layout.y + 10;
    ctx.drawImage(unitIconImage, iconX, iconY, iconW, iconH);
  } else {
    drawReportUnitIcon(ctx, layout.x + 18, layout.y + 9, 42, 46);
  }

  drawFittedText(ctx, unit.code || '', layout.x + 83, layout.y + 28, 118, 'bold 29px Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, unit.name || '', layout.x + 83, layout.y + 54, layout.w - 110, '22px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
}

function drawFittedText(ctx, text, x, y, maxWidth, font, color = '#ffffff', baseline = 'alphabetic') {
  const value = String(text ?? '');
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = baseline;
  const measured = Math.max(1, ctx.measureText(value).width);
  const scaleX = Math.min(1, maxWidth / measured);
  ctx.translate(x, y);
  ctx.scale(scaleX, 1);
  ctx.fillText(value, 0, 0);
  ctx.restore();
}

function borderColorForState(border) {
  if (border === 'critical') return '#ff6b57';
  if (border === 'attention') return '#ff8a3d';
  return '#ff6b57';
}

function statusColorValue(color) {
  if (color === 'green') return '#7ae44f';
  if (color === 'red') return '#ff6b57';
  return '#f3d21c';
}

function statusTextColor(color) {
  if (color === 'green') return '#8af45b';
  return color === 'red' ? statusColorValue(color) : '#ffffff';
}

function drawReportUnitIcon(ctx, x, y, width = 40, height = 46) {
  ctx.save();
  ctx.fillStyle = '#74f23a';
  ctx.strokeStyle = '#74f23a';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const drawBlade = (points) => {
    ctx.beginPath();
    ctx.moveTo(x + points[0][0] * width, y + points[0][1] * height);
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      if (p.length === 2) {
        ctx.lineTo(x + p[0] * width, y + p[1] * height);
      } else if (p.length === 4) {
        ctx.quadraticCurveTo(x + p[0] * width, y + p[1] * height, x + p[2] * width, y + p[3] * height);
      }
    }
    ctx.closePath();
    ctx.fill();
  };

  // lâmina esquerda
  drawBlade([
    [0.10, 0.98],
    [0.10, 0.52, 0.08, 0.22],
    [0.14, 0.04, 0.29, 0.04],
    [0.22, 0.22, 0.20, 0.58],
    [0.22, 0.98]
  ]);

  // lâmina central
  drawBlade([
    [0.40, 0.98],
    [0.38, 0.56, 0.36, 0.20],
    [0.48, 0.02, 0.66, 0.02],
    [0.58, 0.24, 0.56, 0.52],
    [0.56, 0.98]
  ]);

  // lâmina direita
  drawBlade([
    [0.74, 0.98],
    [0.74, 0.62, 0.72, 0.36],
    [0.79, 0.16, 0.94, 0.08],
    [0.85, 0.30, 0.84, 0.54],
    [0.84, 0.98]
  ]);

  ctx.restore();
}

function drawLeafMark(ctx, x, y, scale = 1) {
  drawReportUnitIcon(ctx, x, y, 40 * scale, 46 * scale);
}

function wrapTextLines(ctx, text, maxWidth) {
  const content = String(text || '-').replace(/\r/g, '');
  const paragraphs = content.split('\n');
  const lines = [];

  const splitLongWord = word => {
    const parts = [];
    let current = '';
    Array.from(word).forEach(char => {
      const trial = `${current}${char}`;
      if (current && ctx.measureText(trial).width > maxWidth) {
        parts.push(current);
        current = char;
      } else {
        current = trial;
      }
    });
    if (current) parts.push(current);
    return parts.length ? parts : [''];
  };

  paragraphs.forEach(paragraph => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      return;
    }

    let current = '';
    words.forEach(word => {
      const pieces = ctx.measureText(word).width > maxWidth ? splitLongWord(word) : [word];
      pieces.forEach((piece, pieceIndex) => {
        const trial = current ? `${current} ${piece}` : piece;
        if (ctx.measureText(trial).width <= maxWidth || !current) {
          current = trial;
        } else {
          lines.push(current);
          current = piece;
        }

        if (pieces.length > 1 && pieceIndex < pieces.length - 1) {
          lines.push(current);
          current = '';
        }
      });
    });
    if (current) lines.push(current);
  });

  return lines.length ? lines : ['-'];
}

function getWrappedTextLineCount(ctx, text, maxWidth, fontSize) {
  ctx.save();
  ctx.font = `${fontSize}px "Arial Narrow", Arial, sans-serif`;
  const count = wrapTextLines(ctx, text, maxWidth).length;
  ctx.restore();
  return Math.max(1, count);
}

function getWrappedTextHeight(ctx, text, maxWidth, fontSize, lineRatio = 1.22, family = '"Arial Narrow", Arial, sans-serif') {
  ctx.save();
  ctx.font = `${fontSize}px ${family}`;
  const lines = wrapTextLines(ctx, text, maxWidth);
  ctx.restore();
  return Math.max(1, lines.length) * fontSize * lineRatio;
}

function drawWrappedTextFit(ctx, text, x, y, maxWidth, maxHeight, options = {}) {
  const maxFontSize = Number(options.maxFontSize) || 13;
  const minFontSize = Number(options.minFontSize) || 4;
  const color = options.color || '#ffffff';
  const family = options.family || '"Arial Narrow", Arial, sans-serif';
  const lineRatio = Number(options.lineRatio) || 1.22;
  const availableHeight = Math.max(1, maxHeight);

  let fitted = null;
  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 0.5) {
    ctx.save();
    ctx.font = `${fontSize}px ${family}`;
    const lines = wrapTextLines(ctx, text, maxWidth);
    ctx.restore();
    const lineHeight = fontSize * lineRatio;
    if (lines.length * lineHeight <= availableHeight) {
      fitted = { fontSize, lineHeight, lines };
      break;
    }
  }

  if (!fitted) {
    let fontSize = minFontSize;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      ctx.save();
      ctx.font = `${fontSize}px ${family}`;
      const lines = wrapTextLines(ctx, text, maxWidth);
      ctx.restore();
      const requiredHeight = Math.max(1, lines.length * fontSize * lineRatio);
      if (requiredHeight <= availableHeight) {
        fitted = { fontSize, lineHeight: fontSize * lineRatio, lines };
        break;
      }
      fontSize = Math.max(2.5, fontSize * (availableHeight / requiredHeight) * 0.98);
    }

    if (!fitted) {
      ctx.save();
      ctx.font = `${fontSize}px ${family}`;
      const lines = wrapTextLines(ctx, text, maxWidth);
      ctx.restore();
      fitted = {
        fontSize,
        lineHeight: Math.min(fontSize * lineRatio, availableHeight / Math.max(1, lines.length)),
        lines
      };
    }
  }

  ctx.save();
  ctx.font = `${fitted.fontSize}px ${family}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  fitted.lines.forEach((line, index) => {
    ctx.fillText(line || ' ', x, y + index * fitted.lineHeight);
  });
  ctx.restore();

  return fitted.lines.length * fitted.lineHeight;
}

function canonicalFrontKey(value) {
  const source = String(value ?? '').normalize('NFKC').trim().toUpperCase();
  if (!source) return '';
  // Remove apenas os rótulos da identificação. Concatenar todos os números
  // confunde frente com setor e descartar letras mistura frentes como 13A/13B.
  const identifier = source
    .replace(/^(?:(?:EQ(?:UIPE|UIPAMENTO)?|FRENTE|FRT|CTT|CCT|PPT|NRD|RBR|PST)(?=[.\s:#-]|\d|$)[.\s:#-]*)+/, '')
    .replace(/\s*[-–—|]\s*(?:SETOR|FAZENDA)\b.*$/, '')
    .replace(/\s+/g, '');
  return identifier.replace(/\d+/g, digits => String(Number(digits)));
}

function parseRainValue(value) {
  const match = String(value ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

// Uma unidade só exibe CHUVA quando algum turno ou acumulado possui
// precipitação maior que zero. Campos vazios, traços e zeros não criam
// cabeçalhos nem barras de chuva na imagem exportada.
function reportHasRainData(unit) {
  return Array.isArray(unit?.rain) && unit.rain.some(entry =>
    Array.isArray(entry) && (parseRainValue(entry[1]) > 0 || parseRainValue(entry[2]) > 0)
  );
}

function buildRainLookup(unit) {
  const lookup = new Map();
  (Array.isArray(unit?.rain) ? unit.rain : []).forEach(entry => {
    if (!Array.isArray(entry)) return;
    const [front = '', turn = 0, accum = 0] = entry;
    const key = canonicalFrontKey(front);
    if (!key) return;
    lookup.set(key, { turn: parseRainValue(turn), accum: parseRainValue(accum) });
  });
  return lookup;
}

function computeRainSummary(unit) {
  const rows = Array.isArray(unit?.rain) ? unit.rain.filter(item => Array.isArray(item)) : [];
  if (!rows.length) return { turn: 0, accum: 0 };
  const totals = rows.reduce((acc, item) => {
    acc.turn += parseRainValue(item[1]);
    acc.accum += parseRainValue(item[2]);
    return acc;
  }, { turn: 0, accum: 0 });
  return {
    turn: Math.round(totals.turn / rows.length),
    accum: Math.round(totals.accum / rows.length)
  };
}

function formatAccumSinceDate() {
  const date = new Date();
  return date.toLocaleDateString('pt-BR');
}

function metricVisualStyle(type) {
  if (type === 'industry') return { icon: '#ff7e63', label: '#ff8c70' };
  return { icon: '#84e63d', label: '#ff8c70' };
}

function formatMetricLabel(label) {
  const normalized = String(label || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (normalized === 'INDÚSTRIA') return 'INDÚSTRIA';
  if (normalized === 'MOAGEM ÚLTIMAS 3H') return 'MOAGEM ÚLT. 3 H';
  if (normalized === 'ENTREGA ÚLTIMAS 3H') return 'ENTREGA ÚLT. 3 H';
  return normalized;
}

function formatMetricBadge(label, value = '') {
  const normalized = String(label || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if ((normalized === 'INDÚSTRIA' || normalized === 'INDÚSTRIA PARADA') && !globalMetricHasPositiveValue(value)) return 'PARADA';
  return '';
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

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getReportGeometry(ctx, layout, unit) {
  const metricHeight = layout.lower ? 46 : 50;
  const metricGapY = layout.lower ? 8 : 9;
  const extraRowsHeight = layout.fullRows ? Math.max(0, unit.rows.length - (layout.lower ? 7 : 11)) * 18 : 0;
  const hasRain = reportHasRainData(unit);
  const metricY = layout.y + (layout.lower ? 274 : 372) + extraRowsHeight - (hasRain ? 0 : 34);
  const metricsBottom = metricY + metricHeight * 2 + metricGapY;
  const contentTop = metricsBottom + 12;
  const cardBottom = layout.y + layout.h;
  const innerLeft = layout.x + 18;
  const innerRight = layout.x + layout.w - 18;
  const summaryY = metricY - 34;

  return {
    hasRain,
    metricY,
    metricHeight,
    metricGapY,
    metricsBottom,
    contentTop,
    cardBottom,
    innerLeft,
    innerRight,
    fullNotesW: innerRight - innerLeft,
    tableTop: layout.y + 130,
    tableBottom: (hasRain ? summaryY : metricY) - 10,
    summaryY,
    summaryH: 24,
    rainX: 0,
    rainY: 0,
    rainW: 0,
    rainH: 0,
    rainBottom: 0,
    notesX: innerLeft,
    notesY: contentTop + 2,
    notesW: innerRight - innerLeft,
    notesGap: 0
  };
}

function drawMetricBox(ctx, x, y, width, height, metric, type) {
  const borderColor = '#ff6b57';
  fillRoundedRect(ctx, x, y, width, height, 8, '#042a34');
  strokeRoundedRect(ctx, x, y, width, height, 8, borderColor, 2.5);

  const compact = height < 52;
  const iconSize = compact ? 19 : 21;
  const iconY = y + (compact ? 10 : 11);
  const visual = metricVisualStyle(type);
  drawMetricIcon(ctx, type, x + 8, iconY, iconSize, visual.icon);

  const rawLabel = metric?.[1] || '';
  const label = formatMetricLabel(rawLabel);
  const badge = formatMetricBadge(rawLabel, metric?.[2]);
  const labelX = x + 35;
  const labelY = y + (compact ? 11 : 12);
  const valueY = y + (compact ? 28 : 30);

  const metricValuePositive = globalMetricHasPositiveValue(metric?.[2]);
  drawFittedText(ctx, label, labelX, labelY, width - 42 - (badge ? 42 : 0), compact ? '9.5px "Arial Narrow", Arial, sans-serif' : '10.4px "Arial Narrow", Arial, sans-serif', metricValuePositive ? '#ffffff' : visual.label);

  if (badge) {
    fillRoundedRect(ctx, x + width - 44, y + 8, 34, 12, 5, '#ff6b57');
    drawFittedText(ctx, badge, x + width - 41, y + 17, 28, 'bold 8.4px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
  }

  if (metricValuePositive) strokeRoundedRect(ctx, x, y, width, height, 8, '#8af45b', 2.5);
  drawFittedText(ctx, metric?.[2] || '0', labelX, valueY + 10, width - 44, compact ? 'bold 14px "Arial Narrow", Arial, sans-serif' : 'bold 16px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
}

function drawRows(ctx, unit, layout, geometry) {
  const left = layout.x + 18;
  const right = layout.x + layout.w - 18;
  const availableHeight = Math.max(1, geometry.tableBottom - geometry.tableTop);
  const preferredMinRowHeight = layout.lower ? 16 : 15;
  const maxVisibleRows = Math.max(1, Math.floor(availableHeight / preferredMinRowHeight) + 1);
  const requestedRows = unit.rows.slice(0, Math.min(layout.maxRows || maxVisibleRows, maxVisibleRows));
  const hiddenCount = Math.max(0, unit.rows.length - requestedRows.length);
  const rows = requestedRows.slice();
  const hasRain = geometry.hasRain;
  const rainLookup = hasRain ? buildRainLookup(unit) : new Map();
  const rainSummary = hasRain ? computeRainSummary(unit) : null;

  if (hiddenCount > 0 && rows.length) {
    rows[rows.length - 1] = ['…', '…', 'yellow', `+${hiddenCount + 1} FRENTES`, ''];
  }

  const rowCount = rows.length;
  const lastCenterLimit = geometry.tableBottom - 6;
  const rowHeight = rowCount > 1
    ? Math.min(layout.lower ? 20 : 19, Math.max(preferredMinRowHeight, (lastCenterLimit - geometry.tableTop) / (rowCount - 1)))
    : 18;
  const fontSize = Math.max(11.8, Math.min(15, rowHeight - 1.2));
  const statusFontSize = Math.max(11.0, fontSize - 0.4);
  const dotRadius = Math.max(5.2, Math.min(7.1, rowHeight * 0.34));
  const lineOffset = Math.min(8, rowHeight * 0.44);
  const frontX = layout.x + 20;
  const sectorX = layout.x + (hasRain ? 102 : 132);
  const statusX = layout.x + (hasRain ? 176 : 240);
  const atrX = layout.x + (hasRain ? 290 : 408);
  const turnX = layout.x + 374;
  const accumX = layout.x + 437;

  ctx.save();
  ctx.strokeStyle = 'rgba(148, 196, 204, 0.28)';
  ctx.lineWidth = 1;

  if (hasRain) {
    drawFittedText(ctx, 'CHUVA', layout.x + layout.w - 102, layout.y + 74, 88, 'bold 13px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
    drawFittedText(ctx, '☁', layout.x + layout.w - 123, layout.y + 74, 14, 'bold 14px Arial, sans-serif', '#ffffff', 'middle');
  }

  ctx.beginPath();
  ctx.moveTo(left, layout.y + 83);
  ctx.lineTo(right, layout.y + 83);
  ctx.stroke();

  drawFittedText(ctx, 'FRENTE', frontX, layout.y + 102, 70, 'bold 14px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, 'SETOR', sectorX, layout.y + 102, 60, 'bold 14px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, 'STATUS', statusX, layout.y + 102, hasRain ? 100 : 150, 'bold 14px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, 'ATR', atrX, layout.y + 102, 34, 'bold 14px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
  if (hasRain) {
    drawFittedText(ctx, 'TURNO', turnX, layout.y + 91, 52, 'bold 13px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
    drawFittedText(ctx, 'mm', turnX + 8, layout.y + 106, 18, '10px "Arial Narrow", Arial, sans-serif', 'rgba(255,255,255,0.8)', 'middle');
    drawFittedText(ctx, 'ACUM.', accumX, layout.y + 91, 52, 'bold 13px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
    drawFittedText(ctx, 'mm', accumX + 8, layout.y + 106, 18, '10px "Arial Narrow", Arial, sans-serif', 'rgba(255,255,255,0.8)', 'middle');
  }

  ctx.beginPath();
  ctx.moveTo(left, layout.y + 119);
  ctx.lineTo(right, layout.y + 119);
  ctx.stroke();

  rows.forEach(([front = '', sector = '', color = 'yellow', status = '', atr = ''], index) => {
    const cy = geometry.tableTop + index * rowHeight;
    const rain = rainLookup.get(canonicalFrontKey(front)) || { turn: 0, accum: 0 };

    ctx.beginPath();
    ctx.arc(layout.x + 31, cy, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = statusColorValue(color);
    ctx.fill();

    drawFittedText(ctx, front, frontX + 22, cy + 0.5, 44, `${fontSize}px "Arial Narrow", Arial, sans-serif`, '#ffffff', 'middle');
    drawFittedText(ctx, sector, sectorX, cy + 0.5, hasRain ? 60 : 90, `${fontSize}px "Arial Narrow", Arial, sans-serif`, '#ffffff', 'middle');
    drawFittedText(ctx, status, statusX, cy + 0.5, hasRain ? 103 : 152, `${statusFontSize}px "Arial Narrow", Arial, sans-serif`, status === 'SOLO ÚMIDO' ? '#ffd325' : statusTextColor(color), 'middle');
    drawFittedText(ctx, String(atr ?? '').trim() || '—', atrX, cy + 0.5, 34, `${fontSize}px "Arial Narrow", Arial, sans-serif`, '#ffffff', 'middle');
    if (hasRain) {
      drawFittedText(ctx, String(parseRainValue(rain.turn)), turnX + 8, cy + 0.5, 24, `${fontSize}px "Arial Narrow", Arial, sans-serif`, parseRainValue(rain.turn) > 0 ? '#8af45b' : '#ffffff', 'middle');
      drawFittedText(ctx, String(parseRainValue(rain.accum)), accumX + 8, cy + 0.5, 28, `${fontSize}px "Arial Narrow", Arial, sans-serif`, parseRainValue(rain.accum) > 0 ? '#8af45b' : '#ffffff', 'middle');
    }

    ctx.beginPath();
    ctx.moveTo(left, Math.min(geometry.tableBottom, cy + lineOffset));
    ctx.lineTo(right, Math.min(geometry.tableBottom, cy + lineOffset));
    ctx.stroke();
  });

  if (hasRain) {
    fillRoundedRect(ctx, left, geometry.summaryY, right - left, geometry.summaryH, 10, 'rgba(93, 146, 174, 0.18)');
    strokeRoundedRect(ctx, left, geometry.summaryY, right - left, geometry.summaryH, 10, 'rgba(150, 219, 230, 0.32)', 1);
    drawFittedText(ctx, '☁', left + 10, geometry.summaryY + 15, 16, 'bold 13px Arial, sans-serif', '#bfe7ff', 'middle');
    drawFittedText(ctx, `Média: Turno ${rainSummary.turn} mm | Acum ${rainSummary.accum} mm`, left + 29, geometry.summaryY + 15, 248, 'bold 13px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
    drawFittedText(ctx, `acum.: desde ${formatAccumSinceDate()}`, right - 88, geometry.summaryY + 15, 80, '10px "Arial Narrow", Arial, sans-serif', 'rgba(255,255,255,0.75)', 'middle');
  }

  ctx.restore();
}

function drawRainBox(ctx, unit, layout, geometry) {
  const { rainX, rainY, rainW, rainH } = geometry;
  const maxLines = layout.lower ? 7 : 11;
  const rows = unit.rain.slice(0, maxLines).map(item => Array.isArray(item) ? [...item] : item);
  const hiddenRainCount = Math.max(0, unit.rain.length - rows.length);
  if (hiddenRainCount > 0 && rows.length) {
    rows[rows.length - 1] = [`+${hiddenRainCount + 1} eq.`, '…', '…'];
  }
  const headerHeight = 30;
  const usableRowsHeight = Math.max(42, rainH - headerHeight - 8);
  const rowHeight = Math.min(layout.lower ? 14 : 13, usableRowsHeight / Math.max(maxLines, 1));

  fillRoundedRect(ctx, rainX, rainY, rainW, rainH, 10, '#003a49');
  strokeRoundedRect(ctx, rainX, rainY, rainW, rainH, 10, 'rgba(150, 219, 230, 0.9)', 2);

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(150, 201, 210, 0.34)';
  drawFittedText(ctx, '☁', rainX + 12, rainY + 17, 20, 'bold 16px Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, 'CHUVA TURNO / ACUM. (mm)', rainX + 37, rainY + 17, rainW - 48, 'bold 12.2px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
  ctx.beginPath();
  ctx.moveTo(rainX + 9, rainY + headerHeight);
  ctx.lineTo(rainX + rainW - 9, rainY + headerHeight);
  ctx.stroke();

  rows.forEach(([eq = '', turn = '-', accum = '-'], index) => {
    const cy = rainY + headerHeight + 8 + index * rowHeight;
    const fontSize = Math.max(10.4, Math.min(12.4, rowHeight - 1.0));
    drawFittedText(ctx, eq, rainX + 39, cy, 78, `bold ${fontSize}px "Arial Narrow", Arial, sans-serif`, '#ffffff', 'middle');
    drawFittedText(ctx, turn, rainX + rainW - 88, cy, 28, `${fontSize}px "Arial Narrow", Arial, sans-serif`, '#ffffff', 'middle');
    drawFittedText(ctx, '/', rainX + rainW - 59, cy, 10, `${fontSize}px Arial, sans-serif`, '#ffffff', 'middle');
    drawFittedText(ctx, accum, rainX + rainW - 45, cy, 32, `${fontSize}px "Arial Narrow", Arial, sans-serif`, '#ffffff', 'middle');

    const dividerY = Math.min(rainY + rainH - 5, cy + rowHeight / 2);
    ctx.beginPath();
    ctx.moveTo(rainX + 9, dividerY);
    ctx.lineTo(rainX + rainW - 9, dividerY);
    ctx.stroke();
  });
  ctx.restore();
}

function getReportLayoutBase(lower = false) {
  return lower
    ? { x: 13, y: 886, w: 492, h: 491, lower: true, maxRows: 7 }
    : { x: 13, y: 271, w: 492, h: 604, lower: false, maxRows: 11 };
}

function getSequentialNotesMetrics(ctx, unit, notesWidth, lower = false) {
  const titleFontSize = lower ? 18 : 20;
  const titleHeight = Math.ceil(titleFontSize * 1.12);
  const titleToBodyGap = lower ? 20 : 22;
  const sectionGap = lower ? 7 : 9;
  const observationFontSize = lower ? 12.8 : 14.6;
  const changesFontSize = Math.max(11.8, observationFontSize - 0.2);
  const lineRatio = 1.18;

  ctx.save();
  ctx.font = `${observationFontSize}px "Arial Narrow", Arial, sans-serif`;
  const observationLines = wrapTextLines(ctx, unit?.observation || '-', notesWidth);
  ctx.restore();

  ctx.save();
  ctx.font = `${changesFontSize}px "Arial Narrow", Arial, sans-serif`;
  const changesLines = wrapTextLines(ctx, unit?.changes || '-', notesWidth);
  ctx.restore();

  const observationLineHeight = observationFontSize * lineRatio;
  const changesLineHeight = changesFontSize * lineRatio;
  const observationHeight = observationLines.length * observationLineHeight;
  const changesHeight = changesLines.length * changesLineHeight;
  const totalHeight = titleHeight + titleToBodyGap + observationHeight + sectionGap + titleHeight + titleToBodyGap + changesHeight;

  return {
    titleFontSize,
    titleHeight,
    titleToBodyGap,
    sectionGap,
    observationFontSize,
    changesFontSize,
    lineRatio,
    observationLines,
    changesLines,
    observationLineHeight,
    changesLineHeight,
    totalHeight
  };
}

function layoutNoteBodySegments(ctx, text, startY, geometry, fontSize, lineHeight) {
  const narrowX = geometry.notesX;
  const narrowW = geometry.notesW;
  const wideX = geometry.notesX;
  const wideW = geometry.fullNotesW;
  const rainBottom = geometry.rainBottom;
  const belowRainGap = 10;
  const content = String(text || '-');
  const segments = [];

  ctx.save();
  ctx.font = `${fontSize}px "Arial Narrow", Arial, sans-serif`;

  if (startY >= rainBottom) {
    const wideLines = wrapTextLines(ctx, content, wideW);
    ctx.restore();
    segments.push({ x: wideX, y: startY, width: wideW, lines: wideLines });
    return { segments, endY: startY + wideLines.length * lineHeight };
  }

  const narrowLines = wrapTextLines(ctx, content, narrowW);
  const fitCount = Math.max(0, Math.floor((rainBottom - startY) / lineHeight));

  if (narrowLines.length <= fitCount || fitCount <= 0) {
    if (fitCount <= 0) {
      const wideLines = wrapTextLines(ctx, content, wideW);
      ctx.restore();
      segments.push({ x: wideX, y: rainBottom + belowRainGap, width: wideW, lines: wideLines });
      return { segments, endY: rainBottom + belowRainGap + wideLines.length * lineHeight };
    }
    ctx.restore();
    segments.push({ x: narrowX, y: startY, width: narrowW, lines: narrowLines });
    return { segments, endY: startY + narrowLines.length * lineHeight };
  }

  const topLines = narrowLines.slice(0, fitCount);
  const remainingText = narrowLines.slice(fitCount).join(' ');
  const wideLines = wrapTextLines(ctx, remainingText, wideW);
  ctx.restore();

  if (topLines.length) {
    segments.push({ x: narrowX, y: startY, width: narrowW, lines: topLines });
  }
  segments.push({ x: wideX, y: rainBottom + belowRainGap, width: wideW, lines: wideLines });
  return {
    segments,
    endY: rainBottom + belowRainGap + wideLines.length * lineHeight
  };
}

function computeSequentialNotesLayout(ctx, unit, geometry, lower = false) {
  const titleFontSize = lower ? 16 : 18;
  const titleToBodyGap = lower ? 20 : 22;
  const sectionGap = lower ? 7 : 9;
  const observationFontSize = lower ? 11.5 : 13;
  const changesFontSize = Math.max(10.5, observationFontSize - 0.4);
  const lineRatio = 1.18;
  const observationLineHeight = observationFontSize * lineRatio;
  const changesLineHeight = changesFontSize * lineRatio;

  let cursorY = geometry.notesY;
  const observationTitleY = cursorY;
  const observationBodyY = cursorY + titleToBodyGap;
  const observation = layoutNoteBodySegments(ctx, unit?.observation || '-', observationBodyY, geometry, observationFontSize, observationLineHeight);
  cursorY = observation.endY + sectionGap;

  const changesTitleY = cursorY;
  const changesBodyY = cursorY + titleToBodyGap;
  const changes = layoutNoteBodySegments(ctx, unit?.changes || '-', changesBodyY, geometry, changesFontSize, changesLineHeight);
  cursorY = changes.endY;

  return {
    titleFontSize,
    titleToBodyGap,
    observationFontSize,
    changesFontSize,
    observationLineHeight,
    changesLineHeight,
    observationTitleY,
    changesTitleY,
    observationSegments: observation.segments,
    changesSegments: changes.segments,
    totalHeight: cursorY - geometry.notesY
  };
}

function drawWrappedTextFixed(ctx, lines, x, y, fontSize, lineHeight, color = '#ffffff', family = '"Arial Narrow", Arial, sans-serif') {
  ctx.save();
  ctx.font = `${fontSize}px ${family}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  lines.forEach((line, index) => {
    ctx.fillText(line || ' ', x, y + index * lineHeight);
  });
  ctx.restore();
  return lines.length * lineHeight;
}

function estimateReportCardHeight(ctx, unit, lower = false, fullRows = false) {
  const layout = getReportLayoutBase(lower);
  layout.fullRows = fullRows;
  const geometry = getReportGeometry(ctx, layout, unit);
  const notesLayout = computeSequentialNotesLayout(ctx, unit, geometry, lower);
  const fixedOffsetToNotes = geometry.notesY - layout.y;
  const contentHeight = Math.max(geometry.rainH, notesLayout.totalHeight);
  const requiredHeight = Math.ceil(fixedOffsetToNotes + contentHeight + 12);
  return Math.max(layout.h, requiredHeight);
}

function buildDynamicReportLayouts(ctx, normalizedUnits) {
  const topLeftH = estimateReportCardHeight(ctx, normalizedUnits[0], false);
  const topRightH = estimateReportCardHeight(ctx, normalizedUnits[1], false);
  const topRowHeight = Math.max(topLeftH, topRightH);
  const lowerY = 886 + Math.max(0, topRowHeight - 604);

  const bottomLeftH = estimateReportCardHeight(ctx, normalizedUnits[2], true);
  const bottomRightH = estimateReportCardHeight(ctx, normalizedUnits[3], true);
  const bottomRowHeight = Math.max(bottomLeftH, bottomRightH);
  const originalFooterY = 886 + 491;
  const footerHeight = REPORT_BASE_HEIGHT - originalFooterY;
  const bottomCardsEnd = lowerY + bottomRowHeight;
  const canvasHeight = Math.max(REPORT_BASE_HEIGHT, bottomCardsEnd + footerHeight);
  const footerY = canvasHeight - footerHeight;

  return {
    lowerY,
    topRowHeight,
    bottomRowHeight,
    originalFooterY,
    footerY,
    footerHeight,
    layouts: [
      { x: 13, y: 271, w: 492, h: topRowHeight, lower: false, maxRows: 11 },
      { x: 519, y: 271, w: 492, h: topRowHeight, lower: false, maxRows: 11 },
      { x: 13, y: lowerY, w: 492, h: bottomRowHeight, lower: true, maxRows: 7 },
      { x: 519, y: lowerY, w: 492, h: bottomRowHeight, lower: true, maxRows: 7 }
    ],
    canvasHeight
  };
}

function drawUnitOnCanvas(ctx, unit, layout, unitIconImage = null) {
  const geometry = getReportGeometry(ctx, layout, unit);
  prepareCardBody(ctx, layout, unit, borderColorForState(unit.border), unitIconImage);
  drawRows(ctx, unit, layout, geometry);

  const metricWidth = 148;
  const gapX = 8;
  const metricTypes = ['industry', 'gear', 'delivery', 'stock', 'gear', 'delivery'];
  unit.metrics.forEach((metric, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    drawMetricBox(
      ctx,
      layout.x + 15 + col * (metricWidth + gapX),
      geometry.metricY + row * (geometry.metricHeight + geometry.metricGapY),
      metricWidth,
      geometry.metricHeight,
      metric,
      metricTypes[index]
    );
  });

  const notesLayout = computeSequentialNotesLayout(ctx, unit, geometry, layout.lower);

  ctx.save();
  ctx.fillStyle = '#f3d21c';
  ctx.font = `bold ${notesLayout.titleFontSize}px "Arial Narrow", Arial, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText('OBSERVAÇÃO', geometry.notesX, notesLayout.observationTitleY);
  ctx.fillText('MUDANÇAS', geometry.notesX, notesLayout.changesTitleY);
  ctx.restore();

  notesLayout.observationSegments.forEach(segment => {
    drawWrappedTextFixed(
      ctx,
      segment.lines,
      segment.x,
      segment.y,
      notesLayout.observationFontSize,
      notesLayout.observationLineHeight,
      '#ffffff'
    );
  });

  notesLayout.changesSegments.forEach(segment => {
    drawWrappedTextFixed(
      ctx,
      segment.lines,
      segment.x,
      segment.y,
      notesLayout.changesFontSize,
      notesLayout.changesLineHeight,
      '#ffffff'
    );
  });

}

// Emissão global fiel ao modelo aprovado (900 × 1600). A Sacarose e a emissão
// individual permanecem nas rotinas existentes, sem alterar seu comportamento.
const GLOBAL_REPORT_SCALE = 2;
const GLOBAL_REFERENCE_WIDTH = 900;
const GLOBAL_REFERENCE_HEIGHT = 1600;
const GLOBAL_REFERENCE_HEADER_END = 290;
const GLOBAL_REFERENCE_FOOTER_Y = 1508;
const GLOBAL_REFERENCE_ART = '/assets/posicao-campo-modelo-aprovado.png';

const GLOBAL_COLORS = Object.freeze({
  background: '#102930',
  cardTop: '#112a31',
  cardBottom: '#0b232b',
  border: '#ee6955',
  rule: 'rgba(159, 194, 194, 0.37)',
  yellow: '#f4d32c',
  green: '#80b82e',
  red: '#ed6855',
  white: '#f8f8f5',
  secondary: '#b7c1c4',
  metricBorder: '#c05d50',
  metricBackground: '#0e2530',
  rainBorder: '#79aec2'
});

function globalDrawText(ctx, value, x, y, maxWidth, font, color = GLOBAL_COLORS.white, align = 'left') {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  // fillText com largura máxima: não desloca a posição das colunas adjacentes.
  ctx.fillText(String(value ?? ''), x, y, maxWidth);
  ctx.restore();
}

function globalDrawReportHeader(ctx, art) {
  ctx.drawImage(art, 0, 0, GLOBAL_REFERENCE_WIDTH, GLOBAL_REFERENCE_HEADER_END,
    0, 0, GLOBAL_REFERENCE_WIDTH, GLOBAL_REFERENCE_HEADER_END);

  // Atualiza os dados variáveis sobre o cabeçalho do modelo aprovado.
  const headerClear = ctx.createLinearGradient(0, 0, 0, 78);
  headerClear.addColorStop(0, '#0d242c');
  headerClear.addColorStop(1, '#112a32');
  ctx.fillStyle = headerClear;
  ctx.fillRect(0, 0, 442, 78);
  const seamFade = ctx.createLinearGradient(442, 0, 525, 0);
  seamFade.addColorStop(0, '#112a32');
  seamFade.addColorStop(1, 'rgba(17,42,50,0)');
  ctx.fillStyle = seamFade;
  ctx.fillRect(442, 0, 83, 78);

  const { greeting, date } = getHeaderDataForExport(new Date());
  globalDrawText(ctx, greeting, 29, 48, 101, '900 27px "Arial Narrow", Arial, sans-serif');
  ctx.strokeStyle = '#a0a8a6';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(143, 29); ctx.lineTo(143, 60); ctx.stroke();

  // Ícone calendário equivalente ao do modelo, sem dependência de fontes externas.
  ctx.save();
  ctx.strokeStyle = '#73a92a'; ctx.fillStyle = '#73a92a'; ctx.lineWidth = 2;
  roundedRectPath(ctx, 163, 38, 20, 19, 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(163, 43); ctx.lineTo(183, 43); ctx.stroke();
  ctx.fillRect(168, 33, 2, 8); ctx.fillRect(177, 33, 2, 8);
  for (const dx of [168, 175]) for (const dy of [47, 52]) ctx.fillRect(dx, dy, 2.1, 2.1);
  ctx.restore();

  globalDrawText(ctx, date, 193, 48, 126, '900 27px "Arial Narrow", Arial, sans-serif');
  ctx.strokeStyle = '#a0a8a6'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(330, 29); ctx.lineTo(330, 60); ctx.stroke();
  // Antes, a emissão mostrava - TC (turno C). Agora usa a apresentação do modelo.
  globalDrawText(ctx, 'TURNO C', 348, 48, 105, '900 26px "Arial Narrow", Arial, sans-serif');

  // Substitui o subtítulo incorporado à arte, mantendo o título e a fotografia.
  const subtitleBackground = ctx.createLinearGradient(0, 0, 400, 0);
  subtitleBackground.addColorStop(0, '#102930');
  subtitleBackground.addColorStop(.86, '#102930');
  subtitleBackground.addColorStop(1, 'rgba(16,41,48,0)');
  ctx.fillStyle = subtitleBackground;
  ctx.fillRect(0, 162, 400, 59);
  globalDrawText(ctx, 'CTT', 30, 190, 310,
    'bold 64px Impact, "Roboto Condensed", "Arial Narrow", sans-serif', GLOBAL_COLORS.green);

  // Usa os status de emissão do catálogo, agrupando os detalhes operacionais.
  ctx.save();
  ctx.fillStyle = GLOBAL_COLORS.background;
  ctx.fillRect(0, 257, GLOBAL_REFERENCE_WIDTH, 33);
  const legendStatuses = [...new Set(fieldStatusOptions.map(status => status.image_status))];
  const legendColumnWidth = (GLOBAL_REFERENCE_WIDTH - 60) / Math.max(1, legendStatuses.length);
  legendStatuses.forEach((status, index) => {
    const x = 37 + index * legendColumnWidth;
    const label = status.charAt(0) + status.slice(1).toLocaleLowerCase('pt-BR');
    ctx.fillStyle = statusColorValue(getFieldStatus(status).color);
    ctx.beginPath(); ctx.arc(x, 270, 6.5, 0, Math.PI * 2); ctx.fill();
    globalDrawText(ctx, label, x + 14, 270, legendColumnWidth - 28, 'bold 15px "Arial Narrow", Arial, sans-serif');
  });
  ctx.restore();
}

function globalFrontRainMap(unit) {
  const lookup = new Map();
  for (const item of Array.isArray(unit.rain) ? unit.rain : []) {
    if (!Array.isArray(item)) continue;
    const key = canonicalFrontKey(item[0]);
    if (key) lookup.set(key, { turn: item[1], accum: item[2] });
  }
  return lookup;
}

function globalRainCell(value) {
  if (value === '' || value == null) return '—';
  const normalized = String(value).trim();
  if (!normalized || normalized === '-') return '—';
  const parsed = Number(normalized.replace(',', '.'));
  return Number.isFinite(parsed) ? normalized : normalized;
}

function globalRainMean(unit) {
  const rain = (Array.isArray(unit.rain) ? unit.rain : []).filter(row => Array.isArray(row));
  if (!rain.length) return {turn:'—', accum:'—'};
  const numbers = (index) => rain.map(row => Number(String(row[index] ?? '').replace(',', '.')))
    .filter(value => Number.isFinite(value));
  const average = (index) => {
    // Acumulado zero não compõe a média quando não houve chuva acumulada na frente.
    const vals = index === 2 ? numbers(index).filter(n=>n!==0) : numbers(index);
    return vals.length ? String(Math.round(vals.reduce((sum, n) => sum + n, 0) / vals.length)) : '—';
  };
  return { turn: average(1), accum: average(2) };
}

function globalHasNumericValue(value) {
  if (value === '' || value === null || value === undefined) return false;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0;
}

function globalHighlightValueColor(value) {
  return globalHasNumericValue(value) ? '#8af45b' : GLOBAL_COLORS.white;
}

function globalMeasureText(ctx, text, width, font) {
  ctx.save(); ctx.font = font;
  const lines = wrapTextLines(ctx, text, width);
  ctx.restore();
  return lines;
}

function globalNoteLines(unit, key, ctx, width = 383) {
  const value = String(unit?.[key] ?? '').trim();
  if (!value || value === '-') return [];
  const paragraphs = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return paragraphs.flatMap(paragraph => {
    const content = /^[•\-*]/.test(paragraph) ? paragraph : `• ${paragraph}`;
    return globalMeasureText(ctx, content, width - 10, '13px "Arial Narrow", Arial, sans-serif');
  });
}

// A faixa de cabeçalho precisa acomodar título, unidade "mm" e divisor sem contato.
// A primeira linha começa somente depois do divisor, sem sobreposição.
const GLOBAL_TABLE_LAYOUT = Object.freeze({
  headerY: 91,
  rainLabelY: 82,
  rainUnitY: 99,
  ruleY: 110,
  firstRow: 127,
  rowStep: 21
});

function globalUnitPlacement(ctx, unit, minHeight, isLower) {
  const lineCount = (unit.rows || []).length;
  // A quantidade real de frentes determina a barra de chuva e os cards de produção.
  const visibleRows = lineCount || 1;
  const rowsEnd = GLOBAL_TABLE_LAYOUT.firstRow + (visibleRows - 1) * GLOBAL_TABLE_LAYOUT.rowStep;
  const hasRain = reportHasRainData(unit);
  const summary = hasRain ? rowsEnd + 19 : null;
  const metrics = hasRain ? summary + 38 : rowsEnd + 23;
  const notes = metrics + 2 * 46 + 6 + 12;
  const obsLines = globalNoteLines(unit, 'observation', ctx);
  const changeLines = globalNoteLines(unit, 'changes', ctx);
  const obsH = obsLines.length ? 22 + obsLines.length * 16 : 0;
  const changesH = changeLines.length ? 8 + 22 + changeLines.length * 16 : 0;
  const required = Math.ceil(notes + obsH + changesH + 18);
  return { height: Math.max(minHeight, required), rowsEnd, summary, metrics, notes,
    hasRain, obsLines, changeLines, isLower };
}

function globalDrawCardBase(ctx, layout, unit, leaf) {
  const { x, y, w, h } = layout;
  ctx.save(); ctx.shadowColor = 'rgba(240,94,65,0.34)'; ctx.shadowBlur = 8;
  strokeRoundedRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 12, '#cc5d4a', 3);
  ctx.restore();
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, GLOBAL_COLORS.cardTop);
  grad.addColorStop(1, GLOBAL_COLORS.cardBottom);
  fillRoundedRect(ctx, x + 2.8, y + 2.8, w - 5.6, h - 5.6, 11, grad);
  const borderColor = unit.border === 'active' ? '#7fae3b' : unit.border === 'attention' ? '#edbc42' : GLOBAL_COLORS.border;
  strokeRoundedRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 12, borderColor, 2.4);

  fillRoundedRect(ctx, x + 17, y + 15, 5, 36, 2, GLOBAL_COLORS.border);
  // Retém o símbolo de cana, com peso visual compatível com o original.
  ctx.drawImage(leaf, x + 32, y + 13, 35, 42);
  globalDrawText(ctx, unit.code, x + 71, y + 30, 119, '900 28px "Arial Narrow", Arial, sans-serif');
  globalDrawText(ctx, unit.name, x + 71, y + 53, 236, '11.5px "Arial Narrow", Arial, sans-serif', GLOBAL_COLORS.white);
}

function globalDrawCardTable(ctx, layout, unit, placing) {
  const {x,y,w} = layout;
  const hasRain = placing.hasRain;
  const col = hasRain
    ? {front:x+17, sector:x+94, status:x+164, atr:x+270, turn:x+305, accum:x+367}
    : {front:x+17, sector:x+115, status:x+203, atr:x+368};
  const rain = hasRain ? globalFrontRainMap(unit) : null;

  if (hasRain) {
    globalDrawText(ctx, '☁', x + 318, y + 57, 22, 'bold 15px Arial, sans-serif', '#a8cfdd');
    globalDrawText(ctx, 'CHUVA', x + 340, y + 56, 64, 'bold 12.7px "Arial Narrow", Arial, sans-serif');
    ctx.save();ctx.strokeStyle = GLOBAL_COLORS.rule;ctx.lineWidth = 0.9;
    ctx.beginPath();ctx.moveTo(x+308,y+65);ctx.lineTo(x+w-17,y+65);ctx.stroke();ctx.restore();
  }

  const yHeader=y+GLOBAL_TABLE_LAYOUT.headerY;
  const titleFont='bold 13.2px "Arial Narrow", Arial, sans-serif';
  globalDrawText(ctx,'FRENTE',col.front,yHeader,67,titleFont);
  globalDrawText(ctx,'SETOR',col.sector,yHeader,60,titleFont);
  globalDrawText(ctx,'STATUS',col.status,yHeader,hasRain?93:145,titleFont);
  globalDrawText(ctx,'ATR',col.atr,yHeader,34,titleFont);
  if (hasRain) {
    globalDrawText(ctx,'TURNO',col.turn,y+GLOBAL_TABLE_LAYOUT.rainLabelY,45,'bold 12.5px "Arial Narrow", Arial, sans-serif');
    globalDrawText(ctx,'mm',col.turn+11,y+GLOBAL_TABLE_LAYOUT.rainUnitY,23,'9.6px "Arial Narrow", Arial, sans-serif',GLOBAL_COLORS.secondary);
    globalDrawText(ctx,'ACUM.',col.accum,y+GLOBAL_TABLE_LAYOUT.rainLabelY,40,'bold 12.5px "Arial Narrow", Arial, sans-serif');
    globalDrawText(ctx,'mm',col.accum+11,y+GLOBAL_TABLE_LAYOUT.rainUnitY,23,'9.6px "Arial Narrow", Arial, sans-serif',GLOBAL_COLORS.secondary);
  }
  ctx.save();ctx.strokeStyle = GLOBAL_COLORS.rule;ctx.lineWidth=.8;
  ctx.beginPath();ctx.moveTo(x+16,y+GLOBAL_TABLE_LAYOUT.ruleY);ctx.lineTo(x+w-16,y+GLOBAL_TABLE_LAYOUT.ruleY);ctx.stroke();ctx.restore();

  const rows = Array.isArray(unit.rows) ? unit.rows : [];
  rows.forEach((row, index) => {
    const [front='',sector='',color='yellow',status='',atr=''] = row || [];
    const cy=y+GLOBAL_TABLE_LAYOUT.firstRow + GLOBAL_TABLE_LAYOUT.rowStep*index;
    ctx.save(); ctx.fillStyle = statusColorValue(color);
    ctx.beginPath();ctx.arc(x+25,cy,6,0,2*Math.PI);ctx.fill();ctx.restore();
    const font='bold 15.5px "Arial Narrow", Arial, sans-serif';
    globalDrawText(ctx, front, x+38, cy, 42, font);
    globalDrawText(ctx, sector, col.sector, cy, hasRain?61:78, font);
    const displayedStatus=String(status).toLowerCase().replace(/(^|\s)\p{L}/gu, char => char.toUpperCase());
    const softenedStatus=displayedStatus.replace('Úmido','úmido').replace('Atividade','atividade');
    globalDrawText(ctx, softenedStatus, col.status, cy, hasRain?96:145, 'bold 14.3px "Arial Narrow", Arial, sans-serif', color === 'yellow' ? GLOBAL_COLORS.yellow : statusColorValue(color));
    globalDrawText(ctx, String(atr ?? '').trim() || '—', col.atr+(hasRain?6:0), cy, 29, font);
    if (hasRain) {
      const rainfall=rain.get(canonicalFrontKey(front));
      globalDrawText(ctx, rainfall ? globalRainCell(rainfall.turn) : '—', col.turn+25, cy, 25, font, globalHighlightValueColor(rainfall ? rainfall.turn : ''), 'center');
      globalDrawText(ctx, rainfall ? globalRainCell(rainfall.accum) : '—', col.accum+27, cy, 28, font, globalHighlightValueColor(rainfall ? rainfall.accum : ''), 'center');
    }
  });

  if (hasRain) {
    const barY=y+placing.summary;
    fillRoundedRect(ctx,x+16,barY,w-32,29,9,'rgba(53,98,116,0.23)');
    strokeRoundedRect(ctx,x+16,barY,w-32,29,9,GLOBAL_COLORS.rainBorder,1.2);
    globalDrawText(ctx,'☁',x+26,barY+14.5,17,'bold 14px Arial, sans-serif','#abd9ea');
    const mean=globalRainMean(unit);
    globalDrawText(ctx,`Média: Turno ${mean.turn} mm | Acum ${mean.accum} mm`,x+51,barY+15,258,'bold 13.6px "Arial Narrow", Arial, sans-serif', (globalHasNumericValue(mean.turn) || globalHasNumericValue(mean.accum)) ? '#d7f7ff' : GLOBAL_COLORS.white);
    const startDate = unit.rainStartDate || unit.rain_start_date || unit.rainStart || '';
    if (startDate) globalDrawText(ctx,`acum.: desde ${startDate}`,x+w-99,barY+15,78,'9px "Arial Narrow", Arial, sans-serif','#abbac2');
  }
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

function globalMetricValue(value, stock) {
  const raw=String(value ?? '').trim();
  if (!raw) return '—';
  const stripped=raw.replace(/\bTN\s*\/\s*H\b/ig,'t/h').replace(/\bCARGAS\b/ig,'cargas');
  if (stock) return /cargas/i.test(stripped) ? stripped : `${stripped} cargas`;
  return /t\/h/i.test(stripped) ? stripped : `${stripped} t/h`;
}

function globalDrawCardMetrics(ctx, layout, unit, placing) {
  const {x,y,w}=layout;
  const types=['industry','gear','delivery','stock','gear','delivery'];
  const names=['INDÚSTRIA','MOAGEM TURNO','ENTREGA TURNO','ESTOQUE','MOAGEM ÚLT. 3 H','ENTREGA ÚLT. 3 H'];
  const boxW=(w-32-12)/3;
  for (let i=0;i<6;i++) {
    const mx=x+16+(i%3)*(boxW+6);
    const my=y+placing.metrics+Math.floor(i/3)*52;
    fillRoundedRect(ctx,mx,my,boxW,46,7,GLOBAL_COLORS.metricBackground);
    const data=(unit.metrics || [])[i];
    const metricPositive = globalMetricHasPositiveValue(data?.[2]);
    strokeRoundedRect(ctx,mx,my,boxW,46,7,metricPositive ? '#8af45b' : GLOBAL_COLORS.metricBorder,1.6);
    const c=i===0?'#d66b53':'#76b633';
    drawMetricIcon(ctx,types[i],mx+8,my+14,19,c);
    const isIndustry=i===0;
    globalDrawText(ctx,names[i],mx+35,my+13,isIndustry?63:boxW-41,'bold 9px "Arial Narrow", Arial, sans-serif', metricPositive ? GLOBAL_COLORS.white : '#d97a5b');
    if (isIndustry && !metricPositive) {
      fillRoundedRect(ctx,mx+boxW-45,my+7,36,12,3,'#e86655');
      globalDrawText(ctx,'PARADA',mx+boxW-42,my+13,29,'bold 8px "Arial Narrow", Arial, sans-serif');
    }
    globalDrawText(ctx,globalMetricValue(data?.[2] ?? '',i===3),mx+35,my+32,boxW-40,'bold 15px "Arial Narrow", Arial, sans-serif',GLOBAL_COLORS.white);
  }
}

function globalDrawCardNotes(ctx, layout, placing) {
  const {x,y}=layout;
  const left=x+17;
  let noteY=y+placing.notes;
  const drawBlock=(title,lines) => {
    if (!lines.length) return;
    globalDrawText(ctx,title,left,noteY+8,310,'bold 15.5px "Arial Narrow", Arial, sans-serif',GLOBAL_COLORS.yellow);
    noteY += 25;
    for (const line of lines) {
      globalDrawText(ctx,line,left,noteY+6,layout.w-34,'13px "Arial Narrow", Arial, sans-serif');
      noteY +=16;
    }
  };
  drawBlock('OBSERVAÇÃO', placing.obsLines);
  if (placing.changeLines.length && placing.obsLines.length) noteY +=8;
  drawBlock('MUDANÇAS', placing.changeLines);
}

function globalDrawCard(ctx, layout, unit, placing, leaf) {
  globalDrawCardBase(ctx,layout,unit,leaf);
  globalDrawCardTable(ctx,layout,unit,placing);
  globalDrawCardMetrics(ctx,layout,unit,placing);
  globalDrawCardNotes(ctx,layout,placing);
}

async function globalGenerateApprovedImage(sourceUnits) {
  if (!Array.isArray(sourceUnits) || sourceUnits.length !== 4) {
    throw new Error('A posição global precisa das quatro unidades.');
  }
  const normalized=sourceUnits.map((u,i)=>normalizeReportUnit(u,i));
  const unitByCode=new Map(normalized.map(unit=>[unit.code,unit]));
  const desired=['PPT','NRD','RBR','PST'];
  const ordered=desired.map((code,i)=>unitByCode.get(code)||normalized[i]);

  const measure=document.createElement('canvas').getContext('2d');
  const topPlacement=ordered.slice(0,2).map(u=>globalUnitPlacement(measure,u,632,false));
  const bottomPlacement=ordered.slice(2).map(u=>globalUnitPlacement(measure,u,569,true));
  const topH=Math.max(632,...topPlacement.map(p=>p.height));
  const bottomH=Math.max(569,...bottomPlacement.map(p=>p.height));
  const bottomY=292+topH+12;
  const footerY=bottomY+bottomH+3;
  const height=footerY+(GLOBAL_REFERENCE_HEIGHT-GLOBAL_REFERENCE_FOOTER_Y);
  const c=document.createElement('canvas');
  c.width=GLOBAL_REFERENCE_WIDTH*GLOBAL_REPORT_SCALE;
  c.height=height*GLOBAL_REPORT_SCALE;
  const ctx=c.getContext('2d',{alpha:false});
  if (!ctx) throw new Error('Canvas não suportado neste navegador.');
  ctx.scale(GLOBAL_REPORT_SCALE,GLOBAL_REPORT_SCALE);
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  const [art,leaf]=await Promise.all([
    loadImageAsset(GLOBAL_REFERENCE_ART, 'Não foi possível carregar a imagem de referência da Posição de Campo.'),
    loadEmbeddedReportUnitSymbol()
  ]);
  globalDrawReportHeader(ctx,art);
  ctx.fillStyle=GLOBAL_COLORS.background;
  ctx.fillRect(0,GLOBAL_REFERENCE_HEADER_END,GLOBAL_REFERENCE_WIDTH,footerY-GLOBAL_REFERENCE_HEADER_END);
  const layouts=[
    {x:22,y:292,w:423,h:topH}, {x:455,y:292,w:423,h:topH},
    {x:22,y:bottomY,w:423,h:bottomH}, {x:455,y:bottomY,w:423,h:bottomH}
  ];
  layouts.forEach((layout,i)=>globalDrawCard(ctx,layout,ordered[i],i<2?topPlacement[i]:bottomPlacement[i-2],leaf));
  ctx.drawImage(art,0,GLOBAL_REFERENCE_FOOTER_Y,GLOBAL_REFERENCE_WIDTH,
    GLOBAL_REFERENCE_HEIGHT-GLOBAL_REFERENCE_FOOTER_Y,0,footerY,
    GLOBAL_REFERENCE_WIDTH,GLOBAL_REFERENCE_HEIGHT-GLOBAL_REFERENCE_FOOTER_Y);
  if (typeof art?.close==='function') art.close();
  if (typeof leaf?.close==='function') leaf.close();
  return new Promise((resolve,reject)=>c.toBlob(blob=>blob?resolve(blob):reject(new Error('Não foi possível gerar a imagem da Posição de Campo.')),'image/png'));
}

async function generateReportImageBlob(sourceUnits) {
  return globalGenerateApprovedImage(sourceUnits);
}

async function generateUnitReportImageBlob(sourceUnit) {
  if (!sourceUnit?.code) throw new Error('Unidade inválida para emissão.');
  const unit = normalizeReportUnit(sourceUnit, 0);
  const canvas = document.createElement('canvas');
  const measureCtx = canvas.getContext('2d');
  if (!measureCtx) throw new Error('Canvas não suportado neste navegador.');
  const cardHeight = estimateReportCardHeight(measureCtx, unit, false, true);
  const width = 544;
  const height = cardHeight + 152;
  canvas.width = width * REPORT_EXPORT_SCALE;
  canvas.height = height * REPORT_EXPORT_SCALE;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.scale(REPORT_EXPORT_SCALE, REPORT_EXPORT_SCALE);
  ctx.fillStyle = '#012d36';
  ctx.fillRect(0, 0, width, height);
  drawFittedText(ctx, 'Posição de Campo', 26, 38, width - 52, 'bold 28px Arial, sans-serif');
  const header = getHeaderDataForExport();
  drawFittedText(ctx, `${header.greeting} · ${header.date}`, 26, 70, width - 52, '16px Arial, sans-serif');
  const icon = await loadReportUnitIconImage();
  drawUnitOnCanvas(ctx, unit, { x: 26, y: 108, w: 492, h: cardHeight, lower: false, maxRows: Math.max(11, unit.rows.length), fullRows: true }, icon);
  if (typeof icon?.close === 'function') icon.close();
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível gerar a imagem da unidade.')), 'image/png'));
}

function getSacaroseExportRows(unitCode, positions, sectors) {
  const source = Array.isArray(positions[unitCode]) ? positions[unitCode] : [];

  return [...source]
    .map(item => {
      const sector = String(item?.sector || '').trim();
      const requestedSection = String(item?.section || '').trim();
      const normalized = value => String(value || '').trim().toLocaleLowerCase('pt-BR');
      const baseItem = sectors.find(item => normalized(item.sector) === normalized(sector)
        && (!requestedSection || normalized(item.section) === normalized(requestedSection)));
      return {
        front: String(item?.front || '').trim(),
        sector,
        section: String(requestedSection || baseItem?.section || '').trim(),
        description: String(baseItem?.description || item?.description || '').trim(),
        exclude_image: Boolean(item?.exclude_image)
      };
    })
    .filter(item => !item.exclude_image && (item.front || item.sector))
    .sort((a, b) => compareFrontLabels(a.front, b.front));
}

function drawSacaroseHeaderIcon(ctx, iconImage, x, y, size) {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(iconImage, x, y, size, size);
  ctx.restore();
}

function drawSacaroseCenteredText(ctx, text, centerX, y, maxWidth, font, color = '#1a2435') {
  const value = String(text ?? '');
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const measured = Math.max(1, ctx.measureText(value).width);
  const scaleX = Math.min(1, maxWidth / measured);
  ctx.translate(centerX, y);
  ctx.scale(scaleX, 1);
  ctx.fillText(value, 0, 0);
  ctx.restore();
}

function drawSacaroseExportBackground(ctx, width, height) {
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#edf3ef');
  bg.addColorStop(1, '#f4f7f5');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(170, 0);
  ctx.lineTo(0, 170);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  ctx.moveTo(width, height);
  ctx.lineTo(width - 210, height);
  ctx.lineTo(width, height - 210);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSacaroseExportUnit(ctx, code, rows, x, y, width, iconImage, headerDate = '') {
  const headerH = 66;
  const columnsH = 36;
  const rowH = 60;
  const emptyH = 66;
  const bodyH = rows.length ? rows.length * rowH : emptyH;
  const height = headerH + columnsH + bodyH;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = '#d7e3da';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.restore();

  const headerFill = ctx.createLinearGradient(x, y, x + width, y);
  headerFill.addColorStop(0, '#8dd24f');
  headerFill.addColorStop(1, '#b5e698');
  ctx.save();
  ctx.fillStyle = headerFill;
  ctx.fillRect(x, y, width, headerH);
  ctx.restore();

  const iconSize = 44;
  const iconX = x + 18;
  const iconY = y + 11;
  drawSacaroseHeaderIcon(ctx, iconImage, iconX, iconY, iconSize);

  ctx.save();
  ctx.strokeStyle = 'rgba(56, 102, 55, 0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(iconX + iconSize + 18, y + 13);
  ctx.lineTo(iconX + iconSize + 18, y + headerH - 13);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = '#0b2417';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.fillText(`POSIÇÃO DE COLHEITA ${code}`, x + width / 2, y + headerH / 2 + 2);
  ctx.restore();

  if (headerDate) {
    ctx.save();
    ctx.fillStyle = '#214c32';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 17px Arial, sans-serif';
    ctx.fillText(headerDate, x + width - 18, y + headerH / 2 + 2);
    ctx.restore();
  }

  const colY = y + headerH;
  ctx.save();
  ctx.fillStyle = '#40556b';
  ctx.fillRect(x, colY, width, columnsH);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px Arial, sans-serif';
  const frontStart = x;
  const frontEnd = x + 220;
  const sectionStart = x + 220;
  const sectionEnd = x + 465;
  const sectorStart = x + 465;
  const sectorEnd = x + 705;
  const farmStart = x + 705;
  const farmEnd = x + width;
  const colFront = (frontStart + frontEnd) / 2;
  const colSection = (sectionStart + sectionEnd) / 2;
  const colSector = (sectorStart + sectorEnd) / 2;
  const farmTextX = farmStart + 16;

  ctx.textAlign = 'center';
  ctx.fillText('Frente', colFront, colY + columnsH / 2);
  ctx.fillText('Seção', colSection, colY + columnsH / 2);
  ctx.fillText('Setor', colSector, colY + columnsH / 2);
  ctx.textAlign = 'left';
  ctx.fillText('Fazenda', farmTextX, colY + columnsH / 2);
  ctx.restore();

  // subtle vertical separators matching the reference layout
  ctx.save();
  ctx.strokeStyle = '#dce5df';
  ctx.lineWidth = 1;
  [x + 220, x + 465, x + 705].forEach(separatorX => {
    ctx.beginPath();
    ctx.moveTo(separatorX, colY);
    ctx.lineTo(separatorX, y + height);
    ctx.stroke();
  });
  ctx.restore();

  if (!rows.length) {
    ctx.save();
    ctx.fillStyle = '#6c7d71';
    ctx.font = '16px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Nenhuma frente informada.', x + 22, colY + columnsH + emptyH / 2);
    ctx.restore();
    return height;
  }

  rows.forEach((item, index) => {
    const rowY = colY + columnsH + index * rowH;
    ctx.save();
    ctx.fillStyle = index % 2 === 0 ? '#f9fbfa' : '#f1f6f3';
    ctx.fillRect(x, rowY, width, rowH);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#eef3ef';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, rowY + rowH);
    ctx.lineTo(x + width, rowY + rowH);
    ctx.stroke();
    ctx.restore();

    drawSacaroseCenteredText(ctx, item.front || '-', colFront, rowY + rowH / 2, frontEnd - frontStart - 28, 'bold 18px Arial, sans-serif', '#0d3c28');
    drawSacaroseCenteredText(ctx, item.section || '-', colSection, rowY + rowH / 2, sectionEnd - sectionStart - 28, '17px Arial, sans-serif', '#1a2435');
    drawSacaroseCenteredText(ctx, item.sector || '-', colSector, rowY + rowH / 2, sectorEnd - sectorStart - 28, '17px Arial, sans-serif', '#1a2435');
    drawWrappedTextFit(ctx, item.description || '-', farmTextX, rowY + 8, farmEnd - farmTextX - 16, rowH - 16, {
      maxFontSize: 15,
      minFontSize: 10,
      color: '#162234',
      family: 'Arial, sans-serif',
      lineRatio: 1.06
    });
  });

  return height;
}

async function generateSacaroseReportImageBlob(exportUnits, positions, sectors, options = {}) {
  if (!Array.isArray(exportUnits) || !exportUnits.length || exportUnits.some(code => !REPORT_UNIT_NAMES[code])) throw new Error('Selecione uma unidade válida.');

  const sacaroseIcon = await loadSacaroseHeaderIconImage();

  const exportRows = exportUnits.map(code => ({
    code,
    rows: getSacaroseExportRows(code, positions, sectors)
  }));

  const transparentBackground = options.transparentBackground !== false;
  const selectedScale = Number(options.scale);
  const scale = Number.isFinite(selectedScale) && selectedScale > 0 ? selectedScale : SACAROSE_REPORT_EXPORT_SCALE;
  const unitHeight = rows => 66 + 36 + (rows.length ? rows.length * 60 : 66);
  const baseWidth = 1145;
  const topMargin = transparentBackground ? 18 : 74;
  const sideMargin = 32;
  const gap = transparentBackground ? 24 : 42;
  const bottomMargin = transparentBackground ? 18 : 34;
  const totalUnitsHeight = exportRows.reduce((sum, item, index) => (
    sum + unitHeight(item.rows) + (index < exportRows.length - 1 ? gap : 0)
  ), 0);
  const minimumHeight = transparentBackground ? topMargin + totalUnitsHeight + bottomMargin : 1374;
  const baseHeight = Math.max(minimumHeight, topMargin + totalUnitsHeight + bottomMargin);
  const canvas = document.createElement('canvas');
  canvas.width = baseWidth * scale;
  canvas.height = baseHeight * scale;
  const ctx = canvas.getContext('2d', { alpha: transparentBackground });
  if (!ctx) throw new Error('Canvas não suportado neste navegador.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(scale, scale);

  if (!transparentBackground) {
    drawSacaroseExportBackground(ctx, baseWidth, baseHeight);

    const { date } = getHeaderDataForExport(new Date());
    ctx.save();
    ctx.fillStyle = '#3b4d63';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 24px Arial, sans-serif';
    ctx.fillText(date, baseWidth - 34, 40);
    ctx.restore();
  } else {
    ctx.clearRect(0, 0, baseWidth, baseHeight);
  }

  const { date: currentDate } = getHeaderDataForExport(new Date());
  let y = transparentBackground ? topMargin : 102;
  exportRows.forEach((item, index) => {
    y += drawSacaroseExportUnit(
      ctx,
      item.code,
      item.rows,
      sideMargin,
      y,
      baseWidth - sideMargin * 2,
      sacaroseIcon,
      index === 0 ? currentDate : ''
    );
    if (index < exportRows.length - 1) y += gap;
  });
  if (typeof sacaroseIcon?.close === 'function') sacaroseIcon.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Não foi possível converter a posição da Sacarose para PNG.'));
    }, 'image/png');
  });
}
