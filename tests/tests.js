'use strict';
// Tests de non-régression. Ouvrir tests/index.html dans un navigateur, ou :
//   chrome --headless --dump-dom tests/index.html   (le titre de la page vaut PASS ou FAIL n)
// Les tests ne passent jamais par setMode / setLoadout : rien n'est écrit dans localStorage.

const T = { pass: 0, fail: 0, lines: [] };

function test(name, fn) {
  try { fn(); T.pass++; T.lines.push(['ok', '✓ ' + name]); }
  catch (e) { T.fail++; T.lines.push(['ko', '✗ ' + name + '\n    ' + (e && e.message ? e.message : e)]); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'condition fausse'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'égalité') + ' : ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); }
function near(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error((msg || 'proche') + ' : ' + a + ' vs ' + b + ' (±' + tol + ')'); }

// ---- Fabrique de parties ----
function mkGame(opts) {
  opts = opts || {};
  const game = new Game();
  const r = new Renderer(document.getElementById('game'), game);
  const ui = new UI(game);
  r.resize();
  game.mode = opts.mode || 'assault';
  game.loadout = opts.loadout || Game.loadSavedLoadout(game.mode);
  if (opts.entry !== undefined) game.entryIndex = opts.entry;
  game.loadLevel(opts.level || 0);
  game.paused = false;
  if (opts.noEnd !== false) game.checkEnd = () => {}; // la fin de mission fige tout : on l'écarte
  if (opts.noEnemyAI) game.updateEnemy = () => {};
  if (opts.alone) { game.enemies = []; game.mates.forEach(m => { m.alive = false; }); } // mesures au calme
  const api = {
    game, r, ui,
    step(n) { for (let i = 0; i < n; i++) { game.update(1 / 60); r.draw(1 / 60); ui.update(); } },
    press(code) { game.input.pressed[code] = true; this.step(1); },
  };
  return api;
}
const nearestDoorTo = (map, x, y) => map.doors.slice().sort((a, b) => dist(a.cx, a.cy, x, y) - dist(b.cx, b.cy, x, y))[0];
const setDoor = (d, v) => { d.progress = v; d.target = v; d.open = v >= 1; d.ajar = v > 0 && v < 1; d.opening = false; };
// place le joueur face à une porte, à une distance donnée
function faceDoor(g, d, px) {
  const nx = d.horizontal ? 0 : 1, ny = d.horizontal ? 1 : 0;
  g.game.player.x = d.cx - nx * px;
  g.game.player.y = d.cy - ny * px;
  g.game.input.mouse.x = d.cx; g.game.input.mouse.y = d.cy;
  return { nx, ny };
}

// ---------------------------------------------------------------- armes
test('chaque arme tire, se vide et se recharge', () => {
  for (const key of PRIMARY_WEAPONS.concat(SIDEARMS, MODES.siege.primaries, MODES.siege.sidearms)) {
    const w = WEAPONS[key];
    const g = mkGame({ alone: true, loadout: { primary: w.cat === 'hg' ? 'hk416' : key, sidearm: w.cat === 'hg' ? key : 'glock17' } });
    const p = g.game.player;
    p.cur = w.cat === 'hg' ? 1 : 0;
    const s = p.slot;
    eq(s.def, w, 'arme équipée ' + key);
    g.game.input.mouse.x = p.x + 100; g.game.input.mouse.y = p.y;
    g.game.input.mouse.down = true;
    for (let i = 0; i < 60; i++) { g.game.input.pressed.Mouse0 = true; g.step(1); }
    ok(s.mag < w.mag, key + ' : des balles sont parties');
    g.game.input.mouse.down = false;
    g.press('KeyR');
    g.step(400);
    eq(s.mag, w.mag, key + ' : chargeur plein après rechargement');
    ok(s.reserve < w.reserve, key + ' : la réserve a baissé');
  }
});

test('cadence de tir conforme à la fiche', () => {
  for (const key of ['hk416', 'mp5', 'mp7']) {
    const g = mkGame({ alone: true, loadout: { primary: key, sidearm: 'glock17' } });
    const p = g.game.player;
    p.slot.mag = 1000;
    g.game.input.mouse.x = p.x + 100; g.game.input.mouse.y = p.y;
    g.game.input.mouse.down = true;
    const before = g.game.stats.shots;
    g.step(60);
    const shots = g.game.stats.shots - before;
    near(shots, WEAPONS[key].rof, 1.6, key + ' : coups tirés en une seconde');
  }
});

// ---------------------------------------------------------------- portes
test('la molette parcourt les quatre crans dans les deux sens', () => {
  const g = mkGame();
  const d = nearestDoorTo(g.game.map, g.game.player.x, g.game.player.y);
  setDoor(d, 0);
  const up = [];
  for (let i = 0; i < 4; i++) { const t = g.game.doorStep(d, 1); up.push(t); if (t === null) break; setDoor(d, t); }
  eq(JSON.stringify(up), JSON.stringify([DOOR_STEPS[1], DOOR_STEPS[2], DOOR_STEPS[3], null]), 'crans en montant');
  const down = [];
  for (let i = 0; i < 4; i++) { const t = g.game.doorStep(d, -1); down.push(t); if (t === null) break; setDoor(d, t); }
  eq(JSON.stringify(down), JSON.stringify([DOOR_STEPS[2], DOOR_STEPS[1], DOOR_STEPS[0], null]), 'crans en descendant');
});

test('entrouvrir est plus rapide qu’ouvrir en grand', () => {
  const g = mkGame();
  const d = nearestDoorTo(g.game.map, g.game.player.x, g.game.player.y);
  const dur = target => { const p = g.game.player; p.act = null; setDoor(d, 0); g.game.doorAction(p, d, target); const v = p.act.dur; p.act = null; return v; };
  const petit = dur(DOOR_STEPS[1]), grand = dur(1);
  ok(petit < grand, 'entrebâiller (' + petit.toFixed(2) + 's) plus court qu’ouvrir (' + grand.toFixed(2) + 's)');
});

test('la porte ne bouge que le geste terminé', () => {
  const g = mkGame();
  const d = nearestDoorTo(g.game.map, g.game.player.x, g.game.player.y);
  setDoor(d, 0);
  faceDoor(g, d, 30);
  g.press('KeyE');
  ok(g.game.player.act && g.game.player.act.type === 'door', 'geste en cours');
  eq(d.progress, 0, 'porte encore immobile');
  g.step(40);
  ok(d.opening || d.progress > 0, 'la porte s’ouvre après le geste');
  g.step(60);
  ok(d.open, 'porte ouverte');
});

test('on ne tire pas pendant un geste, et la visée reste perturbée après', () => {
  const g = mkGame();
  const p = g.game.player;
  const d = nearestDoorTo(g.game.map, p.x, p.y);
  setDoor(d, 0); faceDoor(g, d, 30);
  const repos = g.game.spreadOf(p, 100);
  g.press('KeyE');
  const shots = g.game.stats.shots;
  g.game.input.mouse.down = true;
  g.step(20);
  eq(g.game.stats.shots, shots, 'aucun tir pendant le geste');
  ok(g.game.spreadOf(p, 100) > repos * 3, 'viseur ouvert pendant le geste');
  g.game.input.mouse.down = false;
  g.step(40);
  ok(p.handBloom > 0, 'visée encore perturbée juste après');
  g.step(80);
  near(g.game.spreadOf(p, 100), repos, 1e-6, 'visée revenue au repos');
});

test('la fermeture n’est refusée que si l’embrasure est occupée, et elle le dit', () => {
  const g = mkGame();
  const p = g.game.player;
  const d = nearestDoorTo(g.game.map, p.x, p.y);
  g.game.mates.forEach(m => { m.alive = false; });
  // dans l'embrasure : refus explicite
  setDoor(d, 1);
  p.x = d.cx; p.y = d.cy; p.act = null;
  g.game.message = { text: '', t: 0 };
  g.press('KeyE');
  ok(!p.act, 'aucun geste lancé');
  ok(/embrasure/i.test(g.game.message.text), 'message d’embrasure : "' + g.game.message.text + '"');
  // écarté d'une case : la fermeture passe
  setDoor(d, 1); p.act = null; faceDoor(g, d, 24);
  g.press('KeyE');
  g.step(120);
  eq(d.progress, 0, 'porte refermée');
});

test('les refus de manœuvre sont annoncés', () => {
  const g = mkGame();
  const p = g.game.player;
  const d = nearestDoorTo(g.game.map, p.x, p.y);
  setDoor(d, 0); faceDoor(g, d, 30);
  g.game.message = { text: '', t: 0 };
  g.press('WheelDown');
  ok(/déjà fermée/i.test(g.game.message.text), 'porte déjà fermée : "' + g.game.message.text + '"');
  p.act = null;
  g.press('KeyE');            // geste d'ouverture
  g.step(45);                 // le battant est maintenant en train de bouger
  ok(d.opening, 'la porte bouge');
  p.act = null;
  g.game.message = { text: '', t: 0 };
  g.press('KeyE');
  ok(/mouvement/i.test(g.game.message.text), 'porte en mouvement : "' + g.game.message.text + '"');
});

test('une porte non ouverte ne laisse voir que par l’entrebâillement', () => {
  const g = mkGame();
  const map = g.game.map;
  const d = nearestDoorTo(map, g.game.player.x, g.game.player.y);
  const nx = d.horizontal ? 0 : 1, ny = d.horizontal ? 1 : 0;
  const eye = { x: d.cx - nx * 2 * TILE, y: d.cy - ny * 2 * TILE };
  const cone = () => {
    let n = 0;
    for (let i = 0; i < 720; i++) {
      const rr = map.castRay(eye.x, eye.y, -Math.PI + TAU * i / 720, 8 * TILE, false);
      if ((d.horizontal ? rr.y - d.cy : rr.x - d.cx) > TILE) n++;
    }
    return n;
  };
  setDoor(d, 0); const ferme = cone();
  setDoor(d, DOOR_STEPS[1]); const filet = cone();
  setDoor(d, 1); const ouvert = cone();
  eq(ferme, 0, 'porte fermée : on ne voit rien au-delà');
  ok(ouvert > filet, 'ouverte (' + ouvert + ') montre plus qu’entrebâillée (' + filet + ')');
});

// ---------------------------------------------------------------- balles
test('les balles traversent les portes avec un malus, jamais les murs', () => {
  const g = mkGame({ noEnemyAI: true });
  const map = g.game.map, p = g.game.player;
  g.game.mates.forEach(m => { m.alive = false; });
  const d = nearestDoorTo(map, p.x, p.y);
  setDoor(d, 0);
  const nx = d.horizontal ? 0 : 1, ny = d.horizontal ? 1 : 0;
  const tgt = new Enemy(d.cx + nx * 2 * TILE, d.cy + ny * 2 * TILE, 0, 'pistol');
  g.game.enemies = [tgt];
  p.x = d.cx - nx * 2 * TILE; p.y = d.cy - ny * 2 * TILE;
  const shoot = (dmg, pierce, off) => {
    tgt.hp = tgt.maxHp = 1000; tgt.alive = true;
    const sx = p.x + (d.horizontal ? (off || 0) : 0), sy = p.y + (d.horizontal ? 0 : (off || 0));
    const ang = Math.atan2(tgt.y - sy, tgt.x - sx);
    g.game.bullets.push({ x: sx, y: sy, vx: Math.cos(ang) * 1150, vy: Math.sin(ang) * 1150, team: 'ops',
      damage: dmg, life: 1, shooter: p, trail: 18, pierce, pierced: 0 });
    g.step(30);
    return 1000 - tgt.hp;
  };
  near(shoot(30, 0.55), 16.5, 0.01, 'porte fermée, 55 % conservés');
  near(shoot(15, 0.2), 3, 0.01, 'chevrotine : 20 % conservés');
  setDoor(d, 1);
  near(shoot(30, 0.55), 30, 0.01, 'porte ouverte : aucun malus');
  setDoor(d, 0);
  eq(shoot(30, 0.55, d.len * TILE), 0, 'à travers le mur : rien ne passe');
});

// ---------------------------------------------------------------- fibre
test('la fibre montre la pièce voisine et se retire au moindre pas', () => {
  const g = mkGame({ noEnemyAI: true });
  const map = g.game.map, p = g.game.player, inp = g.game.input;
  g.game.mates.forEach(m => { m.alive = false; });
  const d = nearestDoorTo(map, p.x, p.y);
  setDoor(d, 0);
  const nx = d.horizontal ? 0 : 1, ny = d.horizontal ? 1 : 0;
  const foe = new Enemy(d.cx + nx * 2.5 * TILE, d.cy + ny * 2.5 * TILE, Math.PI, 'pistol');
  g.game.enemies = [foe];
  faceDoor(g, d, 26);
  g.step(3);
  eq(foe.visible, false, 'invisible porte fermée');
  inp.keys.KeyF = true; inp.pressed.KeyF = true;
  g.step(50);
  ok(p.fiber, 'fibre posée');
  eq(foe.visible, true, 'suspect révélé par la fibre');
  inp.keys.KeyD = true; g.step(10); inp.keys.KeyD = false;
  ok(!p.fiber, 'fibre retirée dès qu’on bouge');
});

// ---------------------------------------------------------------- équipe
test('le clic droit maintenu confie une direction à un seul coéquipier', () => {
  const g = mkGame({ noEnemyAI: true });
  const game = g.game, p = game.player, inp = game.input;
  game.enemies = [];
  inp.mouse.x = p.x + 4 * U; inp.mouse.y = p.y;
  inp.pressed.Mouse2 = true; inp.mouse.rdown = true; g.step(1);
  inp.mouse.y = p.y - 2.5 * U; g.step(1);
  inp.mouse.rdown = false; inp.pressed.Mouse2Up = true; g.step(1);
  const cover = game.mates.filter(m => m.coverAngle !== null);
  eq(cover.length, 1, 'un seul chargé de la direction');
  near(cover[0].coverAngle, -Math.PI / 2, 0.2, 'direction imposée vers le haut');
  g.step(600);
  near(Math.abs(angleDiff(cover[0].angle, cover[0].coverAngle)), 0, 0.15, 'il tient l’angle une fois en place');
  game.orderFollow();
  eq(game.mates.every(m => m.coverAngle === null), true, 'un nouvel ordre efface la consigne');
});

test('un coéquipier gêné par un otage se décale au lieu de se figer', () => {
  const g = mkGame({ noEnemyAI: true });
  const game = g.game, p = game.player;
  const AY = 112;
  game.hostages = [new Hostage(176, AY)];
  const foe = new Enemy(240, AY, Math.PI, 'pistol');
  game.enemies = [foe];
  const bravo = game.mates[0];
  game.mates.slice(1).forEach(m => { m.alive = false; });
  bravo.x = 112; bravo.y = AY; bravo.order = 'hold'; bravo.holdAngle = 0;
  p.x = 112; p.y = 48; p.angle = -Math.PI / 2;
  // le blocage est passager : il se décale dès qu'il l'a constaté, donc on l'échantillonne dès le départ
  let vise = false, vu = false;
  for (let i = 0; i < 180 && !vu; i++) { g.step(1); vise = vise || bravo.target === foe; vu = bravo.blockedLine; }
  ok(vise, 'il a bien pris la cible');
  ok(vu, 'axe signalé bouché à un moment');
  g.step(500);
  eq(foe.alive, false, 'il a fini par abattre le suspect');
  eq(game.hostages[0].alive, true, 'otage indemne');
});

// ---------------------------------------------------------------- relais et armes au sol
test('à la mort du joueur, la partie reprend dans un coéquipier', () => {
  for (const mode of ['assault', 'siege']) {
    const g = mkGame({ mode, noEnd: false, noEnemyAI: true });
    const game = g.game, old = game.player;
    const heir = game.mates[0], name = heir.name;
    game.damage(old, 1000, null, 0);
    g.step(10);
    ok(!game.over, mode + ' : pas de défaite tant qu’un coéquipier est debout');
    eq(game.player, old, mode + ' : un court instant sur le corps avant le relais');
    g.step(Math.ceil(RELAY_DELAY * 60) + 2);
    eq(game.player, heir, mode + ' : le coéquipier le plus proche prend la main');
    ok(heir instanceof Player && heir.slot && Number.isFinite(heir.slot.reserve), mode + ' : munitions réelles, finies');
    eq(game.player.name, name, mode + ' : il garde son nom');
    ok(game.mates.includes(old) && !game.mates.includes(heir), mode + ' : l’ancien joueur passe « à terre » dans l’équipe');
    // le nouveau joueur répond aux commandes
    const x0 = heir.x;
    game.input.mouse.x = heir.x + 100; game.input.mouse.y = heir.y;
    game.input.keys.KeyD = true; g.step(20); game.input.keys.KeyD = false;
    ok(heir.x > x0 + 5 || heir.x < x0 - 5 || !game.map.circleFree(x0 + 12, heir.y, 10, true), mode + ' : il se déplace au clavier');
    // tous à terre : là seulement, c'est perdu
    game.ops.forEach(o => { if (o.alive) game.damage(o, 1000, null, 0); });
    g.step(2);
    eq(game.over, 'lose', mode + ' : toute l’équipe à terre, mission échouée');
  }
});

test('ramasser l’arme d’un corps l’échange contre celle de même catégorie', () => {
  const g = mkGame({ alone: true });
  const game = g.game, p = game.player;
  const away = a => { a.x = (game.map.w - 4) * TILE; a.y = (game.map.h - 4) * TILE; };
  game.mates.forEach(away); // leurs corps porteraient aussi une arme
  const foe = new Enemy(p.x + 12, p.y, 0, 'ak');
  game.enemies = [foe];
  game.damage(foe, 1000, p, 0);
  g.step(60); // fin de l'animation de chute
  const before = p.slots[0];
  game.input.pressed.KeyV = true; g.step(1);
  ok(p.act && p.act.type === 'pickup', 'ramasser prend un geste');
  g.step(40);
  eq(p.slots[0].def, WEAPONS.akP, 'l’AKM de l’IA devient un AKM réel');
  ok(Number.isFinite(p.slots[0].mag) && p.slots[0].mag === WEAPONS.akP.mag, 'chargeur plein et fini');
  eq(foe.slot, before, 'l’arme principale du joueur reste au sol, sur le corps');
  eq(p.cur, 0, 'l’arme ramassée est en main');
  eq(p.slots.length, 2, 'l’arme de poing est conservée');
  // et on peut la reprendre : c'est un échange, sans perte de munitions
  before.mag = 7;
  game.input.pressed.KeyV = true; g.step(40);
  eq(p.slots[0].def, before.def, 'l’arme d’origine revient');
  eq(p.slots[0].mag, 7, 'avec son chargeur entamé');
  eq(p.slots[0].reserve, before.reserve, 'et sa réserve');
  eq(foe.slot.def, WEAPONS.akP, 'l’AKM retourne au sol');

  // une arme de poing remplace l'arme de poing
  const foe2 = new Enemy(p.x - 12, p.y, 0, 'pistol');
  game.enemies.push(foe2);
  game.damage(foe2, 1000, p, 0);
  away(foe); // hors de portée
  g.step(60);
  game.input.pressed.KeyV = true; g.step(40);
  eq(p.slots[1].def, WEAPONS.makarovP, 'arme de poing échangée');
  eq(p.slots[0].def, before.def, 'arme principale intacte');
  eq(p.cur, 1, 'l’arme de poing est en main');

  // loin de tout corps : refus annoncé
  away(foe2);
  game.input.pressed.KeyV = true; g.step(1);
  ok(!p.act && /Aucune arme/.test(game.message.text), 'rien à portée : refus annoncé');
});

// ---------------------------------------------------------------- entrées
test('chaque mission a plusieurs ouvertures sur l’extérieur', () => {
  for (let i = 0; i < LEVELS.length; i++) {
    const map = new GameMap(LEVELS[i]);
    ok(map.breaches.length >= 2, LEVELS[i].name + ' : ' + map.breaches.length + ' ouverture(s)');
    ok(map.breaches.some(b => b.kind === 'window'), LEVELS[i].name + ' : au moins une fenêtre');
    ok(map.breaches.some(b => b.kind === 'door'), LEVELS[i].name + ' : au moins une porte extérieure');
    for (const b of map.breaches) {
      const t = { x: Math.floor(b.inside.x / TILE), y: Math.floor(b.inside.y / TILE) };
      ok(!map.blocksMove(t.x, t.y), LEVELS[i].name + ' : le côté intérieur de ' + map.breachLabel(b) + ' est praticable');
    }
  }
});

test('en assaut, la pièce d’entrée est vide, quelle que soit l’ouverture choisie', () => {
  for (let i = 0; i < LEVELS.length; i++) {
    const n = new GameMap(LEVELS[i]).breaches.length;
    for (let e = 0; e < n; e++) {
      const { game } = mkGame({ level: i, entry: e });
      const b = game.map.breaches[e];
      const room = game.map.roomOf(b.inside.x, b.inside.y);
      const where = LEVELS[i].name + ' / ' + game.map.breachLabel(b);
      ok(room.size > 0, where + ' : pièce d’entrée introuvable');
      const key = a => Math.floor(a.y / TILE) * game.map.w + Math.floor(a.x / TILE);
      ok(game.enemies.every(a => !room.has(key(a))), where + ' : un suspect attend dans la pièce d’entrée');
      ok(game.hostages.every(a => !room.has(key(a))), where + ' : un otage est dans la pièce d’entrée');
      ok(room.has(key(game.player)), where + ' : le joueur démarre dans la pièce d’entrée');
    }
    // Les cartes elles-mêmes respectent la règle : la garde du code n'est qu'un filet.
    const map = new GameMap(LEVELS[i]);
    for (const b of map.breaches) {
      const room = map.roomOf(b.inside.x, b.inside.y);
      const inRoom = s => room.has(s.y * map.w + s.x);
      ok(!map.enemySpawns.some(inRoom) && !map.hostageSpawns.some(inRoom),
        LEVELS[i].name + ' : la carte place quelqu’un derrière ' + map.breachLabel(b));
    }
  }
});

test('un suspect placé dans la pièce d’entrée est reporté derrière une porte', () => {
  const saved = LEVELS.slice();
  LEVELS.length = 0;
  LEVELS.push({ name: 'Essai', briefing: '', enemyWeapons: ['ak'], map: [
    '#####X#######',
    '#.....#.....#',
    '#..E..D..H..#',
    '#.....#.....#',
    '#############',
  ] });
  try {
    const { game } = mkGame({ level: 0, entry: 0 });
    const b = game.map.breaches[0];
    const room = game.map.roomOf(b.inside.x, b.inside.y);
    const e = game.enemies[0];
    ok(!room.has(Math.floor(e.y / TILE) * game.map.w + Math.floor(e.x / TILE)), 'le suspect est resté dans la pièce d’entrée');
    ok(game.map.circleFree(e.x, e.y, 12, true), 'le suspect est reporté sur une case libre');
    ok(e.x > game.map.doors.find(d => d !== b.door).cx, 'le suspect est passé de l’autre côté de la porte');
    ok(game.hostages.every(h => dist(h.x, h.y, e.x, e.y) >= 26), 'le suspect ne chevauche pas l’otage');
  } finally { LEVELS.length = 0; saved.forEach(l => LEVELS.push(l)); }
});

test('on voit à travers une fenêtre mais on ne la franchit pas', () => {
  const map = new GameMap(LEVELS[0]);
  ok(map.windows.length > 0, 'des fenêtres existent');
  for (const w of map.windows) {
    for (const c of w.cells) {
      eq(map.blocksSight(c.x, c.y), false, 'la fenêtre laisse passer le regard');
      eq(map.blocksMove(c.x, c.y), true, 'la fenêtre bloque le passage');
    }
  }
});

test('le joueur ne peut pas sortir du bâtiment', () => {
  const g = mkGame({ noEnemyAI: true });
  const game = g.game, map = game.map, p = game.player;
  game.enemies = [];
  for (const b of map.breaches) {
    p.x = b.inside.x; p.y = b.inside.y;
    // on pousse deux secondes vers l'extérieur
    const out = { x: b.cx + Math.cos(b.angle + Math.PI) * 3 * TILE, y: b.cy + Math.sin(b.angle + Math.PI) * 3 * TILE };
    for (let i = 0; i < 120; i++) {
      const a = Math.atan2(out.y - p.y, out.x - p.x);
      game.tryMove(p, Math.cos(a) * 2, Math.sin(a) * 2);
    }
    const t = { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
    eq(map.tile(t.x, t.y), 0, map.breachLabel(b) + ' : le joueur est resté sur une case praticable');
    ok(dist(p.x, p.y, out.x, out.y) > TILE, map.breachLabel(b) + ' : il n’a pas atteint l’extérieur');
  }
});

// ---------------------------------------------------------------- siège
test('chaque carte : neuf suspects, et trois, quatre puis cinq otages', () => {
  LEVELS.forEach((l, i) => {
    const map = new GameMap(l);
    eq(map.enemySpawns.length, 9, l.name + ' : postes de suspects');
    eq(map.hostageSpawns.length, 3 + i, l.name + ' : otages');
  });
});

test('en siège, aucun terroriste ne commande les autres', () => {
  const g = mkGame({ mode: 'siege', noEnemyAI: true });
  const game = g.game, p = game.player, inp = game.input;
  const snap = () => JSON.stringify(game.mates.map(m => [m.order, m.orderPos, m.coverAngle, m.holdAngle]));
  const before = snap();
  g.press('KeyT');
  ok(/Pas d'ordres/.test(game.message.text), 'T : refus annoncé');
  inp.mouse.x = p.x + 3 * U; inp.mouse.y = p.y;
  inp.pressed.Mouse2 = true; inp.mouse.rdown = true; g.step(1);
  inp.mouse.rdown = false; inp.pressed.Mouse2Up = true; g.step(1);
  eq(game.orderDrag, null, 'pas de tracé d’ordre au clic droit');
  game.orderMove(p.x + 3 * U, p.y, 0); game.orderFollow(); game.toggleHold();
  eq(snap(), before, 'aucun ordre n’a été pris en compte');
  eq(game.orderMarker, null, 'aucun marqueur d’ordre');
  // en assaut, les ordres restent possibles
  const a = mkGame({ noEnemyAI: true });
  a.game.toggleHold();
  ok(a.game.mates.every(m => m.order === 'hold'), 'assaut : T fonctionne toujours');
});

test('le siège place les deux camps et démarre en préparation', () => {
  const g = mkGame({ mode: 'siege' });
  const game = g.game, s = game.siege;
  ok(s, 'partie de siège en cours');
  eq(game.enemies.length, 0, 'personne à l’intérieur pendant la préparation');
  eq(game.mates.length, 8, 'huit complices : neuf terroristes avec vous');
  ok(game.mates.every(m => m.order === 'hold'), 'ils tiennent leur poste');
  const posts = new Set(game.ops.map(o => Math.round(o.x) + ',' + Math.round(o.y)));
  eq(posts.size, 9, 'chacun sur un poste distinct');
  eq(JSON.stringify(s.waves), '[3,3,3]', 'trois vagues de trois');
  ok(s.breaches.length >= 2, 'plusieurs entrées possibles');
  ok(MODES.siege.primaries.includes(game.loadout.primary), 'arme du camp');
});

test('l’assaut entre par une ouverture, avec un geste d’entrée', () => {
  const g = mkGame({ mode: 'siege' });
  const game = g.game;
  game.siege.prep = 0.01;
  g.step(2);
  eq(game.enemies.length, 3, 'la première équipe est entrée');
  const b = game.siege.breaches[game.siege.lastBreach];
  for (const e of game.enemies) {
    ok(dist(e.x, e.y, b.inside.x, b.inside.y) < 3 * TILE, 'ils arrivent par ' + game.map.breachLabel(b));
    ok(e.act || e.waitDoor, 'entrer prend un geste');
  }
  // ils peuvent ensuite s'arrêter (combat, otage à récupérer) : on vérifie qu'ils ont quitté l'ouverture
  let loin = 0;
  for (let i = 0; i < 600; i++) {
    g.step(1);
    for (const e of game.enemies) loin = Math.max(loin, dist(e.x, e.y, b.inside.x, b.inside.y));
  }
  ok(loin > 3 * U, 'puis ils progressent (' + (loin / U).toFixed(1) + ' cases au plus)');
});

test('les renforts changent d’ouverture', () => {
  const g = mkGame({ mode: 'siege' });
  const game = g.game, s = game.siege;
  s.prep = 0.01; g.step(2);
  const first = s.lastBreach;
  s.nextWave = 0.01; g.step(2);
  ok(s.breaches.length < 2 || s.lastBreach !== first, 'la vague suivante entre ailleurs');
  eq(game.enemies.length, s.waves[0] + s.waves[1], 'la deuxième vague s’ajoute à la première');
});

test('l’assaut récupère les otages, et sans otage la partie est perdue', () => {
  const g = mkGame({ mode: 'siege', noEnd: false });
  const game = g.game;
  game.siege.prep = 0.01; g.step(2);
  game.mates.forEach(m => { m.alive = false; }); // sinon les complices l'abattent avant la fin
  const h = game.hostages[0];
  const op = game.enemies[0];
  op.hp = op.maxHp = 100000;
  op.x = h.x + 10; op.y = h.y;
  h.found = true;
  for (let i = 0; i < 300; i++) { op.x = h.x + 10; op.y = h.y; game.update(1 / 60); }
  ok(h.secured, 'otage récupéré après quelques secondes');
  game.hostages.forEach(x => { x.secured = true; });
  game.update(1 / 60);
  eq(game.over, 'lose', 'plus d’otage : la partie est perdue');
});

test('en siège, la mission ne tombe que quand plus aucun otage n’est vivant entre vos mains', () => {
  const g = mkGame({ mode: 'siege', noEnd: false });
  const game = g.game, hs = game.hostages;
  eq(game.siege.prep, 10, 'dix secondes de préparation');
  ok(hs.length >= 2, 'au moins deux otages sur la carte');
  const shooter = game.enemies[0] || game.player;
  hs.slice(0, -1).forEach(h => game.damage(h, 50, shooter, 0));
  g.step(2);
  ok(!game.over, 'des otages tués, mais il en reste un : la partie continue');
  ok(/il vous en reste 1/.test(game.message.text), 'le HUD annonce combien il en reste');
  game.damage(hs[hs.length - 1], 50, shooter, 0);
  g.step(1);
  eq(game.over, 'lose', 'tous morts : mission échouée');
  ok(/Tous les otages sont morts/.test(game.loseReason), 'raison affichée');

  // morts et récupérés mêlés : il n'en reste aucun à vous non plus
  const g2 = mkGame({ mode: 'siege', noEnd: false });
  const h2 = g2.game.hostages;
  h2.slice(1).forEach(h => { h.secured = true; });
  g2.step(1);
  ok(!g2.game.over, 'un otage encore entre vos mains : la partie continue');
  g2.game.damage(h2[0], 50, g2.game.player, 0);
  g2.step(1);
  eq(g2.game.over, 'lose', 'plus aucun otage vivant entre vos mains');
});

test('une vague éliminée, la suivante arrive vite ; la dernière repoussée, c’est gagné', () => {
  const g = mkGame({ mode: 'siege', noEnd: false });
  const game = g.game, s = game.siege;
  s.prep = 0.01; g.step(2);
  eq(s.wave, 1, 'première vague entrée');
  eq(game.enemies.length, s.waves[0], 'effectif de la première vague');
  const kill = () => game.enemies.forEach(e => { e.alive = false; });
  for (let n = 2; n <= s.waves.length; n++) {
    kill();
    g.step(1);
    ok(!game.over, 'pas de victoire tant qu’il reste des vagues (' + (n - 1) + ' / ' + s.waves.length + ')');
    ok(s.nextWave <= s.gap, 'répit court après une vague éliminée');
    g.step(Math.ceil(s.gap * 60) + 2);
    eq(s.wave, n, 'la vague ' + n + ' est entrée');
    eq(game.enemies.filter(e => e.alive).length, s.waves[n - 1], 'effectif de la vague ' + n);
  }
  kill();
  g.step(1);
  eq(game.over, 'win', 'dernière vague repoussée');
});

test('une vague qui tient n’empêche pas la suivante d’entrer', () => {
  const g = mkGame({ mode: 'siege' });
  const game = g.game, s = game.siege;
  s.prep = 0.01; g.step(2);
  game.enemies.forEach(e => { e.hp = e.maxHp = 100000; });
  game.mates.forEach(m => { m.alive = false; });
  game.player.hp = game.player.maxHp = 100000;
  near(s.nextWave, s.maxGap, 0.1, 'délai maximal armé');
  g.step(Math.ceil(s.maxGap * 60) + 2);
  eq(s.wave, 2, 'la deuxième vague est entrée sans attendre la fin de la première');
});

// Porte intérieure avec du champ libre des deux côtés : deux points à 1,5 case de part et d'autre.
function doorWithRoom(game) {
  for (const d of game.map.doors) {
    if (game.map.breaches.some(b => b.door === d)) continue;
    const nx = d.horizontal ? 0 : 1, ny = d.horizontal ? 1 : 0;
    const a = { x: d.cx - nx * 1.5 * U, y: d.cy - ny * 1.5 * U }, b = { x: d.cx + nx * 1.5 * U, y: d.cy + ny * 1.5 * U };
    setDoor(d, 1);
    const okd = game.map.circleFree(a.x, a.y, 12, true) && game.map.circleFree(b.x, b.y, 12, true) && game.clearThrow(a.x, a.y, b.x, b.y);
    setDoor(d, 0);
    if (okd) return { d, a, b, nx, ny };
  }
  return null;
}

test('l’assaut dégoupille avant d’entrer, mais jamais contre une porte fermée', () => {
  const g = mkGame({ mode: 'siege' });
  const game = g.game;
  game.siege.prep = 0.01; g.step(2);
  const op = game.enemies[0];
  game.enemies = [op];
  const w = doorWithRoom(game);
  ok(w, 'une porte de test');
  // le dernier contact est 3 cases plus loin, derrière la porte
  op.act = null; op.waitDoor = null; op.flashCd = 0; op.path = [];
  op.x = w.a.x - w.nx * 0.5 * U; op.y = w.a.y - w.ny * 0.5 * U;
  op.lastKnown = { x: w.b.x, y: w.b.y };
  setDoor(w.d, 0);
  ok(!game.maybeFlash(op, 1 / 60) && !op.act, 'porte fermée : pas de lancer (elle reviendrait à ses pieds)');
  setDoor(w.d, 1);
  op.flashCd = 0;
  ok(game.maybeFlash(op, 1 / 60) && op.act && op.act.type === 'grenade', 'porte ouverte : il dégoupille');
});

test('une flash n’aveugle pas le camp qui la lance, sauf à ses pieds', () => {
  const g = mkGame({ mode: 'siege' });
  const game = g.game;
  game.siege.prep = 0.01; g.step(2);
  const w = doorWithRoom(game);
  setDoor(w.d, 1);
  const [op1, op2] = game.enemies;
  game.enemies = [op1, op2];
  op1.x = w.a.x; op1.y = w.a.y;                                        // à 3 cases de l'éclair
  op2.x = w.b.x - w.nx * 0.6 * U; op2.y = w.b.y - w.ny * 0.6 * U;       // presque dessus
  const p = game.player;
  p.x = w.b.x + w.nx * 1 * U; p.y = w.b.y + w.ny * 1 * U; p.angle = Math.atan2(w.b.y - p.y, w.b.x - p.x);
  op1.stun = op2.stun = 0; p.flashT = 0;
  game.detonateFlash(w.b.x, w.b.y, { team: 'enemy', thrower: op1 });
  eq(op1.stun, 0, 'le lanceur a détourné les yeux');
  ok(op2.stun > 0, 'un équipier collé à l’éclair est quand même gêné');
  ok(p.flashT > 0, 'l’adversaire est aveuglé');
});

test('en siège : pas de fibre, deux grenades à fragmentation', () => {
  const g = mkGame({ mode: 'siege' });
  const game = g.game, p = game.player;
  eq(p.nade, 'frag', 'grenades à fragmentation');
  eq(p.flashbangs, 2, 'deux grenades');
  const d = nearestDoorTo(game.map, p.x, p.y);
  setDoor(d, 0); faceDoor(g, d, 24);
  game.message = { text: '', t: 0 };
  g.press('KeyF');
  ok(!p.act && !p.fiber && /Pas de fibre/.test(game.message.text), 'F : refus annoncé');
  g.game.input.mouse.x = p.x + 2 * U; g.game.input.mouse.y = p.y;
  p.act = null;
  g.press('Space'); g.step(40);
  ok(game.grenades.some(x => x.kind === 'frag'), 'la grenade lancée est une fragmentation');
  eq(p.flashbangs, 1, 'il en reste une');
  // en assaut, rien ne change
  const a = mkGame().game.player;
  eq(a.nade, 'flash', 'assaut : flashs');
});

test('une grenade à fragmentation tue autour d’elle, pas derrière une porte fermée', () => {
  const g = mkGame({ mode: 'siege' });
  const game = g.game;
  game.siege.prep = 0.01; g.step(2);
  const w = doorWithRoom(game);
  setDoor(w.d, 0);
  const [near1, behind] = game.enemies;
  game.enemies = [near1, behind];
  const bx = w.a.x - w.nx * 0.5 * U, by = w.a.y - w.ny * 0.5 * U;      // éclatement côté A
  near1.x = bx + w.ny * 0.8 * U; near1.y = by + w.nx * 0.8 * U;
  behind.x = w.b.x; behind.y = w.b.y;
  const p = game.player;
  p.x = bx - w.ny * 1.2 * U; p.y = by - w.nx * 1.2 * U; p.hp = 100;
  game.mates.forEach(m => { m.x = m.y = 4 * TILE; });
  const hp = behind.hp;
  game.detonateFrag({ x: bx, y: by, thrower: p, team: 'ops' });
  eq(near1.alive, false, 'l’opérateur à côté est tué');
  eq(behind.hp, hp, 'la porte fermée protège');
  ok(p.hp < 100, 'le lanceur trop proche est blessé lui aussi');
});

test('une vague n’apparaît jamais empilée, et deux agents superposés se séparent', () => {
  for (let i = 0; i < LEVELS.length; i++) {
    const g = mkGame({ mode: 'siege', level: i });
    const game = g.game;
    for (let n = 0; n < 8; n++) {
      game.enemies = [];
      const b = game.spawnAssault(3);
      const e = game.enemies;
      for (let a = 0; a < e.length; a++) for (let c = a + 1; c < e.length; c++)
        ok(dist(e[a].x, e[a].y, e[c].x, e[c].y) >= 18, LEVELS[i].name + ' / ' + game.map.breachLabel(b) + ' : opérateurs empilés');
    }
  }
  const g = mkGame({ mode: 'siege' });
  const game = g.game;
  game.siege.prep = 0.01; g.step(2);
  const [a, b] = game.enemies;
  b.x = a.x; b.y = a.y;
  game.separate();
  ok(dist(a.x, a.y, b.x, b.y) > 1, 'deux opérateurs superposés sont écartés');
});

// ---------------------------------------------------------------- écrans
test('un otage survit à une blessure légère, pas à la deuxième ni à une blessure grave', () => {
  const g = mkGame({ mode: 'siege' });
  const game = g.game, [h1, h2] = game.hostages;
  ok(h1.radius <= 7, 'otage à genoux : petite cible');
  game.damage(h1, WEAPONS.hk416op.damage, null, 0);
  ok(h1.alive && h1.wounded, 'première balle : blessé');
  ok(/blessé/.test(game.message.text), 'blessure annoncée');
  game.damage(h1, WEAPONS.pistolE.damage, null, 0);
  eq(h1.alive, false, 'deuxième balle : mort');
  game.damage(h2, HOSTAGE_GRAVE, null, 0);
  eq(h2.alive, false, 'blessure grave : mort sur le coup');
});

test('l’intervention ne tire pas à travers un otage : elle se décale', () => {
  const g = mkGame({ mode: 'siege' });
  const game = g.game, s = game.siege, p = game.player;
  s.prep = 0; s.wave = s.waves.length; // pas de vague : on place nous-mêmes l'opérateur
  game.mates.forEach(m => { m.alive = false; });
  const AY = 112;
  p.x = 240; p.y = AY; p.hp = p.maxHp = 1e9; // cible immobile et increvable
  const h = game.hostages[0];
  h.x = 176; h.y = AY;
  const op = new Operator(112, AY, 0, 'hk416op');
  game.enemies = [op];
  let shots = 0, sawBlocked = false;
  const fire = game.fireWeapon.bind(game);
  game.fireWeapon = a => { if (a === op && !game.lineOfFireClear(op, p)) shots++; fire(a); };
  const hp0 = p.hp;
  for (let i = 0; i < 60 * 8; i++) { g.step(1); sawBlocked = sawBlocked || op.blockedLine; }
  eq(shots, 0, 'aucun tir avec l’otage dans l’axe');
  ok(sawBlocked, 'axe signalé bouché');
  ok(h.alive && !h.wounded, 'otage indemne');
  ok(p.hp < hp0, 'il a trouvé un angle et touché sa cible');
});

test('le bilan donne le nombre d’otages tués', () => {
  for (const mode of ['assault', 'siege']) {
    const g = mkGame({ mode, level: 2 });
    const game = g.game, hs = game.hostages;
    game.damage(hs[0], 50, game.player, 0);
    game.damage(hs[1], 50, game.player, 0);
    g.ui.showEnd('lose');
    const cell = document.getElementById('endHostagesKilled');
    ok(cell, mode + ' : ligne des otages tués');
    eq(cell.textContent, '2 / ' + hs.length, mode + ' : otages tués');
    ok(/Otages tués/.test(document.getElementById('overlayPanel').textContent), mode + ' : libellé');
    g.ui.hideOverlay();
  }
});

test('après une victoire, « Missions » puis « Retour » ne fige pas le jeu', () => {
  const g = mkGame({ noEnd: false });
  const game = g.game, ui = g.ui;
  game.enemies.forEach(e => { e.alive = false; });
  g.step(2);
  eq(game.over, 'win', 'victoire');
  ui.showEnd('win');
  ui.panel.querySelector('#ovLevels').click();
  ui.panel.querySelector('#ovClose').click();
  ok(/accomplie/i.test(ui.panel.querySelector('h1').textContent), 'retour à l’écran de fin');
  ui.showBriefing();                         // chemin de secours : briefing sur une mission finie
  ui.panel.querySelector('#ovGo').click();
  eq(game.over, null, 'la mission est relancée');
  const t = game.time;
  g.step(30);
  ok(game.time > t, 'le temps avance');
});

test('le briefing propose les deux modes et l’équipement du camp', () => {
  const g = mkGame();
  const ui = g.ui;
  ui.showBriefing();
  eq(ui.panel.querySelectorAll('.modebtn').length, Object.keys(MODES).length, 'un bouton par mode');
  const cards = [...ui.panel.querySelectorAll('.wcard')].map(b => b.dataset.key);
  eq(cards.length, MODES.assault.primaries.length + MODES.assault.sidearms.length, 'cartes d’armes du mode');
  ok(cards.every(k => MODES.assault.primaries.includes(k) || MODES.assault.sidearms.includes(k)), 'armes du bon camp');
});

// ---------------------------------------------------------------- rendu
test('trois missions se jouent sans exception, dans les deux modes', () => {
  for (const mode of ['assault', 'siege']) {
    for (let lvl = 0; lvl < LEVELS.length; lvl++) {
      const g = mkGame({ mode, level: lvl });
      const p = g.game.player;
      if (g.game.siege) g.game.siege.prep = 0.5;
      for (let i = 0; i < 420; i++) {
        const inp = g.game.input;
        inp.mouse.x = p.x + Math.cos(i / 40) * 120; inp.mouse.y = p.y + Math.sin(i / 40) * 120;
        inp.mouse.down = i % 90 < 8;
        if (i % 150 === 40) inp.pressed.KeyE = true;
        if (i % 150 === 90) inp.pressed.Space = true;
        g.step(1);
      }
      ok(true, mode + ' / mission ' + (lvl + 1));
    }
  }
});

// ---- Rapport ----
(function report() {
  const out = document.getElementById('out'), sum = document.getElementById('summary');
  out.innerHTML = T.lines.map(l => '<div class="' + l[0] + '">' + l[1].replace(/</g, '&lt;') + '</div>').join('');
  sum.textContent = T.fail ? (T.fail + ' échec(s) sur ' + (T.pass + T.fail)) : ('Tout passe — ' + T.pass + ' tests');
  sum.className = T.fail ? 'ko' : 'ok';
  document.title = T.fail ? 'FAIL ' + T.fail : 'PASS';
})();
