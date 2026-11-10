// Base de setores (Setor + Seção → descrição da fazenda) compartilhada pelo
// painel e pelo cadastro de setores. Cada página define o próprio loadSectorBase,
// que usa fetchSectorBase e depois redesenha a sua tela.
let sectorBaseItems = [];
let sectorBaseMap = new Map();
let sectorBaseLoaded = false;

function normalizeSectorLookupKey(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return /^-?\d+\.0+$/.test(text) ? text.split('.', 1)[0].toLocaleLowerCase('pt-BR') : text.toLocaleLowerCase('pt-BR');
}

function normalizeSectionLookupKey(value) {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

function rebuildSectorBaseMap() {
  sectorBaseMap = new Map();
  sectorBaseItems.forEach(item => {
    const key = normalizeSectorLookupKey(item?.sector);
    if (!key) return;
    if (!sectorBaseMap.has(key)) sectorBaseMap.set(key, []);
    sectorBaseMap.get(key).push(item);
  });

  sectorBaseMap.forEach(items => {
    items.sort((a, b) => compareFrontLabels(a?.section || '', b?.section || ''));
  });
}

function getSectorBaseItems(value) {
  return sectorBaseMap.get(normalizeSectorLookupKey(value)) || [];
}

function getSectorBaseItem(value, section = '') {
  const items = getSectorBaseItems(value);
  if (!items.length) return null;
  const sectionKey = normalizeSectionLookupKey(section);
  if (sectionKey) {
    return items.find(item => normalizeSectionLookupKey(item?.section) === sectionKey) || null;
  }
  return items[0] || null;
}

// Consulta /api/sector-base e reconstrói o índice por setor.
async function fetchSectorBase() {
  const data = await apiRequest('/api/sector-base');
  sectorBaseItems = Array.isArray(data?.items) ? data.items : [];
  sectorBaseLoaded = true;
  rebuildSectorBaseMap();
  return sectorBaseItems;
}
