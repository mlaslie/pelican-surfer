import {
  CAMPUS_DIST_STEP,
  FLAP_MAX_CHARGES,
  HOVER_COST_COINS,
  RESPAWN_MEDALLIONS_NEEDED,
  SPARKLE_DURATION,
} from './constants.js';
import { CAMPUSES, getCampus } from './campuses.js';
import { isMusicEnabled, isMuted } from './audio.js';

const dom = {
  hudCampus: null,
  hudScore: null,
  hudCoins: null,
  hudBest: null,
  flapWrap: null,
  flapPips: null,
  comboWrap: null,
  respawnWrap: null,
  btnHover: null,
  sparkleWrap: null,
  sparkleFill: null,
  overlay: null,
  overlayBadge: null,
  overlayTitle: null,
  overlayDesc: null,
  overlayStats: null,
  finalScore: null,
  finalCoins: null,
  finalDist: null,
  finalBest: null,
  btnPlay: null,
  btnMode: null,
  btnMusic: null,
  btnMute: null,
  btnPause: null,
  creditsActions: null,
  btnCreditsEndless: null,
  btnCreditsRestart: null,
  tourProgressLabel: null,
  campusPills: null,
};

const hudCache = {
  scoreText: null,
  coinsText: null,
  bestText: null,
  campusIdx: -1,
  lockedCampus: null,
  tourState: null,
  tourLabelText: null,
  completedCount: -1,
  flapVisible: null,
  flapsRemaining: -1,
  comboVisible: null,
  comboText: null,
  respawnVisible: null,
  respawnText: null,
  hoverVisible: null,
  hoverActive: null,
  hoverText: null,
  sparkleVisible: null,
  sparkleWidth: null,
};

function cacheDomRefs() {
  dom.hudCampus = document.getElementById('hud-campus');
  dom.hudScore = document.getElementById('hud-score');
  dom.hudCoins = document.getElementById('hud-coins');
  dom.hudBest = document.getElementById('hud-best');
  dom.flapWrap = document.getElementById('flap-wrap');
  dom.flapPips = document.getElementById('flap-pips');
  dom.comboWrap = document.getElementById('combo-wrap');
  dom.respawnWrap = document.getElementById('respawn-wrap');
  dom.btnHover = document.getElementById('btn-hover');
  dom.sparkleWrap = document.getElementById('sparkle-wrap');
  dom.sparkleFill = document.getElementById('sparkle-fill');
  dom.overlay = document.getElementById('overlay');
  dom.overlayBadge = document.getElementById('overlay-badge');
  dom.overlayTitle = document.getElementById('overlay-title');
  dom.overlayDesc = document.getElementById('overlay-desc');
  dom.overlayStats = document.getElementById('overlay-stats');
  dom.finalScore = document.getElementById('final-score');
  dom.finalCoins = document.getElementById('final-coins');
  dom.finalDist = document.getElementById('final-dist');
  dom.finalBest = document.getElementById('final-best');
  dom.btnPlay = document.getElementById('btn-play');
  dom.btnMode = document.getElementById('btn-mode');
  dom.btnMusic = document.getElementById('btn-music');
  dom.btnMute = document.getElementById('btn-mute');
  dom.btnPause = document.getElementById('btn-pause');
  dom.creditsActions = document.getElementById('credits-actions');
  dom.btnCreditsEndless = document.getElementById('btn-credits-endless');
  dom.btnCreditsRestart = document.getElementById('btn-credits-restart');
  dom.tourProgressLabel = document.getElementById('tour-progress-label');
  dom.campusPills = document.getElementById('campus-pills');
}

function buildTourTracker() {
  if (!dom.campusPills) return;
  dom.campusPills.innerHTML = '';

  CAMPUSES.forEach((c, idx) => {
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.disabled = true;
    const groupClass = c.group === 'moonshot' ? ' moonshot' : '';
    badge.className = 'campus-btn' + groupClass + (idx === 0 ? ' active' : '');
    badge.dataset.campus = c.id;
    badge.dataset.index = String(idx);
    const prefix = c.group === 'moonshot' ? '🚀 ' : '';
    badge.innerHTML = `<span class="lvl-state"></span><span>${idx + 1}. ${prefix}${c.shortLabel}</span>`;
    dom.campusPills.appendChild(badge);
  });

  const finale = document.createElement('button');
  finale.type = 'button';
  finale.disabled = true;
  finale.className = 'campus-btn credits-btn';
  finale.dataset.campus = 'credits';
  finale.innerHTML = '<span>🎬 Finale</span>';
  dom.campusPills.appendChild(finale);
}

