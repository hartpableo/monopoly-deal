// Game Controller, Lifecycle Events, and Polling Orchestration

import { state, saveSession, purgeSessionStorage } from './state.js';
import { apiRequest } from './api.js';
import { render } from './render.js';
import { initAudioUnlock } from './audio.js';
import { copyToClipboard } from './utils.js';
import { showToast } from './ui.js';
import {
  stopVoiceChat,
  toggleMic,
  connectToAllPeers,
  pollSignals,
  clearAllSpeakingHoldTimers
} from './voice.js';
import {
  closeModal,
  closeInspectModal,
  closeExcessCardsModal,
  closePaymentModal
} from './modals.js';

let copyTimeout = null;

export async function handleCopyGameId() {
  const gameId = state.currentGameId || document.getElementById('lobby-room-code')?.textContent?.trim();
  if (!gameId || gameId === '------') return;

  const success = await copyToClipboard(gameId);
  if (!success) {
    showToast('Failed to copy', 'Please copy manually.', '⚠️', 'danger');
    return;
  }

  const copyBtn = document.getElementById('btn-copy-game-id');
  if (copyBtn) {
    copyBtn.innerHTML = '<span class="copy-icon">✓</span> <span class="copy-text">Copied!</span>';
    copyBtn.classList.add('copied');
    if (copyTimeout) clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => {
      copyBtn.innerHTML = '<span class="copy-icon">📋</span> <span class="copy-text">Copy ID</span>';
      copyBtn.classList.remove('copied');
    }, 2000);
  }

  showToast('Game ID Copied!', gameId, '📋', 'info');
}

