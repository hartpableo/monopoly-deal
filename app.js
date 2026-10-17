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
const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

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
  brown: '#8b4513',
  dark_blue: '#00008b',
  green: '#15803d',
  yellow: '#ca8a04',
  red: '#b91c1c',
  orange: '#c2410c',
  pink: '#db2777',
  light_blue: '#0284c7',
  railroad: '#475569',
  utility: '#4b5563'
};

document.addEventListener('DOMContentLoaded', () => {
  setupLobbyEvents();
  setupGameEvents();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('demo')) {
    loadDemoGame();
    return;
  }

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
  const demoBtn = document.getElementById('btn-demo-game');
  if (demoBtn) {
    demoBtn.addEventListener('click', loadDemoGame);
  }
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

async function loadDemoGame() {
  try {
    const res = await apiRequest('demo', 'GET');
    saveSession(res.game_id, res.player_id, 'You');
    currentGameState = res.state;
    render();
    startPolling();
  } catch (err) {
    alert('Failed to load demo game: ' + err.message);
  }
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

  document.getElementById('btn-leave-game').addEventListener('click', () => {
    if (confirm('Leave current game?')) {
      clearSession();
    }
  });

  document.getElementById('btn-toggle-mic').addEventListener('click', toggleMic);
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
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

  // Deck & Discard
  document.getElementById('deck-count').textContent = currentGameState.deck_count ?? 0;
  const lastDiscard = currentGameState.discard.length > 0
    ? currentGameState.discard[currentGameState.discard.length - 1].name
    : 'Empty';
  document.getElementById('discard-top').textContent = lastDiscard;

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

  const playersList = document.getElementById('lobby-players');
  playersList.innerHTML = '';

  const myId = currentPlayerData.id;
  const myPlayer = currentGameState.players[myId];

  Object.values(currentGameState.players).forEach(p => {
    const li = document.createElement('li');
    li.className = 'lobby-player-item';
    li.innerHTML = `<span><strong>${escapeHtml(p.name)}</strong> ${p.is_host ? '(Host)' : ''}</span>`;
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
    const card = document.createElement('div');
    card.className = `opponent-card ${isTurn ? 'is-turn' : ''}`;

    const totalBank = (p.bank || []).reduce((acc, c) => acc + (c.value || 0), 0);

    card.innerHTML = `
      <div class="opponent-header">
        <span>${escapeHtml(p.name)} ${isTurn ? '🎲' : ''}</span>
      </div>
      <div class="player-stats">
        <span>Cards: <strong>${p.hand_count ?? 0}</strong></span>
        <span>Bank: <strong>$${totalBank}M</strong></span>
      </div>
      <div class="section-title">Properties:</div>
      <div class="sets-container" id="opponent-sets-${p.id}"></div>
    `;

    container.appendChild(card);
    renderPropertySets(p.property_sets || {}, card.querySelector(`#opponent-sets-${p.id}`));
  });
}

function renderMyTable(myPlayer) {
  if (!myPlayer) return;

  // Bank
  const totalBank = (myPlayer.bank || []).reduce((acc, c) => acc + (c.value || 0), 0);
  document.getElementById('my-bank-total').textContent = `$${totalBank}M`;
  const bankContainer = document.getElementById('my-bank-container');
  bankContainer.innerHTML = '';
  (myPlayer.bank || []).forEach(c => {
    const el = document.createElement('div');
    el.className = 'mini-card';
    el.textContent = `${c.name} ($${c.value}M)`;
    bankContainer.appendChild(el);
  });

  // Properties
  renderPropertySets(myPlayer.property_sets || {}, document.getElementById('my-properties-container'));

  // Hand
  const handContainer = document.getElementById('my-hand-container');
  handContainer.innerHTML = '';
  const isMyTurn = currentGameState.turn.active_player_id === myPlayer.id;

  (myPlayer.hand || []).forEach(card => {
    const cardEl = createCardElement(card, isMyTurn);
    if (isMyTurn && currentGameState.turn.actions_left > 0) {
      cardEl.addEventListener('click', () => openCardModal(card));
    }
    handContainer.appendChild(cardEl);
  });
}

const SET_SIZES = {
  brown: 2,
  dark_blue: 2,
  green: 3,
  yellow: 3,
  red: 3,
  orange: 3,
  pink: 3,
  light_blue: 3,
  railroad: 4,
  utility: 2
};

function renderPropertySets(propertySets, container) {
  container.innerHTML = '';
  const entries = Object.entries(propertySets);

  if (entries.length === 0) {
    container.innerHTML = `<span style="color: #64748b; font-size: 0.8rem;">No properties laid down yet</span>`;
    return;
  }

  entries.forEach(([color, cards]) => {
    if (!cards || cards.length === 0) return;
    const group = document.createElement('div');
    group.className = 'property-group';

    const colorHex = COLOR_HEX[color] || '#333';
    const colorName = COLOR_NAMES[color] || color;
    const targetSize = SET_SIZES[color] || 3;
    const isComplete = cards.length >= targetSize;

    if (isComplete) {
      group.style.borderColor = '#22c55e';
      group.style.boxShadow = '0 0 8px rgba(34, 197, 94, 0.25)';
    }

    const badge = isComplete
      ? `<span style="background: #166534; color: #86efac; padding: 1px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 700;">FULL SET 🏆</span>`
      : `<span style="opacity: 0.85; font-size: 0.7rem;">(${cards.length}/${targetSize})</span>`;

    group.innerHTML = `
      <div class="group-header" style="background: ${colorHex}">
        <span>${colorName}</span>
        ${badge}
      </div>
      <div style="display:flex; flex-direction:column; gap:4px;">
        ${cards.map(c => `<div class="mini-card">${escapeHtml(c.name)}</div>`).join('')}
      </div>
    `;
    container.appendChild(group);
  });
}

function createCardElement(card, interactive = false) {
  const el = document.createElement('div');
  el.className = `deal-card ${interactive ? 'interactive' : ''}`;

  let stripeHtml = '';
  if (card.colors && card.colors.length > 0) {
    const firstColor = card.colors[0];
    const stripeBg = COLOR_HEX[firstColor] || '#475569';
    stripeHtml = `<div class="card-color-stripe" style="background: ${stripeBg}">${COLOR_NAMES[firstColor] || firstColor}</div>`;
  }

  el.innerHTML = `
    <div class="card-top">
      <span style="text-transform: capitalize; color: #64748b;">${card.type.replace('_', ' ')}</span>
      <div class="card-value-circle">$${card.value}M</div>
    </div>
    ${stripeHtml}
    <div class="card-title">${escapeHtml(card.name)}</div>
    <div class="card-desc">${escapeHtml(card.desc || '')}</div>
  `;
  return el;
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
  actionsContainer.innerHTML = '';

  // 1. Bank option (Available for Money, Action, and Rent cards)
  const bankBtn = document.createElement('button');
  bankBtn.textContent = `Deposit into Bank ($${card.value}M)`;
  bankBtn.addEventListener('click', () => executePlay(card.id, 'bank'));
  actionsContainer.appendChild(bankBtn);

  // 2. Property option (Available for Property & Wild Property)
  if (card.type === 'property' || card.type === 'wild_property') {
    if (card.colors && card.colors.length > 1) {
      // Pick color for wildcard
      const select = document.createElement('select');
      select.style.padding = '8px';
      select.style.borderRadius = '6px';
      select.style.background = '#0f172a';
      select.style.color = '#fff';

      card.colors.forEach(col => {
        const opt = document.createElement('option');
        opt.value = col;
        opt.textContent = `Set Color: ${COLOR_NAMES[col] || col}`;
        select.appendChild(opt);
      });

      const propBtn = document.createElement('button');
      propBtn.className = 'btn-secondary';
      propBtn.textContent = 'Lay down Property';
      propBtn.addEventListener('click', () => {
        executePlay(card.id, 'property', { color: select.value });
      });

      actionsContainer.appendChild(select);
      actionsContainer.appendChild(propBtn);
    } else {
      const propBtn = document.createElement('button');
      propBtn.className = 'btn-secondary';
      propBtn.textContent = 'Lay down Property';
      propBtn.addEventListener('click', () => executePlay(card.id, 'property'));
      actionsContainer.appendChild(propBtn);
    }
  }

  // 3. Action / Rent play
  if (card.type === 'action' || card.type === 'rent' || card.type === 'rent_wild') {
    const actBtn = document.createElement('button');
    actBtn.style.background = '#7c3aed';
    actBtn.textContent = `Play as Action (${card.name})`;

    actBtn.addEventListener('click', () => {
      let params = {};
      if (card.action === 'debt_collector') {
        const opponents = Object.values(currentGameState.players).filter(p => p.id !== currentPlayerData.id);
        const targetName = prompt(`Select player to collect 5M from:\n` + opponents.map(p => `${p.name} (id: ${p.id})`).join('\n'));
        const target = opponents.find(p => p.id === targetName || p.name.toLowerCase() === (targetName || '').toLowerCase());
        if (!target) return alert('Invalid player selected.');
        params.target_player_id = target.id;
      }
      executePlay(card.id, 'action', params);
    });

    actionsContainer.appendChild(actBtn);
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
   WEBRTC VOICE CHAT (MIC FEATURE)
======================================================== */
async function toggleMic() {
  const btn = document.getElementById('btn-toggle-mic');

  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      btn.textContent = '🎤 Mic: ON';
      btn.className = 'btn-mic active';
      connectToAllPeers();
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
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};
  const btn = document.getElementById('btn-toggle-mic');
  if (btn) {
    btn.textContent = '🎤 Enable Voice';
    btn.className = 'btn-mic btn-secondary';
  }
}

async function connectToAllPeers() {
  if (!currentGameState || !currentPlayerData || !localStream) return;

  const myId = currentPlayerData.id;
  for (const peerId of Object.keys(currentGameState.players)) {
    if (peerId !== myId && !peerConnections[peerId]) {
      // Create connection
      if (myId < peerId) {
        // Initiator
        await initiatePeerConnection(peerId);
      }
    }
  }
}

async function initiatePeerConnection(peerId) {
  const pc = createPeerConnection(peerId);
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

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
    const audio = new Audio();
    audio.srcObject = event.streams[0];
    audio.autoplay = true;
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
  if (!currentGameId || !currentPlayerData || !localStream) return;

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
      await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