export function initHud(gs, handlers) {
  cacheDomRefs();
  buildTourTracker();
  if (dom.flapPips) {
    dom.flapPips.innerHTML = '';
    for (let i = 0; i < FLAP_MAX_CHARGES; i++) {
      const pip = document.createElement('span');
      pip.className = 'flap-pip ready';
      dom.flapPips.appendChild(pip);
    }
  }

  if (dom.btnPlay && handlers.onPlayClick) {
    dom.btnPlay.addEventListener('click', handlers.onPlayClick);
  }
  if (dom.btnPause && handlers.onPauseClick) {
    dom.btnPause.addEventListener('click', handlers.onPauseClick);
  }
  if (dom.btnMute && handlers.onMuteClick) {
    dom.btnMute.addEventListener('click', handlers.onMuteClick);
  }
  if (dom.btnMusic && handlers.onMusicClick) {
    dom.btnMusic.addEventListener('click', handlers.onMusicClick);
  }
  if (dom.btnMode && handlers.onModeClick) {
    dom.btnMode.addEventListener('click', handlers.onModeClick);
  }
  if (dom.btnHover && handlers.onHoverClick) {
    dom.btnHover.addEventListener('click', handlers.onHoverClick);
  }
  if (dom.btnCreditsEndless && handlers.onCreditsEndless) {
    dom.btnCreditsEndless.addEventListener('click', handlers.onCreditsEndless);
  }
  if (dom.btnCreditsRestart && handlers.onCreditsRestart) {
    dom.btnCreditsRestart.addEventListener('click', handlers.onCreditsRestart);
  }

  syncMuteButton();
  syncMusicButton();
  syncModeButton(gs.speedMode);
  syncPauseButton(gs.state);
  syncHud(gs, true);
}

export function syncMuteButton() {
  if (!dom.btnMute) return;
  dom.btnMute.textContent = isMuted() ? '🔇 Muted' : '🔊 Sound';
}

export function syncMusicButton() {
  if (!dom.btnMusic) return;
  dom.btnMusic.textContent = isMusicEnabled() ? '🎵 Music' : '🎵 Off';
}

export function syncModeButton(speedMode) {
  if (!dom.btnMode) return;
  dom.btnMode.textContent = speedMode === 'noogler' ? '🚲 Noogler' : '🚀 Googler';
}

export function syncPauseButton(state) {
  if (!dom.btnPause) return;
  dom.btnPause.textContent = state === 'paused' ? '▶ Resume' : '⏸ Pause';
}

export function showStartOverlay() {
  if (!dom.overlay) return;
  dom.overlayBadge.textContent = 'GBIKE · 3-LANE WORLD TOUR';
  dom.overlayTitle.textContent = 'Pelican Surfer';
  dom.overlayDesc.innerHTML =
    'Ride your 4-color GBike across <strong>GBus shuttles, double-deckers, trams &amp; harbor ferries</strong>. ' +
    'Tap Jump mid-air to <strong>flap &amp; fly</strong>, hit yellow ramps to surf roofs, duck under skybridges, and grab <strong>Gemini Sparkles</strong>!';
  dom.overlayStats.hidden = true;
  dom.btnPlay.textContent = 'Ride Now (Space)';
  dom.overlay.classList.remove('hidden');
  syncPauseButton('start');
}

export function showPauseOverlay() {
  if (!dom.overlay) return;
  dom.overlayBadge.textContent = 'PAUSED';
  dom.overlayTitle.textContent = 'Take a Breather';
  dom.overlayDesc.innerHTML =
    'Your GBike is parked on the shoulder. Press <strong>Space</strong> or <strong>P</strong> to keep riding.';
  dom.overlayStats.hidden = true;
  dom.btnPlay.textContent = 'Resume (Space)';
  dom.overlay.classList.remove('hidden');
  syncPauseButton('paused');
}

