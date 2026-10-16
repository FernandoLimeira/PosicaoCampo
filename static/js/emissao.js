function getSacarosePole(unitCode = getReportUnit()) {
  if (['RBR', 'PST'].includes(unitCode)) {
    return { code: 'MS', label: 'Polo MS', units: ['RBR', 'PST'] };
  }
  return { code: 'SP', label: 'Polo SP', units: ['NRD', 'PPT'] };
}

function updateSacaroseEmissionContext() {
  const pole = getSacarosePole();
  const description = document.querySelector('#sacarose-emission-description');
  const button = document.querySelector('#emit-global-sacarose');
  if (description) {
    description.textContent = `Filtro atual: ${getReportUnit()}. A emissão será do ${pole.label}, reunindo ${pole.units.join(' e ')}.`;
  }
  if (button) button.textContent = `Emitir Sacarose · ${pole.label}`;
}

document.querySelector('#emit-global-position')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const status = document.querySelector('#position-emission-status');
  button.disabled = true;
  status.textContent = 'Carregando a posição atual de todas as unidades…';
  try {
    const payload = await apiRequest('/api/units');
    const ordered = ['NRD', 'PPT', 'RBR', 'PST'].map(code => payload.units?.find(unit => unit.code === code));
    if (ordered.some(unit => !unit)) throw new Error('Cadastre as quatro unidades antes de emitir a Posição de Campo.');
    status.textContent = 'Gerando imagem em alta definição…';
    const blob = await generateReportImageBlob(ordered);
    downloadBlobFile(blob, `Posicao-de-Campo-Global-${new Date().toLocaleDateString('pt-BR').replaceAll('/', '-')}.png`);
    status.textContent = 'Posição de Campo emitida com sucesso.';
  } catch (error) {
    status.textContent = error.message || 'Não foi possível emitir a Posição de Campo.';
    showToast(status.textContent, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#emit-global-sacarose')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const status = document.querySelector('#sacarose-emission-status');
  const pole = getSacarosePole();
  button.disabled = true;
  status.textContent = `Carregando a Sacarose do ${pole.label}…`;
  try {
    const [sacarosePayload, sectorPayload] = await Promise.all([
      apiRequest('/api/sacarose'),
      apiRequest('/api/sector-base')
    ]);
    const positions = sacarosePayload.units || {};
    const sectors = Array.isArray(sectorPayload.items) ? sectorPayload.items : [];
    status.textContent = 'Gerando imagem em alta definição…';
    const blob = await generateSacaroseReportImageBlob(pole.units, positions, sectors);
    downloadBlobFile(blob, `Sacarose-${pole.code}-${new Date().toLocaleDateString('pt-BR').replaceAll('/', '-')}.png`);
    status.textContent = `Sacarose do ${pole.label} emitida com sucesso.`;
  } catch (error) {
    status.textContent = error.message || 'Não foi possível emitir a Sacarose.';
    showToast(status.textContent, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#emit-global-production')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const status = document.querySelector('#production-emission-status');
  button.disabled = true;
  status.textContent = 'Carregando os lançamentos da Produção Agrícola…';
  try {
    const { access } = await apiRequest('/api/production/access');
    const units = ['PPT', 'NRD', 'RBR', 'PST'].filter(code => access?.enabled && access.units?.includes(code));
    if (!units.length) throw new Error('Nenhuma unidade está liberada para a Produção Agrícola.');

    const workDate = localProductionExportDate();
    const [statusPayload, ...unitPayloads] = await Promise.all([
      apiRequest('/api/production/statuses?include_inactive=1'),
      ...units.map(async code => {
        const [itemsPayload, summaryPayload] = await Promise.all([
          apiRequest(`/api/production/my-items?unit=${code}&date=${workDate}&scope=all`),
          apiRequest(`/api/production/daily-summary?unit=${code}&date=${workDate}`)
        ]);
        return { items: itemsPayload.items || [], summary: summaryPayload.summary || null };
      })
    ]);
    const byUnit = new Map(units.map((code, index) => [code, unitPayloads[index]]));
    const reports = ['PPT', 'NRD', 'RBR', 'PST'].map(code => ({
      code, restricted: !byUnit.has(code), items: byUnit.get(code)?.items || [],
      summary: byUnit.get(code)?.summary || null
    }));
    status.textContent = 'Gerando imagem no formato da troca de turno…';
    const images = await generateProductionReportImages(reports, statusPayload.statuses || [], workDate);
    const suffix = workDate.split('-').reverse().join('-');
    images.forEach((blob, index) => {
      const page = images.length > 1 ? `-Pagina-${index + 1}` : '';
      downloadBlobFile(blob, `Producao-Agricola-Global-${suffix}${page}.png`);
    });
    status.textContent = `${images.length} ${images.length === 1 ? 'imagem emitida' : 'imagens emitidas'} com sucesso.`;
  } catch (error) {
    status.textContent = error.message || 'Não foi possível emitir a Produção Agrícola.';
    showToast(status.textContent, true);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('report-unit-change', () => {
  updateSacaroseEmissionContext();
  const status = document.querySelector('#sacarose-emission-status');
  if (status) status.textContent = '';
});

updateSacaroseEmissionContext();
