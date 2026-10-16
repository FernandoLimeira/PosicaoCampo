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
  active: '#76b82a', wet: '#ffcc00', waiting: '#b2b2b2', stopped: '#e95b45'
};
const PRODUCTION_EXPORT_BODY = '#0f1e24';
const PRODUCTION_EXPORT_CARD = '#12252c';
const PRODUCTION_EXPORT_TEXT = '#e9eef0';
const PRODUCTION_EXPORT_MUTED = '#a6c4ce';

function localProductionExportDate(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatProductionExportDate(value) {
  const parts = String(value || '').split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : '-';
}

function buildProductionExportPages(reports, limit = PRODUCTION_EXPORT_PAGE_LIMIT) {
  const byCode = new Map(reports.map(report => [report.code, report]));
  const ordered = PRODUCTION_EXPORT_UNITS.map(code => byCode.get(code) || { code, restricted: true, items: [] });
  const pages = Math.max(1, ...ordered.map(report => Math.ceil((report.items?.length || 0) / limit)));
  return Array.from({ length: pages }, (_, index) => ordered.map(report => ({
    code: report.code,
    restricted: Boolean(report.restricted),
    summary: report.summary || null,
    items: (report.items || []).slice(index * limit, (index + 1) * limit)
  })));
}

function productionExportText(ctx, value, x, y, width, font, color = PRODUCTION_EXPORT_TEXT) {
  ctx.font = font;
  ctx.fillStyle = color;
  let text = String(value ?? '').trim();
  while (text.length > 1 && ctx.measureText(text).width > width) {
    text = `${text.slice(0, -2)}…`;
  }
  ctx.fillText(text, x, y);
}

function productionExportRoundRect(ctx, x, y, width, height, radius, color, stroke = false) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  if (stroke) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function productionExportRule(ctx, x1, y, x2, color = '#355059') {
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
  productionExportRoundRect(ctx, x, y, 24, 24, 5, '#264956');
  ctx.strokeStyle = '#d8eef2';
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

function productionExportStatus(item, statusByCode) {
  const status = statusByCode.get(item.entry?.status);
  return status?.style_key in PRODUCTION_EXPORT_COLORS ? status.style_key : 'waiting';
}

function productionExportBorderState(counts) {
  const order = ['stopped', 'wet', 'waiting', 'active'];
  const highest = Math.max(...order.map(state => counts[state] || 0));
  return highest ? order.find(state => counts[state] === highest) : 'waiting';
}

function productionExportRainText(summary) {
  const turn = summary?.rain_turn_mm;
  const accumulated = summary?.rain_accumulated_mm;
  if (turn == null && accumulated == null) return 'Chuva: sem registro para esta data';
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

function productionExportCardPlan(ctx, report, statusByCode, minHeight) {
  const groups = new Map();
  const notes = [];
  const seenNotes = new Set();
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
    const stamp = item.is_current_day || !item.entry?.work_date
      ? '' : ` · ${formatProductionExportDate(item.entry.work_date)}`;
    services.get(serviceName).push({ label: `${sector}${stamp}`, state, pending: !item.is_current_day });
    const observation = item.entry?.observation?.trim();
    const noteKey = `${serviceName}\n${item.entry?.work_date || ''}\n${observation}`;
    if (observation && !seenNotes.has(noteKey)) {
      seenNotes.add(noteKey);
      const dated = item.is_current_day || !item.entry?.work_date
        ? '' : ` (${formatProductionExportDate(item.entry.work_date)})`;
      notes.push(`${serviceName}${dated}: ${observation}`);
    }
  }

  const rows = [];
  for (const [groupName, services] of groups) {
    const groupLines = productionExportWrap(ctx, groupName.toLocaleUpperCase('pt-BR'), 424,
      'bold 19px Bahnschrift, "Arial Narrow", sans-serif');
    rows.push({ type: 'group', nameLines: groupLines,
      height: Math.max(32, groupLines.length * 22 + 8) });
    for (const [serviceName, pills] of services) {
      const lines = [{ pills: [], height: 25 }];
      let used = 0;
      for (const pill of pills) {
        ctx.font = 'bold 16px "Arial Narrow", Arial, sans-serif';
        pill.width = Math.min(278, Math.max(54, Math.ceil(ctx.measureText(pill.label).width) + 28));
        if (used && used + pill.width + 6 > 278) {
          lines.push({ pills: [], height: 25 });
          used = 0;
        }
        pill.textLines = productionExportWrap(ctx, pill.label, pill.width - 27,
          'bold 16px "Arial Narrow", Arial, sans-serif');
        pill.height = Math.max(25, pill.textLines.length * 18 + 7);
        lines.at(-1).pills.push(pill);
        lines.at(-1).height = Math.max(lines.at(-1).height, pill.height);
        used += pill.width + 6;
      }
      const nameLines = productionExportWrap(ctx, serviceName, 176,
        'bold 16px "Arial Narrow", Arial, sans-serif');
      rows.push({ type: 'service', nameLines, lines,
        height: Math.max(29, lines.reduce((sum, line) => sum + line.height + 4, 0),
          nameLines.length * 20 + 6) });
    }
  }
  if (!rows.length) rows.push({ type: 'empty', height: 48 });

  const noteLines = notes.flatMap(note => productionExportWrap(ctx, `• ${note}`, 466,
    '16px "Arial Narrow", Arial, sans-serif'));
  if (!noteLines.length) noteLines.push('• Sem observações registradas.');
  const changes = String(report.summary?.changes || '').split(/\r?\n/)
    .map(line => line.trim().replace(/^[•-]\s*/, '')).filter(Boolean);
  const changeLines = (changes.length ? changes : ['Sem mudanças registradas.'])
    .flatMap(line => productionExportWrap(ctx, `• ${line}`, 466,
      '16px "Arial Narrow", Arial, sans-serif'));
  const extraSummary = counts.waiting || counts.stopped || counts.pending ? 24 : 0;
  const contentHeight = 129 + extraSummary + rows.reduce((sum, row) => sum + row.height, 0)
    + 16 + 36 + 14 + 26 + noteLines.length * 21 + 13 + 26 + changeLines.length * 21 + 22;
  return { rows, noteLines, changeLines, rainText: productionExportRainText(report.summary),
    counts, extraSummary, height: Math.max(minHeight, contentHeight) };
}

function drawProductionExportHeader(ctx, workDate, background, pageNumber, totalPages, height) {
  ctx.fillStyle = PRODUCTION_EXPORT_BODY;
  ctx.fillRect(0, 0, PRODUCTION_EXPORT_WIDTH, height);
  if (background) {
    ctx.save();
    ctx.filter = 'blur(7px)';
    ctx.drawImage(background, 0, 0, background.width,
      Math.min(background.height, background.width * .62), 0, 0, 1080, 360);
    ctx.restore();
  }
  const overlay = ctx.createLinearGradient(0, 0, 0, 365);
  overlay.addColorStop(0, 'rgba(9, 22, 27, .74)');
  overlay.addColorStop(1, 'rgba(9, 25, 30, .90)');
  ctx.fillStyle = overlay;
  ctx.fillRect(0, 0, 1080, 365);
  const eveningGlow = ctx.createLinearGradient(0, 95, 0, 365);
  eveningGlow.addColorStop(0, 'rgba(180, 90, 47, .08)');
  eveningGlow.addColorStop(.45, 'rgba(180, 90, 47, .20)');
  eveningGlow.addColorStop(1, 'rgba(180, 90, 47, 0)');
  ctx.fillStyle = eveningGlow;
  ctx.fillRect(0, 95, 1080, 270);
  ctx.fillStyle = 'rgba(13, 28, 34, .62)';
  ctx.fillRect(0, 0, 1080, 91);
  const rule = ctx.createLinearGradient(0, 0, 1080, 0);
  rule.addColorStop(0, '#455f65');
  rule.addColorStop(.52, PRODUCTION_EXPORT_COLORS.active);
  rule.addColorStop(1, PRODUCTION_EXPORT_COLORS.wet);
  ctx.fillStyle = rule;
  ctx.fillRect(0, 90, 1080, 4);

  const hour = new Date().getHours();
  const greeting = hour < 5 || hour >= 18 ? 'BOA NOITE!' : hour < 12 ? 'BOM DIA!' : 'BOA TARDE!';
  productionExportText(ctx, greeting, 40, 65, 182, 'bold 28px Bahnschrift, "Arial Narrow", sans-serif');
  ctx.fillStyle = '#8ea2a5';
  ctx.fillRect(227, 29, 2, 41);
  productionExportCalendar(ctx, 252, 37);
  productionExportText(ctx, formatProductionExportDate(workDate), 291, 65, 260,
    'bold 35px Bahnschrift, "Arial Narrow", sans-serif');
  if (totalPages > 1) productionExportText(ctx, `${pageNumber}/${totalPages}`, 989, 64, 55,
    'bold 21px Impact, "Arial Narrow", sans-serif', PRODUCTION_EXPORT_MUTED);

  productionExportText(ctx, 'TROCA DE TURNO', 40, 181, 900,
    'bold 71px Impact, "Arial Narrow", sans-serif');
  productionExportText(ctx, 'PRODUÇÃO AGRÍCOLA', 40, 250, 970,
    'bold 68px Impact, "Arial Narrow", sans-serif', PRODUCTION_EXPORT_COLORS.active);
  productionExportText(ctx, 'Preparo, plantio, tratos culturais e fertirrigação', 40, 293, 930,
    'bold 24px "Arial Narrow", Arial, sans-serif', '#e7eeee');
  const legend = [
    ['active', 'Em atividade', 40], ['wet', 'Solo úmido / teste', 286],
    ['waiting', 'Aguardando atividade', 575], ['stopped', 'Parado / crítico', 892]
  ];
  legend.forEach(([state, label, x]) => {
    ctx.beginPath();
    ctx.arc(x + 9, 325, 9, 0, Math.PI * 2);
    ctx.fillStyle = PRODUCTION_EXPORT_COLORS[state];
    ctx.fill();
    productionExportText(ctx, label, x + 25, 334, 260,
      'bold 18px "Arial Narrow", Arial, sans-serif');
  });
}

function drawProductionExportCard(ctx, report, plan, x, y) {
  const width = 506;
  const counts = plan.counts;
  const border = PRODUCTION_EXPORT_COLORS[productionExportBorderState(counts)];
  const cardBackground = ctx.createLinearGradient(x, y, x, y + plan.height);
  cardBackground.addColorStop(0, PRODUCTION_EXPORT_CARD);
  cardBackground.addColorStop(1, PRODUCTION_EXPORT_BODY);
  productionExportRoundRect(ctx, x, y, width, plan.height, 15, cardBackground);
  productionExportRoundRect(ctx, x + 1, y + 1, width - 2, plan.height - 2, 15, border, true);
  productionExportRoundRect(ctx, x + 17, y + 24, 6, 43, 3, border);
  productionExportGrass(ctx, x + 37, y + 40);
  productionExportText(ctx, report.code, x + 80, y + 52, 150,
    'bold 43px Impact, "Arial Narrow", sans-serif');
  productionExportText(ctx, PRODUCTION_EXPORT_UNIT_NAMES[report.code], x + 80, y + 74, 310,
    '16px "Arial Narrow", Arial, sans-serif', '#c2d3d6');
  productionExportText(ctx, String(report.items.length), x + 452, y + 52, 38,
    'bold 38px Impact, "Arial Narrow", sans-serif', PRODUCTION_EXPORT_COLORS.active);
  productionExportText(ctx, 'OPERAÇÕES', x + 421, y + 72, 72,
    '12px "Arial Narrow", Arial, sans-serif', '#c2d3d6');

  ctx.beginPath(); ctx.arc(x + 24, y + 97, 6, 0, Math.PI * 2);
  ctx.fillStyle = PRODUCTION_EXPORT_COLORS.active; ctx.fill();
  productionExportText(ctx, `${counts.active} em atividade`, x + 34, y + 104, 138,
    'bold 17px "Arial Narrow", Arial, sans-serif');
  ctx.beginPath(); ctx.arc(x + 164, y + 97, 6, 0, Math.PI * 2);
  ctx.fillStyle = PRODUCTION_EXPORT_COLORS.wet; ctx.fill();
  productionExportText(ctx, `${counts.wet} solo úmido`, x + 174, y + 104, 126,
    'bold 17px "Arial Narrow", Arial, sans-serif');
  if (plan.extraSummary) {
    const details = [
      ['waiting', counts.waiting, 'aguardando'],
      ['stopped', counts.stopped, 'parado(s)'],
      ['pending', counts.pending, 'pendente(s)']
    ].filter(([, count]) => count);
    let detailX = x + 24;
    for (const [state, count, label] of details) {
      const color = PRODUCTION_EXPORT_COLORS[state] || PRODUCTION_EXPORT_MUTED;
      ctx.beginPath(); ctx.arc(detailX, y + 126, 5, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      productionExportText(ctx, `${count} ${label}`, detailX + 10, y + 132, 130,
        'bold 14px "Arial Narrow", Arial, sans-serif');
      detailX += 155;
    }
  }
  productionExportRule(ctx, x + 17, y + 116 + plan.extraSummary, x + 489);

  let cursor = y + 125 + plan.extraSummary;
  for (const row of plan.rows) {
    if (row.type === 'group') {
      productionExportGroupIcon(ctx, x + 17, cursor + 2, row.nameLines.join(' '));
      row.nameLines.forEach((line, index) => productionExportText(ctx, line,
        x + 49, cursor + 22 + index * 22, 424,
        'bold 19px Bahnschrift, "Arial Narrow", sans-serif', PRODUCTION_EXPORT_MUTED));
    } else if (row.type === 'service') {
      row.nameLines.forEach((line, lineIndex) => productionExportText(ctx,
        line, x + 17, cursor + 19 + lineIndex * 20, 179,
        'bold 16px "Arial Narrow", Arial, sans-serif'));
      let lineY = cursor + 2;
      row.lines.forEach(line => {
        let pillX = x + 200;
        for (const pill of line.pills) {
          const color = PRODUCTION_EXPORT_COLORS[pill.state];
          if (pill.pending) ctx.setLineDash([4, 3]);
          productionExportRoundRect(ctx, pillX, lineY,
            pill.width, pill.height, 13, color, true);
          if (pill.pending) ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(pillX + 12, lineY + 12, 6, 0, Math.PI * 2);
          ctx.fillStyle = color; ctx.fill();
          pill.textLines.forEach((textLine, textIndex) => productionExportText(ctx,
            textLine, pillX + 22, lineY + 18 + textIndex * 18,
            pill.width - 27, 'bold 16px "Arial Narrow", Arial, sans-serif'));
          pillX += pill.width + 6;
        }
        lineY += line.height + 4;
      });
      productionExportRule(ctx, x + 17, cursor + row.height - 1, x + 489, '#29434b');
    } else {
      productionExportText(ctx, report.restricted ? 'Unidade não liberada para este usuário.'
        : 'Nenhum lançamento nesta unidade.', x + 17, cursor + 29, 455,
      '16px "Arial Narrow", Arial, sans-serif', PRODUCTION_EXPORT_MUTED);
    }
    cursor += row.height;
  }

  cursor += 16;
  productionExportRoundRect(ctx, x + 17, cursor, 472, 36, 9, '#213b46');
  productionExportText(ctx, '☁', x + 29, cursor + 26, 30, 'bold 23px Arial', PRODUCTION_EXPORT_MUTED);
  productionExportText(ctx, plan.rainText, x + 60, cursor + 25, 417,
    'bold 18px "Arial Narrow", Arial, sans-serif');
  cursor += 50;
  productionExportText(ctx, 'OBSERVAÇÃO', x + 17, cursor + 20, 460,
    'bold 21px Bahnschrift, "Arial Narrow", sans-serif', PRODUCTION_EXPORT_COLORS.wet);
  cursor += 26;
  for (const line of plan.noteLines) {
    productionExportText(ctx, line, x + 17, cursor + 15, 466,
      '16px "Arial Narrow", Arial, sans-serif');
    cursor += 21;
  }
  cursor += 13;
  productionExportText(ctx, 'MUDANÇAS', x + 17, cursor + 20, 460,
    'bold 21px Bahnschrift, "Arial Narrow", sans-serif', PRODUCTION_EXPORT_COLORS.wet);
  cursor += 26;
  for (const line of plan.changeLines) {
    productionExportText(ctx, line, x + 17, cursor + 19, 466,
      '16px "Arial Narrow", Arial, sans-serif');
    cursor += 21;
  }
}

function productionExportFooterIcon(ctx, index, x, y) {
  ctx.strokeStyle = PRODUCTION_EXPORT_COLORS.wet;
  ctx.fillStyle = PRODUCTION_EXPORT_COLORS.wet;
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
  blocks.forEach(([lineOne, lineTwo], index) => {
    const x = 30 + index * 270;
    ctx.beginPath(); ctx.arc(x + 32, y + 39, 31, 0, Math.PI * 2);
    ctx.strokeStyle = PRODUCTION_EXPORT_COLORS.wet; ctx.lineWidth = 2; ctx.stroke();
    productionExportFooterIcon(ctx, index, x + 32, y + 39);
    productionExportText(ctx, lineOne, x + 77, y + 32, 183,
      'bold 16px Bahnschrift, "Arial Narrow", sans-serif');
    productionExportText(ctx, lineTwo, x + 77, y + 54, 183,
      'bold 16px Bahnschrift, "Arial Narrow", sans-serif');
  });
  productionExportText(ctx, `COA | COCAL | SAFRA ${workDate.slice(0, 4)} ·`, 380, y + 106, 310,
    'bold 14px "Arial Narrow", Arial, sans-serif', '#aeb8b9');
  productionExportText(ctx, 'Juntos fazemos mais!', 689, y + 106, 220,
    'bold 14px "Arial Narrow", Arial, sans-serif', PRODUCTION_EXPORT_COLORS.wet);
  ctx.fillStyle = PRODUCTION_EXPORT_COLORS.wet;
  ctx.fillRect(0, height - 6, PRODUCTION_EXPORT_WIDTH, 6);
}

function productionExportPageLayout(ctx, page, statusByCode) {
  const plans = page.map((report, index) => productionExportCardPlan(ctx, report,
    statusByCode, index < 2 ? 875 : 520));
  const firstHeight = Math.max(plans[0].height, plans[1].height);
  const secondHeight = Math.max(plans[2].height, plans[3].height);
  const secondY = 370 + firstHeight + 16;
  const footerY = secondY + secondHeight + 16;
  return { page, plans, secondY, footerY, height: footerY + 123 };
}

function prepareProductionExportPages(ctx, reports, statusByCode) {
  const pending = buildProductionExportPages(reports);
  const ready = [];
  while (pending.length) {
    const page = pending.shift();
    const layout = productionExportPageLayout(ctx, page, statusByCode);
    if (layout.height * PRODUCTION_EXPORT_SCALE <= PRODUCTION_EXPORT_MAX_PIXEL_HEIGHT) {
      ready.push(layout);
      continue;
    }
    if (page.every(report => report.items.length <= 1)) {
      throw new Error('Um apontamento excede o tamanho máximo da imagem. Reduza a observação desse registro.');
    }
    const first = page.map(report => ({ ...report,
      items: report.items.slice(0, Math.ceil(report.items.length / 2)) }));
    const second = page.map(report => ({ ...report,
      items: report.items.slice(Math.ceil(report.items.length / 2)) }));
    pending.unshift(first, second);
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
  let background = null;
  try {
    background = await loadImageAsset('/assets/login-field-sunrise-v1.png', '');
  } catch (_) {
    // O gradiente escuro mantém o relatório legível se a foto não carregar.
  }
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
    drawProductionExportHeader(ctx, workDate, background, index + 1, pages.length, layout.height);
    layout.page.forEach((report, cardIndex) => drawProductionExportCard(ctx, report,
      layout.plans[cardIndex], cardIndex % 2 ? 548 : 26,
      cardIndex < 2 ? 370 : layout.secondY));
    drawProductionExportFooter(ctx, layout.footerY, workDate, layout.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      result => result ? resolve(result) : reject(new Error('Não foi possível gerar a imagem da Produção Agrícola.')),
      'image/png'
    ));
    images.push(blob);
  }
  if (background?.close) background.close();
  return images;
}
