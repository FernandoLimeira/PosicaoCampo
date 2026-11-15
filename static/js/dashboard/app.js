// Painel: ligação dos eventos e inicialização da página. Carregado por último.
// Depende de dashboard/dashboard.js, dashboard/field-notes.js, dashboard/editor.js e
// dashboard/management-report.js.
function setupEvents() {
  setupFieldViewEvents();
  document.addEventListener('click', event => {
    const fillButton = event.target.closest('#open-data-modal');
    if (!fillButton) return;
    openUnitEditor(selectedUnitIndex);
  });

  // Importar pesagem (ao lado do Preencher): atualiza moagem, entrega, estoque e o painel.
  document.querySelector('#dashboard-import-file')?.addEventListener('change', async event => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const label = document.querySelector('#dashboard-import-label');
    label?.classList.add('is-busy');
    try {
      const result = await importWeighingFile(file);
      const warnings = weighingImportWarnings(result);
      showToast(`${weighingImportMessage(result)}${warnings.length ? ` Atenção: ${warnings.join(' ')}` : ''}`, warnings.length > 0);
      if (await loadWeighingSummary()) renderDashboard();
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Não foi possível importar a pesagem.', true);
    } finally {
      input.value = '';
      label?.classList.remove('is-busy');
    }
  });

  document.addEventListener('report-unit-change', () => {
    // Escolher uma unidade no menu volta do relatório gerencial para o card dela.
    managementReportOpen = false;
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
  setupManagementReportEvents();
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
