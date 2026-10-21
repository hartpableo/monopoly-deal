// UI Notification & Toast Helpers

import { escapeHtml } from './utils.js';

export function showToast(title, message, icon = 'ℹ️', type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${message ? `<div class="toast-desc">${escapeHtml(message)}</div>` : ''}
    </div>
    <button type="button" class="toast-close-btn" aria-label="Close notification" title="Close">✕</button>
  `;

  let autoDismissTimer = null;

  const dismissToast = (e) => {
    if (e) {
      e.stopPropagation();
    }
    if (toast.classList.contains('toast-fadeout')) return;
    if (autoDismissTimer) {
      clearTimeout(autoDismissTimer);
      autoDismissTimer = null;
    }
    toast.classList.add('toast-fadeout');
    setTimeout(() => {
      toast.remove();
    }, 250);
  };

  const closeBtn = toast.querySelector('.toast-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', dismissToast);
  }

  toast.addEventListener('click', dismissToast);

  container.appendChild(toast);

  autoDismissTimer = setTimeout(() => {
    if (toast.parentNode) {
      dismissToast();
    }
  }, 4500);

  while (container.children.length > 4) {
    container.removeChild(container.firstChild);
  }
}
