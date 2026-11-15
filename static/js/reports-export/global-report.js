// Emissão global "Troca de Turno CTT" (quatro unidades), fiel ao modelo aprovado:
// cabeçalho, resumo geral (frentes, indústrias, moagem do turno, ATR), moagem do dia
// consolidada e um card por unidade com balança, frentes, ATR recebido e anotações.
// Moagem, entrega, estoque, ATR, processado e projeção vêm da pesagem da balança
// (resumo de /api/weighings/summary, horas fechadas = hora atual − 1 h); sem pesagem
// da unidade, valem os indicadores digitados no Preencher. "Indústria" é sempre digitada.
// Depende de core/format.js, core/common.js, core/field-fronts.js,
// reports-export/shared-drawing.js e reports-export/field-report-data.js.
const GLOBAL_REPORT_SCALE = 2.5;
const GLOBAL_REFERENCE_WIDTH = 720;
const GLOBAL_HEADER_HEIGHT = 252;
const GLOBAL_LEGEND_Y = 224;
const GLOBAL_CARD_TOP = 470;
const GLOBAL_FONT = '"Arial Narrow", Arial, sans-serif';

const GLOBAL_COLORS = Object.freeze({
  header: '#33474f',
  headerRule: 'rgba(255,255,255,0.16)',
  page: '#eceff1',
  card: '#ffffff',
  cardBorder: '#dde3e6',
  ink: '#22323a',
  muted: '#6b787e',
  soft: '#f2f4f5',
  rule: '#e3e7ea',
  green: '#7cc23f',
  greenText: '#4c9a17',
  yellow: '#f2c230',
  yellowText: '#9a7400',
  yellowSoft: '#fbf3d5',
  orange: '#ee7f2d',
  gray: '#b3bbbf',
  white: '#ffffff',
  rain: '#2f7fa8'
});

// Status da imagem (image_status do catálogo) → cor do ponto, do texto e legenda do modelo.
const GLOBAL_STATUS_STYLE = Object.freeze({
  green: { dot: GLOBAL_COLORS.green, text: GLOBAL_COLORS.greenText, legend: 'Em atividade' },
  yellow: { dot: GLOBAL_COLORS.yellow, text: GLOBAL_COLORS.yellowText, legend: 'Solo úmido / mudança / teste', pill: true },
  red: { dot: GLOBAL_COLORS.orange, text: GLOBAL_COLORS.orange, legend: 'Parado / oficina / crítico' },
  gray: { dot: GLOBAL_COLORS.gray, text: GLOBAL_COLORS.muted, legend: 'Aguardando atividade' }
});

function globalStatusStyle(color) {
  return GLOBAL_STATUS_STYLE[color] || GLOBAL_STATUS_STYLE.gray;
}

function globalFont(size, weight = 'bold') {
  return `${weight} ${size}px ${GLOBAL_FONT}`;
}

function globalDrawText(ctx, value, x, y, maxWidth, font, color = GLOBAL_COLORS.ink, align = 'left') {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  // fillText com largura máxima: não desloca a posição das colunas adjacentes.
  ctx.fillText(String(value ?? ''), x, y, maxWidth);
  ctx.restore();
}

function globalTextWidth(ctx, text, font) {
  ctx.save(); ctx.font = font;
  const width = ctx.measureText(String(text ?? '')).width;
  ctx.restore();
  return width;
}

function globalWrap(ctx, text, width, font) {
  ctx.save(); ctx.font = font;
  const lines = wrapTextLines(ctx, text, width);
  ctx.restore();
  return lines;
}

// Número no padrão brasileiro; ausente ou inválido vira "—" (sem dado enviado).
function globalNumber(value, digits = 0) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Primeiro número de um indicador digitado ("850 TN/H", "1.243", "48 cargas").
function globalLeadingNumber(text) {
  const found = String(text ?? '').match(/-?\d[\d.,]*/);
  if (!found) return null;
  const number = parseBrNumber(found[0].replace(/[.,]$/, ''));
  return Number.isFinite(number) ? number : null;
}

// Turno operacional do horário de Brasília: A até 07:20, B até 15:40, C depois.
function globalShiftAt(date = new Date()) {
  const { hour, minute } = saoPauloDateParts(date);
  const minutes = hour * 60 + minute;
  return minutes < 440 ? 'A' : minutes < 940 ? 'B' : 'C';
}

function globalFilledRows(unit) {
  return (unit.rows || []).filter(row => String(row?.[0] || '').trim() || String(row?.[1] || '').trim());
}

