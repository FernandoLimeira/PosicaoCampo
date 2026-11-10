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
  const run = () => (document.visibilityState === 'hidden' ? undefined : task());
  setInterval(run, intervalMs);
  window.addEventListener('focus', run);
  document.addEventListener('visibilitychange', run);
  return run;
}
