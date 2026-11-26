import {
  CAMPUS_DIST_STEP,
  FIXED_DT,
  MAX_FIXED_STEPS,
  MAX_FRAME_DT,
} from './constants.js';
import { CAMPUSES } from './campuses.js';
import {
  SFX,
  ensureAudio,
  startEndingMusic,
  startMusic,
  stopEndingMusic,
  stopMusic,
  toggleMusic,
  toggleMute,
} from './audio.js';
import {
  addFloatingText,
  createGameState,
  installDebugHook,
  snapshotPrevState,
} from './state.js';
import {
  hideOverlay,
  initHud,
  showCreditsOverlay,
  showGameOverOverlay,
  showPauseOverlay,
  syncHud,
  syncModeButton,
  syncMusicButton,
  syncMuteButton,
  syncPauseButton,
} from './hud.js';
import { renderScene, resizeViewport } from './renderer.js';
import {
  activateHover,
  clearHeldInputs,
  queueLaneMove,
  requestDuckDown,
  requestDuckUp,
  requestJump,
  resetGame,
  stepIdleAnimation,
  stepPhysics,
} from './physics.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const stageShell = document.getElementById('stage-shell');
const stageWrap = canvas.parentElement;

const gs = createGameState();
installDebugHook(gs);

function startGame() {
  ensureAudio();
  stopEndingMusic();
  resetGame(gs);
  gs.state = 'playing';
  gs.accumulator = 0;
  gs.lastTime = performance.now();
  hideOverlay('playing');
  syncHud(gs, true);
  startMusic();
}

function continueEndless() {
  ensureAudio();
  stopEndingMusic();
  gs.endlessMode = true;
  gs.state = 'playing';
  gs.accumulator = 0;
  gs.lastTime = performance.now();
  hideOverlay('playing');
  addFloatingText(gs, 'ENDLESS MODE! ♾️', gs.player.x, gs.player.y + 2.0, 0, '#4ade80');
  syncHud(gs, true);
  startMusic();
}

function togglePause() {
  if (gs.state === 'playing') {
    gs.state = 'paused';
    gs.accumulator = 0;
    snapshotPrevState(gs);
    clearHeldInputs(gs);
    resetTouchTracking();
    stopMusic();
    showPauseOverlay();
    renderScene(ctx, gs, 1);
  } else if (gs.state === 'paused') {
    gs.state = 'playing';
    gs.accumulator = 0;
    gs.lastTime = performance.now();
    resetTouchTracking();
    hideOverlay('playing');
    syncPauseButton('playing');
    startMusic();
  }
}

function toggleSpeedMode() {
  ensureAudio();
  gs.speedMode = gs.speedMode === 'googler' ? 'noogler' : 'googler';
  gs.bestScore = gs.speedMode === 'noogler' ? gs.bestScoreNoogler : gs.bestScoreGoogler;
  syncModeButton(gs.speedMode);
  syncHud(gs, true);
  SFX.lane();
  if (gs.state === 'playing') {
    const label = gs.speedMode === 'noogler' ? 'NOOGLER MODE (CHILL)' : 'GOOGLER MODE (TOUR)';
    addFloatingText(gs, label, gs.player.x, gs.player.y + 2.0, 0, '#38bdf8');
  }
}

function handleJumpOrStart() {
  if (gs.state === 'start' || gs.state === 'gameover') {
    startGame();
    return;
  }
  if (gs.state === 'credits') {
    continueEndless();
    return;
  }
  if (gs.state === 'paused') {
    togglePause();
    return;
  }
  requestJump(gs);
}

initHud(gs, {
  onCreditsEndless: continueEndless,
  onCreditsRestart: startGame,
  onPlayClick: () => {
    if (gs.state === 'paused') togglePause();
    else startGame();
  },
  onPauseClick: () => {
    if (gs.state === 'playing' || gs.state === 'paused') togglePause();
  },
  onMuteClick: () => {
    toggleMute();
    syncMuteButton();
  },
  onMusicClick: () => {
    toggleMusic();
    syncMusicButton();
  },
  onModeClick: () => {
    toggleSpeedMode();
  },
  onHoverClick: () => {
    ensureAudio();
    activateHover(gs);
    syncHud(gs);
  },
});

resizeViewport(canvas, gs);
if ('ResizeObserver' in window && stageWrap) {
  const ro = new ResizeObserver(() => resizeViewport(canvas, gs));
  ro.observe(stageWrap);
}
window.addEventListener('resize', () => resizeViewport(canvas, gs));

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }
  ensureAudio();

  if (e.code === 'ArrowDown' || e.code === 'KeyS') {
    if (!e.repeat) requestDuckDown(gs, true);
    return;
  }

  if (e.repeat) return;

  if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
    queueLaneMove(gs, -1);
  } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
    queueLaneMove(gs, 1);
  } else if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') {
    handleJumpOrStart();
  } else if (e.code === 'KeyP' || e.code === 'Escape') {
    if (gs.state === 'playing' || gs.state === 'paused') togglePause();
  } else if (e.code === 'KeyM') {
    toggleMute();
    syncMuteButton();
  } else if (e.code === 'KeyN') {
    toggleMusic();
    syncMusicButton();
  } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyH') {
    if (gs.state === 'playing') {
      activateHover(gs);
      syncHud(gs);
    }
  } else if (e.code === 'KeyB') {
    if (gs.state === 'playing') {
      gs.player.bellTimer = 0.55;
      SFX.bell();
      addFloatingText(gs, 'RING! 🔔', gs.player.x, gs.player.y + 2.0, 0, '#ffffff');
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowDown' || e.code === 'KeyS') {
    requestDuckUp(gs);
  }
});

