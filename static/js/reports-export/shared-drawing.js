// Emissão de imagens: primitivas de desenho em canvas, carregamento de imagens e cabeçalho.
// Compartilhado pelas emissões de Posição de Campo, Sacarose e Produção Agrícola.
// Saudação e data no fuso de São Paulo, independente do fuso do navegador.
function getHeaderDataForExport(generatedAt = new Date()) {
  const { hour, isoDate } = saoPauloDateParts(generatedAt);
  return {
    greeting: greetingForHour(hour).toUpperCase(),
    date: isoDate.split('-').reverse().join('/')
  };
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
