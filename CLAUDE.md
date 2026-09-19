# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Breach Team is a real-time, top-down tactical shooter (a player plus AI teammates) written in plain HTML5 Canvas and vanilla JS. It has no dependencies, no build step, no package manager, no tests and no linter. All graphics (`js/sprites.js`) and sounds (`Sound` in `js/util.js`) are generated procedurally; there are no asset files. The UI text, code comments and the README are in French, so keep new player-facing strings and comments in French.

## Running

Open `index.html` directly, or serve the folder:

```
python -m http.server 8000
```

Then go to http://localhost:8000. Append `#nobrief` to the URL to skip the mission briefing overlay; this is useful when iterating. Run the regression suite by opening `tests/index.html` (see **Tests** below), then check the change by playing in the browser.

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
| Pick up a weapon | `V` near a body |
| Squad | `T` toggles hold/follow; right click orders a move (right click on the player: follow) |
| Walk/run | `Q`/`Shift` toggles |

If the controls change, update the README table, the HUD hints in `index.html` and the help text in `js/ui.js` too.

**Pathfinding and vision** are implemented in `GameMap` (`js/map.js`):
- A* with a `MinHeap`: `findPath`, then `smoothPath`, then `routeTo`.
- DDA-style `castRay` and `hasLOS`.
- Collision via `circleFree`.
- Props block movement but not sight. Closed doors block both.

