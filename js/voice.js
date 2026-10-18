// WebRTC Voice Chat & Speaking Detection

import { state } from './state.js';
import { rtcConfig, SPEAKING_THRESHOLD, SPEAKING_HOLD_MS } from './constants.js';
import { getAudioContext } from './audio.js';
import { apiRequest } from './api.js';

export function initLocalAudioAnalyser() {
  if (!state.localStream) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (state.localAudioSource) {
      try { state.localAudioSource.disconnect(); } catch (e) {}
    }

    state.localAudioSource = ctx.createMediaStreamSource(state.localStream);
    state.localAudioAnalyser = ctx.createAnalyser();
    state.localAudioAnalyser.fftSize = 256;
    state.localAudioAnalyser.smoothingTimeConstant = 0.3;
    state.localAudioSource.connect(state.localAudioAnalyser);

    startAudioMonitorLoop();
  } catch (err) {
    console.warn('Failed to initialize local audio analyser:', err);
  }
}

export function attachPeerAudioStream(peerId, stream) {
  try {
    const ctx = getAudioContext();
    if (!ctx || !stream) return;

    cleanupPeerAudio(peerId);

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);

    state.peerAudioAnalysers[peerId] = { source, analyser };
    startAudioMonitorLoop();
  } catch (err) {
    console.warn('Failed to attach remote stream analyser for peer', peerId, err);
  }
}

export function cleanupPeerAudio(peerId) {
  if (state.peerAudioAnalysers[peerId]) {
    try {
      state.peerAudioAnalysers[peerId].source.disconnect();
    } catch (e) {}
    delete state.peerAudioAnalysers[peerId];
  }
}

export function startAudioMonitorLoop() {
  if (state.audioMonitorTimer) return;

  state.audioMonitorTimer = setInterval(() => {
    const myId = state.currentPlayerData?.id;

    // 1. Check local player microphone volume
    if (myId && state.localStream && state.localAudioAnalyser && !state.isMicMuted) {
      const vol = getAnalyserVolume(state.localAudioAnalyser);
      processVolumeSample(myId, vol, true);
    } else if (myId && state.isMicMuted) {
      if (state.speakingPlayers.has(myId)) {
        setPlayerSpeaking(myId, false);
        broadcastSpeakingStatus(false);
      }
    }

    // 2. Check remote peers audio volume
    for (const [peerId, obj] of Object.entries(state.peerAudioAnalysers)) {
      if (obj?.analyser) {
        const vol = getAnalyserVolume(obj.analyser);
        processVolumeSample(peerId, vol, false);
      }
    }

    // Stop monitor timer if no active streams
    const hasRemote = Object.keys(state.peerAudioAnalysers).length > 0;
    const hasLocal = !!(state.localStream && state.localAudioAnalyser);
    if (!hasRemote && !hasLocal) {
      clearInterval(state.audioMonitorTimer);
      state.audioMonitorTimer = null;
    }
  }, 80);
}

export function getAnalyserVolume(analyser) {
  if (!analyser) return 0;
  const buffer = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i];
  }
  return sum / buffer.length;
}

export function processVolumeSample(playerId, volume, isLocal) {
  const isAboveThreshold = volume >= SPEAKING_THRESHOLD;

  if (isAboveThreshold) {
    if (state.speakingHoldTimers[playerId]) {
      clearTimeout(state.speakingHoldTimers[playerId]);
      delete state.speakingHoldTimers[playerId];
    }
    if (!state.speakingPlayers.has(playerId)) {
      setPlayerSpeaking(playerId, true);
      if (isLocal) {
        broadcastSpeakingStatus(true);
      }
    }
  } else if (state.speakingPlayers.has(playerId) && !state.speakingHoldTimers[playerId]) {
    state.speakingHoldTimers[playerId] = setTimeout(() => {
      setPlayerSpeaking(playerId, false);
      delete state.speakingHoldTimers[playerId];
      if (isLocal) {
        broadcastSpeakingStatus(false);
      }
    }, SPEAKING_HOLD_MS);
  }
}

export function setPlayerSpeaking(playerId, isSpeaking) {
  const wasSpeaking = state.speakingPlayers.has(playerId);
  if (wasSpeaking === isSpeaking) return;

  if (isSpeaking) {
    state.speakingPlayers.add(playerId);
  } else {
    state.speakingPlayers.delete(playerId);
  }

  const myId = state.currentPlayerData?.id;
  if (playerId === myId) {
    const myBoard = document.getElementById('my-board');
    const myInd = document.getElementById('my-speaking-indicator');
    if (myBoard) myBoard.classList.toggle('is-speaking', isSpeaking);
    if (myInd) myInd.classList.toggle('hidden', !isSpeaking);

    const btnMic = document.getElementById('btn-toggle-mic');
    if (btnMic && !state.isMicMuted && state.localStream) {
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

export function clearAllSpeakingHoldTimers() {
  for (const pid of Object.keys(state.speakingHoldTimers)) {
    clearTimeout(state.speakingHoldTimers[pid]);
    delete state.speakingHoldTimers[pid];
  }
}

export function setupDataChannel(peerId, channel) {
  state.dataChannels[peerId] = channel;

  channel.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'speaking') {
        if (data.isSpeaking) {
          if (state.speakingHoldTimers[peerId]) {
            clearTimeout(state.speakingHoldTimers[peerId]);
            delete state.speakingHoldTimers[peerId];
          }
          setPlayerSpeaking(peerId, true);
        } else if (state.speakingPlayers.has(peerId) && !state.speakingHoldTimers[peerId]) {
          state.speakingHoldTimers[peerId] = setTimeout(() => {
            setPlayerSpeaking(peerId, false);
            delete state.speakingHoldTimers[peerId];
          }, SPEAKING_HOLD_MS);
        }
      }
    } catch (e) {}
  };

  channel.onclose = () => {
    delete state.dataChannels[peerId];
  };
}

