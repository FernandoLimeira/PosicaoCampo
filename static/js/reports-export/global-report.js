// Emissão global "Troca de Turno CTT" (quatro unidades), fiel ao modelo aprovado:
// cabeçalho, resumo geral (frentes, indústrias, moagem do turno, ATR), moagem do dia
// consolidada e um card por unidade com balança, frentes, ATR recebido e anotações.
// Os números de cada unidade e os totais vêm de core/field-indicators.js (os mesmos do
// relatório gerencial da Posição de Campo).
// Depende de core/format.js, core/common.js, core/field-fronts.js, core/field-indicators.js,
// reports-export/shared-drawing.js e reports-export/field-report-data.js.
const GLOBAL_REPORT_SCALE = 2.5;
const GLOBAL_REFERENCE_WIDTH = 720;
const GLOBAL_HEADER_HEIGHT = 252;
const GLOBAL_LEGEND_Y = 224;
const GLOBAL_CARD_TOP = 470;
// Fontes do modelo aprovado (declaradas em css/base.css, servidas pelo sistema): Montserrat
// nos textos e números; Barlow Condensed no cabeçalho (saudação, título, subtítulo e legenda).
const GLOBAL_FONT = 'Montserrat, Arial, sans-serif';
const GLOBAL_TITLE_FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
const GLOBAL_FONT_FACES = ['500 16px Montserrat', '600 16px Montserrat', '700 16px Montserrat', '800 16px Montserrat',
  '600 16px "Barlow Condensed"', '700 16px "Barlow Condensed"', '800 16px "Barlow Condensed"'];

// Cores extraídas do modelo aprovado (print da "Troca de Turno CTT").
const GLOBAL_COLORS = Object.freeze({
  header: '#305160',
  headerRule: 'rgba(255,255,255,0.16)',
  page: '#edf1f2',
  card: '#ffffff',
  cardBorder: '#dde3e6',
  ink: '#1d2b2c',
  muted: '#606a6b',
  footer: '#7a7f82',
  soft: '#f2f4f5',
  rule: '#e3e7ea',
  green: '#77b82a',
  greenText: '#6b9a34',
  greenBright: '#7ab036',
  yellow: '#fdcc05',
  yellowHeader: '#f7cd21',
  yellowText: '#b48c06',
  yellowSoft: '#fff7d6',
  pill: '#ffd302',
  atrBorder: '#e4c257',
  atrLabel: '#8f772d',
  orange: '#ec7f06',
  orangeText: '#d78225',
  gray: '#b2b2b0',
  white: '#ffffff'
});

// Status da imagem (image_status do catálogo) → cor do ponto, do texto e legenda do modelo.
const GLOBAL_STATUS_STYLE = Object.freeze({
  green: { dot: GLOBAL_COLORS.green, text: GLOBAL_COLORS.greenText, legend: 'Em atividade' },
  yellow: { dot: GLOBAL_COLORS.yellow, text: GLOBAL_COLORS.yellowText, legend: 'Solo úmido / mudança / teste', pill: true },
  red: { dot: GLOBAL_COLORS.orange, text: GLOBAL_COLORS.orangeText, legend: 'Parado / oficina / crítico' },
  gray: { dot: GLOBAL_COLORS.gray, text: GLOBAL_COLORS.muted, legend: 'Aguardando atividade' }
});

function globalStatusStyle(color) {
  return GLOBAL_STATUS_STYLE[color] || GLOBAL_STATUS_STYLE.gray;
}

function globalFont(size, weight = 'bold', family = GLOBAL_FONT) {
  return `${weight} ${size}px ${family}`;
}

function globalTitleFont(size, weight = '800') {
  return globalFont(size, weight, GLOBAL_TITLE_FONT);
}

// O canvas não espera a fonte: carrega as do modelo antes de medir e desenhar.
async function globalLoadFonts() {
  const fonts = typeof document !== 'undefined' ? document.fonts : null;
  if (!fonts?.load) return;
  await Promise.all(GLOBAL_FONT_FACES.map(face => fonts.load(face).catch(() => null)));
}

// Rótulos do modelo (MOAGEM TURNO, FRENTE, OBSERVAÇÃO...): maiúsculas com letras espaçadas.
const GLOBAL_LABEL_SPACING = 0.7;

