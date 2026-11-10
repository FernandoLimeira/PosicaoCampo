// Emissão global da Posição de Campo (quatro unidades), fiel ao modelo aprovado (900 × 1600).
// Depende de core/field-fronts.js, reports-export/shared-drawing.js e reports-export/field-report-data.js.
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
    globalDrawText(ctx, fieldFrontNumber(front), x+38, cy, 42, font);
    globalDrawText(ctx, sector, col.sector, cy, hasRain?61:78, font);
    const displayedStatus=String(status).toLowerCase().replace(/(^|\s)\p{L}/gu, char => char.toUpperCase());
    const softenedStatus=displayedStatus.replace('Úmido','úmido').replace('Atividade','atividade');
    globalDrawText(ctx, softenedStatus, col.status, cy, hasRain?96:145, 'bold 14.3px "Arial Narrow", Arial, sans-serif', color === 'yellow' ? GLOBAL_COLORS.yellow : statusColorValue(color));
    globalDrawText(ctx, String(atr ?? '').trim() || '—', col.atr+(hasRain?6:0), cy, 29, font);
    if (hasRain) {
      const rainfall=rain.get(canonicalFieldFrontKey(front));
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
