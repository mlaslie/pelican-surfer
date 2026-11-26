let audioCtx = null;
let muted = false;
let musicEnabled = true;
let musicPlaying = false;
let musicTimer = null;
let musicStep = 0;
let musicSpeedRef = 11.5;

export function ensureAudio() {
  if (muted) return;
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  } catch {
    audioCtx = null;
  }
}

export function playTone(freq, endFreq, dur, type = 'sine', gainVal = 0.12) {
  if (muted || !audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + dur);
    g.gain.setValueAtTime(gainVal, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + dur);
  } catch {
    // Ignore audio context restrictions in headless environments
  }
}

// Upbeat lightweight procedural Web Audio synth loop (scales subtly with speed)
const BASS_LINE = [130.81, 130.81, 164.81, 196.0, 146.83, 146.83, 174.61, 196.0];
const ARP_LINE = [523.25, 659.25, 783.99, 1046.5, 587.33, 698.46, 880.0, 783.99];

function scheduleMusicTick() {
  if (!musicPlaying || !musicEnabled || muted || !audioCtx || audioCtx.state !== 'running') {
    return;
  }
  const idx = musicStep % BASS_LINE.length;
  const bassFreq = BASS_LINE[idx];
  const arpFreq = ARP_LINE[(musicStep + (musicStep >> 3)) % ARP_LINE.length];

  // Warm punchy triangle bass
  playTone(bassFreq, bassFreq * 0.98, 0.14, 'triangle', 0.045);
  // Crisp off-beat synth arpeggio sparkle
  if (musicStep % 2 === 1) {
    playTone(arpFreq, arpFreq * 1.01, 0.09, 'sine', 0.024);
  }
  musicStep += 1;

  // Tempo scales gently from ~126 BPM to ~162 BPM as speed increases
  const speedFrac = Math.max(0, Math.min(1, (musicSpeedRef - 11.5) / 30));
  const nextMs = Math.round(235 - speedFrac * 52);
  musicTimer = setTimeout(scheduleMusicTick, nextMs);
}

export function setMusicSpeed(speed) {
  musicSpeedRef = speed;
}

export function startMusic() {
  musicPlaying = true;
  if (musicTimer !== null) return;
  if (!muted && musicEnabled) {
    ensureAudio();
    musicTimer = setTimeout(scheduleMusicTick, 120);
  }
}

export function stopMusic() {
  musicPlaying = false;
  if (musicTimer !== null) {
    clearTimeout(musicTimer);
    musicTimer = null;
  }
}

// Retro 8-bit Atari / arcade celebratory ending theme for Rolling Credits
let endingTimer = null;
let endingStep = 0;
const ENDING_MELODY = [
  523.25, 659.25, 783.99, 1046.5, 987.77, 783.99, 880.0, 659.25,
  587.33, 739.99, 880.0, 1174.66, 1046.5, 987.77, 783.99, 1046.5,
];
const ENDING_BASS = [
  130.81, 196.0, 164.81, 196.0, 174.61, 220.0, 196.0, 146.83,
];

function scheduleEndingTick() {
  if (endingTimer === null) return;
  if (!muted && musicEnabled && audioCtx && audioCtx.state === 'running') {
    const mel = ENDING_MELODY[endingStep % ENDING_MELODY.length];
    const bas = ENDING_BASS[(endingStep >> 1) % ENDING_BASS.length];
    playTone(mel, mel * 1.005, 0.22, 'square', 0.042);
    if (endingStep % 2 === 0) {
      playTone(bas, bas * 0.99, 0.28, 'triangle', 0.055);
    }
  }
  endingStep += 1;
  endingTimer = setTimeout(scheduleEndingTick, 260);
}

export function startEndingMusic() {
  stopMusic();
  stopEndingMusic();
  endingStep = 0;
  if (!muted && musicEnabled) ensureAudio();
  endingTimer = setTimeout(scheduleEndingTick, 80);
}

