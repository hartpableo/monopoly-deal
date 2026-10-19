<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Monopoly Deal Online</title>
  <link rel="icon" type="image/svg+xml" href="favicon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="favicon-16x16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">
  <link rel="shortcut icon" href="favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700;800;900&display=swap">
  <link rel="stylesheet" href="/style.css">
</head>
<body>

<header>
  <div class="header-left">
    <div class="logo">🎩 Monopoly Deal</div>
    <div id="room-badge" class="badge badge-room hidden" title="Click to copy Game ID" role="button" tabindex="0">Room: <span id="room-code-display">------</span> <button id="btn-copy-room-badge" class="badge-copy-btn" type="button" title="Copy Game ID" aria-label="Copy Game ID">📋</button></div>
  </div>

  <div class="header-status">
    <span id="turn-badge" class="badge badge-turn hidden">Waiting...</span>
    <span id="actions-badge" class="badge badge-actions hidden">3 Actions Left</span>
    <button id="btn-toggle-mic" class="btn-mic btn-secondary hidden">🎤 Enable Voice</button>
    <button id="btn-leave-game" class="btn-secondary btn-leave hidden">Leave</button>
  </div>
</header>

<main>
  <!-- LOBBY SCREEN -->
  <div id="lobby-view" class="lobby-card">
    <h2>Game Lobby</h2>

    <div id="lobby-room-info" class="lobby-room-info hidden">
      <div class="lobby-room-label">Current Game ID</div>
      <div class="lobby-room-code-box">
        <div id="lobby-room-code" class="room-code-display" title="Click to copy Game ID">------</div>
        <button id="btn-copy-game-id" class="btn-primary btn-copy-game-id" type="button" title="Copy Game ID">
          <span class="copy-icon">📋</span>
          <span class="copy-text">Copy ID</span>
        </button>
      </div>
      <div class="lobby-share-hint">Share this Game ID with friends so they can join!</div>
    </div>

    <div class="form-group">
      <label for="input-player-name">Your Name</label>
      <input type="text" id="input-player-name" placeholder="Enter your name" maxlength="16" autocomplete="off" required>
    </div>

    <div style="display: flex; gap: 8px; margin-top: 4px;">
      <button id="btn-create-game" class="btn-primary" style="width: 100%;">Create New Game</button>
    </div>

    <div class="lobby-divider">
      <span>OR</span>
    </div>

    <div class="form-group">
      <label for="input-room-code">Room Code</label>
      <input type="text" id="input-room-code" placeholder="e.g. 6-letter code" maxlength="6"
             style="text-transform: uppercase;">
    </div>

    <button id="btn-join-game" class="btn-secondary" style="width: 100%;">Join Existing Game</button>

    <div style="margin-top: 12px;">
      <div class="section-title">Connected Players:</div>
      <ul id="lobby-players" class="lobby-players-list">
        <li class="lobby-empty-hint">Create or join a room to see players.</li>
      </ul>
      <button id="btn-start-game" class="hidden btn-start" style="width: 100%; margin-top: 12px;">Start Game (Need 2+
        Players)
      </button>
    </div>
  </div>

  <!-- GAME BOARD SCREEN -->
  <div id="game-view" class="game-grid hidden">
    <div class="table-area">

      <!-- Opponents -->
      <div>
        <div class="section-title">Opponents</div>
        <div id="opponents-container" class="opponents-row"></div>
      </div>

      <!-- Center Deck & Discard Table Area -->
      <div class="center-table-row">
        <div class="table-slot-container">
          <div class="slot-label">DRAW (<span id="deck-count">0</span>)</div>
          <div id="deck-pile-slot" class="deck-pile-visual" title="Draw Deck">
            <div class="deal-card-back">
              <div class="card-back-pattern"></div>
              <div class="card-back-banner">
                <div class="card-back-monopoly">MONOPOLY</div>
                <div class="card-back-deal">DEAL</div>
              </div>
            </div>
          </div>
        </div>

        <div class="table-center-divider"></div>

        <div class="table-slot-container">
          <div class="slot-label">DISCARD (<span id="discard-top-label">Empty</span>)</div>
          <div id="discard-pile-slot" class="discard-pile-visual" title="Top Discarded Card">
            <div class="empty-slot-card">No Discards</div>
          </div>
          <!-- Hidden sync element for backwards compatibility -->
          <span id="discard-top" class="hidden">None</span>
        </div>
      </div>

      <!-- My Table (Bank & Properties) -->
      <div class="my-board" id="my-board">
        <div class="my-table-header">
          <div class="player-identity">
            <span class="my-table-title" id="my-player-name-display">My Table</span>
            <span class="speaking-indicator hidden" id="my-speaking-indicator" title="Speaking">
                <span class="mic-icon">🎙️</span>
                <span class="speaking-wave">
                  <span class="wave-bar"></span>
                  <span class="wave-bar"></span>
                  <span class="wave-bar"></span>
                </span>
              </span>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: baseline;">
          <div class="section-title">My Bank (<span id="my-bank-total">$0M</span>)</div>
        </div>
        <div id="my-bank-container" class="bank-container"></div>

        <div class="section-title" style="margin-top: 12px;">My Property Sets</div>
        <div id="my-properties-container" class="sets-container"></div>
      </div>

      <!-- My Hand -->
      <div class="hand-section">
        <div class="section-title hand-title-row">
          <span>My Hand</span>
          <span class="hand-subtitle-desktop">(Click a card to play on your turn)</span>
          <span class="hand-subtitle-mobile">(Swipe • Tap to play)</span>
        </div>
        <div id="my-hand-container" class="hand-cards"></div>
      </div>

    </div>

    <!-- Live Event Logs Sidebar -->
    <aside class="sidebar" id="sidebar-logs">
      <div class="sidebar-actions-section" id="sidebar-actions-section">
        <div class="sidebar-actions-header">⚡ Game Actions</div>
        <button id="btn-end-turn" class="btn-danger btn-end-turn-sidebar hidden">End Turn</button>
      </div>
      <div class="sidebar-header" id="sidebar-logs-header">
        <span>Game Activity Log</span>
        <span class="sidebar-chevron">▼</span>
      </div>
      <div id="logs-container" class="logs-list"></div>
    </aside>
  </div>