window.addEventListener('blur', () => {
  clearHeldInputs(gs);
  resetTouchTracking();
});

// Touch swipe controls
let activeTouchId = null;
let touchStartX = 0;
let touchStartY = 0;
let touchHandled = false;

function findTouchById(touchList, id) {
  if (id === null || !touchList) return null;
  for (let i = 0; i < touchList.length; i++) {
    if (touchList[i].identifier === id) return touchList[i];
  }
  return null;
}

function resetTouchTracking() {
  activeTouchId = null;
  touchHandled = false;
}

canvas.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length === 0) return;
    ensureAudio();
    if (activeTouchId !== null && findTouchById(e.touches, activeTouchId)) {
      return;
    }
    const t = e.changedTouches[0] || e.touches[0];
    activeTouchId = t.identifier;
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchHandled = false;
  },
  { passive: true }
);

canvas.addEventListener(
  'touchmove',
  (e) => {
    if (touchHandled || activeTouchId === null || gs.state !== 'playing') return;
    const t = findTouchById(e.touches, activeTouchId);
    if (!t) return;
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const threshold = 28;
    if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
      touchHandled = true;
      if (Math.abs(dx) > Math.abs(dy)) {
        queueLaneMove(gs, dx > 0 ? 1 : -1);
      } else if (dy < 0) {
        handleJumpOrStart();
      } else {
        requestDuckDown(gs, false);
      }
    }
  },
  { passive: true }
);

function handleTouchEndOrCancel(e) {
  if (activeTouchId === null) return;
  if (findTouchById(e.changedTouches, activeTouchId) || !findTouchById(e.touches, activeTouchId)) {
    resetTouchTracking();
  }
}

canvas.addEventListener('touchend', handleTouchEndOrCancel, { passive: true });
canvas.addEventListener('touchcancel', handleTouchEndOrCancel, { passive: true });

function loop(now) {
  if (!gs.renderingActive) {
    gs.rafId = null;
    return;
  }

  const rawDt = gs.lastTime > 0 ? (now - gs.lastTime) / 1000 : FIXED_DT;
  const dt = Math.min(MAX_FRAME_DT, Math.max(0, rawDt));
  gs.lastTime = now;
  gs.frameCount += 1;
  gs.lastDt = dt;

  if (gs.state === 'playing') {
    gs.maxDt = Math.max(gs.maxDt, dt);
    gs.accumulator += dt;
    let steps = 0;

    while (gs.accumulator >= FIXED_DT && steps < MAX_FIXED_STEPS) {
      snapshotPrevState(gs);
      stepPhysics(gs, FIXED_DT);
      gs.tickCount += 1;
      gs.accumulator -= FIXED_DT;
      steps += 1;

      if (gs.state !== 'playing') {
        gs.accumulator = 0;
        if (gs.state === 'gameover') {
          stopMusic();
          showGameOverOverlay(gs, gs.gameOverReason);
        } else if (gs.state === 'credits') {
          showCreditsOverlay();
          startEndingMusic();
        }
        break;
      }
    }

    if (steps >= MAX_FIXED_STEPS && gs.accumulator >= FIXED_DT) {
      gs.accumulator = 0;
    }

    syncHud(gs);
  } else if (gs.state === 'paused') {
    gs.accumulator = 0;
    snapshotPrevState(gs);
  } else {
    gs.accumulator = 0;
    snapshotPrevState(gs);
    stepIdleAnimation(gs, dt);
  }

  const alpha = gs.state === 'playing' ? gs.accumulator / FIXED_DT : 1;
  renderScene(ctx, gs, alpha);
  gs.rafId = requestAnimationFrame(loop);
}

function startLoop() {
  if (gs.rafId !== null) return;
  gs.renderingActive = true;
  gs.lastTime = performance.now();
  gs.accumulator = 0;
  gs.rafId = requestAnimationFrame(loop);
}

function stopLoop() {
  gs.renderingActive = false;
  if (gs.rafId !== null) {
    cancelAnimationFrame(gs.rafId);
    gs.rafId = null;
  }
}

if ('contentVisibility' in document.documentElement.style && stageShell) {
  stageShell.addEventListener('contentvisibilityautostatechange', (event) => {
    if (event.skipped) {
      if (gs.state === 'playing') togglePause();
      stopLoop();
    } else {
      startLoop();
    }
  });
} else if ('IntersectionObserver' in window && stageShell) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) startLoop();
        else {
          if (gs.state === 'playing') togglePause();
          stopLoop();
        }
      });
    },
    { rootMargin: '200px' }
  );
  observer.observe(stageShell);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearHeldInputs(gs);
    resetTouchTracking();
    if (gs.state === 'playing') togglePause();
    stopLoop();
  } else {
    startLoop();
  }
});

resetGame(gs);
syncHud(gs, true);
startLoop();
