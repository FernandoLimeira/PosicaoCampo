// Relatório visual da Produção Agrícola, no formato da troca de turno.
const PRODUCTION_EXPORT_WIDTH = 1080;
const PRODUCTION_EXPORT_PIXEL_WIDTH = 4096;
const PRODUCTION_EXPORT_SCALE = PRODUCTION_EXPORT_PIXEL_WIDTH / PRODUCTION_EXPORT_WIDTH;
const PRODUCTION_EXPORT_MAX_PIXEL_HEIGHT = 12000;
const PRODUCTION_EXPORT_UNITS = ['PPT', 'NRD', 'RBR', 'PST'];
const PRODUCTION_EXPORT_PAGE_LIMIT = 48;
const PRODUCTION_EXPORT_UNIT_NAMES = {
  PPT: 'PARAGUAÇU PAULISTA', NRD: 'NARANDIBA',
  RBR: 'RIO BRILHANTE', PST: 'PASSA TEMPO'
};
const PRODUCTION_EXPORT_COLORS = {
  active: '#76b82a', wet: '#ffcc00', waiting: '#b2b2b2', stopped: '#ef7d1a'
};
// As etiquetas usam um leve preenchimento, contorno contínuo e ponto sólido,
// independentemente de o lançamento ser do dia ou estar pendente.
const PRODUCTION_EXPORT_PILL_BACKGROUNDS = {
  active: 'rgba(118, 184, 42, 0.14)',
  wet: 'rgba(255, 204, 0, 0.16)',
  waiting: 'rgba(178, 178, 178, 0.16)',
  stopped: 'rgba(239, 125, 26, 0.14)'
};
const PRODUCTION_EXPORT_PILL_BORDERS = {
  active: '#76b82a', wet: '#e6b800', waiting: '#a9b0b3', stopped: '#ef7d1a'
};
// Resumo de status de cada cartão (ex.: "16 em atividade · 1 parado / oficina").
const PRODUCTION_EXPORT_STATE_LABELS = {
  active: 'em atividade', wet: 'solo úmido / mudança',
  waiting: 'aguardando', stopped: 'parado / oficina'
};
const PRODUCTION_EXPORT_HEADER = '#33495a';
const PRODUCTION_EXPORT_BODY = '#eef1f2';
const PRODUCTION_EXPORT_CARD = '#ffffff';
const PRODUCTION_EXPORT_TEXT = '#1f2f38';
const PRODUCTION_EXPORT_MUTED = '#5d6d75';
const PRODUCTION_EXPORT_ACCENT = '#ef7d1a';
const PRODUCTION_EXPORT_RULE = '#e1e6e8';
const PRODUCTION_EXPORT_FONT = '"Roboto Condensed", "Arial Narrow", Arial, sans-serif';
const PRODUCTION_EXPORT_TITLE_FONT = 'Bahnschrift, "Arial Narrow", sans-serif';
const PRODUCTION_EXPORT_PILL_FONT = `bold 15px ${PRODUCTION_EXPORT_FONT}`;
const PRODUCTION_EXPORT_PILL_NOTE_FONT = `12px ${PRODUCTION_EXPORT_FONT}`;

function buildProductionExportPages(reports, limit = PRODUCTION_EXPORT_PAGE_LIMIT) {
  const byCode = new Map(reports.map(report => [report.code, report]));
  const ordered = PRODUCTION_EXPORT_UNITS.map(code => byCode.get(code) || { code, restricted: true, items: [] });
  const pages = Math.max(1, ...ordered.map(report => Math.ceil((report.items?.length || 0) / limit)));
  return Array.from({ length: pages }, (_, index) => ordered.map(report => ({
    code: report.code,
    restricted: Boolean(report.restricted),
    summary: index === 0 || !report.summary ? report.summary || null
      : { ...report.summary, changes: '' },
    items: (report.items || []).slice(index * limit, (index + 1) * limit)
  })));
}

function productionExportText(ctx, value, x, y, width, font, color = PRODUCTION_EXPORT_TEXT) {
  ctx.font = font;
  ctx.fillStyle = color;
  // A compressão horizontal do Canvas preserva os valores completos em vez de
  // trocar números, nomes ou títulos por reticências na imagem exportada.
  ctx.fillText(String(value ?? '').trim(), x, y, width);
}

function productionExportMeasure(ctx, value, font) {
  ctx.font = font;
  return ctx.measureText(String(value ?? '')).width;
}

