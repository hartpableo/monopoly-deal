// UI Notification & Toast Helpers

import { escapeHtml } from './utils.js';

export function showToast(title, message, icon = 'ℹ️', type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${message ? `<div class="toast-desc">${escapeHtml(message)}</div>` : ''}
    </div>
  `;

  toast.addEventListener('click', () => {
    toast.classList.add('toast-fadeout');
    setTimeout(() => toast.remove(), 250);
  });

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('toast-fadeout');
      setTimeout(() => toast.remove(), 250);
    }
  }, 4500);

  while (container.children.length > 4) {
    container.removeChild(container.firstChild);
  }
}
