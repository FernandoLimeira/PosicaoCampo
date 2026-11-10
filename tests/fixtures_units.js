// Dados de exemplo usados apenas nos testes (antes embutidos em app.js).
// Simulam a resposta de /api/units para exercitar painel, editor e exportação.
const DEMO_UNITS = [
  {
    code: 'PPT',
    name: 'PARAGUAÇU PAULISTA',
    border: 'critical',
    rows: [
      ['02', '1563', 'yellow', 'SOLO ÚMIDO'],
      ['03', '1094', 'yellow', 'SOLO ÚMIDO'],
      ['04', '1770', 'yellow', 'SOLO ÚMIDO'],
      ['05', '1770', 'yellow', 'SOLO ÚMIDO'],
      ['06', '1490', 'yellow', 'SOLO ÚMIDO'],
      ['07', '816', 'yellow', 'SOLO ÚMIDO'],
      ['08', '845', 'yellow', 'SOLO ÚMIDO']
    ],
    metrics: demoMetrics([0, 0, 0, 0, 0, 0]),
    observation: '-',
    changes: '-',
    rain: [['Eq. 02', 42, 52], ['Eq. 03', 38, 48], ['Eq. 04', 28, 42], ['Eq. 05', 26, 38], ['Eq. 06', 24, 36], ['Eq. 07', 22, 32], ['Eq. 08', 18, 28]]
  },
  {
    code: 'NRD',
    name: 'NARANDIBA',
    border: 'critical',
    rows: [
      ['08', '3108', 'yellow', 'SOLO ÚMIDO'], ['13', '3119', 'yellow', 'SOLO ÚMIDO'], ['14', '4519', 'yellow', 'SOLO ÚMIDO'],
      ['15', '3829', 'yellow', 'SOLO ÚMIDO'], ['16', '3855', 'yellow', 'SOLO ÚMIDO'], ['17', '3119', 'yellow', 'SOLO ÚMIDO'],
      ['18', '3456', 'yellow', 'SOLO ÚMIDO'], ['19', '3835', 'yellow', 'SOLO ÚMIDO'], ['20', '3826', 'yellow', 'SOLO ÚMIDO'],
      ['21', '3424', 'yellow', 'SOLO ÚMIDO'], ['22', '3428', 'yellow', 'SOLO ÚMIDO']
    ],
    metrics: demoMetrics([0, 0, 0, 0, 0, 0]),
    observation: '-',
    changes: '-',
    rain: [['Eq. 08', 40, 50], ['Eq. 13', 36, 45], ['Eq. 14', 32, 40], ['Eq. 15', 30, 38], ['Eq. 16', 28, 35], ['Eq. 17', 26, 32], ['Eq. 18', 24, 28], ['Eq. 19', 22, 26], ['Eq. 20', 20, 24], ['Eq. 21', 18, 22], ['Eq. 22', 16, 20]]
  },
  {
    code: 'RBR',
    name: 'RIO BRILHANTE',
    border: 'active',
    rows: [
      ['411', '90701', 'green', 'EM ATIVIDADE'], ['412', '90276', 'green', 'EM ATIVIDADE'], ['413', '90265', 'green', 'EM ATIVIDADE'],
      ['414', '90270', 'green', 'EM ATIVIDADE'], ['415', '90278', 'green', 'EM ATIVIDADE'], ['511', '84670', 'yellow', 'SOLO ÚMIDO'],
      ['611', '90441', 'green', 'EM ATIVIDADE']
    ],
    metrics: demoMetrics([958, 972, 872, 4, 985, 863]),
    observation: 'Tivemos chuva nas frentes de colheita 511 e 412.\nFrente 511 parou por solo úmido.',
    changes: 'Sem previsão',
    rain: [['Eq. 411', 12, 18], ['Eq. 412', 14, 22], ['Eq. 413', 16, 26], ['Eq. 414', 18, 28], ['Eq. 415', 20, 32], ['Eq. 511', 24, 40], ['Eq. 611', 16, 24]]
  },
  {
    code: 'PST',
    name: 'PASSA TEMPO',
    border: 'active',
    rows: [
      ['402', '67620', 'yellow', 'SOLO ÚMIDO'], ['402', '84598', 'green', 'EM ATIVIDADE'], ['403', '90284', 'green', 'EM ATIVIDADE'],
      ['404', '67646', 'yellow', 'SOLO ÚMIDO'], ['501', '67680', 'yellow', 'SOLO ÚMIDO']
    ],
    metrics: demoMetrics([450, 401, 583, 52, 377, 615]),
    observation: 'Operação com ajustes. A frente 403 está em atividade.',
    changes: 'Sem previsão',
    rain: [['Eq. 402', 10, 16], ['Eq. 403', 12, 20], ['Eq. 404', 14, 24], ['Eq. 501', 18, 28]]
  }
];

function demoMetrics(values) {
  const labels = [['🏭', 'INDÚSTRIA', 'TN/H', ''], ['⚙️', 'MOAGEM TURNO', 'TN/H', ''], ['🚚', 'ENTREGA TURNO', 'TN/H', ''],
    ['⬡', 'ESTOQUE', 'CARGAS', 'stock'], ['⚙️', 'MOAGEM ÚLTIMAS 3H', 'TN/H', ''], ['🚚', 'ENTREGA ÚLTIMAS 3H', 'TN/H', '']];
  return labels.map(([icon, label, unit, extra], index) => [icon, label, `${values[index] ?? 0} ${unit}`, extra]);
}

// Carrega os dados de exemplo no contexto do app.js como se viessem do servidor.
function loadDemoUnits(vm, ctx, version = 1) {
  ctx.__demoPayload = {
    units: JSON.parse(JSON.stringify(DEMO_UNITS)),
    meta: Object.fromEntries(DEMO_UNITS.map(unit => [unit.code, { version, updated_at: 0, updated_by: '-' }]))
  };
  vm.runInContext('applyServerPayload(__demoPayload);', ctx);
}

module.exports = { DEMO_UNITS, loadDemoUnits };