// Dados de uma unidade para a imagem: balança quando há pesagem do dia, senão o digitado.
function globalUnitData(unit, summary) {
  const weighing = (summary?.units || []).find(item => item.code === unit.code);
  const hasWeighing = Boolean(summary?.reference_at && weighing && weighing.loads_day > 0);
  const typed = index => globalLeadingNumber(unit.metrics?.[index]?.[2]);
  const pick = (key, index) => (hasWeighing && weighing[key] !== null && weighing[key] !== undefined ? weighing[key] : typed(index));
  const rows = globalFilledRows(unit);
  const frontAtr = new Map((hasWeighing ? weighing.fronts || [] : [])
    .map(front => [canonicalFieldFrontKey(front.front), front.atr]));
  const support = (summary?.support || []).filter(item => hasWeighing
    && (item.to_unit === unit.code || item.from_unit === unit.code));
  return {
    rows,
    active: rows.filter(row => getFieldStatus(row[3]).group === 'active').length,
    industry: typed(0),
    millingShift: pick('milling_shift_tph', 1),
    deliveryShift: pick('delivery_shift_tph', 2),
    stock: pick('stock_loads', 3),
    milling3h: pick('milling_last3h_tph', 4),
    delivery3h: pick('delivery_last3h_tph', 5),
    atr: hasWeighing ? weighing.atr : null,
    day: hasWeighing ? weighing.milling_day_t : null,
    projection: hasWeighing ? weighing.milling_projection_t : null,
    // ATR digitado na frente; sem ele, o ATR da balança da frente.
    frontAtr: row => String(row[4] ?? '').trim() || (frontAtr.get(canonicalFieldFrontKey(row[0])) != null
      ? globalNumber(frontAtr.get(canonicalFieldFrontKey(row[0])), 2) : ''),
    received: hasWeighing ? (weighing.received || []) : [],
    support: support.map(item => (item.to_unit === unit.code
      ? `FT ${fieldFrontNumber(item.front)} (${item.from_unit}) entregando aqui: ${globalNumber(item.loads)} cargas · ${globalNumber(item.tons)} t.`
      : `FT ${fieldFrontNumber(item.front)} apoiando a ${item.to_unit}: ${globalNumber(item.loads)} cargas · ${globalNumber(item.tons)} t.`))
  };
}

// ---------------------------------------------------------------------------
// Cabeçalho
// ---------------------------------------------------------------------------
function globalDrawReportHeader(ctx, units, generatedAt) {
  const W = GLOBAL_REFERENCE_WIDTH;
  ctx.fillStyle = GLOBAL_COLORS.header;
  ctx.fillRect(0, 0, W, GLOBAL_HEADER_HEIGHT);

  const { greeting, date } = getHeaderDataForExport(generatedAt);
  const topFont = globalFont(24, '900');
  let x = 26;
  globalDrawText(ctx, greeting, x, 34, 150, topFont, GLOBAL_COLORS.white);
  x += Math.min(150, globalTextWidth(ctx, greeting, topFont)) + 16;
  ctx.fillStyle = GLOBAL_COLORS.headerRule; ctx.fillRect(x, 20, 1.5, 28);
  x += 16;
  // Ícone de calendário.
  ctx.save();
  ctx.strokeStyle = GLOBAL_COLORS.yellow; ctx.fillStyle = GLOBAL_COLORS.yellow; ctx.lineWidth = 1.8;
  roundedRectPath(ctx, x, 25, 17, 16, 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x + 17, 30); ctx.stroke();
  ctx.fillRect(x + 4, 21, 1.8, 6); ctx.fillRect(x + 11, 21, 1.8, 6);
  ctx.restore();
  x += 26;
  globalDrawText(ctx, date, x, 34, 130, topFont, GLOBAL_COLORS.white);
  x += Math.min(130, globalTextWidth(ctx, date, topFont)) + 16;
  ctx.fillStyle = GLOBAL_COLORS.headerRule; ctx.fillRect(x, 20, 1.5, 28);
  x += 16;
  globalDrawText(ctx, `TURNO ${globalShiftAt(generatedAt)}`, x, 34, 110, topFont, GLOBAL_COLORS.yellow);
  ctx.fillStyle = GLOBAL_COLORS.headerRule; ctx.fillRect(0, 66, W, 1);

  globalDrawText(ctx, 'TROCA DE TURNO', 26, 106, W - 52, globalFont(46, '900'), GLOBAL_COLORS.white);
  globalDrawText(ctx, 'CTT', 26, 152, 200, globalFont(46, '900'), GLOBAL_COLORS.green);
  globalDrawText(ctx, 'Colheita: frentes, indústria, moagem, entrega, estoque e ATR', 26, 192, W - 52,
    globalFont(16, 'bold'), GLOBAL_COLORS.white);

  // Legenda só com os status usados em alguma frente das quatro unidades
  // (ex.: "Solo úmido" só aparece se alguma frente estiver em solo úmido).
  const used = new Set(units.flatMap(unit => globalFilledRows(unit).map(row => getFieldStatus(row[3]).color)));
  const legendFont = globalFont(13.5, 'bold');
  let lx = 32;
  ['green', 'yellow', 'gray', 'red'].filter(color => used.has(color)).forEach(color => {
    const style = globalStatusStyle(color);
    const textWidth = Math.min(W - lx - 40, globalTextWidth(ctx, style.legend, legendFont));
    ctx.fillStyle = style.dot;
    ctx.beginPath(); ctx.arc(lx, GLOBAL_LEGEND_Y, 6, 0, Math.PI * 2); ctx.fill();
    globalDrawText(ctx, style.legend, lx + 12, GLOBAL_LEGEND_Y, textWidth, legendFont, GLOBAL_COLORS.white);
    lx += 12 + textWidth + 30;
  });

  // Faixa decorativa do modelo (verde, amarelo, laranja e cinza).
  [GLOBAL_COLORS.green, GLOBAL_COLORS.yellow, GLOBAL_COLORS.orange, GLOBAL_COLORS.gray].forEach((color, index) => {
    ctx.fillStyle = color;
    ctx.fillRect(index * W / 4, GLOBAL_HEADER_HEIGHT - 6, W / 4 + 1, 6);
  });
}