</main>

<!-- ACTION MODAL -->
<div id="action-modal" class="modal-overlay hidden">
  <div class="modal-content modal-card-dialog">
    <div class="modal-header-row">
      <h3 id="modal-card-title">Play Card</h3>
      <button id="modal-close-x" class="modal-close-x" aria-label="Close">✕</button>
    </div>
    <div id="modal-card-preview" class="modal-card-preview"></div>
    <p style="font-size: 0.85rem; color: var(--text-muted); text-align: center;">Select how you want to play this
      card:</p>
    <div id="modal-actions-container" class="modal-actions"></div>
    <button id="modal-close-btn" class="btn-secondary" style="margin-top: 8px;">Cancel</button>
  </div>
</div>

<!-- PAYMENT MODAL -->
<div id="payment-modal" class="modal-overlay hidden">
  <div class="modal-content modal-payment-dialog">
    <div class="modal-header-row">
      <h3 id="payment-modal-title">💰 Payment Demanded</h3>
    </div>
    <div id="payment-modal-body" class="payment-modal-body"></div>
  </div>
</div>

<!-- INSPECT MODAL -->
<div id="inspect-modal" class="modal-overlay hidden">
  <div class="modal-content modal-card-dialog">
    <div class="modal-header-row">
      <h3 id="inspect-card-title">Card Details</h3>
      <button id="inspect-close-x" class="modal-close-x" aria-label="Close">✕</button>
    </div>
    <div id="inspect-card-preview" class="modal-card-preview"></div>
    <button id="inspect-close-btn" class="btn-secondary" style="margin-top: 8px;">Close</button>
  </div>
</div>

<!-- EXCESS CARDS NOTIFICATION MODAL -->
<div id="excess-cards-modal" class="modal-overlay hidden">
  <div class="modal-content modal-excess-dialog">
    <div class="modal-header-row">
      <h3 id="excess-cards-title">⚠️ Hand Limit Exceeded</h3>
      <button id="excess-close-x" class="modal-close-x" aria-label="Close">✕</button>
    </div>
    <div class="excess-modal-body">
      <div class="excess-alert-box">
        <div class="excess-alert-badge">7-Card Limit Enforced</div>
        <p id="excess-cards-desc" class="excess-desc-text"></p>
      </div>
      <div class="excess-cards-section-title">Cards Returned to Draw Deck:</div>
      <div id="excess-cards-list" class="excess-cards-grid"></div>
      <button id="excess-cards-confirm-btn" class="btn-primary" style="width: 100%; margin-top: 8px;">Got It</button>
    </div>
  </div>
</div>

<!-- MOVE WILDCARD MODAL -->
<div id="move-wild-modal" class="modal-overlay hidden">
  <div class="modal-content modal-card-dialog">
    <div class="modal-header-row">
      <h3 id="move-wild-title">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display: inline-block; vertical-align: -2px; margin-right: 6px;" aria-hidden="true">
          <path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"/>
        </svg>Move Wildcard
      </h3>
      <button id="move-wild-close-x" class="modal-close-x" aria-label="Close">✕</button>
    </div>
    <div id="move-wild-preview" class="modal-card-preview"></div>
    <p style="font-size: 0.85rem; color: var(--text-muted); text-align: center;" id="move-wild-desc">Select target
      color set for this wildcard (Free action):</p>
    <div id="move-wild-options" class="modal-actions"></div>
    <button id="move-wild-cancel-btn" class="btn-secondary" style="margin-top: 8px;">Cancel</button>
  </div>
</div>

<!-- WINNER ANNOUNCEMENT MODAL -->
<div id="winner-modal" class="modal-overlay hidden">
  <div class="modal-content modal-winner-dialog">
    <div class="winner-celebration-header">
      <div class="winner-trophy-badge">🏆</div>
      <h2 id="winner-announcement-title">Game Over!</h2>
      <div id="winner-announcement-subtitle" class="winner-announcement-subtitle"></div>
    </div>
    <div class="winner-modal-body">
      <div class="section-title" style="margin-top: 4px; margin-bottom: 8px;">Final Player Standings & Assets</div>
      <div id="winner-standings-container" class="winner-standings-grid"></div>
      <div class="winner-modal-actions" style="display: flex; gap: 8px; margin-top: 16px;">
        <button id="winner-leave-btn" class="btn-primary" style="flex: 1;">Return to Lobby</button>
        <button id="winner-close-btn" class="btn-secondary" style="flex: 1;">View Final Board</button>
      </div>
    </div>
  </div>
</div>

<!-- TOAST CONTAINER -->
<div id="toast-container" class="toast-container" aria-live="polite"></div>

<script type="module" src="/app.js"></script>
</body>
</html>
