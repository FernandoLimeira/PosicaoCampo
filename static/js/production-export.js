// Exportação da Produção Agrícola. Usa os mesmos apontamentos exibidos em "Todos da unidade".
const PRODUCTION_EXPORT_WIDTH = 2400;
const PRODUCTION_EXPORT_ROWS_PER_PAGE = 18;
const PRODUCTION_EXPORT_ROW_HEIGHT = 96;
const PRODUCTION_EXPORT_UNIT_NAMES = {
  PPT: 'Paraguaçu Paulista',
  NRD: 'Narandiba',
  RBR: 'Rio Brilhante',
  PST: 'Passa Tempo'
};
const PRODUCTION_EXPORT_STATUS_COLORS = {
  active: ['#e5f5ea', '#176f39'],
  wet: ['#fff2c9', '#80610e'],
  waiting: ['#edf1ee', '#566b5c'],
  stopped: ['#fce6e7', '#a62f38']
};

function localProductionExportDate(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatProductionExportDate(value) {
  const parts = String(value || '').split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : '-';
}

function buildProductionExportPages(reports, maxRows = PRODUCTION_EXPORT_ROWS_PER_PAGE) {
  const pages = [];
  let page = [];
  let usedRows = 0;
  for (const report of reports) {
    const items = Array.isArray(report.items) && report.items.length ? report.items : [null];
    for (let offset = 0; offset < items.length;) {
      if (usedRows === maxRows) {
        pages.push(page);
        page = [];
        usedRows = 0;
      }
      const batch = items.slice(offset, offset + maxRows - usedRows);
      page.push({ code: report.code, items: batch });
      offset += batch.length;
      usedRows += batch.length;
    }
  }
  if (page.length) pages.push(page);
  return pages;
}

function productionExportText(ctx, value, x, y, width, font = '500 28px Arial', color = '#294235') {
  ctx.font = font;
  ctx.fillStyle = color;
  const source = String(value || '-').replace(/\s+/g, ' ').trim() || '-';
  let fitted = source;
  while (fitted.length > 1 && ctx.measureText(fitted).width > width) {
    fitted = `${fitted.slice(0, -2)}…`;
  }
  ctx.fillText(fitted, x, y);
}

function productionExportRoundRect(ctx, x, y, width, height, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}

function drawProductionExportPage(ctx, segments, statuses, workDate, pageNumber, pageCount) {
  const margin = 72;
  const rowWidth = PRODUCTION_EXPORT_WIDTH - margin * 2;
  const columns = [margin + 24, margin + 300, margin + 650, margin + 950,
    margin + 1110, margin + 1280, margin + 1650, margin + 2010];
  const labels = ['GRUPO', 'FRENTE / SERVIÇO', 'ANALISTA', 'SETOR', 'SEÇÃO', 'FAZENDA', 'STATUS', 'ATUALIZAÇÃO'];
  const widths = [250, 320, 270, 130, 140, 340, 330, 200];
  const statusByCode = new Map(statuses.map(status => [status.code, status]));

  ctx.fillStyle = '#f3f7f4';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#176d38';
  ctx.fillRect(0, 0, ctx.canvas.width, 18);
  productionExportText(ctx, 'PRODUÇÃO AGRÍCOLA', margin, 92, 900, '700 50px Arial', '#173e29');
  productionExportText(ctx, `Posição global · ${formatProductionExportDate(workDate)}`, margin, 140, 950, '500 30px Arial', '#587264');
  productionExportText(ctx, `${pageNumber} / ${pageCount}`, PRODUCTION_EXPORT_WIDTH - margin - 160, 103, 160, '700 31px Arial', '#176d38');

  let y = 190;
  for (const segment of segments) {
    productionExportRoundRect(ctx, margin, y, rowWidth, 66, 12, '#e2eee5');
    productionExportText(ctx, `${segment.code} · ${PRODUCTION_EXPORT_UNIT_NAMES[segment.code] || segment.code}`,
      margin + 24, y + 43, 1450, '700 32px Arial', '#174e2d');
    y += 74;
    productionExportRoundRect(ctx, margin, y, rowWidth, 52, 8, '#d9e5dc');
    labels.forEach((label, index) => productionExportText(ctx, label, columns[index], y + 34,
      widths[index], '700 19px Arial', '#536f5d'));
    y += 52;

    for (const item of segment.items) {
      productionExportRoundRect(ctx, margin, y, rowWidth, PRODUCTION_EXPORT_ROW_HEIGHT - 4, 8, '#ffffff');
      if (!item) {
        productionExportText(ctx, 'Nenhum lançamento nesta unidade.', margin + 24, y + 58,
          1100, '500 29px Arial', '#718679');
        y += PRODUCTION_EXPORT_ROW_HEIGHT;
        continue;
      }
      const entry = item.entry || {};
      const configuredStatus = statusByCode.get(entry.status);
      const colors = PRODUCTION_EXPORT_STATUS_COLORS[configuredStatus?.style_key]
        || PRODUCTION_EXPORT_STATUS_COLORS.waiting;
      const updated = item.is_current_day ? 'Hoje' : (entry.work_date
        ? formatProductionExportDate(entry.work_date) : 'Sem registro');

      productionExportText(ctx, item.group_name, columns[0], y + 55, widths[0]);
      productionExportText(ctx, item.service_name, columns[1], y + 42, widths[1], '700 28px Arial');
      productionExportText(ctx, entry.observation || 'Sem observação', columns[1], y + 75,
        widths[1], '400 19px Arial', '#7b8d81');
      productionExportText(ctx, item.owner_name, columns[2], y + 55, widths[2]);
      productionExportText(ctx, entry.sector, columns[3], y + 55, widths[3]);
      productionExportText(ctx, entry.section, columns[4], y + 55, widths[4]);
      productionExportText(ctx, entry.farm, columns[5], y + 55, widths[5]);
      productionExportRoundRect(ctx, columns[6] - 8, y + 21, widths[6], 50, 8, colors[0]);
      productionExportText(ctx, configuredStatus?.name || entry.status || 'Sem status',
        columns[6] + 5, y + 55, widths[6] - 24, '700 24px Arial', colors[1]);
      productionExportText(ctx, updated, columns[7], y + 55, widths[7],
        '600 25px Arial', item.is_current_day ? '#176f39' : '#986d22');
      y += PRODUCTION_EXPORT_ROW_HEIGHT;
    }
    y += 14;
  }
  productionExportText(ctx, 'Fonte: lançamentos da Produção Agrícola · Todos os analistas das unidades liberadas',
    margin, y + 36, rowWidth, '500 23px Arial', '#718679');
}

async function generateProductionReportImages(reports, statuses, workDate) {
  const pages = buildProductionExportPages(reports);
  if (!pages.length) throw new Error('Nenhuma unidade foi informada para a emissão.');
  const images = [];
  for (const [index, segments] of pages.entries()) {
    const canvas = document.createElement('canvas');
    const rows = segments.reduce((total, segment) => total + segment.items.length, 0);
    canvas.width = PRODUCTION_EXPORT_WIDTH;
    canvas.height = 260 + segments.length * 140 + rows * PRODUCTION_EXPORT_ROW_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não foi possível preparar a imagem da Produção Agrícola.');
    drawProductionExportPage(ctx, segments, statuses, workDate, index + 1, pages.length);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      result => result ? resolve(result) : reject(new Error('Não foi possível gerar a imagem da Produção Agrícola.')),
      'image/png'
    ));
    images.push(blob);
  }
  return images;
}