export function broadcastSpeakingStatus(isSpeaking) {
  const msg = JSON.stringify({ type: 'speaking', isSpeaking });
  for (const peerId in state.dataChannels) {
    const dc = state.dataChannels[peerId];
    if (dc && dc.readyState === 'open') {
      try {
        dc.send(msg);
      } catch (err) {}
    }
  }
}

export async function toggleMic() {
  const btn = document.getElementById('btn-toggle-mic');

  if (!state.localStream) {
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      state.isMicMuted = false;
      btn.textContent = '🎤 Mic: ON';
      btn.className = 'btn-mic active';

      initLocalAudioAnalyser();

      // Attach local stream to all existing connections
      for (const [peerId, pc] of Object.entries(state.peerConnections)) {
        state.localStream.getTracks().forEach(track => pc.addTrack(track, state.localStream));
        if (state.currentPlayerData?.id < peerId) {
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

  state.isMicMuted = !state.isMicMuted;
  state.localStream.getAudioTracks().forEach(track => {
    track.enabled = !state.isMicMuted;
  });

  if (state.isMicMuted) {
    btn.textContent = '🔇 Mic: MUTED';
    btn.className = 'btn-mic muted';
    btn.classList.remove('is-talking');
    if (state.currentPlayerData?.id) {
      setPlayerSpeaking(state.currentPlayerData.id, false);
      broadcastSpeakingStatus(false);
    }
  } else {
    btn.textContent = '🎤 Mic: ON';
    btn.className = 'btn-mic active';
  }
}

export function stopVoiceChat() {
  if (state.localStream) {
    state.localStream.getTracks().forEach(t => t.stop());
    state.localStream = null;
  }

  if (state.localAudioSource) {
    try { state.localAudioSource.disconnect(); } catch (e) {}
    state.localAudioSource = null;
  }
  state.localAudioAnalyser = null;

  for (const peerId of Object.keys(state.peerAudioAnalysers)) {
    cleanupPeerAudio(peerId);
  }

  for (const peerId of Object.keys(state.dataChannels)) {
    try { state.dataChannels[peerId].close(); } catch (e) {}
    delete state.dataChannels[peerId];
  }

  Object.values(state.peerConnections).forEach(pc => pc.close());
  state.peerConnections = {};

  state.speakingPlayers.clear();
  clearAllSpeakingHoldTimers();

  const myId = state.currentPlayerData?.id;
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

export async function connectToAllPeers() {
  if (!state.currentGameState || !state.currentPlayerData || !state.localStream) return;

  const myId = state.currentPlayerData.id;
  for (const peerId of Object.keys(state.currentGameState.players)) {
    if (peerId !== myId && !state.peerConnections[peerId]) {
      if (myId < peerId) {
        await initiatePeerConnection(peerId);
      }
    }
  }
}

export async function initiatePeerConnection(peerId) {
  const pc = createPeerConnection(peerId);
  if (state.localStream) {
    state.localStream.getTracks().forEach(track => pc.addTrack(track, state.localStream));
  }

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

export function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(rtcConfig);
  state.peerConnections[peerId] = pc;

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

export async function sendSignal(receiverId, message) {
  try {
    await apiRequest('signal', 'POST', {
      game_id: state.currentGameId,
      sender_id: state.currentPlayerData.id,
      receiver_id: receiverId,
      message
    });
  } catch (err) {
    console.error('Failed to send WebRTC signal:', err);
  }
}

export async function pollSignals() {
  if (!state.currentGameId || !state.currentPlayerData) return;

  try {
    const res = await apiRequest(`signals&game_id=${state.currentGameId}&player_id=${state.currentPlayerData.id}`, 'GET');
    for (const item of (res.signals || [])) {
      await handleIncomingSignal(item.sender_id, item.message);
    }
  } catch (err) {
    console.error('Failed to poll signals:', err);
  }
}

export async function handleIncomingSignal(senderId, msg) {
  let pc = state.peerConnections[senderId];

  if (msg.type === 'offer') {
    if (!pc) {
      pc = createPeerConnection(senderId);
      if (state.localStream) {
        state.localStream.getTracks().forEach(track => pc.addTrack(track, state.localStream));
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
