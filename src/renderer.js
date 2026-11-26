import {
  CAM_DIST,
  FLAP_ANIM_DURATION,
  GANTRY_HALF_W,
  HIGH_GANTRY_MIN_Y,
  HIGH_GANTRY_TOP_Y,
  HURDLE_HALF_W,
  LANE_W,
  LOW_HURDLE_CLEAR_Y,
  LOW_HURDLE_HEIGHT,
  MAX_Z,
  RAMP_LEN,
  ROAD_NEAR_CLIP,
  ROOF_H,
  VEHICLE_HALF_W,
  VEHICLE_NEAR_CLIP,
  VEHICLE_SUPPORT_HALF_W,
  Z_NEAR_CLIP,
  clamp,
  lerp,
} from './constants.js';
import { getCampus, lerpCampus } from './campuses.js';
import { projectPoint } from './state.js';

const LANE_DIVIDERS = [-0.5, 0.5];
const CHASER_PALETTE = ['#4285f4', '#ea4335', '#fbbc05', '#34a853'];
const PETAL_COUNTS = 7;

const skyCache = { key: '', grad: null };
const fogCache = { key: '', grad: null };
const unitGradCache = new WeakMap();

function getUnitGradients(ctx) {
  let entry = unitGradCache.get(ctx);
  if (entry) return entry;

  const sunHalo = ctx.createRadialGradient(0, 0, 0.05, 0, 0, 1);
  sunHalo.addColorStop(0, 'rgba(255, 251, 235, 0.95)');
  sunHalo.addColorStop(0.32, 'rgba(254, 240, 138, 0.36)');
  sunHalo.addColorStop(1, 'rgba(254, 240, 138, 0)');

  const sparkleGlow = ctx.createRadialGradient(0, 0, 0.04, 0, 0, 1);
  sparkleGlow.addColorStop(0, 'rgba(168, 85, 247, 0.85)');
  sparkleGlow.addColorStop(0.5, 'rgba(66, 133, 244, 0.35)');
  sparkleGlow.addColorStop(1, 'rgba(66, 133, 244, 0)');

  const geminiAura = ctx.createRadialGradient(0, 0, 0.08, 0, 0, 1);
  geminiAura.addColorStop(0, 'rgba(232, 121, 249, 0.56)');
  geminiAura.addColorStop(0.55, 'rgba(66, 133, 244, 0.28)');
  geminiAura.addColorStop(1, 'rgba(251, 188, 5, 0)');

  const lampGlow = ctx.createRadialGradient(0, 0, 0.05, 0, 0, 1);
  lampGlow.addColorStop(0, 'rgba(254, 240, 138, 0.65)');
  lampGlow.addColorStop(0.45, 'rgba(251, 191, 36, 0.22)');
  lampGlow.addColorStop(1, 'rgba(251, 191, 36, 0)');

  const headlightHalo = ctx.createRadialGradient(0, 0, 0.05, 0, 0, 1);
  headlightHalo.addColorStop(0, 'rgba(254, 240, 138, 0.55)');
  headlightHalo.addColorStop(1, 'rgba(254, 240, 138, 0)');

  entry = { sunHalo, sparkleGlow, geminiAura, lampGlow, headlightHalo };
  unitGradCache.set(ctx, entry);
  return entry;
}

