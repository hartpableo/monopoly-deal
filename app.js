// Monopoly Deal - Minimal Vanilla JS Client & WebRTC Voice Chat

let currentGameId = localStorage.getItem('md_game_id') || null;
let currentPlayerData = JSON.parse(localStorage.getItem('md_player_data') || 'null');
let currentGameState = null;
let pollTimer = null;
let signalTimer = null;

// WebRTC Voice Chat State
let localStream = null;
let isMicMuted = false;
let peerConnections = {}; // peerId -> RTCPeerConnection
let dataChannels = {}; // peerId -> RTCDataChannel
const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// Speaking Detection & Audio Analysis State
const speakingPlayers = new Set();
let audioContext = null;
let localAudioSource = null;
let localAudioAnalyser = null;
const peerAudioAnalysers = {}; // peerId -> { source, analyser }
const speakingHoldTimers = {}; // playerId -> setTimeout id
let audioMonitorTimer = null;
const SPEAKING_THRESHOLD = 12; // Frequency average threshold for voice detection
const SPEAKING_HOLD_MS = 400; // Debounce hold ms to prevent flickering during pauses

const COLOR_NAMES = {
  brown: 'Brown',
  dark_blue: 'Dark Blue',
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
  orange: 'Orange',
  pink: 'Pink',
  light_blue: 'Light Blue',
  railroad: 'Railroad',
  utility: 'Utility'
};

const COLOR_HEX = {
  brown: '#6e3b23',
  dark_blue: '#00479b',
  green: '#15803d',
  yellow: '#eab308',
  red: '#dc2626',
  orange: '#ea580c',
  pink: '#db2777',
  light_blue: '#38bdf8',
  railroad: '#1f2937',
  utility: '#64748b'
};

const SET_RULES = {
  brown: { size: 2, rent: [1, 2], name: 'Brown', color: '#6e3b23' },
  dark_blue: { size: 2, rent: [3, 8], name: 'Dark Blue', color: '#00479b' },
  green: { size: 3, rent: [2, 4, 7], name: 'Green', color: '#15803d' },
  yellow: { size: 3, rent: [2, 4, 6], name: 'Yellow', color: '#eab308' },
  red: { size: 3, rent: [2, 3, 6], name: 'Red', color: '#dc2626' },
  orange: { size: 3, rent: [1, 3, 5], name: 'Orange', color: '#ea580c' },
  pink: { size: 3, rent: [1, 2, 4], name: 'Pink', color: '#db2777' },
  light_blue: { size: 3, rent: [1, 2, 3], name: 'Light Blue', color: '#38bdf8' },
  railroad: { size: 4, rent: [1, 2, 3, 4], name: 'Railroad', color: '#1f2937' },
  utility: { size: 2, rent: [1, 2], name: 'Utility', color: '#64748b' }
};

document.addEventListener('DOMContentLoaded', () => {
  setupLobbyEvents();
  setupGameEvents();

  if (currentGameId && currentPlayerData) {
    fetchGameState();
    startPolling();
  } else {
    showLobby();
  }
});

