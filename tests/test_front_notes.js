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
  const expanded = ctx.fieldObservationText(extensive);
  assert(expanded.includes('<details class="field-observation-details">'));
  assert(expanded.includes('Ler observação completa'));
  assert(expanded.includes('Recolher observação'));
  assert(expanded.includes(extensive), 'O conteúdo completo permanece acessível na própria coluna');
  assert(!ctx.fieldObservationPoint({ text: extensive }).includes('<details'), 'A coluna apresenta o resumo e abre o popup ao clicar');
  assert(!ctx.fieldObservationPoint({ text: extensive }).includes(extensive));
  assert(ctx.fieldObservationText('Primeiro ponto\nSegundo ponto\nTerceiro ponto\nQuarto ponto').includes('<details'));
  assert(ctx.fieldObservationPoint({ text: 'Manutenção\r\nRetorno previsto às 15h' }).includes('Manutenção\nRetorno previsto às 15h'));
  assert(ctx.fieldFrontNoteForm().includes('name="highlighted" checked'));
  const history = ctx.fieldFrontNotesHistory({ entries: [{ id: 1, text: '<b>Observação</b>\nRetorno previsto às 15h.', author: 'Nome do analista oculto',
    sector: '101', shift: 'B', highlighted: true, resolved_at: 1, created_at: 1 }], total: 1 });
  assert(!history.includes('Concluído'));
  assert(history.includes('Reabrir ponto'));
  assert(!history.includes('<b>Observação</b>'));
  assert(!history.includes('Nome do analista oculto'), 'O popup mostra somente o conteúdo e o contexto da observação');
  assert(history.includes('&lt;b&gt;Observação&lt;/b&gt;\nRetorno previsto às 15h.'));
  assert(!history.includes('Turno B'));
  assert(!history.includes('Setor 101'));
  const pagedNotes = Array.from({ length: 7 }, (_, index) => ({ id: index + 1, text: `Ocorrência ${index + 1}` }));
  const allPages = [1, 2, 3].map(page => ctx.fieldFrontNotesHistory({ entries: pagedNotes, total: 7 }, page));
  assert(allPages[0].includes('1–3 de 7 observações'));
  assert(!allPages[0].includes('Ocorrência 4'));
  assert(allPages[1].includes('4–6 de 7 observações'));
  assert(allPages[2].includes('7–7 de 7 observações'));
  for (let index = 1; index <= 7; index += 1) assert.equal(allPages.filter(html => html.includes(`Ocorrência ${index}`)).length, 1);
  const fullSummary = ctx.fieldFrontNotesHistory({ entries: pagedNotes, total: 7 }, 1, true);
  for (let index = 1; index <= 7; index += 1) assert(fullSummary.includes(`Ocorrência ${index}`));
  assert(!fullSummary.includes('data-field-notes-page'), 'Todas as observações em aberto aparecem juntas no resumo');
  vm.runInContext('moduleAccess.dashboard.edit = false;', ctx);
  assert(!ctx.fieldNotePreview('02', 1).includes('Adicionar observação'));
  assert(!ctx.fieldFrontNoteForm().includes('<form'));
  assert(!ctx.fieldFrontNotesHistory({ entries: [{ id: 1, highlighted: true }], total: 1 }).includes('data-field-note-id'));
  assert(ctx.fieldFrontNotesHistory({ entries: [{ id: 1 }], total: 2, next_cursor: 1 }).includes('Próximas'));
  assert.equal(ctx.fieldNotePreview('02', 1), '', 'A célula sem acontecimentos em aberto permanece vazia');
  assert(!ctx.fieldNotePreview('01', 0).includes('<button'), 'A coluna abre o resumo pelo clique na célula');
  const openModal = ctx.openModal;
  const loadHistory = ctx.loadFieldFrontHistory;
  let openedContext;
  ctx.openModal = () => {};
  ctx.loadFieldFrontHistory = context => { openedContext = context; };
  ctx.openFieldFrontDetails(0, true);
  assert.equal(openedContext.summaryOnly, true);
  assert(!elements.get('#field-front-detail-content').innerHTML.includes('<form'));
  assert(elements.get('#field-front-detail-content').innerHTML.includes('<h3>Observações</h3>'));
  ctx.openModal = openModal;
  ctx.loadFieldFrontHistory = loadHistory;

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
  const openDetails = ctx.openFieldFrontDetails;
  let summarySelection;
  ctx.openFieldFrontDetails = (...args) => { summarySelection = args; };
  const summaryCell = { dataset: { fieldSummaryIndex: '1' }, parent: grid };
  await grid.listeners.click({ target: { closest(selector) { return selector === '[data-field-summary-index]' ? summaryCell : null; } } });
  assert.deepEqual(summarySelection, [1, true]);
  ctx.openFieldFrontDetails = openDetails;
  // O botão de página preserva a paginação do servidor sem perder acontecimentos antigos.
  ctx.pagedNotes = pagedNotes;
  vm.runInContext('activeFieldFrontContext.history = { entries: pagedNotes.slice(0, 3), total: 4, next_cursor: 3 };', ctx);
  let requestedCursor;
  ctx.apiRequest = async path => {
    requestedCursor = path;
    return { entries: pagedNotes.slice(3, 4), total: 4, next_cursor: null };
  };
  const nextPage = { disabled: false, dataset: { fieldNotesPage: '2' } };
  await elements.get('#field-front-detail-modal').listeners.click({ target: { closest(selector) {
    return selector === '[data-field-notes-page]' ? nextPage : null;
  } } });
  assert(requestedCursor.includes('before_id=3'));
  assert(elements.get('#field-front-note-history').innerHTML.includes('Ocorrência 4'));
  assert(elements.get('#field-front-note-history').innerHTML.includes('4–4 de 4 observações'));
  assert.equal(nextPage.disabled, false);
  vm.runInContext('activeFieldFrontContext.summaryOnly = true;', ctx);
  let summaryQuery;
  ctx.apiRequest = async path => { summaryQuery = path; return { entries: pagedNotes.slice(0, 1), total: 1 }; };
  await ctx.loadFieldFrontHistory(vm.runInContext('activeFieldFrontContext', ctx));
  assert(summaryQuery.includes('open_only=1'));
  assert(!elements.get('#field-front-note-history').innerHTML.includes('data-field-note-id'));
  const manyOpenNotes = Array.from({ length: 207 }, (_, index) => ({ id: 207 - index, text: `Ponto aberto ${index + 1}` }));
  const summaryRequests = [];
  ctx.apiRequest = async path => {
    summaryRequests.push(path);
    const cursor = new URL(path, 'http://localhost').searchParams.get('before_id');
    const start = cursor === null ? 0 : manyOpenNotes.findIndex(entry => entry.id < Number(cursor));
    const entries = manyOpenNotes.slice(start, start + 100);
    return { entries, total: 207, next_cursor: start + 100 < 207 ? entries.at(-1).id : null };
  };
  await ctx.loadFieldFrontHistory(vm.runInContext('activeFieldFrontContext', ctx));
  assert.equal(summaryRequests.length, 3);
  assert(summaryRequests.every(path => path.includes('open_only=1')));
  const completeSummary = elements.get('#field-front-note-history').innerHTML;
  assert(completeSummary.includes('Ponto aberto 207'));
  assert.equal((completeSummary.match(/class="field-front-note-event"/g) || []).length, 207);
  assert(!completeSummary.includes('data-field-notes-page'));
  vm.runInContext('activeFieldFrontContext.summaryOnly = false;', ctx);
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
