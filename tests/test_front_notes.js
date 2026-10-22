const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { context } = require('./test_reports.js');

function dashboard() {
  const fixture = context('?unit=PPT');
  vm.runInContext(fs.readFileSync(require.resolve('../static/js/app.js'), 'utf8').replace(/initializeApp\(\);\s*$/, ''), fixture.ctx);
  vm.runInContext("moduleAccess.dashboard = { view: true, edit: true };", fixture.ctx);
  fixture.ctx.document.querySelector('#units-grid').querySelectorAll = () => [];
  return fixture;
}

async function main() {
  const { ctx, elements } = dashboard();
  const points = ['Manutenção <script>alert(1)</script>', 'Aguardar transbordo', 'Retorno às 15h'];
  ctx.points = points;
  vm.runInContext(`fieldFrontNotesSummary = {'1': { count: 5, highlight_count: 4,
    highlights: points.map((text, id) => ({id, text})) }};`, ctx);
  const preview = ctx.fieldNotePreview('01', 0);
  for (const text of ['Manutenção', 'Aguardar transbordo', 'Retorno às 15h', '+ 1 ponto em aberto']) assert(preview.includes(text));
  assert(!preview.includes('<script>'));
  assert(preview.includes('&lt;script&gt;'));
  assert(preview.includes('<ul class="field-observation-points"'));
  assert.equal((preview.match(/<li class="field-observation-point"/g) || []).length, 3);
  assert(!preview.includes('<details'), 'Observações curtas aparecem completas');
  const extensive = 'Acompanhar manutenção. '.repeat(35) + '\nRetorno após liberação da equipe.';
  const expanded = ctx.fieldObservationPoint({ text: extensive });
  assert(expanded.includes('<details class="field-observation-details">'));
  assert(expanded.includes('Ler observação completa'));
  assert(expanded.includes('Recolher observação'));
  assert(expanded.includes(extensive), 'O conteúdo completo permanece acessível na própria coluna');
  assert(ctx.fieldObservationPoint({ text: 'Primeiro ponto\nSegundo ponto\nTerceiro ponto\nQuarto ponto' }).includes('<details'));
  assert(ctx.fieldObservationPoint({ text: 'Manutenção\r\nRetorno previsto às 15h' }).includes('Manutenção\nRetorno previsto às 15h'));
  assert(ctx.fieldFrontNoteForm().includes('name="highlighted" checked'));
  const history = ctx.fieldFrontNotesHistory({ entries: [{ id: 1, text: '<b>Observação</b>\nRetorno previsto às 15h.', author: 'Nome do analista oculto',
    sector: '101', shift: 'B', highlighted: true, resolved_at: 1, created_at: 1 }], total: 1 });
  assert(history.includes('Concluído'));
  assert(history.includes('Reabrir ponto'));
  assert(!history.includes('<b>Observação</b>'));
  assert(!history.includes('Nome do analista oculto'), 'O popup mostra somente o conteúdo e o contexto da observação');
  assert(history.includes('&lt;b&gt;Observação&lt;/b&gt;\nRetorno previsto às 15h.'));
  assert(history.includes('Turno B'));
  assert(history.includes('Setor 101'));
  vm.runInContext('moduleAccess.dashboard.edit = false;', ctx);
  assert(!ctx.fieldNotePreview('02', 1).includes('Adicionar observação'));
  assert(!ctx.fieldFrontNoteForm().includes('<form'));
  assert(!ctx.fieldFrontNotesHistory({ entries: [{ id: 1, highlighted: true }], total: 1 }).includes('data-field-note-id'));
  assert(ctx.fieldFrontNotesHistory({ entries: [{ id: 1 }], total: 2, next_cursor: 1 }).includes('Carregar anteriores'));

  // Uma consulta atrasada não pode esconder os dados de uma consulta mais recente.
  vm.runInContext("units[0].rows = [['01', '101', 'green', 'EM ATIVIDADE']];", ctx);
  const cell = { innerHTML: '', textContent: '' };
  const row = { dataset: { fieldFrontIndex: '0', fieldGroup: 'active' },
    querySelector: selector => selector === '.field-observation-cell' ? cell : { textContent: 'Frente 01' } };
  const grid = elements.get('#units-grid');
  grid.innerHTML = 'Tabela preservada';
  grid.querySelectorAll = selector => selector === '.field-front-row' ? [row] : [];
  const pending = [];
  ctx.apiRequest = () => new Promise(resolve => pending.push(resolve));
  const first = ctx.refreshFieldFrontNotes('PPT');
  const second = ctx.refreshFieldFrontNotes('PPT');
  const summaries = { '1': { count: 1, highlight_count: 1, highlights: [{ text: 'Atual' }] } };
  const period = { work_date: '2026-10-22', shift: 'B', start_at: Date.parse('2026-10-22T07:20:00-03:00') / 1000,
    end_at: Date.parse('2026-10-22T15:40:00-03:00') / 1000 };
  pending[1]({ period, summaries });
  await second;
  pending[0]({ summaries: { '1': { count: 1, highlight_count: 1, highlights: [{ text: 'Antigo' }] } } });
  await first;
  assert(ctx.fieldNotePreview('1', 0).includes('Atual'));
  assert(!ctx.fieldNotePreview('1', 0).includes('Antigo'));
  assert(cell.innerHTML.includes('Atual'));
  assert.equal(grid.innerHTML, 'Tabela preservada');
  assert.equal(elements.get('#preview-unit-shift').textContent, 'Turno B · 22/10/2026');
  const nextShift = ctx.refreshFieldFrontNotes('PPT');
  pending[2]({ period: { ...period, shift: 'C', start_at: period.end_at, end_at: period.end_at + 30000 }, summaries });
  await nextShift;
  assert.equal(elements.get('#preview-unit-shift').textContent, 'Turno C · 22/10/2026', 'O cabeçalho atualiza o turno mesmo sem novos apontamentos');

  // Salvar pelo formulário envia a unidade/frente/setor e atualiza os destaques sem novo lançamento.
  vm.runInContext("moduleAccess.dashboard.edit = true; activeFieldFrontContext = {unit: 'PPT', front: '1', sector: '101'};", ctx);
  ctx.setupEvents();
  const requests = [];
  ctx.apiRequest = async (path, options) => {
    requests.push({ path, options });
    if (options?.method === 'POST') return { entry: { id: 9 } };
    return path.includes('&front=') ? { entries: [], total: 0 } : { summaries: {} };
  };
  ctx.showToast = () => {};
  ctx.FormData = class { get(key) { return key === 'text' ? 'Aguardar liberação' : 'on'; } };
  const button = { disabled: false };
  const textarea = { value: 'Aguardar liberação' };
  const state = { textContent: '' };
  const form = { id: 'field-front-note-form', querySelector(selector) {
    return selector === '[type="submit"]' ? button : selector.includes('textarea') ? textarea : state;
  } };
  await elements.get('#field-front-detail-modal').listeners.submit({ target: form, preventDefault() {} });
  const writes = requests.filter(request => request.options?.method === 'POST');
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].options.body), {
    unit: 'PPT', front: '1', sector: '101', text: 'Aguardar liberação', highlighted: true
  });
  assert.equal(textarea.value, '');
  assert.equal(button.disabled, false);

  // Depois de salvar, falha na consulta não deve dizer que o lançamento falhou.
  ctx.apiRequest = async (_path, options) => {
    if (options?.method === 'POST') return { entry: { id: 10 } };
    throw new Error('Sem rede');
  };
  ctx.console = { ...console, error() {} };
  await elements.get('#field-front-detail-modal').listeners.submit({ target: form, preventDefault() {} });
  assert.match(state.textContent, /Registro salvo/);
  console.log('OK: pontos por frente, permissões, texto seguro, consultas concorrentes e gravação do acompanhamento.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