/* ========================================================
   LOBBY & NAVIGATION
======================================================== */
function setupLobbyEvents() {
  document.getElementById('btn-create-game').addEventListener('click', async () => {
    const name = document.getElementById('input-player-name').value.trim() || 'Host';
    try {
      const res = await apiRequest('create', 'POST', { name });
      saveSession(res.game_id, res.player_id, name);
      currentGameState = res.state;
      render();
      startPolling();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('btn-join-game').addEventListener('click', async () => {
    const name = document.getElementById('input-player-name').value.trim() || 'Player';
    const gameId = document.getElementById('input-room-code').value.trim().toUpperCase();
    if (!gameId) return alert('Please enter a 6-character room code.');

    try {
      const res = await apiRequest('join', 'POST', { game_id: gameId, name });
      saveSession(res.game_id, res.player_id, name);
      currentGameState = res.state;
      render();
      startPolling();
    } catch (err) {
      alert(err.message);
    }
  });
}

function saveSession(gameId, playerId, name) {
  currentGameId = gameId;
  currentPlayerData = { id: playerId, name };
  localStorage.setItem('md_game_id', gameId);
  localStorage.setItem('md_player_data', JSON.stringify(currentPlayerData));
}

function clearSession() {
  stopVoiceChat();
  clearInterval(pollTimer);
  clearInterval(signalTimer);
  speakingPlayers.clear();
  clearAllSpeakingHoldTimers();
  localStorage.removeItem('md_game_id');
  localStorage.removeItem('md_player_data');
  currentGameId = null;
  currentPlayerData = null;
  currentGameState = null;
  showLobby();
}

function showLobby() {
  document.getElementById('lobby-view').classList.remove('hidden');
  document.getElementById('game-view').classList.add('hidden');
  document.getElementById('room-badge').classList.add('hidden');
  document.getElementById('turn-badge')?.classList.add('hidden');
  document.getElementById('actions-badge')?.classList.add('hidden');
  document.getElementById('btn-toggle-mic')?.classList.add('hidden');
  document.getElementById('btn-end-turn')?.classList.add('hidden');
  document.getElementById('btn-leave-game')?.classList.add('hidden');
}

/* ========================================================
   GAME ACTIONS & POLLING
======================================================== */
function setupGameEvents() {
  document.getElementById('btn-start-game').addEventListener('click', async () => {
    try {
      const res = await apiRequest('start', 'POST', {
        game_id: currentGameId,
        player_id: currentPlayerData.id
      });
      currentGameState = res.state;
      render();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('btn-end-turn').addEventListener('click', async () => {
    try {
      const myPlayer = currentGameState.players[currentPlayerData.id];
      let discardIds = [];

      if (myPlayer && myPlayer.hand && myPlayer.hand.length > 7) {
        const excess = myPlayer.hand.length - 7;
        const selected = prompt(`You have ${myPlayer.hand.length} cards. Choose ${excess} card index(es) to discard (0-based, comma separated, e.g. 0,1):`);
        if (!selected) return;
        const indices = selected.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        if (indices.length !== excess) {
          return alert(`Please select exactly ${excess} card(s).`);
        }
        discardIds = indices.map(idx => myPlayer.hand[idx]?.id).filter(Boolean);
      }

      const res = await apiRequest('end_turn', 'POST', {
        game_id: currentGameId,
        player_id: currentPlayerData.id,
        discard_ids: discardIds
      });
      currentGameState = res.state;
      render();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('btn-leave-game').addEventListener('click', async () => {
    if (confirm('Leave current game?')) {
      if (currentGameId && currentPlayerData) {
        try {
          await apiRequest('leave', 'POST', {
            game_id: currentGameId,
            player_id: currentPlayerData.id
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

  // Escape key closes modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeInspectModal();
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

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(fetchGameState, 1500);

  // WebRTC signaling poll
  clearInterval(signalTimer);
  signalTimer = setInterval(pollSignals, 1500);
}

async function fetchGameState() {
  if (!currentGameId || !currentPlayerData) return;
  try {
    const res = await apiRequest(`state&game_id=${currentGameId}&player_id=${currentPlayerData.id}`, 'GET');
    currentGameState = res.state;
    render();
    if (localStream) {
      connectToAllPeers();
    }
  } catch (err) {
    console.warn('Failed to poll state:', err);
  }
}

async function apiRequest(action, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`api.php?action=${action}`, options);
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || 'Server error');
  }
  return data;
}

/* ========================================================
   RENDERING
======================================================== */
function render() {
  if (!currentGameState) return;

  const myId = currentPlayerData.id;
  const isPlaying = currentGameState.status === 'playing';
  const isLobby = currentGameState.status === 'lobby';
  const isFinished = currentGameState.status === 'finished';

  document.getElementById('room-code-display').textContent = currentGameId;
  document.getElementById('room-badge').classList.remove('hidden');

  if (isLobby) {
    renderLobbyView();
    return;
  }

  document.getElementById('lobby-view').classList.add('hidden');
  document.getElementById('game-view').classList.remove('hidden');
  document.getElementById('turn-badge')?.classList.remove('hidden');
  document.getElementById('actions-badge')?.classList.remove('hidden');
  document.getElementById('btn-toggle-mic')?.classList.remove('hidden');
  document.getElementById('btn-end-turn')?.classList.remove('hidden');
  document.getElementById('btn-leave-game')?.classList.remove('hidden');

  const myPlayer = currentGameState.players[myId];
  const isMyTurn = currentGameState.turn.active_player_id === myId;
  const activePlayer = currentGameState.players[currentGameState.turn.active_player_id];

  // Turn status badge
  const turnBadge = document.getElementById('turn-badge');
  turnBadge.textContent = isMyTurn ? "Your Turn!" : `${activePlayer ? activePlayer.name : 'Unknown'}'s Turn`;
  turnBadge.className = `badge ${isMyTurn ? 'badge-turn' : 'badge-actions'}`;

  // Actions remaining
  const actionsBadge = document.getElementById('actions-badge');
  actionsBadge.textContent = `${currentGameState.turn.actions_left} Actions Left`;
  document.getElementById('btn-end-turn').disabled = !isMyTurn || isFinished;

  // Deck & Discard Table Display
  const deckCount = currentGameState.deck_count ?? 0;
  document.getElementById('deck-count').textContent = deckCount;

  const discardSlot = document.getElementById('discard-pile-slot');
  const discardTopLabel = document.getElementById('discard-top-label');
  const discardTopLegacy = document.getElementById('discard-top');

  if (currentGameState.discard && currentGameState.discard.length > 0) {
    const topCard = currentGameState.discard[currentGameState.discard.length - 1];
    if (discardTopLabel) discardTopLabel.textContent = topCard.name;
    if (discardTopLegacy) discardTopLegacy.textContent = topCard.name;

    if (discardSlot) {
      discardSlot.innerHTML = '';
      const cardEl = createCardElement(topCard, false);
      cardEl.style.transform = 'scale(0.78) rotate(-2deg)';
      cardEl.style.transformOrigin = 'center center';
      cardEl.style.cursor = 'pointer';
      cardEl.title = `Click to inspect: ${topCard.name}`;
      cardEl.addEventListener('click', () => openInspectModal(topCard));
      discardSlot.appendChild(cardEl);
    }
  } else {
    if (discardTopLabel) discardTopLabel.textContent = 'Empty';
    if (discardTopLegacy) discardTopLegacy.textContent = 'None';
    if (discardSlot) {
      discardSlot.innerHTML = `<div class="empty-slot-card">Empty Discard</div>`;
    }
  }

  // Opponents
  renderOpponents(myId);

  // My Table
  renderMyTable(myPlayer);

  // Logs
  renderLogs(currentGameState.logs || []);

  if (isFinished && currentGameState.winner_id) {
    const winnerName = currentGameState.players[currentGameState.winner_id]?.name || 'Player';
    alert(`🎉 Game Over! ${winnerName} won the game!`);
  }
}

function renderLobbyView() {
  document.getElementById('lobby-view').classList.remove('hidden');
  document.getElementById('game-view').classList.add('hidden');
  document.getElementById('turn-badge')?.classList.add('hidden');
  document.getElementById('actions-badge')?.classList.add('hidden');
  document.getElementById('btn-toggle-mic')?.classList.add('hidden');
  document.getElementById('btn-end-turn')?.classList.add('hidden');
  document.getElementById('btn-leave-game')?.classList.remove('hidden');

  const playersList = document.getElementById('lobby-players');
  playersList.innerHTML = '';

  const myId = currentPlayerData.id;
  const myPlayer = currentGameState.players[myId];

  Object.values(currentGameState.players).forEach(p => {
    const isSpeaking = speakingPlayers.has(p.id);
    const li = document.createElement('li');
    li.className = 'lobby-player-item';
    li.innerHTML = `
      <div class="player-identity">
        <span><strong>${escapeHtml(p.name)}</strong> ${p.is_host ? '(Host)' : ''}</span>
        <span class="speaking-indicator ${isSpeaking ? '' : 'hidden'}" id="lobby-speaking-${p.id}" title="Speaking">
          <span class="mic-icon">🎙️</span>
          <span class="speaking-wave">
            <span class="wave-bar"></span>
            <span class="wave-bar"></span>
            <span class="wave-bar"></span>
          </span>
        </span>
      </div>
    `;
    playersList.appendChild(li);
  });

  const startBtn = document.getElementById('btn-start-game');
  startBtn.classList.toggle('hidden', !myPlayer?.is_host);
  startBtn.disabled = Object.keys(currentGameState.players).length < 2;
}

function renderOpponents(myId) {
  const container = document.getElementById('opponents-container');
  container.innerHTML = '';

  Object.values(currentGameState.players).forEach(p => {
    if (p.id === myId) return;

    const isTurn = currentGameState.turn.active_player_id === p.id;
    const isSpeaking = speakingPlayers.has(p.id);
    const card = document.createElement('div');
    card.id = `opponent-card-${p.id}`;
    card.className = `opponent-card ${isTurn ? 'is-turn' : ''} ${isSpeaking ? 'is-speaking' : ''}`;

    const totalBank = (p.bank || []).reduce((acc, c) => acc + (c.value || 0), 0);

    card.innerHTML = `
      <div class="opponent-header">
        <div class="player-identity">
          <span class="opponent-name">${escapeHtml(p.name)}</span>
          <span class="speaking-indicator ${isSpeaking ? '' : 'hidden'}" id="speaking-indicator-${p.id}" title="Speaking">
            <span class="mic-icon">🎙️</span>
            <span class="speaking-wave">
              <span class="wave-bar"></span>
              <span class="wave-bar"></span>
              <span class="wave-bar"></span>
            </span>
          </span>
        </div>
        ${isTurn ? '<span class="turn-dice">🎲</span>' : ''}
      </div>
      <div class="player-stats">
        <span>Cards: <strong>${p.hand_count ?? 0}</strong></span>
        <span>Bank: <strong>$${totalBank}M</strong></span>
      </div>
      <div class="section-title">Properties:</div>
      <div class="sets-container" id="opponent-sets-${p.id}"></div>
    `;

    container.appendChild(card);
    renderPropertySets(p.property_sets || {}, card.querySelector(`#opponent-sets-${p.id}`), false, false);
  });
}

function renderMyTable(myPlayer) {
  if (!myPlayer) return;

  const myNameDisplay = document.getElementById('my-player-name-display');
  if (myNameDisplay) {
    myNameDisplay.textContent = `${myPlayer.name || 'You'} (You)`;
  }
  const myBoard = document.getElementById('my-board');
  const mySpeakingIndicator = document.getElementById('my-speaking-indicator');
  const isSpeaking = speakingPlayers.has(myPlayer.id);

  if (myBoard) {
    myBoard.classList.toggle('is-speaking', isSpeaking);
  }
  if (mySpeakingIndicator) {
    mySpeakingIndicator.classList.toggle('hidden', !isSpeaking);
  }

  // Bank
  const totalBank = (myPlayer.bank || []).reduce((acc, c) => acc + (c.value || 0), 0);
  document.getElementById('my-bank-total').textContent = `$${totalBank}M`;
  const bankContainer = document.getElementById('my-bank-container');
  bankContainer.innerHTML = '';
  (myPlayer.bank || []).forEach(c => {
    bankContainer.appendChild(createMiniBankBill(c));
  });

  const isMyTurn = currentGameState?.turn?.active_player_id === myPlayer.id;

  // Properties
  renderPropertySets(myPlayer.property_sets || {}, document.getElementById('my-properties-container'), true, isMyTurn);

  // Hand
  const handContainer = document.getElementById('my-hand-container');
  handContainer.innerHTML = '';

  (myPlayer.hand || []).forEach(card => {
    const cardEl = createCardElement(card, isMyTurn);
    if (isMyTurn && currentGameState.turn.actions_left > 0) {
      cardEl.classList.add('is-turn-playable');
      cardEl.addEventListener('click', () => openCardModal(card));
    } else {
      cardEl.addEventListener('click', () => openInspectModal(card));
    }
    handContainer.appendChild(cardEl);
  });
}

function getSetPropertiesCount(cards) {
  return (cards || []).filter(c => c.type === 'property' || c.type === 'wild_property').length;
}

function isCompleteSet(cards, color) {
  if (!SET_RULES[color]) return false;
  return getSetPropertiesCount(cards) >= SET_RULES[color].size;
}

function setHasHouse(cards) {
  return (cards || []).some(c => c.action === 'house');
}

function setHasHotel(cards) {
  return (cards || []).some(c => c.action === 'hotel');
}

function renderPropertySets(propertySets, container, isOwner = false, isMyTurn = false) {
  container.innerHTML = '';
  const entries = Object.entries(propertySets);

  if (entries.length === 0) {
    container.innerHTML = `<span class="empty-state-text">No properties laid down yet</span>`;
    return;
  }

  entries.forEach(([color, cards]) => {
    if (!cards || cards.length === 0) return;
    const group = document.createElement('div');
    group.className = 'property-group';

    const colorHex = COLOR_HEX[color] || '#333';
    const colorName = COLOR_NAMES[color] || color;
    const targetSize = SET_RULES[color]?.size || 3;
    const propCount = getSetPropertiesCount(cards);
    const isComplete = isCompleteSet(cards, color);
    const hasHouse = setHasHouse(cards);
    const hasHotel = setHasHotel(cards);

    if (isComplete) {
      group.classList.add('is-complete');
    }

    let buildingsHtml = '';
    if (hasHouse) buildingsHtml += ' 🏠';
    if (hasHotel) buildingsHtml += ' 🏨';

    const badge = isComplete
      ? `<span class="badge-full-set">FULL SET 🏆${buildingsHtml}</span>`
      : `<span class="set-counter-text">(${propCount}/${targetSize})</span>`;

    const header = document.createElement('div');
    header.className = 'group-header';
    header.style.background = colorHex;
    header.innerHTML = `<span>${colorName}</span> ${badge}`;
    group.appendChild(header);

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '6px';

    cards.forEach(c => {
      list.appendChild(createMiniPropertyCard(c, color, isOwner, isMyTurn));
    });

    group.appendChild(list);
    container.appendChild(group);
  });
}

// --- Visual Artwork Helpers ---
function getCardArtHtml(card) {
  if (card.type === 'action' && card.action) {
    return `<img src="assets/cards/${card.action}.webp" alt="${escapeHtml(card.name)}" class="action-art-img">`;
  }
  if (card.type === 'rent' || card.type === 'rent_wild') {
    return `<img src="assets/cards/rent.webp" alt="Rent" class="action-art-img">`;
  }
  return getCardSvgArt(card);
}

function getCardSvgArt(card) {
  if (card.type === 'action') {
    switch (card.action) {
      case 'pass_go':
        return `
          <svg viewBox="0 0 64 64" class="action-art-svg">
            <circle cx="32" cy="32" r="30" fill="#22c55e" stroke="#15803d" stroke-width="2"/>
            <path d="M14 32h26m-10-10l12 10-12 10" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
            <text x="32" y="52" text-anchor="middle" font-weight="900" font-size="12" fill="#ffffff" letter-spacing="1">GO</text>
          </svg>
        `;
      case 'deal_breaker':
        return `
          <svg viewBox="0 0 64 64" class="action-art-svg">
            <circle cx="32" cy="32" r="30" fill="#fee2e2" stroke="#ef4444" stroke-width="2"/>
            <rect x="20" y="28" width="24" height="22" rx="4" fill="#ef4444"/>
            <path d="M25 28v-8a7 7 0 0 1 14 0v8" fill="none" stroke="#ef4444" stroke-width="4" stroke-linecap="round"/>
            <path d="M30 36l4 4-2 6" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
            <path d="M12 14l12 12m28-12L40 26" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>
          </svg>
        `;
      case 'just_say_no':
        return `
          <svg viewBox="0 0 64 64" class="action-art-svg">
            <polygon points="20,6 44,6 58,20 58,44 44,58 20,58 6,44 6,20" fill="#dc2626" stroke="#ffffff" stroke-width="2"/>
            <path d="M32 18v15m0 7v3" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>
            <text x="32" y="38" text-anchor="middle" font-weight="900" font-size="12" fill="#ffffff" font-family="sans-serif">NO!</text>
          </svg>
        `;
      case 'sly_deal':
        return `
          <svg viewBox="0 0 64 64" class="action-art-svg">
            <circle cx="32" cy="32" r="30" fill="#fef3c7" stroke="#f59e0b" stroke-width="2"/>
            <rect x="30" y="16" width="18" height="26" rx="2" fill="#3b82f6" transform="rotate(15 39 29)"/>
            <path d="M12 44c6-4 12-4 18-2l10-8a3 3 0 0 1 4 4l-7 7 4 1-5 6-18 2z" fill="#374151"/>
            <path d="M16 22h8m-10 6h12m-8 6h6" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/>
          </svg>
        `;
      case 'forced_deal':
        return `
          <svg viewBox="0 0 64 64" class="action-art-svg">
            <circle cx="32" cy="32" r="30" fill="#e0e7ff" stroke="#6366f1" stroke-width="2"/>
            <rect x="13" y="20" width="16" height="22" rx="2" fill="#ec4899"/>
            <rect x="35" y="22" width="16" height="22" rx="2" fill="#3b82f6"/>
            <path d="M22 16c6-4 16-4 22 2" fill="none" stroke="#4f46e5" stroke-width="3" stroke-linecap="round"/>
            <polygon points="45,15 47,20 42,20" fill="#4f46e5"/>
            <path d="M42 48c-6 4-16 4-22-2" fill="none" stroke="#4f46e5" stroke-width="3" stroke-linecap="round"/>
            <polygon points="19,49 17,44 22,44" fill="#4f46e5"/>
          </svg>
        `;
      case 'debt_collector':
        return `
          <svg viewBox="0 0 64 64" class="action-art-svg">
            <circle cx="32" cy="32" r="30" fill="#f3e8ff" stroke="#a855f7" stroke-width="2"/>
            <path d="M26 22c2-4 10-4 12 0l4 4c6 4 10 12 8 20-2 8-10 12-18 12s-16-4-18-12c-2-8 2-16 8-20z" fill="#15803d"/>
            <ellipse cx="32" cy="22" rx="7" ry="3" fill="#ca8a04"/>
            <text x="32" y="45" text-anchor="middle" font-weight="900" font-size="18" fill="#facc15" font-family="sans-serif">$</text>
          </svg>
        `;
      case 'birthday':
        return `
          <svg viewBox="0 0 64 64" class="action-art-svg">
            <circle cx="32" cy="32" r="30" fill="#fce7f3" stroke="#ec4899" stroke-width="2"/>
            <rect x="18" y="36" width="28" height="16" rx="3" fill="#f43f5e"/>
            <rect x="22" y="24" width="20" height="13" rx="2" fill="#fb7185"/>
            <path d="M18 38c2 2 4 0 6 2 2-2 4 0 6 2 2-2 4 0 6 2 2-2 4 0 4 2" fill="none" stroke="#ffffff" stroke-width="1.8"/>
            <rect x="26" y="16" width="2" height="8" fill="#fde047"/>
            <circle cx="27" cy="13" r="2" fill="#f97316"/>
            <rect x="36" y="16" width="2" height="8" fill="#fde047"/>
            <circle cx="37" cy="13" r="2" fill="#f97316"/>
            <rect x="31" y="14" width="2" height="10" fill="#fde047"/>
            <circle cx="32" cy="11" r="2.5" fill="#f97316"/>
          </svg>
        `;
      case 'double_rent':
        return `
          <svg viewBox="0 0 64 64" class="action-art-svg">
            <circle cx="32" cy="32" r="30" fill="#fef08a" stroke="#eab308" stroke-width="2"/>
            <polygon points="32,8 37,22 51,15 44,29 58,35 44,40 50,54 36,46 32,60 28,46 14,54 20,40 6,35 20,29 13,15 27,22" fill="#eab308"/>
            <circle cx="32" cy="34" r="16" fill="#ffffff"/>
            <text x="32" y="40" text-anchor="middle" font-weight="900" font-size="15" fill="#b45309" font-family="sans-serif">2X</text>
          </svg>
        `;
      case 'house':
        return `
          <svg viewBox="0 0 64 64" class="action-art-svg">
            <circle cx="32" cy="32" r="30" fill="#dcfce7" stroke="#22c55e" stroke-width="2"/>
            <polygon points="32,14 14,28 50,28" fill="#15803d"/>
            <rect x="18" y="28" width="28" height="22" fill="#16a34a" rx="1"/>
            <rect x="38" y="16" width="5" height="10" fill="#15803d"/>
            <rect x="28" y="36" width="8" height="14" fill="#14532d"/>
            <rect x="20" y="32" width="6" height="6" fill="#bbf7d0"/>
          </svg>
        `;
      case 'hotel':
        return `
          <svg viewBox="0 0 64 64" class="action-art-svg">
            <circle cx="32" cy="32" r="30" fill="#fee2e2" stroke="#ef4444" stroke-width="2"/>
            <polygon points="32,12 12,24 52,24" fill="#991b1b"/>
            <rect x="15" y="24" width="34" height="28" fill="#dc2626" rx="1"/>
            <rect x="28" y="38" width="8" height="14" fill="#7f1d1d"/>
            <rect x="19" y="28" width="5" height="5" fill="#fecaca"/>
            <rect x="27" y="28" width="5" height="5" fill="#fecaca"/>
            <rect x="35" y="28" width="5" height="5" fill="#fecaca"/>
            <rect x="19" y="36" width="5" height="5" fill="#fecaca"/>
            <rect x="40" y="36" width="5" height="5" fill="#fecaca"/>
          </svg>
        `;
    }
  }

  if (card.type === 'rent' || card.type === 'rent_wild') {
    return `
      <svg viewBox="0 0 64 64" class="action-art-svg">
        <circle cx="32" cy="32" r="30" fill="#f8fafc" stroke="#94a3b8" stroke-width="2"/>
        <rect x="12" y="18" width="40" height="20" rx="3" fill="#0f172a"/>
        <text x="32" y="32" text-anchor="middle" font-weight="900" font-size="11" fill="#ffffff" letter-spacing="1">RENT</text>
        <ellipse cx="24" cy="46" rx="8" ry="3" fill="#facc15" stroke="#ca8a04"/>
        <ellipse cx="24" cy="43" rx="8" ry="3" fill="#fde047" stroke="#ca8a04"/>
        <ellipse cx="40" cy="46" rx="8" ry="3" fill="#facc15" stroke="#ca8a04"/>
        <ellipse cx="40" cy="43" rx="8" ry="3" fill="#fde047" stroke="#ca8a04"/>
        <ellipse cx="40" cy="40" rx="8" ry="3" fill="#fef08a" stroke="#ca8a04"/>
      </svg>
    `;
  }

  return '';
}

function getPropertyHeaderIcon(group) {
  if (group === 'railroad') {
    return `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <path d="M12 2c-4 0-7 1.5-7 5v8c0 2 1.5 3.5 3.5 3.5l-1.5 1.5v1h10v-1l-1.5-1.5c2 0 3.5-1.5 3.5-3.5V7c0-3.5-3-5-7-5zm-4 12c-.8 0-1.5-.7-1.5-1.5S7.2 11 8 11s1.5.7 1.5 1.5S8.8 14 8 14zm8 0c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5-.7 1.5-1.5 1.5zm1-5H7V7h10v2z"/>
      </svg>
    `;
  }
  if (group === 'utility') {
    return `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <path d="M9 21c0 .5.5 1 1 1h4c.5 0 1-.5 1-1v-1H9v1zm3-19C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17c0 .5.5 1 1 1h6c.5 0 1-.5 1-1v-2.3c1.8-1.3 3-3.3 3-5.7 0-3.9-3.1-7-7-7z"/>
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  `;
}

// --- Value Badge Helper ---
function renderValueBadge(value, cornerClass) {
  const val = (value !== undefined && value !== null) ? value : 0;
  const is10 = val === 10;
  const zeroStyle = val === 0 ? ' style="background:#e2e8f0; color:#0f172a;"' : '';
  return `
    <div class="card-val-badge ${cornerClass} ${is10 ? 'val-10' : ''}"${zeroStyle}>
      <span class="val-curr">$</span><span class="val-num">${val}</span><span class="val-unit">M</span>
    </div>
  `;
}

// --- Create Physical Monopoly Deal Card Element ---
function createCardElement(card, interactive = false, isPreview = false) {
  const el = document.createElement('div');
  const previewClass = isPreview ? 'card-preview' : '';
  const interClass = interactive ? 'interactive' : '';
  const typeClass = `card-type-${card.type}`;
  el.className = `deal-card ${interClass} ${previewClass} ${typeClass}`;
  el.dataset.cardId = card.id;

  // Handle Money Cards (Banknote style)
  if (card.type === 'money') {
    const val = card.value || 1;
    el.classList.add('card-money');
    el.innerHTML = `
      <div class="banknote-frame money-theme-${val}">
        <span class="banknote-corner c-tl">$${val}M</span>
        <span class="banknote-corner c-tr">$${val}M</span>
        <div class="banknote-top-header">BANK OF MONOPOLY</div>
        <div class="banknote-center-oval">
          <img src="assets/cards/tycoon.webp" class="banknote-tycoon-img" alt="Tycoon">
          <div class="banknote-amount">
            <span class="bn-curr">$</span><span class="bn-val">${val}</span><span class="bn-unit">M</span>
          </div>
          <div class="banknote-label">MONEY</div>
        </div>
        <div class="banknote-bottom-banner">MONOPOLY DEAL</div>
        <span class="banknote-corner c-bl">$${val}M</span>
        <span class="banknote-corner c-br">$${val}M</span>
      </div>
    `;
    return el;
  }

  // Handle Standard Property Cards
  if (card.type === 'property') {
    const group = card.group || (card.colors && card.colors[0]) || 'brown';
    const rule = SET_RULES[group] || { size: 3, rent: [1, 2, 3], name: group, color: '#334155' };
    const iconSvg = getPropertyHeaderIcon(group);
    const textCol = (group === 'yellow' || group === 'light_blue') ? '#0f172a' : '#ffffff';

    let rentRowsHtml = '';
    const size = rule.size || 3;
    const rents = rule.rent || [];
    for (let i = 1; i <= size; i++) {
      const isFull = i === size;
      const countLabel = i === 1 ? '1 Card' : `${i} Cards${isFull ? ' (Full Set)' : ''}`;
      const amount = rents[i - 1] !== undefined ? `$${rents[i - 1]}M` : `$${i}M`;
      rentRowsHtml += `
        <div class="rent-row">
          <span>${countLabel}</span>
          <span class="rent-amount">${amount}</span>
        </div>
      `;
    }

    const houseHotel = (group !== 'railroad' && group !== 'utility')
      ? `<div class="card-house-note">House: +$3M • Hotel: +$4M</div>`
      : '';

    el.innerHTML = `
      ${renderValueBadge(card.value, 'val-tl')}
      ${renderValueBadge(card.value, 'val-br')}
      <div class="card-frame">
        <div class="card-header-bar" style="background: ${rule.color}; color: ${textCol};">
          <div class="card-header-title">${escapeHtml(card.name)}</div>
          <div class="card-header-icon">${iconSvg}</div>
        </div>
        <div class="card-rent-table">
          <div class="rent-table-title">RENT VALUES</div>
          ${rentRowsHtml}
          ${houseHotel}
          <div class="card-set-badge">FULL SET: ${size} CARDS</div>
        </div>
      </div>
    `;
    return el;
  }

  // Handle Dual-Color Wildcards
  if (card.type === 'wild_property' && card.colors && card.colors.length === 2) {
    const c1 = card.colors[0];
    const c2 = card.colors[1];
    const rule1 = SET_RULES[c1] || { name: c1, color: '#333' };
    const rule2 = SET_RULES[c2] || { name: c2, color: '#555' };
    const textCol1 = (c1 === 'yellow' || c1 === 'light_blue') ? '#0f172a' : '#ffffff';
    const textCol2 = (c2 === 'yellow' || c2 === 'light_blue') ? '#0f172a' : '#ffffff';
    const curCol = card.current_color || c1;

    el.innerHTML = `
      ${renderValueBadge(card.value, 'val-tl')}
      ${renderValueBadge(card.value, 'val-br')}
      <div class="card-frame">
        <div class="wild-split-header">
          <div class="wild-split-col" style="background: ${rule1.color}; color: ${textCol1};">${rule1.name}</div>
          <div class="wild-split-col" style="background: ${rule2.color}; color: ${textCol2};">${rule2.name}</div>
        </div>
        <div class="wild-dual-body">
          <div class="wild-card-title">WILD PROPERTY</div>
          <div class="wild-swap-icon">⇄</div>
          <div class="wild-card-subtitle">Swap color on your turn</div>
          <div class="wild-active-badge">
            Active: <span style="color: ${SET_RULES[curCol]?.color || '#000'}">${COLOR_NAMES[curCol] || curCol}</span>
          </div>
        </div>
        <div class="action-rule-box">
          Can be part of ${rule1.name} or ${rule2.name} property set.
        </div>
      </div>
    `;
    return el;
  }

  // Handle 10-Color Wild Property
  if (card.type === 'wild_property') {
    el.innerHTML = `
      ${renderValueBadge(0, 'val-tl')}
      ${renderValueBadge(0, 'val-br')}
      <div class="card-frame">
        <div class="card-header-bar" style="background: linear-gradient(90deg, #6e3b23, #38bdf8, #db2777, #ea580c, #dc2626, #eab308, #15803d, #00479b); color: #fff;">
          <div class="card-header-title">MULTI-COLOR WILDCARD</div>
        </div>
        <div class="wild-dual-body">
          <div class="wild-rainbow-wheel">
            <div class="wild-wheel-center">WILD</div>
          </div>
          <div class="wild-card-title">ALL-COLOR PROPERTY</div>
          <div class="wild-card-subtitle">Play on any property set</div>
        </div>
        <div class="action-rule-box">
          No monetary value • Cannot be banked • May move on turn.
        </div>
      </div>
    `;
    return el;
  }

  // Handle Action Cards
  if (card.type === 'action') {
    const artHtml = getCardArtHtml(card);
    el.innerHTML = `
      ${renderValueBadge(card.value, 'val-tl')}
      ${renderValueBadge(card.value, 'val-br')}
      <div class="card-frame">
        <div class="card-header-bar" style="background: #dc2626; color: #ffffff;">
          <div class="card-header-title">${escapeHtml(card.name)}</div>
        </div>
        <div class="action-art-container">
          <span class="action-type-pill">ACTION CARD</span>
          ${artHtml}
        </div>
        <div class="action-rule-box">
          ${escapeHtml(card.desc || '')}
        </div>
      </div>
    `;
    return el;
  }

  // Handle Rent Cards
  if (card.type === 'rent' || card.type === 'rent_wild') {
    const isWild = card.type === 'rent_wild';
    const c1 = card.colors?.[0] || 'red';
    const c2 = card.colors?.[1] || 'yellow';
    const headerStyle = isWild
      ? `background: linear-gradient(90deg, #6e3b23, #38bdf8, #db2777, #ea580c, #dc2626, #eab308, #15803d, #00479b); color: #ffffff;`
      : `background: linear-gradient(135deg, ${COLOR_HEX[c1] || '#333'} 50%, ${COLOR_HEX[c2] || '#555'} 50%); color: #ffffff;`;

    const artHtml = getCardArtHtml(card);
    const subTitle = isWild ? 'ANY COLOR' : `${COLOR_NAMES[c1]} • ${COLOR_NAMES[c2]}`;
    const desc = isWild
      ? 'Force ANY ONE player to pay you rent for properties you own in ANY color.'
      : `All players pay you rent for properties you own in ${COLOR_NAMES[c1]} or ${COLOR_NAMES[c2]}.`;

    el.innerHTML = `
      ${renderValueBadge(card.value, 'val-tl')}
      ${renderValueBadge(card.value, 'val-br')}
      <div class="card-frame">
        <div class="card-header-bar rent-header" style="${headerStyle}">
          <div class="card-header-title">
            <span class="rent-main-title">${isWild ? 'WILD RENT' : 'RENT'}</span>
            <span class="rent-sub-title">${subTitle}</span>
          </div>
        </div>
        <div class="action-art-container">
          <span class="action-type-pill" style="background:#2563eb;">RENT CARD</span>
          ${artHtml}
        </div>
        <div class="action-rule-box">
          ${escapeHtml(desc)}
        </div>
      </div>
    `;
    return el;
  }

  // Fallback
  el.innerHTML = `
    ${renderValueBadge(card.value || 0, 'val-tl')}
    ${renderValueBadge(card.value || 0, 'val-br')}
    <div class="card-frame">
      <div class="card-header-bar" style="background: #334155; color: #fff;">
        <div class="card-header-title">${escapeHtml(card.name)}</div>
      </div>
      <div class="action-rule-box">
        ${escapeHtml(card.desc || '')}
      </div>
    </div>
  `;
  return el;
}

// --- Tabletop Mini Cards & Banknotes ---
function createMiniPropertyCard(card, groupColor, isOwner = false, isMyTurn = false) {
  const el = document.createElement('div');
  el.className = 'mini-property-item';
  const color = groupColor || card.group || (card.colors && card.colors[0]) || 'brown';
  const colorHex = COLOR_HEX[color] || '#333';
  el.style.borderLeftColor = colorHex;

  const isHouse = card.action === 'house';
  const isHotel = card.action === 'hotel';
  const isWild = card.type === 'wild_property';
  const icon = isHouse ? '🏠' : (isHotel ? '🏨' : getPropertyHeaderIcon(color));

  let moveBtnHtml = '';
  if (isWild && isOwner && isMyTurn) {
    moveBtnHtml = `<button class="btn-move-wild" title="Move wildcard to another set (Free action)">⇄ Move</button>`;
  }

  el.innerHTML = `
    <span style="color: ${colorHex}; display: flex; align-items: center; font-size: 0.9rem;">${icon}</span>
    <span class="mini-prop-name">${escapeHtml(card.name)}</span>
    ${isHouse ? `<span class="mini-wild-tag" style="background:#16a34a;">+ $3M</span>` : ''}
    ${isHotel ? `<span class="mini-wild-tag" style="background:#dc2626;">+ $4M</span>` : ''}
    ${isWild ? `<span class="mini-wild-tag">WILD</span>` : ''}
    <span class="mini-prop-badge">$${card.value}M</span>
    ${moveBtnHtml}
  `;

  if (moveBtnHtml) {
    const moveBtn = el.querySelector('.btn-move-wild');
    if (moveBtn) {
      moveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const availableColors = (card.colors || []).filter(c => c !== color);
        if (availableColors.length === 0) return alert('No other colors available for this wildcard.');

        let chosen = null;
        if (availableColors.length === 1) {
          chosen = availableColors[0];
          if (!confirm(`Move ${card.name} to ${COLOR_NAMES[chosen] || chosen} set?`)) return;
        } else {
          const promptMsg = `Select target color for wildcard:\n` + availableColors.map((c, i) => `${i + 1}. ${COLOR_NAMES[c] || c}`).join('\n');
          const choice = prompt(promptMsg, '1');
          if (!choice) return;
          const idx = parseInt(choice.trim(), 10) - 1;
          if (isNaN(idx) || !availableColors[idx]) return alert('Invalid choice.');
          chosen = availableColors[idx];
        }

        try {
          const res = await apiRequest('move_property', 'POST', {
            game_id: currentGameId,
            player_id: currentPlayerData.id,
            card_id: card.id,
            to_color: chosen
          });
          currentGameState = res.state;
          render();
        } catch (err) {
          alert(err.message);
        }
      });
    }
  }

  el.title = `Click to inspect: ${card.name}`;
  el.addEventListener('click', () => openInspectModal(card));
  return el;
}

function createMiniBankBill(card) {
  const el = document.createElement('div');
  const val = card.value || 1;
  el.className = `mini-bank-bill money-theme-${val}`;

  el.innerHTML = `
    <span class="mini-bank-val">$${val}M</span>
    <span style="font-size: 0.65rem; opacity: 0.85;">${escapeHtml(card.name.includes('$') ? 'Banknote' : card.name)}</span>
  `;

  el.title = `Click to inspect: ${card.name}`;
  el.addEventListener('click', () => openInspectModal(card));
  return el;
}

// --- Card Inspection Modal ---
function openInspectModal(card) {
  const modal = document.getElementById('inspect-modal');
  const title = document.getElementById('inspect-card-title');
  const preview = document.getElementById('inspect-card-preview');

  title.textContent = card.name;
  preview.innerHTML = '';
  preview.appendChild(createCardElement(card, false, true));

  modal.classList.remove('hidden');
}

function closeInspectModal() {
  document.getElementById('inspect-modal').classList.add('hidden');
}

function renderLogs(logs) {
  const container = document.getElementById('logs-container');
  container.innerHTML = '';
  logs.forEach(l => {
    const item = document.createElement('div');
    item.className = 'log-item';
    const date = new Date(l.time * 1000);
    const timeStr = date.toTimeString().substring(0, 5);
    item.innerHTML = `<span class="time">[${timeStr}]</span> ${escapeHtml(l.text)}`;
    container.appendChild(item);
  });
  container.scrollTop = container.scrollHeight;
}

/* ========================================================
   CARD ACTIONS MODAL
======================================================== */
function openCardModal(card) {
  const modal = document.getElementById('action-modal');
  const title = document.getElementById('modal-card-title');
  const actionsContainer = document.getElementById('modal-actions-container');

  title.textContent = `Play: ${card.name}`;
  const preview = document.getElementById('modal-card-preview');
  if (preview) {
    preview.innerHTML = '';
    preview.appendChild(createCardElement(card, false, true));
  }
  actionsContainer.innerHTML = '';

  // 1. Bank option (Available for Money, Action, and Rent cards)
  const bankBtn = document.createElement('button');
  bankBtn.className = 'btn-bank';
  bankBtn.textContent = `Deposit into Bank ($${card.value}M)`;
  bankBtn.addEventListener('click', () => executePlay(card.id, 'bank'));
  actionsContainer.appendChild(bankBtn);

  // 2. Property option (Available for Property & Wild Property)
  if (card.type === 'property' || card.type === 'wild_property') {
    if (card.colors && card.colors.length > 1) {
      // Pick color for wildcard
      const select = document.createElement('select');
      select.className = 'modal-select';

      card.colors.forEach(col => {
        const opt = document.createElement('option');
        opt.value = col;
        opt.textContent = `Set Color: ${COLOR_NAMES[col] || col}`;
        select.appendChild(opt);
      });

      const propBtn = document.createElement('button');
      propBtn.className = 'btn-property';
      propBtn.textContent = 'Lay down Property';
      propBtn.addEventListener('click', () => {
        executePlay(card.id, 'property', { color: select.value });
      });

      actionsContainer.appendChild(select);
      actionsContainer.appendChild(propBtn);
    } else {
      const propBtn = document.createElement('button');
      propBtn.className = 'btn-property';
      propBtn.textContent = 'Lay down Property';
      propBtn.addEventListener('click', () => executePlay(card.id, 'property'));
      actionsContainer.appendChild(propBtn);
    }
  }

  // 3. Action / Rent play
  if (card.type === 'action' || card.type === 'rent' || card.type === 'rent_wild') {
    const actSection = document.createElement('div');
    actSection.style.display = 'flex';
    actSection.style.flexDirection = 'column';
    actSection.style.gap = '8px';
    actSection.style.marginTop = '6px';

    const myPlayer = currentGameState.players[currentPlayerData.id] || {};
    const opponents = Object.values(currentGameState.players || {}).filter(p => p.id !== currentPlayerData.id);

    if (card.action === 'deal_breaker') {
      const targetSets = [];
      opponents.forEach(opp => {
        Object.entries(opp.property_sets || {}).forEach(([color, cards]) => {
          if (isCompleteSet(cards, color)) {
            targetSets.push({
              player: opp,
              color,
              cards,
              name: `${opp.name}: ${COLOR_NAMES[color] || color} Full Set`
            });
          }
        });
      });

      if (targetSets.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'empty-state-text';
        hint.textContent = 'No opponent currently has a completed property set to steal.';
        actSection.appendChild(hint);
      } else {
        const label = document.createElement('label');
        label.textContent = 'Select completed set to steal:';
        label.style.fontSize = '0.8rem';
        label.style.fontWeight = 'bold';
        actSection.appendChild(label);

        const select = document.createElement('select');
        select.className = 'modal-select';
        targetSets.forEach((ts, idx) => {
          const opt = document.createElement('option');
          opt.value = idx;
          opt.textContent = ts.name;
          select.appendChild(opt);
        });
        actSection.appendChild(select);

        const stealBtn = document.createElement('button');
        stealBtn.className = 'btn-action';
        stealBtn.textContent = '🚨 Steal Completed Set!';
        stealBtn.addEventListener('click', () => {
          const chosen = targetSets[parseInt(select.value, 10)];
          executePlay(card.id, 'action', {
            target_player_id: chosen.player.id,
            color: chosen.color
          });
        });
        actSection.appendChild(stealBtn);
      }
    } else if (card.action === 'sly_deal') {
      const targetProps = [];
      opponents.forEach(opp => {
        Object.entries(opp.property_sets || {}).forEach(([color, cards]) => {
          if (!isCompleteSet(cards, color)) {
            cards.forEach(c => {
              if (c.type === 'property' || c.type === 'wild_property') {
                targetProps.push({
                  player: opp,
                  card: c,
                  color,
                  name: `${opp.name}: ${c.name} (${COLOR_NAMES[color] || color})`
                });
              }
            });
          }
        });
      });

      if (targetProps.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'empty-state-text';
        hint.textContent = 'No opponent has an available property to steal (cannot steal full sets).';
        actSection.appendChild(hint);
      } else {
        const label = document.createElement('label');
        label.textContent = 'Select opponent property to steal:';
        label.style.fontSize = '0.8rem';
        label.style.fontWeight = 'bold';
        actSection.appendChild(label);

        const select = document.createElement('select');
        select.className = 'modal-select';
        targetProps.forEach((tp, idx) => {
          const opt = document.createElement('option');
          opt.value = idx;
          opt.textContent = tp.name;
          select.appendChild(opt);
        });
        actSection.appendChild(select);

        const slyBtn = document.createElement('button');
        slyBtn.className = 'btn-action';
        slyBtn.textContent = '🕵️ Steal Property!';
        slyBtn.addEventListener('click', () => {
          const chosen = targetProps[parseInt(select.value, 10)];
          executePlay(card.id, 'action', {
            target_player_id: chosen.player.id,
            card_id: chosen.card.id
          });
        });
        actSection.appendChild(slyBtn);
      }
    } else if (card.action === 'forced_deal') {
      const myProps = [];
      Object.entries(myPlayer.property_sets || {}).forEach(([color, cards]) => {
        if (!isCompleteSet(cards, color)) {
          cards.forEach(c => {
            if (c.type === 'property' || c.type === 'wild_property') {
              myProps.push({ card: c, color, name: `${c.name} (${COLOR_NAMES[color] || color})` });
            }
          });
        }
      });

      const oppProps = [];
      opponents.forEach(opp => {
        Object.entries(opp.property_sets || {}).forEach(([color, cards]) => {
          if (!isCompleteSet(cards, color)) {
            cards.forEach(c => {
              if (c.type === 'property' || c.type === 'wild_property') {
                oppProps.push({ player: opp, card: c, color, name: `${opp.name}: ${c.name} (${COLOR_NAMES[color] || color})` });
              }
            });
          }
        });
      });

      if (myProps.length === 0 || oppProps.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'empty-state-text';
        hint.textContent = 'Need at least 1 incomplete property on both sides to swap.';
        actSection.appendChild(hint);
      } else {
        const l1 = document.createElement('label');
        l1.textContent = 'Your property to trade:';
        l1.style.fontSize = '0.8rem';
        actSection.appendChild(l1);

        const selMine = document.createElement('select');
        selMine.className = 'modal-select';
        myProps.forEach((mp, i) => {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = mp.name;
          selMine.appendChild(opt);
        });
        actSection.appendChild(selMine);

        const l2 = document.createElement('label');
        l2.textContent = 'Opponent property to take:';
        l2.style.fontSize = '0.8rem';
        actSection.appendChild(l2);

        const selOpp = document.createElement('select');
        selOpp.className = 'modal-select';
        oppProps.forEach((op, i) => {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = op.name;
          selOpp.appendChild(opt);
        });
        actSection.appendChild(selOpp);

        const swapBtn = document.createElement('button');
        swapBtn.className = 'btn-action';
        swapBtn.textContent = '🔄 Swap Properties!';
        swapBtn.addEventListener('click', () => {
          const m = myProps[parseInt(selMine.value, 10)];
          const o = oppProps[parseInt(selOpp.value, 10)];
          executePlay(card.id, 'action', {
            target_player_id: o.player.id,
            my_card_id: m.card.id,
            target_card_id: o.card.id
          });
        });
        actSection.appendChild(swapBtn);
      }
    } else if (card.action === 'house') {
      const eligibleSets = Object.entries(myPlayer.property_sets || {}).filter(([color, cards]) => {
        return !['railroad', 'utility'].includes(color) && isCompleteSet(cards, color) && !setHasHouse(cards);
      });

      if (eligibleSets.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'empty-state-text';
        hint.textContent = 'No eligible complete sets (must be a full standard set without a House).';
        actSection.appendChild(hint);
      } else {
        const select = document.createElement('select');
        select.className = 'modal-select';
        eligibleSets.forEach(([color]) => {
          const opt = document.createElement('option');
          opt.value = color;
          opt.textContent = `Build on ${COLOR_NAMES[color] || color} Full Set (+ $3M Rent)`;
          select.appendChild(opt);
        });
        actSection.appendChild(select);

        const houseBtn = document.createElement('button');
        houseBtn.className = 'btn-action';
        houseBtn.textContent = '🏠 Build House (+ $3M Rent)';
        houseBtn.addEventListener('click', () => {
          executePlay(card.id, 'action', { color: select.value });
        });
        actSection.appendChild(houseBtn);
      }
    } else if (card.action === 'hotel') {
      const eligibleSets = Object.entries(myPlayer.property_sets || {}).filter(([color, cards]) => {
        return !['railroad', 'utility'].includes(color) && isCompleteSet(cards, color) && setHasHouse(cards) && !setHasHotel(cards);
      });

      if (eligibleSets.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'empty-state-text';
        hint.textContent = 'No eligible complete sets with a House (must have a House first).';
        actSection.appendChild(hint);
      } else {
        const select = document.createElement('select');
        select.className = 'modal-select';
        eligibleSets.forEach(([color]) => {
          const opt = document.createElement('option');
          opt.value = color;
          opt.textContent = `Build on ${COLOR_NAMES[color] || color} Set (+ $4M Rent)`;
          select.appendChild(opt);
        });
        actSection.appendChild(select);

        const hotelBtn = document.createElement('button');
        hotelBtn.className = 'btn-action';
        hotelBtn.textContent = '🏨 Build Hotel (+ $4M Rent)';
        hotelBtn.addEventListener('click', () => {
          executePlay(card.id, 'action', { color: select.value });
        });
        actSection.appendChild(hotelBtn);
      }
    } else if (card.action === 'debt_collector') {
      if (opponents.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'empty-state-text';
        hint.textContent = 'No opponents to target.';
        actSection.appendChild(hint);
      } else {
        const select = document.createElement('select');
        select.className = 'modal-select';
        opponents.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = `Collect $5M from ${p.name}`;
          select.appendChild(opt);
        });
        actSection.appendChild(select);

        const dcBtn = document.createElement('button');
        dcBtn.className = 'btn-action';
        dcBtn.textContent = '💰 Demand $5M Payment';
        dcBtn.addEventListener('click', () => {
          executePlay(card.id, 'action', { target_player_id: select.value });
        });
        actSection.appendChild(dcBtn);
      }
    } else if (card.action === 'double_rent') {
      const drBtn = document.createElement('button');
      drBtn.className = 'btn-action';
      drBtn.textContent = '⚡ Activate Double Rent (Next rent card x2)';
      drBtn.addEventListener('click', () => {
        executePlay(card.id, 'action');
      });
      actSection.appendChild(drBtn);
    } else if (card.action === 'pass_go') {
      const pgBtn = document.createElement('button');
      pgBtn.className = 'btn-action';
      pgBtn.textContent = '⏩ Play Pass Go (Draw 2 Cards)';
      pgBtn.addEventListener('click', () => {
        executePlay(card.id, 'action');
      });
      actSection.appendChild(pgBtn);
    } else if (card.action === 'birthday') {
      const bdayBtn = document.createElement('button');
      bdayBtn.className = 'btn-action';
      bdayBtn.textContent = '🎂 Celebrate Birthday (Collect $2M from all)';
      bdayBtn.addEventListener('click', () => {
        executePlay(card.id, 'action');
      });
      actSection.appendChild(bdayBtn);
    } else if (card.type === 'rent') {
      const c1 = card.colors[0];
      const c2 = card.colors[1];
      const count1 = (myPlayer.property_sets?.[c1] || []).length;
      const count2 = (myPlayer.property_sets?.[c2] || []).length;

      const select = document.createElement('select');
      select.className = 'modal-select';

      const opt1 = document.createElement('option');
      opt1.value = c1;
      opt1.textContent = `Charge for ${COLOR_NAMES[c1]} (You own ${count1})`;
      select.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = c2;
      opt2.textContent = `Charge for ${COLOR_NAMES[c2]} (You own ${count2})`;
      select.appendChild(opt2);
      actSection.appendChild(select);

      const rentBtn = document.createElement('button');
      rentBtn.className = 'btn-action';
      rentBtn.textContent = '💰 Charge Rent to All Opponents';
      rentBtn.addEventListener('click', () => {
        executePlay(card.id, 'action', { color: select.value });
      });
      actSection.appendChild(rentBtn);
    } else if (card.type === 'rent_wild') {
      if (opponents.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'empty-state-text';
        hint.textContent = 'No opponents to target.';
        actSection.appendChild(hint);
      } else {
        const l1 = document.createElement('label');
        l1.textContent = 'Target Opponent:';
        l1.style.fontSize = '0.8rem';
        actSection.appendChild(l1);

        const selPlayer = document.createElement('select');
        selPlayer.className = 'modal-select';
        opponents.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name;
          selPlayer.appendChild(opt);
        });
        actSection.appendChild(selPlayer);

        const l2 = document.createElement('label');
        l2.textContent = 'Property color to charge for:';
        l2.style.fontSize = '0.8rem';
        actSection.appendChild(l2);

        const selColor = document.createElement('select');
        selColor.className = 'modal-select';
        Object.keys(SET_RULES).forEach(col => {
          const count = (myPlayer.property_sets?.[col] || []).length;
          const opt = document.createElement('option');
          opt.value = col;
          opt.textContent = `${COLOR_NAMES[col]} (You own ${count})`;
          selColor.appendChild(opt);
        });
        actSection.appendChild(selColor);

        const wildRentBtn = document.createElement('button');
        wildRentBtn.className = 'btn-action';
        wildRentBtn.textContent = '💰 Charge Single Player Rent';
        wildRentBtn.addEventListener('click', () => {
          executePlay(card.id, 'action', {
            target_player_id: selPlayer.value,
            color: selColor.value
          });
        });
        actSection.appendChild(wildRentBtn);
      }
    } else {
      const genericBtn = document.createElement('button');
      genericBtn.className = 'btn-action';
      genericBtn.textContent = `Play ${card.name}`;
      genericBtn.addEventListener('click', () => executePlay(card.id, 'action'));
      actSection.appendChild(genericBtn);
    }

    actionsContainer.appendChild(actSection);
  }

  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('action-modal').classList.add('hidden');
}

async function executePlay(cardId, targetType, params = {}) {
  closeModal();
  try {
    const res = await apiRequest('play', 'POST', {
      game_id: currentGameId,
      player_id: currentPlayerData.id,
      card_id: cardId,
      target_type: targetType,
      params
    });
    currentGameState = res.state;
    render();
  } catch (err) {
    alert(err.message);
  }
}

/* ========================================================
   WEBRTC VOICE CHAT & SPEAKING DETECTION (MIC FEATURE)
======================================================== */
function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioContext = new AudioContextClass();
    }
  }
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function initLocalAudioAnalyser() {
  if (!localStream) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (localAudioSource) {
      try { localAudioSource.disconnect(); } catch (e) {}
    }

    localAudioSource = ctx.createMediaStreamSource(localStream);
    localAudioAnalyser = ctx.createAnalyser();
    localAudioAnalyser.fftSize = 256;
    localAudioAnalyser.smoothingTimeConstant = 0.3;
    localAudioSource.connect(localAudioAnalyser);

    startAudioMonitorLoop();
  } catch (err) {
    console.warn('Failed to initialize local audio analyser:', err);
  }
}

function attachPeerAudioStream(peerId, stream) {
  try {
    const ctx = getAudioContext();
    if (!ctx || !stream) return;

    cleanupPeerAudio(peerId);

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);

    peerAudioAnalysers[peerId] = { source, analyser };
    startAudioMonitorLoop();
  } catch (err) {
    console.warn('Failed to attach remote stream analyser for peer', peerId, err);
  }
}

function cleanupPeerAudio(peerId) {
  if (peerAudioAnalysers[peerId]) {
    try {
      peerAudioAnalysers[peerId].source.disconnect();
    } catch (e) {}
    delete peerAudioAnalysers[peerId];
  }
}

function startAudioMonitorLoop() {
  if (audioMonitorTimer) return;

  audioMonitorTimer = setInterval(() => {
    const myId = currentPlayerData?.id;

    // 1. Check local player microphone volume
    if (myId && localStream && localAudioAnalyser && !isMicMuted) {
      const vol = getAnalyserVolume(localAudioAnalyser);
      processVolumeSample(myId, vol, true);
    } else if (myId && isMicMuted) {
      if (speakingPlayers.has(myId)) {
        setPlayerSpeaking(myId, false);
        broadcastSpeakingStatus(false);
      }
    }

    // 2. Check remote peers audio volume
    for (const [peerId, obj] of Object.entries(peerAudioAnalysers)) {
      if (obj?.analyser) {
        const vol = getAnalyserVolume(obj.analyser);
        processVolumeSample(peerId, vol, false);
      }
    }

    // Stop monitor timer if no active streams
    const hasRemote = Object.keys(peerAudioAnalysers).length > 0;
    const hasLocal = !!(localStream && localAudioAnalyser);
    if (!hasRemote && !hasLocal) {
      clearInterval(audioMonitorTimer);
      audioMonitorTimer = null;
    }
  }, 80);
}

function getAnalyserVolume(analyser) {
  if (!analyser) return 0;
  const buffer = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i];
  }
  return sum / buffer.length;
}

function processVolumeSample(playerId, volume, isLocal) {
  const isAboveThreshold = volume >= SPEAKING_THRESHOLD;

  if (isAboveThreshold) {
    if (speakingHoldTimers[playerId]) {
      clearTimeout(speakingHoldTimers[playerId]);
      delete speakingHoldTimers[playerId];
    }
    if (!speakingPlayers.has(playerId)) {
      setPlayerSpeaking(playerId, true);
      if (isLocal) {
        broadcastSpeakingStatus(true);
      }
    }
  } else if (speakingPlayers.has(playerId) && !speakingHoldTimers[playerId]) {
    speakingHoldTimers[playerId] = setTimeout(() => {
      setPlayerSpeaking(playerId, false);
      delete speakingHoldTimers[playerId];
      if (isLocal) {
        broadcastSpeakingStatus(false);
      }
    }, SPEAKING_HOLD_MS);
  }
}

function setPlayerSpeaking(playerId, isSpeaking) {
  const wasSpeaking = speakingPlayers.has(playerId);
  if (wasSpeaking === isSpeaking) return;

  if (isSpeaking) {
    speakingPlayers.add(playerId);
  } else {
    speakingPlayers.delete(playerId);
  }

  const myId = currentPlayerData?.id;
  if (playerId === myId) {
    const myBoard = document.getElementById('my-board');
    const myInd = document.getElementById('my-speaking-indicator');
    if (myBoard) myBoard.classList.toggle('is-speaking', isSpeaking);
    if (myInd) myInd.classList.toggle('hidden', !isSpeaking);

    const btnMic = document.getElementById('btn-toggle-mic');
    if (btnMic && !isMicMuted && localStream) {
      btnMic.classList.toggle('is-talking', isSpeaking);
    }
  } else {
    const card = document.getElementById(`opponent-card-${playerId}`);
    const ind = document.getElementById(`speaking-indicator-${playerId}`);
    if (card) card.classList.toggle('is-speaking', isSpeaking);
    if (ind) ind.classList.toggle('hidden', !isSpeaking);
  }

  const lobbyInd = document.getElementById(`lobby-speaking-${playerId}`);
  if (lobbyInd) {
    lobbyInd.classList.toggle('hidden', !isSpeaking);
  }
}

function clearAllSpeakingHoldTimers() {
  for (const pid of Object.keys(speakingHoldTimers)) {
    clearTimeout(speakingHoldTimers[pid]);
    delete speakingHoldTimers[pid];
  }
}

function setupDataChannel(peerId, channel) {
  dataChannels[peerId] = channel;

  channel.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'speaking') {
        if (data.isSpeaking) {
          if (speakingHoldTimers[peerId]) {
            clearTimeout(speakingHoldTimers[peerId]);
            delete speakingHoldTimers[peerId];
          }
          setPlayerSpeaking(peerId, true);
        } else if (speakingPlayers.has(peerId) && !speakingHoldTimers[peerId]) {
          speakingHoldTimers[peerId] = setTimeout(() => {
            setPlayerSpeaking(peerId, false);
            delete speakingHoldTimers[peerId];
          }, SPEAKING_HOLD_MS);
        }
      }
    } catch (e) {}
  };

  channel.onclose = () => {
    delete dataChannels[peerId];
  };
}

