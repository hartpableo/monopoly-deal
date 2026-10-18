// Shared Reactive Client & Audio/WebRTC State

export const state = {
  currentGameId: localStorage.getItem('md_game_id') || null,
  currentPlayerData: JSON.parse(localStorage.getItem('md_player_data') || 'null'),
  currentGameState: null,
  pollTimer: null,
  signalTimer: null,
  selectedPaymentCardIds: new Set(),
  paymentStep: 'prompt', // 'prompt' or 'pay'
  currentPendingActionCardId: null,
  currentPendingActionId: null,
  paymentPromptError: null,
  actionPromptError: null,
  previousPendingAction: null,
  previousChallengedPayer: null,
  isSubmittingPayment: false,
  isAutoEndingTurn: false,
  lastProcessedLogTimestamp: 0,
  previousActivePlayerId: null,
  previousPendingPayment: null,
  hasShownWinnerModal: false,
  lastSeenExcessNotifTimestamp: 0,

  // WebRTC Voice Chat State
  localStream: null,
  isMicMuted: false,
  peerConnections: {}, // peerId -> RTCPeerConnection
  dataChannels: {}, // peerId -> RTCDataChannel

  // Speaking Detection & Audio Analysis State
  speakingPlayers: new Set(),
  audioContext: null,
  localAudioSource: null,
  localAudioAnalyser: null,
  peerAudioAnalysers: {}, // peerId -> { source, analyser }
  speakingHoldTimers: {}, // playerId -> setTimeout id
  audioMonitorTimer: null
};

export function saveSession(gameId, playerId, name) {
  state.currentGameId = gameId;
  state.currentPlayerData = { id: playerId, name };
  localStorage.setItem('md_game_id', gameId);
  localStorage.setItem('md_player_data', JSON.stringify(state.currentPlayerData));
}

export function purgeSessionStorage() {
  localStorage.removeItem('md_game_id');
  localStorage.removeItem('md_player_data');
  state.currentGameId = null;
  state.currentPlayerData = null;
  state.currentGameState = null;
}