**Entities** (`js/entities.js`): the file defines `Agent`, plus `Player`, `Teammate` (configured by `TEAMMATE_DEFS`, including each mate's weapon) and `Enemy`, which extend it; `Hostage` is standalone.

**Fiber optic** (`js/game.js`): holding `F` near a closed or ajar door runs a `fiber` action, then sets `player.fiber = Game.fiberSpot(...)` — a viewpoint just past the leaf. `computeVision` casts an extra 150° / 6 U cone from there (so fog and `sees` include it) and `updatePlayer` blocks firing and reloading while it is out; moving, opening the door or releasing the key clears it. `Sprites.actionPose` keeps the arm extended for the sustained pose via `actStyle`, which synthesises `act: { type: 'fiber', k: 1 }`.

**Two-handed actions** (`js/game.js`): `Game.startAction(agent, type, dur, done)` puts `agent.act = { type, t, dur, done }` on any agent (player, mate or enemy) and cancels a running reload. `Game.updateActions` (called from `step`) advances it, runs `done()` at the end and leaves `agent.handBloom` behind, which `Game.spreadOf` adds to the spread and decays over ~0.6 s; an acting agent also gets a flat 7° penalty, so the crosshair opens visibly. While `agent.act` is set nobody fires or reloads, the player moves at 55 % speed and `moveAlong` keeps the AI still. `Game.doorBlocker(door)` reports what stands in the frame (an agent or a grenade) and is checked both before the closing gesture and on completion, so a refusal is immediate and explains itself; `doorAction` says why any refusal happened, since silence reads as a broken key. Doors have four steps, `DOOR_STEPS = [0, 0.25, 0.55, 1]` in `js/map.js`; `Game.doorStep(d, dir)` picks the next one for the wheel, `E` jumps straight to open or closed. A door leaf is a real sight blocker: `GameMap.leafSeg(d)` is the leaf segment and `GameMap.leafBlock` shortens every ray in `castRay` (hence `hasLOS`, the vision polygons, fog and bullets) at the leaf, so a door that is not wide open only lets sight through the gap at the leaf's free end — which is why peeking works from beside the gap and up close, not from across the room. `blocksSight` therefore stops blocking the doorway tiles as soon as the door leaves its closed state. Doors go through `Game.doorAction` (0.25 s of handle work plus 0.3 s per unit of leaf travel, so easing a door ajar is quicker than swinging it wide; ×1.3 for enemies) which only then calls `openDoor`/`closeDoor`; the flash is `throwFlash` (wind-up) → `releaseFlash` (the grenade leaves toward the cursor at that moment). `Sprites.actionPose` animates the gesture from `st.act = { type, k }`, tilting the gun down and reaching with one hand.

**Door penetration** (`js/game.js`): `castRay` reports the obstacle it stopped at as `door` (doorway tile or leaf). In `updateBullets` a bullet that hits a door is not consumed: it keeps `w.pierce` of its damage (0.2 for buckshot to 0.7 for 7.62 NATO), deviates by up to 1.6°, resumes 3 px past the impact and raises `pierced`, which caps at two doors; below 2 damage it stops. Walls and props are unchanged. This is symmetric, so enemies shoot through doors too.

**Relay and dropped weapons** (`js/game.js`): when the player dies and a mate is alive, `step` waits `RELAY_DELAY` then calls `Game.takeOver`, which turns the nearest living mate into the player *in place* — `Object.setPrototypeOf(m, Player.prototype)` after deleting its own `slot` (it would shadow `Player`'s getter) — so enemy targets stay valid. The old player object moves into `mates` as a dead entry, which the squad HUD shows as down. `checkEnd` loses only when no op is alive. Every body keeps its weapon in `slot` (or `slots[cur]` for a former player); `Game.pickUp` (`V`, a 0.5 s `pickup` action) swaps it with the player's slot of the same category (pistol vs primary), and `Game.pickupSlot` converts AI weapons through their `pickup` key (`ak` → `akP`, `hk416op` → `hk416`, ...) and replaces infinite ammo with the real magazine and reserve. A body with no weapon has `slot === null`, so `Agent.weapon` and `gunStyle` accept null.

**Hostages** (`js/game.js`): `Hostage.radius` is 7 (kneeling). In `Game.damage` a first hit below `HOSTAGE_GRAVE` only sets `h.wounded` (drawn by `Sprites.hostage`); a second hit, or one at `HOSTAGE_GRAVE` or more, kills.

**Fire discipline** (`js/game.js`): `Game.lineOfFireClear(shooter, target, x, y)` blocks a mate's shot when an ally or hostage is in the axis. A mate that stays blocked past 0.35 s gets `m.blockedLine`, which frees it to move again and sends it to `Game.firingSpot` — the nearest tile with a clear line — instead of standing still. A move order also takes priority over contact, so an engaged mate still obeys. `lineOfFireClear` takes the shooter's own team as friends, so it also serves the siege `Operator`s: `enemyCombat` holds their fire and `updateAssault` sends them to `firingSpot` once blocked. For operators the check is stricter — the margin grows with their current spread and hostages up to 2.5 U behind the target count — because a burst that misses keeps going. Keep these escapes in mind when touching `updateMate`: without them a mate freezes in front of a hostage.

**Teammate orders** (`js/game.js`): `Game.orderFollow`, `Game.orderMove(wx, wy, coverAngle)` and `Game.toggleHold` set `m.order` (`follow` | `hold` | `move`). A held right click builds `game.orderDrag` in `Game.updatePlayer`; on release, the dragged angle is passed as `coverAngle` and stored on the one mate placed on that side as `m.coverAngle`. `Game.pickWatch` returns that angle unchanged instead of scoring watch candidates, and no scan sweep is started while it is set. Any new order clears it.

**Weapons** are real firearms, defined in the `WEAPONS` table in `js/entities.js`:
- Display data (`name`, `maker`, `caliber`, `mode`, `rpm`, `weight`, `note`) follows manufacturer specs. `rof` is derived from `rpm`, and `mobility` (a player speed multiplier) from `weight`. Keep new weapons consistent with real data.
- Tuning fields (spread, bloom, range falloff, `pellets`) are combined by `Game.spreadOf` and `Game.fireWeapon`. Enemy weapons (`ak`, `pistolE`) have `mag: Infinity` and burst/pause.
- `kind` selects the drawing in `Sprites.gun` (`rifle`, `smg`, `pdw`, `shotgun`, `pistol`, `ak`); `tint` selects a colour/shape variant; `snd` sets the shot sound.
- `reloadType: 'shell'` loads one shell per `reload` seconds, and firing interrupts it.
- `PRIMARY_WEAPONS` and `SIDEARMS` list what the briefing screen offers. The player's choice is `game.loadout`, stored in `localStorage` under `breach.loadout` and applied via `Game.setLoadout` → `Player.equip`.
- The briefing icons (`UI.drawWeapon`) reuse `Sprites.gun` at one shared scale, so relative sizes match the in-game drawings.

Known gaps and pending tuning are tracked in `TODO.md`; read it before starting work on doors, the siege mode or tests.

## Tests

`tests/index.html` loads the game scripts plus `tests/tests.js`, runs every scenario synchronously on a hidden canvas and HUD, and sets `document.title` to `PASS` or `FAIL n`. Headless: `chrome --headless --allow-file-access-from-files --dump-dom tests/index.html`. `mkGame(opts)` builds a game (`mode`, `level`, `loadout`, `entry`); `checkEnd` is stubbed by default because a finished mission freezes `update`, `alone: true` removes enemies and mates so the player is not shot mid-measurement, and `noEnemyAI` freezes suspects. Tests never call `setMode`/`setLoadout`, so they do not touch `localStorage`. Add a scenario for every behaviour fix.

## Breaches (entries from outside)

`X` (exterior door) and `W` (window) sit in the outer wall. `GameMap.addBreach` records each one in `map.breaches` with its `inside` point (the walkable tile on the building side) and inward `angle`; `breachLabel(b)` names it by compass side. An `X` is a normal door; a `W` is `map.windows` / `windowAt`: floor tiles (so sight and bullets pass) that `blocksMove` refuses, so nobody walks through. The outside is void, so nobody can leave. In assault mode the player starts at `breaches[game.entryIndex]`, chosen in the briefing, one map cell inside (`Game.entryStart`, so mates are not pinned against the façade). The entry zone is empty: `GameMap.roomOf(x, y)` flood-fills the room (stopping at walls, doors and windows) and `Game.clearEntryZone` moves any enemy or hostage found there to the nearest free tile outside it. The maps already respect this; the guard is a safety net; in siege mode `spawnAssault` rotates waves across breaches and gives each operator an entry gesture (the door opening, or 1.3 s to climb through a window).

## Game modes

`game.mode` is `'assault'` (the original) or `'siege'`, saved in `localStorage` under `breach.mode` and switched from the briefing via `Game.setMode`, which reloads the level. `MODES` in `js/entities.js` holds each mode's weapon lists and default loadout, and loadouts are stored per mode (`breach.loadout.<mode>`).

Every map has 9 enemy spawns (the siege side is the player plus 8 mates on those posts) and 3, 4 and 5 hostages respectively; keep that when editing maps. In siege mode the mates take no orders: `Game.canCommand` refuses `T`, the right click and every `order*` call, so each militant holds its post.

In siege mode `loadLevel` reassigns the roles without touching the engine's notion of sides: the player and `mates` (from `SIEGE_MATE_DEFS`, militant styles, `ak`/`pistolE`) stay team `ops` and start on the enemy spawns, while `enemies` becomes the assault team — `Operator` instances spawned at the map entry with `hk416op`/`mp5op`. Everything that keys off `ops` (vision, fog, friendly fire, orders, HUD squad) therefore works unchanged.

`Game.startSiege` builds `game.siege` (prep timer, `waves` copied from `SIEGE_WAVES` at the top of `js/game.js` — one entry per wave, its size — plus breaches and sector list) and reveals the whole map as explored, since the defender knows the building; the first wave only enters when the prep timer runs out. `Game.updateAssault` replaces `updateEnemy` for those operators: it reuses `enemyCombat`, throws a flash through `maybeFlash`/`spawnFlash` when it knows where the threat was, and walks to a found hostage, else the last noise heard, else the next sector from `Game.buildSectors`. `updateHostageRescue` marks a hostage `found` when an operator sees it and `secured` after 4 s next to one. `updateSiege` sends the next wave `gap` (6 s) after the current one is wiped out, or `maxGap` (30 s) after it entered if it still holds; the UI texts read the wave count from `SIEGE_WAVES`. Grenades: `Game.armGrenades` gives the assault side flashes (`p.nade = 'flash'`) and the siege side two frags (`'frag'`, same `flashbangs` counter); a grenade carries `kind`, `team` and `thrower`. `detonateFrag` damages everyone in `FRAG_RADIUS` with line of sight (so walls and closed doors protect), thrower and hostages included. `detonateFlash` spares the thrower's team (they look away) beyond 1.2 U. `maybeFlash` only throws when `Game.clearThrow` finds a free trajectory (no wall, prop or non-open door) and no operator stands near the aim point. The siege side has no fiber optic. `separate` pushes apart agents that sit exactly on top of each other, and `spawnAssault` never places two operators on the same point. `checkEnd` branches per mode: in siege you win once the last wave has entered and no operator is alive, and lose if you die or no hostage is left alive in your hands (all dead, or dead and secured); a single hostage death only announces how many remain. `Game.noise` also turns mates toward nearby noise without moving them.

## Adding a mission

Append an entry to `LEVELS` in `js/levels.js` with the fields `{ name, briefing, enemyWeapons, map }`. The map legend is at the top of that file and in the README:
- `#` wall, `D` closed door, `S` player spawn (fallback when a map has no breach), `H` hostage.
- `X` exterior door, `W` window: entry points from outside. Give every map several, including at least one of each, and keep enemies and hostages out of every room a breach opens into (the tests check it).
- `E` enemy with a random facing; `^ v < >` enemy with a fixed facing.
- Floors: `. , :` (concrete, parquet, tiles).
- Props: `c B T p b k`.
- A space is outside the building.

An assault mission is won when every enemy is dead. It is lost if the whole team is down (the player's death alone hands control to a mate) or any hostage dies (in siege mode, only once no hostage is left alive in the player's hands).
