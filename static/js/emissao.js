document.querySelector('#emit-global-position').addEventListener('click', async event => {
  const button = event.currentTarget;
  const status = document.querySelector('#emission-status');
  button.disabled = true;
  status.textContent = 'Carregando a posição atual de todas as unidades…';
  try {
    const payload = await apiRequest('/api/units');
    const ordered = ['PPT', 'NRD', 'RBR', 'PST'].map(code => payload.units?.find(unit => unit.code === code));
    if (ordered.some(unit => !unit)) throw new Error('Cadastre as quatro unidades antes de emitir a posição global.');
    status.textContent = 'Gerando imagem em alta definição…';
    const blob = await generateReportImageBlob(ordered);
    downloadBlobFile(blob, `Posicao-Global-${new Date().toLocaleDateString('pt-BR').replaceAll('/', '-')}.png`);
    status.textContent = 'Posição global emitida com sucesso.';
  } catch (error) {
    status.textContent = error.message || 'Não foi possível emitir a posição global.';
    showToast(status.textContent, true);
  } finally {
    button.disabled = false;
  }
});