export function showGameOverOverlay(gs, reasonText) {
  if (!dom.overlay) return;
  if (dom.creditsActions) dom.creditsActions.hidden = true;
  const campus = getCampus(gs.campusIdx);
  const finalScore = Math.floor(gs.score);
  dom.overlayBadge.textContent = campus.name.toUpperCase();
  dom.overlayTitle.textContent = 'Wipeout!';
  dom.overlayDesc.textContent =
    reasonText || 'You clipped campus traffic! Hop back on the GBike and beat your score.';
  dom.overlayStats.hidden = false;
  dom.finalScore.textContent = finalScore.toLocaleString();
  dom.finalCoins.textContent = gs.coins.toLocaleString();
  dom.finalDist.textContent = `${Math.floor(gs.distance)}m`;
  dom.finalBest.textContent = gs.bestScore.toLocaleString();
  dom.btnPlay.textContent = 'Ride Again (Space)';
  dom.overlay.classList.remove('hidden');
  syncPauseButton('gameover');
}

export function showCreditsOverlay() {
  if (dom.overlay) dom.overlay.classList.add('hidden');
  if (dom.creditsActions) dom.creditsActions.hidden = false;
  syncPauseButton('credits');
}

export function hideOverlay(state = 'playing') {
  if (!dom.overlay) return;
  dom.overlay.classList.add('hidden');
  if (dom.creditsActions) dom.creditsActions.hidden = true;
  syncPauseButton(state);
}

