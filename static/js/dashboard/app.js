// Painel: ligação dos eventos e inicialização da página. Carregado por último.
// Depende de dashboard/dashboard.js, dashboard/field-notes.js e dashboard/editor.js.
function setupEvents() {
  setupFieldViewEvents();
  document.addEventListener('click', event => {
    const fillButton = event.target.closest('#open-data-modal');
    if (!fillButton) return;
    openUnitEditor(selectedUnitIndex);
  });

  document.addEventListener('report-unit-change', () => {
    editorObservationContext = null;
    editorObservationRequest += 1;
    closeAllModals();
    activeFieldFrontContext = null;
    fieldFrontNotesSummary = {};
    renderDashboard();
    refreshFieldFrontNotes().catch(error => console.error('Falha ao consultar observações.', error));
  });
  document.querySelector('#weighing-import-file')?.addEventListener('change', importWeighingFile);
  setupFieldNotesEvents();
  setupEditorEvents();
}

// Importa o Excel de pesagem da balança (cargas das 4 indústrias). A mesma
// liberação importada de novo é atualizada, então o arquivo pode ser reenviado.
async function importWeighingFile(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  const label = input.closest('label');
  label?.classList.add('is-busy');
  try {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const result = await apiRequest('/api/weighings/import', { method: 'POST', body: formData });
    const weighed = result.imported - result.pending;
    const format = value => Number(value).toLocaleString('pt-BR');
    showToast(`Pesagem importada: ${format(weighed)} ${weighed === 1 ? 'carga pesada' : 'cargas pesadas'}`
      + `${result.pending ? ` e ${format(result.pending)} no pátio` : ''}.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível importar a pesagem.', true);
  } finally {
    input.value = '';
    label?.classList.remove('is-busy');
  }
}

async function initializeApp() {
  buildUnitSelect();
  setupEvents();

  try {
    await loadServerState();
    try {
      await loadSectorBase({ render: true });
    } catch (sectorError) {
      console.warn('Não foi possível carregar a base de setores.', sectorError);
    }
    try {
      await refreshFieldFrontNotes();
    } catch (noteError) {
      console.warn('Não foi possível carregar as observações de frente.', noteError);
    }
  } catch (error) {
    console.error(error);
    if (window.location.protocol !== 'file:') {
      showToast('Não foi possível carregar os dados do servidor.');
    }
  }
}

// Compartilha o acompanhamento entre analistas sem recarregar o formulário aberto.
// startVisiblePolling (core/api.js) pausa a consulta enquanto a aba está oculta.
function refreshVisibleFieldNotes() {
  return refreshFieldFrontNotes().catch(error => console.warn('Não foi possível atualizar o acompanhamento.', error));
}

startVisiblePolling(refreshVisibleFieldNotes, 30000);

initializeApp();