function productionExportRoundRect(ctx, x, y, width, height, radius, color, stroke = false, lineWidth = 2) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  if (stroke) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function productionExportRule(ctx, x1, y, x2, color = PRODUCTION_EXPORT_RULE) {
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function productionExportGrass(ctx, x, y) {
  ctx.strokeStyle = PRODUCTION_EXPORT_COLORS.active;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  [[0, 0, 13, 31], [17, -5, 16, 31], [32, 4, 20, 31]].forEach(points => {
    ctx.beginPath();
    ctx.moveTo(x + points[0], y + points[1]);
    ctx.quadraticCurveTo(x + points[2], y + 8, x + points[3], y + 31);
    ctx.stroke();
  });
}

function productionExportGroupIcon(ctx, x, y, name) {
  productionExportRoundRect(ctx, x, y, 24, 24, 5, PRODUCTION_EXPORT_HEADER);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  const group = name.toLocaleLowerCase('pt-BR');
  if (group.includes('fertirrig')) {
    ctx.beginPath();
    ctx.moveTo(x + 12, y + 4);
    ctx.quadraticCurveTo(x + 4, y + 13, x + 8, y + 18);
    ctx.quadraticCurveTo(x + 12, y + 23, x + 16, y + 18);
    ctx.quadraticCurveTo(x + 20, y + 13, x + 12, y + 4);
    ctx.stroke();
  } else if (group.includes('trato')) {
    ctx.beginPath();
    ctx.ellipse(x + 12, y + 12, 8, 5, -.65, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 17);
    ctx.lineTo(x + 17, y + 7);
    ctx.stroke();
  } else {
    [0, 1, 2].forEach(index => {
      ctx.beginPath();
      ctx.moveTo(x + 6, y + 7 + index * 5);
      ctx.lineTo(x + 10, y + 7 + index * 5);
      ctx.lineTo(x + 12, y + 5 + index * 5);
      ctx.lineTo(x + 14, y + 7 + index * 5);
      ctx.lineTo(x + 18, y + 7 + index * 5);
      ctx.stroke();
    });
  }
}

function productionExportCalendar(ctx, x, y) {
  ctx.strokeStyle = PRODUCTION_EXPORT_COLORS.wet;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x, y + 4, 24, 23);
  productionExportRule(ctx, x, y + 11, x + 24, PRODUCTION_EXPORT_COLORS.wet);
  [x + 6, x + 17].forEach(day => {
    ctx.beginPath(); ctx.moveTo(day, y); ctx.lineTo(day, y + 8); ctx.stroke();
  });
  ctx.fillStyle = PRODUCTION_EXPORT_COLORS.wet;
  [[x + 6, y + 16], [x + 15, y + 16], [x + 6, y + 22], [x + 15, y + 22]].forEach(([dotX, dotY]) => {
    ctx.fillRect(dotX, dotY, 3, 3);
  });
}

