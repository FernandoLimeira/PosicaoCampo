// Utilitários puros de formatação: texto, datas (fuso de São Paulo) e números.
// Sem efeitos colaterais: pode ser carregado em qualquer página ou teste.
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Data e hora no fuso operacional (America/Sao_Paulo), independente do fuso do navegador.
const SAO_PAULO_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

function saoPauloDateParts(date = new Date()) {
  const safeDate = date instanceof Date ? date : new Date(date);
  const parts = Object.fromEntries(SAO_PAULO_DATE_FORMAT.formatToParts(safeDate)
    .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`
  };
}

// Dia operacional (AAAA-MM-DD) no fuso de São Paulo.
function saoPauloIsoDate(date = new Date()) {
  return saoPauloDateParts(date).isoDate;
}

// "AAAA-MM-DD" → "DD/MM/AAAA". Outros valores voltam como texto ("-" quando vazios).
function formatIsoDateBr(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '-');
}

// Converte números digitados no padrão brasileiro (1.234,5) ou com ponto decimal (1234.5).
function parseBrNumber(value) {
  let text = String(value ?? '').trim();
  if (!text) return NaN;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) text = text.replaceAll('.', '').replace(',', '.');
  } else if (lastComma >= 0) {
    if (text.indexOf(',') === lastComma) text = text.replace(',', '.');
  } else if (text.indexOf('.') !== lastDot) {
    text = text.replaceAll('.', '');
  }
  return Number(text);
}

function greetingForHour(hour) {
  return hour >= 5 && hour < 12 ? 'Bom dia!' : hour >= 12 && hour < 18 ? 'Boa tarde!' : 'Boa noite!';
}

function compareFrontLabels(a, b) {
  const left = String(a ?? '').trim();
  const right = String(b ?? '').trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

function formatServerTimestamp(timestamp, timeZone) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return '-';
  return new Date(numeric * 1000).toLocaleString('pt-BR', {
    ...(timeZone ? { timeZone } : {}),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Ícone de lápis usado em todos os botões "Editar" do sistema (o texto fica em title/aria-label).
// Ícone de lixeira usado em todos os botões de apagar/excluir/remover.
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/></svg>';
const PENCIL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/></svg>';