function broadcastSpeakingStatus(isSpeaking) {
  const msg = JSON.stringify({ type: 'speaking', isSpeaking });
  for (const peerId in dataChannels) {
    const dc = dataChannels[peerId];
    if (dc && dc.readyState === 'open') {
      try {
        dc.send(msg);
      } catch (err) {}
    }
  }
}

async function toggleMic() {
  const btn = document.getElementById('btn-toggle-mic');

  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      isMicMuted = false;
      btn.textContent = '🎤 Mic: ON';
      btn.className = 'btn-mic active';

      initLocalAudioAnalyser();

      // Attach local stream to all existing connections
      for (const [peerId, pc] of Object.entries(peerConnections)) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        if (currentPlayerData?.id < peerId) {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await sendSignal(peerId, { type: 'offer', sdp: offer });
          } catch (e) {
            console.warn('Renegotiation offer error:', e);
          }
        }
      }

      await connectToAllPeers();
    } catch (err) {
      alert('Could not access microphone: ' + err.message);
    }
    return;
  }

  isMicMuted = !isMicMuted;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !isMicMuted;
  });

  if (isMicMuted) {
    btn.textContent = '🔇 Mic: MUTED';
    btn.className = 'btn-mic muted';
    btn.classList.remove('is-talking');
    if (currentPlayerData?.id) {
      setPlayerSpeaking(currentPlayerData.id, false);
      broadcastSpeakingStatus(false);
    }
  } else {
    btn.textContent = '🎤 Mic: ON';
    btn.className = 'btn-mic active';
  }
}

