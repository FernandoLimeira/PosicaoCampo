const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const labels = [];
const downloads = [];
const requests = [];
const button = { disabled: false, addEventListener(type, listener) { this.click = listener; } };
const status = { textContent: '' };
const document = {
  querySelector(selector) {
    if (selector === '#emit-global-production') return button;
    if (selector === '#production-emission-status') return status;
    return null;
  },
  addEventListener() {},
  createElement(name) {
    assert.equal(name, 'canvas');
    const canvas = {
      getContext() {
        return {
          canvas,
          fillRect() {}, beginPath() {}, roundRect() {}, fill() {},
          measureText(value) { return { width: value.length * 14 }; },
          fillText(value) { labels.push(value); }
        };
      },
      toBlob(callback, type) { callback({ type, width: this.width, height: this.height }); }
    };
    return canvas;
  }
};
const context = vm.createContext({
  document, Date, console,
  getReportUnit: () => 'PPT',
  showToast(message) { throw new Error(message); },
  downloadBlobFile(blob, name) { downloads.push({ blob, name }); },
  async apiRequest(url) {
    requests.push(url);
    if (url === '/api/production/access') return { access: { enabled: true, units: ['PPT', 'NRD'] } };
    if (url === '/api/production/statuses') return { statuses: [
      { code: 'ATIVO', name: 'Em atividade', style_key: 'active' }
    ] };
    if (url.includes('unit=PPT')) return { items: Array.from({ length: 19 }, (_, index) => ({
      group_name: 'Fertirrigação', service_name: `Frente ${index + 1}`, owner_name: 'Analista',
      is_current_day: index !== 0,
      entry: { sector: '3392', section: '10', farm: 'Fazenda', status: 'ATIVO',
        work_date: '2026-10-15', observation: 'Operação normal' }
    })) };
    if (url.includes('unit=NRD')) return { items: [] };
    throw new Error(`Consulta inesperada: ${url}`);
  }
});

for (const name of ['production-export.js', 'emissao.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js', name), 'utf8'), context);
}

(async () => {
  assert.equal(context.localProductionExportDate(new Date(2026, 9, 16)), '2026-10-16');
  assert.equal(context.buildProductionExportPages([{ code: 'PPT', items: Array(19).fill({}) },
    { code: 'NRD', items: [] }]).length, 2);

  await button.click({ currentTarget: button });
  assert.equal(button.disabled, false);
  assert.equal(downloads.length, 2);
  assert.ok(downloads.every(item => item.blob.type === 'image/png'));
  assert.match(downloads[0].name, /^Producao-Agricola-Global-\d{2}-\d{2}-\d{4}-Pagina-1\.png$/);
  assert.ok(requests.some(url => url.includes('unit=PPT') && url.includes('scope=all')));
  assert.ok(requests.some(url => url.includes('unit=NRD') && url.includes('scope=all')));
  assert.ok(!requests.some(url => url.includes('unit=RBR')));
  assert.ok(labels.includes('Nenhum lançamento nesta unidade.'));
  assert.ok(labels.includes('Frente 19'));
  assert.ok(labels.includes('15/10/2026'));
  assert.ok(labels.includes('Hoje'));
  assert.match(status.textContent, /2 imagens emitidas/);
})().catch(error => { console.error(error); process.exitCode = 1; });
