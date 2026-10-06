// Renderização e download das imagens do painel e da Sacarose.
const REPORT_BASE_WIDTH = 1024;
const REPORT_BASE_HEIGHT = 1536;
const REPORT_EXPORT_SCALE = 4;
const REPORT_EXPORT_MIME_TYPE = 'image/png';
const REPORT_EXPORT_EXTENSION = REPORT_EXPORT_MIME_TYPE === 'image/png' ? 'png' : 'jpg';
const REPORT_METRICS = [
  ['🏭', 'INDÚSTRIA', 'TN/H'], ['⚙️', 'MOAGEM TURNO', 'TN/H'],
  ['🚚', 'ENTREGA TURNO', 'TN/H'], ['⬡', 'ESTOQUE', 'CARGAS', 'stock'],
  ['⚙️', 'MOAGEM ÚLTIMAS 3H', 'TN/H'], ['🚚', 'ENTREGA ÚLTIMAS 3H', 'TN/H']
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
    rows: Array.isArray(cloned.rows) ? cloned.rows : [],
    metrics: Array.isArray(cloned.metrics) && cloned.metrics.length === REPORT_METRICS.length ? cloned.metrics : REPORT_METRICS.map(([icon, label, suffix, extra = '']) => [icon, label, `0 ${suffix}`, extra]),
    observation: String(cloned.observation || '-'),
    changes: String(cloned.changes || '-'),
    rain: Array.isArray(cloned.rain) ? cloned.rain : []
  };

  if (normalized.code === 'PST' && (!normalized.name || normalized.name === 'PARAÍSA TEMPO')) normalized.name = 'PASSA TEMPO';
  const statuses = normalized.rows.filter(row => String(row?.[0] || '').trim() || String(row?.[1] || '').trim())
    .map(row => String(row?.[3] || 'EM ATIVIDADE').trim().toUpperCase());
  normalized.border = !statuses.length || statuses.every(status => status === 'EM ATIVIDADE') ? 'active'
    : statuses.every(status => status === 'SOLO ÚMIDO') ? 'critical' : 'attention';
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

async function loadReportUnitIconImage() {
  try {
    return await loadImageAsset('/assets/report-unit-icon.png?v=20260930-icon-v35', 'Não foi possível carregar o ícone das unidades do relatório.');
  } catch (error) {
    console.warn('Ícone das unidades indisponível; usando desenho de segurança no relatório.', error);
    return null;
  }
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
  background.addColorStop(0, '#003842');
  background.addColorStop(0.52, '#00323b');
  background.addColorStop(1, '#002a33');
  fillRoundedRect(ctx, layout.x, layout.y, layout.w, layout.h, 16, background);

  ctx.save();
  roundedRectPath(ctx, layout.x, layout.y, layout.w, layout.h, 16);
  ctx.clip();
  const headerGlow = ctx.createLinearGradient(layout.x, layout.y, layout.x, layout.y + 90);
  headerGlow.addColorStop(0, 'rgba(0, 92, 97, 0.26)');
  headerGlow.addColorStop(1, 'rgba(0, 46, 58, 0)');
  ctx.fillStyle = headerGlow;
  ctx.fillRect(layout.x, layout.y, layout.w, 90);
  ctx.restore();

  strokeRoundedRect(ctx, layout.x + 1.5, layout.y + 1.5, layout.w - 3, layout.h - 3, 15, borderColor, 6);

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
  if (border === 'critical') return '#ff3a45';
  if (border === 'attention') return '#ffe11a';
  return '#56ef3b';
}

function statusColorValue(color) {
  if (color === 'green') return '#7dff4c';
  if (color === 'red') return '#ff4758';
  return '#ffe11a';
}