function stopVoiceChat() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  if (localAudioSource) {
    try { localAudioSource.disconnect(); } catch (e) {}
    localAudioSource = null;
  }
  localAudioAnalyser = null;

  for (const peerId of Object.keys(peerAudioAnalysers)) {
    cleanupPeerAudio(peerId);
  }

  for (const peerId of Object.keys(dataChannels)) {
    try { dataChannels[peerId].close(); } catch (e) {}
    delete dataChannels[peerId];
  }

  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};

  speakingPlayers.clear();
  clearAllSpeakingHoldTimers();

  const myId = currentPlayerData?.id;
  if (myId) {
    setPlayerSpeaking(myId, false);
  }

  const btn = document.getElementById('btn-toggle-mic');
  if (btn) {
    btn.textContent = '🎤 Enable Voice';
    btn.className = 'btn-mic btn-secondary';
    btn.classList.remove('is-talking');
  }
}

async function connectToAllPeers() {
  if (!currentGameState || !currentPlayerData || !localStream) return;

  const myId = currentPlayerData.id;
  for (const peerId of Object.keys(currentGameState.players)) {
    if (peerId !== myId && !peerConnections[peerId]) {
      // Create connection if initiator
      if (myId < peerId) {
        await initiatePeerConnection(peerId);
      }
    }
  }
}

