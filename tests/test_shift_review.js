const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { context } = require('./test_reports.js');

async function main() {
  const { ctx } = context('?unit=PPT');
  vm.runInContext(fs.readFileSync(require.resolve('../static/js/app.js'), 'utf8').replace(/initializeApp\(\);\s*$/, ''), ctx);
  ctx.refreshEditorSaveStatus = () => {};
  const element = selector => ctx.document.querySelector(selector);
  const observation = element('#observation-input');
  observation.value = 'Observação oficial anterior';
  const response = { unit: 'PPT', work_date: '2026-10-22', shift: 'A', total: 2,
    suggested_text: 'Frente 01 · Setor 101\n• Manutenção em andamento\n• Retorno previsto às 07h' };
  const requests = [];
  ctx.apiRequest = async (path, options) => { requests.push({ path, options }); return response; };
  ctx.resetFieldShiftReview('PPT');
  await ctx.loadFieldShiftReview();
  assert.equal(observation.value, 'Observação oficial anterior', 'Consultar não pode sobrescrever a observação');
  assert.equal(element('#field-shift-date').value, '2026-10-22');
  assert.equal(element('#field-shift-select').value, 'A');
  assert.equal(element('#field-shift-draft').value, response.suggested_text);
  assert(!requests.some(request => request.options?.method === 'PUT'));
  element('#field-shift-draft').value += '\nEquipe já avisada.';
  ctx.applyFieldShiftReview();
  const reviewed = observation.value;
  assert(reviewed.includes('Equipe já avisada.'));
  assert.equal(vm.runInContext('fieldShiftReviewContext.appliedPeriod.shift', ctx), 'A');
  ctx.applyFieldShiftReview();
  assert.equal(observation.value, reviewed, 'Aplicar novamente não pode duplicar os pontos');
  element('#field-shift-draft').value = 'x'.repeat(10001);
  ctx.applyFieldShiftReview();
  assert.equal(observation.value, reviewed);
  assert(element('#field-shift-state').textContent.includes('Nenhum conteúdo foi cortado'));

  // Sem acontecimentos ou falha de rede: mantém o texto oficial e a revisão feita.
  ctx.apiRequest = async () => ({ ...response, total: 0, suggested_text: '' });
  await ctx.loadFieldShiftReview();
  assert(element('#field-shift-result').hidden);
  assert.equal(observation.value, reviewed);
  ctx.apiRequest = async () => { throw new Error('Sem rede'); };
  await ctx.loadFieldShiftReview();
  assert.equal(observation.value, reviewed);
  assert(element('#field-shift-apply').disabled);

  // Abrir outra unidade durante a consulta não deve misturar os acontecimentos.
  const pending = [];
  ctx.apiRequest = () => new Promise(resolve => pending.push(resolve));
  ctx.resetFieldShiftReview('PPT');
  const previous = ctx.loadFieldShiftReview();
  ctx.resetFieldShiftReview('NRD');
  assert.equal(element('#field-shift-load').disabled, false);
  const recent = ctx.loadFieldShiftReview();
  pending[1]({ ...response, unit: 'NRD', shift: 'B', suggested_text: 'Somente NRD' });
  await recent;
  pending[0](response);
  await previous;
  assert.equal(element('#field-shift-draft').value, 'Somente NRD');
  assert.equal(element('#field-shift-select').value, 'B');
  console.log('OK: revisão por turno, aplicação sem duplicação, preservação do texto e isolamento entre unidades.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