export function stopEndingMusic() {
  if (endingTimer !== null) {
    clearTimeout(endingTimer);
    endingTimer = null;
  }
}

export function isMusicEnabled() {
  return musicEnabled;
}

export function toggleMusic() {
  musicEnabled = !musicEnabled;
  if (!musicEnabled) {
    if (musicTimer !== null) {
      clearTimeout(musicTimer);
      musicTimer = null;
    }
  } else if (musicPlaying && !muted) {
    ensureAudio();
    if (musicTimer === null) {
      musicTimer = setTimeout(scheduleMusicTick, 100);
    }
  }
  return musicEnabled;
}

export const SFX = {
  lane: () => playTone(260, 420, 0.08, 'triangle', 0.09),
  jump: () => playTone(240, 620, 0.16, 'sine', 0.12),
  flap: (step = 0) => {
    const base = 300 + step * 55;
    playTone(base, base + 240, 0.13, 'triangle', 0.11);
    playTone(base * 0.55, base * 0.85, 0.15, 'sine', 0.07);
  },
  duck: () => playTone(320, 140, 0.12, 'triangle', 0.09),
  coin: () => playTone(880, 1320, 0.08, 'sine', 0.09),
  medallion: () => {
    playTone(587, 880, 0.14, 'triangle', 0.13);
    setTimeout(() => playTone(880, 1175, 0.18, 'sine', 0.13), 75);
  },
  respawnBank: () => {
    playTone(523, 659, 0.12, 'triangle', 0.13);
    setTimeout(() => playTone(659, 784, 0.12, 'triangle', 0.13), 80);
    setTimeout(() => playTone(784, 1046, 0.24, 'sine', 0.15), 160);
  },
  respawnRevive: () => {
    playTone(392, 784, 0.2, 'sine', 0.15);
    setTimeout(() => playTone(523, 1046, 0.28, 'triangle', 0.14), 80);
  },
  hoverOn: () => {
    playTone(220, 660, 0.22, 'sine', 0.12);
    setTimeout(() => playTone(440, 880, 0.18, 'triangle', 0.1), 65);
  },
  hoverSave: () => {
    playTone(620, 180, 0.2, 'sawtooth', 0.13);
    setTimeout(() => playTone(520, 1040, 0.18, 'sine', 0.12), 50);
  },
  combo: (mult = 2) => {
    const f = 440 + Math.min(5, mult) * 110;
    playTone(f, f * 1.35, 0.11, 'triangle', 0.1);
  },
  ramp: () => playTone(330, 740, 0.18, 'triangle', 0.11),
  sparkle: () => {
    playTone(523, 1046, 0.22, 'sine', 0.14);
    setTimeout(() => playTone(784, 1568, 0.24, 'triangle', 0.12), 70);
  },
  smash: () => {
    playTone(180, 55, 0.18, 'sawtooth', 0.16);
    playTone(520, 960, 0.12, 'triangle', 0.09);
  },
  bump: () => playTone(160, 75, 0.16, 'sawtooth', 0.14),
  crash: () => {
    playTone(190, 45, 0.35, 'sawtooth', 0.18);
    setTimeout(() => playTone(120, 38, 0.3, 'square', 0.11), 60);
  },
  bell: () => {
    playTone(1480, 1460, 0.14, 'sine', 0.12);
    setTimeout(() => playTone(1480, 1450, 0.22, 'sine', 0.12), 110);
  },
};

export function isMuted() {
  return muted;
}

export function setMuted(val) {
  muted = Boolean(val);
  if (muted) {
    if (musicTimer !== null) {
      clearTimeout(musicTimer);
      musicTimer = null;
    }
  } else {
    ensureAudio();
    if (musicPlaying && musicEnabled && musicTimer === null) {
      musicTimer = setTimeout(scheduleMusicTick, 100);
    }
  }
  return muted;
}

export function toggleMute() {
  return setMuted(!muted);
}
