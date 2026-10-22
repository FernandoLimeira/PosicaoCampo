const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { context } = require('./test_reports.js');

async function main() {
  const { ctx } = context('?unit=PPT');
  vm.runInContext(fs.readFileSync(require.resolve('../static/js/app.js'), 'utf8').replace(/initializeApp\(\);\s*$/, ''), ctx);
  ctx.refreshEditorSaveStatus = () => {};
  const messages = [];
  ctx.showToast = message => messages.push(message);
  const observation = ctx.document.querySelector('#observation-input');
  observation.value = 'Observação anterior';
  const response = { unit: 'PPT', work_date: '2026-10-22', shift: 'A', total: 2, last_note_id: 12,
    suggested_text: 'Frente 01 · Setor 101\n• Manutenção em andamento\n• Retorno previsto às 07h' };
  const requests = [];
  ctx.apiRequest = async (path, options) => { requests.push({ path, options }); return response; };
  ctx.resetEditorObservations({ code: 'PPT' });
  await ctx.loadEditorObservations();
  assert.equal(observation.value, response.suggested_text);
  assert(!requests.some(request => request.options?.method === 'PUT'), 'Abrir não salva automaticamente');
  assert.equal(vm.runInContext('editorObservationContext.appliedPeriod.last_note_id', ctx), 12);

  observation.value += '\nEquipe já avisada.';
  const reviewed = observation.value;
  const savedPeriod = { work_date: response.work_date, shift: response.shift, last_note_id: 12 };
  ctx.resetEditorObservations({ code: 'PPT', observation_period: savedPeriod });
  ctx.apiRequest = async path => {
    assert(path.includes('after_id=12'));
    return { ...response, total: 0, suggested_text: '' };
  };
  await ctx.loadEditorObservations();
  assert.equal(observation.value, reviewed, 'Reabrir preserva a revisão sem repetir acontecimentos');
  ctx.apiRequest = async () => ({ ...response, total: 1, last_note_id: 13, suggested_text: 'Frente 02 · Setor 102\n• Aguardar pipa' });
  await ctx.loadEditorObservations();
  assert.equal(observation.value, reviewed + '\n\nFrente 02 · Setor 102\n• Aguardar pipa');
  assert.equal(vm.runInContext('editorObservationContext.appliedPeriod.last_note_id', ctx), 13);
  const latest = observation.value;
  ctx.apiRequest = async () => { throw new Error('Sem rede'); };
  await ctx.loadEditorObservations();
  assert.equal(observation.value, latest);

  ctx.resetEditorObservations({ code: 'PPT', observation_period: savedPeriod });
  ctx.apiRequest = async () => ({ ...response, shift: 'B', last_note_id: 20, suggested_text: 'Acontecimentos do novo turno' });
  await ctx.loadEditorObservations();
  assert.equal(observation.value, 'Acontecimentos do novo turno');

  // Consultas atrasadas não sobrescrevem digitação, janelas fechadas ou outra unidade.
  const pending = [];
  ctx.apiRequest = () => new Promise(resolve => pending.push(resolve));
  ctx.resetEditorObservations({ code: 'PPT' });
  const editing = ctx.loadEditorObservations();
  observation.value = 'Texto digitado pelo analista';
  pending[0](response);
  await editing;
  assert.equal(observation.value, 'Texto digitado pelo analista');
  assert.equal(vm.runInContext('editorObservationContext.appliedPeriod', ctx), null);

  ctx.resetEditorObservations({ code: 'PPT' });
  const closed = ctx.loadEditorObservations();
  ctx.document.querySelector('#data-modal').hidden = true;
  pending[1](response);
  await closed;
  assert.equal(observation.value, 'Texto digitado pelo analista');
  ctx.document.querySelector('#data-modal').hidden = false;
  ctx.resetEditorObservations({ code: 'PPT' });
  const previous = ctx.loadEditorObservations();
  ctx.resetEditorObservations({ code: 'NRD' });
  const recent = ctx.loadEditorObservations();
  pending[3]({ ...response, unit: 'NRD', shift: 'B', suggested_text: 'Somente NRD' });
  await recent;
  pending[2](response);
  await previous;
  assert.equal(observation.value, 'Somente NRD');
  ctx.resetEditorObservations({ code: 'NRD' });
  ctx.apiRequest = async () => ({ ...response, suggested_text: 'x'.repeat(10001) });
  await ctx.loadEditorObservations();
  assert.equal(observation.value.length, 10001, 'Texto extenso não pode ser cortado');
  assert(messages.some(message => message.includes('10.000')));
  console.log('OK: observação direta, revisão preservada, novos acontecimentos, turnos e consultas concorrentes.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