function drawUnitGlow(ctx, grad, x, y, r) {
  if (r <= 0.5) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(r, r);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function colorToRgba(col, alpha) {
  if (!col) return `rgba(226, 232, 240, ${alpha})`;
  if (col.startsWith('rgb(')) {
    return col.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  if (col.startsWith('#')) {
    const clean = col.slice(1);
    const full =
      clean.length === 3
        ? clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2]
        : clean;
    const num = parseInt(full, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }
  return col;
}

function drawFourPointStar(ctx, cx, cy, outerR, innerR, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  ctx.quadraticCurveTo(cx + innerR, cy - innerR, cx + outerR, cy);
  ctx.quadraticCurveTo(cx + innerR, cy + innerR, cx, cy + outerR);
  ctx.quadraticCurveTo(cx - innerR, cy + innerR, cx - outerR, cy);
  ctx.quadraticCurveTo(cx - innerR, cy - innerR, cx, cy - outerR);
  ctx.closePath();
  ctx.fill();
}

export function resizeViewport(canvas, gs) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvasW = Math.round(cssW * dpr);
  const canvasH = Math.round(cssH * dpr);

  if (canvas.width !== canvasW) canvas.width = canvasW;
  if (canvas.height !== canvasH) canvas.height = canvasH;

  gs.viewport.cssW = cssW;
  gs.viewport.cssH = cssH;
  gs.viewport.dpr = dpr;
  gs.viewport.canvasW = canvasW;
  gs.viewport.canvasH = canvasH;
  gs.viewport.focal = Math.min(cssW, cssH) * 0.84;
  gs.viewport.horizonY = cssH * 0.36;
  return true;
}

function fillQuad(ctx, p1, p2, p3, p4, color, strokeColor = null) {
  if (!p1 || !p2 || !p3 || !p4) return;
  ctx.beginPath();
  ctx.moveTo(p1.sx, p1.sy);
  ctx.lineTo(p2.sx, p2.sy);
  ctx.lineTo(p3.sx, p3.sy);
  ctx.lineTo(p4.sx, p4.sy);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawLandmarkSet(ctx, campus, W, horizonY, worldTime, alpha) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const lm = campus.landmark;

  if (lm === 'mv') {
    // Santa Cruz Mountains dual layers
    ctx.fillStyle = 'rgba(30, 58, 138, 0.28)';
    ctx.beginPath();
    ctx.moveTo(-110, horizonY);
    ctx.quadraticCurveTo(W * 0.18, horizonY - 64, W * 0.44, horizonY - 14);
    ctx.quadraticCurveTo(W * 0.72, horizonY - 74, W + 110, horizonY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(21, 128, 61, 0.32)';
    ctx.beginPath();
    ctx.moveTo(-90, horizonY);
    ctx.quadraticCurveTo(W * 0.3, horizonY - 34, W * 0.56, horizonY - 8);
    ctx.quadraticCurveTo(W * 0.8, horizonY - 40, W + 90, horizonY);
    ctx.closePath();
    ctx.fill();

    // Googleplex Bay View undulating canopy tents
    const bx = W * 0.1;
    const bw = W * 0.38;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.56)';
    ctx.beginPath();
    ctx.moveTo(bx, horizonY);
    ctx.quadraticCurveTo(bx + bw * 0.2, horizonY - 48, bx + bw * 0.42, horizonY - 22);
    ctx.quadraticCurveTo(bx + bw * 0.65, horizonY - 46, bx + bw * 0.85, horizonY - 20);
    ctx.quadraticCurveTo(bx + bw * 0.94, horizonY - 26, bx + bw, horizonY);
    ctx.closePath();
    ctx.fill();

    // Warm glass glow strips under canopies
    ctx.fillStyle = 'rgba(253, 224, 71, 0.42)';
    ctx.fillRect(bx + bw * 0.12, horizonY - 12, bw * 0.24, 5);
    ctx.fillRect(bx + bw * 0.52, horizonY - 11, bw * 0.28, 5);
  } else if (lm === 'london') {
    // Low Thames skyline silhouettes
    ctx.fillStyle = 'rgba(30, 41, 59, 0.38)';
    ctx.fillRect(-60, horizonY - 34, W + 120, 34);

    // Elizabeth Tower (Big Ben)
    const bx = W * 0.22;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
    ctx.fillRect(bx - 13, horizonY - 88, 26, 88);
    ctx.fillRect(bx - 16, horizonY - 96, 32, 18);
    ctx.beginPath();
    ctx.moveTo(bx - 14, horizonY - 96);
    ctx.lineTo(bx, horizonY - 126);
    ctx.lineTo(bx + 14, horizonY - 96);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(bx, horizonY - 84, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(bx, horizonY - 84);
    ctx.lineTo(bx, horizonY - 89);
    ctx.moveTo(bx, horizonY - 84);
    ctx.lineTo(bx + 4, horizonY - 84);
    ctx.stroke();

    // The Shard
    const sx = W * 0.44;
    ctx.fillStyle = 'rgba(30, 41, 59, 0.62)';
    ctx.beginPath();
    ctx.moveTo(sx - 18, horizonY);
    ctx.lineTo(sx - 1, horizonY - 132);
    ctx.lineTo(sx + 2, horizonY - 132);
    ctx.lineTo(sx + 18, horizonY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, horizonY - 130);
    ctx.lineTo(sx - 4, horizonY);
    ctx.stroke();

    // London Eye Ferris Wheel
    const ex = W * 0.68;
    const ey = horizonY - 46;
    const er = 40;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.58)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 10; k++) {
      const a = (k * Math.PI) / 5 + worldTime * 0.08;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + Math.cos(a) * er, ey + Math.sin(a) * er);
      ctx.stroke();
    }
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ex - 16, horizonY);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex + 16, horizonY);
    ctx.stroke();

    // The Gherkin
    const gx = W * 0.84;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.56)';
    ctx.beginPath();
    ctx.moveTo(gx - 12, horizonY);
    ctx.quadraticCurveTo(gx - 18, horizonY - 56, gx, horizonY - 88);
    ctx.quadraticCurveTo(gx + 18, horizonY - 56, gx + 12, horizonY);
    ctx.closePath();
    ctx.fill();
  } else if (lm === 'zurich') {
    // Jagged layered Swiss Alps
    ctx.fillStyle = 'rgba(30, 64, 175, 0.34)';
    ctx.beginPath();
    ctx.moveTo(-90, horizonY);
    ctx.lineTo(W * 0.14, horizonY - 84);
    ctx.lineTo(W * 0.3, horizonY - 28);
    ctx.lineTo(W * 0.54, horizonY - 106);
    ctx.lineTo(W * 0.74, horizonY - 36);
    ctx.lineTo(W * 0.9, horizonY - 82);
    ctx.lineTo(W + 90, horizonY);
    ctx.closePath();
    ctx.fill();

    // Faceted snow caps
    const peaks = [
      [W * 0.14, horizonY - 84],
      [W * 0.54, horizonY - 106],
      [W * 0.9, horizonY - 82],
    ];
    for (let i = 0; i < peaks.length; i++) {
      const [mx, my] = peaks[i];
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx - 24, my + 28);
      ctx.lineTo(mx - 2, my + 22);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(186, 230, 253, 0.58)';
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx - 2, my + 22);
      ctx.lineTo(mx + 22, my + 25);
      ctx.closePath();
      ctx.fill();
    }

    // Grossmunster twin towers
    const tx = W * 0.34;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.fillRect(tx - 18, horizonY - 56, 14, 56);
    ctx.fillRect(tx + 4, horizonY - 56, 14, 56);
    ctx.fillRect(tx - 6, horizonY - 32, 12, 32);
    ctx.beginPath();
    ctx.arc(tx - 11, horizonY - 56, 7, Math.PI, 0);
    ctx.arc(tx + 11, horizonY - 56, 7, Math.PI, 0);
    ctx.fill();

    // Lake Zurich shimmer strip
    ctx.fillStyle = 'rgba(14, 165, 233, 0.35)';
    ctx.fillRect(-80, horizonY - 6, W + 160, 6);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    for (let i = 0; i < 8; i++) {
      const gx = ((i * 145 + worldTime * 18) % (W + 120)) - 60;
      ctx.fillRect(gx, horizonY - 4, 22, 2);
    }
  } else if (lm === 'tokyo') {
    // Distant Tokyo skyline silhouettes
    ctx.fillStyle = 'rgba(30, 27, 75, 0.42)';
    const bldgs = [38, 54, 42, 30, 48, 62, 44];
    for (let i = 0; i < bldgs.length; i++) {
      const bx = W * (0.04 + i * 0.14);
      ctx.fillRect(bx, horizonY - bldgs[i], W * 0.055, bldgs[i]);
    }

    // 5-tier Pagoda
    const pgx = W * 0.16;
    ctx.fillStyle = 'rgba(49, 46, 129, 0.72)';
    for (let tier = 0; tier < 5; tier++) {
      const ty = horizonY - 14 - tier * 13;
      const tw = 34 - tier * 4;
      ctx.fillRect(pgx - tw * 0.35, ty, tw * 0.7, 13);
      ctx.beginPath();
      ctx.moveTo(pgx - tw * 0.65, ty + 2);
      ctx.lineTo(pgx, ty - 6);
      ctx.lineTo(pgx + tw * 0.65, ty + 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(pgx - 1.5, horizonY - 82, 3, 16);

    // Symmetrical Mt. Fuji with jagged snow cap
    const fx = W * 0.4;
    ctx.fillStyle = 'rgba(49, 46, 129, 0.56)';
    ctx.beginPath();
    ctx.moveTo(fx - W * 0.24, horizonY);
    ctx.lineTo(fx - 18, horizonY - 98);
    ctx.lineTo(fx + 18, horizonY - 98);
    ctx.lineTo(fx + W * 0.24, horizonY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.beginPath();
    ctx.moveTo(fx - 18, horizonY - 98);
    ctx.lineTo(fx + 18, horizonY - 98);
    ctx.lineTo(fx + 44, horizonY - 72);
    ctx.lineTo(fx + 18, horizonY - 79);
    ctx.lineTo(fx, horizonY - 70);
    ctx.lineTo(fx - 18, horizonY - 79);
    ctx.lineTo(fx - 44, horizonY - 72);
    ctx.closePath();
    ctx.fill();

    // Tokyo Tower red/white lattice spire
    const ttx = W * 0.76;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.78)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ttx - 22, horizonY);
    ctx.lineTo(ttx - 4, horizonY - 82);
    ctx.lineTo(ttx + 4, horizonY - 82);
    ctx.lineTo(ttx + 22, horizonY);
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(ttx - 9, horizonY - 46, 18, 8);
    ctx.fillRect(ttx - 6, horizonY - 84, 12, 6);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(ttx, horizonY - 84);
    ctx.lineTo(ttx, horizonY - 124);
    ctx.stroke();
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(ttx, horizonY - 125, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (lm === 'nyc') {
    // Midrise Manhattan backdrop
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    const rects = [
      [0.05, 52, 0.06],
      [0.12, 72, 0.05],
      [0.32, 64, 0.07],
      [0.44, 58, 0.06],
      [0.67, 74, 0.06],
      [0.88, 56, 0.07],
    ];
    for (let i = 0; i < rects.length; i++) {
      const [rx, rh, rw] = rects[i];
      ctx.fillRect(W * rx, horizonY - rh, W * rw, rh);
    }

    // One World Trade Center
    const wtcX = W * 0.2;
    ctx.fillStyle = 'rgba(30, 41, 59, 0.72)';
    ctx.beginPath();
    ctx.moveTo(wtcX - 18, horizonY);
    ctx.lineTo(wtcX - 11, horizonY - 104);
    ctx.lineTo(wtcX + 11, horizonY - 104);
    ctx.lineTo(wtcX + 18, horizonY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.7)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(wtcX, horizonY - 104);
    ctx.lineTo(wtcX, horizonY - 134);
    ctx.stroke();

    // Empire State Building
    const esbX = W * 0.56;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.74)';
    ctx.fillRect(esbX - 20, horizonY - 54, 40, 54);
    ctx.fillRect(esbX - 14, horizonY - 88, 28, 34);
    ctx.fillRect(esbX - 8, horizonY - 104, 16, 16);
    ctx.fillStyle = '#fde047';
    ctx.fillRect(esbX - 2, horizonY - 128, 4, 24);

    // Chrysler Building sunburst crown
    const cbX = W * 0.8;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
    ctx.fillRect(cbX - 14, horizonY - 76, 28, 76);
    ctx.beginPath();
    ctx.arc(cbX, horizonY - 76, 13, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cbX - 6, horizonY - 86);
    ctx.lineTo(cbX, horizonY - 114);
    ctx.lineTo(cbX + 6, horizonY - 86);
    ctx.closePath();
    ctx.fill();

    // Warm window glints on NYC towers
    ctx.fillStyle = 'rgba(253, 224, 71, 0.45)';
    for (let r = 0; r < 5; r++) {
      ctx.fillRect(esbX - 9, horizonY - 80 + r * 14, 18, 2);
      ctx.fillRect(cbX - 8, horizonY - 68 + r * 12, 16, 2);
    }
  } else if (lm === 'sydney') {
    // Sydney Harbour Bridge double-chord arch & stone pylons
    const bx = W * 0.24;
    ctx.fillStyle = 'rgba(51, 65, 85, 0.65)';
    ctx.fillRect(bx - 92, horizonY - 56, 14, 56);
    ctx.fillRect(bx + 78, horizonY - 56, 14, 56);

    ctx.strokeStyle = 'rgba(30, 41, 59, 0.68)';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(bx, horizonY + 14, 88, Math.PI * 1.14, Math.PI * 1.86);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, horizonY + 26, 86, Math.PI * 1.16, Math.PI * 1.84);
    ctx.stroke();

    // Vertical suspender cables + deck
    ctx.lineWidth = 1.2;
    for (let k = -5; k <= 5; k++) {
      const kx = bx + k * 14;
      const archY = horizonY + 14 - Math.sqrt(Math.max(0, 88 * 88 - (k * 14) * (k * 14)));
      ctx.beginPath();
      ctx.moveTo(kx, archY);
      ctx.lineTo(kx, horizonY - 16);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.fillRect(bx - 96, horizonY - 18, 192, 5);

    // Sydney Opera House 4 vaulted shell sails
    const ox = W * 0.68;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    const sails = [
      [0, 46, 32],
      [22, 54, 34],
      [48, 42, 30],
      [72, 32, 24],
    ];
    for (let i = 0; i < sails.length; i++) {
      const [dx, sh, sw] = sails[i];
      ctx.beginPath();
      ctx.moveTo(ox + dx, horizonY - 4);
      ctx.quadraticCurveTo(ox + dx + sw * 0.35, horizonY - sh, ox + dx + sw, horizonY - 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Animated harbor water shimmer glints
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    for (let i = 0; i < 8; i++) {
      const sx = ((i * 150 + worldTime * 22) % (W + 100)) - 50;
      ctx.fillRect(sx, horizonY - 3, 24, 2);
    }
  } else if (lm === 'waymo') {
    // Desert twilight mesas + Phoenix/SF neon skyline + pulsing cyan LiDAR scan rings
    ctx.fillStyle = 'rgba(30, 27, 75, 0.62)';
    ctx.beginPath();
    ctx.moveTo(-80, horizonY);
    ctx.lineTo(W * 0.1, horizonY - 46);
    ctx.lineTo(W * 0.24, horizonY - 46);
    ctx.lineTo(W * 0.34, horizonY - 12);
    ctx.lineTo(W * 0.72, horizonY - 16);
    ctx.lineTo(W * 0.82, horizonY - 58);
    ctx.lineTo(W * 0.94, horizonY - 58);
    ctx.lineTo(W + 80, horizonY);
    ctx.closePath();
    ctx.fill();

    // Expanding cyan LiDAR rings across the twilight sky
    for (let r = 0; r < 3; r++) {
      const phase = (worldTime * 0.45 + r * 0.33) % 1;
      const rad = 28 + phase * W * 0.36;
      ctx.strokeStyle = `rgba(0, 229, 255, ${(1 - phase) * 0.45})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(W * 0.5, horizonY + 8, rad, Math.PI, 0);
      ctx.stroke();
    }
  } else if (lm === 'quantum') {
    // Iconic hanging Golden Quantum Chandelier Dilution Refrigerators!
    const chandXs = [W * 0.22, W * 0.5, W * 0.78];
    for (let i = 0; i < chandXs.length; i++) {
      const cx = chandXs[i];
      const scale = i === 1 ? 1.15 : 0.85;
      // Glowing cyan halo behind cryostat
      ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.beginPath();
      ctx.arc(cx, horizonY - 58 * scale, 48 * scale, 0, Math.PI * 2);
      ctx.fill();
      // Vertical golden coaxial cables
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
      ctx.lineWidth = 1.5;
      for (let c = -2; c <= 2; c++) {
        ctx.beginPath();
        ctx.moveTo(cx + c * 7 * scale, 0);
        ctx.lineTo(cx + c * 5 * scale, horizonY - 22 * scale);
        ctx.stroke();
      }
      // 4 tiered gleaming golden cryostat plates
      const tiers = [
        [horizonY - 94 * scale, 34 * scale],
        [horizonY - 72 * scale, 28 * scale],
        [horizonY - 50 * scale, 22 * scale],
        [horizonY - 30 * scale, 15 * scale],
      ];
      for (let t = 0; t < tiers.length; t++) {
        const [ty, tw] = tiers[t];
        ctx.fillStyle = t % 2 === 0 ? '#f59e0b' : '#fde68a';
        ctx.beginPath();
        ctx.roundRect(cx - tw, ty, tw * 2, 7 * scale, 3);
        ctx.fill();
      }
      // Pulsing Willow QPU chip core at tip
      const pulse = 0.6 + 0.4 * Math.sin(worldTime * 5 + i);
      ctx.fillStyle = `rgba(56, 189, 248, ${pulse})`;
      ctx.beginPath();
      ctx.arc(cx, horizonY - 16 * scale, 6 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (lm === 'tpu') {
    // Hyperscale Data Center Bay + Iconic 4-Color Google Cooling Pipes Overhead!
    const pipeColors = ['#4285f4', '#ea4335', '#fbbc05', '#34a853'];
    for (let i = 0; i < pipeColors.length; i++) {
      const py = horizonY - 88 + i * 13;
      ctx.fillStyle = pipeColors[i];
      ctx.fillRect(-100, py, W + 200, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(-100, py + 1, W + 200, 2);
    }
    // Distant server-hall support bays with blinking status LEDs
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    for (let b = 0; b < 7; b++) {
      const bx = W * (0.04 + b * 0.145);
      ctx.fillRect(bx, horizonY - 38, W * 0.09, 38);
      ctx.fillStyle = (Math.floor(worldTime * 4) + b) % 2 === 0 ? '#22c55e' : '#38bdf8';
      ctx.fillRect(bx + 6, horizonY - 28, 6, 3);
      ctx.fillRect(bx + 18, horizonY - 20, 6, 3);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    }
  } else if (lm === 'loon') {
    // Edge of Space: Starry Stratosphere + Glowing Curved Blue Earth Limb + Giant Loon Balloons!
    for (let s = 0; s < 48; s++) {
      const sx = ((s * 97.3) % 1) * W;
      const sy = ((s * 53.7) % 1) * (horizonY * 0.8);
      const tw = 0.4 + 0.6 * Math.sin(worldTime * 2.4 + s);
      ctx.fillStyle = `rgba(255,255,255,${tw.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, s % 5 === 0 ? 1.8 : 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    // Curved glowing Earth atmosphere arc
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(W * 0.5, horizonY + W * 1.15, W * 1.16, Math.PI * 1.38, Math.PI * 1.62);
    ctx.stroke();

    // 4 Giant Translucent Jellyfish Project Loon Balloons drifting in the stratosphere
    const balloons = [
      [0.16, 0.42, 22],
      [0.39, 0.30, 28],
      [0.66, 0.36, 25],
      [0.86, 0.48, 19],
    ];
    for (let i = 0; i < balloons.length; i++) {
      const [bxF, byF, br] = balloons[i];
      const bx = W * bxF + Math.sin(worldTime * 0.5 + i) * 14;
      const by = horizonY * byF + Math.cos(worldTime * 0.7 + i) * 6;
      // Translucent envelope
      ctx.fillStyle = 'rgba(224, 242, 254, 0.42)';
      ctx.strokeStyle = 'rgba(244, 114, 182, 0.65)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(bx, by, br, br * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Tether + tiny solar gondola
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, by + br * 0.82);
      ctx.lineTo(bx, by + br * 1.45);
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(bx - 6, by + br * 1.45, 12, 4);
    }
  } else if (lm === 'wing') {
    // Bright Suburban Rooftop Skyline + Drone Landing Pads + Distant Parachuting Coffee Parcels
    ctx.fillStyle = 'rgba(51, 65, 85, 0.45)';
    for (let h = 0; h < 9; h++) {
      const hx = W * (0.02 + h * 0.115);
      const hh = 24 + (h % 3) * 14;
      ctx.fillRect(hx, horizonY - hh, W * 0.08, hh);
      // Yellow rooftop drone landing pad bar
      ctx.fillStyle = '#fbbc05';
      ctx.fillRect(hx + 6, horizonY - hh - 3, W * 0.08 - 12, 3);
      ctx.fillStyle = 'rgba(51, 65, 85, 0.45)';
    }
    // 3 distant Wing drones cruising across the sky with little dangling packages
    for (let d = 0; d < 3; d++) {
      const dx = ((d * 340 + worldTime * (45 + d * 12)) % (W + 140)) - 70;
      const dy = horizonY * (0.28 + d * 0.16);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(dx - 14, dy, 28, 4);
      ctx.fillStyle = '#fbbc05';
      ctx.fillRect(dx - 4, dy + 4, 8, 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.moveTo(dx, dy + 8);
      ctx.lineTo(dx, dy + 17);
      ctx.stroke();
      ctx.fillStyle = '#ea4335';
      ctx.fillRect(dx - 3, dy + 17, 6, 6);
    }
  } else if (lm === 'deepmind') {
    // Glass Conservatory Arches + Glowing 3D AlphaFold Folded Protein Ribbons!
    ctx.strokeStyle = 'rgba(103, 232, 249, 0.35)';
    ctx.lineWidth = 2;
    for (let a = 0; a < 4; a++) {
      const ax = W * (0.14 + a * 0.24);
      ctx.beginPath();
      ctx.arc(ax, horizonY, 64, Math.PI, 0);
      ctx.stroke();
    }
    // Floating AlphaFold multicolored folded protein helix across the sky
    const ribbonColors = ['#22d3ee', '#a855f7', '#fbbc05'];
    for (let c = 0; c < ribbonColors.length; c++) {
      ctx.strokeStyle = ribbonColors[c];
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 22) {
        const y = horizonY * 0.52 + Math.sin(x * 0.018 + worldTime * 1.6 + c * 2.1) * 26;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawSkyAndLandmarks(ctx, c, fromCampus, targetCampus, transition, camX, worldTime, vp) {
  const W = vp.cssW;
  const H = vp.cssH;
  const horizonY = vp.horizonY;
  const pad = Math.max(120, Math.ceil(Math.max(W, H) * 0.12));
  const grads = getUnitGradients(ctx);

  const skyKey = `${W}|${H}|${horizonY}|${c.skyTop}|${c.skyMid}|${c.skyBot}`;
  if (skyCache.key !== skyKey) {
    const sky = ctx.createLinearGradient(0, -pad, 0, horizonY + 14);
    sky.addColorStop(0, c.skyTop);
    sky.addColorStop(0.65, c.skyMid);
    sky.addColorStop(1, c.skyBot);
    skyCache.key = skyKey;
    skyCache.grad = sky;
  }
  ctx.fillStyle = skyCache.grad;
  ctx.fillRect(-pad, -pad, W + pad * 2, horizonY + 14 + pad);

  const sunX = W * 0.78 - camX * 6;
  const sunY = horizonY * 0.42;
  drawUnitGlow(ctx, grads.sunHalo, sunX, sunY, W * 0.14);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  for (let i = 0; i < 5; i++) {
    const cx = ((i * 230 + worldTime * (8 + i * 2) - camX * 12) % (W + 240)) - 120;
    const cy = horizonY * (0.2 + (i % 3) * 0.18);
    ctx.beginPath();
    ctx.ellipse(cx, cy, 62, 16, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 28, cy - 8, 38, 14, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const px = -camX * 14;
  const u = transition >= 1 ? 1 : transition * transition * (3 - 2 * transition);
  ctx.save();
  ctx.translate(px, 0);
  if (u < 1 && fromCampus && fromCampus.id !== targetCampus.id) {
    drawLandmarkSet(ctx, fromCampus, W, horizonY, worldTime, 1 - u);
    drawLandmarkSet(ctx, targetCampus, W, horizonY, worldTime, u);
  } else {
    drawLandmarkSet(ctx, targetCampus, W, horizonY, worldTime, 1);
  }
  ctx.restore();

  // Dual-side groundLeft / groundRight split cleanly down road centerline
  const hx = W * 0.5 - camX * (vp.focal / (MAX_Z + CAM_DIST));
  const nearScale = vp.focal / (ROAD_NEAR_CLIP + CAM_DIST);
  const nx = W * 0.5 - camX * nearScale;
  const nearSy = horizonY - (0 - 4.0) * nearScale;
  const denom = Math.max(12, nearSy - horizonY);
  const bx = hx + ((nx - hx) / denom) * (H + pad - horizonY);

  ctx.fillStyle = c.groundLeft;
  ctx.beginPath();
  ctx.moveTo(-pad, horizonY);
  ctx.lineTo(hx, horizonY);
  ctx.lineTo(bx, H + pad);
  ctx.lineTo(-pad, H + pad);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = c.groundRight;
  ctx.beginPath();
  ctx.moveTo(hx, horizonY);
  ctx.lineTo(W + pad, horizonY);
  ctx.lineTo(W + pad, H + pad);
  ctx.lineTo(bx, H + pad);
  ctx.closePath();
  ctx.fill();

  // Atmospheric horizon haze band
  const fogKey = `${horizonY}|${c.fogColor}`;
  if (fogCache.key !== fogKey) {
    const fg = ctx.createLinearGradient(0, horizonY - 22, 0, horizonY + 38);
    fg.addColorStop(0, colorToRgba(c.fogColor, 0));
    fg.addColorStop(0.38, colorToRgba(c.fogColor, 0.52));
    fg.addColorStop(1, colorToRgba(c.fogColor, 0));
    fogCache.key = fogKey;
    fogCache.grad = fg;
  }
  ctx.fillStyle = fogCache.grad;
  ctx.fillRect(-pad, horizonY - 22, W + pad * 2, 60);
}

function drawRoad(ctx, c, roadScroll, camX, camY, vp) {
  const proj = (wx, wy, wz) => projectPoint(wx, wy, wz, camX, camY, vp);
  const roadHalfW = LANE_W * 1.55;
  const curbW = 0.42;
  const shoulderW = 1.35;
  const nearClip = ROAD_NEAR_CLIP;

  const baseFL = proj(-roadHalfW, 0, MAX_Z);
  const baseFR = proj(roadHalfW, 0, MAX_Z);
  const baseNL = proj(-roadHalfW, 0, nearClip);
  const baseNR = proj(roadHalfW, 0, nearClip);
  fillQuad(ctx, baseFL, baseFR, baseNR, baseNL, c.roadColor);

  const clTopF = proj(-roadHalfW - curbW, 0.14, MAX_Z);
  const clTopN = proj(-roadHalfW - curbW, 0.14, nearClip);
  const crTopF = proj(roadHalfW + curbW, 0.14, MAX_Z);
  const crTopN = proj(roadHalfW + curbW, 0.14, nearClip);

  // Outer 3D shoulder bevels
  const shLF = proj(-roadHalfW - curbW - shoulderW, 0.02, MAX_Z);
  const shLN = proj(-roadHalfW - curbW - shoulderW, 0.02, nearClip);
  const shRF = proj(roadHalfW + curbW + shoulderW, 0.02, MAX_Z);
  const shRN = proj(roadHalfW + curbW + shoulderW, 0.02, nearClip);
  fillQuad(ctx, shLF, clTopF, clTopN, shLN, 'rgba(15, 23, 42, 0.34)');
  fillQuad(ctx, crTopF, shRF, shRN, crTopN, 'rgba(15, 23, 42, 0.34)');

  // Curb base
  fillQuad(ctx, clTopF, baseFL, baseNL, clTopN, c.curbB);
  fillQuad(ctx, baseFR, crTopF, crTopN, baseNR, c.curbB);

  const segStep = 8;
  const period = segStep * 2;
  const offset = roadScroll % period;

  for (let z = MAX_Z + period - offset; z >= nearClip - segStep; z -= period) {
    const zFar = Math.min(MAX_Z, z);
    const zNear = Math.max(nearClip, z - segStep);
    if (zFar <= zNear) continue;

    const fl = proj(-roadHalfW, 0, zFar);
    const fr = proj(roadHalfW, 0, zFar);
    const nl = proj(-roadHalfW, 0, zNear);
    const nr = proj(roadHalfW, 0, zNear);
    if (!fl || !fr || !nl || !nr) continue;

    fillQuad(ctx, fl, fr, nr, nl, c.roadAlt);

    const flTop = proj(-roadHalfW, 0.14, zFar);
    const nlTop = proj(-roadHalfW, 0.14, zNear);
    const clFar = proj(-roadHalfW - curbW, 0.14, zFar);
    const clNear = proj(-roadHalfW - curbW, 0.14, zNear);
    fillQuad(ctx, clFar, flTop, nlTop, clNear, c.curbA);
    fillQuad(ctx, flTop, fl, nl, nlTop, 'rgba(15, 23, 42, 0.38)');

    const frTop = proj(roadHalfW, 0.14, zFar);
    const nrTop = proj(roadHalfW, 0.14, zNear);
    const crFar = proj(roadHalfW + curbW, 0.14, zFar);
    const crNear = proj(roadHalfW + curbW, 0.14, zNear);
    fillQuad(ctx, frTop, crFar, crNear, nrTop, c.curbA);
    fillQuad(ctx, fr, frTop, nrTop, nr, 'rgba(15, 23, 42, 0.38)');

    const dashFar = Math.min(MAX_Z, z - 1.2);
    const dashNear = Math.max(nearClip, z - segStep + 1.8);
    if (dashFar > dashNear) {
      const dw = 0.08;
      for (let d = 0; d < LANE_DIVIDERS.length; d++) {
        const lx = LANE_DIVIDERS[d] * LANE_W;
        fillQuad(
          ctx,
          proj(lx - dw, 0.02, dashFar),
          proj(lx + dw, 0.02, dashFar),
          proj(lx + dw, 0.02, dashNear),
          proj(lx - dw, 0.02, dashNear),
          'rgba(248, 250, 252, 0.6)'
        );
      }
    }
  }
}

function drawPropType(ctx, propType, side, base, top, s, worldTime, alpha) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const grads = getUnitGradients(ctx);

  if (propType === 'lamp') {
    const armX = top.sx - side * s * 0.48;
    const armY = top.sy + s * 0.1;
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = Math.max(1.8, s * 0.14);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(base.sx, base.sy);
    ctx.lineTo(top.sx, top.sy + s * 0.35);
    ctx.quadraticCurveTo(top.sx, top.sy - s * 0.08, armX, armY);
    ctx.stroke();

    drawUnitGlow(ctx, grads.lampGlow, armX, armY + s * 0.08, Math.max(5, s * 0.9));
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(armX, armY + s * 0.06, Math.max(2, s * 0.18), 0, Math.PI * 2);
    ctx.fill();
  } else if (propType === 'palm') {
    const curveX = top.sx - side * s * 0.32;
    const crownY = top.sy + s * 0.55;
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = Math.max(2, s * 0.22);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(base.sx, base.sy);
    ctx.quadraticCurveTo(base.sx - side * s * 0.1, (base.sy + crownY) * 0.5, curveX, crownY);
    ctx.stroke();

    // 6 feathered fronds
    ctx.fillStyle = '#16a34a';
    for (let f = 0; f < 6; f++) {
      const ang = -Math.PI * 0.92 + f * (Math.PI * 0.36);
      const fx = curveX + Math.cos(ang) * s * 1.15;
      const fy = crownY + Math.sin(ang) * s * 0.65 + s * 0.24;
      ctx.beginPath();
      ctx.moveTo(curveX, crownY);
      ctx.quadraticCurveTo(
        curveX + Math.cos(ang) * s * 0.65,
        crownY + Math.sin(ang) * s * 0.55 - s * 0.18,
        fx,
        fy
      );
      ctx.quadraticCurveTo(
        curveX + Math.cos(ang) * s * 0.5,
        crownY + Math.sin(ang) * s * 0.35 + s * 0.12,
        curveX,
        crownY
      );
      ctx.fill();
    }
  } else if (propType === 'pine') {
    ctx.strokeStyle = '#5c3a21';
    ctx.lineWidth = Math.max(2, s * 0.24);
    ctx.beginPath();
    ctx.moveTo(base.sx, base.sy);
    ctx.lineTo(top.sx, top.sy + s * 1.2);
    ctx.stroke();

    // 3-tiered evergreen triangles
    const tiers = [
      [top.sy + s * 2.25, s * 1.15, '#14532d'],
      [top.sy + s * 1.45, s * 0.92, '#15803d'],
      [top.sy + s * 0.72, s * 0.68, '#16a34a'],
    ];
    for (let t = 0; t < tiers.length; t++) {
      const [ty, tw, col] = tiers[t];
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(top.sx, ty - s * 1.05);
      ctx.lineTo(top.sx - tw, ty);
      ctx.lineTo(top.sx + tw, ty);
      ctx.closePath();
      ctx.fill();
    }
  } else if (propType === 'lidar' || propType === 'antenna') {
    // Sleek cyber-pole with pulsing cyan/magenta sensor beacon
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = Math.max(1.8, s * 0.14);
    ctx.beginPath();
    ctx.moveTo(base.sx, base.sy);
    ctx.lineTo(top.sx, top.sy + s * 0.2);
    ctx.stroke();
    const col = propType === 'lidar' ? '#00e5ff' : '#f472b6';
    const pulseR = s * (0.28 + ((worldTime * 1.5) % 0.6));
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1.2, s * 0.04);
    ctx.beginPath();
    ctx.arc(top.sx, top.sy + s * 0.2, pulseR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(top.sx, top.sy + s * 0.2, Math.max(2, s * 0.18), 0, Math.PI * 2);
    ctx.fill();
  } else if (propType === 'cryo' || propType === 'helix') {
    // Golden Cryo-Pylon / Iridescent AlphaFold Helix Tower
    ctx.strokeStyle = propType === 'cryo' ? '#f59e0b' : '#22d3ee';
    ctx.lineWidth = Math.max(2, s * 0.16);
    ctx.beginPath();
    ctx.moveTo(base.sx, base.sy);
    ctx.lineTo(top.sx, top.sy + s * 0.4);
    ctx.stroke();
    ctx.strokeStyle = propType === 'cryo' ? '#38bdf8' : '#a855f7';
    ctx.lineWidth = Math.max(1.4, s * 0.08);
    for (let k = 0; k < 3; k++) {
      const ry = base.sy - (base.sy - top.sy) * (0.25 + k * 0.24);
      ctx.beginPath();
      ctx.ellipse(top.sx, ry, Math.max(3, s * 0.36), Math.max(1.5, s * 0.12), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (propType === 'pipe') {
    // Vertical 4-color Google Data Center cooling pipe column
    const cols = ['#4285f4', '#ea4335', '#fbbc05', '#34a853'];
    const pw = Math.max(1.8, s * 0.11);
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = cols[k];
      ctx.fillRect(top.sx + (k - 1.5) * pw * 1.15, top.sy, pw, base.sy - top.sy);
    }
  } else if (propType === 'pad') {
    // Wing elevated rooftop drone landing beacon
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = Math.max(2, s * 0.16);
    ctx.beginPath();
    ctx.moveTo(base.sx, base.sy);
    ctx.lineTo(top.sx, top.sy + s * 1.1);
    ctx.stroke();
    ctx.fillStyle = '#fbbc05';
    ctx.beginPath();
    ctx.ellipse(top.sx, top.sy + s * 1.1, Math.max(4, s * 0.65), Math.max(2, s * 0.22), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.stroke();
  } else {
    // sakura
    const forkY = top.sy + s * 1.25;
    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = Math.max(2, s * 0.22);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(base.sx, base.sy);
    ctx.lineTo(top.sx, forkY);
    ctx.moveTo(top.sx, forkY);
    ctx.lineTo(top.sx - s * 0.45, top.sy + s * 0.7);
    ctx.moveTo(top.sx, forkY);
    ctx.lineTo(top.sx + s * 0.48, top.sy + s * 0.8);
    ctx.stroke();

    // Layered blossom puffs
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.arc(top.sx - s * 0.42, top.sy + s * 0.75, Math.max(2.5, s * 0.66), 0, Math.PI * 2);
    ctx.arc(top.sx + s * 0.45, top.sy + s * 0.82, Math.max(2.5, s * 0.62), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fbcfe8';
    ctx.beginPath();
    ctx.arc(top.sx, top.sy + s * 0.55, Math.max(3, s * 0.82), 0, Math.PI * 2);
    ctx.fill();

    // Deterministic drifting petals
    if (s > 10) {
      ctx.fillStyle = 'rgba(249, 168, 212, 0.85)';
      for (let k = 0; k < PETAL_COUNTS; k++) {
        const phase = worldTime * 1.8 + k * 1.1;
        const px = top.sx + Math.sin(phase) * s * 0.9;
        const py = top.sy + s * (0.7 + ((phase * 0.35) % 1.8));
        ctx.beginPath();
        ctx.ellipse(px, py, Math.max(1.2, s * 0.06), Math.max(0.8, s * 0.035), phase, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.restore();
}

function drawRoadProp(ctx, prop, pz, fromCampus, targetCampus, transition, camX, camY, vp, worldTime) {
  const x = prop.side * (LANE_W * 2.25);
  const base = projectPoint(x, 0, pz, camX, camY, vp);
  const top = projectPoint(x, 4.4, pz, camX, camY, vp);
  if (!base || !top) return;

  const fogAlpha = pz > MAX_Z - 30 ? clamp((MAX_Z - pz) / 30, 0, 1) : 1;
  if (fogAlpha <= 0.01) return;

  const s = base.scale;
  const u = transition >= 1 ? 1 : transition * transition * (3 - 2 * transition);
  if (u < 1 && fromCampus && fromCampus.propType !== targetCampus.propType) {
    drawPropType(ctx, fromCampus.propType, prop.side, base, top, s, worldTime, (1 - u) * fogAlpha);
    drawPropType(ctx, targetCampus.propType, prop.side, base, top, s, worldTime, u * fogAlpha);
  } else {
    drawPropType(ctx, targetCampus.propType, prop.side, base, top, s, worldTime, fogAlpha);
  }
}

function drawGroundShadows(ctx, gs, alpha, roofCollectibleIds, camX, camY, vp) {
  const proj = (wx, wy, wz) => projectPoint(wx, wy, wz, camX, camY, vp);

  // Road props shadows
  ctx.fillStyle = 'rgba(2, 6, 23, 0.24)';
  for (let i = 0; i < gs.roadProps.length; i++) {
    const rp = gs.roadProps[i];
    const pz = lerp(rp.prevZ, rp.z, alpha);
    if (pz > MAX_Z || pz < ROAD_NEAR_CLIP) continue;
    const sp = proj(rp.side * LANE_W * 2.25, 0.015, pz);
    if (!sp) continue;
    ctx.beginPath();
    ctx.ellipse(sp.sx, sp.sy, Math.max(2, sp.scale * 0.72), Math.max(1, sp.scale * 0.24), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Obstacles ground shadows
  for (let i = 0; i < gs.obstacles.length; i++) {
    const o = gs.obstacles[i];
    if (o.smashed) continue;
    const ozStart = lerp(o.prevZStart, o.zStart, alpha);
    const ozEnd = lerp(o.prevZEnd, o.zEnd, alpha);
    const zNear = Math.max(VEHICLE_NEAR_CLIP, ozStart);
    const zFar = Math.min(MAX_Z, ozEnd);
    if (zFar <= zNear || zNear > MAX_Z) continue;
    const cx = o.lane * LANE_W;

    if (o.type === 'vehicle') {
      const hw = VEHICLE_HALF_W;
      fillQuad(
        ctx,
        proj(cx - hw * 1.16, 0.015, zFar),
        proj(cx + hw * 1.16, 0.015, zFar),
        proj(cx + hw * 1.16, 0.015, zNear),
        proj(cx - hw * 1.16, 0.015, zNear),
        'rgba(2, 6, 23, 0.42)'
      );
      if (o.hasRamp && ozStart > VEHICLE_NEAR_CLIP) {
        const rNear = Math.max(VEHICLE_NEAR_CLIP, ozStart - RAMP_LEN);
        if (ozStart > rNear) {
          fillQuad(
            ctx,
            proj(cx - hw * 1.02, 0.015, ozStart),
            proj(cx + hw * 1.02, 0.015, ozStart),
            proj(cx + hw * 0.96, 0.015, rNear),
            proj(cx - hw * 0.96, 0.015, rNear),
            'rgba(2, 6, 23, 0.28)'
          );
        }
      }
    } else if (o.type === 'low') {
      const hw = HURDLE_HALF_W;
      const szN = Math.max(VEHICLE_NEAR_CLIP, ozStart - 0.22);
      const szF = Math.min(MAX_Z, ozEnd + 0.22);
      fillQuad(
        ctx,
        proj(cx - hw * 1.04, 0.015, szF),
        proj(cx + hw * 1.04, 0.015, szF),
        proj(cx + hw * 1.04, 0.015, szN),
        proj(cx - hw * 1.04, 0.015, szN),
        'rgba(2, 6, 23, 0.34)'
      );
    } else if (o.type === 'high') {
      const hw = GANTRY_HALF_W;
      const szN = Math.max(VEHICLE_NEAR_CLIP, ozStart - 0.28);
      const szF = Math.min(MAX_Z, ozEnd + 0.28);
      fillQuad(
        ctx,
        proj(cx - hw * 1.02, 0.015, szF),
        proj(cx + hw * 1.02, 0.015, szF),
        proj(cx + hw * 1.02, 0.015, szN),
        proj(cx - hw * 1.02, 0.015, szN),
        'rgba(2, 6, 23, 0.28)'
      );
      ctx.fillStyle = 'rgba(2, 6, 23, 0.38)';
      const pL = proj(cx - hw + 0.07, 0.018, zNear);
      const pR = proj(cx + hw - 0.07, 0.018, zNear);
      if (pL) {
        ctx.beginPath();
        ctx.ellipse(pL.sx, pL.sy, Math.max(2, pL.scale * 0.22), Math.max(1, pL.scale * 0.1), 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (pR) {
        ctx.beginPath();
        ctx.ellipse(pR.sx, pR.sy, Math.max(2, pR.scale * 0.22), Math.max(1, pR.scale * 0.1), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Non-roof collectibles ground shadows
  ctx.fillStyle = 'rgba(2, 6, 23, 0.30)';
  for (let i = 0; i < gs.collectibles.length; i++) {
    const col = gs.collectibles[i];
    if (col.collected || roofCollectibleIds.has(col.id)) continue;
    const cz = lerp(col.prevZ, col.z, alpha);
    if (cz > MAX_Z || cz < VEHICLE_NEAR_CLIP) continue;
    const cx = lerp(col.prevX, col.x, alpha);
    const cy = lerp(col.prevY, col.y, alpha);
    const sp = proj(cx, 0.02, cz);
    if (!sp) continue;
    const scale = Math.max(0.35, 1 - cy * 0.16);
    const rx = Math.max(2, sp.scale * (col.type === 'sparkle' ? 0.42 : 0.3) * scale);
    ctx.beginPath();
    ctx.ellipse(sp.sx, sp.sy, rx, rx * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player ground shadow (only when on ground; roof/ramp shadow renders after host vehicle)
  const groundY = lerp(gs.player.prevSupportY, gs.player.supportY, alpha);
  const px = lerp(gs.player.prevX, gs.player.x, alpha);
  const py = lerp(gs.player.prevY, gs.player.y, alpha);
  if (groundY < 0.2) {
    const sh = proj(px, 0.025, 0);
    if (sh) {
      const hDiff = Math.max(0, py - groundY);
      const shScale = Math.max(0.35, 1 - hDiff * 0.14);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
      ctx.beginPath();
      ctx.ellipse(sh.sx, sh.sy, sh.scale * 0.56 * shScale, sh.scale * 0.22 * shScale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Chaser ground shadow
  const chaseVis = Math.max(gs.player.stumbleTimer, gs.player.introChaseTimer);
  if (chaseVis > 0) {
    const closeness = Math.min(1, chaseVis / 2.2);
    const cz = -1.6 - (1 - closeness) * 2.2;
    const cSh = proj(px * 0.92, 0.02, cz);
    if (cSh) {
      ctx.fillStyle = 'rgba(2, 6, 23, 0.40)';
      ctx.beginPath();
      ctx.ellipse(cSh.sx, cSh.sy, cSh.scale * 0.38, cSh.scale * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawVehicleWheels(ctx, proj, cx, hw, zNear, zFar, sideSign) {
  const wheelZ1 = zNear + Math.min(2.2, (zFar - zNear) * 0.24);
  const wheelZ2 = zFar - Math.min(2.2, (zFar - zNear) * 0.24);
  const wheelX = cx + sideSign * (hw + 0.015);
  const zs = zFar - zNear > 4.5 ? [wheelZ1, wheelZ2] : [(zNear + zFar) * 0.5];
  for (let i = 0; i < zs.length; i++) {
    const wp = proj(wheelX, 0.22, zs[i]);
    if (!wp) continue;
    const r = Math.max(2, wp.scale * 0.24);
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.ellipse(wp.sx, wp.sy, r * 0.58, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.ellipse(wp.sx, wp.sy, r * 0.26, r * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawVehicle(ctx, o, ozStart, ozEnd, c, targetCampus, camX, camY, vp, gsCampusIdx) {
  if (o.smashed) return;
  const proj = (wx, wy, wz) => projectPoint(wx, wy, wz, camX, camY, vp);
  const nearClip = VEHICLE_NEAR_CLIP;
  const zNear = Math.max(nearClip, ozStart);
  const zFar = Math.min(MAX_Z, ozEnd);
  if (zFar <= zNear || zNear > MAX_Z) return;

  const fogAlpha = ozStart > MAX_Z - 30 ? clamp((MAX_Z - ozStart) / 30, 0.1, 1) : 1;
  const vehCampus = o.campusIdx != null ? getCampus(o.campusIdx) : targetCampus;
  const pal = o.campusIdx != null && o.campusIdx !== gsCampusIdx ? vehCampus : c;
  const model = vehCampus.id;

  const cx = o.lane * LANE_W;
  const hw = VEHICLE_HALF_W;
  const h = ROOF_H;
  const isOncoming = o.speedExtra > 0;
  const grads = getUnitGradients(ctx);

  const bodyCol = o.variant === 'alt' ? pal.vehAccent : pal.vehBody;
  const sideCol = pal.vehSide;
  const showLeftSide = camX < cx - hw;
  const showRightSide = camX > cx + hw;
  const sideSign = showLeftSide ? -1 : showRightSide ? 1 : 0;

  ctx.save();
  if (fogAlpha < 1) ctx.globalAlpha = fogAlpha;

  if (model === 'sydney') {
    // Sydney Harbor Ferry: waterline wake, emerald hull w/ brass portholes, inset white upper cabin
    const wakeFL = proj(cx - hw * 1.18, 0.03, zFar);
    const wakeFR = proj(cx + hw * 1.18, 0.03, zFar);
    const wakeNL = proj(cx - hw * 1.18, 0.03, zNear);
    const wakeNR = proj(cx + hw * 1.18, 0.03, zNear);
    fillQuad(ctx, wakeFL, wakeFR, wakeNR, wakeNL, 'rgba(224, 242, 254, 0.55)');

    const hullH = 1.16;
    const upHw = hw * 0.86;
    if (sideSign !== 0) {
      const sx = cx + sideSign * hw;
      const p1 = proj(sx, 0.14, zFar);
      const p2 = proj(sx, 0.14, zNear);
      const p3 = proj(sx, hullH, zNear);
      const p4 = proj(sx, hullH, zFar);
      if (sideSign < 0) fillQuad(ctx, p1, p2, p3, p4, pal.vehSide, 'rgba(15,23,42,0.28)');
      else fillQuad(ctx, p2, p1, p4, p3, pal.vehSide, 'rgba(15,23,42,0.28)');

      // Gold hull stripe
      const st1 = proj(sx + sideSign * 0.01, 0.86, zFar);
      const st2 = proj(sx + sideSign * 0.01, 0.86, zNear);
      const st3 = proj(sx + sideSign * 0.01, 1.0, zNear);
      const st4 = proj(sx + sideSign * 0.01, 1.0, zFar);
      if (sideSign < 0) fillQuad(ctx, st1, st2, st3, st4, pal.vehStripe);
      else fillQuad(ctx, st2, st1, st4, st3, pal.vehStripe);

      // Circular brass portholes
      const nPorts = 4;
      for (let k = 0; k < nPorts; k++) {
        const pz = zNear + ((zFar - zNear) * (k + 0.5)) / nPorts;
        const pp = proj(sx + sideSign * 0.02, 0.58, pz);
        if (pp && pp.scale > 8) {
          const pr = Math.max(2, pp.scale * 0.11);
          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.arc(pp.sx, pp.sy, pr * 1.25, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = pal.vehWindow;
          ctx.beginPath();
          ctx.arc(pp.sx, pp.sy, pr * 0.88, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Upper cabin side
      const ux = cx + sideSign * upHw;
      const u1 = proj(ux, hullH, zFar);
      const u2 = proj(ux, hullH, zNear);
      const u3 = proj(ux, h, zNear);
      const u4 = proj(ux, h, zFar);
      if (sideSign < 0) fillQuad(ctx, u1, u2, u3, u4, '#e2e8f0', 'rgba(15,23,42,0.2)');
      else fillQuad(ctx, u2, u1, u4, u3, '#e2e8f0', 'rgba(15,23,42,0.2)');
      if (zFar - 0.5 > zNear + 0.5) {
        const w1 = proj(ux + sideSign * 0.01, hullH + 0.25, zFar - 0.5);
        const w2 = proj(ux + sideSign * 0.01, hullH + 0.25, zNear + 0.5);
        const w3 = proj(ux + sideSign * 0.01, h - 0.25, zNear + 0.5);
        const w4 = proj(ux + sideSign * 0.01, h - 0.25, zFar - 0.5);
        if (sideSign < 0) fillQuad(ctx, w1, w2, w3, w4, pal.vehWindow);
        else fillQuad(ctx, w2, w1, w4, w3, pal.vehWindow);
      }
    }

    if (camY > hullH) {
      // Deck ledge
      fillQuad(
        ctx,
        proj(cx - hw, hullH, zFar),
        proj(cx + hw, hullH, zFar),
        proj(cx + hw, hullH, zNear),
        proj(cx - hw, hullH, zNear),
        '#cbd5e1'
      );
    }
    if (camY > h) {
      fillQuad(
        ctx,
        proj(cx - upHw, h, zFar),
        proj(cx + upHw, h, zFar),
        proj(cx + upHw, h, zNear),
        proj(cx - upHw, h, zNear),
        pal.vehRoof,
        'rgba(15,23,42,0.2)'
      );
      // Life-raft canisters / radar bar
      if (zFar - zNear > 2.8) {
        const rZ = zNear + 1.2;
        fillQuad(
          ctx,
          proj(cx - upHw * 0.5, h + 0.08, rZ + 0.7),
          proj(cx + upHw * 0.5, h + 0.08, rZ + 0.7),
          proj(cx + upHw * 0.5, h + 0.08, rZ),
          proj(cx - upHw * 0.5, h + 0.08, rZ),
          '#cbd5e1',
          '#64748b'
        );
      }
    }

    if (ozStart > nearClip + 0.1) {
      // Lower emerald hull front
      fillQuad(
        ctx,
        proj(cx - hw, hullH, zNear),
        proj(cx + hw, hullH, zNear),
        proj(cx + hw * 0.9, 0.14, zNear),
        proj(cx - hw * 0.9, 0.14, zNear),
        pal.vehBody,
        'rgba(15,23,42,0.3)'
      );
      fillQuad(
        ctx,
        proj(cx - hw * 0.98, 0.98, zNear),
        proj(cx + hw * 0.98, 0.98, zNear),
        proj(cx + hw * 0.96, 0.84, zNear),
        proj(cx - hw * 0.96, 0.84, zNear),
        pal.vehStripe
      );
      // Upper white wheelhouse front
      fillQuad(
        ctx,
        proj(cx - upHw, h, zNear),
        proj(cx + upHw, h, zNear),
        proj(cx + upHw, hullH, zNear),
        proj(cx - upHw, hullH, zNear),
        '#f8fafc',
        'rgba(15,23,42,0.25)'
      );
      fillQuad(
        ctx,
        proj(cx - upHw * 0.82, h * 0.86, zNear),
        proj(cx + upHw * 0.82, h * 0.86, zNear),
        proj(cx + upHw * 0.82, hullH + 0.24, zNear),
        proj(cx - upHw * 0.82, hullH + 0.24, zNear),
        pal.vehWindow
      );
      const signTL = proj(cx - upHw * 0.68, h * 0.96, zNear);
      const signTR = proj(cx + upHw * 0.68, h * 0.96, zNear);
      const signBR = proj(cx + upHw * 0.68, h * 0.88, zNear);
      const signBL = proj(cx - upHw * 0.68, h * 0.88, zNear);
      fillQuad(ctx, signTL, signTR, signBR, signBL, '#0f172a');
      if (!o.hasRamp && signTL && signTR && signBL && signBL.scale > 11) {
        const fontSize = Math.max(7, Math.min(13, signBL.scale * 0.13));
        const maxW = Math.max(10, Math.abs(signTR.sx - signTL.sx) * 0.9);
        ctx.fillStyle = '#fde047';
        ctx.font = `800 ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(vehCampus.signText, (signTL.sx + signTR.sx) * 0.5, (signTL.sy + signBL.sy) * 0.5, maxW);
      }
    }
  } else if (model === 'nyc' && o.variant === 'main') {
    // NYC Box Truck: stepped cab (zNear..zNear+1.8) + sloped aero fairing + tall cargo box (ROOF_H = 2.35)
    const cabEnd = Math.min(zFar, ozStart + 1.8);
    const boxStart = Math.max(zNear, Math.min(zFar, ozStart + 2.35));
    const cabH = 1.68;

    if (sideSign !== 0) {
      const sx = cx + sideSign * hw;
      if (boxStart > zNear) {
        // Cab side
        const c1 = proj(sx, 0.22, Math.min(cabEnd, boxStart));
        const c2 = proj(sx, 0.22, zNear);
        const c3 = proj(sx, cabH, zNear);
        const c4 = proj(sx, cabH, Math.min(cabEnd, boxStart));
        if (sideSign < 0) fillQuad(ctx, c1, c2, c3, c4, '#eab308', 'rgba(15,23,42,0.25)');
        else fillQuad(ctx, c2, c1, c4, c3, '#eab308', 'rgba(15,23,42,0.25)');
      }
      if (zFar > boxStart) {
        // Cargo box side
        const b1 = proj(sx, 0.26, zFar);
        const b2 = proj(sx, 0.26, boxStart);
        const b3 = proj(sx, h, boxStart);
        const b4 = proj(sx, h, zFar);
        if (sideSign < 0) fillQuad(ctx, b1, b2, b3, b4, '#e2e8f0', 'rgba(15,23,42,0.25)');
        else fillQuad(ctx, b2, b1, b4, b3, '#e2e8f0', 'rgba(15,23,42,0.25)');

        // NYC stripe along cargo box
        const s1 = proj(sx + sideSign * 0.01, h * 0.42, zFar);
        const s2 = proj(sx + sideSign * 0.01, h * 0.42, boxStart);
        const s3 = proj(sx + sideSign * 0.01, h * 0.56, boxStart);
        const s4 = proj(sx + sideSign * 0.01, h * 0.56, zFar);
        if (sideSign < 0) fillQuad(ctx, s1, s2, s3, s4, '#facc15');
        else fillQuad(ctx, s2, s1, s4, s3, '#facc15');
      }
      drawVehicleWheels(ctx, proj, cx, hw, zNear, zFar, sideSign);
    }

    if (camY > h && zFar > boxStart) {
      fillQuad(
        ctx,
        proj(cx - hw, h, zFar),
        proj(cx + hw, h, zFar),
        proj(cx + hw, h, boxStart),
        proj(cx - hw, h, boxStart),
        '#f8fafc',
        'rgba(15,23,42,0.2)'
      );
    }
    if (boxStart > zNear) {
      // Aerodynamic wind deflector fairing bridging cab (1.68) to box roof (2.35)
      fillQuad(
        ctx,
        proj(cx - hw * 0.94, h, boxStart),
        proj(cx + hw * 0.94, h, boxStart),
        proj(cx + hw * 0.94, cabH, zNear + Math.min(0.6, boxStart - zNear)),
        proj(cx - hw * 0.94, cabH, zNear + Math.min(0.6, boxStart - zNear)),
        '#facc15',
        'rgba(15,23,42,0.25)'
      );
    }

    if (ozStart > nearClip + 0.1) {
      const frontH = zNear < ozStart + 1.8 ? cabH : h;
      fillQuad(
        ctx,
        proj(cx - hw, frontH, zNear),
        proj(cx + hw, frontH, zNear),
        proj(cx + hw, 0.22, zNear),
        proj(cx - hw, 0.22, zNear),
        '#facc15',
        'rgba(15,23,42,0.35)'
      );
      // Chrome grille
      fillQuad(
        ctx,
        proj(cx - hw * 0.52, 0.72, zNear),
        proj(cx + hw * 0.52, 0.72, zNear),
        proj(cx + hw * 0.52, 0.34, zNear),
        proj(cx - hw * 0.52, 0.34, zNear),
        '#cbd5e1',
        '#475569'
      );
      // Windshield
      fillQuad(
        ctx,
        proj(cx - hw * 0.82, frontH * 0.9, zNear),
        proj(cx + hw * 0.82, frontH * 0.9, zNear),
        proj(cx + hw * 0.82, 0.86, zNear),
        proj(cx - hw * 0.82, 0.86, zNear),
        pal.vehWindow
      );
      // Box front header above fairing
      if (zFar > boxStart && ozStart < boxStart) {
        const signTL = proj(cx - hw * 0.68, h * 0.96, boxStart);
        const signTR = proj(cx + hw * 0.68, h * 0.96, boxStart);
        const signBR = proj(cx + hw * 0.68, h * 0.84, boxStart);
        const signBL = proj(cx - hw * 0.68, h * 0.84, boxStart);
        fillQuad(ctx, signTL, signTR, signBR, signBL, '#0f172a');
        if (!o.hasRamp && signTL && signTR && signBL && signBL.scale > 10) {
          const fontSize = Math.max(7, Math.min(13, signBL.scale * 0.13));
          const maxW = Math.max(10, Math.abs(signTR.sx - signTL.sx) * 0.9);
          ctx.fillStyle = '#fde047';
          ctx.font = `800 ${fontSize}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(vehCampus.signText, (signTL.sx + signTR.sx) * 0.5, (signTL.sy + signBL.sy) * 0.5, maxW);
        }
      }
    }
  } else {
    // Grounded chassis vehicles: MV GBus, London Double-Decker, Zurich VBZ Tram, Tokyo Yamanote, NYC Yellow Cab Shuttle
    const skirtY = model === 'zurich' || model === 'tokyo' ? 0.16 : 0.22;
    const isSlopedTram = model === 'zurich';
    const noseZ = isSlopedTram ? Math.min(zFar, zNear + 0.65) : zNear;
    const noseY = isSlopedTram ? 1.15 : h;

    if (sideSign !== 0) {
      const sx = cx + sideSign * hw;
      const p1 = proj(sx, skirtY, zFar);
      const p2 = proj(sx, skirtY, zNear);
      const p3 = proj(sx, h, noseZ);
      const p4 = proj(sx, h, zFar);
      if (sideSign < 0) fillQuad(ctx, p1, p2, p3, p4, sideCol, 'rgba(15,23,42,0.25)');
      else fillQuad(ctx, p2, p1, p4, p3, sideCol, 'rgba(15,23,42,0.25)');

      // Livery stripe
      const st1 = proj(sx + sideSign * 0.01, h * 0.36, zFar);
      const st2 = proj(sx + sideSign * 0.01, h * 0.36, zNear);
      const st3 = proj(sx + sideSign * 0.01, h * 0.48, zNear);
      const st4 = proj(sx + sideSign * 0.01, h * 0.48, zFar);
      if (sideSign < 0) fillQuad(ctx, st1, st2, st3, st4, pal.vehStripe);
      else fillQuad(ctx, st2, st1, st4, st3, pal.vehStripe);

      if (model === 'london') {
        // Double-decker stacked two-row side windows
        if (zFar - 0.6 > zNear + 0.6) {
          const lw1 = proj(sx + sideSign * 0.01, 0.58, zFar - 0.5);
          const lw2 = proj(sx + sideSign * 0.01, 0.58, zNear + 0.5);
          const lw3 = proj(sx + sideSign * 0.01, 1.05, zNear + 0.5);
          const lw4 = proj(sx + sideSign * 0.01, 1.05, zFar - 0.5);
          const uw1 = proj(sx + sideSign * 0.01, 1.44, zFar - 0.5);
          const uw2 = proj(sx + sideSign * 0.01, 1.44, zNear + 0.5);
          const uw3 = proj(sx + sideSign * 0.01, 2.08, zNear + 0.5);
          const uw4 = proj(sx + sideSign * 0.01, 2.08, zFar - 0.5);
          if (sideSign < 0) {
            fillQuad(ctx, lw1, lw2, lw3, lw4, pal.vehWindow);
            fillQuad(ctx, uw1, uw2, uw3, uw4, pal.vehWindow);
          } else {
            fillQuad(ctx, lw2, lw1, lw4, lw3, pal.vehWindow);
            fillQuad(ctx, uw2, uw1, uw4, uw3, pal.vehWindow);
          }
        }
      } else {
        if (zFar - 0.6 > noseZ + 0.4) {
          const w1 = proj(sx + sideSign * 0.01, h * 0.55, zFar - 0.55);
          const w2 = proj(sx + sideSign * 0.01, h * 0.55, noseZ + 0.4);
          const w3 = proj(sx + sideSign * 0.01, h * 0.84, noseZ + 0.4);
          const w4 = proj(sx + sideSign * 0.01, h * 0.84, zFar - 0.55);
          if (sideSign < 0) fillQuad(ctx, w1, w2, w3, w4, pal.vehWindow);
          else fillQuad(ctx, w2, w1, w4, w3, pal.vehWindow);
        }
        // NYC Yellow Cab checkerboard side squares
        if (model === 'nyc' && o.variant === 'alt') {
          const steps = 6;
          for (let k = 0; k < steps; k++) {
            const cz1 = zNear + 0.5 + k * 0.9;
            const cz2 = cz1 + 0.45;
            if (cz2 >= zFar - 0.4) break;
            const y0 = k % 2 === 0 ? h * 0.36 : h * 0.42;
            const c1 = proj(sx + sideSign * 0.02, y0, cz2);
            const c2 = proj(sx + sideSign * 0.02, y0, cz1);
            const c3 = proj(sx + sideSign * 0.02, y0 + 0.14, cz1);
            const c4 = proj(sx + sideSign * 0.02, y0 + 0.14, cz2);
            if (sideSign < 0) fillQuad(ctx, c1, c2, c3, c4, '#f8fafc');
            else fillQuad(ctx, c2, c1, c4, c3, '#f8fafc');
          }
        }
        // Tokyo Yamanote 3 commuter sliding doors
        if (model === 'tokyo') {
          for (let d = 0; d < 3; d++) {
            const dz = zNear + 1.8 + d * 4.2;
            if (dz + 1.1 >= zFar - 0.4) break;
            const d1 = proj(sx + sideSign * 0.015, skirtY + 0.04, dz + 1.1);
            const d2 = proj(sx + sideSign * 0.015, skirtY + 0.04, dz);
            const d3 = proj(sx + sideSign * 0.015, h * 0.86, dz);
            const d4 = proj(sx + sideSign * 0.015, h * 0.86, dz + 1.1);
            if (sideSign < 0) fillQuad(ctx, d1, d2, d3, d4, 'rgba(15,23,42,0.22)', '#475569');
            else fillQuad(ctx, d2, d1, d4, d3, 'rgba(15,23,42,0.22)', '#475569');
          }
        }
      }

      if (model === 'mv' || model === 'london' || model === 'nyc') {
        drawVehicleWheels(ctx, proj, cx, hw, zNear, zFar, sideSign);
      }
    }

    if (camY > h && zFar > noseZ) {
      fillQuad(
        ctx,
        proj(cx - hw, h, zFar),
        proj(cx + hw, h, zFar),
        proj(cx + hw, h, noseZ),
        proj(cx - hw, h, noseZ),
        pal.vehRoof,
        'rgba(15,23,42,0.2)'
      );
      if (model === 'mv' && zFar - 1.2 > noseZ + 1.2) {
        // GBus compact AC pods
        fillQuad(
          ctx,
          proj(cx - hw * 0.45, h + 0.05, zFar - 1.4),
          proj(cx + hw * 0.45, h + 0.05, zFar - 1.4),
          proj(cx + hw * 0.45, h + 0.05, noseZ + 1.4),
          proj(cx - hw * 0.45, h + 0.05, noseZ + 1.4),
          'rgba(148, 163, 184, 0.42)'
        );
      } else if (model === 'zurich' && zFar > noseZ + 2.4) {
        // VBZ Tram compact diamond pantograph
        const pz1 = noseZ + 1.6;
        const pz2 = noseZ + 2.6;
        const pbL = proj(cx - 0.35, h + 0.02, pz1);
        const pbR = proj(cx + 0.35, h + 0.02, pz1);
        const ptL = proj(cx - 0.42, h + 0.28, (pz1 + pz2) * 0.5);
        const ptR = proj(cx + 0.42, h + 0.28, (pz1 + pz2) * 0.5);
        if (pbL && pbR && ptL && ptR) {
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = Math.max(1.5, pbL.scale * 0.04);
          ctx.beginPath();
          ctx.moveTo(pbL.sx, pbL.sy);
          ctx.lineTo(ptL.sx, ptL.sy);
          ctx.lineTo(ptR.sx, ptR.sy);
          ctx.lineTo(pbR.sx, pbR.sy);
          ctx.stroke();
        }
      } else if (model === 'nyc' && o.variant === 'alt' && zFar > noseZ + 1.6) {
        // TAXI roof beacon
        fillQuad(
          ctx,
          proj(cx - 0.42, h + 0.14, noseZ + 1.2),
          proj(cx + 0.42, h + 0.14, noseZ + 1.2),
          proj(cx + 0.42, h + 0.02, noseZ + 0.8),
          proj(cx - 0.42, h + 0.02, noseZ + 0.8),
          '#fef08a',
          '#18181b'
        );
      } else if (model === 'waymo' && zFar > noseZ + 2.0) {
        // Spinning Waymo black/cyan LiDAR roof dome!
        const dp = proj(cx, h + 0.22, noseZ + 1.4);
        if (dp) {
          const dr = Math.max(3, dp.scale * 0.34);
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.ellipse(dp.sx, dp.sy, dr, dr * 0.58, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#00e5ff';
          ctx.lineWidth = Math.max(1.5, dr * 0.18);
          ctx.stroke();
        }
      } else if (model === 'quantum' && zFar - 1.2 > noseZ + 1.2) {
        // Glowing superconducting cyan coil on golden Quantum Cryostat roof
        fillQuad(
          ctx,
          proj(cx - hw * 0.48, h + 0.06, zFar - 1.2),
          proj(cx + hw * 0.48, h + 0.06, zFar - 1.2),
          proj(cx + hw * 0.48, h + 0.06, noseZ + 1.2),
          proj(cx - hw * 0.48, h + 0.06, noseZ + 1.2),
          '#38bdf8',
          '#0284c7'
        );
      } else if (model === 'tpu' && zFar - 1.0 > noseZ + 1.0) {
        // 4-color Google liquid-cooling manifold strips along TPU Superpod roof
        const cols = ['#4285f4', '#ea4335', '#fbbc05', '#34a853'];
        for (let k = 0; k < 4; k++) {
          const lx = cx - hw * 0.6 + k * hw * 0.4;
          fillQuad(
            ctx,
            proj(lx - 0.08, h + 0.05, zFar - 1.0),
            proj(lx + 0.08, h + 0.05, zFar - 1.0),
            proj(lx + 0.08, h + 0.05, noseZ + 1.0),
            proj(lx - 0.08, h + 0.05, noseZ + 1.0),
            cols[k]
          );
        }
      } else if (model === 'deepmind' && zFar > noseZ + 3.0) {
        // Black & white Go stones perched on DeepMind Compute Pod roof
        const s1 = proj(cx - 0.34, h + 0.08, noseZ + 1.8);
        const s2 = proj(cx + 0.34, h + 0.08, noseZ + 2.6);
        if (s1) {
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.ellipse(s1.sx, s1.sy, Math.max(2.5, s1.scale * 0.24), Math.max(1.5, s1.scale * 0.14), 0, 0, Math.PI * 2);
          ctx.fill();
        }
        if (s2) {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#94a3b8';
          ctx.beginPath();
          ctx.ellipse(s2.sx, s2.sy, Math.max(2.5, s2.scale * 0.24), Math.max(1.5, s2.scale * 0.14), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    if (ozStart > nearClip + 0.1) {
      if (isSlopedTram) {
        // Lower nose + raked windshield up to ROOF_H
        fillQuad(
          ctx,
          proj(cx - hw, noseY, zNear),
          proj(cx + hw, noseY, zNear),
          proj(cx + hw, skirtY, zNear),
          proj(cx - hw, skirtY, zNear),
          bodyCol,
          'rgba(15,23,42,0.35)'
        );
        fillQuad(
          ctx,
          proj(cx - hw, h, noseZ),
          proj(cx + hw, h, noseZ),
          proj(cx + hw, noseY, zNear),
          proj(cx - hw, noseY, zNear),
          bodyCol,
          'rgba(15,23,42,0.3)'
        );
        fillQuad(
          ctx,
          proj(cx - hw * 0.82, h * 0.86, noseZ - 0.05),
          proj(cx + hw * 0.82, h * 0.86, noseZ - 0.05),
          proj(cx + hw * 0.86, noseY + 0.06, zNear + 0.04),
          proj(cx - hw * 0.86, noseY + 0.06, zNear + 0.04),
          pal.vehWindow
        );
        fillQuad(
          ctx,
          proj(cx - hw, noseY * 0.72, zNear),
          proj(cx + hw, noseY * 0.72, zNear),
          proj(cx + hw, noseY * 0.56, zNear),
          proj(cx - hw, noseY * 0.56, zNear),
          pal.vehStripe
        );
      } else {
        fillQuad(
          ctx,
          proj(cx - hw, h, zNear),
          proj(cx + hw, h, zNear),
          proj(cx + hw, skirtY, zNear),
          proj(cx - hw, skirtY, zNear),
          bodyCol,
          'rgba(15,23,42,0.35)'
        );
        fillQuad(
          ctx,
          proj(cx - hw, h * 0.46, zNear),
          proj(cx + hw, h * 0.46, zNear),
          proj(cx + hw, h * 0.34, zNear),
          proj(cx - hw, h * 0.34, zNear),
          pal.vehStripe
        );
        if (model === 'london') {
          // Stacked double-row front windows
          fillQuad(
            ctx,
            proj(cx - hw * 0.82, 2.08, zNear),
            proj(cx + hw * 0.82, 2.08, zNear),
            proj(cx + hw * 0.82, 1.44, zNear),
            proj(cx - hw * 0.82, 1.44, zNear),
            pal.vehWindow
          );
          fillQuad(
            ctx,
            proj(cx - hw * 0.82, 1.06, zNear),
            proj(cx + hw * 0.82, 1.06, zNear),
            proj(cx + hw * 0.82, 0.56, zNear),
            proj(cx - hw * 0.82, 0.56, zNear),
            pal.vehWindow
          );
        } else {
          fillQuad(
            ctx,
            proj(cx - hw * 0.84, h * 0.82, zNear),
            proj(cx + hw * 0.84, h * 0.82, zNear),
            proj(cx + hw * 0.84, h * 0.5, zNear),
            proj(cx - hw * 0.84, h * 0.5, zNear),
            pal.vehWindow
          );
        }
      }

      if (!o.hasRamp) {
        const signZ = isSlopedTram ? noseZ : zNear;
        const signYTop = model === 'london' ? 1.38 : h * 0.94;
        const signYBot = model === 'london' ? 1.16 : h * 0.85;
        const signTL = proj(cx - hw * 0.66, signYTop, signZ);
        const signTR = proj(cx + hw * 0.66, signYTop, signZ);
        const signBR = proj(cx + hw * 0.66, signYBot, signZ);
        const signBL = proj(cx - hw * 0.66, signYBot, signZ);
        fillQuad(ctx, signTL, signTR, signBR, signBL, '#0f172a');

        if (signTL && signTR && signBL && signBL.scale > 11) {
          const fontSize = Math.max(7, Math.min(13, signBL.scale * 0.13));
          const maxW = Math.max(10, Math.abs(signTR.sx - signTL.sx) * 0.9);
          ctx.fillStyle = '#fde047';
          ctx.font = `800 ${fontSize}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(vehCampus.signText, (signTL.sx + signTR.sx) * 0.5, (signTL.sy + signBL.sy) * 0.5, maxW);
        }
      }

      // Headlights / taillights
      for (let s = -1; s <= 1; s += 2) {
        const hl = proj(cx + s * 0.72 * hw, h * 0.22, zNear);
        if (!hl) continue;
        const r = Math.max(2, hl.scale * 0.16);
        if (isOncoming) {
          drawUnitGlow(ctx, grads.headlightHalo, hl.sx, hl.sy, r * 2.6);
        }
        ctx.fillStyle = isOncoming ? '#fef08a' : '#ef4444';
        ctx.beginPath();
        ctx.arc(hl.sx, hl.sy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Decoupled side-skirted 3D ramp rendering
  if (o.hasRamp && ozStart > nearClip) {
    const rawStart = ozStart - RAMP_LEN;
    const rZ = Math.max(nearClip, rawStart);
    const topZ = Math.max(nearClip, ozStart);
    if (topZ > rZ) {
      const startFrac = Math.max(0, Math.min(1, (rZ - rawStart) / RAMP_LEN));
      const rYStart = 0.02 + startFrac * (h - 0.02);
      const rhw = hw * 0.95;
      const rbl = proj(cx - rhw, rYStart, rZ);
      const rbr = proj(cx + rhw, rYStart, rZ);
      const rtl = proj(cx - rhw, h, topZ);
      const rtr = proj(cx + rhw, h, topZ);

      // Side skirt of ramp when viewed at angle
      if (camX < cx - rhw) {
        fillQuad(ctx, proj(cx - rhw, 0.02, topZ), proj(cx - rhw, 0.02, rZ), rbl, rtl, '#d97706', '#92400e');
      } else if (camX > cx + rhw) {
        fillQuad(ctx, rbr, proj(cx + rhw, 0.02, rZ), proj(cx + rhw, 0.02, topZ), rtr, '#d97706', '#92400e');
      }

      fillQuad(ctx, rtl, rtr, rbr, rbl, '#fbbc05', '#18181b');

      for (let k = 1; k <= 3; k++) {
        const t = k / 4;
        const cz = rawStart + RAMP_LEN * t;
        if (cz <= nearClip + 0.2) continue;
        const cy = h * t;
        const cl = proj(cx - hw * 0.72, cy + 0.03, cz);
        const cr = proj(cx + hw * 0.72, cy + 0.03, cz);
        const cm = proj(cx, cy + 0.22, cz + 0.45);
        if (cl && cr && cm) {
          ctx.strokeStyle = '#18181b';
          ctx.lineWidth = Math.max(1.5, cl.scale * 0.12);
          ctx.beginPath();
          ctx.moveTo(cl.sx, cl.sy);
          ctx.lineTo(cm.sx, cm.sy);
          ctx.lineTo(cr.sx, cr.sy);
          ctx.stroke();
        }
      }
    }
  }

  ctx.restore();
}

function drawLowHurdle(ctx, o, ozStart, ozEnd, camX, camY, vp) {
  if (o.smashed) return;
  const proj = (wx, wy, wz) => projectPoint(wx, wy, wz, camX, camY, vp);
  const zNear = Math.max(VEHICLE_NEAR_CLIP, ozStart);
  const zFar = Math.min(MAX_Z, ozEnd);
  if (zFar <= zNear || zNear > MAX_Z) return;

  const fogAlpha = ozStart > MAX_Z - 30 ? clamp((MAX_Z - ozStart) / 30, 0.1, 1) : 1;
  ctx.save();
  if (fogAlpha < 1) ctx.globalAlpha = fogAlpha;

  const cx = o.lane * LANE_W;
  const hw = HURDLE_HALF_W;
  const h = LOW_HURDLE_HEIGHT;

  const pTL = proj(cx - hw, h, zNear);
  const pTR = proj(cx + hw, h, zNear);
  const pBR = proj(cx + hw, 0.35, zNear);
  const pBL = proj(cx - hw, 0.35, zNear);
  const fTL = proj(cx - hw, h, zFar);
  const fTR = proj(cx + hw, h, zFar);
  const fBR = proj(cx + hw, 0.35, zFar);
  const fBL = proj(cx - hw, 0.35, zFar);

  // 3D A-frame legs connecting zNear & zFar
  const legNL = proj(cx - hw * 0.82, 0, zNear - 0.12);
  const legFL = proj(cx - hw * 0.82, 0, zFar + 0.12);
  const legNR = proj(cx + hw * 0.82, 0, zNear - 0.12);
  const legFR = proj(cx + hw * 0.82, 0, zFar + 0.12);
  const topLegL = proj(cx - hw * 0.82, 0.38, (zNear + zFar) * 0.5);
  const topLegR = proj(cx + hw * 0.82, 0.38, (zNear + zFar) * 0.5);

  if (legNL && legFL && topLegL && legNR && legFR && topLegR) {
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = Math.max(2, legNL.scale * 0.12);
    ctx.beginPath();
    ctx.moveTo(legNL.sx, legNL.sy);
    ctx.lineTo(topLegL.sx, topLegL.sy);
    ctx.lineTo(legFL.sx, legFL.sy);
    ctx.moveTo(legNR.sx, legNR.sy);
    ctx.lineTo(topLegR.sx, topLegR.sy);
    ctx.lineTo(legFR.sx, legFR.sy);
    ctx.stroke();
  }

  // 3D side end-caps
  if (camX < cx - hw && fBL && pBL && pTL && fTL) {
    fillQuad(ctx, fBL, pBL, pTL, fTL, '#991b1b', '#7f1d1d');
  } else if (camX > cx + hw && pBR && fBR && fTR && pTR) {
    fillQuad(ctx, pBR, fBR, fTR, pTR, '#991b1b', '#7f1d1d');
  }

  // Top cap
  if (fTL && fTR && pTR && pTL) {
    fillQuad(ctx, fTL, fTR, pTR, pTL, '#b91c1c', '#7f1d1d');
  }

  // Front crossbar + diagonal hazard chevrons gated on ozStart > VEHICLE_NEAR_CLIP
  if (ozStart > VEHICLE_NEAR_CLIP && pTL && pTR && pBR && pBL) {
    fillQuad(ctx, pTL, pTR, pBR, pBL, '#ea4335', '#7f1d1d');
    const chevrons = [-0.65, -0.1, 0.45];
    for (let i = 0; i < chevrons.length; i++) {
      const x0 = cx + hw * chevrons[i];
      const x1 = x0 + hw * 0.25;
      fillQuad(
        ctx,
        proj(x0 + 0.1, h, zNear),
        proj(x1 + 0.1, h, zNear),
        proj(x1 - 0.08, 0.35, zNear),
        proj(x0 - 0.08, 0.35, zNear),
        '#ffffff'
      );
    }
  }

  ctx.restore();
}

function drawHighGantry(ctx, o, ozStart, ozEnd, camX, camY, vp) {
  if (o.smashed) return;
  const proj = (wx, wy, wz) => projectPoint(wx, wy, wz, camX, camY, vp);
  const zNear = Math.max(VEHICLE_NEAR_CLIP, ozStart);
  const zFar = Math.min(MAX_Z, ozEnd);
  if (zFar <= zNear || zNear > MAX_Z) return;

  const fogAlpha = ozStart > MAX_Z - 30 ? clamp((MAX_Z - ozStart) / 30, 0.1, 1) : 1;
  ctx.save();
  if (fogAlpha < 1) ctx.globalAlpha = fogAlpha;

  const cx = o.lane * LANE_W;
  const hw = GANTRY_HALF_W;
  const pw = 0.14;
  const botY = HIGH_GANTRY_MIN_Y;
  const topY = HIGH_GANTRY_TOP_Y;

  // 3D left & right steel pillars + yellow/black base boots
  const drawPillar = (xOut, xIn) => {
    const xMin = Math.min(xOut, xIn);
    const xMax = Math.max(xOut, xIn);
    if (camX < xMin) {
      fillQuad(ctx, proj(xMin, 0, zFar), proj(xMin, 0, zNear), proj(xMin, topY, zNear), proj(xMin, topY, zFar), '#64748b');
      fillQuad(ctx, proj(xMin, 0, zFar), proj(xMin, 0, zNear), proj(xMin, 0.32, zNear), proj(xMin, 0.32, zFar), '#fbbc05');
    } else if (camX > xMax) {
      fillQuad(ctx, proj(xMax, 0, zNear), proj(xMax, 0, zFar), proj(xMax, topY, zFar), proj(xMax, topY, zNear), '#64748b');
      fillQuad(ctx, proj(xMax, 0, zNear), proj(xMax, 0, zFar), proj(xMax, 0.32, zFar), proj(xMax, 0.32, zNear), '#fbbc05');
    }
    if (ozStart > VEHICLE_NEAR_CLIP) {
      fillQuad(ctx, proj(xMin, topY, zNear), proj(xMax, topY, zNear), proj(xMax, 0, zNear), proj(xMin, 0, zNear), '#94a3b8', '#475569');
      fillQuad(ctx, proj(xMin, 0.32, zNear), proj(xMax, 0.32, zNear), proj(xMax, 0, zNear), proj(xMin, 0, zNear), '#fbbc05', '#18181b');
    }
  };

  drawPillar(cx - hw, cx - hw + pw);
  drawPillar(cx + hw, cx + hw - pw);

  // Extruded overhead sign box (y = 1.28..2.65)
  const nTL = proj(cx - hw, topY, zNear);
  const nTR = proj(cx + hw, topY, zNear);
  const nBR = proj(cx + hw, botY, zNear);
  const nBL = proj(cx - hw, botY, zNear);
  const fTL = proj(cx - hw, topY, zFar);
  const fTR = proj(cx + hw, topY, zFar);
  const fBR = proj(cx + hw, botY, zFar);
  const fBL = proj(cx - hw, botY, zFar);

  if (camX < cx - hw) fillQuad(ctx, fBL, nBL, nTL, fTL, '#172554', '#60a5fa');
  else if (camX > cx + hw) fillQuad(ctx, nBR, fBR, fTR, nTR, '#172554', '#60a5fa');

  if (camY > topY) fillQuad(ctx, fTL, fTR, nTR, nTL, '#1d4ed8', '#60a5fa');
  else if (camY < botY) fillQuad(ctx, nBL, nBR, fBR, fBL, '#1e293b');

  if (ozStart > VEHICLE_NEAR_CLIP && nTL && nTR && nBR && nBL) {
    fillQuad(ctx, nTL, nTR, nBR, nBL, '#1e3a8a', '#60a5fa');
    // Bottom hazard clearance strip
    fillQuad(
      ctx,
      proj(cx - hw, botY + 0.16, zNear),
      proj(cx + hw, botY + 0.16, zNear),
      nBR,
      nBL,
      '#fbbc05'
    );

    if (nBL.scale > 10) {
      const fontSize = Math.max(8, Math.min(18, nBL.scale * 0.22));
      ctx.fillStyle = '#fde047';
      ctx.font = `900 ${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↓ DUCK ↓', (nTL.sx + nTR.sx) * 0.5, (nTL.sy + nBL.sy) * 0.48);
    }
  }

  ctx.restore();
}

function drawAerialHazard(ctx, o, ozStart, worldTime, camX, camY, vp) {
  if (o.smashed) return;
  const cx = o.lane * LANE_W;
  const bob = Math.sin(worldTime * 8 + o.id) * 0.14;
  const p = projectPoint(cx, (o.y || 3.45) + bob, ozStart, camX, camY, vp);
  if (!p) return;
  const s = p.scale;

  ctx.save();
  ctx.translate(p.sx, p.sy);

  // Faint ground shadow far below so player can judge which lane it's in!
  const sh = projectPoint(cx, 0.04, ozStart, camX, camY, vp);
  if (sh) {
    ctx.save();
    ctx.translate(sh.sx - p.sx, sh.sy - p.sy);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(3, sh.scale * 0.45), Math.max(1.5, sh.scale * 0.14), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (o.aerialKind === 'qubit') {
    // Entangled Quantum AI Qubit Orb pulsing between |0> and |1>
    const r = Math.max(5, s * 0.42);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = Math.max(1.5, s * 0.04);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.45, r * 0.52, worldTime * 2.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.45, r * 0.52, -worldTime * 2.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    ctx.fill();
    if (r > 9) {
      ctx.fillStyle = '#020617';
      ctx.font = `900 ${Math.round(r * 0.8)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.floor(worldTime * 3) % 2 === 0 ? '|0⟩' : '|1⟩', 0, 1);
    }
  } else if (o.aerialKind === 'balloon') {
    // Project Loon translucent jellyfish stratospheric weather balloon
    const r = Math.max(5, s * 0.54);
    ctx.fillStyle = 'rgba(224, 242, 254, 0.78)';
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = Math.max(1.5, s * 0.04);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.2, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(0, r * 0.6);
    ctx.lineTo(0, r * 1.15);
    ctx.stroke();
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(-r * 0.35, r * 1.15, r * 0.7, r * 0.24);
  } else if (o.aerialKind === 'protein') {
    // Spinning AlphaFold multicolored protein ribbon helix
    const r = Math.max(5, s * 0.48);
    ctx.save();
    ctx.rotate(worldTime * 2.8);
    const cols = ['#22d3ee', '#a855f7', '#fbbc05'];
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = cols[k];
      ctx.lineWidth = Math.max(2, s * 0.09);
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.55 + k * 0.22), k * 2.1, k * 2.1 + Math.PI * 1.15);
      ctx.stroke();
    }
    ctx.restore();
  } else if (o.aerialKind === 'packet') {
    // Glowing fiber-optic TPU optical data packet
    const r = Math.max(5, s * 0.42);
    ctx.fillStyle = '#4285f4';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 1.2, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 1.2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  } else if (o.aerialKind === 'drone' || o.aerialKind === 'lidarDrone' || o.aerialKind === 'wingDrone') {
    // Sleek Google / Waymo LiDAR / Wing Delivery Drone
    const w = s * (o.aerialKind === 'wingDrone' ? 0.92 : 0.72);
    const h = s * 0.22;

    if (o.aerialKind === 'lidarDrone') {
      // Translucent cyan LiDAR scan cone projecting downward
      ctx.fillStyle = 'rgba(0, 229, 255, 0.22)';
      ctx.beginPath();
      ctx.moveTo(0, h * 0.5);
      ctx.lineTo(-s * 0.75, s * 2.1);
      ctx.lineTo(s * 0.75, s * 2.1);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = o.aerialKind === 'wingDrone' ? '#fbbc05' : '#334155';
    ctx.lineWidth = Math.max(2, s * 0.07);
    ctx.beginPath();
    ctx.moveTo(-w, -h * 0.2);
    ctx.lineTo(w, -h * 0.2);
    ctx.stroke();

    // Spinning rotor blurs
    const blurW = s * (0.28 + Math.abs(Math.sin(worldTime * 36)) * 0.12);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.fillRect(-w - blurW * 0.5, -h * 0.9, blurW, Math.max(2, s * 0.06));
    ctx.fillRect(w - blurW * 0.5, -h * 0.9, blurW, Math.max(2, s * 0.06));

    // White fuselage + LED beacon
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = Math.max(1.2, s * 0.03);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.34, h, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle =
      o.aerialKind === 'lidarDrone'
        ? '#00e5ff'
        : Math.floor(worldTime * 8) % 2 === 0
          ? '#ea4335'
          : '#4285f4';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(2, s * 0.09), 0, Math.PI * 2);
    ctx.fill();

    // Dangling coffee cup (Wing) or kraft parcel
    if (o.aerialKind === 'wingDrone') {
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = Math.max(1, s * 0.025);
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, h + s * 0.45);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-s * 0.12, h + s * 0.45, s * 0.24, s * 0.28);
      ctx.fillStyle = '#ea4335';
      ctx.fillRect(-s * 0.14, h + s * 0.42, s * 0.28, s * 0.07);
    } else {
      ctx.fillStyle = '#d97706';
      ctx.fillRect(-s * 0.16, h * 0.7, s * 0.32, s * 0.24);
    }
  } else {
    // Swooping Seagull (Sydney) or City Pigeon (NYC / London)
    const isSeagull = o.aerialKind === 'seagull';
    const wingBeat = Math.sin(worldTime * 15 + o.id) * s * 0.38;
    const span = s * (isSeagull ? 0.92 : 0.78);

    // Flapping wings
    ctx.fillStyle = isSeagull ? '#f8fafc' : '#64748b';
    ctx.strokeStyle = isSeagull ? '#94a3b8' : '#334155';
    ctx.lineWidth = Math.max(1.4, s * 0.03);
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(side * span * 0.55, -s * 0.32 + wingBeat, side * span, -s * 0.08 + wingBeat);
      ctx.quadraticCurveTo(side * span * 0.45, s * 0.12, 0, s * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });

    // Body + iridescent neck / beak
    ctx.fillStyle = isSeagull ? '#ffffff' : '#475569';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.22, s * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!isSeagull) {
      ctx.fillStyle = '#14b8a6';
      ctx.beginPath();
      ctx.arc(0, -s * 0.06, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = isSeagull ? '#f59e0b' : '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(-s * 0.06, s * 0.04);
    ctx.lineTo(0, s * 0.2);
    ctx.lineTo(s * 0.06, s * 0.04);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawCollectible(ctx, col, cx, cy, cz, worldTime, camX, camY, vp) {
  const bob = Math.sin(worldTime * 5 + cz * 0.4) * 0.16;
  const p = projectPoint(cx, cy + bob, cz, camX, camY, vp);
  if (!p) return;
  const radScale = col.type === 'medallion' ? 0.58 : (col.type === 'sparkle' ? 0.55 : 0.36);
  const r = Math.max(3, p.scale * radScale);
  const grads = getUnitGradients(ctx);

  if (col.type === 'coin' || col.type === 'medallion') {
    const isMedallion = col.type === 'medallion';
    const spin = Math.abs(Math.cos(worldTime * (isMedallion ? 3.2 : 4) + cz * 0.3));
    const rx = Math.max(2, r * (0.35 + spin * 0.65));
    const depthOff = (1 - spin) * r * 0.24;

    ctx.save();
    ctx.translate(p.sx, p.sy);

    if (isMedallion) {
      drawUnitGlow(ctx, grads.sparkleGlow, 0, 0, r * 1.9);
    }

    // 3D extruded rim edge
    if (depthOff > 0.5) {
      ctx.fillStyle = isMedallion ? '#1d4ed8' : '#b45309';
      ctx.beginPath();
      ctx.ellipse(depthOff, 0, rx, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = isMedallion ? '#f8fafc' : '#fbbc05';
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = isMedallion ? '#4285f4' : '#d97706';
    ctx.lineWidth = Math.max(1.5, r * (isMedallion ? 0.16 : 0.12));
    ctx.stroke();

    if (r > 6) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * 0.78, r * 0.78, 0, 0, Math.PI * 2);
      ctx.fill();

      // 4-color Google 'G' ring scaled by (rx/r, 1)
      ctx.save();
      ctx.scale(rx / r, 1);
      const gr = r * (isMedallion ? 0.52 : 0.46);
      ctx.lineWidth = Math.max(1.5, r * (isMedallion ? 0.22 : 0.2));
      ctx.lineCap = 'butt';

      const arcs = [
        ['#ea4335', Math.PI * 1.12, Math.PI * 1.82],
        ['#fbbc05', Math.PI * 0.72, Math.PI * 1.15],
        ['#34a853', Math.PI * 0.16, Math.PI * 0.75],
        ['#4285f4', -Math.PI * 0.05, Math.PI * 0.22],
      ];
      for (let i = 0; i < arcs.length; i++) {
        ctx.strokeStyle = arcs[i][0];
        ctx.beginPath();
        ctx.arc(0, 0, gr, arcs[i][1], arcs[i][2]);
        ctx.stroke();
      }
      ctx.fillStyle = '#4285f4';
      ctx.fillRect(0, -ctx.lineWidth * 0.46, gr + ctx.lineWidth * 0.46, ctx.lineWidth * 0.92);
      ctx.restore();
    }
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(p.sx, p.sy);
    drawUnitGlow(ctx, grads.sparkleGlow, 0, 0, r * 2.2);

    ctx.save();
    ctx.rotate(worldTime * 2.2);
    const sg = ctx.createLinearGradient(-r, -r, r, r);
    sg.addColorStop(0, '#4285f4');
    sg.addColorStop(0.5, '#8b5cf6');
    sg.addColorStop(1, '#22d3ee');
    drawFourPointStar(ctx, 0, 0, r * 1.24, r * 0.22, sg);
    drawFourPointStar(ctx, 0, 0, r * 0.72, r * 0.12, '#ffffff');
    ctx.restore();

    // 2 orbiting micro-sparkles
    for (let k = 0; k < 2; k++) {
      const ang = worldTime * 3.8 + k * Math.PI;
      const mx = Math.cos(ang) * r * 1.35;
      const my = Math.sin(ang) * r * 1.05;
      drawFourPointStar(ctx, mx, my, r * 0.32, r * 0.06, '#fef08a');
    }
    ctx.restore();
  }
}

function drawSpokedWheel(ctx, cx, cy, rx, ry, wheelAngle) {
  ctx.save();
  ctx.translate(cx, cy);

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = Math.max(1.2, ry * 0.12);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.76, ry * 0.76, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(226, 232, 240, 0.75)';
  ctx.lineWidth = Math.max(0.8, ry * 0.04);
  for (let i = 0; i < 8; i++) {
    const a = wheelAngle + (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * rx * 0.74, Math.sin(a) * ry * 0.74);
    ctx.stroke();
  }

  ctx.fillStyle = '#fbbc05';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.18, ry * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function solveTwoJointKnee(hipX, hipY, footX, footY, l1, l2, forwardSign = 1) {
  const dx = footX - hipX;
  const dy = footY - hipY;
  const dist = Math.max(0.001, Math.min(l1 + l2 - 0.001, Math.hypot(dx, dy)));
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const baseAng = Math.atan2(dy, dx);
  const bendAng = Math.acos(cosA);
  const k1x = hipX + Math.cos(baseAng + bendAng) * l1;
  const k1y = hipY + Math.sin(baseAng + bendAng) * l1;
  const k2x = hipX + Math.cos(baseAng - bendAng) * l1;
  const k2y = hipY + Math.sin(baseAng - bendAng) * l1;
  return (k1x - hipX) * forwardSign >= (k2x - hipX) * forwardSign
    ? { x: k1x, y: k1y }
    : { x: k2x, y: k2y };
}

function drawFourColorBeanie(ctx, cx, cy, r, worldTime) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.closePath();
  ctx.clip();

  const colors = ['#4285f4', '#ea4335', '#fbbc05', '#34a853'];
  const step = (r * 2) / 4;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(cx - r + i * step, cy - r - 2, step + 1, r + 4);
  }
  ctx.restore();

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.stroke();

  // Spinning 2-blade yellow propeller on top
  const propW = r * (0.35 + Math.abs(Math.sin(worldTime * 24)) * 0.72);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(cx - r * 0.08, cy - r - r * 0.24, r * 0.16, r * 0.24);
  ctx.fillStyle = '#fbbc05';
  ctx.beginPath();
  ctx.ellipse(cx, cy - r - r * 0.26, propW, r * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPelicanOnGBike(ctx, pState, alpha, worldTime, camX, camY, vp) {
  const px = lerp(pState.prevX, pState.x, alpha);
  const py = lerp(pState.prevY, pState.y, alpha);
  const pTilt = lerp(pState.prevTilt, pState.tilt, alpha);
  const pDuck = lerp(pState.prevDuckAmount, pState.duckAmount, alpha);
  const groundY = lerp(pState.prevSupportY, pState.supportY, alpha);
  const wheelAngle = lerp(pState.prevWheelAngle, pState.wheelAngle, alpha);
  const wingPhase = lerp(pState.prevWingPhase, pState.wingPhase, alpha);
  const flapAnimTimer = lerp(pState.prevFlapAnimTimer || 0, pState.flapAnimTimer || 0, alpha);
  const airBlend = lerp(pState.prevAirBlend, pState.airBlend, alpha);
  const landingSquash = lerp(pState.prevLandingSquash, pState.landingSquash, alpha);
  const wheeliePitch = lerp(pState.prevWheeliePitch, pState.wheeliePitch, alpha);

  const p = projectPoint(px, py, 0, camX, camY, vp);
  if (!p) return;
  const s = p.scale;
  const grads = getUnitGradients(ctx);

  // When on roof or ramp, draw player contact shadow right here on top of host roof/ramp
  if (groundY >= 0.2) {
    const shadowP = projectPoint(px, groundY + 0.03, 0, camX, camY, vp);
    if (shadowP) {
      const hDiff = Math.max(0, py - groundY);
      const shScale = Math.max(0.35, 1 - hDiff * 0.14);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
      ctx.beginPath();
      ctx.ellipse(shadowP.sx, shadowP.sy, s * 0.54 * shScale, s * 0.2 * shScale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const hoverLift = pState.hoverTimer > 0 ? -s * 0.16 + Math.sin(worldTime * 11) * s * 0.04 : 0;
  const pedalBob = py <= groundY + 0.05 && pState.hoverTimer <= 0 ? Math.sin(wheelAngle) * 1.4 : 0;
  const yaw = clamp(0.46 + pTilt * 0.36, 0.24, 0.68);
  const wheelieLift = Math.max(0, wheeliePitch) * s * 0.55;
  const duckSquash = 1 - pDuck * 0.34;

  ctx.save();
  if (pState.respawnInvulnTimer > 0 && Math.floor(worldTime * 16) % 2 === 0) {
    ctx.globalAlpha = 0.62;
  }
  ctx.translate(p.sx, p.sy + pedalBob + hoverLift);
  ctx.rotate(pTilt * 0.78 - wheeliePitch * 0.32);
  ctx.scale(1 + landingSquash * 0.45, 1 - landingSquash * 0.42);

  // Rainbow 4-color tire trail ribbon during Gemini Overdrive or Hover-GBike!
  if (pState.sparkleTimer > 0 || pState.hoverTimer > 0) {
    const trailColors = ['#4285f4', '#ea4335', '#fbbc05', '#34a853'];
    for (let t = 0; t < trailColors.length; t++) {
      ctx.strokeStyle = trailColors[t];
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = Math.max(2, s * 0.055);
      ctx.beginPath();
      ctx.moveTo(-s * 0.22 + t * s * 0.06, -s * 0.06);
      ctx.quadraticCurveTo(-s * 0.55, s * 0.24, -s * 0.72 + t * s * 0.08, s * 0.55);
      ctx.stroke();
    }
    ctx.globalAlpha = pState.respawnInvulnTimer > 0 && Math.floor(worldTime * 16) % 2 === 0 ? 0.62 : 1;
  }

  // Hover-GBike 4-color anti-grav thruster rings & energy shield!
  if (pState.hoverTimer > 0) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.lineWidth = Math.max(2, s * 0.055);
    ctx.beginPath();
    ctx.ellipse(0, s * 0.05, s * 0.58, s * 0.16, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.24)';
    ctx.fill();

    // Subtle translucent energy bubble
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.5)';
    ctx.lineWidth = Math.max(1.5, s * 0.035);
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.9, s * 0.78, s * 1.05, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Gemini Starlight Overdrive Aura + 3 orbiting 4-point sparkles
  if (pState.sparkleTimer > 0) {
    drawUnitGlow(ctx, grads.geminiAura, 0, -s * 0.92, s * 1.32);
    for (let k = 0; k < 3; k++) {
      const ang = worldTime * 3.1 + (k * Math.PI * 2) / 3;
      const sx = Math.cos(ang) * s * 0.85;
      const sy = -s * 0.95 + Math.sin(ang) * s * 0.45;
      drawFourPointStar(ctx, sx, sy, s * 0.16, s * 0.03, '#ffffff');
    }
  }

  // Bike 3/4 geometry anchors
  const rearX = -0.3 * yaw * s;
  const rearY = -0.3 * s;
  const frontX = 0.38 * yaw * s;
  const frontY = -0.42 * s - wheelieLift;
  const bbX = -0.02 * yaw * s;
  const bbY = -0.32 * s - wheelieLift * 0.3;
  const seatX = -0.14 * yaw * s;
  const seatY = -0.78 * s * duckSquash - wheelieLift * 0.45;
  const headTubeX = 0.26 * yaw * s;
  const headTubeY = -0.84 * s * duckSquash - wheelieLift * 0.75;
  const barY = -1.04 * s * duckSquash - wheelieLift * 0.85;
  const barX = 0.28 * yaw * s;

  // Front wheel + fork (behind frame/basket)
  drawSpokedWheel(ctx, frontX, frontY, s * 0.16 * (0.7 + yaw * 0.5), s * 0.31, wheelAngle);

  // Far-side pedaling leg (behind frame)
  const hipX = seatX + 0.05 * yaw * s;
  const hipY = seatY - s * 0.04;
  const farCrankX = bbX + Math.cos(wheelAngle + Math.PI) * s * 0.15 * yaw;
  const farCrankY = bbY + Math.sin(wheelAngle + Math.PI) * s * 0.14;
  const farKnee = solveTwoJointKnee(hipX, hipY, farCrankX, farCrankY, s * 0.26, s * 0.26, 1);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = Math.max(2, s * 0.07);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(farKnee.x, farKnee.y);
  ctx.lineTo(farCrankX, farCrankY);
  ctx.stroke();
  ctx.fillStyle = '#ea580c';
  ctx.beginPath();
  ctx.ellipse(farCrankX + s * 0.04, farCrankY, s * 0.1, s * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rear spoked wheel + green rear fender
  drawSpokedWheel(ctx, rearX, rearY, s * 0.18 * (0.7 + yaw * 0.5), s * 0.33, wheelAngle);
  ctx.strokeStyle = '#34a853';
  ctx.lineWidth = Math.max(2, s * 0.08);
  ctx.beginPath();
  ctx.arc(rearX, rearY, s * 0.35, Math.PI * 1.12, Math.PI * 1.88);
  ctx.stroke();

  // 4-color GBike Frame
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Red rear triangle (chainstay + seatstay)
  ctx.strokeStyle = '#ea4335';
  ctx.lineWidth = Math.max(2, s * 0.065);
  ctx.beginPath();
  ctx.moveTo(rearX, rearY);
  ctx.lineTo(bbX, bbY);
  ctx.moveTo(rearX, rearY);
  ctx.lineTo(seatX, seatY);
  ctx.stroke();

  // Blue main diamond
  ctx.strokeStyle = '#4285f4';
  ctx.lineWidth = Math.max(2, s * 0.075);
  ctx.beginPath();
  ctx.moveTo(bbX, bbY);
  ctx.lineTo(seatX, seatY);
  ctx.lineTo(headTubeX, headTubeY);
  ctx.lineTo(bbX, bbY);
  ctx.stroke();

  // Yellow fork + stem + handlebars
  ctx.strokeStyle = '#fbbc04';
  ctx.lineWidth = Math.max(2, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(frontX, frontY);
  ctx.lineTo(headTubeX, headTubeY);
  ctx.lineTo(barX, barY);
  ctx.stroke();

  const barSpread = s * 0.34;
  ctx.strokeStyle = '#fbbc04';
  ctx.lineWidth = Math.max(2, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(barX - barSpread, barY + s * 0.03);
  ctx.lineTo(barX, barY);
  ctx.lineTo(barX + barSpread, barY - s * 0.03);
  ctx.stroke();

  // Dark handlebar grips
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = Math.max(2, s * 0.085);
  ctx.beginPath();
  ctx.moveTo(barX - barSpread - s * 0.06, barY + s * 0.04);
  ctx.lineTo(barX - barSpread + s * 0.06, barY + s * 0.02);
  ctx.moveTo(barX + barSpread - s * 0.06, barY - s * 0.02);
  ctx.lineTo(barX + barSpread + s * 0.06, barY - s * 0.04);
  ctx.stroke();

  // Chrome stem bell + golden ring arcs when bellTimer > 0
  const bellX = barX - s * 0.1;
  const bellY = barY - s * 0.06;
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.arc(bellX, bellY, Math.max(2, s * 0.06), Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(bellX - s * 0.015, bellY - s * 0.025, Math.max(1, s * 0.018), 0, Math.PI * 2);
  ctx.fill();
  if (pState.bellTimer > 0) {
    const bt = pState.bellTimer / 0.55;
    ctx.strokeStyle = `rgba(251, 188, 5, ${bt})`;
    ctx.lineWidth = Math.max(1.5, s * 0.035);
    for (let r = 1; r <= 2; r++) {
      const rr = s * (0.12 + (1 - bt) * 0.25 + r * 0.08);
      ctx.beginPath();
      ctx.arc(bellX, bellY - s * 0.03, rr, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
  }

  // Woven green front basket w/ rolled blue blueprint + red-lid coffee cup
  const bskX = barX + s * 0.06;
  const bskY = barY - s * 0.02;
  const bskW = s * 0.32;
  const bskH = s * 0.22;
  // Blueprint & coffee cup sticking out
  ctx.save();
  ctx.translate(bskX + bskW * 0.25, bskY);
  ctx.rotate(-0.22);
  ctx.fillStyle = '#60a5fa';
  ctx.fillRect(-s * 0.04, -s * 0.18, s * 0.09, s * 0.2);
  ctx.fillStyle = '#dbeafe';
  ctx.beginPath();
  ctx.ellipse(s * 0.005, -s * 0.18, s * 0.045, s * 0.02, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(bskX + bskW * 0.55, bskY - s * 0.12, s * 0.09, s * 0.14);
  ctx.fillStyle = '#ea4335';
  ctx.fillRect(bskX + bskW * 0.53, bskY - s * 0.14, s * 0.13, s * 0.04);

  // Basket body + weave
  ctx.fillStyle = '#34a853';
  ctx.strokeStyle = '#15803d';
  ctx.lineWidth = Math.max(1.5, s * 0.03);
  ctx.beginPath();
  ctx.roundRect(bskX, bskY, bskW, bskH, s * 0.04);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#81c995';
  ctx.lineWidth = Math.max(1, s * 0.018);
  ctx.beginPath();
  ctx.moveTo(bskX + bskW * 0.25, bskY + s * 0.03);
  ctx.lineTo(bskX + bskW * 0.25, bskY + bskH - s * 0.03);
  ctx.moveTo(bskX + bskW * 0.55, bskY + s * 0.03);
  ctx.lineTo(bskX + bskW * 0.55, bskY + bskH - s * 0.03);
  ctx.moveTo(bskX + s * 0.03, bskY + bskH * 0.5);
  ctx.lineTo(bskX + bskW - s * 0.03, bskY + bskH * 0.5);
  ctx.stroke();

  // Saddle
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.ellipse(seatX, seatY, s * 0.14, s * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // Near-side 2-joint pedaling leg + orange webbed foot
  const nearCrankX = bbX + Math.cos(wheelAngle) * s * 0.16 * yaw;
  const nearCrankY = bbY + Math.sin(wheelAngle) * s * 0.15;
  const nearKnee = solveTwoJointKnee(hipX, hipY, nearCrankX, nearCrankY, s * 0.27, s * 0.27, 1);
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = Math.max(2, s * 0.075);
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(nearKnee.x, nearKnee.y);
  ctx.lineTo(nearCrankX, nearCrankY);
  ctx.stroke();
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.ellipse(nearCrankX + s * 0.05, nearCrankY, s * 0.12, s * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  // Pelican Body (rotated forward smoothly when ducking)
  const bodyX = seatX + s * 0.04;
  const bodyY = seatY - s * 0.26 * duckSquash;
  const leanAngle = pDuck * 0.42;

  ctx.save();
  ctx.translate(bodyX, bodyY);
  ctx.rotate(leanAngle);

  // Far wing (smoothly interpolated by airBlend + wingPhase + dramatic wing-flap stroke, tucked on duck)
  const flapNorm = clamp(flapAnimTimer / FLAP_ANIM_DURATION, 0, 1);
  const isGliding = pState.flapGlideTimer > 0;
  // Powerful downstroke sweep when flapping: starts lifted high, snaps powerfully down, recovers into glide
  const flapStroke = flapNorm > 0 ? Math.sin(flapNorm * Math.PI * 2 - Math.PI * 0.35) * s * 0.42 : 0;
  const flap = Math.sin(wingPhase) * s * (0.06 + airBlend * 0.12) + flapStroke;
  const glideSpreadBoost = isGliding || flapNorm > 0 ? 0.32 : 0;
  const spread = (1 - pDuck * 0.65) * (0.45 + airBlend * 0.62 + glideSpreadBoost);
  const drawWing = (side) => {
    const wSpan = s * 0.78 * spread;
    const wLift = -s * 0.24 * airBlend + flap;
    ctx.fillStyle = '#f1f5f9';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = Math.max(1.2, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(side * s * 0.12, -s * 0.14);
    ctx.quadraticCurveTo(side * wSpan * 0.72, -s * 0.34 + wLift, side * wSpan, -s * 0.05 + wLift);
    ctx.quadraticCurveTo(side * wSpan * 0.45, s * 0.12, side * s * 0.1, s * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Charcoal primary wing tips
    ctx.fillStyle = '#5f6368';
    ctx.beginPath();
    ctx.moveTo(side * wSpan * 0.72, -s * 0.12 + wLift * 0.8);
    ctx.lineTo(side * wSpan, -s * 0.05 + wLift);
    ctx.lineTo(side * wSpan * 0.68, s * 0.05 + wLift * 0.4);
    ctx.closePath();
    ctx.fill();

    // Subtle sky-blue wind ribbons streaming off wingtips while gliding/flapping
    if (isGliding || flapNorm > 0) {
      const tipX = side * wSpan;
      const tipY = -s * 0.05 + wLift;
      ctx.strokeStyle = `rgba(186, 230, 253, ${0.42 + flapNorm * 0.38})`;
      ctx.lineWidth = Math.max(1.2, s * 0.025);
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.quadraticCurveTo(tipX - side * s * 0.18, tipY + s * 0.16, tipX - side * s * 0.38, tipY + s * 0.28);
      ctx.stroke();
    }
  };

  drawWing(-1);

  // Layered tail feathers
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(-s * 0.22, s * 0.06);
  ctx.lineTo(-s * 0.44, -s * 0.02);
  ctx.lineTo(-s * 0.38, s * 0.12);
  ctx.lineTo(-s * 0.46, s * 0.18);
  ctx.lineTo(-s * 0.2, s * 0.2);
  ctx.closePath();
  ctx.fill();

  // Plump white torso w/ subtle belly shading
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = Math.max(1.5, s * 0.03);
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.32, s * 0.34 * duckSquash, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#eef1f4';
  ctx.beginPath();
  ctx.ellipse(s * 0.08, s * 0.08, s * 0.2, s * 0.22 * duckSquash, 0, 0, Math.PI);
  ctx.fill();

  // Near wing
  drawWing(1);

  // Curved S-neck leading to head
  const headX = s * (0.14 + pDuck * 0.12);
  const headY = -s * 0.56 * duckSquash;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(3, s * 0.22);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s * 0.05, -s * 0.22 * duckSquash);
  ctx.bezierCurveTo(-s * 0.04, -s * 0.38 * duckSquash, headX + s * 0.08, headY + s * 0.16, headX, headY);
  ctx.stroke();

  // Head + feathered crest
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = Math.max(1.2, s * 0.025);
  ctx.beginPath();
  ctx.arc(headX, headY, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.moveTo(headX - s * 0.12, headY - s * 0.14);
  ctx.lineTo(headX - s * 0.28, headY - s * 0.22);
  ctx.lineTo(headX - s * 0.16, headY - s * 0.04);
  ctx.closePath();
  ctx.fill();

  // Hooked yellow upper bill + expandable golden throat pouch
  const pouchDrop = s * (0.14 + airBlend * 0.05 + (pState.bellTimer > 0 ? 0.06 : 0));
  ctx.fillStyle = '#f29900';
  ctx.beginPath();
  ctx.moveTo(headX + s * 0.12, headY + s * 0.02);
  ctx.lineTo(headX + s * 0.56, headY + s * 0.04);
  ctx.quadraticCurveTo(headX + s * 0.36, headY + pouchDrop + s * 0.12, headX + s * 0.1, headY + s * 0.12);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffcf70';
  ctx.beginPath();
  ctx.ellipse(headX + s * 0.3, headY + s * 0.1, s * 0.14, s * 0.045, 0.1, 0, Math.PI);
  ctx.fill();

  ctx.fillStyle = '#fbbc04';
  ctx.beginPath();
  ctx.moveTo(headX + s * 0.12, headY - s * 0.06);
  ctx.lineTo(headX + s * 0.6, headY + s * 0.02);
  ctx.lineTo(headX + s * 0.58, headY + s * 0.08);
  ctx.lineTo(headX + s * 0.52, headY + s * 0.05);
  ctx.lineTo(headX + s * 0.12, headY + s * 0.03);
  ctx.closePath();
  ctx.fill();

  // Expressive eye + specular highlight + brow
  const eyeX = headX + s * 0.08;
  const eyeY = headY - s * 0.04;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, Math.max(1.5, s * 0.055), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(eyeX + s * 0.012, eyeY, Math.max(1, s * 0.034), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(eyeX + s * 0.022, eyeY - s * 0.012, Math.max(0.6, s * 0.012), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.beginPath();
  ctx.moveTo(eyeX - s * 0.05, eyeY - s * 0.07);
  ctx.lineTo(eyeX + s * 0.06, eyeY - s * 0.05);
  ctx.stroke();

  // 4-color Google Noogler propeller beanie
  drawFourColorBeanie(ctx, headX, headY - s * 0.08, s * 0.19, worldTime);

  ctx.restore();
  ctx.restore();
}

function drawStanTRexChaser(ctx, s, worldTime) {
  const run = worldTime * 12;
  const stride = Math.sin(run) * s * 0.28;
  const jawSnap = Math.abs(Math.sin(worldTime * 8)) * 0.22;

  // Bone-white & warm ivory palette (Stan the Googleplex T-Rex skeleton!)
  ctx.strokeStyle = '#fef3c7';
  ctx.fillStyle = '#fef3c7';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Bounding skeleton hind legs
  [-1, 1].forEach((side) => {
    const ls = side === -1 ? stride : -stride;
    ctx.lineWidth = Math.max(2.5, s * 0.11);
    ctx.beginPath();
    ctx.moveTo(side * s * 0.18, -s * 0.72);
    ctx.lineTo(side * s * 0.24 + ls * 0.5, -s * 0.38);
    ctx.lineTo(side * s * 0.16 + ls, -s * 0.04);
    ctx.stroke();
    // 3 clawed toes
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(side * s * 0.08 + ls, -s * 0.02);
    ctx.lineTo(side * s * 0.26 + ls, -s * 0.02);
    ctx.stroke();
  });

  // Curved spine + ribcage
  ctx.lineWidth = Math.max(3, s * 0.12);
  ctx.beginPath();
  ctx.moveTo(-s * 0.52, -s * 0.88);
  ctx.quadraticCurveTo(-s * 0.1, -s * 1.15, s * 0.18, -s * 1.48);
  ctx.stroke();

  // Rib arches
  ctx.lineWidth = Math.max(1.5, s * 0.055);
  for (let r = 0; r < 4; r++) {
    const rx = -s * 0.22 + r * s * 0.11;
    const ry = -s * 1.02 - r * s * 0.06;
    ctx.beginPath();
    ctx.arc(rx, ry, s * 0.16, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }

  // Tiny T-Rex skeleton arms
  ctx.lineWidth = Math.max(1.5, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(s * 0.14, -s * 1.12);
  ctx.lineTo(s * 0.28, -s * 0.98);
  ctx.stroke();

  // Iconic T-Rex Skull + snapping jaw + teeth
  ctx.save();
  ctx.translate(s * 0.22, -s * 1.56);
  ctx.fillStyle = '#fef3c7';
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = Math.max(1.2, s * 0.03);
  // Upper skull
  ctx.beginPath();
  ctx.roundRect(-s * 0.22, -s * 0.22, s * 0.58, s * 0.26, s * 0.08);
  ctx.fill();
  ctx.stroke();
  // Eye socket
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(-s * 0.04, -s * 0.1, Math.max(2, s * 0.075), 0, Math.PI * 2);
  ctx.fill();
  // Lower jaw snapping
  ctx.save();
  ctx.rotate(jawSnap);
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.roundRect(-s * 0.12, s * 0.03, s * 0.44, s * 0.12, s * 0.05);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  // Speech bubble
  if (s > 30) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.beginPath();
    ctx.roundRect(-s * 0.72, -s * 2.25, s * 1.44, s * 0.36, 8);
    ctx.fill();
    ctx.fillStyle = '#fde047';
    ctx.font = `800 ${Math.max(10, Math.round(s * 0.17))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STAN ROAR! 🦖', 0, -s * 2.07);
  }
}

function drawMoonshotChaser(ctx, s, worldTime, campusIdx) {
  const hover = Math.sin(worldTime * 10) * s * 0.12;
  ctx.save();
  ctx.translate(0, hover);

  let label = 'PURSUIT!';
  let accent = '#38bdf8';
  let bodyCol = '#f8fafc';
  if (campusIdx === 6) {
    label = 'LIDAR LOCK! 📡';
    accent = '#00e5ff';
  } else if (campusIdx === 7) {
    label = 'DECOHERENCE! ⚛️';
    accent = '#f59e0b';
    bodyCol = '#1e3a8a';
  } else if (campusIdx === 8) {
    label = 'P0 INCIDENT! 🔥';
    accent = '#ea4335';
    bodyCol = '#334155';
  } else if (campusIdx === 9) {
    label = 'LOON RELAY! 🎈';
    accent = '#f472b6';
  } else if (campusIdx === 10) {
    label = 'WING EXPRESS! 📦';
    accent = '#fbbc05';
  } else {
    label = '99.8% WIN RATE!';
    accent = '#22d3ee';
    bodyCol = '#0f172a';
  }

  // Hover thruster glow
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.32;
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.12, s * 0.44, s * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Sleek Moonshot Bot chassis
  ctx.fillStyle = bodyCol;
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(2, s * 0.06);
  ctx.beginPath();
  ctx.roundRect(-s * 0.36, -s * 1.18, s * 0.72, s * 0.82, s * 0.22);
  ctx.fill();
  ctx.stroke();

  // Glowing visor eye
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.roundRect(-s * 0.24, -s * 1.0, s * 0.48, s * 0.24, s * 0.1);
  ctx.fill();
  ctx.fillStyle = accent;
  const eyeX = Math.sin(worldTime * 8) * s * 0.1;
  ctx.beginPath();
  ctx.arc(eyeX, -s * 0.88, Math.max(2, s * 0.08), 0, Math.PI * 2);
  ctx.fill();

  // Top spinning sensor/antenna
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1.5, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.18);
  ctx.lineTo(0, -s * 1.44);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(0, -s * 1.48, Math.max(2, s * 0.08), 0, Math.PI * 2);
  ctx.fill();

  if (s > 30) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.beginPath();
    ctx.roundRect(-s * 0.92, -s * 2.08, s * 1.84, s * 0.38, 8);
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    ctx.font = `800 ${Math.max(10, Math.round(s * 0.17))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, -s * 1.89);
  }
  ctx.restore();
}

function drawChaser(ctx, pState, px, worldTime, camX, camY, vp, campusIdx = 0) {
  const chaseVis = Math.max(pState.stumbleTimer, pState.introChaseTimer);
  if (chaseVis <= 0) return;
  const closeness = Math.min(1, chaseVis / 2.2);
  const cz = -1.6 - (1 - closeness) * 2.2;
  const p = projectPoint(px * 0.92, 0, cz, camX, camY, vp);
  if (!p) return;

  const s = p.scale * 0.88;
  const run = worldTime * 15;
  const bob = Math.abs(Math.sin(run)) * s * 0.14;

  ctx.save();
  ctx.translate(p.sx, p.sy - bob);

  // Iconic Stan the T-Rex Skeleton chases you in Mountain View!
  if (campusIdx === 0) {
    drawStanTRexChaser(ctx, s, worldTime);
    ctx.restore();
    return;
  }
  // Custom Alphabet Moonshot chaser bots in Levels 7–12!
  if (campusIdx >= 6) {
    drawMoonshotChaser(ctx, s, worldTime, campusIdx);
    ctx.restore();
    return;
  }

  // Running legs + sneakers
  const lStride = Math.sin(run) * s * 0.24;
  const rStride = Math.sin(run + Math.PI) * s * 0.24;
  const drawLeg = (stride, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, s * 0.12);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(stride * 0.2, -s * 0.5);
    ctx.lineTo(stride * 0.65, -s * 0.25);
    ctx.lineTo(stride, -s * 0.04);
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.ellipse(stride + s * 0.04, -s * 0.02, s * 0.1, s * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  drawLeg(lStride, '#1e293b');

  // Pumping far arm
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-s * 0.14, -s * 0.96);
  ctx.lineTo(-s * 0.34 - lStride * 0.4, -s * 0.72);
  ctx.stroke();

  // Forward-leaning torso
  ctx.save();
  ctx.translate(0, -s * 0.76);
  ctx.rotate(0.12);
  ctx.fillStyle = '#475569';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = Math.max(1.5, s * 0.045);
  ctx.beginPath();
  ctx.roundRect(-s * 0.24, -s * 0.36, s * 0.48, s * 0.64, s * 0.14);
  ctx.fill();
  ctx.stroke();
  for (let i = 0; i < CHASER_PALETTE.length; i++) {
    ctx.fillStyle = CHASER_PALETTE[i];
    ctx.fillRect(s * (-0.14 + i * 0.07), -s * 0.14, s * 0.065, s * 0.055);
  }
  ctx.restore();

  drawLeg(rStride, '#0f172a');

  // Pumping near arm + hand
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = Math.max(2, s * 0.1);
  ctx.beginPath();
  ctx.moveTo(s * 0.18, -s * 0.98);
  ctx.lineTo(s * 0.34 + rStride * 0.4, -s * 0.76);
  ctx.stroke();
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.arc(s * 0.34 + rStride * 0.4, -s * 0.76, Math.max(1.5, s * 0.06), 0, Math.PI * 2);
  ctx.fill();

  // Head + shouting mouth + 4-color Noogler propeller cap
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.arc(s * 0.06, -s * 1.32, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#991b1b';
  ctx.beginPath();
  ctx.ellipse(s * 0.14, -s * 1.24, s * 0.05, s * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();

  // 4-color beanie
  drawFourColorBeanie(ctx, s * 0.06, -s * 1.38, s * 0.2, worldTime * 1.2);
  for (let i = 0; i < CHASER_PALETTE.length; i++) {
    // subtle color accent dot on brim
    ctx.fillStyle = CHASER_PALETTE[i];
    ctx.fillRect(s * (-0.1 + i * 0.08), -s * 1.4, s * 0.06, s * 0.03);
  }

  // Speech bubble with tail
  if (s > 24) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.beginPath();
    ctx.roundRect(-s * 0.92, -s * 2.08, s * 1.84, s * 0.38, 8);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.08, -s * 1.7);
    ctx.lineTo(s * 0.04, -s * 1.56);
    ctx.lineTo(s * 0.12, -s * 1.7);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#fef08a';
    ctx.font = `800 ${Math.max(10, Math.round(s * 0.17))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HEY! MY GBIKE!', 0, -s * 1.89);
  }
  ctx.restore();
}

function drawSpeedLines(ctx, W, H, horizonY, speed, sparkleTimer, worldTime) {
  if (speed <= 20 && sparkleTimer <= 0) return;
  const intensity = clamp(Math.max((speed - 20) / 22, sparkleTimer > 0 ? 0.72 : 0), 0, 1);
  if (intensity <= 0.02) return;

  const cx = W * 0.5;
  const cy = horizonY + (H - horizonY) * 0.35;
  const minR = Math.min(W, H) * 0.42;
  const maxR = Math.hypot(W, H) * 0.62;

  ctx.save();
  ctx.strokeStyle = sparkleTimer > 0
    ? `rgba(232, 121, 249, ${0.32 * intensity})`
    : `rgba(248, 250, 252, ${0.24 * intensity})`;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';

  for (let i = 0; i < 18; i++) {
    const ang = (i * Math.PI * 2) / 18 + Math.sin(i * 1.7) * 0.12;
    const t = (worldTime * 3.8 + i * 0.37) % 1;
    const r0 = minR + t * (maxR - minR) * 0.65;
    const r1 = r0 + 26 + intensity * 44;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
    ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    ctx.stroke();
  }
  ctx.restore();
}

const U_OVERLAP_PAD = 0.01;
let topoAdjCap = 0;
let topoAdj = new Uint8Array(0);
let topoInDeg = new Int32Array(0);
let topoUsed = new Uint8Array(0);

function ensureTopoBuffers(n) {
  if (n > topoAdjCap) {
    topoAdjCap = Math.max(64, n * 2);
    topoAdj = new Uint8Array(topoAdjCap * topoAdjCap);
    topoInDeg = new Int32Array(topoAdjCap);
    topoUsed = new Uint8Array(topoAdjCap);
  } else {
    topoAdj.fill(0, 0, n * n);
    topoInDeg.fill(0, 0, n);
    topoUsed.fill(0, 0, n);
  }
}

function computeUInterval(xMin, xMax, zMin, zMax, camX) {
  const zNear = Math.max(ROAD_NEAR_CLIP, zMin);
  const zFar = Math.min(MAX_Z, Math.max(zNear, zMax));
  const dzNear = Math.max(Z_NEAR_CLIP, zNear + CAM_DIST);
  const dzFar = Math.max(dzNear, zFar + CAM_DIST);
  const uMin = xMin >= camX ? (xMin - camX) / dzFar : (xMin - camX) / dzNear;
  const uMax = xMax <= camX ? (xMax - camX) / dzFar : (xMax - camX) / dzNear;
  return { uMin, uMax };
}

function hasScreenOverlap(cx, halfW, ozStart, px, py, camX, camY, vp) {
  const nearCornerX = clamp(camX, cx - halfW, cx + halfW);
  const nearDx = nearCornerX - camX;
  const playerDx = px - camX;
  const sameSide = nearDx === 0 || nearDx * playerDx > 0;
  const closerToCam = Math.abs(nearDx) < Math.abs(playerDx) || (nearDx === 0 && playerDx === 0);
  if (!sameSide || !closerToCam || ozStart >= -0.15) return false;
  const zProbe = Math.max(VEHICLE_NEAR_CLIP, ozStart);
  const vL = projectPoint(cx - halfW, 0, zProbe, camX, camY, vp);
  const vR = projectPoint(cx + halfW, 0, zProbe, camX, camY, vp);
  const pL = projectPoint(px - 0.55, py, 0, camX, camY, vp);
  const pR = projectPoint(px + 0.55, py, 0, camX, camY, vp);
  return Boolean(vL && vR && pL && pR && vR.sx >= pL.sx && vL.sx <= pR.sx);
}

function isPlayerOnVehicleRamp(o, ozStart, px, gs) {
  if (!o.hasRamp || !gs.player.onRamp) return false;
  if (gs.player.rampVehicle) return gs.player.rampVehicle === o;
  return (
    Math.abs(px - o.lane * LANE_W) <= VEHICLE_SUPPORT_HALF_W &&
    ozStart >= -0.25 &&
    ozStart - RAMP_LEN <= 0.4
  );
}

function comparePlayerVsItem(other, gs, px, py, camX, camY, vp) {
  if (other.kind === 'prop') {
    if (other.zNear > 0) return 1;
    if (other.zFar < 0) return -1;
    return 1;
  }
  if (other.kind === 'collectible') {
    if (other.hostVehId != null) {
      return other.cz < 0 || py < ROOF_H - 0.25 ? -1 : 0;
    }
    return other.cz > 0 ? 1 : -1;
  }
  const o = other.obj;
  if (other.ozStart > 0) return 1;
  if (other.ozEnd < 0) return -1;

  if (o.type === 'vehicle') {
    if (py >= ROOF_H - 0.25 || isPlayerOnVehicleRamp(o, other.ozStart, px, gs)) return 1;
    return hasScreenOverlap(o.lane * LANE_W, VEHICLE_HALF_W, other.ozStart, px, py, camX, camY, vp) ? -1 : 1;
  }
  if (o.type === 'low') {
    if (py >= LOW_HURDLE_CLEAR_Y) return 1;
    return hasScreenOverlap(o.lane * LANE_W, HURDLE_HALF_W, other.ozStart, px, py, camX, camY, vp) ? -1 : 1;
  }
  if (py >= HIGH_GANTRY_TOP_Y) return 1;
  const cx = o.lane * LANE_W;
  if (Math.abs(px - cx) <= GANTRY_HALF_W && other.ozStart < 0) return -1;
  return hasScreenOverlap(cx, GANTRY_HALF_W, other.ozStart, px, py, camX, camY, vp) ? -1 : 1;
}

function compareOcclusion(a, b, gs, px, py, camX, camY, vp) {
  if (a.kind === 'obstacle' && b.kind === 'collectible' && b.hostVehId === a.obj.id) return -1;
  if (b.kind === 'obstacle' && a.kind === 'collectible' && a.hostVehId === b.obj.id) return 1;

  if ((a.xMax < camX && b.xMin > camX) || (b.xMax < camX && a.xMin > camX)) return 0;
  if (Math.min(a.uMax, b.uMax) + U_OVERLAP_PAD < Math.max(a.uMin, b.uMin)) return 0;

  if (a.kind === 'player') return comparePlayerVsItem(b, gs, px, py, camX, camY, vp);
  if (b.kind === 'player') return -comparePlayerVsItem(a, gs, px, py, camX, camY, vp);

  if (a.zNear > b.zFar) return -1;
  if (b.zNear > a.zFar) return 1;

  if (a.xMax < b.xMin) {
    if (camX <= a.xMax) return 1;
    if (camX >= b.xMin) return -1;
    return 0;
  }
  if (b.xMax < a.xMin) {
    if (camX <= b.xMax) return -1;
    if (camX >= a.xMin) return 1;
    return 0;
  }

  if (a.kind === 'obstacle' && a.obj.type !== 'vehicle' && b.kind === 'collectible') return -1;
  if (b.kind === 'obstacle' && b.obj.type !== 'vehicle' && a.kind === 'collectible') return 1;

  if (a.kind === 'obstacle' && a.obj.type === 'vehicle' && b.kind === 'collectible') {
    if (b.cy >= ROOF_H - 0.1 && b.cz >= a.zBodyNear) return -1;
  }
  if (b.kind === 'obstacle' && b.obj.type === 'vehicle' && a.kind === 'collectible') {
    if (a.cy >= ROOF_H - 0.1 && a.cz >= b.zBodyNear) return 1;
  }

  if (a.kind === 'obstacle' && b.kind === 'obstacle') {
    if (a.zBodyNear !== b.zBodyNear) return a.zBodyNear > b.zBodyNear ? -1 : 1;
  }

  if (a.zNear !== b.zNear) return a.zNear > b.zNear ? -1 : 1;
  if (a.zFar !== b.zFar) return a.zFar > b.zFar ? -1 : 1;
  if (a.latDist !== b.latDist) return a.latDist > b.latDist ? -1 : 1;
  return 0;
}

function isBetterDrawCandidate(cand, best) {
  if (cand.sortFallbackZ !== best.sortFallbackZ) return cand.sortFallbackZ > best.sortFallbackZ;
  if (cand.latDist !== best.latDist) return cand.latDist > best.latDist;
  return cand.orderIdx < best.orderIdx;
}

function sortDrawListTopologically(drawList, gs, px, py, camX, camY, vp) {
  const n = drawList.length;
  if (n <= 1) return drawList;
  ensureTopoBuffers(n);

  for (let i = 0; i < n; i++) {
    const a = drawList[i];
    for (let j = i + 1; j < n; j++) {
      const cmp = compareOcclusion(a, drawList[j], gs, px, py, camX, camY, vp);
      if (cmp < 0) {
        topoAdj[i * n + j] = 1;
        topoInDeg[j] += 1;
      } else if (cmp > 0) {
        topoAdj[j * n + i] = 1;
        topoInDeg[i] += 1;
      }
    }
  }

  const out = new Array(n);
  for (let step = 0; step < n; step++) {
    let bestIdx = -1;
    for (let k = 0; k < n; k++) {
      if (topoUsed[k] || topoInDeg[k] !== 0) continue;
      if (bestIdx === -1 || isBetterDrawCandidate(drawList[k], drawList[bestIdx])) {
        bestIdx = k;
      }
    }
    if (bestIdx === -1) {
      let bestDeg = Infinity;
      for (let k = 0; k < n; k++) {
        if (topoUsed[k]) continue;
        const deg = topoInDeg[k];
        if (
          bestIdx === -1 ||
          deg < bestDeg ||
          (deg === bestDeg && isBetterDrawCandidate(drawList[k], drawList[bestIdx]))
        ) {
          bestIdx = k;
          bestDeg = deg;
        }
      }
    }
    topoUsed[bestIdx] = 1;
    out[step] = drawList[bestIdx];
    const rowOff = bestIdx * n;
    for (let m = 0; m < n; m++) {
      if (!topoUsed[m] && topoAdj[rowOff + m]) {
        topoInDeg[m] -= 1;
      }
    }
  }
  return out;
}

export function renderScene(ctx, gs, alpha = 1) {
  const vp = gs.viewport;
  const W = vp.cssW;
  const H = vp.cssH;
  const dpr = vp.dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (gs.state === 'credits') {
    renderCreditsScene(ctx, gs, W, H);
    return;
  }

  const camX = lerp(gs.camera.prevX, gs.camera.x, alpha);
  const camY = lerp(gs.camera.prevY, gs.camera.y, alpha);
  const camRoll = lerp(gs.camera.prevRoll, gs.camera.roll, alpha);
  const camPitch = lerp(gs.camera.prevPitch, gs.camera.pitch, alpha);
  const shakeX = lerp(gs.camera.prevShakeX, gs.camera.shakeX, alpha);
  const shakeY = lerp(gs.camera.prevShakeY, gs.camera.shakeY, alpha);
  const roadScroll = lerp(gs.prevRoadScroll, gs.roadScroll, alpha);
  const worldTime = lerp(gs.prevWorldTime, gs.worldTime, alpha);
  const transition = lerp(gs.prevCampusTransition, gs.campusTransition, alpha);

  const targetCampus = getCampus(gs.campusIdx);
  const fromCampus = getCampus(gs.prevCampusIdx);
  const c = transition >= 1 ? targetCampus : lerpCampus(fromCampus, targetCampus, transition);

  const pitchPy = camPitch * H;
  ctx.save();
  ctx.translate(W * 0.5 + shakeX, H * 0.5 + shakeY);
  if (camRoll !== 0) ctx.rotate(camRoll);
  ctx.translate(-W * 0.5, -H * 0.5 + pitchPy);

  drawSkyAndLandmarks(ctx, c, fromCampus, targetCampus, transition, camX, worldTime, vp);
  drawRoad(ctx, c, roadScroll, camX, camY, vp);

  // Build obstacle interpolation + sortZ mapping before collectibles so roof items know host sortZ
  const px = lerp(gs.player.prevX, gs.player.x, alpha);
  const py = lerp(gs.player.prevY, gs.player.y, alpha);
  const roofItemsByVehId = new Map();
  const roofCollectibleIds = new Set();
  const vehSortZById = new Map();

  const obsInterp = [];
  for (let i = 0; i < gs.obstacles.length; i++) {
    const o = gs.obstacles[i];
    if (o.smashed) continue;
    const ozStart = lerp(o.prevZStart, o.zStart, alpha);
    const ozEnd = lerp(o.prevZEnd, o.zEnd, alpha);
    const zBodyNear = Math.max(VEHICLE_NEAR_CLIP, ozStart);
    const zBodyFar = Math.min(MAX_Z, ozEnd);
    if (zBodyFar <= zBodyNear || zBodyNear > MAX_Z) continue;
    let sortZ = ozStart;
    if (o.type === 'vehicle') {
      if (ozStart > 0) {
        sortZ = Math.max(0.06, ozStart);
      } else if (ozEnd < 0) {
        sortZ = ozEnd;
      } else if (py >= ROOF_H - 0.25 || isPlayerOnVehicleRamp(o, ozStart, px, gs)) {
        sortZ = 0.055;
      } else {
        const screenOverlap = hasScreenOverlap(
          o.lane * LANE_W,
          VEHICLE_HALF_W,
          ozStart,
          px,
          py,
          camX,
          camY,
          vp
        );
        sortZ = screenOverlap ? -0.1 : 0.055;
      }
      vehSortZById.set(o.id, sortZ);
    }
    obsInterp.push({ o, ozStart, ozEnd, zBodyNear, zBodyFar, sortZ });
  }

  const drawList = [];

  for (let i = 0; i < gs.collectibles.length; i++) {
    const col = gs.collectibles[i];
    if (col.collected) continue;
    const cz = lerp(col.prevZ, col.z, alpha);
    const cx = lerp(col.prevX, col.x, alpha);
    const cy = lerp(col.prevY, col.y, alpha);

    let hostVeh = null;
    if (cy >= ROOF_H - 0.1) {
      for (let j = 0; j < obsInterp.length; j++) {
        const entry = obsInterp[j];
        if (entry.o.type !== 'vehicle') continue;
        if (
          col.lane === entry.o.lane &&
          Math.abs(cx - entry.o.lane * LANE_W) <= VEHICLE_HALF_W &&
          cz >= entry.ozStart - 0.5 &&
          cz <= entry.ozEnd + 0.5
        ) {
          hostVeh = entry.o;
          break;
        }
      }
    }

    if (hostVeh) {
      roofCollectibleIds.add(col.id);
      const hostSortZ = vehSortZById.get(hostVeh.id);
      if (cz >= Math.min(0, hostSortZ)) {
        let arr = roofItemsByVehId.get(hostVeh.id);
        if (!arr) {
          arr = [];
          roofItemsByVehId.set(hostVeh.id, arr);
        }
        arr.push({ obj: col, cx, cy, cz });
      } else {
        const rW = col.type === 'sparkle' ? 0.55 : 0.36;
        const xMin = cx - rW;
        const xMax = cx + rW;
        const u = computeUInterval(xMin, xMax, cz, cz, camX);
        drawList.push({
          kind: 'collectible',
          obj: col,
          cx,
          cy,
          cz,
          onRoof: true,
          hostVehId: hostVeh.id,
          xMin,
          xMax,
          zNear: cz,
          zFar: cz,
          uMin: u.uMin,
          uMax: u.uMax,
          latDist: Math.abs(clamp(camX, xMin, xMax) - camX),
          sortFallbackZ: cz,
          orderIdx: drawList.length,
        });
      }
    } else {
      const rW = col.type === 'sparkle' ? 0.55 : 0.36;
      const xMin = cx - rW;
      const xMax = cx + rW;
      const u = computeUInterval(xMin, xMax, cz, cz, camX);
      drawList.push({
        kind: 'collectible',
        obj: col,
        cx,
        cy,
        cz,
        onRoof: false,
        hostVehId: null,
        xMin,
        xMax,
        zNear: cz,
        zFar: cz,
        uMin: u.uMin,
        uMax: u.uMax,
        latDist: Math.abs(clamp(camX, xMin, xMax) - camX),
        sortFallbackZ: cz,
        orderIdx: drawList.length,
      });
    }
  }

  roofItemsByVehId.forEach((arr) => arr.sort((a, b) => b.cz - a.cz));

  // Pass A: Dedicated ground contact shadows
  drawGroundShadows(ctx, gs, alpha, roofCollectibleIds, camX, camY, vp);

  for (let i = 0; i < gs.roadProps.length; i++) {
    const rp = gs.roadProps[i];
    const pz = lerp(rp.prevZ, rp.z, alpha);
    const cx = rp.side * LANE_W * 2.25;
    const xMin = cx - 1.25;
    const xMax = cx + 1.25;
    const u = computeUInterval(xMin, xMax, pz, pz, camX);
    drawList.push({
      kind: 'prop',
      obj: rp,
      zVal: pz,
      xMin,
      xMax,
      zNear: pz,
      zFar: pz,
      uMin: u.uMin,
      uMax: u.uMax,
      latDist: Math.abs(clamp(camX, xMin, xMax) - camX),
      sortFallbackZ: pz,
      orderIdx: drawList.length,
    });
  }

  for (let i = 0; i < obsInterp.length; i++) {
    const { o, ozStart, ozEnd, zBodyNear, zBodyFar } = obsInterp[i];
    const cx = o.lane * LANE_W;
    const hw = o.type === 'vehicle' ? VEHICLE_HALF_W : (o.type === 'high' ? GANTRY_HALF_W : HURDLE_HALF_W);
    const xMin = cx - hw;
    const xMax = cx + hw;
    const zNear = o.type === 'vehicle'
      ? ((o.hasRamp && ozStart > VEHICLE_NEAR_CLIP) ? Math.max(VEHICLE_NEAR_CLIP, ozStart - RAMP_LEN) : zBodyNear)
      : (o.type === 'low' ? zBodyNear - 0.12 : zBodyNear);
    const zFar = o.type === 'low' ? zBodyFar + 0.12 : zBodyFar;
    const u = computeUInterval(xMin, xMax, zNear, zFar, camX);
    drawList.push({
      kind: 'obstacle',
      obj: o,
      ozStart,
      ozEnd,
      xMin,
      xMax,
      zBodyNear,
      zNear,
      zFar,
      uMin: u.uMin,
      uMax: u.uMax,
      latDist: Math.abs(clamp(camX, xMin, xMax) - camX),
      sortFallbackZ: Math.max(VEHICLE_NEAR_CLIP, ozStart),
      orderIdx: drawList.length,
    });
  }

  const pXMin = px - 0.55;
  const pXMax = px + 0.55;
  const pU = computeUInterval(pXMin, pXMax, -0.38, 0.42, camX);
  drawList.push({
    kind: 'player',
    obj: null,
    xMin: pXMin,
    xMax: pXMax,
    zNear: -0.38,
    zFar: 0.42,
    uMin: pU.uMin,
    uMax: pU.uMax,
    latDist: Math.abs(clamp(camX, pXMin, pXMax) - camX),
    sortFallbackZ: 0,
    orderIdx: drawList.length,
  });

  const sortedDrawList = sortDrawListTopologically(drawList, gs, px, py, camX, camY, vp);

  const drawRoofShadow = (cx, cz) => {
    const sh = projectPoint(cx, ROOF_H + 0.02, cz, camX, camY, vp);
    if (!sh) return;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.32)';
    ctx.beginPath();
    ctx.ellipse(sh.sx, sh.sy, Math.max(2, sh.scale * 0.28), Math.max(1, sh.scale * 0.1), 0, 0, Math.PI * 2);
    ctx.fill();
  };

  for (let i = 0; i < sortedDrawList.length; i++) {
    const item = sortedDrawList[i];
    if (item.kind === 'prop') {
      drawRoadProp(ctx, item.obj, item.zVal, fromCampus, targetCampus, transition, camX, camY, vp, worldTime);
    } else if (item.kind === 'obstacle') {
      const o = item.obj;
      if (o.type === 'vehicle') {
        drawVehicle(ctx, o, item.ozStart, item.ozEnd, c, targetCampus, camX, camY, vp, gs.campusIdx);
        const roofItems = roofItemsByVehId.get(o.id);
        if (roofItems) {
          for (let r = 0; r < roofItems.length; r++) {
            const ri = roofItems[r];
            drawRoofShadow(ri.cx, ri.cz);
            drawCollectible(ctx, ri.obj, ri.cx, ri.cy, ri.cz, worldTime, camX, camY, vp);
          }
        }
      } else if (o.type === 'low') {
        drawLowHurdle(ctx, o, item.ozStart, item.ozEnd, camX, camY, vp);
      } else if (o.type === 'high') {
        drawHighGantry(ctx, o, item.ozStart, item.ozEnd, camX, camY, vp);
      } else if (o.type === 'aerial') {
        drawAerialHazard(ctx, o, item.ozStart, worldTime, camX, camY, vp);
      }
    } else if (item.kind === 'collectible') {
      if (item.onRoof) drawRoofShadow(item.cx, item.cz);
      drawCollectible(ctx, item.obj, item.cx, item.cy, item.cz, worldTime, camX, camY, vp);
    } else if (item.kind === 'player') {
      drawPelicanOnGBike(ctx, gs.player, alpha, worldTime, camX, camY, vp);
    }
  }

  drawChaser(ctx, gs.player, px, worldTime, camX, camY, vp, gs.campusIdx);

  for (let i = 0; i < gs.particles.length; i++) {
    const pt = gs.particles[i];
    const ptx = lerp(pt.prevX, pt.x, alpha);
    const pty = lerp(pt.prevY, pt.y, alpha);
    const ptz = lerp(pt.prevZ, pt.z, alpha);
    const proj = projectPoint(ptx, pty, ptz, camX, camY, vp);
    if (!proj) continue;
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.fillStyle = pt.color;
    const r = Math.max(2, proj.scale * pt.size);
    ctx.beginPath();
    ctx.arc(proj.sx, proj.sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (let i = 0; i < gs.floatingTexts.length; i++) {
    const ft = gs.floatingTexts[i];
    const fwy = lerp(ft.prevWy, ft.wy, alpha);
    const proj = projectPoint(ft.wx, fwy, ft.wz, camX, camY, vp);
    if (!proj) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
    ctx.font = `900 ${Math.max(14, Math.round(W * 0.022))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(ft.text, proj.sx + 2, proj.sy + 2);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, proj.sx, proj.sy);
    ctx.restore();
  }

  ctx.restore();

  drawAmbientWeather(ctx, targetCampus.id, worldTime, W, H);
  drawSpeedLines(ctx, W, H, vp.horizonY, gs.speed, Math.max(gs.player.sparkleTimer, gs.player.hoverTimer), worldTime);

  if (gs.campusBannerTimer > 0) {
    const bannerAlpha = Math.min(1, gs.campusBannerTimer);
    ctx.save();
    ctx.globalAlpha = bannerAlpha;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
    ctx.beginPath();
    ctx.roundRect(W * 0.5 - 170, H * 0.16, 340, 46, 23);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 17px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${targetCampus.name} · ${targetCampus.vehicleName}`, W * 0.5, H * 0.16 + 23);
    ctx.restore();
  }
}

function drawAmbientWeather(ctx, campusId, worldTime, W, H) {
  ctx.save();
  if (campusId === 'tokyo') {
    // Drifting pink sakura petals
    for (let i = 0; i < 20; i++) {
      const seed = i * 97.3;
      const x = ((seed * 13 + worldTime * (42 + (i % 5) * 8) + Math.sin(worldTime * 2 + i) * 24) % (W + 40)) - 20;
      const y = ((seed * 7 + worldTime * (28 + (i % 4) * 7)) % (H + 30)) - 15;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(worldTime * 1.8 + i);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(249, 168, 212, 0.72)' : 'rgba(251, 207, 232, 0.65)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.5, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else if (campusId === 'london') {
    // Crisp angled light drizzle
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.28)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 34; i++) {
      const seed = i * 73.1;
      const x = ((seed * 17 - worldTime * 140) % (W + 60) + (W + 60)) % (W + 60) - 30;
      const y = ((seed * 11 + worldTime * 420) % (H + 40)) - 20;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 6, y + 18);
    }
    ctx.stroke();
  } else if (campusId === 'zurich') {
    // Gentle drifting alpine snow flurries
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    for (let i = 0; i < 24; i++) {
      const seed = i * 59.7;
      const x = ((seed * 19 + Math.sin(worldTime * 1.4 + i) * 22 + worldTime * 16) % (W + 20)) - 10;
      const y = ((seed * 13 + worldTime * (34 + (i % 4) * 8)) % (H + 20)) - 10;
      ctx.beginPath();
      ctx.arc(x, y, 1.8 + (i % 3) * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (campusId === 'sydney') {
    // Sparkling harbor sea-spray droplets
    ctx.fillStyle = 'rgba(224, 242, 254, 0.42)';
    for (let i = 0; i < 18; i++) {
      const seed = i * 83.9;
      const x = ((seed * 15 - worldTime * 55) % (W + 30) + (W + 30)) % (W + 30) - 15;
      const y = H * 0.35 + ((seed * 9 + Math.sin(worldTime * 3 + i) * 14) % (H * 0.6));
      ctx.beginPath();
      ctx.arc(x, y, 1.5 + (i % 3) * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (campusId === 'waymo') {
    // Cyan LiDAR twilight dust motes
    ctx.fillStyle = 'rgba(0, 229, 255, 0.45)';
    for (let i = 0; i < 16; i++) {
      const seed = i * 67.3;
      const x = ((seed * 17 + worldTime * 26) % W);
      const y = ((seed * 13 + Math.sin(worldTime * 2 + i) * 18) % H);
      ctx.beginPath();
      ctx.arc(x, y, 1.8 + (i % 2), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (campusId === 'quantum') {
    // Rising golden & cyan cryogenic quantum sparks
    for (let i = 0; i < 20; i++) {
      const seed = i * 79.1;
      const x = ((seed * 13 + Math.sin(worldTime * 1.5 + i) * 16) % W);
      const y = ((H - ((seed * 11 + worldTime * 36) % H)) % H);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(251, 191, 36, 0.55)' : 'rgba(56, 189, 248, 0.55)';
      ctx.beginPath();
      ctx.arc(x, y, 2 + (i % 2), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (campusId === 'tpu') {
    // Vertical streaming 4-color fiber-optic data streaks
    const cols = ['rgba(66,133,244,0.45)', 'rgba(234,67,53,0.4)', 'rgba(251,188,5,0.45)', 'rgba(52,168,83,0.45)'];
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 18; i++) {
      const seed = i * 61.9;
      const x = ((seed * 19) % W);
      const y = ((seed * 7 + worldTime * (220 + (i % 4) * 40)) % (H + 40)) - 20;
      ctx.strokeStyle = cols[i % 4];
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 16);
      ctx.stroke();
    }
  } else if (campusId === 'loon') {
    // Fast-streaming stratospheric ice crystals
    ctx.fillStyle = 'rgba(224, 242, 254, 0.65)';
    for (let i = 0; i < 22; i++) {
      const seed = i * 91.7;
      const x = ((seed * 15 - worldTime * 95) % W + W) % W;
      const y = ((seed * 11 + Math.sin(worldTime * 2 + i) * 10) % H);
      ctx.fillRect(x, y, 4, 1.5);
    }
  } else if (campusId === 'deepmind') {
    // Iridescent neural-net cyan/purple motes
    for (let i = 0; i < 18; i++) {
      const seed = i * 87.3;
      const x = ((seed * 13 + Math.cos(worldTime + i) * 20) % W);
      const y = ((seed * 9 + worldTime * 22) % H);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(34, 211, 238, 0.48)' : 'rgba(168, 85, 247, 0.45)';
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Subtle California / NYC / Wing golden warm sun motes
    ctx.fillStyle = 'rgba(254, 240, 138, 0.26)';
    for (let i = 0; i < 12; i++) {
      const seed = i * 113.7;
      const x = ((seed * 11 + worldTime * 12) % W);
      const y = ((seed * 7 + Math.sin(worldTime * 1.2 + i) * 18) % (H * 0.65));
      ctx.beginPath();
      ctx.arc(x, y, 2 + (i % 2), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// =========================================================================
// END OF THE EARTH — RETRO ROLLING CREDITS FINALE (Inspired by Pelican on a Bike!)
// =========================================================================
function renderCreditsScene(ctx, gs, W, H) {
  const t = gs.worldTime;
  const elapsed = gs.creditsElapsed || 0;
  const isNarrow = W < 600;

  // 1. Deep Cosmic Gradient
  const cosmos = ctx.createLinearGradient(0, 0, W, H);
  cosmos.addColorStop(0, '#040612');
  cosmos.addColorStop(0.45, '#0b0f29');
  cosmos.addColorStop(0.78, '#170c30');
  cosmos.addColorStop(1, '#050714');
  ctx.fillStyle = cosmos;
  ctx.fillRect(0, 0, W, H);

  // Cosmic Nebulae
  const nebulae = [
    [W * 0.68, H * 0.34, Math.min(W, H) * 0.42, 'rgba(138, 43, 226, 0.24)'],
    [W * 0.46, H * 0.52, Math.min(W, H) * 0.36, 'rgba(0, 229, 255, 0.16)'],
    [W * 0.82, H * 0.62, Math.min(W, H) * 0.34, 'rgba(255, 61, 245, 0.18)'],
  ];
  for (let i = 0; i < nebulae.length; i++) {
    const [nx, ny, nr, col] = nebulae[i];
    const ng = ctx.createRadialGradient(nx, ny, 8, nx, ny, nr);
    ng.addColorStop(0, col);
    ng.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ng;
    ctx.beginPath();
    ctx.arc(nx, ny, nr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Twinkling Starfield (110 organic stars)
  for (let s = 0; s < 110; s++) {
    const hx = Math.sin(s * 127.1 + 311.7) * 43758.5453;
    const hy = Math.sin(s * 269.5 + 183.3) * 43758.5453;
    const sx = (hx - Math.floor(hx)) * W;
    const sy = (hy - Math.floor(hy)) * H;
    const tw = 0.38 + 0.62 * Math.sin(t * (1.8 + (s % 4) * 0.5) + s * 1.7);
    const rad = s % 10 === 0 ? 2.2 : (s % 3 === 0 ? 1.4 : 0.9);
    ctx.fillStyle =
      s % 11 === 0
        ? `rgba(126, 249, 255, ${tw.toFixed(2)})`
        : s % 13 === 0
          ? `rgba(255, 170, 245, ${tw.toFixed(2)})`
          : `rgba(255, 255, 255, ${tw.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ringed Cosmic Planet (upper right)
  const px = W * 0.87;
  const py = H * 0.17;
  ctx.save();
  ctx.translate(px, py);
  ctx.strokeStyle = 'rgba(255, 195, 113, 0.58)';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 36, 9, -0.28, 0, Math.PI * 2);
  ctx.stroke();
  const pg = ctx.createRadialGradient(-6, -6, 2, 0, 0, 18);
  pg.addColorStop(0, '#ffcf98');
  pg.addColorStop(0.65, '#c864b4');
  pg.addColorStop(1, '#3c1e5e');
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Occasional Shooting Star
  const shootCycle = (t * 0.42) % 3.2;
  if (shootCycle < 0.7) {
    const st = shootCycle / 0.7;
    const sx0 = W * 0.82 - st * 240;
    const sy0 = H * 0.08 + st * 95;
    const sg = ctx.createLinearGradient(sx0, sy0, sx0 + 56, sy0 - 22);
    sg.addColorStop(0, 'rgba(255,255,255,0.95)');
    sg.addColorStop(1, 'rgba(126,249,255,0)');
    ctx.strokeStyle = sg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx0, sy0);
    ctx.lineTo(sx0 + 56, sy0 - 22);
    ctx.stroke();
  }

  // 2. Flat-Earth Cliff Edge (left side ends sharply into the cosmos!)
  const groundY = H * 0.72;
  const cliffX = isNarrow ? W * 0.36 : W * 0.35;
  ctx.fillStyle = '#4a3728';
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(cliffX, groundY);
  ctx.lineTo(cliffX + 8, groundY + 18);
  ctx.lineTo(cliffX - 12, groundY + 46);
  ctx.lineTo(cliffX - 28, groundY + 86);
  ctx.lineTo(cliffX - 52, H + 10);
  ctx.lineTo(0, H + 10);
  ctx.closePath();
  ctx.fill();

  // Bike path & grass lip on the cliff edge
  ctx.fillStyle = '#6b727a';
  ctx.fillRect(0, groundY + 4, cliffX + 10, 18);
  ctx.fillStyle = '#34a853';
  ctx.fillRect(0, groundY - 4, cliffX + 14, 9);

  // 3. Cartoonish Wooden Sign: "DANGER: END OF THE EARTH"
  const signX = cliffX - 42;
  ctx.save();
  ctx.translate(signX, groundY + 2);
  ctx.rotate(0.06);
  ctx.fillStyle = '#6d4528';
  ctx.strokeStyle = '#3a2212';
  ctx.lineWidth = 2;
  ctx.fillRect(-5, -104, 10, 106);
  ctx.strokeRect(-5, -104, 10, 106);

  // Top plank: DANGER:
  ctx.save();
  ctx.rotate(-0.04);
  ctx.fillStyle = '#9e6839';
  ctx.beginPath();
  ctx.roundRect(-60, -100, 120, 26, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffeb3b';
  ctx.font = '900 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DANGER:', 0, -87);
  ctx.restore();

  // Bottom plank: END OF THE EARTH
  ctx.save();
  ctx.rotate(0.025);
  ctx.fillStyle = '#8b572c';
  ctx.beginPath();
  ctx.roundRect(-68, -72, 136, 28, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff8dc';
  ctx.font = '900 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('END OF THE EARTH', 0, -58);
  ctx.restore();
  ctx.restore();

  // 4. Victorious Crowned Pelican on the 4-color GBike perched proudly at the cliff!
  const mockPlayer = {
    ...gs.player,
    x: 0,
    prevX: 0,
    y: 0,
    prevY: 0,
    tilt: 0.04,
    prevTilt: 0.04,
    duckAmount: 0,
    prevDuckAmount: 0,
    supportY: 0,
    prevSupportY: 0,
    airBlend: 0,
    prevAirBlend: 0,
    landingSquash: 0,
    prevLandingSquash: 0,
    wheeliePitch: 0.14,
    prevWheeliePitch: 0.14,
    sparkleTimer: 5,
    hoverTimer: 0,
    respawnInvulnTimer: 0,
  };
  const fakeVp = {
    cssW: W,
    cssH: H,
    focal: Math.min(W, H) * 0.72,
    horizonY: groundY - (4.0 * Math.min(W, H) * 0.72) / CAM_DIST,
  };
  const bikeX = isNarrow ? -2.2 : -3.4;
  mockPlayer.x = bikeX;
  mockPlayer.prevX = bikeX;
  drawPelicanOnGBike(ctx, mockPlayer, 1, t, 0, 4.0, fakeVp);

  // Golden Victory Crown floating right above the pelican!
  const pScreen = projectPoint(bikeX, 1.98, 0, 0, 4.0, fakeVp);
  if (pScreen) {
    ctx.save();
    ctx.translate(pScreen.sx + pScreen.scale * 0.14, pScreen.sy - pScreen.scale * 0.12 + Math.sin(t * 4) * 3);
    ctx.fillStyle = '#fbbc05';
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-14, 6);
    ctx.lineTo(-17, -8);
    ctx.lineTo(-7, -1);
    ctx.lineTo(0, -13);
    ctx.lineTo(7, -1);
    ctx.lineTo(17, -8);
    ctx.lineTo(14, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 5. Scrolling Neon Sign + Retro Arcade End Credits rising from the bottom of the cosmos!
  const scrollCx = isNarrow ? W * 0.56 : W * 0.64;
  const signW = Math.min(isNarrow ? W * 0.78 : W * 0.52, 460);
  const signH = isNarrow ? 92 : 112;
  const scrollSpeed = 44;

  const credits = [
    { kind: 'header', text: '★ PELICAN SURFER ★' },
    { kind: 'sub', text: 'GBIKE WORLD & MOONSHOTS TOUR' },
    { kind: 'spacer' },
    { kind: 'role', label: 'CREATOR', name: 'MATT LASLIE', gold: true },
    { kind: 'role', label: 'GAME DESIGN & ENGINE', name: 'GEMINI NEON' },
    { kind: 'role', label: '3D ROAD & ROOF-SURF PHYSICS', name: 'GEMINI NEON' },
    { kind: 'role', label: 'WING-FLAP AERODYNAMICS', name: 'GEMINI NEON' },
    { kind: 'role', label: '6 GLOBAL GOOGLE CAMPUSES', name: 'MTV · LDN · ZRH · TYO · NYC · SYD' },
    { kind: 'role', label: '6 ALPHABET MOONSHOTS', name: 'WAYMO · QUANTUM · TPU · LOON · WING · DEEPMIND' },
    { kind: 'role', label: 'STAN T-REX CHOREOGRAPHY', name: 'GEMINI NEON' },
    { kind: 'role', label: '8-BIT SYNTH SOUNDTRACK', name: 'GEMINI NEON' },
    { kind: 'role', label: 'END OF THE EARTH SIGNMAKING', name: 'GEMINI NEON' },
    { kind: 'spacer' },
    { kind: 'sub', text: 'BUILT IN GOOGLE ANTIGRAVITY' },
    { kind: 'end', text: '— THE END —' },
  ];

  const creditsStartOffset = signH * 0.5 + 78;
  let creditsHeight = 0;
  for (let i = 0; i < credits.length; i++) {
    const item = credits[i];
    if (item.kind === 'role') creditsHeight += 52;
    else if (item.kind === 'spacer') creditsHeight += 20;
    else creditsHeight += 30;
  }

  const startY = H + signH * 0.5;
  const totalScrollDist = startY + 60 + creditsStartOffset + creditsHeight + 80;
  const scrollOffset = ((elapsed * scrollSpeed) % totalScrollDist + totalScrollDist) % totalScrollDist;
  const neonCy = startY - scrollOffset;

  const flicker = 0.93 + 0.07 * Math.sin(t * 19.0) * Math.sin(t * 3.7);

  // Draw Glowing Retro Neon Banner
  if (neonCy + signH * 0.5 > -40 && neonCy - signH * 0.5 < H + 40) {
    ctx.save();
    ctx.translate(scrollCx, neonCy);
    ctx.globalAlpha = flicker;

    ctx.fillStyle = 'rgba(6, 9, 24, 0.55)';
    ctx.strokeStyle = '#ff3df5';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ff3df5';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.roundRect(-signW * 0.5, -signH * 0.5, signW, signH, 16);
    ctx.fill();
    ctx.stroke();

    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#7ef9ff';
    ctx.font = `900 ${isNarrow ? 18 : 26}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CONGRATULATIONS!', 0, -signH * 0.15);

    ctx.shadowColor = '#fbbc05';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#fef08a';
    ctx.font = `800 ${isNarrow ? 11 : 14}px system-ui, sans-serif`;
    ctx.fillText('12 LEVELS CONQUERED · END OF THE ALPHABET', 0, signH * 0.2);
    ctx.restore();
  }

  // Draw Rolling Credits Lines
  let curY = neonCy + creditsStartOffset;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < credits.length; i++) {
    const item = credits[i];
    if (curY > -60 && curY < H + 60) {
      if (item.kind === 'header') {
        ctx.fillStyle = '#7ef9ff';
        ctx.font = `900 ${isNarrow ? 17 : 22}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.fillText(item.text, scrollCx, curY);
      } else if (item.kind === 'sub') {
        ctx.fillStyle = '#c4b5fd';
        ctx.font = `700 ${isNarrow ? 11 : 13}px system-ui, sans-serif`;
        ctx.fillText(item.text, scrollCx, curY);
      } else if (item.kind === 'role') {
        ctx.fillStyle = '#94a3b8';
        ctx.font = `800 ${isNarrow ? 10 : 11}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.fillText(item.label, scrollCx, curY - 9);
        ctx.fillStyle = item.gold ? '#fbbc05' : '#f8fafc';
        ctx.font = `900 ${isNarrow ? 13 : 16}px system-ui, sans-serif`;
        ctx.fillText(item.name, scrollCx, curY + 11);
      } else if (item.kind === 'end') {
        ctx.fillStyle = '#ff79f9';
        ctx.font = `900 ${isNarrow ? 18 : 22}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.fillText(item.text, scrollCx, curY);
      }
    }
    if (item.kind === 'role') curY += 52;
    else if (item.kind === 'spacer') curY += 20;
    else curY += 30;
  }
  ctx.restore();
}