// ---------------------------------------------------------------------------
// Resumo geral e moagem do dia consolidada
// ---------------------------------------------------------------------------
function globalSum(values) {
  const numbers = values.filter(value => value !== null && value !== undefined && Number.isFinite(Number(value)));
  return numbers.length ? numbers.reduce((sum, value) => sum + Number(value), 0) : null;
}

function globalDrawSummary(ctx, units, data) {
  const top = GLOBAL_HEADER_HEIGHT + 12;
  const gap = 10;
  const width = (GLOBAL_REFERENCE_WIDTH - 28 - gap * 3) / 4;
  const height = 104;
  const card = (index, fill, border) => {
    const x = 14 + index * (width + gap);
    fillRoundedRect(ctx, x, top, width, height, 10, fill);
    if (border) strokeRoundedRect(ctx, x + 1, top + 1, width - 2, height - 2, 10, border, 2);
    else strokeRoundedRect(ctx, x + .5, top + .5, width - 1, height - 1, 10, GLOBAL_COLORS.cardBorder, 1);
    return x + 14;
  };
  const label = (text, x, y, color = GLOBAL_COLORS.muted) =>
    globalDrawText(ctx, text, x, y, width - 28, globalFont(11.5, 'bold'), color);

  // 1. Frentes em atividade (verde).
  const totalFronts = data.reduce((sum, item) => sum + item.rows.length, 0);
  const activeFronts = data.reduce((sum, item) => sum + item.active, 0);
  let x = card(0, GLOBAL_COLORS.green);
  label('FRENTES EM', x, top + 20, GLOBAL_COLORS.white);
  label('ATIVIDADE', x, top + 35, GLOBAL_COLORS.white);
  const bigFont = globalFont(30, '900');
  globalDrawText(ctx, String(activeFronts), x, top + 64, 60, bigFont, GLOBAL_COLORS.white);
  globalDrawText(ctx, `de ${totalFronts}`, x + Math.min(60, globalTextWidth(ctx, activeFronts, bigFont)) + 6, top + 67, 70,
    globalFont(17, 'bold'), GLOBAL_COLORS.white);
  globalDrawText(ctx, `${units.length} unidades`, x, top + 89, width - 28, globalFont(13, 'normal'), GLOBAL_COLORS.white);

  // 2. Indústrias em operação (Indústria digitada maior que zero).
  const running = data.filter(item => item.industry > 0).length;
  x = card(1, GLOBAL_COLORS.card);
  label('INDÚSTRIAS', x, top + 20);
  globalDrawText(ctx, String(running), x, top + 52, 50, bigFont);
  globalDrawText(ctx, `de ${units.length}`, x + Math.min(50, globalTextWidth(ctx, running, bigFont)) + 6, top + 55, 60, globalFont(17, 'bold'));
  const stopped = units.length - running;
  globalDrawText(ctx, stopped ? `${stopped} ${stopped === 1 ? 'parada' : 'paradas'}` : 'todas em operação', x, top + 84,
    width - 28, globalFont(13, 'normal'), stopped ? GLOBAL_COLORS.orange : GLOBAL_COLORS.muted);

  // 3. Moagem do turno somada (com entrega e estoque).
  const milling = globalSum(data.map(item => item.millingShift));
  const delivery = globalSum(data.map(item => item.deliveryShift));
  const stock = globalSum(data.map(item => item.stock));
  x = card(2, GLOBAL_COLORS.card);
  label('MOAGEM TURNO', x, top + 20);
  const millingText = globalNumber(milling);
  globalDrawText(ctx, millingText, x, top + 50, width - 60, bigFont);
  globalDrawText(ctx, 't/h', x + Math.min(width - 60, globalTextWidth(ctx, millingText, bigFont)) + 5, top + 54, 30, globalFont(15, 'bold'));
  globalDrawText(ctx, `entrega ${globalNumber(delivery)} t/h`, x, top + 77, width - 28, globalFont(12.5, 'normal'), GLOBAL_COLORS.muted);
  globalDrawText(ctx, `estoque ${globalNumber(stock)} cargas`, x, top + 93, width - 28, globalFont(12.5, 'normal'), GLOBAL_COLORS.muted);

  // 4. ATR médio geral: média do ATR das unidades com pesagem.
  const atrValues = data.map(item => item.atr).filter(value => value !== null && value !== undefined);
  const atr = atrValues.length ? atrValues.reduce((sum, value) => sum + value, 0) / atrValues.length : null;
  x = card(3, GLOBAL_COLORS.card, GLOBAL_COLORS.yellow);
  label('ATR MÉDIO GERAL', x, top + 20, GLOBAL_COLORS.yellowText);
  const atrText = globalNumber(atr, 2);
  globalDrawText(ctx, atrText, x, top + 50, width - 64, bigFont);
  globalDrawText(ctx, 'kg/t', x + Math.min(width - 64, globalTextWidth(ctx, atrText, bigFont)) + 5, top + 54, 34, globalFont(15, 'bold'));
  globalDrawText(ctx, atrValues.length ? `média das ${atrValues.length} unidades` : 'sem pesagem', x, top + 82,
    width - 28, globalFont(13, 'normal'), GLOBAL_COLORS.muted);

  // Moagem do dia consolidada: total processado e projeção (média do dia × 24) por unidade.
  const rowTop = top + height + 10;
  const rowHeight = 84;
  fillRoundedRect(ctx, 14, rowTop, GLOBAL_REFERENCE_WIDTH - 28, rowHeight, 10, GLOBAL_COLORS.card);
  strokeRoundedRect(ctx, 14.5, rowTop + .5, GLOBAL_REFERENCE_WIDTH - 29, rowHeight - 1, 10, GLOBAL_COLORS.cardBorder, 1);
  fillRoundedRect(ctx, 14, rowTop, 5, rowHeight, 2.5, GLOBAL_COLORS.green);
  globalDrawText(ctx, 'MOAGEM DO DIA · CONSOLIDADO', 32, rowTop + 18, 300, globalFont(11.5, 'bold'), GLOBAL_COLORS.muted);
  const day = globalSum(data.map(item => item.day));
  const projection = globalSum(data.map(item => item.projection));
  const valueFont = globalFont(30, '900');
  globalDrawText(ctx, 'Total processado dia', 32, rowTop + 38, 140, globalFont(13, 'normal'), GLOBAL_COLORS.muted);
  const dayText = globalNumber(day);
  globalDrawText(ctx, dayText, 32, rowTop + 64, 120, valueFont);
  globalDrawText(ctx, 't', 32 + Math.min(120, globalTextWidth(ctx, dayText, valueFont)) + 4, rowTop + 69, 14, globalFont(15, 'bold'));
  ctx.fillStyle = GLOBAL_COLORS.rule; ctx.fillRect(176, rowTop + 32, 1, 44);
  globalDrawText(ctx, 'Projeção de moagem dia', 190, rowTop + 38, 160, globalFont(13, 'normal'), GLOBAL_COLORS.muted);
  const projectionText = globalNumber(projection);
  globalDrawText(ctx, projectionText, 190, rowTop + 64, 120, valueFont, GLOBAL_COLORS.greenText);
  globalDrawText(ctx, 't', 190 + Math.min(120, globalTextWidth(ctx, projectionText, valueFont)) + 4, rowTop + 69, 14,
    globalFont(15, 'bold'), GLOBAL_COLORS.greenText);
  const unitsLeft = 352;
  const unitWidth = (GLOBAL_REFERENCE_WIDTH - 14 - 8 - unitsLeft) / 4;
  units.forEach((unit, index) => {
    const ux = unitsLeft + index * unitWidth;
    fillRoundedRect(ctx, ux, rowTop + 8, unitWidth - 6, rowHeight - 16, 7, GLOBAL_COLORS.soft);
    globalDrawText(ctx, unit.code, ux + 9, rowTop + 22, unitWidth - 24, globalFont(13, 'bold'));
    globalDrawText(ctx, globalNumber(data[index].day), ux + 9, rowTop + 44, unitWidth - 24, globalFont(20, '900'));
    globalDrawText(ctx, `proj. ${globalNumber(data[index].projection)}`, ux + 9, rowTop + 64, unitWidth - 24,
      globalFont(12, 'bold'), GLOBAL_COLORS.greenText);
  });
}

