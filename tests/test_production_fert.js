// Prévia do plano da fertirrigação (popup): a conta em JS é a mesma do servidor e da planilha
// "Logística Fertirrigação - NRD-2026" (frentes FT.54, FT.56, FT.57 e FT.59).
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadScripts } = require('./page_scripts.js');

const context = vm.createContext({
  console, location: { pathname: '/producao' }, window: { setTimeout },
  document: { querySelector: () => null, addEventListener() {} }
});
loadScripts(context, ['core/format.js', 'producao/production-fert.js']);

const defaults = { hours: 3.7, ha_per_hour: 6.19, capacity_m3: 53, speed_loaded: 29.7, speed_empty: 35.4,
  aux_h: 0.8, load_h: 0.3, unload_h: 0.3, unload_round_trip_h: 0.1 };
const fronts = {
  'FT.54': [{ tractors: 3, trucks: 2, flow: 35, radius: 42, params: { unload_h: 0 } }, [68.709, 1.8905778301886798, 3.7005820921075152, 7]],
  'FT.56': [{ tractors: 2, trucks: 4, flow: 30, radius: 49.8, params: { unload_h: 0 } }, [45.806, 1.0803301886792454, 4.183547337784626, 5]],
  'FT.57': [{ tractors: 3, trucks: 8, flow: 30, radius: 44.2, params: { unload_h: 0, speed_loaded: 29.4 } }, [68.709, 1.6204952830188681, 3.8519889311656863, 7]],
  'FT.59': [{ tractors: 2, trucks: 3, flow: 30, radius: 48.1, params: { unload_h: 0 } }, [45.806, 1.0803301886792454, 4.0782856816755118, 5]]
};
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`);
for (const [name, [input, [yieldHa, cvHour, cycle, needed]]] of Object.entries(fronts)) {
  const calc = context.fertCalculate(input, defaults);
  close(calc.yieldHa, yieldHa, `${name} rendimento`);
  close(calc.cvHour, cvHour, `${name} CV/h`);
  close(calc.cycle, cycle, `${name} ciclo`);
  assert.equal(calc.needed, needed, `${name} CVs`);
}
// Com o descarregamento padrão (0,3 h) a FT.54 precisa de 8 CVs; bate/volta usa 0,1 h.
assert.equal(context.fertCalculate({ tractors: 3, trucks: 2, flow: 35, radius: 42 }, defaults).needed, 8);
close(context.fertCalculate({ tractors: 3, trucks: 2, flow: 35, radius: 42, roundTrip: true }, defaults).cycle, 3.7005820921075152 + 0.1, 'bate/volta');
// Tratos de rua-mãe: rendimento ÷ 3. Sem vazão ou raio, não há CVs calculados.
close(context.fertCalculate({ tractors: 3, trucks: 0, flow: 35, radius: 42, tratos: 'TRATOS RUA MÃE' }, defaults).yieldHa, 68.709 / 3, 'rua-mãe');
assert.equal(context.fertCalculate({ tractors: 3, trucks: 1, flow: null, radius: 42 }, defaults).needed, null);
assert.match(context.fertBalanceHtml(-2), /faltam 2/);
assert.match(context.fertBalanceHtml(0), /is-ok/);
// Ciclo dos CVs (estimado): FT.54 com 2 CVs e raio de 42 km. Etapas: base 1,1 h (carregamento +
// auxiliar), ida 42/29,7 h, frente 0,3 h, volta 42/35,4 h; os CVs saem espaçados de meio ciclo.
vm.runInContext(`fertData = { equipment: [{ id: 1, prefix: '612', status: 'active' }, { id: 2, prefix: '615', status: 'active' },
  { id: 3, prefix: '621', status: 'workshop' }] };`, context);
const front = { radius_km: 42, trucks: [1, 2, 3], params: { round_trip: false } };
const midnight = new Date('2026-11-27T03:00:00Z');  // 00:00 em Brasília
const cycle = context.fertCyclePositions(front, defaults, midnight);
close(cycle.cycle, 1.1 + 42 / 29.7 + 0.3 + 42 / 35.4, 'ciclo da estrada');
assert.equal(cycle.trucks.map(item => `${item.truck.prefix}:${item.stage}`).join(','), '612:loading,615:loaded');  // 621 na oficina fica fora
close(cycle.trucks[1].progress, (cycle.cycle / 2 - 1.1) / (42 / 29.7), 'avanço do CV na ida');
assert.equal(context.fertCyclePositions({ radius_km: null, trucks: [], params: {} }, defaults, midnight), null);
// BASE GERAL: vazão → velocidade e ha/hora pelo espaçamento (igual ao servidor).
assert.equal(context.fertApplicationSpeed(35), 5);
assert.equal(context.fertApplicationSpeed(34.6), 5);
assert.equal(context.fertApplicationSpeed(11), null);
close(context.fertHaPerHourFromSpeed(5, 'simples'), 7.5, 'ha/h simples');
close(context.fertHaPerHourFromSpeed(5, 'combinado'), 6, 'ha/h combinado');
console.log('OK: prévia da fertirrigação igual à planilha.');