function statusTextColor(color) {
  return color === 'green' ? '#73ff48' : '#ffffff';
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
  const metricHeight = layout.lower ? 48 : 55;
  const metricGapY = layout.lower ? 8 : 9;
  const extraRowsHeight = layout.fullRows ? Math.max(0, unit.rows.length - 11) * 18 : 0;
  const metricY = layout.y + (layout.lower ? 246 : 295) + extraRowsHeight;
  const metricsBottom = metricY + metricHeight * 2 + metricGapY;
  const contentTop = metricsBottom + 8;
  const cardBottom = layout.y + layout.h;
  const innerLeft = layout.x + 18;
  const innerRight = layout.x + layout.w - 18;
  const notesGap = layout.lower ? 10 : 12;
  const defaultNotesW = layout.lower ? 245 : 214;
  const minRainW = layout.lower ? 150 : 170;
  const maxNotesW = layout.lower ? 286 : 272;
  const maxBodyFont = layout.lower ? 11.5 : 13;
  const observationLines = getWrappedTextLineCount(ctx, unit?.observation || '-', defaultNotesW, maxBodyFont);
  const changesLines = getWrappedTextLineCount(ctx, unit?.changes || '-', defaultNotesW, maxBodyFont);
  const extraWidthDemand = Math.max(0, observationLines - 3) * 10 + Math.max(0, changesLines - 2) * 6;
  let notesW = clampValue(defaultNotesW + extraWidthDemand, defaultNotesW, maxNotesW);
  let rainW = innerRight - innerLeft - notesGap - notesW;
  if (rainW < minRainW) {
    rainW = minRainW;
    notesW = innerRight - innerLeft - notesGap - rainW;
  }

  const fixedRainH = layout.lower ? 125 : 174;

  return {
    metricY,
    metricHeight,
    metricGapY,
    metricsBottom,
    contentTop,
    cardBottom,
    innerLeft,
    innerRight,
    fullNotesW: innerRight - innerLeft,
    tableTop: layout.y + (layout.lower ? 112 : 114),
    tableBottom: metricY - (layout.lower ? 12 : 14),
    rainX: innerRight - rainW,
    rainY: contentTop,
    rainW,
    rainH: fixedRainH,
    rainBottom: contentTop + fixedRainH,
    notesX: innerLeft,
    notesY: contentTop + 2,
    notesW,
    notesGap
  };
}