// ---------------------------------------------------------------------------
// Card da unidade
// ---------------------------------------------------------------------------
const GLOBAL_CARD = Object.freeze({
  metricsY: 80,
  processedY: 150,
  tableHeaderY: 200,
  firstRow: 226,
  rowStep: 22,
  noteLine: 16
});

function globalFrontRainMap(unit) {
  return buildRainLookup(unit, { rawValues: true });
}

function globalRainCell(value) {
  if (value === '' || value == null) return '—';
  const normalized = String(value).trim();
  return !normalized || normalized === '-' ? '—' : normalized;
}

// Média apenas das frentes exibidas no informativo (mesmo critério de reportHasRainData).
// Turno e acumulado seguem a mesma regra: vazios e textos não numéricos ficam fora; zeros contam.
function globalRainMean(unit) {
  const lookup = buildRainLookup(unit, { rawValues: true });
  const shownKeys = new Set((Array.isArray(unit?.rows) ? unit.rows : [])
    .filter(Array.isArray).map(row => canonicalFieldFrontKey(row[0])).filter(Boolean));
  const entries = [...shownKeys].map(key => lookup.get(key)).filter(Boolean);
  const average = field => {
    const values = entries.map(entry => parseBrNumber(entry[field])).filter(Number.isFinite);
    return values.length ? String(Math.round(values.reduce((sum, n) => sum + n, 0) / values.length)) : '—';
  };
  return { turn: average('turn'), accum: average('accum') };
}

