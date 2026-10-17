<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Monopoly Deal + Voice</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>

  <header>
    <div style="display: flex; align-items: center; gap: 12px;">
      <div class="logo">🎩 Monopoly Deal</div>
      <div id="room-badge" class="badge badge-room hidden">Room: <span id="room-code-display">------</span></div>
    </div>

    <div class="header-status">
      <span id="turn-badge" class="badge badge-turn">Waiting...</span>
      <span id="actions-badge" class="badge badge-actions">3 Actions Left</span>
      <button id="btn-toggle-mic" class="btn-mic btn-secondary">🎤 Enable Voice</button>
      <button id="btn-end-turn" class="btn-danger">End Turn</button>
      <button id="btn-leave-game" class="btn-secondary" style="font-size: 0.75rem; padding: 6px 10px;">Leave</button>
    </div>
  </header>

  <main>
    <!-- LOBBY SCREEN -->
    <div id="lobby-view" class="lobby-card">
      <h2>Game Lobby</h2>
      <div class="form-group">
        <label for="input-player-name">Your Name</label>
        <input type="text" id="input-player-name" placeholder="Enter your name" maxlength="16" value="Player">
      </div>

      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <button id="btn-create-game" style="flex: 1;">Create New Game</button>
      </div>

      <div style="margin-top: 4px;">
        <button id="btn-demo-game" style="width: 100%; background: #059669;">🎮 Launch Dummy Game (Instant UI/UX Review)</button>
      </div>

      <div style="display: flex; align-items: center; gap: 8px; margin: 8px 0;">
        <div style="flex: 1; height: 1px; background: var(--panel-border);"></div>
        <span style="font-size: 0.8rem; color: var(--text-muted);">OR</span>
        <div style="flex: 1; height: 1px; background: var(--panel-border);"></div>
      </div>

      <div class="form-group">
        <label for="input-room-code">Room Code</label>
        <input type="text" id="input-room-code" placeholder="e.g. 6-letter code" maxlength="6" style="text-transform: uppercase;">
      </div>

      <button id="btn-join-game" class="btn-secondary">Join Existing Game</button>

      <div style="margin-top: 16px;">
        <div class="section-title">Connected Players:</div>
        <ul id="lobby-players" class="lobby-players-list">
          <li style="color: var(--text-muted); font-size: 0.85rem;">Create or join a room to see players.</li>
        </ul>
        <button id="btn-start-game" class="hidden" style="width: 100%; margin-top: 12px; background: var(--success);">Start Game (Need 2+ Players)</button>
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

        <!-- Center Deck & Discard -->
        <div class="center-deck-row">
          <div>🎴 Deck Remaining: <strong id="deck-count">0</strong></div>
          <div style="margin-left: auto;">Last Discarded: <strong id="discard-top">None</strong></div>
        </div>

        <!-- My Table (Bank & Properties) -->
        <div class="my-board">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <div class="section-title">My Bank (<span id="my-bank-total">$0M</span>)</div>
          </div>
          <div id="my-bank-container" class="bank-container"></div>

          <div class="section-title" style="margin-top: 12px;">My Property Sets</div>
          <div id="my-properties-container" class="sets-container"></div>
        </div>

        <!-- My Hand -->
        <div class="hand-section">
          <div class="section-title">My Hand (Click a card to play on your turn)</div>
          <div id="my-hand-container" class="hand-cards"></div>
        </div>

      </div>

      <!-- Live Event Logs Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-header">Game Activity Log</div>
        <div id="logs-container" class="logs-list"></div>
      </aside>
    </div>
  </main>

  <!-- ACTION MODAL -->
  <div id="action-modal" class="modal-overlay hidden">
    <div class="modal-content">
      <h3 id="modal-card-title">Play Card</h3>
      <p style="font-size: 0.85rem; color: var(--text-muted);">Select how you want to play this card:</p>
      <div id="modal-actions-container" class="modal-actions"></div>
      <button id="modal-close-btn" class="btn-secondary" style="margin-top: 8px;">Cancel</button>
    </div>
  </div>

  <script src="app.js"></script>
</body>
</html>
