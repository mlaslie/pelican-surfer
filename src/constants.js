// Simulation & fixed-timestep pacing
export const FIXED_DT = 1 / 60;
export const MAX_FRAME_DT = 0.05;
export const MAX_FIXED_STEPS = 5;

// World & 3D camera geometry
export const LANE_W = 2.65;
export const LANE_SWITCH_DURATION = 0.135;
export const LANE_QUEUE_MAX = 2;
export const SIDE_BUMP_BOUNCE_DURATION = 0.095;

export const ROOF_H = 2.35;
export const RAMP_LEN = 6.2;
export const RAMP_SLOPE = ROOF_H / RAMP_LEN;
export const MAX_Z = 145;
export const CAM_DIST = 7.4;
export const Z_NEAR_CLIP = 0.35;
export const ROAD_NEAR_CLIP = -CAM_DIST + 0.8;
export const VEHICLE_NEAR_CLIP = -CAM_DIST + 1.1;

// Speed & progression
export const BASE_SPEED = 11.5;
export const NOOGLER_SPEED = 13.2;
export const LEGACY_BASE_SPEED = 19;
export const MAX_SPEED = 42;
export const SPEED_RAMP_PER_M = 0.0135;
export const DIST_SCALE = 0.45;
export const CAMPUS_DIST_STEP = 450;

// Jump, gravity, coyote time, buffering & wing-flap flight
export const GRAVITY = 34;
export const JUMP_VEL = 14.8;
export const FAST_FALL_VEL = -30;
export const COYOTE_TIME = 0.11;
export const JUMP_BUFFER_TIME = 0.12;
export const RAMP_LAUNCH_MIN_VY = 3.8;
export const RAMP_LAUNCH_MAX_VY = 5.2;
export const FLAP_MAX_CHARGES = 4;
export const FLAP_VEL = 9.0;
export const FLAP_GLIDE_GRAVITY = 13.5;
export const FLAP_GLIDE_MAX_FALL = -3.4;
export const FLAP_GLIDE_TIME = 0.36;
export const FLAP_COOLDOWN = 0.10;
export const FLAP_MIN_AIR_TIME = 0.08;
export const FLAP_MAX_ALTITUDE = 5.1;
export const FLAP_ANIM_DURATION = 0.28;

// Ducking, overdrive, combos, hover-GBike & stackable respawns
export const DUCK_DURATION = 0.68;
export const FAST_FALL_LAND_DUCK = 0.55;
export const DUCK_BLEND_IN = 16;
export const DUCK_BLEND_OUT = 10;
export const SPARKLE_DURATION = 7.5;
export const HOVER_COST_COINS = 10;
export const HOVER_DURATION = 10.0;
export const RESPAWN_MEDALLIONS_NEEDED = 3;
export const RESPAWN_INVULN_DURATION = 2.4;
export const COMBO_DECAY_TIME = 4.2;
export const COMBO_MAX_MULT = 5;
export const AERIAL_HALF_W = 0.85;
export const AERIAL_DEPTH = 0.9;
export const AERIAL_RADIUS_Y = 0.55;

// Spawner & aligned hitbox bounds
export const INITIAL_WAVE_Z = 34;
export const PLAYER_HALF_Z = 0.22;
export const OBSTACLE_HIT_HALF_W = 1.02;
export const VEHICLE_HALF_W = 1.08;
export const VEHICLE_SUPPORT_HALF_W = 1.15;
export const HURDLE_HALF_W = 1.05;
export const LOW_HURDLE_DEPTH = 0.45;
export const LOW_HURDLE_HEIGHT = 0.95;
export const LOW_HURDLE_CLEAR_Y = 0.90;
export const GANTRY_HALF_W = 1.15;
export const HIGH_GANTRY_DEPTH = 0.60;
export const HIGH_GANTRY_MIN_Y = 1.28;
export const HIGH_GANTRY_TOP_Y = 2.65;

export const BEST_SCORE_KEY = 'pelican_surfer_best';
export const BEST_SCORE_NOOGLER_KEY = 'pelican_surfer_best_noogler';

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