async function initiatePeerConnection(peerId) {
  const pc = createPeerConnection(peerId);
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // Create data channel on initiator
  try {
    const dc = pc.createDataChannel('voice_chat');
    setupDataChannel(peerId, dc);
  } catch (err) {
    console.warn('Failed to create data channel:', err);
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await sendSignal(peerId, { type: 'offer', sdp: offer });
}

function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[peerId] = pc;

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal(peerId, { type: 'candidate', candidate: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    const stream = event.streams[0];
    const audio = new Audio();
    audio.srcObject = stream;
    audio.autoplay = true;

    attachPeerAudioStream(peerId, stream);
  };

  pc.ondatachannel = (event) => {
    setupDataChannel(peerId, event.channel);
  };

  return pc;
}

async function sendSignal(receiverId, message) {
  try {
    await apiRequest('signal', 'POST', {
      game_id: currentGameId,
      sender_id: currentPlayerData.id,
      receiver_id: receiverId,
      message
    });
  } catch (err) {
    console.error('Failed to send WebRTC signal:', err);
  }
}

async function pollSignals() {
  if (!currentGameId || !currentPlayerData) return;

  try {
    const res = await apiRequest(`signals&game_id=${currentGameId}&player_id=${currentPlayerData.id}`, 'GET');
    for (const item of (res.signals || [])) {
      await handleIncomingSignal(item.sender_id, item.message);
    }
  } catch (err) {
    console.error('Failed to poll signals:', err);
  }
}

async function handleIncomingSignal(senderId, msg) {
  let pc = peerConnections[senderId];

  if (msg.type === 'offer') {
    if (!pc) {
      pc = createPeerConnection(senderId);
      if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
      }
    }
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendSignal(senderId, { type: 'answer', sdp: answer });
  } else if (msg.type === 'answer') {
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    }
  } else if (msg.type === 'candidate') {
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      } catch (err) {
        console.warn('Failed to add ICE candidate:', err);
      }
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
