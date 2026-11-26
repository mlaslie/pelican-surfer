# Pelican Surfer — GBike World & Moonshots Tour

**Play live (GitHub Pages):** https://mlaslie.github.io/pelican-surfer/

A zero-build, Subway Surfers–inspired 3-lane 3D behind-the-back runner sequel to [Pelican on a Bike](https://github.com/mlaslie/pelican-on-a-bike), featuring an animated, wing-flapping pelican riding a 4-color Google GBike across **6 global Google campuses** and **6 Alphabet Moonshots**—culminating in an **End of the Earth** retro rolling credits finale.

> Built in **Google Antigravity** using **Gemini 4 Neon**.

## 12-Level Sequential Tour (No Skipping!)
Every run starts at **Level 1 (Mountain View)** and advances every `450m` through all 12 levels in order:

### Google Campuses (Levels 1–6)
1. **Mountain View, CA** — GBus shuttles, Bay View dragonscale canopy, and **Stan the T-Rex** chasing behind you
2. **London, UK** — Red Double-Decker buses, St Pancras & KGX1 skyline, light drizzle, and city pigeons
3. **Zurich, Switzerland** — Blue-and-white VBZ Trams, snow-capped Swiss Alps, and alpine snow flurries
4. **Tokyo, Japan** — Yamanote Line cars, Mt. Fuji dusk silhouette, Tokyo Tower, and drifting sakura petals
5. **New York, USA** — Box trucks & Yellow Cabs, Manhattan skyline, and city pigeons
6. **Sydney, Australia** — Harbor Ferries, Sydney Opera House & Harbour Bridge, harbor spray, and swooping seagulls

### Alphabet Big Bets & Moonshots (Levels 7–12)
7. **Waymo** — Autonomous Robo-Vans with spinning LiDAR roof domes, twilight desert mesas, and laser calibration drones
8. **Quantum AI** — Golden Cryostat modules, hanging chandelier dilution refrigerators, and entangled `|0⟩`/`|1⟩` Qubit orbs
9. **TPU Hall** — Liquid-cooled TPU Superpods under the iconic 4-color Google cooling pipes, chased by a `P0 INCIDENT!` SRE bot
10. **Project Loon** — Stratospheric Relay Gondolas at 60,000 ft above Earth's glowing blue horizon, giant translucent Loon balloons, and weather balloons
11. **Wing Skyway** — Elevated rooftop Cargo Pods, landing pads, and fixed-wing delivery drones dangling coffee cups
12. **DeepMind** — Neural Compute Pods on a Go-board highway under floating 3D AlphaFold protein ribbons

Complete all 12 levels (`5,400m`) to trigger the **End of the Earth** cosmic rolling credits finale and unlock **Endless Mode**!

## Core Mechanics & Power-Ups
- **Pelican Wing-Flap Flight:** After jumping (or launching off a yellow ramp), tap Jump up to **4 times mid-air** to flap your wings and glide over traffic and roof gaps; flaps automatically refill on landing.
- **Ramp & Roof-Surfing:** Ride yellow chevron ramps onto vehicle roofs (`×1.5` score) and hop roof-to-roof across adjacent lanes.
- **Combo & Trick Multiplier (`×2` – `×5`):** Chain **Close Calls**, **Roof Hops**, **Air Slams**, and **Sky Glides** for stacking score multipliers.
- **Hover-GBike Shield (`Shift` / `H` · `10 G` coins):** Activates a 10-second anti-grav Hover-GBike with rainbow tire wakes and 1-hit crash absorption.
- **Gemini Sparkle (`✦`):** 7.5 seconds of Starlight Overdrive—magnetizes nearby `G` coins and smashes straight through vehicles and barriers.
- **3× Giant `G` Medallions (Stackable Respawns):** Collect 3 medallions to bank a stackable **Free Continue** that clears nearby hazards and revives you on a wipeout.
- **Speed Modes:** Toggle between **`🚀 Googler`** (accelerating World Tour) and **`🚲 Noogler`** (steady chill cruise) in the top bar—each with its own saved high score.

## Controls
- `←` / `→` or `A` / `D` (or swipe left/right): Switch lanes
- `↑` / `W` / `Space` (or swipe up): Jump & tap mid-air to **flap & fly** (up to 4 flaps)
- `↓` / `S` (or swipe down): Duck under skybridges & airborne fast-fall slam
- `Shift` / `H`: Activate Hover-GBike Shield (`10 G` coins)
- `B`: Ring GBike bell
- `P` / `Esc`: Pause / Resume
- `M`: Mute / Unmute SFX & music
- `N`: Toggle procedural 8-bit synth soundtrack

## Run Locally
Because the game uses native ES modules (`src/*.js`), serve the folder over HTTP:

```bash
python3 -m http.server 8766
```

Then open `http://localhost:8766/`.

## Install as a Chrome Extension (Manifest V3)
This repo ships as a self-contained **Manifest V3 Chrome extension** (zero extra permissions, 100% offline):

1. Clone this repository or click **Code → Download ZIP** on GitHub and unzip it.
2. Open `chrome://extensions` in Google Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the `pelican-surfer` folder.
4. Pin **Pelican Surfer** in your Chrome toolbar and click the pelican icon anytime to play.
