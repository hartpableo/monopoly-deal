// Game Constants & Configuration

export const COLOR_NAMES = {
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

export const COLOR_HEX = {
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

export const SET_RULES = {
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

export const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

export const SPEAKING_THRESHOLD = 12; // Frequency average threshold for voice detection
export const SPEAKING_HOLD_MS = 400; // Debounce hold ms to prevent flickering during pauses
