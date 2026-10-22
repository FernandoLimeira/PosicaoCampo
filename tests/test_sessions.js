const assert = require('node:assert/strict');
const { context } = require('./test_reports.js');

async function main() {
  const session = context().ctx;
  const sessionTimer = session.intervals.find(interval => interval.delay === 30000);
  assert.ok(sessionTimer);
  let requests = 0;
  let finish;
  session.fetch = async () => {
    requests += 1;
    return new Promise(resolve => { finish = resolve; });
  };
  const firstCheck = sessionTimer.handler();
  await session.checkSessionStatus();
  assert.equal(requests, 1, 'Não deve haver verificações simultâneas de sessão');
  finish({ status: 200, ok: true, json: async () => ({ user: { id: 7 } }) });
  await firstCheck;
  session.document.visibilityState = 'hidden';
  await session.checkSessionStatus();
  assert.equal(requests, 1);
  session.document.visibilityState = 'visible';
  session.fetch = async () => { throw new Error('offline'); };
  await session.checkSessionStatus();
  assert.notEqual(session.window.location.href, '/login');
  session.fetch = async () => ({ status: 401, ok: false, json: async () => ({ error: 'Sessão expirada.' }) });
  await session.checkSessionStatus();
  assert.equal(session.window.location.href, '/login');
  assert.ok(!context('', null, 'PPT', '/', '').ctx.intervals.some(interval => interval.delay === 30000));
  console.log('OK: sessão revogada, verificações simultâneas, tela oculta e falha de rede.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
