# Split Second 🚗💨

Don't hesitate. A tiny GTA-style driving-survival demo: weave through live
traffic, miss the pedestrians, outrun an endless wave of cops — one crash
and the run is over. It's not about escaping; it's about how long you last.

**Play it:** https://smashy-road-demo.vercel.app

## Controls

| Input | Action |
|---|---|
| Touch **left half** of screen | Turn left (smooth analog steering) |
| Touch **right half** of screen | Turn right |
| **Both halves** together | Brake |
| Both halves held at a full stop | Reverse |
| **⟳** button (top right) | Restart |

Desktop: mouse halves work the same way; Arrow keys / A,D steer, Space brakes.

## The city

- Avenues (4 lanes, two-way), streets (2 lanes), one-way alleys — all procedural
- Live traffic that obeys traffic lights, queues, and turns at intersections
- Pedestrians strolling the sidewalks, working traffic-light cycle
- Crashing into anything — buildings, traffic, pedestrians, light poles, cops — ends the run
- Cops escalate over time and re-enter the chase if you shake them: survival is the score

## Tech

- Three.js (CDN, pinned) — no build step, static hosting
- 100% procedural: city, buildings, cars, people, textures generated in code —
  zero downloaded assets, zero API keys
- Traffic + pedestrians render as single instanced draw calls each

## Files

- `index.html` — page, HUD, menus
- `js/main.js` — game loop, player physics, cop AI, camera
- `js/world.js` — procedural city, road network, traffic lights, car/people geometry
- `js/traffic.js` — ambient traffic AI (lanes, lights, turns)
- `js/peds.js` — pedestrian system
- `js/input.js` — split-screen touch / mouse / keyboard input
