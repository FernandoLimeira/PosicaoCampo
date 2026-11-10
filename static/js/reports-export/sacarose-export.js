// Emissão da imagem da Sacarose (posição de colheita por unidade).
// Depende de reports-export/shared-drawing.js.
const SACAROSE_REPORT_EXPORT_SCALE = 0.65;

function loadSacaroseHeaderIconImage() {
  return loadImageAsset('/assets/sacarose-icon.png', 'Não foi possível carregar o ícone da posição de colheita.');
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
