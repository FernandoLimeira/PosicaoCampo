// Grupos de status da Produção Agrícola: fonte única de nome e cor.
// Cada status cadastrado pertence a um grupo (campo style_key). A tela de
// lançamentos, o cadastro e a imagem da troca de turno usam esta definição,
// então uma mudança aqui se reflete em todo o sistema.
const PRODUCTION_STATUS_GROUPS = [
  { key: 'active', name: 'Em atividade', summary: 'em atividade', color: '#76b82a' },
  { key: 'wet', name: 'Solo úmido / mudança / teste', summary: 'solo úmido / mudança', color: '#ffcc00' },
  { key: 'waiting', name: 'Aguardando atividade', summary: 'aguardando', color: '#b2b2b2' },
  { key: 'stopped', name: 'Parado / oficina / crítico', summary: 'parado / oficina', color: '#ef7d1a' }
];

function productionStatusGroup(key) {
  return PRODUCTION_STATUS_GROUPS.find(group => group.key === key)
    || PRODUCTION_STATUS_GROUPS.find(group => group.key === 'waiting');
}