function globalDrawText(ctx, value, x, y, maxWidth, font, color = GLOBAL_COLORS.ink, align = 'left', spacing = 0) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = font;
  if (spacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  // fillText com largura máxima: não desloca a posição das colunas adjacentes.
  ctx.fillText(String(value ?? ''), x, y, maxWidth);
  ctx.restore();
}

function globalTextWidth(ctx, text, font, spacing = 0) {
  ctx.save(); ctx.font = font;
  if (spacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
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

// Turno operacional do horário de Brasília: A até 07:20, B até 15:40, C depois.
function globalShiftAt(date = new Date()) {
  const { hour, minute } = saoPauloDateParts(date);
  const minutes = hour * 60 + minute;
  return minutes < 440 ? 'A' : minutes < 940 ? 'B' : 'C';
}

// ---------------------------------------------------------------------------
// Cabeçalho
// ---------------------------------------------------------------------------
function globalDrawReportHeader(ctx, units, generatedAt) {
  const W = GLOBAL_REFERENCE_WIDTH;
  ctx.fillStyle = GLOBAL_COLORS.header;
  ctx.fillRect(0, 0, W, GLOBAL_HEADER_HEIGHT);

  const { greeting, date } = getHeaderDataForExport(generatedAt);
  const topFont = globalTitleFont(24);
  let x = 26;
  globalDrawText(ctx, greeting, x, 34, 150, topFont, GLOBAL_COLORS.white);
  x += Math.min(150, globalTextWidth(ctx, greeting, topFont)) + 16;
  ctx.fillStyle = GLOBAL_COLORS.headerRule; ctx.fillRect(x, 20, 1.5, 28);
  x += 16;
  // Ícone de calendário.
  ctx.save();
  ctx.strokeStyle = GLOBAL_COLORS.yellowHeader; ctx.fillStyle = GLOBAL_COLORS.yellowHeader; ctx.lineWidth = 1.8;
  roundedRectPath(ctx, x, 25, 17, 16, 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x + 17, 30); ctx.stroke();
  ctx.fillRect(x + 4, 21, 1.8, 6); ctx.fillRect(x + 11, 21, 1.8, 6);
  ctx.restore();
  x += 26;
  globalDrawText(ctx, date, x, 34, 130, topFont, GLOBAL_COLORS.white);
  x += Math.min(130, globalTextWidth(ctx, date, topFont)) + 16;
  ctx.fillStyle = GLOBAL_COLORS.headerRule; ctx.fillRect(x, 20, 1.5, 28);
  x += 16;
  globalDrawText(ctx, `TURNO ${globalShiftAt(generatedAt)}`, x, 34, 110, topFont, GLOBAL_COLORS.yellowHeader);
  ctx.fillStyle = GLOBAL_COLORS.headerRule; ctx.fillRect(0, 66, W, 1);

  globalDrawText(ctx, 'TROCA DE TURNO', 26, 106, W - 52, globalTitleFont(50), GLOBAL_COLORS.white);
  globalDrawText(ctx, 'CTT', 26, 152, 200, globalTitleFont(50), GLOBAL_COLORS.green);
  globalDrawText(ctx, 'Colheita: frentes, indústria, moagem, entrega, estoque e ATR', 26, 192, W - 52,
    globalTitleFont(17, '600'), GLOBAL_COLORS.white);

  // Legenda só com os status usados em alguma frente das quatro unidades
  // (ex.: "Solo úmido" só aparece se alguma frente estiver em solo úmido).
  const used = new Set(units.flatMap(unit => fieldFilledRows(unit).map(row => getFieldStatus(row[3]).color)));
  const legendFont = globalTitleFont(14.5, '600');
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
    globalDrawText(ctx, text, x, y, width - 28, globalFont(10.5, '700'), color, 'left', GLOBAL_LABEL_SPACING);

  // 1. Frentes em atividade (verde).
  const totals = fieldIndicatorTotals(data);
  const totalFronts = totals.fronts;
  const activeFronts = totals.active;
  let x = card(0, GLOBAL_COLORS.green);
  label('FRENTES EM', x, top + 20, GLOBAL_COLORS.white);
  label('ATIVIDADE', x, top + 35, GLOBAL_COLORS.white);
  const bigFont = globalFont(30, '800');
  globalDrawText(ctx, String(activeFronts), x, top + 64, 60, bigFont, GLOBAL_COLORS.white);
  globalDrawText(ctx, `de ${totalFronts}`, x + Math.min(60, globalTextWidth(ctx, activeFronts, bigFont)) + 6, top + 67, 70,
    globalFont(17, 'bold'), GLOBAL_COLORS.white);
  globalDrawText(ctx, `${units.length} unidades`, x, top + 89, width - 28, globalFont(12, '500'), GLOBAL_COLORS.white);

  // 2. Indústrias em operação (Indústria digitada maior que zero).
  const running = totals.running;
  x = card(1, GLOBAL_COLORS.card);
  label('INDÚSTRIAS', x, top + 20);
  globalDrawText(ctx, String(running), x, top + 52, 50, bigFont);
  globalDrawText(ctx, `de ${units.length}`, x + Math.min(50, globalTextWidth(ctx, running, bigFont)) + 6, top + 55, 60, globalFont(17, 'bold'));
  const stopped = units.length - running;
  globalDrawText(ctx, stopped ? `${stopped} ${stopped === 1 ? 'parada' : 'paradas'}` : 'todas em operação', x, top + 84,
    width - 28, globalFont(12, '500'), stopped ? GLOBAL_COLORS.orangeText : GLOBAL_COLORS.muted);

  // 3. Moagem do turno somada (com entrega e estoque).
  const { milling, delivery, stock } = totals;
  x = card(2, GLOBAL_COLORS.card);
  label('MOAGEM TURNO', x, top + 20);
  const millingText = fieldIndicatorNumber(milling);
  globalDrawText(ctx, millingText, x, top + 50, width - 60, bigFont);
  globalDrawText(ctx, 't/h', x + Math.min(width - 60, globalTextWidth(ctx, millingText, bigFont)) + 5, top + 54, 30, globalFont(15, 'bold'));
  globalDrawText(ctx, `entrega ${fieldIndicatorNumber(delivery)} t/h`, x, top + 77, width - 28, globalFont(11.5, '500'), GLOBAL_COLORS.muted);
  globalDrawText(ctx, `estoque ${fieldIndicatorNumber(stock)} cargas`, x, top + 93, width - 28, globalFont(11.5, '500'), GLOBAL_COLORS.muted);

  // 4. ATR médio geral: ATR das unidades ponderado pela moagem do dia de cada uma.
  const atr = totals.atr;
  x = card(3, GLOBAL_COLORS.card, GLOBAL_COLORS.atrBorder);
  label('ATR MÉDIO GERAL', x, top + 20, GLOBAL_COLORS.atrLabel);
  const atrText = fieldIndicatorNumber(atr, 2);
  globalDrawText(ctx, atrText, x, top + 50, width - 64, bigFont);
  globalDrawText(ctx, 'kg/t', x + Math.min(width - 64, globalTextWidth(ctx, atrText, bigFont)) + 5, top + 54, 34, globalFont(15, 'bold'));
  const atrNote = totals.atrWeighted ? 'média ponderada pela moagem' : totals.atrWithoutMilling ? 'sem moagem para ponderar' : 'sem ATR informado';
  globalDrawText(ctx, atrNote, x, top + 82,
    width - 28, globalFont(12, '500'), GLOBAL_COLORS.muted);

  // Moagem do dia consolidada: total processado e projeção (média do dia × 24) por unidade.
  const rowTop = top + height + 10;
  const rowHeight = 84;
  fillRoundedRect(ctx, 14, rowTop, GLOBAL_REFERENCE_WIDTH - 28, rowHeight, 10, GLOBAL_COLORS.card);
  strokeRoundedRect(ctx, 14.5, rowTop + .5, GLOBAL_REFERENCE_WIDTH - 29, rowHeight - 1, 10, GLOBAL_COLORS.cardBorder, 1);
  fillRoundedRect(ctx, 14, rowTop, 5, rowHeight, 2.5, GLOBAL_COLORS.green);
  globalDrawText(ctx, 'MOAGEM DO DIA · CONSOLIDADO', 32, rowTop + 18, 300, globalFont(10.5, '700'), GLOBAL_COLORS.muted, 'left', GLOBAL_LABEL_SPACING);
  const { day, projection } = totals;
  const valueFont = globalFont(30, '800');
  globalDrawText(ctx, 'Total processado dia', 32, rowTop + 38, 140, globalFont(12, '500'), GLOBAL_COLORS.muted);
  const dayText = fieldIndicatorNumber(day);
  globalDrawText(ctx, dayText, 32, rowTop + 64, 120, valueFont);
  globalDrawText(ctx, 't', 32 + Math.min(120, globalTextWidth(ctx, dayText, valueFont)) + 4, rowTop + 69, 14, globalFont(15, 'bold'));
  ctx.fillStyle = GLOBAL_COLORS.rule; ctx.fillRect(176, rowTop + 32, 1, 44);
  globalDrawText(ctx, 'Projeção de moagem dia', 190, rowTop + 38, 160, globalFont(12, '500'), GLOBAL_COLORS.muted);
  const projectionText = fieldIndicatorNumber(projection);
  globalDrawText(ctx, projectionText, 190, rowTop + 64, 120, valueFont, GLOBAL_COLORS.greenBright);
  if (projection !== null) {
    globalDrawText(ctx, 't', 190 + Math.min(120, globalTextWidth(ctx, projectionText, valueFont)) + 4, rowTop + 69, 14,
      globalFont(15, 'bold'), GLOBAL_COLORS.greenBright);
  }
  const unitsLeft = 352;
  const unitWidth = (GLOBAL_REFERENCE_WIDTH - 14 - 8 - unitsLeft) / 4;
  units.forEach((unit, index) => {
    const ux = unitsLeft + index * unitWidth;
    fillRoundedRect(ctx, ux, rowTop + 8, unitWidth - 6, rowHeight - 16, 7, GLOBAL_COLORS.soft);
    globalDrawText(ctx, unit.code, ux + 9, rowTop + 22, unitWidth - 24, globalFont(13, 'bold'));
    globalDrawText(ctx, fieldIndicatorNumber(data[index].day), ux + 9, rowTop + 44, unitWidth - 24, globalFont(20, '800'));
    const unitProjection = data[index].projectionStopped ? 'Parada' : `proj. ${fieldIndicatorNumber(data[index].projection)}`;
    globalDrawText(ctx, unitProjection, ux + 9, rowTop + 64, unitWidth - 24,
      globalFont(12, 'bold'), GLOBAL_COLORS.greenBright);
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

// Observação, mudanças e apoio: rótulo à esquerda, texto quebrado à direita.
function globalNoteBlocks(ctx, unit, item, width) {
  const textWidth = width - 120;
  const font = globalFont(13, '500');
  const lines = (value, empty) => {
    const text = String(value ?? '').trim();
    const content = !text || text === '-' ? empty : text.split(/\r?\n/).map(line => line.trim().replace(/^[•*-]\s*/, '')).filter(Boolean).join('\n');
    return globalWrap(ctx, content, textWidth, font);
  };
  const blocks = [{ label: ['OBSERVAÇÃO'], color: GLOBAL_COLORS.orangeText, lines: lines(unit.observation, 'Sem observação.') }];
  // Apoio entre unidades: só o texto digitado no Preencher (etapa Imagem CTT), como o modelo.
  // A troca de cana da balança aparece só no "ATR recebido"; sem texto, o bloco não sai.
  const support = String(unit.support ?? '').trim();
  if (support && support !== '-') {
    blocks.push({ label: ['APOIO ENTRE', 'UNIDADES'], color: GLOBAL_COLORS.greenText, lines: lines(support, '') });
  }
  blocks.push({ label: ['MUDANÇAS'], color: GLOBAL_COLORS.ink, lines: lines(unit.changes, 'Sem mudança prevista.') });
  return blocks.map(block => ({ ...block, height: Math.max(block.lines.length, block.label.length) * GLOBAL_CARD.noteLine + 14 }));
}

// "ATR RECEBIDO" como o modelo: frente em preto e ATR em dourado, separados por " · "; a 1ª
// linha começa depois do rótulo e as seguintes voltam para a margem do quadro.
const GLOBAL_RECEIVED_LABEL = 'ATR RECEBIDO';
const GLOBAL_RECEIVED_LABEL_FONT = '700 10px ' + GLOBAL_FONT;
const GLOBAL_RECEIVED_FONT = '700 12.5px ' + GLOBAL_FONT;

function globalReceivedLines(ctx, item, width) {
  if (!item.received.length) return [];
  const words = [];
  item.received.forEach((front, index) => {
    if (index) words.push({ text: '·', color: GLOBAL_COLORS.muted });
    `FT${fieldFrontNumber(front.front)} (${front.home_unit})`.split(' ').forEach(text => words.push({ text, color: GLOBAL_COLORS.ink }));
    words.push({ text: front.atr != null ? fieldIndicatorNumber(front.atr, 2) : '—', color: GLOBAL_COLORS.yellowText });
  });
  const space = globalTextWidth(ctx, ' ', GLOBAL_RECEIVED_FONT);
  const labelEnd = globalTextWidth(ctx, GLOBAL_RECEIVED_LABEL, GLOBAL_RECEIVED_LABEL_FONT, GLOBAL_LABEL_SPACING) + 8;
  const right = width - 52;  // relativo à margem do texto (x + 26), até a margem direita do quadro
  const lines = [[]];
  let cursor = labelEnd;
  words.forEach(word => {
    const wordWidth = globalTextWidth(ctx, word.text, GLOBAL_RECEIVED_FONT);
    const line = lines[lines.length - 1];
    if (line.length && cursor + wordWidth > right) {
      lines.push([]);
      cursor = 0;
    }
    lines[lines.length - 1].push({ ...word, x: cursor });
    cursor += wordWidth + space;
  });
  return lines;
}

function globalUnitPlacement(ctx, unit, item, width) {
  const rows = Math.max(1, item.rows.length);
  const rowsEnd = GLOBAL_CARD.firstRow + (rows - 1) * GLOBAL_CARD.rowStep;
  let cursor = rowsEnd + 18;
  const receivedLines = globalReceivedLines(ctx, item, width);
  const received = receivedLines.length ? { y: cursor, height: 16 + receivedLines.length * 18, lines: receivedLines } : null;
  if (received) cursor += received.height + 12;
  const notes = globalNoteBlocks(ctx, unit, item, width);
  const notesY = cursor;
  cursor += notes.reduce((sum, block) => sum + block.height, 0);
  return { rowsEnd, received, notes, notesY, height: Math.ceil(cursor + 10) };
}

function globalDrawCardBase(ctx, layout, unit, item) {
  const { x, y, w, h } = layout;
  fillRoundedRect(ctx, x, y, w, h, 12, GLOBAL_COLORS.card);
  strokeRoundedRect(ctx, x + .5, y + .5, w - 1, h - 1, 12, GLOBAL_COLORS.cardBorder, 1);
  globalDrawText(ctx, unit.code, x + 16, y + 30, 120, globalFont(32, '800'));
  const name = String(unit.name || '').toLocaleLowerCase('pt-BR').replace(/(^|\s)\p{L}/gu, char => char.toUpperCase());
  globalDrawText(ctx, name, x + 16, y + 56, w / 2 - 20, globalFont(14, '500'), GLOBAL_COLORS.muted);
  const allActive = item.rows.length > 0 && item.active === item.rows.length;
  globalDrawText(ctx, `${item.active}/${item.rows.length}`, x + w - 16, y + 30, 90, globalFont(28, '800'),
    allActive ? GLOBAL_COLORS.green : GLOBAL_COLORS.yellowText, 'right');
  globalDrawText(ctx, 'frentes em atividade', x + w - 16, y + 56, w / 2 - 20, globalFont(13, '500'), GLOBAL_COLORS.muted, 'right');
  ctx.fillStyle = GLOBAL_COLORS.rule; ctx.fillRect(x + 14, y + 68, w - 28, 1);
}

// Barra da moagem (fieldIndustryShare): verde ≥ 100%, amarelo 90–99%, laranja < 90%.
function globalIndustryShare(item) {
  const share = fieldIndustryShare(item);
  if (!share) return null;
  const colors = { good: [GLOBAL_COLORS.green, GLOBAL_COLORS.greenText], warning: [GLOBAL_COLORS.yellow, GLOBAL_COLORS.yellowText],
    low: [GLOBAL_COLORS.orange, GLOBAL_COLORS.orangeText] }[share.level];
  return { ...share, color: colors[0], text: colors[1] };
}

function globalDrawCardMetrics(ctx, layout, item) {
  const { x, y, w } = layout;
  const top = y + GLOBAL_CARD.metricsY;
  const widths = [.26, .26, .22, .26].map(part => (w - 28) * part);
  const columns = widths.map((_, index) => x + 14 + widths.slice(0, index).reduce((sum, value) => sum + value, 0));
  const labelFont = globalFont(9.5, '700');
  const valueFont = globalFont(21, '800');
  const unitFont = globalFont(9.5, '600');
  // Valor e unidade dentro da própria coluna (a unidade nunca invade a coluna seguinte).
  const value = (index, number, unitLabel, digits = 0) => {
    const text = fieldIndicatorNumber(number, digits);
    const unitWidth = text === '—' ? 0 : globalTextWidth(ctx, unitLabel, unitFont) + 3;
    const valueWidth = Math.min(widths[index] - 8 - unitWidth, globalTextWidth(ctx, text, valueFont));
    globalDrawText(ctx, text, columns[index], top + 22, valueWidth, valueFont);
    if (unitWidth) globalDrawText(ctx, unitLabel, columns[index] + valueWidth + 3, top + 25, unitWidth, unitFont, GLOBAL_COLORS.muted);
  };
  const small = (index, text, row, color = GLOBAL_COLORS.muted) =>
    globalDrawText(ctx, text, columns[index], top + row, widths[index] - 6, globalFont(10.5, '500'), color);
  ['MOAGEM TURNO', 'ENTREGA TURNO', 'ESTOQUE', 'ATR PARCIAL'].forEach((label, index) =>
    globalDrawText(ctx, label, columns[index], top + 2, widths[index] - 4, labelFont, GLOBAL_COLORS.muted, 'left', .5));

  value(0, item.millingShift, 't/h');
  const share = globalIndustryShare(item);
  const barWidth = widths[0] - 16;
  fillRoundedRect(ctx, columns[0], top + 38, barWidth, 4, 2, GLOBAL_COLORS.rule);
  if (share) {
    fillRoundedRect(ctx, columns[0], top + 38, barWidth * Math.min(1, share.share), 4, 2, share.color);
    small(0, `${share.percent}% da ind. ${fieldIndicatorNumber(item.industry)}`, 50, share.text);
  } else {
    small(0, item.industry > 0 ? `ind. ${fieldIndicatorNumber(item.industry)}` : 'indústria —', 50);
  }
  small(0, `últ. 3 h · ${fieldIndicatorNumber(item.milling3h)}`, 63);

  value(1, item.deliveryShift, 't/h');
  small(1, `últ. 3 h · ${fieldIndicatorNumber(item.delivery3h)}`, 50);

  value(2, item.stock, 'cargas');
  value(3, item.atr, 'kg/t', 2);
}

function globalDrawProcessed(ctx, layout, item) {
  const { x, y, w } = layout;
  const top = y + GLOBAL_CARD.processedY;
  const gap = 6;
  const leftWidth = Math.round((w - 28 - gap) * .56);
  const boxes = [[x + 14, leftWidth], [x + 14 + leftWidth + gap, w - 28 - gap - leftWidth]];
  boxes.forEach(([left, width]) => fillRoundedRect(ctx, left, top, width, 32, 8, GLOBAL_COLORS.soft));
  // Rótulo à esquerda e valor à direita de cada quadro, sem sobreposição; "t" menor.
  const labelFont = globalFont(9.5, '700');
  const valueFont = globalFont(17, '800');
  const unitFont = globalFont(10, '700');
  const pair = ([left, width], label, number, color) => {
    const labelWidth = Math.min(width * .55, globalTextWidth(ctx, label, labelFont, GLOBAL_LABEL_SPACING));
    globalDrawText(ctx, label, left + 10, top + 17, labelWidth, labelFont, GLOBAL_COLORS.muted, 'left', GLOBAL_LABEL_SPACING);
    const right = left + width - 9;
    const unitWidth = globalTextWidth(ctx, 't', unitFont);
    const room = right - unitWidth - 3 - (left + 10 + labelWidth + 6);
    globalDrawText(ctx, 't', right, top + 19, unitWidth, unitFont, color, 'right');
    globalDrawText(ctx, number, right - unitWidth - 3, top + 16, room, valueFont, color, 'right');
  };
  pair(boxes[0], 'PROCESSADO DIA', fieldIndicatorNumber(item.day), GLOBAL_COLORS.ink);
  if (item.projectionStopped) {
    const [left, width] = boxes[1];
    globalDrawText(ctx, 'Unidade parada', left + 10, top + 17, width - 20, labelFont, GLOBAL_COLORS.muted);
  } else {
    pair(boxes[1], 'PROJEÇÃO', fieldIndicatorNumber(item.projection), GLOBAL_COLORS.greenBright);
  }
}

function globalDrawCardTable(ctx, layout, unit, item) {
  const { x, y, w } = layout;
  const col = { front: x + 30, sector: x + 96, status: x + 160, atr: x + w - 18 };
  const size = { title: 10, spacing: GLOBAL_LABEL_SPACING, front: 14, sector: 13.5, status: 13.5, atr: 13.5, gap: 46 };
  const headerY = y + GLOBAL_CARD.tableHeaderY;
  const titleFont = globalFont(size.title, '700');
  globalDrawText(ctx, 'FRENTE', col.front, headerY, col.sector - col.front - 4, titleFont, GLOBAL_COLORS.muted, 'left', size.spacing);
  globalDrawText(ctx, 'SETOR', col.sector, headerY, col.status - col.sector - 4, titleFont, GLOBAL_COLORS.muted, 'left', size.spacing);
  globalDrawText(ctx, 'STATUS', col.status, headerY, 80, titleFont, GLOBAL_COLORS.muted, 'left', size.spacing);
  globalDrawText(ctx, 'ATR', col.atr, headerY - 6, 40, titleFont, GLOBAL_COLORS.muted, 'right');
  globalDrawText(ctx, 'kg/t', col.atr, headerY + 7, 40, globalFont(9.5, '500'), GLOBAL_COLORS.muted, 'right');
  ctx.fillStyle = GLOBAL_COLORS.rule; ctx.fillRect(x + 14, headerY + 15, w - 28, 1);

  const rowFont = globalFont(size.front, '700');
  item.rows.forEach((row, index) => {
    const [front = '', sector = '', , status = ''] = row;
    const style = globalStatusStyle(getFieldStatus(status).color);
    const cy = y + GLOBAL_CARD.firstRow + GLOBAL_CARD.rowStep * index;
    if (style.pill) {
      ctx.fillStyle = GLOBAL_COLORS.yellowSoft;
      ctx.fillRect(x + 10, cy - 10, w - 20, 20);
    }
    ctx.save(); ctx.fillStyle = style.dot;
    ctx.beginPath(); ctx.arc(col.front - 11, cy, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    globalDrawText(ctx, fieldFrontNumber(front), col.front, cy, col.sector - col.front - 4, rowFont);
    globalDrawText(ctx, sector, col.sector, cy, col.status - col.sector - 6, globalFont(size.sector, '500'));
    const statusWidth = col.atr - size.gap - col.status;
    const label = String(getFieldStatus(status).image_status || status);
    if (style.pill) {
      const pillFont = globalFont(10.5, 'bold');
      const pillWidth = Math.min(statusWidth, globalTextWidth(ctx, label, pillFont) + 14);
      fillRoundedRect(ctx, col.status - 2, cy - 8, pillWidth, 16, 8, GLOBAL_COLORS.pill);
      globalDrawText(ctx, label, col.status + 5, cy + .5, pillWidth - 10, pillFont, GLOBAL_COLORS.ink);
    } else {
      const display = label.charAt(0) + label.slice(1).toLocaleLowerCase('pt-BR');
      globalDrawText(ctx, display, col.status, cy, statusWidth, globalFont(size.status, '700'), style.text);
    }
    globalDrawText(ctx, item.frontAtr(row) || '—', col.atr, cy, size.gap - 4, globalFont(size.atr, '500'), GLOBAL_COLORS.ink, 'right');
  });
  if (!item.rows.length) {
    globalDrawText(ctx, 'Aguardando preenchimento do turno', col.front, y + GLOBAL_CARD.firstRow, w - 44, globalFont(13, '500'), GLOBAL_COLORS.muted);
  }
}

function globalDrawReceived(ctx, layout, placing) {
  const received = placing.received;
  if (!received) return;
  const { x, y, w } = layout;
  const top = y + received.y;
  fillRoundedRect(ctx, x + 14, top, w - 28, received.height, 8, GLOBAL_COLORS.yellowSoft);
  globalDrawText(ctx, GLOBAL_RECEIVED_LABEL, x + 26, top + 17, 110, GLOBAL_RECEIVED_LABEL_FONT, GLOBAL_COLORS.yellowText, 'left', GLOBAL_LABEL_SPACING);
  received.lines.forEach((line, index) => line.forEach(word =>
    globalDrawText(ctx, word.text, x + 26 + word.x, top + 17 + index * 18, w - 52 - word.x, GLOBAL_RECEIVED_FONT, word.color)));
}

function globalDrawCardNotes(ctx, layout, placing) {
  const { x, y, w } = layout;
  let top = y + placing.notesY;
  placing.notes.forEach((block, index) => {
    if (index) { ctx.fillStyle = GLOBAL_COLORS.rule; ctx.fillRect(x + 14, top - 6, w - 28, 1); }
    block.label.forEach((part, line) => globalDrawText(ctx, part, x + 16, top + 6 + line * GLOBAL_CARD.noteLine, 92,
      globalFont(10, '700'), block.color, 'left', GLOBAL_LABEL_SPACING));
    block.lines.forEach((line, row) => globalDrawText(ctx, line, x + 106, top + 6 + row * GLOBAL_CARD.noteLine, w - 120,
      globalFont(13, '500'), GLOBAL_COLORS.ink));
    top += block.height;
  });
}

function globalDrawCard(ctx, layout, unit, placing, item) {
  globalDrawCardBase(ctx, layout, unit, item);
  globalDrawCardMetrics(ctx, layout, item);
  globalDrawProcessed(ctx, layout, item);
  globalDrawCardTable(ctx, layout, unit, item);
  globalDrawReceived(ctx, layout, placing);
  globalDrawCardNotes(ctx, layout, placing);
}

function globalDrawFooter(ctx, top, generatedAt) {
  const W = GLOBAL_REFERENCE_WIDTH;
  const font = globalFont(11, '500');
  globalDrawText(ctx, 'Barra da moagem: verde ≥ 100% · amarelo 90–99% · laranja < 90% da indústria · “—” = sem dado enviado · Total processado dia:',
    18, top + 12, W - 36, font, GLOBAL_COLORS.footer);
  globalDrawText(ctx, 'toneladas moídas no dia até o momento · Projeção de moagem dia: toneladas previstas para o fim do dia.',
    18, top + 27, W - 36, font, GLOBAL_COLORS.footer);
  ctx.fillStyle = GLOBAL_COLORS.rule; ctx.fillRect(18, top + 40, W - 36, 1);
  globalDrawText(ctx, 'Segurança sempre · Operação com qualidade · Pessoas que fazem a diferença · Resultados sustentáveis',
    W / 2, top + 58, W - 36, globalFont(12.5, '600'), GLOBAL_COLORS.ink, 'center');
  const prefix = `COA · Safra ${saoPauloDateParts(generatedAt).year} · `;
  const slogan = 'Juntos fazemos mais!';
  const sloganFont = globalFont(12.5, '600');
  const total = globalTextWidth(ctx, prefix, sloganFont) + globalTextWidth(ctx, slogan, sloganFont);
  const start = (W - total) / 2;
  globalDrawText(ctx, prefix, start, top + 78, W, sloganFont, GLOBAL_COLORS.ink);
  globalDrawText(ctx, slogan, start + globalTextWidth(ctx, prefix, sloganFont), top + 78, W, sloganFont, GLOBAL_COLORS.greenBright);
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
  const data = ordered.map(unit => fieldUnitIndicators(unit, weighingSummary));

  await globalLoadFonts();
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
