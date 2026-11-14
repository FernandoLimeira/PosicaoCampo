// withSection: no Polo MS a imagem identifica a frente pela seção, então
// lançamentos da mesma frente na mesma seção viram uma etiqueta só (o mais
// recente vale); sem seção lançada, a chave volta a ser o setor.
function consolidateProductionItems(items, { withSection = false } = {}) {
  const latestBySector = new Map();
  items.forEach((item, index) => {
    const sector = item.entry?.sector?.trim();
    if (!sector) {
      latestBySector.set(`item:${index}`, { item, index });
      return;
    }
    const front = item.service_front_id == null
      ? `${item.group_name || ''}\u0000${item.service_name || ''}`
      : `id:${item.service_front_id}`;
    const section = withSection ? String(item.entry?.section || '').trim().toLocaleUpperCase('pt-BR') : '';
    const place = section ? `S:${section}` : sector.toLocaleUpperCase('pt-BR');
    const key = `${front}\u0000${place}`;
    const previous = latestBySector.get(key);
    const date = item.entry?.work_date || '';
    const previousDate = previous?.item.entry?.work_date || '';
    const updated = Number(item.entry?.updated_at) || 0;
    const previousUpdated = Number(previous?.item.entry?.updated_at) || 0;
    const entryId = Number(item.entry?.id) || 0;
    const previousId = Number(previous?.item.entry?.id) || 0;
    if (!previous || date > previousDate ||
        (date === previousDate && (updated > previousUpdated ||
          (updated === previousUpdated && entryId > previousId)))) {
      latestBySector.set(key, { item, index: previous?.index ?? index });
    }
  });
  return [...latestBySector.values()].sort((a, b) => a.index - b.index).map(value => value.item);
}