export function setupLobbyEvents() {
  document.getElementById('btn-create-game').addEventListener('click', async () => {
    const nameInput = document.getElementById('input-player-name');
    const name = nameInput.value.trim();
    if (!name) {
      alert('Please enter your name.');
      nameInput.focus();
      return;
    }
    try {
      const res = await apiRequest('create', 'POST', { name });
      saveSession(res.game_id, res.player_id, name);
      state.currentGameState = res.state;
      render();
      startPolling();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('btn-join-game').addEventListener('click', async () => {
    const nameInput = document.getElementById('input-player-name');
    const name = nameInput.value.trim();
    if (!name) {
      alert('Please enter your name.');
      nameInput.focus();
      return;
    }
    const gameId = document.getElementById('input-room-code').value.trim().toUpperCase();
    if (!gameId) return alert('Please enter a 6-character room code.');

    try {
      const res = await apiRequest('join', 'POST', { game_id: gameId, name });
      saveSession(res.game_id, res.player_id, name);
      state.currentGameState = res.state;
      render();
      startPolling();
    } catch (err) {
      alert(err.message);
    }
  });

  const lobbyPlayersList = document.getElementById('lobby-players');
  if (lobbyPlayersList) {
    lobbyPlayersList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-remove-player');
      if (!btn) return;
      const targetId = btn.dataset.playerId;
      const targetName = btn.dataset.playerName || 'this player';
      if (!targetId || !state.currentGameId || !state.currentPlayerData) return;
      if (!confirm(`Remove ${targetName} from the lobby?`)) return;

      try {
        const res = await apiRequest('remove_player', 'POST', {
          game_id: state.currentGameId,
          player_id: state.currentPlayerData.id,
          target_player_id: targetId
        });
        state.currentGameState = res.state;
        render();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  const copyBtn = document.getElementById('btn-copy-game-id');
  if (copyBtn) {
    copyBtn.addEventListener('click', handleCopyGameId);
  }

  const roomCodeBox = document.getElementById('lobby-room-code');
  if (roomCodeBox) {
    roomCodeBox.addEventListener('click', handleCopyGameId);
  }

  const roomBadge = document.getElementById('room-badge');
  if (roomBadge) {
    roomBadge.addEventListener('click', handleCopyGameId);
  }
}

export function clearSession() {
  stopVoiceChat();
  clearInterval(state.pollTimer);
  clearInterval(state.signalTimer);
  state.speakingPlayers.clear();
  clearAllSpeakingHoldTimers();
  purgeSessionStorage();
  showLobby();
}

export function showLobby() {
  document.getElementById('lobby-view').classList.remove('hidden');
  document.getElementById('game-view').classList.add('hidden');
  document.getElementById('room-badge').classList.add('hidden');
  document.getElementById('turn-badge')?.classList.add('hidden');
  document.getElementById('actions-badge')?.classList.add('hidden');
  document.getElementById('btn-toggle-mic')?.classList.add('hidden');
  document.getElementById('btn-end-turn')?.classList.add('hidden');
  document.getElementById('btn-leave-game')?.classList.add('hidden');
  document.getElementById('lobby-room-info')?.classList.add('hidden');
  const codeEl = document.getElementById('lobby-room-code');
  if (codeEl) codeEl.textContent = '------';
  const playersList = document.getElementById('lobby-players');
  if (playersList) {
    playersList.innerHTML = '<li class="lobby-empty-hint">Create or join a room to see players.</li>';
  }
  const startBtn = document.getElementById('btn-start-game');
  if (startBtn) {
    startBtn.classList.add('hidden');
  }
  closeExcessCardsModal();
  closePaymentModal();
  closeModal();
  closeInspectModal();
  state.lastSeenExcessNotifTimestamp = 0;
}

export function setupGameEvents() {
  document.getElementById('btn-start-game').addEventListener('click', async () => {
    try {
      const res = await apiRequest('start', 'POST', {
        game_id: state.currentGameId,
        player_id: state.currentPlayerData.id
      });
      state.currentGameState = res.state;
      render();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('btn-end-turn').addEventListener('click', async () => {
    try {
      const res = await apiRequest('end_turn', 'POST', {
        game_id: state.currentGameId,
        player_id: state.currentPlayerData.id,
        discard_ids: []
      });
      state.currentGameState = res.state;
      render();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('btn-leave-game').addEventListener('click', async () => {
    if (confirm('Leave current game?')) {
      if (state.currentGameId && state.currentPlayerData) {
        try {
          await apiRequest('leave', 'POST', {
            game_id: state.currentGameId,
            player_id: state.currentPlayerData.id
          });
        } catch (e) {
          // ignore error if already purged
        }
      }
      clearSession();
    }
  });

  document.getElementById('btn-toggle-mic').addEventListener('click', toggleMic);
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  const modalCloseX = document.getElementById('modal-close-x');
  if (modalCloseX) modalCloseX.addEventListener('click', closeModal);
  const inspectCloseBtn = document.getElementById('inspect-close-btn');
  if (inspectCloseBtn) inspectCloseBtn.addEventListener('click', closeInspectModal);
  const inspectCloseX = document.getElementById('inspect-close-x');
  if (inspectCloseX) inspectCloseX.addEventListener('click', closeInspectModal);

  const excessCloseBtn = document.getElementById('excess-cards-confirm-btn');
  if (excessCloseBtn) excessCloseBtn.addEventListener('click', closeExcessCardsModal);
  const excessCloseX = document.getElementById('excess-close-x');
  if (excessCloseX) excessCloseX.addEventListener('click', closeExcessCardsModal);

  // Close modals on clicking backdrop
  const actionModal = document.getElementById('action-modal');
  if (actionModal) {
    actionModal.addEventListener('click', (e) => {
      if (e.target.id === 'action-modal') closeModal();
    });
  }
  const inspectModal = document.getElementById('inspect-modal');
  if (inspectModal) {
    inspectModal.addEventListener('click', (e) => {
      if (e.target.id === 'inspect-modal') closeInspectModal();
    });
  }
  const excessModal = document.getElementById('excess-cards-modal');
  if (excessModal) {
    excessModal.addEventListener('click', (e) => {
      if (e.target.id === 'excess-cards-modal') closeExcessCardsModal();
    });
  }

  // Escape key closes modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeInspectModal();
      closeExcessCardsModal();
    }
  });

  // Collapsible logs on mobile/compact view
  const logsHeader = document.getElementById('sidebar-logs-header');
  if (logsHeader) {
    logsHeader.addEventListener('click', () => {
      document.getElementById('sidebar-logs')?.classList.toggle('is-collapsed');
    });
  }
}

export function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(fetchGameState, 1500);

  // WebRTC signaling poll
  clearInterval(state.signalTimer);
  state.signalTimer = setInterval(pollSignals, 1500);
}

export async function fetchGameState() {
  if (!state.currentGameId || !state.currentPlayerData) return;
  try {
    const res = await apiRequest(`state&game_id=${state.currentGameId}&player_id=${state.currentPlayerData.id}`, 'GET');
    if (!res.state || !res.state.players || !res.state.players[state.currentPlayerData.id]) {
      console.warn('Current player no longer in game players list.');
      clearSession();
      alert('You were removed from the lobby.');
      return;
    }
    state.currentGameState = res.state;
    render();
    if (state.localStream) {
      connectToAllPeers();
    }
  } catch (err) {
    console.warn('Failed to poll state:', err);
    if (err.message && (err.message.includes('not found') || err.message.includes('Game not found') || err.message.includes('Game room not found'))) {
      clearSession();
    }
  }
}

export function initApp() {
  initAudioUnlock();
  setupLobbyEvents();
  setupGameEvents();

  // Restore player name in lobby if saved (ignore legacy default 'Player')
  const nameInput = document.getElementById('input-player-name');
  if (nameInput) {
    const savedName = localStorage.getItem('md_player_name') || state.currentPlayerData?.name;
    if (savedName && savedName.trim() && savedName.trim() !== 'Player') {
      nameInput.value = savedName.trim();
    } else {
      nameInput.value = '';
      localStorage.removeItem('md_player_name');
    }
    nameInput.addEventListener('input', () => {
      const val = nameInput.value.trim();
      if (val && val !== 'Player') {
        localStorage.setItem('md_player_name', val);
      } else {
        localStorage.removeItem('md_player_name');
      }
    });
  }

  // Pre-fill room code from URL query parameter (e.g. ?room=ABC123 or ?game_id=ABC123)
  const roomInput = document.getElementById('input-room-code');
  if (roomInput) {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room') || urlParams.get('game_id');
    if (roomParam && roomParam.trim()) {
      roomInput.value = roomParam.trim().toUpperCase();
    }
  }

  if (state.currentGameId && state.currentPlayerData) {
    fetchGameState().then();
    startPolling();
  } else {
    showLobby();
  }
}