// Observação, mudanças e apoio: rótulo à esquerda, texto quebrado à direita.
function globalNoteBlocks(ctx, unit, item, width) {
  const textWidth = width - 120;
  const font = globalFont(13, 'normal');
  const lines = (value, empty) => {
    const text = String(value ?? '').trim();
    const content = !text || text === '-' ? empty : text.split(/\r?\n/).map(line => line.trim().replace(/^[•*-]\s*/, '')).filter(Boolean).join('\n');
    return globalWrap(ctx, content, textWidth, font);
  };
  const blocks = [{ label: ['OBSERVAÇÃO'], color: GLOBAL_COLORS.orange, lines: lines(unit.observation, 'Sem observação.') }];
  if (item.support.length) {
    blocks.push({ label: ['APOIO ENTRE', 'UNIDADES'], color: GLOBAL_COLORS.greenText, lines: lines(item.support.join('\n'), '') });
  }
  blocks.push({ label: ['MUDANÇAS'], color: GLOBAL_COLORS.ink, lines: lines(unit.changes, 'Sem mudança prevista.') });
  return blocks.map(block => ({ ...block, height: Math.max(block.lines.length, block.label.length) * GLOBAL_CARD.noteLine + 14 }));
}

function globalReceivedLines(ctx, item, width) {
  if (!item.received.length) return [];
  const text = item.received.map(front => `FT${fieldFrontNumber(front.front)} (${front.home_unit}) ${front.atr != null ? globalNumber(front.atr, 2) : '—'}`).join(' · ');
  return globalWrap(ctx, text, width - 128, globalFont(13, 'bold'));
}

function globalUnitPlacement(ctx, unit, item, width) {
  const hasRain = reportHasRainData(unit);
  const rows = Math.max(1, item.rows.length);
  const rowsEnd = GLOBAL_CARD.firstRow + (rows - 1) * GLOBAL_CARD.rowStep;
  let cursor = rowsEnd + 18;
  const rainBar = hasRain ? cursor : null;
  if (hasRain) cursor += 38;
  const receivedLines = globalReceivedLines(ctx, item, width);
  const received = receivedLines.length ? { y: cursor, height: 16 + receivedLines.length * 18, lines: receivedLines } : null;
  if (received) cursor += received.height + 12;
  const notes = globalNoteBlocks(ctx, unit, item, width);
  const notesY = cursor;
  cursor += notes.reduce((sum, block) => sum + block.height, 0);
  return { hasRain, rowsEnd, rainBar, received, notes, notesY, height: Math.ceil(cursor + 10) };
}

function globalDrawCardBase(ctx, layout, unit, item) {
  const { x, y, w, h } = layout;
  fillRoundedRect(ctx, x, y, w, h, 12, GLOBAL_COLORS.card);
  strokeRoundedRect(ctx, x + .5, y + .5, w - 1, h - 1, 12, GLOBAL_COLORS.cardBorder, 1);
  globalDrawText(ctx, unit.code, x + 16, y + 30, 120, globalFont(32, '900'));
  const name = String(unit.name || '').toLocaleLowerCase('pt-BR').replace(/(^|\s)\p{L}/gu, char => char.toUpperCase());
  globalDrawText(ctx, name, x + 16, y + 56, w / 2 - 20, globalFont(14, 'normal'), GLOBAL_COLORS.muted);
  const allActive = item.rows.length > 0 && item.active === item.rows.length;
  globalDrawText(ctx, `${item.active}/${item.rows.length}`, x + w - 16, y + 30, 90, globalFont(28, '900'),
    allActive ? GLOBAL_COLORS.green : GLOBAL_COLORS.yellowText, 'right');
  globalDrawText(ctx, 'frentes em atividade', x + w - 16, y + 56, w / 2 - 20, globalFont(13, 'normal'), GLOBAL_COLORS.muted, 'right');
  ctx.fillStyle = GLOBAL_COLORS.rule; ctx.fillRect(x + 14, y + 68, w - 28, 1);
}

// Barra da moagem: moagem do turno ÷ indústria. Verde ≥ 100%, amarelo 90–99%, laranja < 90%.
function globalIndustryShare(item) {
  if (!(item.industry > 0) || item.millingShift === null || item.millingShift === undefined) return null;
  const share = item.millingShift / item.industry;
  const color = share >= 1 ? GLOBAL_COLORS.green : share >= .9 ? GLOBAL_COLORS.yellow : GLOBAL_COLORS.orange;
  const text = share >= 1 ? GLOBAL_COLORS.greenText : share >= .9 ? GLOBAL_COLORS.yellowText : GLOBAL_COLORS.orange;
  return { share, color, text };
}

