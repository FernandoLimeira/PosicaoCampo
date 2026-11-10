// Janela de confirmação do sistema, no lugar da caixa padrão do navegador
// (window.confirm). Retorna uma Promise<boolean>: true só quando o usuário confirma.
//
// askConfirmation({
//   title, message, details: ['linha', ...], kicker,
//   confirmLabel, cancelLabel, tone: 'danger' | 'warning' | 'default',
//   requireText: 'APAGAR'   // exige digitar o texto para liberar o botão
// })
const CONFIRM_DIALOG_ICONS = {
  danger: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>',
  warning: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/>',
  default: '<circle cx="12" cy="12" r="9"/><path d="M12 8v.01"/><path d="M12 11v5"/>'
};

let confirmDialogSequence = 0;

function isConfirmationOpen() {
  return Boolean(document.querySelector('.confirm-dialog-backdrop'));
}

function askConfirmation(options = {}) {
  const settings = typeof options === 'string' ? { message: options } : options;
  const {
    title = 'Confirmar ação',
    message = '',
    details = [],
    kicker = 'Confirmação',
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    tone = 'danger',
    requireText = ''
  } = settings;
  const toneKey = CONFIRM_DIALOG_ICONS[tone] ? tone : 'default';
  const id = `confirm-dialog-${++confirmDialogSequence}`;
  const previousFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop confirm-dialog-backdrop';
  backdrop.innerHTML = `
    <section class="confirm-dialog is-${toneKey}" role="alertdialog" aria-modal="true"
      aria-labelledby="${id}-title" aria-describedby="${id}-message">
      <div class="confirm-dialog-head">
        <span class="confirm-dialog-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${CONFIRM_DIALOG_ICONS[toneKey]}</svg>
        </span>
        <div>
          <span class="confirm-dialog-kicker">${escapeHtml(kicker)}</span>
          <h2 id="${id}-title">${escapeHtml(title)}</h2>
        </div>
      </div>
      <div class="confirm-dialog-body">
        <p id="${id}-message">${escapeHtml(message)}</p>
        ${details.length ? `<ul class="confirm-dialog-details">${details.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
        ${requireText ? `<label class="confirm-dialog-check" for="${id}-input">
          <span>Para confirmar, digite <strong>${escapeHtml(requireText)}</strong></span>
          <input id="${id}-input" type="text" autocomplete="off" spellcheck="false" />
        </label>` : ''}
      </div>
      <footer class="confirm-dialog-actions">
        <button class="modal-button secondary" type="button" data-confirm-cancel>${escapeHtml(cancelLabel)}</button>
        <button class="modal-button ${toneKey === 'default' ? 'save' : 'danger'}" type="button" data-confirm-accept ${requireText ? 'disabled' : ''}>${escapeHtml(confirmLabel)}</button>
      </footer>
    </section>`;
  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');

  const accept = backdrop.querySelector('[data-confirm-accept]');
  const cancel = backdrop.querySelector('[data-confirm-cancel]');
  const input = backdrop.querySelector('.confirm-dialog-check input');
  const matches = () => !requireText
    || String(input?.value || '').trim().toLocaleUpperCase('pt-BR') === requireText.toLocaleUpperCase('pt-BR');

  return new Promise(resolve => {
    const finish = confirmed => {
      backdrop.remove();
      const anyOpen = [...document.querySelectorAll('.modal-backdrop')].some(item => !item.hidden);
      if (!anyOpen) document.body.classList.remove('modal-open');
      if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) previousFocus.focus();
      resolve(confirmed);
    };
    accept.addEventListener('click', () => { if (matches()) finish(true); });
    cancel.addEventListener('click', () => finish(false));
    backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) finish(false); });
    input?.addEventListener('input', () => { accept.disabled = !matches(); });
    backdrop.addEventListener('keydown', event => {
      // Trata o Esc aqui para não fechar a janela que estiver por baixo.
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); return; }
      if (event.key === 'Enter' && event.target === input) { event.preventDefault(); if (matches()) finish(true); return; }
      if (event.key === 'Tab') {
        const focusable = [...backdrop.querySelectorAll('input, button:not(:disabled)')];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    // Em ações destrutivas o foco começa em "Cancelar" (ou no campo de confirmação).
    requestAnimationFrame(() => (input || (toneKey === 'default' ? accept : cancel)).focus());
  });
}