function drawMetricBox(ctx, x, y, width, height, metric, type) {
  const borderColor = '#ff3a45';
  fillRoundedRect(ctx, x, y, width, height, 8, '#002b33');
  strokeRoundedRect(ctx, x, y, width, height, 8, borderColor, 3);

  const compact = height < 52;
  const iconSize = compact ? 20 : 22;
  const iconY = y + (compact ? 12 : 13);
  drawMetricIcon(ctx, type, x + 9, iconY, iconSize, '#ffffff');

  const labelX = x + 42;
  const labelY = y + (compact ? 14 : 16);
  const valueY = y + (compact ? 35 : 40);
  drawFittedText(ctx, metric?.[1] || '', labelX, labelY, width - 50, compact ? '10px "Arial Narrow", Arial, sans-serif' : '11px "Arial Narrow", Arial, sans-serif', '#ffffff');
  drawFittedText(ctx, metric?.[2] || '0', labelX, valueY, width - 50, compact ? 'bold 16px "Arial Narrow", Arial, sans-serif' : 'bold 18px "Arial Narrow", Arial, sans-serif', '#ffffff');
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

  if (hiddenCount > 0 && rows.length) {
    rows[rows.length - 1] = ['…', '…', 'yellow', `+${hiddenCount + 1} FRENTES`];
  }

  const rowCount = rows.length;
  const lastCenterLimit = geometry.tableBottom - 8;
  const rowHeight = rowCount > 1
    ? Math.min(layout.lower ? 18 : 18, Math.max(preferredMinRowHeight, (lastCenterLimit - geometry.tableTop) / (rowCount - 1)))
    : 18;
  const fontSize = Math.max(12.4, Math.min(15.4, rowHeight - 1.2));
  const statusFontSize = Math.max(11.8, fontSize - 0.2);
  const dotRadius = Math.max(5.5, Math.min(7.25, rowHeight * 0.36));
  const lineOffset = Math.min(8, rowHeight * 0.44);

  ctx.save();
  ctx.strokeStyle = 'rgba(125, 177, 185, 0.42)';
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(left, layout.y + 73);
  ctx.lineTo(right, layout.y + 73);
  ctx.stroke();

  drawFittedText(ctx, 'FRENTE', layout.x + 20, layout.y + 93, 86, 'bold 14.2px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, 'SETOR', layout.x + 153, layout.y + 93, 90, 'bold 14.2px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, 'STATUS', layout.x + 323, layout.y + 93, 135, 'bold 14.2px "Arial Narrow", Arial, sans-serif', '#ffffff', 'middle');

  ctx.beginPath();
  ctx.moveTo(left, layout.y + 104);
  ctx.lineTo(right, layout.y + 104);
  ctx.stroke();

  rows.forEach(([front = '', sector = '', color = 'yellow', status = ''], index) => {
    const cy = geometry.tableTop + index * rowHeight;

    ctx.beginPath();
    ctx.arc(layout.x + 35, cy, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = statusColorValue(color);
    ctx.fill();

    drawFittedText(ctx, front, layout.x + 55, cy + 0.5, 72, `${fontSize}px "Arial Narrow", Arial, sans-serif`, '#ffffff', 'middle');
    drawFittedText(ctx, sector, layout.x + 155, cy + 0.5, 112, `${fontSize}px "Arial Narrow", Arial, sans-serif`, '#ffffff', 'middle');
    drawFittedText(ctx, status, layout.x + 305, cy + 0.5, right - (layout.x + 305) - 8, `${statusFontSize}px "Arial Narrow", Arial, sans-serif`, statusTextColor(color), 'middle');

    ctx.beginPath();
    ctx.moveTo(left, Math.min(geometry.tableBottom, cy + lineOffset));
    ctx.lineTo(right, Math.min(geometry.tableBottom, cy + lineOffset));
    ctx.stroke();
  });
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
  ctx.fillStyle = '#ffe11a';
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

  drawRainBox(ctx, unit, layout, geometry);
}

function removeReportHeaderLogo(ctx, template) {
  // Reaproveita uma faixa limpa do próprio cabeçalho para cobrir somente o logo Cocal.
  // A transição da borda esquerda é suavizada para não criar uma emenda visível.
  ctx.drawImage(template, 520, 0, 244, 64, 780, 0, 244, 64);

  ctx.save();
  for (let offset = 0; offset < 30; offset += 1) {
    ctx.globalAlpha = (offset + 1) / 30;
    ctx.drawImage(template, 490 + offset, 0, 1, 64, 750 + offset, 0, 1, 64);
  }
  ctx.restore();
}

function paintReportGapBackground(ctx, y, height) {
  if (height <= 0) return;

  const background = ctx.createLinearGradient(0, y, 0, y + height);
  background.addColorStop(0, '#032a34');
  background.addColorStop(0.5, '#032f39');
  background.addColorStop(1, '#02242d');
  ctx.fillStyle = background;
  ctx.fillRect(0, y, REPORT_BASE_WIDTH, height);

  ctx.save();
  ctx.globalAlpha = 0.28;
  const glow = ctx.createRadialGradient(REPORT_BASE_WIDTH * 0.18, y + height * 0.2, 0, REPORT_BASE_WIDTH * 0.18, y + height * 0.2, REPORT_BASE_WIDTH * 0.3);
  glow.addColorStop(0, 'rgba(70, 161, 72, 0.45)');
  glow.addColorStop(1, 'rgba(70, 161, 72, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, y, REPORT_BASE_WIDTH, height);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(124, 230, 55, 0.55)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-20, y + height - 24);
  ctx.bezierCurveTo(REPORT_BASE_WIDTH * 0.18, y + height - 42, REPORT_BASE_WIDTH * 0.42, y + height + 18, REPORT_BASE_WIDTH * 0.7, y + height - 14);
  ctx.bezierCurveTo(REPORT_BASE_WIDTH * 0.85, y + height - 30, REPORT_BASE_WIDTH * 0.95, y + height - 22, REPORT_BASE_WIDTH + 20, y + height - 34);
  ctx.stroke();
  ctx.restore();
}

function drawReportFooter(ctx, template, dynamicReport) {
  const { originalFooterY, footerY, footerHeight } = dynamicReport;
  if (footerHeight <= 0) return;

  // Redesenha o rodapé original intacto logo após o fim dos cards inferiores.
  ctx.drawImage(
    template,
    0,
    originalFooterY,
    REPORT_BASE_WIDTH,
    footerHeight,
    0,
    footerY,
    REPORT_BASE_WIDTH,
    footerHeight
  );
}

async function generateReportImageBlob(sourceUnits) {
  if (!Array.isArray(sourceUnits) || sourceUnits.length !== 4) throw new Error('A posição global precisa das quatro unidades.');
  const normalizedUnits = sourceUnits.map((unit, index) => normalizeReportUnit(unit, index));

  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = REPORT_BASE_WIDTH;
  measureCanvas.height = REPORT_BASE_HEIGHT;
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) throw new Error('Canvas não suportado neste navegador.');

  const dynamicReport = buildDynamicReportLayouts(measureCtx, normalizedUnits);
  const canvas = document.createElement('canvas');
  canvas.width = REPORT_BASE_WIDTH * REPORT_EXPORT_SCALE;
  canvas.height = dynamicReport.canvasHeight * REPORT_EXPORT_SCALE;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas não suportado neste navegador.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(REPORT_EXPORT_SCALE, REPORT_EXPORT_SCALE);

  const template = await loadReportTemplateImage();
  const reportUnitIcon = await loadReportUnitIconImage();
  ctx.drawImage(template, 0, 0, REPORT_BASE_WIDTH, REPORT_BASE_HEIGHT);

  // Quando os cards precisam crescer, cobrimos as áreas antigas do template
  // para evitar “fantasmas” das unidades originais aparecendo entre os blocos.
  if (dynamicReport.lowerY > 886) {
    paintReportGapBackground(ctx, 886, dynamicReport.lowerY - 886);
  }
  if (dynamicReport.canvasHeight > REPORT_BASE_HEIGHT) {
    paintReportGapBackground(ctx, REPORT_BASE_HEIGHT, dynamicReport.canvasHeight - REPORT_BASE_HEIGHT);
  }

  // Mantém o rodapé sempre abaixo dos cards, mesmo quando observações/mudanças aumentam a altura.
  if (dynamicReport.footerY > dynamicReport.originalFooterY) {
    paintReportGapBackground(
      ctx,
      dynamicReport.originalFooterY,
      dynamicReport.footerY - dynamicReport.originalFooterY
    );
  }

  removeReportHeaderLogo(ctx, template);

  const { greeting, date } = getHeaderDataForExport(new Date());
  ctx.fillStyle = 'rgba(2, 33, 40, 0.98)';
  ctx.fillRect(26, 20, 175, 36);
  ctx.fillRect(262, 20, 205, 36);
  drawFittedText(ctx, greeting, 28, 38, 165, 'bold 31px Arial, sans-serif', '#ffffff', 'middle');
  drawFittedText(ctx, `${date} - TC`, 260, 38, 195, 'bold 28px Arial, sans-serif', '#ffffff', 'middle');

  dynamicReport.layouts.forEach((layout, index) => drawUnitOnCanvas(ctx, normalizedUnits[index], layout, reportUnitIcon));

  // O rodapé é desenhado por último para nunca ficar atrás de um card expandido.
  drawReportFooter(ctx, template, dynamicReport);

  if (typeof reportUnitIcon?.close === 'function') reportUnitIcon.close();
  if (typeof template.close === 'function') template.close();

  return new Promise((resolve, reject) => {
    if (REPORT_EXPORT_MIME_TYPE === 'image/png') {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Não foi possível converter o relatório para PNG.'));
      }, 'image/png');
      return;
    }

    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Não foi possível converter o relatório para JPG.'));
    }, 'image/jpeg', 0.98);
  });
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

