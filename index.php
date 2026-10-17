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
    <div class="header-left">
      <div class="logo">🎩 Monopoly Deal</div>
      <div id="room-badge" class="badge badge-room hidden">Room: <span id="room-code-display">------</span></div>
    </div>

    <div class="header-status">
      <span id="turn-badge" class="badge badge-turn">Waiting...</span>
      <span id="actions-badge" class="badge badge-actions">3 Actions Left</span>
      <button id="btn-toggle-mic" class="btn-mic btn-secondary">🎤 Enable Voice</button>
      <button id="btn-end-turn" class="btn-danger">End Turn</button>
      <button id="btn-leave-game" class="btn-secondary btn-leave">Leave</button>
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

      <div style="display: flex; gap: 8px; margin-top: 4px;">
        <button id="btn-create-game" class="btn-primary" style="width: 100%;">Create New Game</button>
      </div>

      <div>
        <button id="btn-demo-game" class="btn-demo" style="width: 100%;">🎮 Launch Dummy Game (Instant UI/UX Review)</button>
      </div>

      <div class="lobby-divider">
        <span>OR</span>
      </div>

      <div class="form-group">
        <label for="input-room-code">Room Code</label>
        <input type="text" id="input-room-code" placeholder="e.g. 6-letter code" maxlength="6" style="text-transform: uppercase;">
      </div>

      <button id="btn-join-game" class="btn-secondary" style="width: 100%;">Join Existing Game</button>

      <div style="margin-top: 12px;">
        <div class="section-title">Connected Players:</div>
        <ul id="lobby-players" class="lobby-players-list">
          <li class="lobby-empty-hint">Create or join a room to see players.</li>
        </ul>
        <button id="btn-start-game" class="hidden btn-start" style="width: 100%; margin-top: 12px;">Start Game (Need 2+ Players)</button>
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
            <div class="slot-label">DRAW PILE (<span id="deck-count">0</span>)</div>
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
            <div class="slot-label">DISCARD PILE (<span id="discard-top-label">Empty</span>)</div>
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
    <div class="modal-content modal-card-dialog">
      <div class="modal-header-row">
        <h3 id="modal-card-title">Play Card</h3>
        <button id="modal-close-x" class="modal-close-x" aria-label="Close">✕</button>
      </div>
      <div id="modal-card-preview" class="modal-card-preview"></div>
      <p style="font-size: 0.85rem; color: var(--text-muted); text-align: center;">Select how you want to play this card:</p>
      <div id="modal-actions-container" class="modal-actions"></div>
      <button id="modal-close-btn" class="btn-secondary" style="margin-top: 8px;">Cancel</button>
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

  <script src="app.js"></script>
</body>
</html>
