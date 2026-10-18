// Card Component Builders, SVG Artwork, and Rules / Set Valuation

import { COLOR_NAMES, COLOR_HEX, SET_RULES } from './constants.js';
import { escapeHtml } from './utils.js';
import { openMoveWildcardModal, openInspectModal } from './modals.js';

// --- Set Calculation & Valuation ---
export function getSetPropertiesCount(cards) {
  return (cards || []).filter(c => c.type === 'property' || c.type === 'wild_property').length;
}

export function isCompleteSet(cards, color) {
  if (!SET_RULES[color]) return false;
  return getSetPropertiesCount(cards) >= SET_RULES[color].size;
}

export function setHasHouse(cards) {
  return (cards || []).some(c => c.action === 'house');
}

export function setHasHotel(cards) {
  return (cards || []).some(c => c.action === 'hotel');
}

export function getPropertySetValue(color, propCount, hasHouse = false, hasHotel = false) {
  if (propCount <= 0) return 0;
  const rule = SET_RULES[color];
  if (!rule || !rule.rent || rule.rent.length === 0) return 0;
  const rentIndex = Math.min(propCount - 1, rule.rent.length - 1);
  let val = rule.rent[rentIndex];
  if (propCount >= rule.size) {
    if (hasHouse) val += 3;
    if (hasHotel) val += 4;
  }
  return val;
}

export function calculatePlayerTableValue(player) {
  if (!player) return 0;
  let total = (player.bank || []).reduce((acc, c) => acc + (c.value || 0), 0);
  Object.entries(player.property_sets || {}).forEach(([color, cards]) => {
    const pCount = getSetPropertiesCount(cards);
    const hasHouse = setHasHouse(cards);
    const hasHotel = setHasHotel(cards);
    total += getPropertySetValue(color, pCount, hasHouse, hasHotel);
  });
  return total;
}

// --- Visual Artwork Helpers ---
export function getCardArtHtml(card) {
  if (card.type === 'action' && card.action) {
    return `<img src="assets/cards/${card.action}.webp" alt="${escapeHtml(card.name)}" class="action-art-img">`;
  }
  if (card.type === 'rent' || card.type === 'rent_wild') {
    return `<img src="assets/cards/rent.webp" alt="Rent" class="action-art-img">`;
  }
  return getCardSvgArt(card);
}

export function getCardSvgArt(card) {
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

export function getPropertyHeaderIcon(group) {
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

export function renderValueBadge(value, cornerClass) {
  const val = (value !== undefined && value !== null) ? value : 0;
  const is10 = val === 10;
  const zeroStyle = val === 0 ? ' style="background:#e2e8f0; color:#0f172a;"' : '';
  return `
    <div class="card-val-badge ${cornerClass} ${is10 ? 'val-10' : ''}"${zeroStyle}>
      <span class="val-curr">$</span><span class="val-num">${val}</span><span class="val-unit">M</span>
    </div>
  `;
}

export function createCardElement(card, interactive = false, isPreview = false) {
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
          <div class="wild-swap-icon interactive" title="Click to swap color">⇄</div>
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

    const swapIcon = el.querySelector('.wild-swap-icon');
    if (swapIcon) {
      swapIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        openMoveWildcardModal(card, curCol);
      });
    }

    return el;
  }

  // Handle 10-Color Wild Property
  if (card.type === 'wild_property') {
    const curCol = card.current_color || 'brown';
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
          <div class="wild-swap-icon interactive" title="Click to move to another color set">⇄</div>
          <div class="wild-card-subtitle">Move to any set on your turn</div>
          <div class="wild-active-badge">
            Active: <span style="color: ${SET_RULES[curCol]?.color || '#000'}">${COLOR_NAMES[curCol] || curCol}</span>
          </div>
        </div>
        <div class="action-rule-box">
          No monetary value • Cannot be banked • May move on turn.
        </div>
      </div>
    `;

    const swapIcon = el.querySelector('.wild-swap-icon');
    if (swapIcon) {
      swapIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        openMoveWildcardModal(card, curCol);
      });
    }

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

export function createMiniPropertyCard(card, groupColor, isOwner = false, isMyTurn = false) {
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
      moveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMoveWildcardModal(card, color);
      });
    }
  }

  el.title = `Click to inspect: ${card.name}`;
  el.addEventListener('click', () => openInspectModal(card));
  return el;
}

export function createMiniBankBill(card) {
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