function globalDrawCardMetrics(ctx, layout, item) {
  const { x, y, w } = layout;
  const top = y + GLOBAL_CARD.metricsY;
  const widths = [.26, .26, .22, .26].map(part => (w - 28) * part);
  const columns = widths.map((_, index) => x + 14 + widths.slice(0, index).reduce((sum, value) => sum + value, 0));
  const labelFont = globalFont(10.5, 'bold');
  const valueFont = globalFont(21, '900');
  const unitFont = globalFont(11, 'bold');
  // Valor e unidade dentro da própria coluna (a unidade nunca invade a coluna seguinte).
  const value = (index, number, unitLabel, digits = 0) => {
    const text = globalNumber(number, digits);
    const unitWidth = text === '—' ? 0 : globalTextWidth(ctx, unitLabel, unitFont) + 3;
    const valueWidth = Math.min(widths[index] - 8 - unitWidth, globalTextWidth(ctx, text, valueFont));
    globalDrawText(ctx, text, columns[index], top + 22, valueWidth, valueFont);
    if (unitWidth) globalDrawText(ctx, unitLabel, columns[index] + valueWidth + 3, top + 25, unitWidth, unitFont, GLOBAL_COLORS.muted);
  };
  const small = (index, text, row, color = GLOBAL_COLORS.muted) =>
    globalDrawText(ctx, text, columns[index], top + row, widths[index] - 6, globalFont(10.5, 'normal'), color);
  ['MOAGEM TURNO', 'ENTREGA TURNO', 'ESTOQUE', 'ATR PARCIAL'].forEach((label, index) =>
    globalDrawText(ctx, label, columns[index], top + 2, widths[index] - 6, labelFont, GLOBAL_COLORS.muted));

  value(0, item.millingShift, 't/h');
  const share = globalIndustryShare(item);
  const barWidth = widths[0] - 16;
  fillRoundedRect(ctx, columns[0], top + 38, barWidth, 4, 2, GLOBAL_COLORS.rule);
  if (share) {
    fillRoundedRect(ctx, columns[0], top + 38, barWidth * Math.min(1, share.share), 4, 2, share.color);
    // Trunca (99,6% → 99%) para o número nunca contradizer a cor da faixa (verde só ≥ 100%).
    small(0, `${Math.floor(share.share * 100)}% da ind. ${globalNumber(item.industry)}`, 50, share.text);
  } else {
    small(0, item.industry > 0 ? `ind. ${globalNumber(item.industry)}` : 'indústria —', 50);
  }
  small(0, `últ. 3 h · ${globalNumber(item.milling3h)}`, 63);

  value(1, item.deliveryShift, 't/h');
  small(1, `últ. 3 h · ${globalNumber(item.delivery3h)}`, 50);

  value(2, item.stock, 'cargas');
  value(3, item.atr, 'kg/t', 2);
}

function globalDrawProcessed(ctx, layout, item) {
  const { x, y, w } = layout;
  const top = y + GLOBAL_CARD.processedY;
  fillRoundedRect(ctx, x + 14, top, w - 28, 32, 8, GLOBAL_COLORS.soft);
  // Rótulo e valor lado a lado em cada metade, sem sobreposição.
  const labelFont = globalFont(10, 'bold');
  const valueFont = globalFont(17, '900');
  const middle = x + w / 2;
  const pair = (label, text, left, right, color) => {
    const labelWidth = Math.min(90, globalTextWidth(ctx, label, labelFont));
    globalDrawText(ctx, label, left, top + 16, labelWidth, labelFont, GLOBAL_COLORS.muted);
    globalDrawText(ctx, text, right, top + 16, right - (left + labelWidth + 6), valueFont, color, 'right');
  };
  pair('PROCESSADO DIA', `${globalNumber(item.day)} t`, x + 22, middle - 8, GLOBAL_COLORS.ink);
  pair('PROJEÇÃO', `${globalNumber(item.projection)} t`, middle + 8, x + w - 22, GLOBAL_COLORS.greenText);
}

