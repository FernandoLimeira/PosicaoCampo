const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { context } = require('./test_reports.js');

async function main() {
  const { ctx, elements } = context('?unit=PPT');
  vm.runInContext(fs.readFileSync(require.resolve('../static/js/historico.js'), 'utf8').replace(/loadHistory\(\);\s*$/, ''), ctx);
  const sample = { kind: 'front_note', unit_code: 'PPT', unit_name: 'Paraguaçu Paulista', front: '01',
    sector: '101', user_name: 'Analista <Teste>', text: 'Parada para manutenção.\nRetorno às 15h. <script>',
    created_at: 1700000000, highlighted: true, resolved_at: null };
  const html = ctx.historyItemHtml(sample);
  assert(html.includes('Frente 01 · Setor 101'));
  assert(html.includes('class="history-analyst">Analista &lt;Teste&gt;'));
  assert(html.includes('Parada para manutenção.\nRetorno às 15h. &lt;script&gt;'));
  assert(!html.includes('versão'));
  assert(ctx.historyItemHtml({ ...sample, resolved_at: 1 }).includes('Concluído'));
  assert(ctx.historyItemHtml({ kind: 'position', version: 3 }).includes('versão 3'));
  assert(ctx.historyItemHtml({ ...sample, shift: 'B' }).includes('Turno B'));
  ctx.entries = Array.from({ length: 7 }, (_, index) => ({ ...sample, id: index }));
  vm.runInContext('historyItems = entries;', ctx);
  ctx.renderHistoryPage();
  assert.equal((elements.get('#history-list').innerHTML.match(/history-item-occurrence/g) || []).length, 6);
  assert.equal((elements.get('#history-list').innerHTML.match(/history-day-heading/g) || []).length, 1);
  elements.get('#history-page-next').listeners.click();
  assert.equal((elements.get('#history-list').innerHTML.match(/history-item-occurrence/g) || []).length, 1);
  assert(elements.get('#history-page-info').textContent.includes('Página 2 de 2'));

  const pending = [];
  ctx.apiRequest = () => new Promise(resolve => pending.push(resolve));
  const old = ctx.loadHistory();
  const recent = ctx.loadHistory();
  pending[1]({ history: [{ ...sample, text: 'Acontecimento atual' }] });
  await recent;
  pending[0]({ history: [{ ...sample, text: 'Resposta antiga' }] });
  await old;
  assert(elements.get('#history-list').innerHTML.includes('Acontecimento atual'));
  assert(!elements.get('#history-list').innerHTML.includes('Resposta antiga'));
  console.log('OK: acontecimentos no histórico, destaque do analista, datas, texto seguro e paginação.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