function drawSacaroseExportUnit(ctx, code, rows, x, y, width, iconImage) {
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

  const colY = y + headerH;
  ctx.save();
  ctx.fillStyle = '#40556b';
  ctx.fillRect(x, colY, width, columnsH);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px Arial, sans-serif';
  const colFront = x + 86;
  const colSection = x + 342;
  const colSector = x + 590;
  const colFarm = x + 910;
  ctx.fillText('Frente', colFront, colY + columnsH / 2);
  ctx.fillText('Seção', colSection, colY + columnsH / 2);
  ctx.fillText('Setor', colSector, colY + columnsH / 2);
  ctx.fillText('Fazenda', colFarm, colY + columnsH / 2);
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

    drawFittedText(ctx, item.front || '-', colFront - 32, rowY + rowH / 2, 64, 'bold 18px Arial, sans-serif', '#0d3c28', 'middle');
    drawFittedText(ctx, item.section || '-', colSection - 54, rowY + rowH / 2, 108, '17px Arial, sans-serif', '#1a2435', 'middle');
    drawFittedText(ctx, item.sector || '-', colSector - 54, rowY + rowH / 2, 108, '17px Arial, sans-serif', '#1a2435', 'middle');
    drawWrappedTextFit(ctx, item.description || '-', colFarm - 180, rowY + 8, 360, rowH - 16, {
      maxFontSize: 15,
      minFontSize: 10,
      color: '#162234',
      family: 'Arial, sans-serif',
      lineRatio: 1.06
    });
  });

  return height;
}

async function generateSacaroseReportImageBlob(exportUnits, positions, sectors) {
  if (!Array.isArray(exportUnits) || !exportUnits.length || exportUnits.some(code => !REPORT_UNIT_NAMES[code])) throw new Error('Selecione uma unidade válida.');

  const sacaroseIcon = await loadSacaroseHeaderIconImage();

  const exportRows = exportUnits.map(code => ({
    code,
    rows: getSacaroseExportRows(code, positions, sectors)
  }));

  const unitHeight = rows => 66 + 36 + (rows.length ? rows.length * 60 : 66);
  const baseWidth = 1145;
  const topMargin = 74;
  const sideMargin = 32;
  const gap = 42;
  const bottomMargin = 34;
  const totalUnitsHeight = exportRows.reduce((sum, item, index) => (
    sum + unitHeight(item.rows) + (index < exportRows.length - 1 ? gap : 0)
  ), 0);
  const baseHeight = Math.max(1374, topMargin + totalUnitsHeight + bottomMargin);
  const scale = REPORT_EXPORT_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = baseWidth * scale;
  canvas.height = baseHeight * scale;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas não suportado neste navegador.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(scale, scale);

  drawSacaroseExportBackground(ctx, baseWidth, baseHeight);

  const { date } = getHeaderDataForExport(new Date());
  ctx.save();
  ctx.fillStyle = '#3b4d63';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 24px Arial, sans-serif';
  ctx.fillText(date, baseWidth - 34, 40);
  ctx.restore();

  let y = 102;
  exportRows.forEach((item, index) => {
    y += drawSacaroseExportUnit(ctx, item.code, item.rows, sideMargin, y, baseWidth - sideMargin * 2, sacaroseIcon);
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