function productionExportCloud(ctx, x, y) {
  ctx.fillStyle = '#9aa6ab';
  [[x + 7, y + 9, 6], [x + 14, y + 5, 7], [x + 21, y + 9, 6]].forEach(([cx, cy, r]) => {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillRect(x + 7, y + 9, 14, 6);
  ctx.strokeStyle = '#9aa6ab';
  ctx.lineWidth = 1.5;
  [x + 9, x + 15, x + 21].forEach(dropX => {
    ctx.beginPath(); ctx.moveTo(dropX, y + 18); ctx.lineTo(dropX - 2, y + 22); ctx.stroke();
  });
}

// Turnos de campo (horário de Brasília): A até 07:20, B até 15:40, C no restante.
function productionExportShift(parts = saoPauloDateParts()) {
  const minutes = parts.hour * 60 + parts.minute;
  return minutes < 440 ? 'A' : minutes < 940 ? 'B' : 'C';
}

function productionExportStatus(item, statusByCode) {
  const status = statusByCode.get(item.entry?.status);
  return status?.style_key in PRODUCTION_EXPORT_COLORS ? status.style_key : 'waiting';
}

// A borda do cartão destaca a pior situação presente na unidade: qualquer
// frente parada deixa o cartão laranja, mesmo com a maioria em atividade.
function productionExportBorderState(counts) {
  for (const state of ['stopped', 'wet', 'active', 'waiting']) {
    if (counts[state]) return state;
  }
  return 'waiting';
}

function productionExportRainText(summary) {
  const turn = summary?.rain_turn_mm;
  const accumulated = summary?.rain_accumulated_mm;
  // Regra de negócio: o quadro de chuva só aparece quando há volume lançado.
  const hasRain = [turn, accumulated].some(value => {
    const number = parseBrNumber(value);
    return Number.isFinite(number) && number > 0;
  });
  if (!hasRain) return '';
  const format = value => value == null ? '—' : String(value).replace('.', ',');
  return `Chuva: turno ${format(turn)} mm | acumulado ${format(accumulated)} mm`;
}

function productionExportWrap(ctx, text, width, font) {
  ctx.font = font;
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const parts = [];
    let part = '';
    for (const char of word) {
      if (part && ctx.measureText(part + char).width > width) {
        parts.push(part);
        part = char;
      } else {
        part += char;
      }
    }
    if (part) parts.push(part);
    for (const [index, piece] of parts.entries()) {
      const next = line ? `${line}${index === 0 ? ' ' : ''}${piece}` : piece;
      if (line && ctx.measureText(next).width > width) {
        lines.push(line);
        line = piece;
      } else {
        line = next;
      }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['-'];
}

// Linha(s) de resumo do cartão: ponto colorido, quantidade em negrito e rótulo.
function productionExportStatusLines(ctx, counts) {
  const lines = [];
  let used = 0;
  for (const state of ['active', 'wet', 'waiting', 'stopped']) {
    if (!counts[state]) continue;
    const number = String(counts[state]);
    const label = PRODUCTION_EXPORT_STATE_LABELS[state];
    const numberWidth = productionExportMeasure(ctx, number, `bold 17px ${PRODUCTION_EXPORT_FONT}`);
    const labelWidth = productionExportMeasure(ctx, label, `16px ${PRODUCTION_EXPORT_FONT}`);
    const width = 16 + numberWidth + 5 + labelWidth;
    if (!lines.length || (used && used + width > 472)) {
      lines.push([]);
      used = 0;
    }
    lines.at(-1).push({ state, number, label, numberWidth, width });
    used += width + 18;
  }
  return lines;
}

function productionExportPillLayout(ctx, pill, pillArea) {
  const labelWidth = Math.ceil(productionExportMeasure(ctx, pill.label, PRODUCTION_EXPORT_PILL_FONT));
  const noteText = pill.note ? `· ${pill.note}` : '';
  const noteWidth = noteText ? Math.ceil(productionExportMeasure(ctx, noteText, PRODUCTION_EXPORT_PILL_NOTE_FONT)) + 6 : 0;
  pill.width = Math.min(pillArea, Math.max(46, labelWidth + noteWidth + 35));
  pill.textLines = productionExportWrap(ctx, pill.label, pill.width - 24, PRODUCTION_EXPORT_PILL_FONT);
  pill.noteLines = [];
  pill.noteInline = false;
  if (noteText) {
    const lastWidth = productionExportMeasure(ctx, pill.textLines.at(-1), PRODUCTION_EXPORT_PILL_FONT);
    if (lastWidth + noteWidth <= pill.width - 24) pill.noteInline = true;
    else pill.noteLines = productionExportWrap(ctx, noteText, pill.width - 24, PRODUCTION_EXPORT_PILL_NOTE_FONT);
  }
  pill.noteText = noteText;
  pill.height = Math.max(24, pill.textLines.length * 18 + pill.noteLines.length * 15 + 6);
}

function productionExportCardPlan(ctx, report, statusByCode, minHeight) {
  const groups = new Map();
  const notes = [];
  const changes = [];
  const counts = { active: 0, wet: 0, waiting: 0, stopped: 0, pending: 0 };
  for (const item of report.items) {
    const groupName = item.group_name || 'OUTROS SERVIÇOS';
    const serviceName = item.service_name || 'Serviço não informado';
    if (!groups.has(groupName)) groups.set(groupName, new Map());
    const services = groups.get(groupName);
    if (!services.has(serviceName)) services.set(serviceName, []);
    const state = productionExportStatus(item, statusByCode);
    if (item.is_current_day) counts[state] += 1;
    else counts.pending += 1;
    const sector = item.entry?.sector || 'Sem setor';
    // Frentes fora de atividade mostram o status cadastrado ao lado do setor.
    const note = state === 'active' ? '' : statusByCode.get(item.entry?.status)?.name || '';
    services.get(serviceName).push({ label: sector, state, note, pending: !item.is_current_day });
    const dated = item.is_current_day || !item.entry?.work_date
      ? '' : ` (${formatIsoDateBr(item.entry.work_date)})`;
    const prefix = `${serviceName}${dated}: `;
    for (const [field, target] of [['observation', notes], ['changes', changes]]) {
      const value = item.entry?.[field]?.trim();
      if (!value) continue;
      for (const line of value.split(/\r?\n/).map(text => text.trim()).filter(Boolean)) {
        target.push(`${prefix}${line}`);
      }
    }
  }

  const rows = [];
  for (const [groupName, services] of groups) {
    const groupLines = productionExportWrap(ctx, groupName.toLocaleUpperCase('pt-BR'), 424,
      `bold 19px ${PRODUCTION_EXPORT_TITLE_FONT}`);
    rows.push({ type: 'group', nameLines: groupLines,
      height: Math.max(32, groupLines.length * 22 + 10) });
    for (const [serviceName, pills] of services) {
      const lines = [{ pills: [], height: 24 }];
      let used = 0;
      const pillArea = 260;
      for (const pill of pills) {
        productionExportPillLayout(ctx, pill, pillArea);
        if (used && used + pill.width > pillArea) {
          lines.push({ pills: [], height: 24 });
          used = 0;
        }
        lines.at(-1).pills.push(pill);
        lines.at(-1).height = Math.max(lines.at(-1).height, pill.height);
        used += pill.width + 5;
      }
      const nameFont = `bold 16px ${PRODUCTION_EXPORT_FONT}`;
      ctx.font = nameFont;
      // Nomes comuns (ex.: Fertirrigação convencional) cabem em uma linha;
      // descrições de serviços realmente longas continuam quebrando.
      const nameLines = ctx.measureText(serviceName).width <= 155 * 1.46
        ? [serviceName] : productionExportWrap(ctx, serviceName, 155, nameFont);
      rows.push({ type: 'service', nameLines, lines,
        height: Math.max(30, lines.reduce((sum, line) => sum + line.height + 5, 0),
          nameLines.length * 20 + 6) });
    }
  }
  if (!rows.length) rows.push({ type: 'empty', height: 48 });

  const textFont = `16px ${PRODUCTION_EXPORT_FONT}`;
  const noteLines = report.noteLinesOverride ?? notes.flatMap(note => productionExportWrap(ctx, `• ${note}`, 466, textFont));
  if (!noteLines.length && !report.continuation && report.noteLinesOverride == null) {
    noteLines.push('• Sem observações.');
  }
  const legacyChanges = String(report.summary?.changes || '').split(/\r?\n/)
    .map(line => line.trim().replace(/^[•-]\s*/, '')).filter(Boolean);
  const changeLines = report.changeLinesOverride ?? ([...changes, ...legacyChanges])
    .flatMap(line => productionExportWrap(ctx, `• ${line}`, 466, textFont));
  if (!changeLines.length && !report.continuation && report.changeLinesOverride == null) {
    changeLines.push('• Sem mudanças previstas.');
  }
  const rainText = productionExportRainText(report.summary);
  const rainLines = rainText ? productionExportWrap(ctx, rainText, 418,
    `bold 18px ${PRODUCTION_EXPORT_FONT}`) : [];
  const rainHeight = rainLines.length ? Math.max(36, rainLines.length * 22 + 12) : 0;
  const statusLines = productionExportStatusLines(ctx, counts);
  // Topo do cartão: identificação da unidade, resumo de status e linha divisória.
  const headerHeight = 99 + statusLines.length * 25;
  // Todas as seções são medidas com os mesmos espaçamentos usados no desenho.
  // A altura cresce com dados reais, sem cortar observações ou deixar lacunas fixas.
  const contentHeight = headerHeight + rows.reduce((sum, row) => sum + row.height, 0)
    + (rainLines.length ? 16 + rainHeight + 14 : 8) + 26 + noteLines.length * 21 + 13
    + 26 + changeLines.length * 21 + 26;
  return { rows, noteLines, changeLines, rainLines, rainHeight, statusLines, headerHeight,
    counts, contentHeight, height: Math.max(minHeight, contentHeight) };
}

// Legenda só com os status usados nas frentes da imagem (ex.: "Solo úmido" só
// aparece se alguma frente estiver em solo úmido), na ordem do cadastro.
function productionExportLegendLayout(page, statusByCode) {
  const used = new Set(page.flatMap(report => (report.items || []).map(item => item.entry?.status)));
  const statuses = [...statusByCode.values()].filter(status => used.has(status.code));
  const font = `bold 18px ${PRODUCTION_EXPORT_FONT}`;
  const columnWidth = (PRODUCTION_EXPORT_WIDTH - 80) / Math.max(1, statuses.length);
  const entries = statuses.map((status, index) => ({
    state: productionExportStatus({ entry: { status: status.code } }, statusByCode),
    label: status.name,
    x: 40 + index * columnWidth, y: 334, width: Math.max(1, columnWidth - 35)
  }));
  return { entries, font };
}

function drawProductionExportHeader(ctx, workDate, pageNumber, totalPages, height, legend) {
  ctx.fillStyle = PRODUCTION_EXPORT_BODY;
  ctx.fillRect(0, 0, PRODUCTION_EXPORT_WIDTH, height);
  ctx.fillStyle = PRODUCTION_EXPORT_HEADER;
  ctx.fillRect(0, 0, PRODUCTION_EXPORT_WIDTH, 352);
  ctx.fillStyle = '#5a6e7b';
  ctx.fillRect(0, 89, PRODUCTION_EXPORT_WIDTH, 3);
  // Faixa com as cores dos status logo abaixo do cabeçalho.
  ['active', 'wet', 'stopped', 'waiting'].forEach((state, index) => {
    ctx.fillStyle = PRODUCTION_EXPORT_COLORS[state];
    ctx.fillRect(index * 270, 352, 270, 7);
  });

  const parts = saoPauloDateParts();
  const topFont = `bold 32px ${PRODUCTION_EXPORT_TITLE_FONT}`;
  const greeting = greetingForHour(parts.hour).toUpperCase();
  const greetingWidth = Math.min(200, productionExportMeasure(ctx, greeting, topFont));
  productionExportText(ctx, greeting, 40, 62, 200, topFont, '#ffffff');
  let x = 40 + greetingWidth + 22;
  ctx.fillStyle = '#8ea2ad';
  ctx.fillRect(x, 30, 2, 38);
  x += 22;
  productionExportCalendar(ctx, x, 34);
  x += 39;
  const dateText = formatIsoDateBr(workDate);
  const dateWidth = Math.min(220, productionExportMeasure(ctx, dateText, topFont));
  productionExportText(ctx, dateText, x, 62, 220, topFont, '#ffffff');
  x += dateWidth + 22;
  ctx.fillStyle = '#8ea2ad';
  ctx.fillRect(x, 30, 2, 38);
  productionExportText(ctx, `TURNO ${productionExportShift(parts)}`, x + 22, 62, 200, topFont,
    PRODUCTION_EXPORT_COLORS.wet);
  if (totalPages > 1) {
    ctx.save();
    ctx.textAlign = 'right';
    productionExportText(ctx, `${pageNumber}/${totalPages}`, 1040, 62, 80,
      `bold 22px ${PRODUCTION_EXPORT_TITLE_FONT}`, '#c5d2d8');
    ctx.restore();
  }

  productionExportText(ctx, 'TROCA DE TURNO', 40, 181, 640,
    `bold 74px Impact, ${PRODUCTION_EXPORT_FONT}`, '#ffffff');
  productionExportText(ctx, 'PRODUÇÃO AGRÍCOLA', 40, 250, 640,
    `bold 70px Impact, ${PRODUCTION_EXPORT_FONT}`, PRODUCTION_EXPORT_COLORS.active);
  productionExportText(ctx, 'Preparo, plantio, tratos culturais e fertirrigação', 40, 293, 930,
    `24px ${PRODUCTION_EXPORT_FONT}`, '#ffffff');
  legend.entries.forEach(({ state, label, x: entryX, y, width }) => {
    ctx.beginPath();
    ctx.arc(entryX + 9, y - 7, 8, 0, Math.PI * 2);
    ctx.fillStyle = PRODUCTION_EXPORT_COLORS[state];
    ctx.fill();
    productionExportText(ctx, label, entryX + 25, y, width, legend.font, '#ffffff');
  });
}

function drawProductionExportPill(ctx, pill, x, y) {
  productionExportRoundRect(ctx, x, y, pill.width, pill.height,
    12, PRODUCTION_EXPORT_PILL_BACKGROUNDS[pill.state]);
  productionExportRoundRect(ctx, x, y, pill.width, pill.height,
    12, PRODUCTION_EXPORT_PILL_BORDERS[pill.state], true, 1.5);
  ctx.beginPath(); ctx.arc(x + 12, y + 12, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = PRODUCTION_EXPORT_COLORS[pill.state]; ctx.fill();
  pill.textLines.forEach((textLine, index) => productionExportText(ctx,
    textLine, x + 22, y + 17 + index * 18, pill.width - 24, PRODUCTION_EXPORT_PILL_FONT));
  if (pill.noteInline) {
    const lastY = y + 17 + (pill.textLines.length - 1) * 18;
    const offset = productionExportMeasure(ctx, pill.textLines.at(-1), PRODUCTION_EXPORT_PILL_FONT) + 6;
    productionExportText(ctx, pill.noteText, x + 22 + offset, lastY,
      Math.max(1, pill.width - 24 - offset), PRODUCTION_EXPORT_PILL_NOTE_FONT, PRODUCTION_EXPORT_MUTED);
  }
  pill.noteLines.forEach((line, index) => productionExportText(ctx, line, x + 22,
    y + 17 + pill.textLines.length * 18 + index * 15 - 3, pill.width - 24,
    PRODUCTION_EXPORT_PILL_NOTE_FONT, PRODUCTION_EXPORT_MUTED));
}

function drawProductionExportCard(ctx, report, plan, x, y) {
  const width = 506;
  const counts = plan.counts;
  const border = PRODUCTION_EXPORT_COLORS[productionExportBorderState(counts)];
  productionExportRoundRect(ctx, x, y, width, plan.height, 14, PRODUCTION_EXPORT_CARD);
  productionExportRoundRect(ctx, x + 1, y + 1, width - 2, plan.height - 2, 14, border, true);
  productionExportRoundRect(ctx, x + 17, y + 24, 5, 43, 2.5, border);
  productionExportGrass(ctx, x + 37, y + 40);
  productionExportText(ctx, report.code, x + 80, y + 54, 150,
    `bold 40px ${PRODUCTION_EXPORT_TITLE_FONT}`, PRODUCTION_EXPORT_HEADER);
  ctx.letterSpacing = '1px';
  productionExportText(ctx, PRODUCTION_EXPORT_UNIT_NAMES[report.code], x + 80, y + 77, 310,
    `15px ${PRODUCTION_EXPORT_FONT}`, PRODUCTION_EXPORT_MUTED);
  ctx.letterSpacing = '0px';
  // Alinhar pela borda direita evita cortar contagens de 2 ou mais dígitos.
  ctx.save();
  ctx.textAlign = 'right';
  productionExportText(ctx, report.continuation ? 'CONT.' : String(report.items.length),
    x + 489, y + 54, 94,
    `bold 36px ${PRODUCTION_EXPORT_TITLE_FONT}`, PRODUCTION_EXPORT_COLORS.active);
  ctx.letterSpacing = '1px';
  productionExportText(ctx, report.continuation ? 'INFORMAÇÕES' : 'OPERAÇÕES', x + 489, y + 74, 94,
    `12px ${PRODUCTION_EXPORT_FONT}`, PRODUCTION_EXPORT_MUTED);
  ctx.letterSpacing = '0px';
  ctx.restore();

  plan.statusLines.forEach((line, lineIndex) => {
    const baseY = y + 106 + lineIndex * 25;
    let itemX = x + 17;
    for (const item of line) {
      ctx.beginPath(); ctx.arc(itemX + 6, baseY - 6, 6, 0, Math.PI * 2);
      ctx.fillStyle = PRODUCTION_EXPORT_COLORS[item.state]; ctx.fill();
      productionExportText(ctx, item.number, itemX + 16, baseY, item.numberWidth + 2,
        `bold 17px ${PRODUCTION_EXPORT_FONT}`);
      productionExportText(ctx, item.label, itemX + 21 + item.numberWidth, baseY,
        Math.max(1, item.width - item.numberWidth - 21), `16px ${PRODUCTION_EXPORT_FONT}`, PRODUCTION_EXPORT_MUTED);
      itemX += item.width + 18;
    }
  });
  productionExportRule(ctx, x + 17, y + plan.headerHeight - 9, x + 489, '#d5dcdf');

  let cursor = y + plan.headerHeight;
  for (const row of plan.rows) {
    if (row.type === 'group') {
      productionExportGroupIcon(ctx, x + 17, cursor + 4, row.nameLines.join(' '));
      row.nameLines.forEach((line, index) => productionExportText(ctx, line,
        x + 49, cursor + 24 + index * 22, 424,
        `bold 19px ${PRODUCTION_EXPORT_TITLE_FONT}`, PRODUCTION_EXPORT_HEADER));
    } else if (row.type === 'service') {
      row.nameLines.forEach((line, lineIndex) => productionExportText(ctx,
        line, x + 17, cursor + 19 + lineIndex * 20, 179,
        `16px ${PRODUCTION_EXPORT_FONT}`));
      let lineY = cursor + 2;
      row.lines.forEach(line => {
        let pillX = x + 204;
        for (const pill of line.pills) {
          drawProductionExportPill(ctx, pill, pillX, lineY);
          pillX += pill.width + 5;
        }
        lineY += line.height + 7;
      });
      productionExportRule(ctx, x + 17, cursor + row.height - 1, x + 489);
    } else {
      productionExportText(ctx, report.restricted ? 'Unidade não liberada para este usuário.'
        : report.continuation ? 'Continuação das informações da unidade.'
          : 'Nenhum lançamento nesta unidade.', x + 17, cursor + 29, 455,
      `16px ${PRODUCTION_EXPORT_FONT}`, PRODUCTION_EXPORT_MUTED);
    }
    cursor += row.height;
  }

  cursor = plan.rainLines.length ? drawProductionExportRain(ctx, plan, x, cursor) : cursor + 8;

  productionExportText(ctx, 'OBSERVAÇÃO', x + 17, cursor + 20, 460,
    `bold 21px ${PRODUCTION_EXPORT_TITLE_FONT}`, PRODUCTION_EXPORT_ACCENT);
  cursor += 26;
  for (const line of plan.noteLines) {
    productionExportText(ctx, line, x + 17, cursor + 15, 466, `16px ${PRODUCTION_EXPORT_FONT}`);
    cursor += 21;
  }
  cursor += 13;
  productionExportText(ctx, 'MUDANÇAS', x + 17, cursor + 20, 460,
    `bold 21px ${PRODUCTION_EXPORT_TITLE_FONT}`, PRODUCTION_EXPORT_ACCENT);
  cursor += 26;
  for (const line of plan.changeLines) {
    productionExportText(ctx, line, x + 17, cursor + 19, 466, `16px ${PRODUCTION_EXPORT_FONT}`);
    cursor += 21;
  }
}

function drawProductionExportRain(ctx, plan, x, cursor) {
  cursor += 16;
  productionExportRoundRect(ctx, x + 17, cursor, 472, plan.rainHeight, 9, '#e5eaec');
  productionExportCloud(ctx, x + 29, cursor + plan.rainHeight / 2 - 12);
  const rainFont = `bold 18px ${PRODUCTION_EXPORT_FONT}`;
  plan.rainLines.forEach((line, index) => {
    const lineY = cursor + 25 + index * 22;
    if (index === 0 && line.startsWith('Chuva:')) {
      // "Chuva:" em peso normal e o valor em destaque, como no modelo.
      const labelFont = `18px ${PRODUCTION_EXPORT_FONT}`;
      const labelWidth = productionExportMeasure(ctx, 'Chuva:', labelFont);
      productionExportText(ctx, 'Chuva:', x + 64, lineY, labelWidth + 2, labelFont);
      productionExportText(ctx, line.slice(6), x + 64 + labelWidth + 5, lineY,
        Math.max(1, 413 - labelWidth), rainFont);
    } else {
      productionExportText(ctx, line, x + 64, lineY, 413, rainFont);
    }
  });
  return cursor + plan.rainHeight + 14;
}

function productionExportFooterIcon(ctx, index, x, y) {
  ctx.strokeStyle = PRODUCTION_EXPORT_HEADER;
  ctx.fillStyle = PRODUCTION_EXPORT_HEADER;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (index === 0) {
    ctx.arc(x, y + 6, 12, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 16, y + 7); ctx.lineTo(x + 16, y + 7); ctx.stroke();
    ctx.fillRect(x - 2, y - 11, 4, 8);
  } else if (index === 1) {
    ctx.moveTo(x, y + 13); ctx.lineTo(x, y - 8); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x - 7, y - 7, 7, 4, -.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x + 7, y - 10, 7, 4, .5, 0, Math.PI * 2); ctx.stroke();
  } else if (index === 2) {
    [-10, 0, 10].forEach((offset, position) => {
      ctx.beginPath(); ctx.arc(x + offset, y - 7 + (position === 1 ? -3 : 0), 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + offset, y + 12, 7, Math.PI, 0); ctx.fill();
    });
  } else {
    [6, 13, 21].forEach((height, position) => ctx.fillRect(x - 12 + position * 9, y + 12 - height, 5, height));
  }
}

function drawProductionExportFooter(ctx, y, workDate, height) {
  const blocks = [
    ['SEGURANÇA', 'SEMPRE'], ['OPERAÇÃO', 'COM QUALIDADE'],
    ['PESSOAS QUE FAZEM', 'A DIFERENÇA'], ['RESULTADOS', 'SUSTENTÁVEIS']
  ];
  const footerFont = `bold 16px ${PRODUCTION_EXPORT_TITLE_FONT}`;
  blocks.forEach(([lineOne, lineTwo], index) => {
    const x = 30 + index * 270;
    ctx.beginPath(); ctx.arc(x + 32, y + 39, 31, 0, Math.PI * 2);
    ctx.strokeStyle = PRODUCTION_EXPORT_HEADER; ctx.lineWidth = 2; ctx.stroke();
    productionExportFooterIcon(ctx, index, x + 32, y + 39);
    productionExportText(ctx, lineOne, x + 77, y + 34, 183, footerFont, PRODUCTION_EXPORT_HEADER);
    productionExportText(ctx, lineTwo, x + 77, y + 55, 183, footerFont, PRODUCTION_EXPORT_HEADER);
  });
  const taglineFont = `bold 15px ${PRODUCTION_EXPORT_FONT}`;
  const left = `COA | COCAL | SAFRA ${workDate.slice(0, 4)} ·`;
  const right = 'Juntos fazemos mais!';
  const leftWidth = productionExportMeasure(ctx, left, taglineFont);
  const rightWidth = productionExportMeasure(ctx, right, taglineFont);
  const start = (PRODUCTION_EXPORT_WIDTH - leftWidth - 5 - rightWidth) / 2;
  productionExportText(ctx, left, start, y + 106, leftWidth + 2, taglineFont, PRODUCTION_EXPORT_MUTED);
  productionExportText(ctx, right, start + leftWidth + 5, y + 106, rightWidth + 2, taglineFont,
    PRODUCTION_EXPORT_COLORS.active);
  const stripe = ctx.createLinearGradient(0, 0, PRODUCTION_EXPORT_WIDTH, 0);
  stripe.addColorStop(0, PRODUCTION_EXPORT_COLORS.active);
  stripe.addColorStop(1, PRODUCTION_EXPORT_COLORS.wet);
  ctx.fillStyle = stripe;
  ctx.fillRect(0, height - 6, PRODUCTION_EXPORT_WIDTH, 6);
}

function productionExportPageLayout(ctx, page, statusByCode) {
  const legend = productionExportLegendLayout(page, statusByCode);
  const firstY = 370;
  const plans = page.map((report, index) => {
    const items = report.items?.length || 0;
    const isContinuation = Boolean(report.continuation);
    const hasNotes = Boolean((report.summary?.changes || '').trim())
      || Boolean(report.noteLinesOverride?.length)
      || Boolean(report.changeLinesOverride?.length);
    const dynamicMinimum = isContinuation
      ? 300
      : items === 0
        ? 300
        : items <= 4
          ? 360
          : items <= 10
            ? 420
            : 440 + Math.min(170, (items - 10) * 6);
    const minimum = hasNotes ? dynamicMinimum : Math.max(280, dynamicMinimum - 20);
    return productionExportCardPlan(ctx, report, statusByCode, minimum);
  });
  const firstHeight = Math.max(plans[0].height, plans[1].height);
  const secondHeight = Math.max(plans[2].height, plans[3].height);
  plans[0].height = plans[1].height = firstHeight;
  plans[2].height = plans[3].height = secondHeight;
  const secondY = firstY + firstHeight + 16;
  const footerY = secondY + secondHeight + 24;
  return { page, plans, legend, firstY, secondY, footerY, height: footerY + 130 };
}

function productionExportSplitTextPage(page, plans) {
  const order = plans.map((plan, index) => ({ plan, index }))
    .sort((a, b) => b.plan.contentHeight - a.plan.contentHeight);
  for (const { plan, index } of order) {
    const allLines = [...plan.noteLines, ...plan.changeLines];
    if (allLines.length <= 2) continue;
    const split = Math.ceil(allLines.length / 2);
    const firstNotes = plan.noteLines.slice(0, split);
    const firstChanges = plan.changeLines.slice(0, Math.max(0, split - plan.noteLines.length));
    const restNotes = plan.noteLines.slice(split);
    const restChanges = plan.changeLines.slice(Math.max(0, split - plan.noteLines.length));
    const first = page.map((report, unitIndex) => unitIndex === index
      ? { ...report, noteLinesOverride: firstNotes, changeLinesOverride: firstChanges }
      : report);
    const second = page.map((report, unitIndex) => ({
      ...report, items: [], continuation: unitIndex === index,
      summary: unitIndex === index ? report.summary : null,
      noteLinesOverride: unitIndex === index ? restNotes : [],
      changeLinesOverride: unitIndex === index ? restChanges : []
    }));
    return [first, second];
  }
  return null;
}

function prepareProductionExportPages(ctx, reports, statusByCode) {
  const consolidated = reports.map(report => ({
    ...report, items: consolidateProductionItems(report.items || [])
  }));
  const pending = buildProductionExportPages(consolidated);
  const ready = [];
  while (pending.length) {
    const page = pending.shift();
    const layout = productionExportPageLayout(ctx, page, statusByCode);
    if (layout.height * PRODUCTION_EXPORT_SCALE <= PRODUCTION_EXPORT_MAX_PIXEL_HEIGHT) {
      ready.push(layout);
      continue;
    }
    if (page.some(report => report.items.length > 1)) {
      const first = page.map(report => ({ ...report,
        items: report.items.slice(0, Math.ceil(report.items.length / 2)) }));
      const second = page.map(report => ({ ...report,
        // Mudanças de turno são informação diária, não devem ser repetidas
        // em todas as imagens criadas por excesso de operações.
        summary: report.summary ? { ...report.summary, changes: '' } : null,
        items: report.items.slice(Math.ceil(report.items.length / 2)) }));
      pending.unshift(first, second);
    } else {
      const split = productionExportSplitTextPage(page, layout.plans);
      if (!split) throw new Error('Uma identificação excede o limite de tamanho da imagem. Revise os dados do lançamento.');
      pending.unshift(...split);
    }
  }
  return ready;
}

async function generateProductionReportImages(reports, statuses, workDate) {
  const statusByCode = new Map(statuses.map(status => [status.code, status]));
  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = PRODUCTION_EXPORT_WIDTH;
  measureCanvas.height = 1920;
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) throw new Error('Não foi possível preparar a imagem da Produção Agrícola.');
  const pages = prepareProductionExportPages(measureCtx, reports, statusByCode);
  const images = [];
  for (const [index, layout] of pages.entries()) {
    const canvas = document.createElement('canvas');
    canvas.width = PRODUCTION_EXPORT_PIXEL_WIDTH;
    canvas.height = Math.ceil(layout.height * PRODUCTION_EXPORT_SCALE);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Não foi possível preparar a imagem da Produção Agrícola.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(PRODUCTION_EXPORT_SCALE, PRODUCTION_EXPORT_SCALE);
    drawProductionExportHeader(ctx, workDate, index + 1, pages.length, layout.height, layout.legend);
    layout.page.forEach((report, cardIndex) => drawProductionExportCard(ctx, report,
      layout.plans[cardIndex], cardIndex % 2 ? 548 : 26,
      cardIndex < 2 ? layout.firstY : layout.secondY));
    drawProductionExportFooter(ctx, layout.footerY, workDate, layout.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      result => result ? resolve(result) : reject(new Error('Não foi possível gerar a imagem da Produção Agrícola.')),
      'image/png'
    ));
    images.push(blob);
  }
  return images;
}
