// Comunicação HTTP, downloads e agendamento de consultas periódicas.
async function apiRequest(path, options = {}) {
  // FormData define o próprio Content-Type (multipart com boundary).
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }

  if (response.status === 401) {
    window.location.href = '/login';
    const authError = new Error('Sessão expirada.');
    authError.status = 401;
    authError.payload = data;
    throw authError;
  }
  if (!response.ok) {
    const requestError = new Error(data.error || 'Erro de comunicação com o servidor.');
    requestError.status = response.status;
    requestError.payload = data;
    throw requestError;
  }
  return data;
}

// Importação do Excel de pesagem da balança (Posição de Campo e Entrega CTT).
// Cada importação substitui a base inteira: vale sempre o último SELECT importado.
async function importWeighingFile(file) {
  const formData = new FormData();
  formData.append('file', file, file.name);
  return apiRequest('/api/weighings/import', { method: 'POST', body: formData });
}

function weighingImportMessage(result) {
  const count = value => Number(value || 0).toLocaleString('pt-BR');
  const weighed = result.imported - result.pending;
  return `Base substituída. O arquivo continha ${count(weighed)} ${weighed === 1 ? 'carga pesada' : 'cargas pesadas'}`
    + `${result.pending ? ` e ${count(result.pending)} no pátio` : ''}.`
    + (result.extracted_at ? ' O painel usa as horas fechadas.' : '');
}

// Avisos da importação: instâncias que não são de PPT/NRD/RBR/PST, linhas sem liberação,
// frente ou peso válido e unidades sem nenhuma carga no arquivo.
function weighingImportWarnings(result) {
  const warnings = [];
  const ignored = Object.entries(result.ignored_instances || {});
  if (ignored.length) {
    warnings.push(`Ignoradas: ${ignored.map(([code, count]) => `INSTANCIA_ORIGEM ${code} (${count})`).join(', ')}`
      + ' — só valem 201 (PPT), 204 (NRD), 402 (RBR) e 401 (PST).');
  }
  if (result.invalid_rows) warnings.push(`${result.invalid_rows} linha(s) sem liberação, frente ou peso válido.`);
  const empty = Object.entries(result.by_unit || {}).filter(([, loads]) => !loads).map(([code]) => code);
  if (empty.length) warnings.push(`Sem cargas no arquivo: ${empty.join(', ')}.`);
  return warnings;
}

function downloadBlobFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Agenda uma consulta periódica que também roda ao voltar para a janela/aba.
// Enquanto a aba está oculta (document.visibilityState === 'hidden'), nada é executado.
// Retorna a função agendada (útil para testes); ela devolve o resultado da tarefa.
function startVisiblePolling(task, intervalMs) {
  let lastRun = 0;
  // "focus" e "visibilitychange" chegam juntos ao voltar para a aba: roda uma vez só.
  const run = () => {
    if (document.visibilityState === 'hidden' || Date.now() - lastRun < 1000) return undefined;
    lastRun = Date.now();
    return task();
  };
  setInterval(run, intervalMs);
  window.addEventListener('focus', run);
  document.addEventListener('visibilitychange', run);
  return run;
}
