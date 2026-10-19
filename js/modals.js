// Game Modals (Card Action, Wildcard Move, Inspect, Payment, Excess Cards, Winner)

import { state } from './state.js';
import { COLOR_NAMES, COLOR_HEX, SET_RULES } from './constants.js';
import { escapeHtml } from './utils.js';
import { apiRequest } from './api.js';
import { showToast } from './ui.js';
import { playGameSound } from './audio.js';
import {
  createCardElement,
  isCompleteSet,
  setHasHouse,
  setHasHotel,
  getPropertySetValue,
  calculatePlayerTableValue,
  getSwapIconSvg
} from './cards.js';
import { render } from './render.js';
import { clearSession } from './game.js';

/* ========================================================
   CARD ACTIONS MODAL
======================================================== */
export function openCardModal(card) {
  if (state.currentGameState?.pending_payment || state.currentGameState?.pending_action) {
    alert("Please resolve the pending action or payment before taking an action.");
    return;
  }
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

  // 1. Bank option (Available for Money, Action, and Rent cards - NOT Properties)
  if (card.type !== 'property' && card.type !== 'wild_property') {
    const bankBtn = document.createElement('button');
    bankBtn.className = 'btn-bank';
    bankBtn.textContent = `Deposit into Bank ($${card.value}M)`;
    bankBtn.addEventListener('click', () => executePlay(card.id, 'bank'));
    actionsContainer.appendChild(bankBtn);
  }

  // 2. Property option (Available for Property & Wild Property)
  if (card.type === 'property' || card.type === 'wild_property') {
    if (card.colors && card.colors.length > 1) {
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

    const myPlayer = state.currentGameState.players[state.currentPlayerData.id] || {};
    const opponents = Object.values(state.currentGameState.players || {}).filter(p => p.id !== state.currentPlayerData.id);

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
      if (opponents.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'empty-state-text';
        hint.textContent = 'No opponents available to steal from.';
        actSection.appendChild(hint);
      } else {
        const oppLabel = document.createElement('label');
        oppLabel.textContent = '1. Select Target Opponent:';
        oppLabel.style.fontSize = '0.8rem';
        oppLabel.style.fontWeight = 'bold';
        actSection.appendChild(oppLabel);

        const oppSelect = document.createElement('select');
        oppSelect.className = 'modal-select';
        opponents.forEach(opp => {
          const opt = document.createElement('option');
          opt.value = opp.id;
          opt.textContent = opp.name;
          oppSelect.appendChild(opt);
        });
        actSection.appendChild(oppSelect);

        const propLabel = document.createElement('label');
        propLabel.textContent = '2. Choose Opponent Property (Incomplete set, single or dual color):';
        propLabel.style.fontSize = '0.8rem';
        propLabel.style.fontWeight = 'bold';
        propLabel.style.marginTop = '6px';
        actSection.appendChild(propLabel);

        const propSelect = document.createElement('select');
        propSelect.className = 'modal-select';
        actSection.appendChild(propSelect);

        const slyBtn = document.createElement('button');
        slyBtn.className = 'btn-action';
        slyBtn.textContent = '🕵️ Steal Property!';
        actSection.appendChild(slyBtn);

        function updateEligibleProps() {
          const targetOppId = oppSelect.value;
          const targetOpp = opponents.find(o => o.id === targetOppId);
          propSelect.innerHTML = '';
          const eligibleProps = [];

          if (targetOpp) {
            Object.entries(targetOpp.property_sets || {}).forEach(([color, cards]) => {
              if (!isCompleteSet(cards, color)) {
                (cards || []).forEach(c => {
                  const isStandard = c.type === 'property';
                  const isDualWild = c.type === 'wild_property' && (c.colors || []).length === 2;
                  if (isStandard || isDualWild) {
                    eligibleProps.push({
                      card: c,
                      color,
                      name: `${c.name} (${COLOR_NAMES[color] || color})`
                    });
                  }
                });
              }
            });
          }

          if (eligibleProps.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No eligible properties to steal from this opponent';
            propSelect.appendChild(opt);
            propSelect.disabled = true;
            slyBtn.disabled = true;
          } else {
            propSelect.disabled = false;
            slyBtn.disabled = false;
            eligibleProps.forEach((p, idx) => {
              const opt = document.createElement('option');
              opt.value = idx;
              opt.textContent = p.name;
              propSelect.appendChild(opt);
            });
          }
          propSelect._eligible = eligibleProps;
        }

        oppSelect.addEventListener('change', updateEligibleProps);
        updateEligibleProps();

        slyBtn.addEventListener('click', () => {
          const eligible = propSelect._eligible || [];
          const chosen = eligible[parseInt(propSelect.value, 10)];
          if (!chosen) return;
          executePlay(card.id, 'action', {
            target_player_id: oppSelect.value,
            card_id: chosen.card.id
          });
        });
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

      if (myProps.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'empty-state-text';
        hint.textContent = 'You need at least 1 property in an incomplete set to trade.';
        actSection.appendChild(hint);
      } else if (opponents.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'empty-state-text';
        hint.textContent = 'No opponents available to trade with.';
        actSection.appendChild(hint);
      } else {
        const l1 = document.createElement('label');
        l1.textContent = '1. Select Your Property to Give:';
        l1.style.fontSize = '0.8rem';
        l1.style.fontWeight = 'bold';
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

        const oppLabel = document.createElement('label');
        oppLabel.textContent = '2. Select Target Opponent:';
        oppLabel.style.fontSize = '0.8rem';
        oppLabel.style.fontWeight = 'bold';
        oppLabel.style.marginTop = '6px';
        actSection.appendChild(oppLabel);

        const oppSelect = document.createElement('select');
        oppSelect.className = 'modal-select';
        opponents.forEach(opp => {
          const opt = document.createElement('option');
          opt.value = opp.id;
          opt.textContent = opp.name;
          oppSelect.appendChild(opt);
        });
        actSection.appendChild(oppSelect);

        const propLabel = document.createElement('label');
        propLabel.textContent = '3. Choose Opponent Property (Incomplete set, single or dual color):';
        propLabel.style.fontSize = '0.8rem';
        propLabel.style.fontWeight = 'bold';
        propLabel.style.marginTop = '6px';
        actSection.appendChild(propLabel);

        const propSelect = document.createElement('select');
        propSelect.className = 'modal-select';
        actSection.appendChild(propSelect);

        const swapBtn = document.createElement('button');
        swapBtn.className = 'btn-action';
        swapBtn.textContent = '🔄 Swap Properties!';
        actSection.appendChild(swapBtn);

        function updateEligibleOpponentProps() {
          const targetOppId = oppSelect.value;
          const targetOpp = opponents.find(o => o.id === targetOppId);
          propSelect.innerHTML = '';
          const eligibleProps = [];

          if (targetOpp) {
            Object.entries(targetOpp.property_sets || {}).forEach(([color, cards]) => {
              if (!isCompleteSet(cards, color)) {
                (cards || []).forEach(c => {
                  const isStandard = c.type === 'property';
                  const isDualWild = c.type === 'wild_property' && (c.colors || []).length === 2;
                  if (isStandard || isDualWild) {
                    eligibleProps.push({
                      card: c,
                      color,
                      name: `${c.name} (${COLOR_NAMES[color] || color})`
                    });
                  }
                });
              }
            });
          }

          if (eligibleProps.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No eligible properties to swap from this opponent';
            propSelect.appendChild(opt);
            propSelect.disabled = true;
            swapBtn.disabled = true;
          } else {
            propSelect.disabled = false;
            swapBtn.disabled = false;
            eligibleProps.forEach((p, idx) => {
              const opt = document.createElement('option');
              opt.value = idx;
              opt.textContent = p.name;
              propSelect.appendChild(opt);
            });
          }
          propSelect._eligible = eligibleProps;
        }

        oppSelect.addEventListener('change', updateEligibleOpponentProps);
        updateEligibleOpponentProps();

        swapBtn.addEventListener('click', () => {
          const m = myProps[parseInt(selMine.value, 10)];
          const eligible = propSelect._eligible || [];
          const o = eligible[parseInt(propSelect.value, 10)];
          if (!m || !o) return;
          executePlay(card.id, 'action', {
            target_player_id: oppSelect.value,
            my_card_id: m.card.id,
            target_card_id: o.card.id
          });
        });
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
    } else if (card.action === 'just_say_no') {
      const hint = document.createElement('div');
      hint.className = 'empty-state-text';
      hint.style.fontSize = '0.82rem';
      hint.style.lineHeight = '1.35';
      hint.textContent = '💡 Just Say No is played as a reaction when an opponent targets you or demands payment! (You can also deposit it into your bank for $4M above).';
      actSection.appendChild(hint);
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

export function closeModal() {
  document.getElementById('action-modal').classList.add('hidden');
}

export async function executePlay(cardId, targetType, params = {}) {
  closeModal();
  try {
    const res = await apiRequest('play', 'POST', {
      game_id: state.currentGameId,
      player_id: state.currentPlayerData.id,
      card_id: cardId,
      target_type: targetType,
      params
    });
    state.currentGameState = res.state;
    render();
  } catch (err) {
    alert(err.message);
  }
}

/* ========================================================
   WILDCARD MOVE MODAL
======================================================== */
export function openMoveWildcardModal(card, currentColor) {
  const modal = document.getElementById('move-wild-modal');
  const title = document.getElementById('move-wild-title');
  const preview = document.getElementById('move-wild-preview');
  const desc = document.getElementById('move-wild-desc');
  const options = document.getElementById('move-wild-options');
  const cancelBtn = document.getElementById('move-wild-cancel-btn');
  const closeX = document.getElementById('move-wild-close-x');

  if (!modal || !options) return;

  const myId = state.currentPlayerData?.id;
  const isMyTurn = state.currentGameState?.turn?.active_player_id === myId;
  if (!isMyTurn) {
    alert("You can only move wildcards on your turn!");
    return;
  }

  title.innerHTML = `${getSwapIconSvg(18)} <span>Move Wildcard: ${escapeHtml(card.name)}</span>`;
  if (preview) {
    preview.innerHTML = '';
    preview.appendChild(createCardElement(card, false, true));
  }

  const activeColor = currentColor || card.current_color || (card.colors && card.colors[0]);
  const availableColors = (card.colors || []).filter(c => c !== activeColor);

  options.innerHTML = '';

  if (availableColors.length === 0) {
    desc.textContent = "No other color sets available for this wildcard.";
  } else {
    desc.textContent = `Currently in ${COLOR_NAMES[activeColor] || activeColor} set. Select target color set (Free action - does not use a move):`;

    const grid = document.createElement('div');
    grid.className = 'move-wild-colors-grid';

    availableColors.forEach(col => {
      const btn = document.createElement('button');
      btn.className = 'move-wild-color-btn';
      const colHex = COLOR_HEX[col] || '#333';
      btn.innerHTML = `
        <span class="move-wild-color-swatch" style="background: ${colHex};"></span>
        <span>Move to ${COLOR_NAMES[col] || col}</span>
      `;
      btn.addEventListener('click', async () => {
        modal.classList.add('hidden');
        try {
          const res = await apiRequest('move_property', 'POST', {
            game_id: state.currentGameId,
            player_id: state.currentPlayerData.id,
            card_id: card.id,
            to_color: col
          });
          state.currentGameState = res.state;
          render();
          showToast('Wildcard Moved', `Moved ${card.name} to ${COLOR_NAMES[col] || col} set.`, '🔄', 'action');
          playGameSound('action');
        } catch (err) {
          alert(err.message);
        }
      });
      grid.appendChild(btn);
    });

    options.appendChild(grid);
  }

  const handleClose = () => modal.classList.add('hidden');
  cancelBtn.onclick = handleClose;
  closeX.onclick = handleClose;

  modal.classList.remove('hidden');
}

/* ========================================================
   CARD INSPECT MODAL
======================================================== */
export function openInspectModal(card) {
  const modal = document.getElementById('inspect-modal');
  const title = document.getElementById('inspect-card-title');
  const preview = document.getElementById('inspect-card-preview');

  title.textContent = card.name;
  preview.innerHTML = '';
  preview.appendChild(createCardElement(card, false, true));

  const myId = state.currentPlayerData?.id;
  const isMyTurn = state.currentGameState?.turn?.active_player_id === myId;
  const myPlayer = state.currentGameState?.players?.[myId];
  let isCardOnMyTable = false;
  let currentColor = null;
  if (myPlayer && myPlayer.property_sets) {
    for (const [col, cards] of Object.entries(myPlayer.property_sets)) {
      if ((cards || []).some(c => c.id === card.id)) {
        isCardOnMyTable = true;
        currentColor = col;
        break;
      }
    }
  }

  const oldBtn = document.getElementById('inspect-move-wild-btn');
  if (oldBtn) oldBtn.remove();

  if (card.type === 'wild_property' && isCardOnMyTable) {
    const moveBtn = document.createElement('button');
    moveBtn.id = 'inspect-move-wild-btn';
    moveBtn.className = 'btn-primary';
    moveBtn.style.width = '100%';
    moveBtn.style.marginTop = '8px';
    moveBtn.style.display = 'inline-flex';
    moveBtn.style.alignItems = 'center';
    moveBtn.style.justifyContent = 'center';
    moveBtn.style.gap = '6px';
    moveBtn.innerHTML = `${getSwapIconSvg(15)} <span>Move / Swap Wildcard Color</span>`;
    if (!isMyTurn) {
      moveBtn.disabled = true;
      moveBtn.title = "Can only move wildcards on your turn";
      moveBtn.style.opacity = '0.55';
      moveBtn.style.cursor = 'not-allowed';
    } else {
      moveBtn.addEventListener('click', () => {
        closeInspectModal();
        openMoveWildcardModal(card, currentColor);
      });
    }
    modal.querySelector('.modal-content').insertBefore(moveBtn, document.getElementById('inspect-close-btn'));
  }

  modal.classList.remove('hidden');
}

export function closeInspectModal() {
  document.getElementById('inspect-modal').classList.add('hidden');
}

/* ========================================================
   WINNER ANNOUNCEMENT MODAL
======================================================== */
export function showWinnerAnnouncementModal(gameState) {
  const modal = document.getElementById('winner-modal');
  if (!modal || !gameState) return;

  const winnerId = gameState.winner_id;
  const winner = gameState.players?.[winnerId] || { name: 'Player' };
  const title = document.getElementById('winner-announcement-title');
  const subtitle = document.getElementById('winner-announcement-subtitle');
  const container = document.getElementById('winner-standings-container');
  const leaveBtn = document.getElementById('winner-leave-btn');
  const closeBtn = document.getElementById('winner-close-btn');

  if (title) title.textContent = `🎉 ${winner.name} Won the Game! 🎉`;
  if (subtitle) subtitle.textContent = `Completed 3 full property sets and won Monopoly Deal!`;

  if (container) {
    container.innerHTML = '';
    const players = Object.values(gameState.players || {});
    players.sort((a, b) => {
      if (a.id === winnerId) return -1;
      if (b.id === winnerId) return 1;
      return calculatePlayerTableValue(b) - calculatePlayerTableValue(a);
    });

    players.forEach(p => {
      const isWinner = p.id === winnerId;
      const bankTotal = (p.bank || []).reduce((sum, c) => sum + (c.value || 0), 0);
      const tableVal = calculatePlayerTableValue(p);
      const card = document.createElement('div');
      card.className = `winner-player-card ${isWinner ? 'is-game-winner' : ''}`;

      const completedSets = [];
      const incompleteSets = [];
      Object.entries(p.property_sets || {}).forEach(([color, cards]) => {
        if (!cards || cards.length === 0) return;
        if (isCompleteSet(cards, color)) {
          completedSets.push({ color, cards });
        } else {
          incompleteSets.push({ color, cards });
        }
      });

      let completeHtml = '';
      if (completedSets.length === 0) {
        completeHtml = '<span style="font-size: 0.72rem; color: #94a3b8;">None</span>';
      } else {
        completeHtml = completedSets.map(s => {
          const colHex = COLOR_HEX[s.color] || '#333';
          const colName = COLOR_NAMES[s.color] || s.color;
          let extra = '';
          if (setHasHouse(s.cards)) extra += ' 🏠';
          if (setHasHotel(s.cards)) extra += ' 🏨';
          return `<span class="winner-set-chip" style="background: ${colHex};">✓ ${colName} (${s.cards.length})${extra}</span>`;
        }).join('');
      }

      let incompleteHtml = '';
      if (incompleteSets.length === 0) {
        incompleteHtml = '<span style="font-size: 0.72rem; color: #94a3b8;">None</span>';
      } else {
        incompleteHtml = incompleteSets.map(s => {
          const colName = COLOR_NAMES[s.color] || s.color;
          const targetSize = SET_RULES[s.color]?.size || 3;
          return `<span class="winner-set-chip incomplete">${colName} (${s.cards.length}/${targetSize})</span>`;
        }).join('');
      }

      let bankBillsHtml = '';
      if (!p.bank || p.bank.length === 0) {
        bankBillsHtml = '<span style="font-size: 0.72rem; color: #94a3b8;">No bank assets</span>';
      } else {
        bankBillsHtml = p.bank.map(b => `<span style="font-size: 0.72rem; background: #e2e8f0; padding: 2px 5px; border-radius: 3px; font-weight: 700;">${escapeHtml(b.name)}</span>`).join(' ');
      }

      card.innerHTML = `
        <div class="winner-card-header">
          <div class="winner-player-name">
            ${isWinner ? '👑 <strong>WINNER:</strong>' : '👤'}
            <span>${escapeHtml(p.name)}</span>
            ${p.is_host ? '<span style="font-size: 0.65rem; background: #3b82f6; color: #fff; padding: 1px 4px; border-radius: 3px;">HOST</span>' : ''}
          </div>
          <div style="font-size: 0.85rem; font-weight: 900; color: #15803d;">
            Total Assets: $${tableVal}M
          </div>
        </div>

        <div class="winner-stat-row">
          <div class="winner-stat-pill">💵 Bank: <strong>$${bankTotal}M</strong></div>
          <div class="winner-stat-pill">🏆 Full Sets: <strong>${completedSets.length}/3</strong></div>
          <div class="winner-stat-pill">📋 Total Props: <strong>${Object.values(p.property_sets || {}).flat().length}</strong></div>
        </div>

        <div style="margin-top: 6px;">
          <div class="winner-sets-title">Bank Notes & Cards:</div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">${bankBillsHtml}</div>
        </div>

        <div style="margin-top: 6px;">
          <div class="winner-sets-title">Completed Sets (${completedSets.length}):</div>
          <div class="winner-sets-list">${completeHtml}</div>
        </div>

        <div style="margin-top: 6px;">
          <div class="winner-sets-title">Incomplete Sets (${incompleteSets.length}):</div>
          <div class="winner-sets-list">${incompleteHtml}</div>
        </div>
      `;

      container.appendChild(card);
    });
  }

  if (leaveBtn) {
    leaveBtn.onclick = async () => {
      modal.classList.add('hidden');
      if (state.currentGameId && state.currentPlayerData) {
        try {
          await apiRequest('leave', 'POST', {
            game_id: state.currentGameId,
            player_id: state.currentPlayerData.id,
          });
        } catch (err) {}
      }
      clearSession();
    };
  }

  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.classList.add('hidden');
    };
  }

  modal.classList.remove('hidden');
  playGameSound('win');
}

/* ========================================================
   PAYMENT MODAL
======================================================== */
export function closePaymentModal() {
  const modal = document.getElementById('payment-modal');
  if (modal) modal.classList.add('hidden');
  state.paymentPromptError = null;
  state.actionPromptError = null;
}

/* ========================================================
   PENDING ACTION MODAL (SLY DEAL, FORCED DEAL, DEAL BREAKER & COUNTERS)
======================================================== */
export function renderPendingActionModal(pendingAction, myPlayer) {
  const modal = document.getElementById('payment-modal');
  const title = document.getElementById('payment-modal-title');
  const body = document.getElementById('payment-modal-body');
  if (!modal || !body) return;

  if (pendingAction.current_respondent_id !== myPlayer.id) {
    closePaymentModal();
    return;
  }

  const stepKey = `${pendingAction.action_card?.id}_${pendingAction.jsn_count}`;
  if (state.currentPendingActionId !== stepKey) {
    state.currentPendingActionId = stepKey;
    state.actionPromptError = null;
  }

  const hasJustSayNo = (myPlayer.hand || []).some(c => c.action === 'just_say_no');
  const isInitiator = (myPlayer.id === pendingAction.initiator_id);
  const isCounter = (pendingAction.jsn_count > 0);

  let modalTitle = '⚡ Action Response Demanded';
  let alertTitle = 'Action Card Used Against You!';
  let alertDesc = '';
  let question = 'How do you want to respond to this action?';
  let hint = 'You can allow this action to proceed, or play "Just Say No" to cancel it.';
  let allowBtnTitle = 'Allow Action';
  let allowBtnSub = 'Surrender or swap property as requested';
  let allowBtnIcon = '✅';
  let allowBtnClass = 'btn-primary';
  let sayNoBtnTitle = 'Use "Just Say No"';
  let sayNoBtnSub = 'Block and cancel this action completely';

  if (!isCounter) {
    // Initial action on defender
    modalTitle = '⚡ Action Response Demanded';
    alertTitle = `${escapeHtml(pendingAction.action_card.name)} Played Against You!`;
    alertDesc = `<strong>${escapeHtml(pendingAction.initiator_name)}</strong> played <strong>${escapeHtml(pendingAction.action_card.name)}</strong>: ${escapeHtml(pendingAction.reason)}.`;
    allowBtnTitle = 'Allow Action';
    allowBtnSub = 'Surrender or swap property as requested';
  } else if (isInitiator) {
    // Defender played JSN, attacker can accept block or counter with JSN
    modalTitle = '🛑 Just Say No Played!';
    alertTitle = 'Action Blocked by Just Say No!';
    alertDesc = `<strong>${escapeHtml(pendingAction.target_name)}</strong> played <strong>Just Say No</strong> to cancel your <strong>${escapeHtml(pendingAction.action_card.name)}</strong>!`;
    question = 'Do you want to accept the block, or counter with your own "Just Say No"?';
    hint = 'Accepting will cancel your action. Countering with Just Say No will force the action back on your opponent.';
    allowBtnTitle = 'Accept "Just Say No"';
    allowBtnSub = 'Accept the block and discard this action';
    allowBtnIcon = '🏳️';
    allowBtnClass = 'btn-secondary';
    sayNoBtnTitle = 'Counter with "Just Say No"';
    sayNoBtnSub = 'Cancel their Just Say No and force action through';
  } else {
    // Attacker countered with JSN, defender can allow action or counter again with JSN
    modalTitle = '⚡ Counter Just Say No!';
    alertTitle = 'Counter Just Say No Played!';
    alertDesc = `<strong>${escapeHtml(pendingAction.initiator_name)}</strong> countered your Just Say No with another <strong>Just Say No</strong>! Your block was cancelled.`;
    question = 'How do you want to respond?';
    hint = 'You can allow the action to proceed, or play another Just Say No to counter again.';
    allowBtnTitle = 'Allow Action';
    allowBtnSub = 'Allow the property action to execute';
    allowBtnIcon = '✅';
    allowBtnClass = 'btn-primary';
    sayNoBtnTitle = 'Counter with "Just Say No"';
    sayNoBtnSub = 'Play another Just Say No to re-block this action';
  }

  if (title) title.textContent = modalTitle;

  body.innerHTML = `
    <div class="payment-alert-box" style="${isInitiator && isCounter ? 'background: #fee2e2; border-color: #dc2626;' : ''}">
      <div class="payment-alert-title" style="${isInitiator && isCounter ? 'color: #991b1b;' : ''}">
        <span>${isInitiator && isCounter ? '🛑' : '🚨'}</span>
        <span>${escapeHtml(alertTitle)}</span>
      </div>
      <div class="payment-alert-desc">
        ${alertDesc}
      </div>
    </div>

    <div class="payment-prompt-card">
      <div class="payment-prompt-question">${escapeHtml(question)}</div>
      <p class="payment-prompt-hint">${escapeHtml(hint)}</p>

      ${state.actionPromptError ? `
        <div class="payment-prompt-error">
          <span>⚠️</span>
          <span>${escapeHtml(state.actionPromptError)}</span>
        </div>
      ` : ''}

      <div class="payment-prompt-actions">
        <button id="btn-action-allow" class="${allowBtnClass} btn-prompt-choice" ${state.isSubmittingPayment ? 'disabled' : ''}>
          <span class="btn-prompt-icon">${allowBtnIcon}</span>
          <div class="btn-prompt-text">
            <span class="btn-prompt-title">${escapeHtml(allowBtnTitle)}</span>
            <span class="btn-prompt-subtitle">${escapeHtml(allowBtnSub)}</span>
          </div>
        </button>

        <button id="btn-action-say-no" class="btn-say-no btn-prompt-choice" ${state.isSubmittingPayment ? 'disabled' : ''}>
          <span class="btn-prompt-icon">🛑</span>
          <div class="btn-prompt-text">
            <span class="btn-prompt-title">${escapeHtml(sayNoBtnTitle)}</span>
            <span class="btn-prompt-subtitle">${escapeHtml(sayNoBtnSub)}</span>
          </div>
        </button>
      </div>
    </div>
  `;

  // Hook up Allow / Accept button
  const allowBtn = document.getElementById('btn-action-allow');
  if (allowBtn) {
    allowBtn.addEventListener('click', async () => {
      if (state.isSubmittingPayment) return;
      state.isSubmittingPayment = true;
      allowBtn.disabled = true;
      allowBtn.textContent = 'Processing...';
      try {
        const res = await apiRequest('accept_action', 'POST', {
          game_id: state.currentGameId,
          player_id: myPlayer.id,
        });
        state.currentGameState = res.state;
        state.actionPromptError = null;
        closePaymentModal();
        render();
      } catch (err) {
        alert(err.message || 'Action failed.');
      } finally {
        state.isSubmittingPayment = false;
      }
    });
  }

  // Hook up Just Say No button
  const sayNoBtn = document.getElementById('btn-action-say-no');
  if (sayNoBtn) {
    sayNoBtn.addEventListener('click', async () => {
      if (state.isSubmittingPayment) return;
      if (!hasJustSayNo) {
        state.actionPromptError = 'You do not have a "Just Say No" card in your hand!';
        renderPendingActionModal(pendingAction, myPlayer);
        return;
      }
      const confirmMsg = isCounter
        ? 'Counter with Just Say No?'
        : `Play Just Say No to cancel ${pendingAction.initiator_name}'s ${pendingAction.action_card.name}?`;
      if (!confirm(confirmMsg)) return;

      state.isSubmittingPayment = true;
      sayNoBtn.disabled = true;
      sayNoBtn.textContent = 'Playing Just Say No...';
      try {
        const res = await apiRequest('say_no', 'POST', {
          game_id: state.currentGameId,
          player_id: myPlayer.id,
        });
        state.currentGameState = res.state;
        state.actionPromptError = null;
        closePaymentModal();
        render();
      } catch (err) {
        alert(err.message || 'Failed to play Just Say No.');
      } finally {
        state.isSubmittingPayment = false;
      }
    });
  }

  modal.classList.remove('hidden');
}

/* ========================================================
   PAYMENT MODAL & PAYMENT COUNTER PROMPT
======================================================== */
export function renderPaymentModal(pending, myPlayer) {
  const modal = document.getElementById('payment-modal');
  const title = document.getElementById('payment-modal-title');
  const body = document.getElementById('payment-modal-body');
  if (!modal || !body) return;

  const myPayerInfo = pending.payers?.[myPlayer.id];
  const isCollector = (pending.collector_id === myPlayer.id);
  const challengedPayer = isCollector
    ? Object.values(pending.payers || {}).find(p => !p.paid && p.current_respondent_id === myPlayer.id)
    : null;

  if (!myPayerInfo && !challengedPayer) {
    closePaymentModal();
    return;
  }
  if (myPayerInfo && myPayerInfo.paid) {
    closePaymentModal();
    return;
  }

  const hasJustSayNo = (myPlayer.hand || []).some(c => c.action === 'just_say_no');

  // SUB-FLOW: Collector challenged by payer's Just Say No
  if (isCollector && challengedPayer) {
    if (title) title.textContent = '🛑 Just Say No Played!';
    body.innerHTML = `
      <div class="payment-alert-box" style="background: #fee2e2; border-color: #dc2626;">
        <div class="payment-alert-title" style="color: #991b1b;">
          <span>🛑</span>
          <span>Payment Cancelled by Just Say No!</span>
        </div>
        <div class="payment-alert-desc">
          <strong>${escapeHtml(challengedPayer.name)}</strong> played <strong>Just Say No</strong> to cancel their payment for <strong>${escapeHtml(pending.reason)}</strong>!
        </div>
      </div>

      <div class="payment-prompt-card">
        <div class="payment-prompt-question">Do you want to accept the block or counter?</div>
        <p class="payment-prompt-hint">Accepting cancels their debt ($0). Countering with Just Say No forces them to pay.</p>

        ${state.paymentPromptError ? `
          <div class="payment-prompt-error">
            <span>⚠️</span>
            <span>${escapeHtml(state.paymentPromptError)}</span>
          </div>
        ` : ''}

        <div class="payment-prompt-actions">
          <button id="btn-collector-accept-say-no" class="btn-secondary btn-prompt-choice" ${state.isSubmittingPayment ? 'disabled' : ''}>
            <span class="btn-prompt-icon">🏳️</span>
            <div class="btn-prompt-text">
              <span class="btn-prompt-title">Accept "Just Say No"</span>
              <span class="btn-prompt-subtitle">Allow ${escapeHtml(challengedPayer.name)} to pay $0 debt</span>
            </div>
          </button>

          <button id="btn-collector-counter-say-no" class="btn-say-no btn-prompt-choice" ${state.isSubmittingPayment ? 'disabled' : ''}>
            <span class="btn-prompt-icon">🛑</span>
            <div class="btn-prompt-text">
              <span class="btn-prompt-title">Counter with "Just Say No"</span>
              <span class="btn-prompt-subtitle">Cancel their block and force payment</span>
            </div>
          </button>
        </div>
      </div>
    `;

    const acceptBtn = document.getElementById('btn-collector-accept-say-no');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', async () => {
        if (state.isSubmittingPayment) return;
        state.isSubmittingPayment = true;
        acceptBtn.disabled = true;
        try {
          const res = await apiRequest('accept_action', 'POST', {
            game_id: state.currentGameId,
            player_id: myPlayer.id,
          });
          state.currentGameState = res.state;
          state.paymentPromptError = null;
          closePaymentModal();
          render();
        } catch (err) {
          alert(err.message || 'Failed to accept Just Say No.');
        } finally {
          state.isSubmittingPayment = false;
        }
      });
    }

    const counterBtn = document.getElementById('btn-collector-counter-say-no');
    if (counterBtn) {
      counterBtn.addEventListener('click', async () => {
        if (state.isSubmittingPayment) return;
        if (!hasJustSayNo) {
          state.paymentPromptError = 'You do not have a "Just Say No" card in your hand!';
          renderPaymentModal(pending, myPlayer);
          return;
        }
        if (!confirm(`Counter ${challengedPayer.name}'s Just Say No with your own Just Say No?`)) return;
        state.isSubmittingPayment = true;
        counterBtn.disabled = true;
        counterBtn.textContent = 'Playing Just Say No...';
        try {
          const res = await apiRequest('say_no', 'POST', {
            game_id: state.currentGameId,
            player_id: myPlayer.id,
          });
          state.currentGameState = res.state;
          state.paymentPromptError = null;
          closePaymentModal();
          render();
        } catch (err) {
          alert(err.message || 'Failed to play Just Say No.');
        } finally {
          state.isSubmittingPayment = false;
        }
      });
    }

    modal.classList.remove('hidden');
    return;
  }

  // Detect new pending payment and reset step to prompt
  const paymentKey = `${pending.action_card?.id}_${myPayerInfo.jsn_count ?? 0}`;
  if (state.currentPendingActionCardId !== paymentKey) {
    state.currentPendingActionCardId = paymentKey;
    state.paymentStep = 'prompt';
    state.paymentPromptError = null;
    state.selectedPaymentCardIds.clear();
  }

  const amountDue = myPayerInfo.amount_due;
  const isPayerCountered = (myPayerInfo.jsn_count > 0);

  // STEP 1: Prompt player first (Proceed with Payment or Use "Just Say No")
  if (state.paymentStep === 'prompt') {
    if (title) title.textContent = isPayerCountered ? '⚡ Counter Just Say No!' : '⚡ Action Response Demanded';

    const promptAlertTitle = isPayerCountered ? 'Counter Just Say No Played!' : 'Action Card Used Against You!';
    const promptAlertDesc = isPayerCountered
      ? `<strong>${escapeHtml(pending.collector_name)}</strong> countered your Just Say No with another <strong>Just Say No</strong>! Your block was cancelled.`
      : `<strong>${escapeHtml(pending.collector_name)}</strong> played <strong>${escapeHtml(pending.reason)}</strong> demanding <strong>$${amountDue}M</strong>!`;
    const sayNoBtnTitle = isPayerCountered ? 'Counter with "Just Say No"' : 'Use "Just Say No"';
    const sayNoBtnSub = isPayerCountered ? 'Play another Just Say No to re-block' : 'Block and cancel this action completely';

    body.innerHTML = `
      <div class="payment-alert-box">
        <div class="payment-alert-title">
          <span>${isPayerCountered ? '⚡' : '🚨'}</span>
          <span>${escapeHtml(promptAlertTitle)}</span>
        </div>
        <div class="payment-alert-desc">
          ${promptAlertDesc}
        </div>
      </div>

      <div class="payment-prompt-card">
        <div class="payment-prompt-question">How do you want to respond to this action?</div>
        <p class="payment-prompt-hint">Choose whether to proceed with payment from your table or play "Just Say No" to cancel this action.</p>

        ${state.paymentPromptError ? `
          <div class="payment-prompt-error">
            <span>⚠️</span>
            <span>${escapeHtml(state.paymentPromptError)}</span>
          </div>
        ` : ''}

        <div class="payment-prompt-actions">
          <button id="btn-prompt-proceed-pay" class="btn-primary btn-prompt-choice" ${state.isSubmittingPayment ? 'disabled' : ''}>
            <span class="btn-prompt-icon">💳</span>
            <div class="btn-prompt-text">
              <span class="btn-prompt-title">Proceed with Payment</span>
              <span class="btn-prompt-subtitle">Settle the $${amountDue}M demand using cards from your table</span>
            </div>
          </button>

          <button id="btn-prompt-say-no" class="btn-say-no btn-prompt-choice" ${state.isSubmittingPayment ? 'disabled' : ''}>
            <span class="btn-prompt-icon">🛑</span>
            <div class="btn-prompt-text">
              <span class="btn-prompt-title">${escapeHtml(sayNoBtnTitle)}</span>
              <span class="btn-prompt-subtitle">${escapeHtml(sayNoBtnSub)}</span>
            </div>
          </button>
        </div>
      </div>
    `;

    const proceedBtn = document.getElementById('btn-prompt-proceed-pay');
    if (proceedBtn) {
      proceedBtn.addEventListener('click', () => {
        state.paymentStep = 'pay';
        state.paymentPromptError = null;
        renderPaymentModal(pending, myPlayer);
      });
    }

    const promptSayNoBtn = document.getElementById('btn-prompt-say-no');
    if (promptSayNoBtn) {
      promptSayNoBtn.addEventListener('click', async () => {
        if (state.isSubmittingPayment) return;
        if (!hasJustSayNo) {
          state.paymentPromptError = 'You do not have a "Just Say No" card in your hand! Please proceed with payment.';
          renderPaymentModal(pending, myPlayer);
          return;
        }
        const confirmMsg = isPayerCountered ? 'Counter with Just Say No?' : `Play Just Say No to cancel the payment demanded by ${pending.collector_name}?`;
        if (!confirm(confirmMsg)) return;
        state.isSubmittingPayment = true;
        promptSayNoBtn.disabled = true;
        promptSayNoBtn.textContent = 'Playing Just Say No...';
        try {
          const res = await apiRequest('say_no', 'POST', {
            game_id: state.currentGameId,
            player_id: myPlayer.id,
          });
          state.currentGameState = res.state;
          state.selectedPaymentCardIds.clear();
          state.paymentStep = 'prompt';
          state.paymentPromptError = null;
          closePaymentModal();
          render();
        } catch (err) {
          alert(err.message || 'Failed to play Just Say No.');
        } finally {
          state.isSubmittingPayment = false;
        }
      });
    }

    modal.classList.remove('hidden');
    return;
  }

  // STEP 2: Payment Card Selection View
  if (title) title.textContent = '💰 Payment Demanded';

  // Gather all table cards for local player
  const bankCards = myPlayer.bank || [];
  const propertyCards = [];
  Object.entries(myPlayer.property_sets || {}).forEach(([color, cards]) => {
    (cards || []).forEach(c => {
      propertyCards.push({ color, card: c });
    });
  });

  const totalTableCards = bankCards.length + propertyCards.length;
  const bankTotal = bankCards.reduce((acc, c) => acc + (c.value || 0), 0);
  const totalTableValue = calculatePlayerTableValue(myPlayer);
  const propTotal = totalTableValue - bankTotal;

  // Prune any selected IDs that no longer exist on table
  const existingIds = new Set([
    ...bankCards.map(c => c.id),
    ...propertyCards.map(item => item.card.id)
  ]);
  for (const id of state.selectedPaymentCardIds) {
    if (!existingIds.has(id)) {
      state.selectedPaymentCardIds.delete(id);
    }
  }

  // If player cannot cover full amount and has cards, auto-select all if none selected yet
  if (totalTableValue <= amountDue && totalTableValue > 0 && state.selectedPaymentCardIds.size === 0) {
    existingIds.forEach(id => state.selectedPaymentCardIds.add(id));
  }

  // Calculate selected total with set-level property valuation
  let selectedBankTotal = 0;
  const selectedPropsByColor = {};

  bankCards.forEach(c => {
    if (state.selectedPaymentCardIds.has(c.id)) {
      selectedBankTotal += (c.value || 0);
    }
  });

  propertyCards.forEach(item => {
    if (state.selectedPaymentCardIds.has(item.card.id)) {
      const col = item.color;
      if (!selectedPropsByColor[col]) {
        selectedPropsByColor[col] = { count: 0, hasHouse: false, hasHotel: false };
      }
      if (item.card.type === 'property' || item.card.type === 'wild_property') {
        selectedPropsByColor[col].count++;
      } else if (item.card.action === 'house') {
        selectedPropsByColor[col].hasHouse = true;
      } else if (item.card.action === 'hotel') {
        selectedPropsByColor[col].hasHotel = true;
      }
    }
  });

  let selectedPropTotal = 0;
  Object.entries(selectedPropsByColor).forEach(([col, data]) => {
    selectedPropTotal += getPropertySetValue(col, data.count, data.hasHouse, data.hasHotel);
  });

  const selectedTotal = selectedBankTotal + selectedPropTotal;

  // Check validity
  let isValid = false;
  let guideText = '';
  let payBtnText = '';

  if (totalTableValue === 0) {
    isValid = (state.selectedPaymentCardIds.size === 0);
    guideText = 'You have no cards in play on your table. In Monopoly Deal rules, you do not pay from your hand, so you pay $0.';
    payBtnText = 'Clear Debt ($0 - No Assets)';
  } else if (totalTableValue <= amountDue) {
    isValid = (state.selectedPaymentCardIds.size === totalTableCards);
    guideText = `You cannot cover the full $${amountDue}M debt. You must surrender all cards on your table ($${totalTableValue}M).`;
    payBtnText = `Surrender All Cards ($${totalTableValue}M)`;
  } else {
    isValid = (selectedTotal >= amountDue);
    guideText = `Select cards from your Bank or Properties totaling at least $${amountDue}M. (No change is given for overpayment).`;
    payBtnText = `Pay Selected Cards ($${selectedTotal}M / $${amountDue}M)`;
  }

  // Render HTML
  body.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: -4px;">
      <button id="btn-payment-back" class="btn-payment-back">← Back to Options</button>
      <span style="font-size: 0.78rem; font-weight: 800; color: var(--text-muted);">Step 2: Card Selection</span>
    </div>

    <div class="payment-alert-box">
      <div class="payment-alert-title">
        <span>🚨</span>
        <span>Payment Demanded!</span>
      </div>
      <div class="payment-alert-desc">
        <strong>${escapeHtml(pending.collector_name)}</strong> demands <strong>$${amountDue}M</strong> via <strong>${escapeHtml(pending.reason)}</strong>.
      </div>
    </div>

    <div class="payment-stats-grid">
      <div class="payment-stat-card">
        <div class="payment-stat-label">Amount Due</div>
        <div class="payment-stat-value">$${amountDue}M</div>
      </div>
      <div class="payment-stat-card">
        <div class="payment-stat-label">Selected</div>
        <div class="payment-stat-value ${isValid ? 'is-valid' : 'is-invalid'}">$${selectedTotal}M</div>
      </div>
      <div class="payment-stat-card">
        <div class="payment-stat-label">On Table</div>
        <div class="payment-stat-value">$${totalTableValue}M</div>
      </div>
    </div>

    <div class="payment-guide-text">${guideText}</div>

    ${bankCards.length > 0 ? `
      <div class="payment-section">
        <div class="payment-section-heading">
          <span>Bank Cards</span>
          <span>$${bankTotal}M Available</span>
        </div>
        <div class="payment-cards-grid" id="payment-bank-grid"></div>
      </div>
    ` : ''}

    ${propertyCards.length > 0 ? `
      <div class="payment-section">
        <div class="payment-section-heading">
          <span>Properties on Table (Valued by Set Rent Scale)</span>
          <span>$${propTotal}M Available</span>
        </div>
        <div class="payment-cards-grid" id="payment-prop-grid"></div>
      </div>
    ` : ''}

    <div class="payment-btn-group">
      <button id="btn-payment-say-no" class="btn-say-no" ${state.isSubmittingPayment ? 'disabled' : ''}>
        🛑 Just Say No! (Cancel Debt)
      </button>
      <button id="btn-payment-submit" class="btn-primary" ${(!isValid || state.isSubmittingPayment) ? 'disabled' : ''}>
        ${state.isSubmittingPayment ? 'Processing...' : payBtnText}
      </button>
    </div>
  `;

  // Hook up Back button
  const backBtn = document.getElementById('btn-payment-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      state.paymentStep = 'prompt';
      state.paymentPromptError = null;
      renderPaymentModal(pending, myPlayer);
    });
  }

  // Populate bank cards
  const bankGrid = document.getElementById('payment-bank-grid');
  if (bankGrid) {
    bankCards.forEach(c => {
      const isSelected = state.selectedPaymentCardIds.has(c.id);
      const cardEl = document.createElement('div');
      cardEl.className = `payment-selectable-card ${isSelected ? 'is-selected' : ''}`;
      cardEl.innerHTML = `
        <div class="payment-card-badge">
          <span class="payment-card-val">$${c.value || 0}M</span>
          <div class="payment-checkbox">${isSelected ? '✓' : ''}</div>
        </div>
        <div class="payment-card-name">${escapeHtml(c.name)}</div>
      `;
      cardEl.addEventListener('click', () => {
        if (state.selectedPaymentCardIds.has(c.id)) {
          state.selectedPaymentCardIds.delete(c.id);
        } else {
          state.selectedPaymentCardIds.add(c.id);
        }
        renderPaymentModal(pending, myPlayer);
      });
      bankGrid.appendChild(cardEl);
    });
  }

  // Populate property cards
  const propGrid = document.getElementById('payment-prop-grid');
  if (propGrid) {
    propertyCards.forEach(item => {
      const c = item.card;
      const color = item.color;
      const isSelected = state.selectedPaymentCardIds.has(c.id);
      const colorHex = COLOR_HEX[color] || '#333';
      const cardEl = document.createElement('div');
      cardEl.className = `payment-selectable-card ${isSelected ? 'is-selected' : ''}`;
      cardEl.innerHTML = `
        <div class="payment-card-badge">
          <span class="payment-card-val">${COLOR_NAMES[color] || color}</span>
          <div class="payment-checkbox">${isSelected ? '✓' : ''}</div>
        </div>
        <div class="payment-card-name">${escapeHtml(c.name)}</div>
        <div class="payment-card-color-stripe" style="background: ${colorHex};"></div>
      `;
      cardEl.addEventListener('click', () => {
        if (state.selectedPaymentCardIds.has(c.id)) {
          state.selectedPaymentCardIds.delete(c.id);
        } else {
          state.selectedPaymentCardIds.add(c.id);
        }
        renderPaymentModal(pending, myPlayer);
      });
      propGrid.appendChild(cardEl);
    });
  }

  // Hook up Submit Payment button
  const submitBtn = document.getElementById('btn-payment-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      if (!isValid || state.isSubmittingPayment) return;
      state.isSubmittingPayment = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting Payment...';
      try {
        const res = await apiRequest('pay', 'POST', {
          game_id: state.currentGameId,
          player_id: myPlayer.id,
          card_ids: Array.from(state.selectedPaymentCardIds),
        });
        state.currentGameState = res.state;
        state.selectedPaymentCardIds.clear();
        state.paymentStep = 'prompt';
        state.paymentPromptError = null;
        closePaymentModal();
        render();
      } catch (err) {
        alert(err.message || 'Payment failed.');
      } finally {
        state.isSubmittingPayment = false;
      }
    });
  }

  // Hook up Just Say No button
  const sayNoBtn = document.getElementById('btn-payment-say-no');
  if (sayNoBtn) {
    sayNoBtn.addEventListener('click', async () => {
      if (state.isSubmittingPayment) return;
      if (!hasJustSayNo) {
        alert('You do not have a "Just Say No" card in your hand!');
        return;
      }
      if (!confirm(`Play Just Say No to cancel the payment to ${pending.collector_name}?`)) return;
      state.isSubmittingPayment = true;
      sayNoBtn.disabled = true;
      sayNoBtn.textContent = 'Playing Just Say No...';
      try {
        const res = await apiRequest('say_no', 'POST', {
          game_id: state.currentGameId,
          player_id: myPlayer.id,
        });
        state.currentGameState = res.state;
        state.selectedPaymentCardIds.clear();
        state.paymentStep = 'prompt';
        state.paymentPromptError = null;
        closePaymentModal();
        render();
      } catch (err) {
        alert(err.message || 'Failed to play Just Say No.');
      } finally {
        state.isSubmittingPayment = false;
      }
    });
  }

  modal.classList.remove('hidden');
}

/* ========================================================
   EXCESS CARDS NOTIFICATION MODAL
======================================================== */
export function closeExcessCardsModal() {
  const modal = document.getElementById('excess-cards-modal');
  if (modal) modal.classList.add('hidden');
}

export function showExcessCardsModal(notif) {
  const modal = document.getElementById('excess-cards-modal');
  const desc = document.getElementById('excess-cards-desc');
  const list = document.getElementById('excess-cards-list');
  if (!modal || !desc || !list) return;

  desc.innerHTML = `You had <strong>${notif.initial_count} cards</strong> in hand when your turn ended (limit is 7). <strong>${notif.count} card(s)</strong> were randomly selected and returned to the draw deck:`;
  list.innerHTML = '';

  (notif.cards || []).forEach(card => {
    const item = document.createElement('div');
    item.className = 'excess-card-item';

    const header = document.createElement('div');
    header.className = 'excess-card-header';

    const valBadge = document.createElement('span');
    valBadge.className = 'excess-card-val';
    valBadge.textContent = `$${card.value || 0}M`;

    const typeTag = document.createElement('span');
    typeTag.className = 'excess-card-type-tag';
    typeTag.textContent = (card.type || '').replace('_', ' ');

    header.appendChild(valBadge);
    header.appendChild(typeTag);
    item.appendChild(header);

    const name = document.createElement('div');
    name.className = 'excess-card-name';
    name.textContent = card.name || 'Unknown Card';
    item.appendChild(name);

    if (card.color || (card.colors && card.colors.length > 0)) {
      const color = card.color || card.colors[0];
      const stripe = document.createElement('div');
      stripe.className = 'excess-card-color-stripe';
      stripe.style.background = `var(--color-${color}, #cbd5e1)`;
      item.appendChild(stripe);
    }

    list.appendChild(item);
  });

  modal.classList.remove('hidden');
}

export function checkExcessCardsNotification(myPlayer) {
  if (!myPlayer || !myPlayer.excess_cards_returned) return;
  const notif = myPlayer.excess_cards_returned;
  if (notif.timestamp && notif.timestamp !== state.lastSeenExcessNotifTimestamp) {
    state.lastSeenExcessNotifTimestamp = notif.timestamp;
    showExcessCardsModal(notif);
  }
}
