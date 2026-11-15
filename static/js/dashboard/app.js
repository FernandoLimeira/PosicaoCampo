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
  setupFieldNotesEvents();
  setupEditorEvents();
}

async function initializeApp() {
  buildUnitSelect();
  setupEvents();

  try {
    await loadServerState();
    if (await loadWeighingSummary()) renderDashboard();
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
  return Promise.all([
    refreshFieldFrontNotes().catch(error => console.warn('Não foi possível atualizar o acompanhamento.', error)),
    // Nova importação de pesagem aparece sem recarregar a página.
    loadWeighingSummary().then(summary => { if (summary && serverStateReady) renderDashboard(); })
  ]);
}

startVisiblePolling(refreshVisibleFieldNotes, 30000);

initializeApp();
