const assert = require('node:assert/strict');
const { context } = require('./test_reports.js');
const { EXPORT_SCRIPTS, loadScripts, pageScripts, withoutInitializeApp } = require('./page_scripts.js');

// A imagem CTT (Posição de Campo) não exibe mais informações de chuva:
// nem colunas TURNO/ACUM., nem o cabeçalho CHUVA, nem a barra de média/acumulado.
async function main() {
  const { ctx } = context();
  loadScripts(ctx, [...pageScripts('/'), ...EXPORT_SCRIPTS], withoutInitializeApp);

  const drawn = [];
  const canvasContext = new Proxy({
    measureText: text => ({ width: String(text).length * 5 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    fillText(text, x, y) { drawn.push({ text: String(text), x, y }); }
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  ctx.document.createElement = () => ({ width: 0, height: 0, getContext: () => canvasContext,
    toBlob(callback) { callback({ width: this.width, height: this.height }); } });

  const codes = ['PPT', 'NRD', 'RBR', 'PST'];
  const rainCases = [undefined, [], [['Frente 01', 0, '0,0']], [['Frente 01', 7.5, 19]],
    [['Frente 01', 3, ''], ['Frente 02', '', '7,5']]];
  for (const code of codes) {
    for (const rain of rainCases) {
      const source = { code, rows: [['01', '1000', 'green', 'EM ATIVIDADE'], ['02', '1001', 'green', 'EM ATIVIDADE']], rain,
        rainStartDate: '01/11' };
      const original = JSON.stringify(source);
      drawn.length = 0;
      await ctx.generateReportImageBlob(codes.map(other => other === code ? source : { code: other, rows: [], rain: [] }));
      assert(!drawn.some(item => ['TURNO', 'ACUM.', 'CHUVA'].includes(item.text)),
        `${code}: a imagem não deve desenhar cabeçalhos de chuva`);
      assert(!drawn.some(item => /^Média: Turno|^acum\.: desde|chuva/i.test(item.text)),
        `${code}: a imagem não deve desenhar a barra de média de chuva`);
      assert(drawn.some(item => item.text === '01') && drawn.some(item => item.text === '02'),
        `${code}: as frentes continuam na imagem`);
      assert(drawn.some(item => item.text === 'FRENTE') && drawn.some(item => item.text === 'STATUS'),
        `${code}: o cabeçalho da tabela é mantido`);
      assert.equal(JSON.stringify(source), original, 'A emissão deve preservar os dados cadastrados');
    }
  }
  console.log('OK: imagem CTT não exibe informações de chuva nas quatro unidades.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
