// Board, Tabletop, Lobby, and Opponents Rendering

import { state } from './state.js';
import { apiRequest } from './api.js';
import { COLOR_NAMES, COLOR_HEX, SET_RULES } from './constants.js';
import { escapeHtml } from './utils.js';
import { showToast } from './ui.js';
import { playGameSound } from './audio.js';
import {
  createCardElement,
  createMiniPropertyCard,
  createMiniBankBill,
  getSetPropertiesCount,
  isCompleteSet,
  setHasHouse,
  setHasHotel,
  getPropertySetValue
} from './cards.js';
import {
  renderPendingActionModal,
  renderPaymentModal,
  closePaymentModal,
  checkExcessCardsNotification,
  showWinnerAnnouncementModal,
  openCardModal,
  openInspectModal
} from './modals.js';

export function render() {
  if (!state.currentGameState) return;

  const myId = state.currentPlayerData?.id;
  if (!myId) return;

  const isPlaying = state.currentGameState.status === 'playing';
  const isLobby = state.currentGameState.status === 'lobby';
  const isFinished = state.currentGameState.status === 'finished';

  document.getElementById('room-code-display').textContent = state.currentGameId;
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

  const myPlayer = state.currentGameState.players?.[myId];
  if (!myPlayer) return;

  const isMyTurn = state.currentGameState.turn?.active_player_id === myId;
  const activePlayer = state.currentGameState.players?.[state.currentGameState.turn?.active_player_id];
  const pending = state.currentGameState.pending_payment;
  const pendingAction = state.currentGameState.pending_action;

  // Check pending action or pending payment modal
  if (pendingAction && myPlayer) {
    if (pendingAction.current_respondent_id === myId) {
      renderPendingActionModal(pendingAction, myPlayer);
    } else {
      closePaymentModal();
    }
  } else if (pending && myPlayer) {
    const myPayer = pending.payers?.[myId];
    const isCollectorChallenged = (pending.collector_id === myId) && Object.values(pending.payers || {}).some(p => !p.paid && p.current_respondent_id === myId);

    if ((myPayer && !myPayer.paid && (myPayer.current_respondent_id ?? myId) === myId) || isCollectorChallenged) {
      renderPaymentModal(pending, myPlayer);
    } else {
      closePaymentModal();
    }
  } else {
    closePaymentModal();
  }

  // Check excess cards notification modal (for this player only)
  checkExcessCardsNotification(myPlayer);

  // Turn status badge & End Turn button
  const turnBadge = document.getElementById('turn-badge');
  const actionsBadge = document.getElementById('actions-badge');
  const btnEndTurn = document.getElementById('btn-end-turn');

  if (pendingAction) {
    const respPlayer = state.currentGameState.players?.[pendingAction.current_respondent_id];
    const respName = respPlayer ? respPlayer.name : 'Opponent';
    turnBadge.textContent = "⏳ Awaiting Action Response";
    turnBadge.className = "badge badge-actions";
    actionsBadge.textContent = `${respName} responding to ${pendingAction.action_card?.name || 'Action'}`;
    if (btnEndTurn) {
      btnEndTurn.disabled = true;
      btnEndTurn.textContent = 'End Turn';
    }
  } else if (pending) {
    const unpaid = Object.values(pending.payers || {}).filter(p => !p.paid).map(p => p.name);
    if (unpaid.length > 0) {
      turnBadge.textContent = "⏳ Awaiting Payment";
      turnBadge.className = "badge badge-actions";
      actionsBadge.textContent = `${unpaid.join(', ')} paying ${pending.reason}`;
      if (btnEndTurn) {
        btnEndTurn.disabled = true;
        btnEndTurn.textContent = 'End Turn';
      }
    } else {
      turnBadge.textContent = isMyTurn ? "Your Turn!" : `${activePlayer ? activePlayer.name : 'Unknown'}'s Turn`;
      turnBadge.className = `badge ${isMyTurn ? 'badge-turn' : 'badge-actions'}`;
      actionsBadge.textContent = `${state.currentGameState.turn.actions_left} Actions Left`;
      if (btnEndTurn) {
        btnEndTurn.disabled = !isMyTurn || isFinished;
        btnEndTurn.textContent = 'End Turn';
      }
    }
  } else {
    turnBadge.textContent = isMyTurn ? "Your Turn!" : `${activePlayer ? activePlayer.name : 'Unknown'}'s Turn`;
    turnBadge.className = `badge ${isMyTurn ? 'badge-turn' : 'badge-actions'}`;
    actionsBadge.textContent = `${state.currentGameState.turn.actions_left} Actions Left`;

    if (btnEndTurn) {
      if (isMyTurn && !isFinished) {
        btnEndTurn.disabled = false;
        btnEndTurn.textContent = 'End Turn';
      } else {
        btnEndTurn.disabled = true;
        btnEndTurn.textContent = 'End Turn';
      }
    }
  }

  // Auto-end turn safeguard: If all 3 actions used and no pending payments or actions
  if (isMyTurn && isPlaying && !pending && !pendingAction && (state.currentGameState?.turn?.actions_left ?? 3) <= 0 && !state.isAutoEndingTurn) {
    state.isAutoEndingTurn = true;
    (async () => {
      try {
        const res = await apiRequest('end_turn', 'POST', {
          game_id: state.currentGameId,
          player_id: myId,
          discard_ids: []
        });
        state.currentGameState = res.state;
        render();
      } catch (err) {
        console.warn('Auto end turn safeguard error:', err);
      } finally {
        state.isAutoEndingTurn = false;
      }
    })();
  }

  // Turn change detection & toast
  if (isPlaying && state.previousActivePlayerId !== null && state.currentGameState.turn.active_player_id !== state.previousActivePlayerId) {
    if (isMyTurn) {
      showToast("It's Your Turn! 🎩", "You have 3 actions to play.", "🎩", "turn");
      playGameSound("turn");
    }
  }
  state.previousActivePlayerId = state.currentGameState?.turn?.active_player_id || null;

  // New pending action detection & toast alert
  if (pendingAction && pendingAction.current_respondent_id === myId) {
    const prevAction = state.previousPendingAction;
    if (!prevAction || prevAction.action_card?.id !== pendingAction.action_card?.id || prevAction.jsn_count !== pendingAction.jsn_count) {
      if (pendingAction.jsn_count === 0) {
        showToast("Action Targeted! 🚨", `${pendingAction.initiator_name} used ${pendingAction.action_card.name} on you!`, "🚨", "alert");
        playGameSound("alert");
      } else {
        const whoPlayed = (pendingAction.current_respondent_id === pendingAction.initiator_id) ? pendingAction.target_name : pendingAction.initiator_name;
        showToast("Just Say No! 🛑", `${whoPlayed} played Just Say No!`, "🛑", "alert");
        playGameSound("alert");
      }
    }
  }
  state.previousPendingAction = pendingAction;

  // New pending payment detection & alert
  if (pending && myPlayer) {
    const myPayer = pending.payers?.[myId];
    if (myPayer && !myPayer.paid && (myPayer.current_respondent_id ?? myId) === myId) {
      if (!state.previousPendingPayment || state.previousPendingPayment.action_card?.id !== pending.action_card?.id || state.previousPendingPayment.payers?.[myId]?.jsn_count !== myPayer.jsn_count) {
        if ((myPayer.jsn_count ?? 0) === 0) {
          showToast("Payment Demanded! 🚨", `${pending.collector_name} demands $${myPayer.amount_due}M!`, "🚨", "alert");
          playGameSound("alert");
        } else {
          showToast("Just Say No Counter! 🛑", `${pending.collector_name} countered with Just Say No!`, "🛑", "alert");
          playGameSound("alert");
        }
      }
    } else if (pending.collector_id === myId) {
      const challengedPayer = Object.values(pending.payers || {}).find(p => !p.paid && p.current_respondent_id === myId);
      if (challengedPayer && (!state.previousChallengedPayer || state.previousChallengedPayer.jsn_count !== challengedPayer.jsn_count)) {
        showToast("Just Say No! 🛑", `${challengedPayer.name} played Just Say No to cancel payment!`, "🛑", "alert");
        playGameSound("alert");
      }
      state.previousChallengedPayer = challengedPayer;
    }
  }
  state.previousPendingPayment = pending;

  // Process game logs into toast notifications & audio chimes
  if (state.currentGameState.logs && state.currentGameState.logs.length > 0) {
    if (state.lastProcessedLogTimestamp === 0) {
      state.lastProcessedLogTimestamp = state.currentGameState.logs[state.currentGameState.logs.length - 1].time;
    } else {
      const newLogs = state.currentGameState.logs.filter(l => l.time > state.lastProcessedLogTimestamp);
      newLogs.forEach(l => {
        state.lastProcessedLogTimestamp = Math.max(state.lastProcessedLogTimestamp, l.time);
        const text = l.text || '';
        let icon = '📢';
        let type = 'info';
        let sound = 'action';

        if (text.includes('rent') || text.includes('Rent') || text.includes('demanding') || text.includes('demanded')) {
          icon = '💰';
          type = 'alert';
          sound = 'debt';
        } else if (text.includes('Birthday')) {
          icon = '🎂';
          type = 'alert';
          sound = 'alert';
        } else if (text.includes('Sly Deal')) {
          icon = '🕵️';
          type = 'alert';
          sound = 'alert';
        } else if (text.includes('Forced Deal')) {
          icon = '🔄';
          type = 'alert';
          sound = 'alert';
        } else if (text.includes('Deal Breaker')) {
          icon = '🚨';
          type = 'alert';
          sound = 'debt';
        } else if (text.includes('Just Say No') || text.includes('JUST SAY NO')) {
          icon = '🛑';
          type = 'alert';
          sound = 'alert';
        } else if (text.includes('banked')) {
          icon = '💵';
          type = 'info';
          sound = 'action';
        } else if (text.includes('WON THE GAME')) {
          icon = '🎉';
          type = 'win';
          sound = 'win';
        }

        showToast('Game Event', text, icon, type);
        playGameSound(sound);
      });
    }
  }

  // Deck & Discard Table Display
  const deckCount = state.currentGameState.deck_count ?? 0;
  document.getElementById('deck-count').textContent = deckCount;

  const discardSlot = document.getElementById('discard-pile-slot');
  const discardTopLabel = document.getElementById('discard-top-label');
  const discardTopLegacy = document.getElementById('discard-top');

  if (state.currentGameState.discard && state.currentGameState.discard.length > 0) {
    const topCard = state.currentGameState.discard[state.currentGameState.discard.length - 1];
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
  renderLogs(state.currentGameState.logs || []);

  if (isFinished && state.currentGameState.winner_id) {
    if (!state.hasShownWinnerModal) {
      state.hasShownWinnerModal = true;
      showWinnerAnnouncementModal(state.currentGameState);
    }
  }
}

export function renderLobbyView() {
  state.hasShownWinnerModal = false;
  state.previousActivePlayerId = null;
  state.previousPendingPayment = null;
  state.lastProcessedLogTimestamp = 0;

  document.getElementById('lobby-view').classList.remove('hidden');
  document.getElementById('game-view').classList.add('hidden');
  document.getElementById('turn-badge')?.classList.add('hidden');
  document.getElementById('actions-badge')?.classList.add('hidden');
  document.getElementById('btn-toggle-mic')?.classList.add('hidden');
  document.getElementById('btn-end-turn')?.classList.add('hidden');
  document.getElementById('btn-leave-game')?.classList.remove('hidden');

  const playersList = document.getElementById('lobby-players');
  playersList.innerHTML = '';

  const myId = state.currentPlayerData?.id;
  const myPlayer = state.currentGameState?.players?.[myId];

  Object.values(state.currentGameState.players).forEach(p => {
    const isSpeaking = state.speakingPlayers.has(p.id);
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
  startBtn.disabled = Object.keys(state.currentGameState.players).length < 2;
}

export function renderOpponents(myId) {
  const container = document.getElementById('opponents-container');
  container.innerHTML = '';

  Object.values(state.currentGameState.players).forEach(p => {
    if (p.id === myId) return;

    const isTurn = state.currentGameState.turn.active_player_id === p.id;
    const isSpeaking = state.speakingPlayers.has(p.id);
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

export function renderMyTable(myPlayer) {
  if (!myPlayer) return;

  const myNameDisplay = document.getElementById('my-player-name-display');
  if (myNameDisplay) {
    myNameDisplay.textContent = `${myPlayer.name || 'You'} (You)`;
  }
  const myBoard = document.getElementById('my-board');
  const mySpeakingIndicator = document.getElementById('my-speaking-indicator');
  const isSpeaking = state.speakingPlayers.has(myPlayer.id);

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

  const isMyTurn = state.currentGameState?.turn?.active_player_id === myPlayer.id;

  // Properties
  renderPropertySets(myPlayer.property_sets || {}, document.getElementById('my-properties-container'), true, isMyTurn);

  // Hand
  const handContainer = document.getElementById('my-hand-container');
  handContainer.innerHTML = '';

  (myPlayer.hand || []).forEach(card => {
    const canPlay = isMyTurn && state.currentGameState.turn.actions_left > 0 && !state.currentGameState.pending_payment && !state.currentGameState.pending_action;
    const cardEl = createCardElement(card, canPlay);
    if (canPlay) {
      cardEl.classList.add('is-turn-playable');
      cardEl.addEventListener('click', () => openCardModal(card));
    } else {
      cardEl.addEventListener('click', () => openInspectModal(card));
    }
    handContainer.appendChild(cardEl);
  });
}

export function renderPropertySets(propertySets, container, isOwner = false, isMyTurn = false) {
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
    const setVal = getPropertySetValue(color, propCount, hasHouse, hasHotel);

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
    header.innerHTML = `<span>${colorName} ($${setVal}M)</span> ${badge}`;
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

export function renderLogs(logs) {
  const container = document.getElementById('logs-container');
  if (!container) return;
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