function globalDrawCardTable(ctx, layout, unit, item, placing) {
  const { x, y, w } = layout;
  const hasRain = placing.hasRain;
  const col = hasRain
    ? { front: x + 22, sector: x + 66, status: x + 114, atr: x + 266, turn: x + 296, accum: x + 324 }
    : { front: x + 22, sector: x + 88, status: x + 156, atr: x + w - 18 };
  const rain = hasRain ? globalFrontRainMap(unit) : null;
  const headerY = y + GLOBAL_CARD.tableHeaderY;
  const titleFont = globalFont(11, 'bold');
  globalDrawText(ctx, 'FRENTE', col.front, headerY, 54, titleFont, GLOBAL_COLORS.muted);
  globalDrawText(ctx, 'SETOR', col.sector, headerY, 50, titleFont, GLOBAL_COLORS.muted);
  globalDrawText(ctx, 'STATUS', col.status, headerY, 80, titleFont, GLOBAL_COLORS.muted);
  globalDrawText(ctx, 'ATR', col.atr, headerY - 6, 40, titleFont, GLOBAL_COLORS.muted, 'right');
  globalDrawText(ctx, 'kg/t', col.atr, headerY + 7, 40, globalFont(9.5, 'normal'), GLOBAL_COLORS.muted, 'right');
  if (hasRain) {
    globalDrawText(ctx, 'CHUVA', (col.turn + col.accum) / 2, headerY - 19, 56, globalFont(10, 'bold'), GLOBAL_COLORS.rain, 'center');
    globalDrawText(ctx, 'TURNO', col.turn, headerY - 6, 25, globalFont(8.5, 'bold'), GLOBAL_COLORS.muted, 'center');
    globalDrawText(ctx, 'mm', col.turn, headerY + 7, 22, globalFont(9, 'normal'), GLOBAL_COLORS.muted, 'center');
    globalDrawText(ctx, 'ACUM.', col.accum, headerY - 6, 25, globalFont(8.5, 'bold'), GLOBAL_COLORS.muted, 'center');
    globalDrawText(ctx, 'mm', col.accum, headerY + 7, 22, globalFont(9, 'normal'), GLOBAL_COLORS.muted, 'center');
  }
  ctx.fillStyle = GLOBAL_COLORS.rule; ctx.fillRect(x + 14, headerY + 15, w - 28, 1);

  const rowFont = globalFont(15, 'bold');
  item.rows.forEach((row, index) => {
    const [front = '', sector = '', , status = ''] = row;
    const style = globalStatusStyle(getFieldStatus(status).color);
    const cy = y + GLOBAL_CARD.firstRow + GLOBAL_CARD.rowStep * index;
    if (style.pill) {
      ctx.fillStyle = GLOBAL_COLORS.yellowSoft;
      ctx.fillRect(x + 10, cy - 10, w - 20, 20);
    }
    ctx.save(); ctx.fillStyle = style.dot;
    ctx.beginPath(); ctx.arc(x + 16, cy, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    globalDrawText(ctx, fieldFrontNumber(front), col.front, cy, 40, rowFont);
    globalDrawText(ctx, sector, col.sector, cy, col.status - col.sector - 6, globalFont(14, 'normal'));
    const statusWidth = (hasRain ? col.atr - 34 : col.atr - 46) - col.status;
    const label = String(getFieldStatus(status).image_status || status);
    if (style.pill) {
      const pillFont = globalFont(10.5, 'bold');
      const pillWidth = Math.min(statusWidth, globalTextWidth(ctx, label, pillFont) + 14);
      fillRoundedRect(ctx, col.status - 2, cy - 8, pillWidth, 16, 8, GLOBAL_COLORS.yellow);
      globalDrawText(ctx, label, col.status + 5, cy + .5, pillWidth - 10, pillFont, GLOBAL_COLORS.ink);
    } else {
      const display = label.charAt(0) + label.slice(1).toLocaleLowerCase('pt-BR');
      globalDrawText(ctx, display, col.status, cy, statusWidth, globalFont(14.5, 'bold'), style.text);
    }
    globalDrawText(ctx, item.frontAtr(row) || '—', col.atr, cy, 52, globalFont(14, 'normal'), GLOBAL_COLORS.ink, 'right');
    if (hasRain) {
      const rainfall = rain.get(canonicalFieldFrontKey(front));
      globalDrawText(ctx, rainfall ? globalRainCell(rainfall.turn) : '—', col.turn, cy, 26, globalFont(13.5, 'bold'), GLOBAL_COLORS.rain, 'center');
      globalDrawText(ctx, rainfall ? globalRainCell(rainfall.accum) : '—', col.accum, cy, 26, globalFont(13.5, 'bold'), GLOBAL_COLORS.rain, 'center');
    }
  });
  if (!item.rows.length) {
    globalDrawText(ctx, 'Aguardando preenchimento do turno', col.front, y + GLOBAL_CARD.firstRow, w - 44, globalFont(13, 'normal'), GLOBAL_COLORS.muted);
  }

  if (hasRain) {
    const barY = y + placing.rainBar;
    fillRoundedRect(ctx, x + 14, barY, w - 28, 28, 8, '#e6f1f7');
    const mean = globalRainMean(unit);
    globalDrawText(ctx, `Média: Turno ${mean.turn} mm | Acum ${mean.accum} mm`, x + 26, barY + 14, w - 150, globalFont(13, 'bold'), GLOBAL_COLORS.rain);
    const startDate = unit.rainStartDate || unit.rain_start_date || unit.rainStart || '';
    if (startDate) globalDrawText(ctx, `acum.: desde ${startDate}`, x + w - 24, barY + 14, 110, globalFont(10, 'normal'), GLOBAL_COLORS.muted, 'right');
  }
}

function globalDrawReceived(ctx, layout, placing) {
  const received = placing.received;
  if (!received) return;
  const { x, y, w } = layout;
  const top = y + received.y;
  fillRoundedRect(ctx, x + 14, top, w - 28, received.height, 8, GLOBAL_COLORS.yellowSoft);
  globalDrawText(ctx, 'ATR RECEBIDO', x + 26, top + 17, 100, globalFont(11, 'bold'), GLOBAL_COLORS.yellowText);
  received.lines.forEach((line, index) =>
    globalDrawText(ctx, line, x + 116, top + 17 + index * 18, w - 140, globalFont(13, 'bold'), GLOBAL_COLORS.ink));
}

function globalDrawCardNotes(ctx, layout, placing) {
  const { x, y, w } = layout;
  let top = y + placing.notesY;
  placing.notes.forEach((block, index) => {
    if (index) { ctx.fillStyle = GLOBAL_COLORS.rule; ctx.fillRect(x + 14, top - 6, w - 28, 1); }
    block.label.forEach((part, line) => globalDrawText(ctx, part, x + 16, top + 6 + line * GLOBAL_CARD.noteLine, 92,
      globalFont(11, 'bold'), block.color));
    block.lines.forEach((line, row) => globalDrawText(ctx, line, x + 106, top + 6 + row * GLOBAL_CARD.noteLine, w - 120,
      globalFont(13, 'normal'), GLOBAL_COLORS.ink));
    top += block.height;
  });
}

function globalDrawCard(ctx, layout, unit, placing, item) {
  globalDrawCardBase(ctx, layout, unit, item);
  globalDrawCardMetrics(ctx, layout, item);
  globalDrawProcessed(ctx, layout, item);
  globalDrawCardTable(ctx, layout, unit, item, placing);
  globalDrawReceived(ctx, layout, placing);
  globalDrawCardNotes(ctx, layout, placing);
}

function globalDrawFooter(ctx, top, generatedAt) {
  const W = GLOBAL_REFERENCE_WIDTH;
  const font = globalFont(11, 'normal');
  globalDrawText(ctx, 'Barra da moagem: verde ≥ 100% · amarelo 90–99% · laranja < 90% da indústria · “—” = sem dado enviado · Total processado dia:',
    18, top + 12, W - 36, font, GLOBAL_COLORS.muted);
  globalDrawText(ctx, 'toneladas moídas no dia até o momento · Projeção de moagem dia: toneladas previstas para o fim do dia (média do dia × 24).',
    18, top + 27, W - 36, font, GLOBAL_COLORS.muted);
  ctx.fillStyle = GLOBAL_COLORS.rule; ctx.fillRect(18, top + 40, W - 36, 1);
  globalDrawText(ctx, 'Segurança sempre · Operação com qualidade · Pessoas que fazem a diferença · Resultados sustentáveis',
    W / 2, top + 58, W - 36, globalFont(13, 'bold'), GLOBAL_COLORS.ink, 'center');
  const prefix = `COA · Safra ${saoPauloDateParts(generatedAt).year} · `;
  const slogan = 'Juntos fazemos mais!';
  const sloganFont = globalFont(13, 'bold');
  const total = globalTextWidth(ctx, prefix, sloganFont) + globalTextWidth(ctx, slogan, sloganFont);
  const start = (W - total) / 2;
  globalDrawText(ctx, prefix, start, top + 78, W, sloganFont, GLOBAL_COLORS.ink);
  globalDrawText(ctx, slogan, start + globalTextWidth(ctx, prefix, sloganFont), top + 78, W, sloganFont, GLOBAL_COLORS.greenText);
}

// sourceUnits: as quatro unidades de /api/units. weighingSummary: resumo da balança do dia
// (opcional; sem ele valem os indicadores digitados).
async function globalGenerateApprovedImage(sourceUnits, weighingSummary = null, generatedAt = new Date()) {
  if (!Array.isArray(sourceUnits) || sourceUnits.length !== 4) {
    throw new Error('A posição global precisa das quatro unidades.');
  }
  const normalized = sourceUnits.map((unit, index) => normalizeReportUnit(unit, index));
  const unitByCode = new Map(normalized.map(unit => [unit.code, unit]));
  const ordered = ['PPT', 'NRD', 'RBR', 'PST'].map((code, index) => unitByCode.get(code) || normalized[index]);
  const data = ordered.map(unit => globalUnitData(unit, weighingSummary));

  const measure = document.createElement('canvas').getContext('2d');
  const cardWidth = (GLOBAL_REFERENCE_WIDTH - 28 - 12) / 2;
  const placements = ordered.map((unit, index) => globalUnitPlacement(measure, unit, data[index], cardWidth));
  const topHeight = Math.max(placements[0].height, placements[1].height);
  const bottomHeight = Math.max(placements[2].height, placements[3].height);
  const bottomY = GLOBAL_CARD_TOP + topHeight + 12;
  const footerY = bottomY + bottomHeight + 8;
  const height = footerY + 92;

  const canvas = document.createElement('canvas');
  canvas.width = GLOBAL_REFERENCE_WIDTH * GLOBAL_REPORT_SCALE;
  canvas.height = Math.round(height * GLOBAL_REPORT_SCALE);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas não suportado neste navegador.');
  ctx.scale(GLOBAL_REPORT_SCALE, GLOBAL_REPORT_SCALE);
  ctx.fillStyle = GLOBAL_COLORS.page;
  ctx.fillRect(0, 0, GLOBAL_REFERENCE_WIDTH, height);

  globalDrawReportHeader(ctx, ordered, generatedAt);
  globalDrawSummary(ctx, ordered, data);
  const layouts = [
    { x: 14, y: GLOBAL_CARD_TOP, w: cardWidth, h: topHeight },
    { x: 26 + cardWidth, y: GLOBAL_CARD_TOP, w: cardWidth, h: topHeight },
    { x: 14, y: bottomY, w: cardWidth, h: bottomHeight },
    { x: 26 + cardWidth, y: bottomY, w: cardWidth, h: bottomHeight }
  ];
  layouts.forEach((layout, index) => globalDrawCard(ctx, layout, ordered[index], placements[index], data[index]));
  globalDrawFooter(ctx, footerY, generatedAt);
  return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob)
    : reject(new Error('Não foi possível gerar a imagem da Posição de Campo.'))), 'image/png'));
}

async function generateReportImageBlob(sourceUnits, weighingSummary = null) {
  return globalGenerateApprovedImage(sourceUnits, weighingSummary);
}