export function syncHud(gs, force = false) {
  const scoreText = Math.floor(gs.score).toLocaleString();
  if (force || scoreText !== hudCache.scoreText) {
    hudCache.scoreText = scoreText;
    if (dom.hudScore) dom.hudScore.textContent = scoreText;
  }

  const coinsText = gs.coins.toLocaleString();
  if (force || coinsText !== hudCache.coinsText) {
    hudCache.coinsText = coinsText;
    if (dom.hudCoins) dom.hudCoins.textContent = coinsText;
  }

  const bestText = gs.bestScore.toLocaleString();
  if (force || bestText !== hudCache.bestText) {
    hudCache.bestText = bestText;
    if (dom.hudBest) dom.hudBest.textContent = bestText;
  }

  const completedCount = gs.state === 'credits' || gs.endlessMode
    ? CAMPUSES.length
    : Math.min(CAMPUSES.length, Math.floor(gs.distance / CAMPUS_DIST_STEP));

  if (
    force ||
    gs.campusIdx !== hudCache.campusIdx ||
    gs.state !== hudCache.tourState ||
    completedCount !== hudCache.completedCount
  ) {
    hudCache.campusIdx = gs.campusIdx;
    hudCache.tourState = gs.state;
    hudCache.completedCount = completedCount;
    const campus = getCampus(gs.campusIdx);
    if (dom.hudCampus) {
      dom.hudCampus.textContent =
        gs.state === 'credits'
          ? '🎬 Tour Complete · End of the Earth'
          : `Lvl ${gs.campusIdx + 1}/${CAMPUSES.length} · ${campus.name} · ${campus.vehicleName}`;
    }
    if (dom.campusPills) {
      const children = dom.campusPills.children;
      for (let i = 0; i < children.length; i++) {
        const el = children[i];
        const tag = el.dataset.campus;
        if (tag === 'credits') {
          el.classList.toggle('active', gs.state === 'credits');
          el.classList.toggle('completed', gs.endlessMode);
        } else {
          const idx = Number(el.dataset.index);
          const isCompleted = idx < completedCount;
          const isActive = gs.state !== 'credits' && idx === gs.campusIdx;
          el.classList.toggle('completed', isCompleted && !isActive);
          el.classList.toggle('active', isActive);
          const stateIcon = el.querySelector('.lvl-state');
          if (stateIcon) {
            stateIcon.textContent = isCompleted && !isActive ? '✓' : isActive ? '▶' : '🔒';
          }
        }
      }
    }
  }

  if (dom.tourProgressLabel) {
    let labelText = '';
    if (gs.state === 'credits') {
      labelText = '★ All 12 Levels Complete — Rolling Credits Finale ★';
    } else if (gs.endlessMode) {
      const campus = getCampus(gs.campusIdx);
      labelText = `♾️ Endless Mode — ${campus.name} (${Math.floor(gs.distance)}m)`;
    } else {
      const campus = getCampus(gs.campusIdx);
      const nextDist = (gs.campusIdx + 1) * CAMPUS_DIST_STEP;
      const remaining = Math.max(0, Math.ceil(nextDist - gs.distance));
      const nextName =
        gs.campusIdx + 1 < CAMPUSES.length
          ? CAMPUSES[gs.campusIdx + 1].shortLabel
          : 'Rolling Credits Finale';
      labelText = `Level ${gs.campusIdx + 1} / ${CAMPUSES.length} — ${campus.name} (${remaining}m to ${nextName})`;
    }
    if (force || labelText !== hudCache.tourLabelText) {
      hudCache.tourLabelText = labelText;
      dom.tourProgressLabel.textContent = labelText;
    }
  }

  const flapVisible = gs.state === 'playing' && (!gs.player.grounded || gs.player.flapsRemaining < FLAP_MAX_CHARGES);
  if (force || flapVisible !== hudCache.flapVisible) {
    hudCache.flapVisible = flapVisible;
    if (dom.flapWrap) dom.flapWrap.hidden = !flapVisible;
  }
  if (force || gs.player.flapsRemaining !== hudCache.flapsRemaining) {
    hudCache.flapsRemaining = gs.player.flapsRemaining;
    if (dom.flapPips) {
      const pips = dom.flapPips.children;
      for (let i = 0; i < pips.length; i++) {
        pips[i].classList.toggle('ready', i < gs.player.flapsRemaining);
      }
    }
  }

  const comboVisible = gs.state === 'playing' && gs.player.comboTimer > 0 && gs.player.comboMult > 1;
  if (force || comboVisible !== hudCache.comboVisible) {
    hudCache.comboVisible = comboVisible;
    if (dom.comboWrap) dom.comboWrap.hidden = !comboVisible;
  }
  if (comboVisible) {
    const comboText = `🔥 ×${gs.player.comboMult} COMBO`;
    if (force || comboText !== hudCache.comboText) {
      hudCache.comboText = comboText;
      if (dom.comboWrap) dom.comboWrap.textContent = comboText;
    }
  }

  const respawnVisible =
    gs.state === 'playing' && (gs.player.respawns > 0 || gs.player.medallions > 0);
  if (force || respawnVisible !== hudCache.respawnVisible) {
    hudCache.respawnVisible = respawnVisible;
    if (dom.respawnWrap) dom.respawnWrap.hidden = !respawnVisible;
  }
  if (respawnVisible) {
    const respawnText =
      gs.player.respawns > 0
        ? `🛡 ×${gs.player.respawns} · G ${gs.player.medallions}/${RESPAWN_MEDALLIONS_NEEDED}`
        : `G ${gs.player.medallions}/${RESPAWN_MEDALLIONS_NEEDED}`;
    if (force || respawnText !== hudCache.respawnText) {
      hudCache.respawnText = respawnText;
      if (dom.respawnWrap) dom.respawnWrap.textContent = respawnText;
    }
  }

  const hoverActive = gs.player.hoverTimer > 0;
  const hoverVisible =
    gs.state === 'playing' && (hoverActive || gs.coins >= HOVER_COST_COINS);
  if (force || hoverVisible !== hudCache.hoverVisible) {
    hudCache.hoverVisible = hoverVisible;
    if (dom.btnHover) dom.btnHover.hidden = !hoverVisible;
  }
  if (hoverVisible) {
    const hoverText = hoverActive
      ? `⚡ HOVER ${Math.ceil(gs.player.hoverTimer)}s`
      : `⚡ Hover (Shift · ${HOVER_COST_COINS}G)`;
    if (force || hoverActive !== hudCache.hoverActive || hoverText !== hudCache.hoverText) {
      hudCache.hoverActive = hoverActive;
      hudCache.hoverText = hoverText;
      if (dom.btnHover) {
        dom.btnHover.classList.toggle('active', hoverActive);
        dom.btnHover.textContent = hoverText;
      }
    }
  }

  const sparkleVisible = gs.player.sparkleTimer > 0;
  if (force || sparkleVisible !== hudCache.sparkleVisible) {
    hudCache.sparkleVisible = sparkleVisible;
    if (dom.sparkleWrap) dom.sparkleWrap.hidden = !sparkleVisible;
  }

  if (sparkleVisible) {
    const pct = Math.max(0, Math.min(100, (gs.player.sparkleTimer / SPARKLE_DURATION) * 100));
    const widthStr = `${(Math.round(pct * 2) / 2).toFixed(1)}%`;
    if (force || widthStr !== hudCache.sparkleWidth) {
      hudCache.sparkleWidth = widthStr;
      if (dom.sparkleFill) dom.sparkleFill.style.width = widthStr;
    }
  } else {
    hudCache.sparkleWidth = null;
  }
}
