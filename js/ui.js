/* Drobne elementy interfejsu: toasty */
export function toast(message, type = 'info', timeout = 3200) {
  const root = document.getElementById('toasts');
  if (!root) return;
  while (root.children.length >= 3) root.firstElementChild?.remove();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'ok' ? 'i-check' : type === 'error' ? 'i-close' : 'i-port';
  el.innerHTML = `<svg class="icon"><use href="#${icon}"/></svg><span></span>`;
  el.querySelector('span').textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(4px)';
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

export function setSaveStatus(text, state = '') {
  const el = document.getElementById('status-save');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-saving', state === 'saving');
}

export function formatTime(date) {
  if (!date) return '';
  return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function confirmAction(message) {
  return window.confirm(message);
}
