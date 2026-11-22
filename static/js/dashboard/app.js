// Painel: ligação dos eventos e inicialização da página. Carregado por último.
// Depende de dashboard/dashboard.js, dashboard/field-notes.js, dashboard/editor.js e
// dashboard/management-report.js.
function setupEvents() {
  setupFieldViewEvents();
  document.addEventListener('click', event => {
    const fillButton = event.target.closest('#open-data-modal');
    if (!fillButton || managementReportHistorical()) return;
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
      if (await loadWeighingSummary()) await renderManagementClosing();
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Não foi possível importar a pesagem.', true);
    } finally {
      input.value = '';
      label?.classList.remove('is-busy');
    }
  });

  // A resposta pertence à unidade selecionada no clique, mesmo que a seleção mude enquanto carrega.
  document.querySelector('#dashboard-refresh')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const code = getReportUnit();
    button.disabled = true;
    try {
      await refreshDashboardUnit(code);
      if (getReportUnit() === code) {
        if (managementReportHistorical()) await renderManagementClosing();
        else {
          renderDashboard();
          await refreshFieldFrontNotes(code).catch(error => console.warn('Não foi possível atualizar o acompanhamento.', error));
        }
      } else renderDashboard();
      showToast(`Dados de ${code} atualizados.`);
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Não foi possível atualizar os dados.', true);
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener('report-unit-change', () => {
    editorObservationContext = null;
    editorObservationRequest += 1;
    closeAllModals();
    activeFieldFrontContext = null;
    fieldFrontNotesSummary = {};
    fieldCurrentPeriod = null;
    if (managementReportHistorical()) {
      renderManagementClosing().catch(error => showToast(error.message || 'Não foi possível carregar o fechamento.', true));
    } else {
      renderDashboard();
      refreshFieldFrontNotes().catch(error => console.error('Falha ao consultar observações.', error));
    }
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

// Sem atualização automática (processamento do servidor limitado): os dados são carregados ao
// abrir/recarregar a página e depois de importar a pesagem ou salvar no Preencher.
initializeApp();
