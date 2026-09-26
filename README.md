# Smashy Drive 🚗💨

A tiny Smashy Road-style chase demo: drive around a procedural low-poly city,
outrun the cops, and don't hit anything — one crash and the run is over.

**Play it:** https://smashy-road-demo.vercel.app

## Controls

| Input | Action |
|---|---|
| Touch **left half** of screen | Turn left |
| Touch **right half** of screen | Turn right |
| **Both halves** together | Brake |
| Both halves held at a full stop | Reverse |
| **CHASE / ISO** button (top right) | Toggle chase cam ↔ isometric view |
| **⟳** button (top right) | Restart |

Desktop: mouse halves work the same way; Arrow keys / A,D steer, Space brakes.

## Tech

- Three.js (CDN, pinned) — no build step, static hosting
- 100% procedural: city, buildings, cars, textures are generated in code —
  zero downloaded assets, zero API keys
- Cop AI: pursuit steering + building avoidance, escalating heat (+1 cop / 25s)

## Files

- `index.html` — page, HUD, menus
- `js/main.js` — game loop, player physics, cop AI, cameras
- `js/world.js` — procedural city + car factory
- `js/input.js` — split-screen touch / mouse / keyboard input
