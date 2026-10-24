const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { context } = require('./test_reports.js');

async function main() {
  const { ctx } = context();
  for (const name of ['app.js', 'export.js']) {
    vm.runInContext(fs.readFileSync(require.resolve(`../static/js/${name}`), 'utf8')
      .replace(/initializeApp\(\);\s*$/, ''), ctx);
  }

  const unit = {
    code: 'NRD', name: 'NARANDIBA',
    rows: [
      ['08', '3108', 'green', 'EM ATIVIDADE'],
      ['13A', '3119', 'green', 'EM ATIVIDADE'],
      ['13B', '4519', 'green', 'EM ATIVIDADE']
    ],
    rain: [['Eq. 08 — Setor 3108', '7,5', 19], ['Eq. 13A', 11, 23], ['Eq. 13B', 17, 29]]
  };
  const drawn = [];
  const canvasContext = new Proxy({
    measureText: text => ({ width: String(text).length * 5 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    fillText(text, x, y) { drawn.push({ text: String(text), x, y }); }
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  ctx.document.createElement = () => ({ width: 0, height: 0, getContext: () => canvasContext,
    toBlob(callback) { callback({ width: this.width, height: this.height }); } });
  ctx.loadImageAsset = async () => null;
  ctx.loadEmbeddedReportUnitSymbol = async () => null;
  ctx.loadReportUnitIconImage = async () => null;
  ctx.drawFittedText = (_canvas, text, x, y) => drawn.push({ text: String(text), x, y });

  async function checkImages(source, expected) {
    const original = JSON.stringify(source);
    for (const global of [false, true]) {
      drawn.length = 0;
      if (global) {
        await ctx.generateReportImageBlob(['PPT', 'NRD', 'RBR', 'PST'].map(code =>
          code === source.code ? source : { code, rows: [], rain: [] }));
      } else {
        await ctx.generateUnitReportImageBlob(source);
      }
      for (const [index, values] of expected) {
        const front = drawn.find(item => item.text === index);
        assert(front, `A frente ${index} deve aparecer na imagem`);
        const rainCells = drawn.filter(item => item.y === front.y && item.x > front.x + 270)
          .map(item => Number(item.text.replace(',', '.')));
        assert.deepEqual(rainCells, values,
          `A emissão ${global ? 'global' : 'individual'} deve associar a chuva à frente ${index}`);
      }
      assert.equal(JSON.stringify(source), original, 'A emissão deve preservar os dados cadastrados');
    }
  }
  await checkImages(unit, [['08', [7.5, 19]], ['13A', [11, 23]], ['13B', [17, 29]]]);

  // NRD cadastra chuva por equipe (EQ 3–12) e a posição por frente (13–22).
  // FT 8 é a frente 08; EQ 8 pertence à frente 18, com valores independentes.
  const nrd = {
    code: 'NRD', name: 'NARANDIBA',
    rows: ['08', ...Array.from({ length: 10 }, (_, i) => String(i + 13))]
      .map(front => [front, '1000', 'yellow', 'SOLO ÚMIDO']),
    rain: [['EQ - 3', 2, 31], ['EQ - 4', 2, 30], ['EQ - 5', 0, 60],
      ['EQ - 6', 0, 29], ['EQ - 7', 0, 36], ['EQ - 8', 0, 37],
      ['EQ - 9', 0, 35.9], ['EQ - 10', 1, 28], ['EQ - 11', 1, 28],
      ['EQ - 12', 2, 44], ['FT - 8', 2, 44]]
  };
  const expectedNrd = [['08', [2, 44]], ...nrd.rain.slice(0, 10)
    .map((row, index) => [String(index + 13), row.slice(1)])];
  await checkImages(nrd, expectedNrd);
  await checkImages({ ...nrd, rows: [...nrd.rows].reverse(), rain: [...nrd.rain].reverse() }, expectedNrd);

  // A conversão de equipes deve ficar restrita a NRD.
  for (const code of ['PPT', 'RBR', 'PST']) {
    await checkImages({ code, rows: [['03', '1000', 'green', 'EM ATIVIDADE']],
      rain: [['EQ - 3', 2, 31]] }, [['03', [2, 31]]]);
  }

  for (const defaultUnit of vm.runInContext('defaultUnits', ctx)) {
    const lookup = ctx.globalFrontRainMap(defaultUnit);
    for (const row of defaultUnit.rows) {
      assert(lookup.has(ctx.canonicalFrontKey(row[0])), `A chuva padrão de ${defaultUnit.code}/${row[0]} deve continuar associada`);
    }
  }

  // A ausência de chuva remove ambas as colunas em todas as unidades,
  // mesmo com cadastros antigos com valores positivos para outras frentes.
  const codes = ['PPT', 'NRD', 'RBR', 'PST'];
  const noRainCases = [undefined, [], [['Frente 01', '', '']],
    [['Frente 01', null, null]], [['Frente 01', '-', '—']],
    [['Frente 01', 0, '0,0']], [['Frente 01', 'não informado 12', 'NaN']],
    [['Frente 99', 12, 28], ['Frente 01', '', '']]];
  for (const code of codes) {
    for (const rain of noRainCases) {
      const source = {code, rows: [['01', '1000', 'green', 'EM ATIVIDADE']], rain};
      assert.equal(ctx.reportHasRainData(source), false, `${code}: chuva vazia/não associada`);
      for (const global of [false, true]) {
        drawn.length = 0;
        if (global) await ctx.generateReportImageBlob(codes.map(other => other === code ? source : {code: other, rows: [], rain: []}));
        else await ctx.generateUnitReportImageBlob(source);
        assert(!drawn.some(item => ['TURNO', 'ACUM.', 'CHUVA'].includes(item.text)),
          `${code}: emissão ${global ? 'global' : 'individual'} não deve desenhar cabeçalhos vazios`);
        assert(!drawn.some(item => item.text.startsWith('Média: Turno')),
          `${code}: emissão não deve reservar a barra de média sem chuva`);
        assert(drawn.some(item => item.text === '01'), 'As frentes continuam na imagem');
      }
    }
  }
  for (const values of [[3, ''], ['', '7,5'], [0, 7]]) {
    const reports = codes.map(code => ({code, rows: [['01', '1000', 'green', 'EM ATIVIDADE']],
      rain: [['Frente 01', ...(code === 'NRD' ? values : ['', ''])]]}));
    drawn.length = 0;
    await ctx.generateReportImageBlob(reports);
    for (const heading of ['TURNO', 'ACUM.', 'CHUVA']) {
      assert.equal(drawn.filter(item => item.text === heading).length, 1,
        `${heading}: somente a unidade preenchida deve mostrar as colunas`);
    }
  }
  assert.notEqual(ctx.canonicalFrontKey('13A'), ctx.canonicalFrontKey('13B'));
  assert.notEqual(ctx.canonicalFrontKey('1.3'), ctx.canonicalFrontKey('13'));
  assert.equal(ctx.canonicalFrontKey('Frente 008'), ctx.canonicalFrontKey('Eq. 08'));
  console.log('OK: chuva por frente nas imagens CCT individual/global e compatibilidade das quatro unidades.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
