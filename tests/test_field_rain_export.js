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
  const original = JSON.stringify(unit);
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

  for (const global of [false, true]) {
    drawn.length = 0;
    if (global) {
      await ctx.generateReportImageBlob(['PPT', 'NRD', 'RBR', 'PST'].map(code =>
        code === 'NRD' ? unit : { code, rows: [], rain: [] }));
    } else {
      await ctx.generateUnitReportImageBlob(unit);
    }
    for (const [index, values] of [['08', [7.5, 19]], ['13A', [11, 23]], ['13B', [17, 29]]]) {
      const front = drawn.find(item => item.text === index);
      assert(front, `A frente ${index} deve aparecer na imagem`);
      const rainCells = drawn.filter(item => item.y === front.y && item.x > front.x + 270)
        .map(item => Number(item.text.replace(',', '.')));
      assert.deepEqual(rainCells, values,
        `A emissão ${global ? 'global' : 'individual'} deve associar a chuva à frente ${index}`);
    }
    assert.equal(JSON.stringify(unit), original, 'A emissão deve preservar os dados cadastrados');
  }

  for (const defaultUnit of vm.runInContext('defaultUnits', ctx)) {
    const lookup = ctx.globalFrontRainMap(defaultUnit);
    for (const row of defaultUnit.rows) {
      assert(lookup.has(ctx.canonicalFrontKey(row[0])), `A chuva padrão de ${defaultUnit.code}/${row[0]} deve continuar associada`);
    }
  }
  assert.notEqual(ctx.canonicalFrontKey('13A'), ctx.canonicalFrontKey('13B'));
  assert.notEqual(ctx.canonicalFrontKey('1.3'), ctx.canonicalFrontKey('13'));
  assert.equal(ctx.canonicalFrontKey('Frente 008'), ctx.canonicalFrontKey('Eq. 08'));
  console.log('OK: chuva por frente nas imagens CCT individual/global e compatibilidade das quatro unidades.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
