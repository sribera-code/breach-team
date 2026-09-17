# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Breach Team is a real-time, top-down tactical shooter (a player plus AI teammates) written in plain HTML5 Canvas and vanilla JS. It has no dependencies, no build step, no package manager, no tests and no linter. All graphics (`js/sprites.js`) and sounds (`Sound` in `js/util.js`) are generated procedurally; there are no asset files. The UI text, code comments and the README are in French, so keep new player-facing strings and comments in French.

## Running

Open `index.html` directly, or serve the folder:

```
python -m http.server 8000
```

Then go to http://localhost:8000. Append `#nobrief` to the URL to skip the mission briefing overlay; this is useful when iterating. There is no automated test suite, so verify changes by playing in the browser.

## Architecture

**No modules.** Each file is a classic `<script>` that declares globals (`Game`, `GameMap`, `Renderer`, `UI`, `Sprites`, `LEVELS`, `WEAPONS`, `TILE`, `U`, etc.). The load order in `index.html` is significant: `util → levels → map → entities → game → sprites → render → ui → main`. A new file must be added there in dependency order.

**Two coordinate scales** (defined in `util.js`):
- `U = 32` px is one ASCII map cell and the unit for gameplay distances (weapon ranges, view range, flash radius are all written as `n * U`).
- `TILE = 16` px is one cell of the fine grid that `GameMap` actually uses. ASCII cell `(x,y)` maps to fine cell `(2x,2y)`, and the in-between fine cells join neighbouring walls. As a result, walls are one fine cell thick and doors are `DOOR_LEN = 3` fine cells wide. The fine grid is `(2·AW−1) × (2·AH−1)`.

**Game / render separation.**
- `Game` (`js/game.js`) owns all simulation state and is the largest file. It covers player input handling, doors (animated `progress`/`target`, with open/ajar/closed states), bullets, flash grenades, enemy AI, teammate AI (follow/hold/move orders, watch spots, formation) and vision polygons (fog of war via `map.explored`). `update(dt)` runs `step(dt)` only when the game is neither over nor paused.
- `Game` emits events through a small `on`/`emit` bus: `'level'`, `'pause'`, `'over'`, `'weapon'`. `Renderer` and `UI` subscribe to these; the game never calls them directly.
- Visual side effects are handed to the renderer through a queue. The game pushes `{type: 'hole'|'blood'|'pool'|'casing', ...}` into `game.decals`. `Renderer.draw` then paints them once onto a persistent offscreen `decalC` canvas and clears the queue.
- `Renderer` rebuilds its offscreen layers on `'level'`: `staticC` (floors, walls, props, door frames), `decalC`, `fogC` and `exploredC`. Fog is updated incrementally from `map.newlyExplored`.
- `UI` (`js/ui.js`) updates the DOM HUD and overlays (briefing, pause, end screen) defined in `index.html`.

**Input.** `main.js` translates DOM events into `game.input`:
- `keys[code]` is true while a key is held.
- `pressed[code]` is true for a single frame. This includes the synthetic codes `Mouse0`, `Mouse1`, `Mouse2`, `WheelUp` and `WheelDown`. `Game.update` resets `pressed` at the end of each frame.

Bindings use `KeyboardEvent.code`, i.e. physical keys. `KeyW/A/S/D` is therefore ZQSD on AZERTY keyboards, and `KeyQ` (the walk/run toggle) is the physical A key on AZERTY. The actual bindings are in `Game.updatePlayer`:

| Action | Keys |
|---|---|
| Reload | `R` or middle click |
| Weapon | `1` / `2`, or `Alt` to cycle |
| Door | `E` toggles open/closed; the wheel steps closed ↔ ajar ↔ open |
| Flash grenade | `Space` or `G` |
| Squad | `T` toggles hold/follow; right click orders a move (right click on the player: follow) |
| Walk/run | `Q`/`Shift` toggles |

The README's controls table is outdated; trust the code and the HUD hints in `index.html`.

**Pathfinding and vision** are implemented in `GameMap` (`js/map.js`):
- A* with a `MinHeap`: `findPath`, then `smoothPath`, then `routeTo`.
- DDA-style `castRay` and `hasLOS`.
- Collision via `circleFree`.
- Props block movement but not sight. Closed doors block both.

**Entities** (`js/entities.js`): the `WEAPONS` table holds per-weapon tuning (spread, bloom, range falloff, burst/pause for enemy weapons), and `Game.spreadOf` combines these values. The file also defines `Agent`, plus `Player`, `Teammate` (configured by `TEAMMATE_DEFS`) and `Enemy`, which extend it; `Hostage` is standalone. Enemy weapons have `mag: Infinity`.

## Adding a mission

Append an entry to `LEVELS` in `js/levels.js` with the fields `{ name, briefing, enemyWeapons, map }`. The map legend is at the top of that file and in the README:
- `#` wall, `D` closed door, `S` player spawn, `H` hostage.
- `E` enemy with a random facing; `^ v < >` enemy with a fixed facing.
- Floors: `. , :` (concrete, parquet, tiles).
- Props: `c B T p b k`.
- A space is outside the building.

A mission is won when every enemy is dead. It is lost if the player dies or any hostage dies.
