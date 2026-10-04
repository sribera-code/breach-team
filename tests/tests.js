'use strict';
// Tests de non-régression. Ouvrir tests/index.html dans un navigateur, ou :
//   chrome --headless --dump-dom tests/index.html   (le titre de la page vaut PASS ou FAIL n)
// Les tests ne passent pas par setMode / setLoadout : rien n'est écrit dans localStorage (ceux qui cliquent
// sur le briefing remettent les réglages du joueur en sortant).

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
  game.loadout = opts.loadout ? Game.normLoadout(opts.loadout, MODES[game.mode]) : Game.loadSavedLoadout(game.mode);
  game.entryRandom = false;          // les tests choisissent, sinon l'entrée est tirée au sort
  game.entryIndex = opts.entry || 0;
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

test('collé à un mur, on ne tire pas à travers', () => {
  const g = mkGame({ alone: true, loadout: { primary: 'scarh', sidearm: 'glock17' } });
  const game = g.game, p = game.player, map = game.map;
  // un mur vertical plein (ni porte ni ouverture) avec du sol des deux côtés
  let spot = null;
  for (let ty = 2; ty < map.h - 2 && !spot; ty++) for (let tx = 2; tx < map.w - 2 && !spot; tx++) {
    if (!map.isWall(tx, ty) || map.door(tx, ty) || map.isWall(tx - 1, ty) || map.isWall(tx + 1, ty)) continue;
    if (![-2, -1, 1, 2].every(k => map.isWall(tx, ty + k) && !map.door(tx, ty + k))) continue;
    const y = (ty + 0.5) * TILE;
    if (map.circleFree(tx * TILE - 11, y, 10, true) && map.circleFree((tx + 1) * TILE + 20, y, 10, true)) spot = { tx, y };
  }
  ok(spot, 'un mur de test');
  p.x = spot.tx * TILE - 11.5; p.y = spot.y;                 // épaule contre le mur
  const foe = new Enemy((spot.tx + 1) * TILE + 20, spot.y, Math.PI, 'ak');
  foe.hp = foe.maxHp = 1e6;
  game.enemies = [foe];
  game.updateEnemy = () => {};
  game.input.mouse.x = foe.x; game.input.mouse.y = foe.y;
  game.input.mouse.down = true; // arme automatique : bouton maintenu
  g.step(90);
  game.input.mouse.down = false;
  ok(game.stats.shots >= 5, 'des coups sont partis');
  eq(foe.hp, 1e6, 'le suspect derrière le mur est indemne');
  // une grenade non plus ne passe pas de l'autre côté
  game.grenades = [];
  game.spawnFlash(p, foe.x, foe.y);
  ok(game.grenades[0].x < spot.tx * TILE, 'la grenade part du bon côté du mur');
  g.step(30);
  ok(game.grenades.every(gr => gr.x < spot.tx * TILE), 'et y reste');
});

// Meuble isolé avec 2,5 cases de sol libre de chaque côté, sur son axe horizontal.
function lonelyProp() {
  for (let i = 0; i < LEVELS.length; i++) {
    const g = mkGame({ alone: true, level: i });
    const map = g.game.map;
    for (const pr of map.props) {
      const y = pr.cy, x0 = pr.cx - 2.5 * U, x1 = pr.cx + 2.5 * U;
      let clear = map.circleFree(x0, y, 12, true) && map.circleFree(x1, y, 12, true);
      for (let x = x0; x <= x1 && clear; x += 4) for (const yy of [y - 6, y + 6]) {
        const tx = Math.floor(x / TILE), ty = Math.floor(yy / TILE), o = map.prop(tx, ty);
        if (map.isWall(tx, ty) || map.door(tx, ty) || map.window(tx, ty) || (o && o !== pr)) clear = false;
      }
      if (clear) return { g, pr, x0, x1, y };
    }
  }
  return null;
}

test('une grenade lancée passe par-dessus le mobilier, mais bute dessus en roulant', () => {
  const spot = lonelyProp();
  ok(spot, 'un meuble isolé');
  const { g, pr, x0, x1, y } = spot;
  const game = g.game, p = game.player;
  p.x = x0; p.y = y;
  game.spawnFlash(p, x1, y);
  const air = game.grenades[game.grenades.length - 1];
  g.step(40);
  ok(air.x > pr.cx + TILE, pr.type + ' : la grenade est passée par-dessus (' + Math.round(air.x - pr.cx) + ' px)');
  game.grenades = [];
  game.spawnFlash(p, x1, y);
  const rolling = game.grenades[0];
  rolling.t = rolling.flight;            // déjà retombée : elle roule vers le meuble
  g.step(40);
  ok(rolling.x < pr.cx - TILE, pr.type + ' : au sol, elle rebondit dessus (' + Math.round(rolling.x - pr.cx) + ' px)');
  // l'IA en tient compte : un meuble survolé ne gêne pas, un meuble sur lequel elle roulerait si
  ok(game.clearThrow(x0, y, x1, y), 'lancer libre par-dessus le meuble');
  ok(!game.clearThrow(x0, y, pr.cx + 4, y), 'lancer refusé quand elle doit rouler sur le meuble');
});

test('une grenade retombée sur un meuble en roule jusqu’au sol', () => {
  const spot = lonelyProp();
  ok(spot, 'un meuble isolé');
  const { g, pr, y } = spot;
  const game = g.game;
  game.grenades = [{ x: pr.cx, y, vx: 120, vy: 0, t: 0.5, flight: GRENADE_FLIGHT, friction: GRENADE_FRICTION, fuse: 10, cooked: 0,
    h: 0, spin: 0, bounces: 0, post: null, kind: 'flash', team: 'ops', thrower: game.player }];
  g.step(3);
  ok(game.grenades[0].h >= 5, 'posée sur le plateau');
  g.step(60);
  const gr = game.grenades[0];
  ok(gr.x > pr.cx + TILE && !game.grenadeOnProp(gr), 'elle a roulé hors du meuble');
  eq(gr.bounces, 0, 'sans rebondir sur le meuble dont elle descend');
});

test('recharger s’anime, chargeur en main, pour le joueur comme pour l’équipe', () => {
  const g = mkGame({ noEnemyAI: true });
  const p = g.game.player;
  p.slot.mag = 0;
  g.press('KeyR');
  ok(p.reloadT > 0 && p.reloadDur === p.weapon.reload, 'rechargement en cours, durée mémorisée');
  const st = actStyle(p);
  ok(st && st.act.type === 'reload', 'le rendu voit un geste de rechargement');
  near(st.act.k, 0, 0.05, 'au début du geste');
  const pose = lerpPose(POSE_STAND, POSE_STAND, 0);
  const out = Sprites.actionPose({ ...st, gun: p.weapon.kind }, pose, Sprites.hands(p.weapon.kind));
  ok(out.mag === null || Array.isArray(out.mag), 'le chargeur est une position ou rien');
  g.step(Math.ceil(p.weapon.reload * 30));
  const mid = Sprites.actionPose({ ...actStyle(p), gun: p.weapon.kind }, lerpPose(POSE_STAND, POSE_STAND, 0), Sprites.hands(p.weapon.kind));
  ok(Array.isArray(mid.mag), 'à mi-geste, le chargeur est en main');
  g.step(Math.ceil(p.weapon.reload * 40));
  eq(actStyle(p), null, 'plus d’animation une fois rechargé');
  eq(p.slot.mag, p.weapon.mag, 'chargeur plein');
  // un coéquipier aussi, et un fusil à pompe met plus longtemps à se remplir
  const m = g.game.mates[0];
  m.slot.mag = 0;
  g.game.mateReload(m);
  ok(m.reloadT > 0 && m.reloadDur === m.reloadT, 'coéquipier : durée mémorisée');
  ok(actStyle(m).act.type === 'reload', 'et son geste s’anime');
  const sg = g.game.mates.find(x => x.weapon.reloadType === 'shell') || g.game.mates[0];
  sg.slot = { ...sg.slot, def: WEAPONS.m870, mag: 0 };
  g.game.mateReload(sg);
  near(sg.reloadDur, WEAPONS.m870.reload * WEAPONS.m870.mag, 0.01, 'le magasin se remplit cartouche par cartouche');
});

test('le groupe armé a son arsenal, et son chef ne porte aucun signe distinctif', () => {
  for (const k of ['uziP', 'skorpionP', 'tt33']) {
    ok(WEAPONS[k] && WEAPONS[k].maker, k + ' : arme décrite');
    ok(SIEGE_MATE_POOL.includes(k), k + ' : un complice peut la porter');
  }
  ok(MODES.siege.primaries.includes('uziP') && MODES.siege.primaries.includes('skorpionP'), 'Uzi et Škorpion au briefing');
  ok(MODES.siege.sidearms.includes('tt33'), 'TT-33 au briefing');
  ok(WEAPONS.uziE.pickup === 'uziP', 'l’Uzi d’un suspect se ramasse');
  ok(LEVELS.every(l => l.enemyWeapons.includes('uziE')), 'les suspects en portent aussi');
  eq(STYLE_BOSS.band, undefined, 'pas de bandeau sur la tête du chef');
  for (const k of ['head', 'hair', 'skin', 'gloves', 'boots']) eq(STYLE_BOSS[k], STYLE_MILITANT[k], 'le chef a la même tête que ses hommes (' + k + ')');
});

test('les armes sont tirées au sort, pas les mêmes pour tout le monde', () => {
  // coéquipiers : tirage sans doublon tant que le lot suffit
  const vus = new Set();
  for (let i = 0; i < 25; i++) {
    const g = mkGame();
    const noms = g.game.mates.map(m => m.weapon.name);
    eq(new Set(noms).size, noms.length, 'deux coéquipiers, deux armes différentes');
    noms.forEach(n => vus.add(n));
  }
  ok(vus.size >= 3, 'plusieurs armes différentes sur 25 parties : ' + [...vus].join(', '));
  // suspects : le lot de la mission, plusieurs armes représentées
  const armes = new Set();
  for (let i = 0; i < 10; i++) mkGame({ level: 2 }).game.enemies.forEach(e => armes.add(e.weapon.name));
  ok(armes.size >= 2, 'les suspects ne portent pas tous la même arme : ' + [...armes].join(', '));
  // opérateurs d'une même vague
  const ops = new Set();
  for (let i = 0; i < 10; i++) {
    const g = mkGame({ mode: 'siege' });
    g.game.siege.prep = 0.01; g.step(2);
    g.game.enemies.forEach(e => ops.add(e.weapon.name));
  }
  ok(ops.size >= 2, 'l’assaut panache ses armes : ' + [...ops].join(', '));
  eq(dealWeapons(['a', 'b'], 2).sort().join(','), 'a,b', 'un lot de deux se distribue sans doublon');
  eq(dealWeapons(['a'], 3).length, 3, 'et se répète quand il est épuisé');
});

test('le point d’entrée est tiré au sort par défaut, et peut être choisi', () => {
  // setEntry mémorise le choix : on remet le réglage du joueur en sortant
  let sauve = null;
  try { sauve = localStorage.getItem('breach.entry'); } catch (e) { /* stockage indisponible */ }
  try { entryTest(); } finally {
    try { if (sauve === null) localStorage.removeItem('breach.entry'); else localStorage.setItem('breach.entry', sauve); } catch (e) { /* idem */ }
  }
});

function entryTest() {
  const g = mkGame();
  const game = g.game;
  game.entryRandom = true;
  const tirages = new Set();
  for (let i = 0; i < 30; i++) { game.loadLevel(0); tirages.add(game.entryIndex); }
  ok(tirages.size >= 2, 'plusieurs ouvertures sortent : ' + [...tirages].join(', '));
  // le briefing propose « Au hasard » puis chaque ouverture
  game.paused = true;
  g.ui.showBriefing();
  const btns = [...document.querySelectorAll('.entrybtn')];
  ok(btns.length === game.map.breaches.length + 1, 'un bouton par ouverture, plus le tirage au sort');
  ok(/Au hasard/.test(btns[0].textContent) && btns[0].classList.contains('sel'), '« Au hasard » est le choix par défaut');
  eq(btns[0].textContent.trim(), 'Au hasard', 'il ne dévoile pas l’ouverture tirée');
  btns[2].click();                       // on fixe une ouverture
  eq(game.entryRandom, false, 'choix fixe');
  eq(game.entryIndex, 1, 'l’ouverture choisie');
  for (let i = 0; i < 5; i++) { game.loadLevel(0); eq(game.entryIndex, 1, 'elle ne bouge plus'); }
  document.querySelectorAll('.entrybtn')[0].click();
  eq(game.entryRandom, true, '« Au hasard » revient');
  g.ui.hideOverlay();
  game.paused = false;
}

test('la mèche part à la fin du geste, pas au lancer', () => {
  const g = mkGame({ alone: true });
  const game = g.game, p = game.player;
  game.input.mouse.x = p.x + 4 * U; game.input.mouse.y = p.y;
  game.input.keys.Space = true;          // on garde la touche : la grenade reste en main
  g.press('Space');
  ok(p.act && p.act.type === 'grenade', 'geste d’armement');
  eq(game.grenades.length, 0, 'rien n’est encore parti');
  g.step(30);                            // fin du geste (0,45 s)
  ok(p.cooking, 'la grenade est dégoupillée en main');
  eq(game.grenades.length, 0, 'toujours en main');
  const fuse = p.cooking.fuse;
  // on ne tire ni ne recharge avec une grenade dégoupillée
  const shots = game.stats.shots;
  game.input.mouse.down = true; game.input.pressed.Mouse0 = true; g.step(1);
  eq(game.stats.shots, shots, 'pas de tir pendant ce temps');
  game.input.mouse.down = false;
  g.press('KeyR');
  eq(p.reloadT, 0, 'pas de rechargement non plus');
  g.step(36);                            // on la garde ~0,6 s de plus
  const reste = p.cooking.fuse - p.cooking.t;
  ok(reste < fuse - 0.5, 'la mèche a brûlé en main : ' + reste.toFixed(2) + ' s restantes');
  game.input.keys.Space = false;         // lancer
  g.step(1);
  eq(game.grenades.length, 1, 'elle part au relâchement');
  const gr = game.grenades[0];
  near(gr.cooked, fuse - reste, 0.1, 'le temps brûlé en main est reporté sur la grenade');
  g.step(Math.ceil(reste * 60) + 4);
  eq(game.grenades.length, 0, 'elle éclate au bout de la mèche, pas plus tard');
  ok(game.effects.some(f => f.type === 'flash'), 'éclair au bout du compte');
});

test('gardée jusqu’au bout, la grenade éclate dans la main', () => {
  const g = mkGame({ mode: 'siege' });
  const game = g.game, p = game.player;
  game.mates.forEach(m => { m.x = m.y = 4 * TILE; });
  game.input.mouse.x = p.x + 3 * U; game.input.mouse.y = p.y;
  game.input.keys.Space = true;
  g.press('Space');
  g.step(30);
  ok(p.cooking && p.cooking.kind === 'frag', 'fragmentation dégoupillée');
  const hp = p.hp;
  g.step(Math.ceil(p.cooking.fuse * 60) + 4);
  const dit = /dans la main/.test(game.message.text);
  eq(game.grenades.length, 0, 'elle n’a jamais été lancée');
  ok(!p.cooking, 'plus rien en main');
  ok(p.hp < hp || !p.alive, 'elle lui a explosé dessus');
  ok(dit, 'le jeu le dit');
  game.input.keys.Space = false;
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

test('une porte fermée saute à la chevrotine, et ne se referme plus', () => {
  const g = mkGame({ alone: true, loadout: { primary: 'm870', sidearm: 'glock17' } });
  const game = g.game, p = game.player;
  const w = doorWithRoom(game);
  ok(w, 'une porte de test');
  setDoor(w.d, 0);
  p.x = w.a.x; p.y = w.a.y;
  game.input.mouse.x = w.d.cx; game.input.mouse.y = w.d.cy;
  for (let i = 0; i < 3 && !w.d.broken; i++) { game.input.pressed.Mouse0 = true; g.step(45); }
  ok(w.d.broken, 'la serrure a lâché');
  g.step(60);
  ok(w.d.open, 'la porte s’est ouverte d’un coup');
  // on ne la referme plus
  p.act = null;
  faceDoor(g, w.d, 26);
  game.message = { text: '', t: 0 };
  g.press('KeyE');
  ok(!p.act && /serrure/i.test(game.message.text), 'refus annoncé : "' + game.message.text + '"');
  g.step(60);
  ok(w.d.open, 'elle reste ouverte');
});

test('une balle de fusil ne fait pas sauter une porte', () => {
  const g = mkGame({ alone: true, loadout: { primary: 'hk416', sidearm: 'glock17' } });
  const game = g.game, p = game.player;
  const w = doorWithRoom(game);
  setDoor(w.d, 0);
  p.x = w.a.x; p.y = w.a.y;
  game.input.mouse.x = w.d.cx; game.input.mouse.y = w.d.cy;
  game.input.mouse.down = true;
  g.step(90);
  game.input.mouse.down = false;
  ok(game.stats.shots >= 10, 'un chargeur y est passé');
  ok(!w.d.broken && !w.d.open, 'la porte tient');
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

test('une porte entrouverte laisse passer, une porte entrebâillée non', () => {
  // on pousse vers la porte depuis un côté dégagé, et on regarde si on est passé de l'autre
  const walk = (g, w) => {
    const p = g.game.player, d = w.d;
    p.x = w.a.x; p.y = w.a.y;
    g.game.input.mouse.x = w.b.x; g.game.input.mouse.y = w.b.y;
    const key = d.horizontal ? 'KeyS' : 'KeyD';
    g.game.input.keys[key] = true;
    g.step(120);
    g.game.input.keys[key] = false;
    return d.horizontal ? p.y - d.cy : p.x - d.cx; // > 0 : passé de l'autre côté
  };
  for (let i = 0; i < LEVELS.length; i++) {
    const g = mkGame({ alone: true, level: i });
    const w = doorWithRoom(g.game);
    ok(w, LEVELS[i].name + ' : une porte de test');
    setDoor(w.d, DOOR_STEPS[1]);
    ok(walk(g, w) < 0, LEVELS[i].name + ' : entrebâillée, le passage reste bloqué');
    setDoor(w.d, DOOR_STEPS[2]);
    ok(walk(g, w) > 0, LEVELS[i].name + ' : entrouverte, on se glisse dans l’embrasure');
    setDoor(w.d, 1);
    ok(walk(g, w) > 0, LEVELS[i].name + ' : ouverte, on passe');
  }
});

test('la minimap se dessine et se replie avec M', () => {
  for (const mode of ['assault', 'siege']) {
    const g = mkGame({ mode });
    eq(g.game.minimap, true, mode + ' : affichée par défaut');
    ok(g.r.miniC.width === g.game.map.w * g.r.miniScale, mode + ' : plan réduit à la taille de la carte');
    g.step(2); // le masque des cases vues suit le brouillard
    const seen = () => {
      const c = g.r.miniExpC.getContext('2d').getImageData(0, 0, g.r.miniExpC.width, g.r.miniExpC.height).data;
      let n = 0;
      for (let i = 3; i < c.length; i += 4) if (c[i]) n++;
      return n;
    };
    ok(seen() > 0, mode + ' : les cases explorées sont reportées');
    g.press('KeyM');
    eq(g.game.minimap, false, mode + ' : M la replie');
    g.step(2);
    g.press('KeyM');
    eq(g.game.minimap, true, mode + ' : M la ramène');
  }
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
    // le relais revient au plus proche : avec des postes tirés au sort, ce n'est pas toujours le premier
    const heir = game.mates.slice().sort((a, b) => dist(a.x, a.y, old.x, old.y) - dist(b.x, b.y, old.x, old.y))[0];
    const name = heir.name;
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

test('la disposition des terroristes et des otages change à chaque partie', () => {
  const clef = a => Math.round(a.x) + ',' + Math.round(a.y);
  for (const mode of ['assault', 'siege']) {
    const vus = new Set(), chefs = new Set();
    for (let i = 0; i < 12; i++) {
      const g = mkGame({ mode, level: 1 });
      const game = g.game;
      vus.add([...game.enemies, ...game.mates, ...game.hostages].map(clef).sort().join('|'));
      chefs.add(clef(game.player));
    }
    ok(vus.size >= 10, mode + ' : dispositions différentes (' + vus.size + ' sur 12)');
    if (mode === 'siege') ok(chefs.size >= 5, 'le chef change de poste lui aussi (' + chefs.size + ' sur 12)');
  }
});

test('personne n’est posé dans un recoin inaccessible', () => {
  for (let i = 0; i < LEVELS.length; i++) for (const mode of ['assault', 'siege']) {
    for (let n = 0; n < 4; n++) {
      const g = mkGame({ mode, level: i });
      const game = g.game, p = game.player;
      for (const a of [...game.enemies, ...game.mates, ...game.hostages]) {
        ok(game.map.circleFree(a.x, a.y, 11, false), LEVELS[i].name + ' : poste libre');
        const route = game.map.routeTo(p.x, p.y, Math.floor(a.x / TILE), Math.floor(a.y / TILE), 11);
        ok(route && route.length, LEVELS[i].name + ' / ' + mode + ' : on peut rejoindre chacun (' + (a.name || 'otage') + ')');
      }
    }
  }
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

test('sols et meubles : nouveaux caractères, dos au mur, rangées d’un tenant', () => {
  const map = new GameMap({ map: [
    '#########',
    '#;sss;==#',
    '#;;;;;==#',
    '#r%%%%%C#',
    '#r%%%%%C#',
    '#::::b::#',
    '#########',
  ] });
  const at = (x, y) => map.props.find(p => p.x === 2 * x && p.y === 2 * y);
  eq(map.floor(2, 2), FLOOR[';'], 'moquette');
  eq(map.floor(12, 2), FLOOR['='], 'marbre');
  eq(map.floor(6, 6), FLOOR['%'], 'tôle striée');
  const [s1, s2, s3] = [at(2, 1), at(3, 1), at(4, 1)];
  ok(s1 && s2 && s3 && [s1, s2, s3].every(p => p.type === 'sofa' && p.rot === 0), 'canapé dos au mur du haut');
  ok(!s1.link.l && s1.link.r && s2.link.l && s2.link.r && s3.link.l && !s3.link.r, 'trois places d’un seul tenant');
  ok([at(1, 3), at(1, 4)].every(p => p.type === 'shelf' && p.rot === -Math.PI / 2), 'rayonnage contre le mur de gauche');
  ok([at(7, 3), at(7, 4)].every(p => p.type === 'counter' && p.rot === Math.PI / 2), 'comptoir contre le mur de droite');
  eq(at(5, 5).rot, Math.PI, 'lit tête contre le mur du bas');
  // chaque meuble de chaque carte se dessine
  const c = document.createElement('canvas').getContext('2d');
  for (const l of LEVELS) for (const p of new GameMap(l).props) Sprites.paintProp(c, p);
});

test('chaque ouverture a un nom distinct', () => {
  for (const l of LEVELS) {
    const map = new GameMap(l);
    const names = map.breaches.map(b => map.breachLabel(b));
    eq(new Set(names).size, names.length, l.name + ' : ' + names.join(', '));
  }
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

// ---------------------------------------------------------------- bruit
// Mur plein (ni porte ni ouverture) avec du sol des deux côtés : sa colonne tx et une ordonnée y.
function wallSpot(map) {
  for (let ty = 2; ty < map.h - 2; ty++) for (let tx = 2; tx < map.w - 2; tx++) {
    if (!map.isWall(tx, ty) || map.door(tx, ty) || map.isWall(tx - 1, ty) || map.isWall(tx + 1, ty)) continue;
    if (![-2, -1, 1, 2].every(k => map.isWall(tx, ty + k) && !map.door(tx, ty + k))) continue;
    const y = (ty + 0.5) * TILE;
    if (map.circleFree(tx * TILE - 20, y, 10, true) && map.circleFree((tx + 1) * TILE + 20, y, 10, true)) return { tx, y };
  }
  return null;
}
// Intensité perçue en (x, y) d'un bruit parti de (x0, y0) avec la portée R.
function heardAt(game, x0, y0, R, x, y) {
  const f = game.soundField(x0, y0, R);
  const d = f[Math.floor(y / TILE) * game.map.w + Math.floor(x / TILE)];
  return d < R ? 1 - d / R : 0;
}
// Un suspect « sourd-voyant » : il entend mais ne voit personne (on isole l'ouïe).
function deafEye(game, x, y) {
  const e = new Enemy(x, y, 0, 'ak');
  e.viewRange = 0;
  game.enemies.push(e);
  return e;
}
// n cases libres autour de c, à 20 px au moins les unes des autres, en vue de c.
function freeSpotsAround(game, c, n) {
  const out = [];
  for (let r = 0.8 * U; r <= 3 * U && out.length < n; r += 0.4 * U) for (let k = 0; k < 12 && out.length < n; k++) {
    const x = c.x + Math.cos(k * TAU / 12 + r) * r, y = c.y + Math.sin(k * TAU / 12 + r) * r;
    if (!game.map.circleFree(x, y, 12, true) || !game.map.hasLOS(c.x, c.y, x, y)) continue;
    if (out.some(o => dist(o.x, o.y, x, y) < 22)) continue;
    out.push({ x, y });
  }
  return out;
}

test('le bruit s’étouffe à travers une porte fermée ou un mur, pas par une porte ouverte', () => {
  const g = mkGame({ alone: true });
  const game = g.game, map = game.map;
  const w = doorWithRoom(game);
  ok(w, 'une porte de test');
  const R = 6 * U;
  setDoor(w.d, 1);
  const open = heardAt(game, w.a.x, w.a.y, R, w.b.x, w.b.y);
  setDoor(w.d, 0);
  const closed = heardAt(game, w.a.x, w.a.y, R, w.b.x, w.b.y);
  near(open, 1 - dist(w.a.x, w.a.y, w.b.x, w.b.y) / R, 0.08, 'porte ouverte : comme en plein air');
  ok(closed > 0 && closed < open - 0.15, 'porte fermée : nettement plus faible (' + closed.toFixed(2) + ' contre ' + open.toFixed(2) + ')');
  const s = wallSpot(map);
  ok(s, 'un mur de test');
  const L = { x: s.tx * TILE - 20, y: s.y }, Rt = { x: (s.tx + 1) * TILE + 20, y: s.y };
  const thru = heardAt(game, L.x, L.y, R, Rt.x, Rt.y);
  ok(thru < 1 - dist(L.x, L.y, Rt.x, Rt.y) / R - 0.3, 'un mur étouffe le son (' + thru.toFixed(2) + ')');
  eq(heardAt(game, L.x, L.y, 2 * U, Rt.x, Rt.y), 0, 'un bruit faible ne passe pas le mur');
});

test('un suspect se tourne vers un bruit léger, va voir un bruit fort ou répété, puis regagne son poste', () => {
  const g = mkGame({ alone: true });
  const game = g.game;
  const c = { x: game.hostages[0].x, y: game.hostages[0].y }; // un poste libre, loin de l'entrée
  const e = deafEye(game, c.x, c.y);
  const s2 = reachableSpot(game, e, 2 * U, 2.5 * U, true);
  ok(s2, 'un point de bruit à deux cases');
  game.noise(s2.x, s2.y, 4 * U, game.player, 'door');
  eq(e.state, 'idle', 'une porte au loin : il ne bouge pas');
  ok(e.alertAngle !== null && Math.abs(angleDiff(e.alertAngle, Math.atan2(s2.y - e.y, s2.x - e.x))) < 0.05, 'mais il se tourne vers le bruit');
  let n = 1;
  while (e.state !== 'investigate' && n < 12) { g.step(30); game.noise(s2.x, s2.y, 4 * U, game.player, 'door'); n++; }
  eq(e.state, 'investigate', 'à force de bruits répétés, il va voir');
  ok(n >= 3, 'mais pas au premier (' + n + ' bruits)');
  // un coup de feu proche : il y va tout de suite
  const e2 = deafEye(game, c.x, c.y);
  e.alive = false;
  game.noise(s2.x, s2.y, 11 * U, game.player, 'shot');
  eq(e2.state, 'investigate', 'un coup de feu : il va voir sur-le-champ');
  ok(e2.lastKnown && dist(e2.lastKnown.x, e2.lastKnown.y, s2.x, s2.y) < 1.5 * U, 'vers l’endroit du bruit');
  for (let i = 0; i < 60 * 20 && e2.state !== 'idle'; i++) g.step(1);
  eq(e2.state, 'idle', 'rien trouvé : il retourne à son poste');
  ok(dist(e2.x, e2.y, e2.home.x, e2.home.y) < U, 'il y est revenu');
});

test('au plus deux suspects vont voir un même bruit ; une fusillade qui dure attire les autres', () => {
  const g = mkGame({ alone: true });
  const game = g.game;
  const c = { x: game.hostages[0].x, y: game.hostages[0].y };
  const spots = freeSpotsAround(game, c, 5);
  eq(spots.length, 5, 'cinq places autour du point');
  const es = spots.map(q => deafEye(game, q.x, q.y));
  game.noise(c.x, c.y, 11 * U, game.player, 'shot');
  const going = () => es.filter(e => e.state === 'investigate').length;
  eq(going(), 2, 'deux vont voir');
  // les deux qui l'entendent le mieux (le plus près, à l'oreille)
  const I = e => heardAt(game, c.x, c.y, 11 * U, e.x, e.y);
  const goers = es.filter(e => e.state === 'investigate'), others = es.filter(e => e.state !== 'investigate');
  ok(goers.every(e => others.every(o => I(e) >= I(o) - 1e-6)), 'ceux qui l’entendent le mieux');
  ok(es.every(e => e.state === 'investigate' || Math.abs(angleDiff(e.homeAngle, Math.atan2(c.y - e.y, c.x - e.x))) < 0.05), 'les autres guettent de ce côté');
  for (let i = 0; i < 8 && going() < 5; i++) { game.time += 0.6; game.noise(c.x, c.y, 11 * U, game.player, 'shot'); }
  eq(going(), 5, 'des tirs répétés finissent par les attirer tous');
});

test('silencieux : le tir ne s’entend plus qu’à quelques cases ; il se choisit arme par arme', () => {
  const s = suppressedDef('hk416'), w = WEAPONS.hk416;
  ok(s.suppressed && s.noise < w.noise / 2, 'HK416 : ' + w.noise + ' cases, ' + s.noise + ' au silencieux');
  ok(s.gunLen > w.gunLen && s.mobility < w.mobility && s.weight > w.weight, 'plus long, plus lourd, un peu moins mobile');
  eq(suppressedDef('m870'), WEAPONS.m870, 'pas de silencieux sur un fusil à pompe');
  ok(suppressedDef('mp5').damage < WEAPONS.mp5.damage, '9 mm subsonique : un peu moins de dégâts');
  eq(suppressedDef('hk416'), s, 'chaque combinaison n’est calculée qu’une fois');
  // sur l'arme principale seulement, puis sur l'arme de poing seulement
  const { game: g1 } = mkGame({ loadout: { primary: 'hk416', sidearm: 'glock17', acc: { hk416: { sup: true } } } });
  ok(g1.player.slots[0].def.suppressed && !g1.player.slots[1].def.suppressed, 'silencieux sur l’arme principale seule');
  ok(g1.mates.every(m => !m.weapon.suppressed), 'les coéquipiers n’en héritent pas');
  const { game: g2 } = mkGame({ loadout: { primary: 'hk416', sidearm: 'glock17', acc: { glock17: { sup: true } } } });
  ok(!g2.player.slots[0].def.suppressed && g2.player.slots[1].def.suppressed, 'silencieux sur l’arme de poing seule');
  // les coéquipiers ont leur propre réglage
  for (let n = 0; n < 6; n++) {
    const { game } = mkGame({ loadout: { primary: 'm870', sidearm: 'glock17', teamSup: true } });
    ok(game.player.slots.every(sl => !sl.def.suppressed), 'le joueur garde ses propres choix');
    ok(game.mates.every(m => m.weapon.suppressed), 'les coéquipiers au silencieux (' + game.mates.map(m => m.weapon.name).join(', ') + ')');
  }
  const { game: g0 } = mkGame();
  ok(g0.player.slots.every(sl => !sl.def.suppressed) && g0.mates.every(m => !m.weapon.suppressed), 'sans silencieux par défaut');
  // un équipement enregistré avant les accessoires (un seul drapeau, pour toute l'équipe)
  const old = Game.normLoadout({ primary: 'mp5', sidearm: 'usp45', sup: true }, MODES.assault);
  ok(old.acc.mp5.sup && old.acc.usp45.sup && old.teamSup && !('sup' in old), 'ancien réglage : silencieux sur les deux armes et l’équipe');
  // à six cases, en plein air : le tir silencieux ne s'entend pas, l'autre si
  const g = mkGame({ alone: true, loadout: { primary: 'hk416', sidearm: 'glock17', acc: { hk416: { sup: true } } } });
  const game = g.game, p = game.player;
  const far = reachableSpot(game, p, 5.5 * U, 6.5 * U, true);
  ok(far, 'un point à six cases en vue');
  eq(heardAt(game, p.x, p.y, s.noise * U, far.x, far.y), 0, 'silencieux : rien à six cases');
  ok(heardAt(game, p.x, p.y, w.noise * U, far.x, far.y) > 0.3, 'sans : bien audible à six cases');
  const e = deafEye(game, far.x, far.y);
  p.angle = Math.atan2(p.y - far.y, p.x - far.x); // on tire à l'opposé du suspect
  game.fireWeapon(p);
  eq(e.state, 'idle', 'il n’a rien entendu');
  ok(e.suspicion === 0, 'pas la moindre inquiétude');
  p.slots[0] = makeSlot('hk416');
  game.fireWeapon(p);
  eq(e.state, 'investigate', 'sans silencieux, il vient voir');
});

test('les bruits hors de vue s’affichent autour du joueur, avec leur direction et leur force', () => {
  const g = mkGame({ alone: true });
  const game = g.game, p = game.player;
  const w = doorWithRoom(game);
  ok(w, 'une porte de test');
  setDoor(w.d, 0);
  p.x = w.a.x; p.y = w.a.y;
  game.input.mouse.x = w.d.cx; game.input.mouse.y = w.d.cy;
  g.step(2);
  game.heard = [];
  game.noise(w.b.x, w.b.y, 11 * U, null, 'shot');
  eq(game.heard.length, 1, 'un tir derrière la porte : un repère');
  const h = game.heard[0];
  eq(h.kind, 'shot', 'c’est un tir');
  ok(Math.abs(angleDiff(h.a, Math.atan2(w.b.y - p.y, w.b.x - p.x))) < 0.05, 'dans la bonne direction');
  ok(h.i > 0.2 && h.i < 1, 'avec son intensité (' + h.i.toFixed(2) + ')');
  game.noise(w.b.x, w.b.y, 11 * U, null, 'shot');
  eq(game.heard.length, 1, 'une rafale au même endroit ne multiplie pas les repères');
  game.noise(w.b.x, w.b.y, 3 * U, null, 'step');
  ok(game.heard.length === 1 || game.heard[1].i < h.i, 'des pas derrière une porte : à peine, ou pas du tout');
  // un bruit sous les yeux : pas de repère
  game.heard = [];
  const ax = p.x + Math.cos(p.angle) * U, ay = p.y + Math.sin(p.angle) * U;
  game.noise(ax, ay, 11 * U, null, 'shot');
  eq(game.heard.length, 0, 'un bruit qu’on voit n’a pas besoin de repère');
  game.noise(w.b.x, w.b.y, 11 * U, null, 'shot');
  g.step(1); // dessin des repères
  g.step(Math.ceil(NOISE_KINDS.shot.life * 60) + 2);
  eq(game.heard.length, 0, 'il s’efface');
});

test('votre propre bruit laisse un halo, bien plus petit au silencieux', () => {
  const cells = sup => {
    const g = mkGame({ alone: true, loadout: { primary: 'hk416', sidearm: 'glock17', acc: { hk416: { sup } } } });
    const game = g.game, p = game.player;
    game.input.mouse.x = p.x + 100; game.input.mouse.y = p.y;
    game.ownNoise = null;
    game.fireWeapon(p);
    ok(game.ownNoise, (sup ? 'silencieux' : 'sans silencieux') + ' : un halo');
    g.step(1); // dessin du halo
    eq(g.r.noiseC.width, game.map.w, 'calque du halo à la taille de la grille');
    return game.ownNoise.cells.length / 2;
  };
  const loud = cells(false), quiet = cells(true);
  ok(quiet < loud / 3, 'halo : ' + loud + ' cases sans silencieux, ' + quiet + ' avec');
});

test('un suspect qui vous repère crie l’alerte, et un corps découvert aussi', () => {
  const g = mkGame({ alone: true });
  const game = g.game, p = game.player;
  const spot = reachableSpot(game, p, 3 * U, 4 * U, true);
  ok(spot, 'un point en vue du joueur');
  const a = new Enemy(spot.x, spot.y, Math.atan2(p.y - spot.y, p.x - spot.x), 'ak');
  game.enemies.push(a);
  const nb = freeSpotsAround(game, spot, 1)[0];
  const b = deafEye(game, nb.x, nb.y);
  b.angle = Math.atan2(nb.y - p.y, nb.x - p.x); // il tourne le dos
  game.updateEnemy(a, 1 / 60);
  eq(a.target, p, 'le premier vous voit');
  ok(game.time - a.shoutT < 0.1, 'et crie');
  eq(b.state, 'investigate', 'son voisin accourt');
  // un corps
  const g2 = mkGame({ alone: true });
  const game2 = g2.game, c = { x: game2.hostages[0].x, y: game2.hostages[0].y };
  const [q1, q2] = freeSpotsAround(game2, c, 2);
  const dead = new Enemy(q1.x, q1.y, 0, 'ak');
  dead.alive = false;
  const finder = new Enemy(q2.x, q2.y, Math.atan2(q1.y - q2.y, q1.x - q2.x), 'ak');
  game2.enemies.push(dead, finder);
  game2.updateEnemy(finder, 1 / 60);
  ok(dead.noticed, 'le corps est découvert');
  eq(finder.state, 'investigate', 'il va voir');
  ok(game2.time - finder.shoutT < 0.1, 'et crie l’alerte');
});

test('courir s’entend, marcher non', () => {
  const g = mkGame({ alone: true });
  const game = g.game, p = game.player;
  const steps = [];
  const noise = game.noise.bind(game);
  game.noise = (x, y, R, src, kind) => { if (kind === 'step' && src === p) steps.push(R); noise(x, y, R, src, kind); };
  const dir = reachableSpot(game, p, 3 * U, 5 * U, true);
  const run = walk => {
    p.walkMode = walk;
    steps.length = 0;
    const a = Math.atan2(dir.y - p.y, dir.x - p.x);
    const k = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.cos(a) > 0 ? 'KeyD' : 'KeyA') : (Math.sin(a) > 0 ? 'KeyS' : 'KeyW');
    game.input.keys[k] = true; g.step(40); game.input.keys[k] = false;
    return steps.length;
  };
  eq(run(true), 0, 'en marchant : aucun bruit de pas');
  ok(run(false) >= 2, 'en courant : des pas qu’on entend');
});

// ---------------------------------------------------------------- otages
// Partie d'assaut au calme, le joueur juste à côté du premier otage.
function withHostage(level) {
  const g = mkGame({ alone: true, level: level || 0 });
  const game = g.game, p = game.player, h = game.hostages[0];
  ok(besideHostage(game, p, h), 'une place à côté de l’otage');
  game.input.mouse.x = h.x; game.input.mouse.y = h.y;
  return { g, game, p, h };
}
// Case libre entre dMin et dMax de `from`, qu'un otage peut rejoindre (portes franchissables seulement).
// open : en ligne droite et à découvert depuis `from` (pas d'angle à contourner).
function reachableSpot(game, from, dMin, dMax, open) {
  const m = game.map;
  for (let r = dMin; r <= dMax; r += 0.5 * U) for (let k = 0; k < 16; k++) {
    const x = from.x + Math.cos(k * TAU / 16) * r, y = from.y + Math.sin(k * TAU / 16) * r;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (!m.inBounds(tx, ty) || !m.circleFree(x, y, 12, true)) continue;
    if (m.breaches.some(b => dist(b.cx, b.cy, x, y) < 3 * U)) continue; // près d'une sortie, un otage escorté s'en irait
    if (open && !m.segmentFree(from.x, from.y, x, y, 12)) continue;
    if (m.routeTo(from.x, from.y, tx, ty, 9, { passableDoors: true })) return { x, y };
  }
  return null;
}
const who = a => (a ? a.constructor.name + (a.name ? ' ' + a.name : '') : 'personne');

test('H relève l’otage : il suit en file derrière vous, et attend à genoux sur ordre', () => {
  const { g, game, p, h } = withHostage();
  ok(!h.standing && h.radius <= 7, 'à genoux au départ');
  g.press('KeyH');
  ok(p.act && p.act.type === 'hostage', 'un geste pour l’aider à se relever');
  g.step(40);
  eq(h.escort, p, 'il vous suit');
  ok(h.standing && h.radius > 7, 'debout, il fait une cible plus large');
  const h2 = game.hostages[1];
  ok(besideHostage(game, h2, h), 'un deuxième otage à côté');
  game.takeCharge(h2, p);
  const go = reachableSpot(game, p, 3 * U, 6 * U, true) || reachableSpot(game, p, 2 * U, 6 * U);
  ok(go, 'un point où aller');
  p.x = go.x; p.y = go.y;
  g.step(360);
  // en file : le plus proche juste derrière vous, l'autre derrière lui
  const [first, second] = [h, h2].sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y));
  const d1 = dist(first.x, first.y, p.x, p.y), d2 = dist(second.x, second.y, p.x, p.y);
  ok(d1 <= HOSTAGE_GAP + 14 && game.map.hasLOS(first.x, first.y, p.x, p.y), 'le premier s’arrête juste derrière vous (' + Math.round(d1) + ' px)');
  ok(d2 >= d1 + HOSTAGE_GAP_STEP * 0.5 && d2 <= HOSTAGE_GAP + HOSTAGE_GAP_STEP + 20, 'le second se range derrière lui (' + Math.round(d2) + ' px)');
  g.press('KeyH');
  eq(first.escort, null, 'H à nouveau : le plus proche attend');
  ok(!first.standing, 'à genoux');
  ok(/attend ici/.test(game.message.text), 'annoncé');
  const x = first.x, y = first.y;
  const go2 = reachableSpot(game, p, 3 * U, 6 * U, true) || reachableSpot(game, p, 2 * U, 6 * U);
  p.x = go2.x; p.y = go2.y;
  g.step(240);
  ok(dist(first.x, first.y, x, y) < 2, 'il ne bouge plus');
  eq(second.escort, p, 'l’autre vous suit toujours');
  ok(dist(second.x, second.y, p.x, p.y) <= HOSTAGE_GAP + 14, 'et prend la tête de la file');
  // l'escorte tombe : il se remet à genoux
  game.damage(p, 1000, null, 0);
  g.step(2);
  eq(second.escort, null, 'son escorte tombée, il ne suit plus personne');
  ok(!second.standing, 'il se remet à genoux');
});

test('un otage amené devant une porte extérieure ouverte ou une fenêtre sort du bâtiment', () => {
  for (const kind of ['door', 'window']) {
    const { g, game, p, h } = withHostage();
    const b = game.map.breaches.find(x => x.kind === kind);
    ok(b, kind + ' : une ouverture de ce type');
    game.takeCharge(h, p);
    p.x = b.inside.x; p.y = b.inside.y;
    h.x = b.inside.x + Math.cos(b.angle) * 1.2 * U; h.y = b.inside.y + Math.sin(b.angle) * 1.2 * U;
    game.unstick(h);
    if (b.door) {
      setDoor(b.door, 0);
      g.step(120);
      ok(!h.evacuated && !h.exiting, 'porte fermée : il ne sort pas');
      setDoor(b.door, 1);
    }
    let fade = 1;
    for (let i = 0; i < 360 && !h.evacuated; i++) { g.step(1); if (h.exiting) fade = Math.min(fade, h.exiting.alpha); }
    ok(h.evacuated, kind + ' : évacué');
    ok(fade < 1, kind + ' : il s’efface en franchissant la façade');
    ok(!h.visible && h.escort === null, kind + ' : hors jeu une fois sorti');
    ok(new RegExp('Otage évacué \\(1 / ' + game.hostages.length + '\\)').test(game.message.text), kind + ' : évacuation annoncée');
    ok(document.getElementById('objective').textContent.includes('Otages évacués : 1 / ' + game.hostages.length), kind + ' : compteur du HUD');
  }
});

test('un otage n’ouvre pas les portes, et on ne referme pas une porte sur lui', () => {
  const g = mkGame({ alone: true });
  const game = g.game, p = game.player;
  const w = doorWithRoom(game);
  ok(w, 'une porte de test');
  const side = (x, y) => Math.sign(w.d.horizontal ? y - w.d.cy : x - w.d.cx);
  const h = game.hostages[0];
  h.x = w.a.x; h.y = w.a.y;
  p.x = w.b.x; p.y = w.b.y;
  setDoor(w.d, 0);
  game.takeCharge(h, p);
  g.step(120);
  eq(side(h.x, h.y), side(w.a.x, w.a.y), 'porte fermée : il reste de son côté');
  ok(/ouvrez-lui la porte/.test(game.message.text), 'le joueur en est averti');
  setDoor(w.d, DOOR_STEPS[1]);
  g.step(90);
  eq(side(h.x, h.y), side(w.a.x, w.a.y), 'entrebâillée : toujours pas');
  setDoor(w.d, DOOR_STEPS[2]);
  for (let i = 0; i < 300 && side(h.x, h.y) !== side(w.b.x, w.b.y); i++) g.step(1);
  eq(side(h.x, h.y), side(w.b.x, w.b.y), 'entrouverte : il se glisse dans l’embrasure');
  // un otage dans l'embrasure : la porte ne se referme pas
  game.releaseHostage(h);
  h.x = w.d.cx; h.y = w.d.cy;
  setDoor(w.d, 1);
  game.message = { text: '', t: 0 };
  ok(!game.doorAction(p, w.d, 0), 'fermeture refusée');
  ok(/Un otage est dans l'embrasure/.test(game.message.text), 'refus expliqué');
  eq(w.d.progress, 1, 'la porte reste ouverte');
});

test('un otage escorté se jette à terre quand on tire près de lui', () => {
  const { g, game, p, h } = withHostage();
  game.takeCharge(h, p);
  g.step(10);
  ok(h.standing, 'debout');
  const away = Math.atan2(p.y - h.y, p.x - h.x); // on tire à l'opposé de l'otage
  game.input.mouse.x = p.x + Math.cos(away) * 100; game.input.mouse.y = p.y + Math.sin(away) * 100;
  game.input.mouse.down = true; game.input.pressed.Mouse0 = true; g.step(1);
  game.input.mouse.down = false;
  ok(game.stats.shots > 0, 'le coup est parti');
  ok(!h.standing && h.radius <= 7 && h.duckT > 0, 'il se jette à genoux');
  const go = reachableSpot(game, p, 3 * U, 6 * U);
  p.x = go.x; p.y = go.y;
  const x = h.x, y = h.y;
  g.step(30);
  ok(dist(h.x, h.y, x, y) < 1, 'il ne bouge pas tant que ça tire');
  g.step(240);
  ok(h.standing && dist(h.x, h.y, p.x, p.y) <= HOSTAGE_GAP + 14, 'puis il se relève et reprend la file');
});

test('assaut : neutraliser tous les suspects suffit, otages dehors ou non', () => {
  const g = mkGame({ noEnd: false });
  const game = g.game;
  ok(document.getElementById('objective').textContent.includes('Otages évacués : 0 / ' + game.hostages.length), 'le HUD compte les otages évacués');
  game.enemies.forEach(e => { e.alive = false; });
  g.step(1);
  eq(game.over, 'win', 'suspects neutralisés, otages encore à l’intérieur : mission accomplie');
  ok(game.hostages.every(h => h.alive && !h.evacuated), 'aucun otage n’a eu à sortir');
  g.ui.showEnd('win');
  eq(document.getElementById('endHostagesOut').textContent, '0 / ' + game.hostages.length, 'le bilan compte quand même les otages évacués');
  g.ui.hideOverlay();
  // otages dehors d'abord : annoncé, et la mission continue jusqu'au dernier suspect
  const g2 = mkGame({ noEnd: false });
  g2.game.hostages.forEach(h => { h.evacuated = true; });
  g2.step(1);
  eq(g2.game.over, null, 'des suspects encore debout');
  ok(/reste à neutraliser/.test(g2.game.message.text), 'annoncé');
  g2.game.enemies.forEach(e => { e.alive = false; });
  g2.step(1);
  eq(g2.game.over, 'win', 'le dernier suspect tombé : accomplie');
  // un otage tué reste un échec, même si les suspects tombent en même temps
  const g3 = mkGame({ noEnd: false });
  g3.game.hostages[0].alive = false;
  g3.game.enemies.forEach(e => { e.alive = false; });
  g3.step(1);
  eq(g3.game.over, 'lose', 'un otage mort : mission échouée');
  // en siège, H ne fait pas bouger les otages
  const g4 = mkGame({ mode: 'siege' });
  g4.press('KeyH');
  ok(/seule l'intervention les emmène/.test(g4.game.message.text), 'siège : les otages restent à genoux');
});

// ---------------------------------------------------------------- siège
test('chaque carte : neuf suspects, et de trois à cinq otages', () => {
  LEVELS.forEach((l, i) => {
    const map = new GameMap(l);
    eq(map.enemySpawns.length, 9, l.name + ' : postes de suspects');
    const h = map.hostageSpawns.length;
    if (i < 3) eq(h, 3 + i, l.name + ' : otages (trois, quatre puis cinq sur les trois premières cartes)');
    else ok(h >= 3 && h <= 5, l.name + ' : ' + h + ' otages');
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
  // ils peuvent ensuite s'arrêter (combat, otage à récupérer) : on vérifie qu'ils ont quitté l'ouverture.
  // Un poste tiré juste derrière l'ouverture les fixerait au combat dès l'entrée : on dégage le seuil.
  const near = o => dist(o.x, o.y, b.inside.x, b.inside.y) < 6 * U;
  game.mates.forEach(m => { if (near(m)) m.alive = false; });
  const far = game.mates.filter(m => m.alive).sort((x, y) => dist(y.x, y.y, b.inside.x, b.inside.y) - dist(x.x, x.y, b.inside.x, b.inside.y))[0];
  if (near(game.player) && far) { game.player.x = far.x; game.player.y = far.y; far.alive = false; }
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

// Siège réduit à un seul opérateur, aveugle (il ne se bat pas) : on observe l'escorte seule.
function loneOperator(level) {
  const g = mkGame({ mode: 'siege', level: level || 0 });
  const game = g.game, s = game.siege;
  s.prep = 0.01; g.step(2);
  s.wave = s.waves.length;                       // plus de vague après celle-ci
  game.mates.forEach(m => { m.alive = false; }); // sinon les complices l'abattent avant la fin
  game.player.hp = game.player.maxHp = 1e9;
  const op = game.enemies[0];
  game.enemies.slice(1).forEach(e => { e.alive = false; });
  op.hp = op.maxHp = 1e9;
  op.viewRange = 0; // ne voit personne : pas de combat, il fait son travail d'escorte
  // ce qu'il a pu voir en entrant ne compte pas : chaque test désigne lui-même l'otage repéré
  game.hostages.forEach(h => { h.found = false; });
  op.lastKnown = null;
  return { g, game, op };
}
// Place un agent à une case libre voisine de l'otage, avec vue sur lui.
function besideHostage(game, a, h) {
  for (const r of [10, 16, 22]) for (let k = 0; k < 8; k++) {
    const x = h.x + Math.cos(k * TAU / 8) * r, y = h.y + Math.sin(k * TAU / 8) * r;
    if (game.map.circleFree(x, y, 12, true) && game.map.hasLOS(x, y, h.x, h.y)) { a.x = x; a.y = y; return true; }
  }
  return false;
}

test('en siège, l’intervention relève un otage et l’emmène jusqu’à une sortie', () => {
  const { g, game, op } = loneOperator();
  const h = game.hostages[0];
  ok(besideHostage(game, op, h), 'une place à côté de l’otage');
  h.found = true;
  let pris = false, sortie = null;
  for (let i = 0; i < 60 * 60 && !h.evacuated; i++) {
    game.update(1 / 60);
    if (h.escort === op) { pris = true; sortie = op.exit; }
  }
  ok(pris, 'l’opérateur l’a pris en charge (' + who(h.escort) + ')');
  ok(/emmène un otage/.test(game.message.text) || h.evacuated, 'le preneur d’otages en est averti');
  ok(sortie && game.map.breaches.includes(sortie), 'il vise une ouverture de la carte');
  ok(h.evacuated, 'otage évacué par une sortie');
  eq(op.escorting, null, 'l’escorte est libre ensuite');
  ok(/évacué/.test(game.message.text), 'évacuation annoncée');
  g.ui.update();
  ok(document.getElementById('objective').textContent.includes('Otages : ' + game.hostages.filter(x => x.alive && !x.evacuated).length), 'le HUD compte les otages qui vous restent');
  delete game.checkEnd; // la vraie fin de partie, cette fois
  game.hostages.forEach(x => { x.evacuated = true; });
  game.update(1 / 60);
  eq(game.over, 'lose', 'plus d’otage entre vos mains : la partie est perdue');
  ok(/évacués par l'intervention/.test(game.loseReason), 'raison : ils ont tous été évacués');
});

test('un opérateur ne reste pas planté devant un point injoignable, ni sur un simple impact', () => {
  const { game, op } = loneOperator();
  const m = game.mates[0];
  m.alive = true; m.x = op.x + 2 * U; m.y = op.y; // une source « d'en face » pour le bruit
  op.lastKnown = null;
  game.noise(op.x + U, op.y, 3 * U, m, 'impact');
  eq(op.lastKnown, null, 'un impact ne dit pas où est le tireur');
  m.alive = false;
  const s = wallSpot(game.map);
  op.lastKnown = { x: (s.tx + 0.5) * TILE, y: s.y }; // dans un mur
  const x0 = op.x, y0 = op.y;
  for (let i = 0; i < 240; i++) game.update(1 / 60);
  eq(op.lastKnown, null, 'point injoignable oublié');
  ok(dist(op.x, op.y, x0, y0) > U, 'il reprend sa progression');
});

test('en siège, l’escorte abattue, l’otage reste à genoux et un autre opérateur le reprend', () => {
  const { game, op } = loneOperator();
  // l'otage le plus loin des sorties : il ne doit pas déjà être en train de sortir quand l'escorte tombe
  const far = o => Math.min(...game.map.breaches.map(b => dist(o.x, o.y, b.cx, b.cy)));
  const h = game.hostages.slice().sort((x, y) => far(y) - far(x))[0];
  besideHostage(game, op, h);
  h.found = true;
  for (let i = 0; i < 300 && h.escort !== op; i++) game.update(1 / 60);
  ok(h.escort === op, 'pris en charge (' + who(h.escort) + ')');
  for (let i = 0; i < 10; i++) game.update(1 / 60);
  ok(!h.exiting, 'pas encore à la sortie'); // un otage qui sort termine sa sortie, escorte ou pas
  op.hp = 1; game.damage(op, 50, game.player, 0);
  game.update(1 / 60);
  ok(h.escort === null, 'plus d’escorte (' + who(h.escort) + ', évacué : ' + h.evacuated + ')');
  ok(!h.standing && h.radius <= 7, 'il se remet à genoux');
  ok(/escorte est tombée/.test(game.message.text), 'annoncé');
  const x = h.x, y = h.y;
  for (let i = 0; i < 60; i++) game.update(1 / 60);
  ok(dist(h.x, h.y, x, y) < 1, 'il ne bouge plus');
  const op2 = new Operator(h.x, h.y, 0, 'hk416op');
  op2.viewRange = 0; op2.hp = op2.maxHp = 1e9;
  game.enemies.push(op2);
  besideHostage(game, op2, h);
  for (let i = 0; i < 300 && h.escort !== op2; i++) game.update(1 / 60);
  ok(h.escort === op2, 'un autre opérateur l’emmène (' + who(h.escort) + ')');
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

  // morts et évacués mêlés : il n'en reste aucun à vous non plus
  const g2 = mkGame({ mode: 'siege', noEnd: false });
  const h2 = g2.game.hostages;
  h2.slice(1).forEach(h => { h.evacuated = true; });
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

test('siège : la minimap signale la pièce où entre chaque vague', () => {
  const g = mkGame({ mode: 'siege' });
  const game = g.game, s = game.siege, r = g.r, map = game.map;
  // pixels franchement rouges du plan réduit (le dessin de la minimap passe par miniTmpC)
  const red = () => {
    const c = r.miniTmpC.getContext('2d').getImageData(0, 0, r.miniTmpC.width, r.miniTmpC.height).data;
    let n = 0;
    for (let i = 0; i < c.length; i += 4) if (c[i + 3] && c[i] > c[i + 1] + 30) n++;
    return n;
  };
  g.step(2);
  eq(s.arrival, null, 'rien pendant la préparation');
  const before = red();
  s.prep = 0.01; g.step(2);
  ok(s.arrival, 'l’arrivée de la vague est notée');
  const b = s.arrival.breach, room = s.arrival.room;
  ok(room.has(Math.floor(b.inside.y / TILE) * map.w + Math.floor(b.inside.x / TILE)), 'c’est la pièce derrière l’ouverture franchie');
  const lit = room.size * r.miniScale * r.miniScale;
  ok(red() > before + lit * 0.5, 'la pièce passe au rouge (' + (red() - before) + ' px pour ' + lit + ')');
  const first = s.arrival;
  g.step(Math.ceil(ARRIVAL_ALERT * 60) + 5);
  if (s.arrival === first) ok(red() < before + lit * 0.25, 'le signal s’efface au bout de ' + ARRIVAL_ALERT + ' s');
  // la vague suivante est signalée à son tour, par son ouverture
  game.enemies.forEach(e => { e.alive = false; });
  s.nextWave = 0.01; g.step(2);
  ok(s.arrival !== first && s.arrival.at > first.at, 'nouvelle arrivée pour la vague suivante');
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

test('sang et corps tombés hors de vue n’apparaissent qu’une fois l’endroit vu', () => {
  const g = mkGame({ alone: true, loadout: { primary: 'scarh', sidearm: 'glock17' } });
  const game = g.game, p = game.player;
  const w = doorWithRoom(game);
  ok(w, 'une porte de test');
  setDoor(w.d, 0);
  p.x = w.a.x; p.y = w.a.y;
  const foe = new Enemy(w.b.x, w.b.y, 0, 'ak');
  foe.hp = foe.maxHp = 30;
  game.enemies = [foe];
  game.updateEnemy = () => {};
  game.input.mouse.x = w.b.x; game.input.mouse.y = w.b.y;
  game.input.mouse.down = true;
  for (let i = 0; i < 120 && foe.alive; i++) g.step(1);
  game.input.mouse.down = false;
  ok(!foe.alive, 'le suspect est tombé à travers la porte');
  g.step(90);
  const behind = () => game.hiddenDecals.filter(d => dist(d.x, d.y, foe.x, foe.y) < 1.2 * U).length;
  ok(behind() > 0, 'son sang attend derrière la porte');
  ok(!foe.bodySeen, 'son corps aussi');
  setDoor(w.d, 1);
  g.step(2);
  eq(behind(), 0, 'la porte ouverte, le sang apparaît');
  ok(foe.bodySeen, 'et le corps');
});

test('traçantes et gerbes de sang ne se voient pas derrière une porte fermée', () => {
  const g = mkGame({ alone: true });
  const game = g.game, p = game.player, map = game.map, r = g.r;
  const w = doorWithRoom(game);
  ok(w, 'une porte de test');
  setDoor(w.d, 0);
  p.x = w.a.x; p.y = w.a.y;
  game.input.mouse.x = w.d.cx; game.input.mouse.y = w.d.cy;
  for (let i = 0; i < map.explored.length; i++) if (!map.explored[i]) { map.explored[i] = 1; map.newlyExplored.push(i); } // zone déjà explorée
  g.step(120);
  game.camShake = 0; game.camKick.x = game.camKick.y = 0;
  const shot = () => {
    r.draw(0);
    const sx = Math.round(w.b.x * r.zoom + r.tx), sy = Math.round(w.b.y * r.zoom + r.ty), h = Math.round(20 * r.zoom);
    return Array.from(r.ctx.getImageData(sx - h, sy - h, 2 * h, 2 * h).data).join();
  };
  const withFx = () => {
    game.bullets = [{ x: w.b.x + 10, y: w.b.y, vx: 900, vy: 0, trail: 30 }];
    game.effects = [{ type: 'hit', x: w.b.x, y: w.b.y, t: 0.05, life: 0.25 }];
    const img = shot();
    game.bullets = []; game.effects = [];
    return img;
  };
  eq(withFx() === shot(), true, 'porte fermée : rien ne se dessine derrière');
  setDoor(w.d, 1);
  game.computeVision();
  ok(withFx() !== shot(), 'porte ouverte : la traçante et le sang se voient');
});

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
    const panel = document.getElementById('overlayPanel').textContent;
    ok(/Otages tués/.test(panel), mode + ' : libellé des otages');
    // pertes du groupe : vous compris
    ok(new RegExp(mode === 'siege' ? 'Terroristes perdus' : 'Opérateurs perdus').test(panel), mode + ' : libellé des pertes');
    eq(game.squadSize, 1 + game.mates.length, mode + ' : le groupe se compte avec vous');
    ok(new RegExp('0 / ' + game.squadSize).test(panel.replace(/\s+/g, ' ')), mode + ' : aucune perte au départ');
    game.damage(game.player, 1e6, null, 0);
    g.ui.showEnd('lose');
    ok(new RegExp('1 / ' + game.squadSize).test(document.getElementById('overlayPanel').textContent.replace(/\s+/g, ' ')), mode + ' : votre propre mort compte');
    g.ui.hideOverlay();
  }
});

test('après une victoire, « Missions » puis « Retour » ne fige pas le jeu', () => {
  const g = mkGame({ noEnd: false });
  const game = g.game, ui = g.ui;
  game.enemies.forEach(e => { e.alive = false; });
  game.hostages.forEach(h => { h.evacuated = true; });
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

test('le choix de mission montre le plan de chaque carte', () => {
  const g = mkGame();
  const ui = g.ui;
  ui.showLevels();
  const btns = [...ui.panel.querySelectorAll('.levelbtn')];
  eq(btns.length, LEVELS.length, 'une vignette par mission');
  btns.forEach((b, i) => {
    const c = b.querySelector('canvas');
    ok(c && c.width > 0 && c.height > 0, LEVELS[i].name + ' : plan présent');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0, entry = 0;
    for (let k = 0; k < d.length; k += 4) {
      if (d[k + 3]) n++;
      if (d[k] > 180 && d[k + 1] > 110 && d[k] - d[k + 2] > 90) entry++; // anneau orange d'une ouverture
    }
    ok(n > c.width * c.height * 0.5, LEVELS[i].name + ' : le plan est dessiné');
    ok(entry > 0, LEVELS[i].name + ' : ses ouvertures sont marquées');
    ok(b.textContent.includes(LEVELS[i].name), LEVELS[i].name + ' : nommée');
  });
  ok(btns[0].classList.contains('sel'), 'la mission en cours est signalée');
  btns[1].click();
  eq(g.game.levelIndex, 1, 'un clic charge la mission');
  ok(ui.panel.querySelector('#ovGo'), 'et ouvre son briefing');
  ui.hideOverlay();
});

test('le briefing propose les deux modes et l’équipement du camp', () => {
  const g = mkGame();
  const ui = g.ui;
  ui.showBriefing();
  eq(ui.panel.querySelectorAll('.modebtn').length, Object.keys(MODES).length, 'un bouton par mode');
  const A = MODES.assault, cards = [...ui.panel.querySelectorAll('.wcard')].map(b => b.dataset.key);
  eq(cards.length, A.primaries.length + A.shields.length + A.sidearms.length, 'cartes d’armes et de boucliers du mode');
  ok(cards.every(k => A.primaries.includes(k) || A.shields.includes(k) || A.sidearms.includes(k)), 'armes du bon camp');
  ui.hideOverlay();
  // le groupe armé n'a pas de bouclier
  const gs = mkGame({ mode: 'siege' });
  gs.ui.showBriefing();
  eq(gs.ui.panel.querySelectorAll('.wcard[data-slot="shield"]').length, 0, 'siège : aucun bouclier');
  gs.ui.hideOverlay();
});

test('au briefing : un bouclier à la place de l’arme principale, des accessoires arme par arme', () => {
  // le briefing enregistre l'équipement : on remet celui du joueur en sortant
  const KEY = 'breach.loadout.assault';
  let sauve = null;
  try { sauve = localStorage.getItem(KEY); } catch (e) { /* stockage indisponible */ }
  try { briefingGearTest(); } finally {
    try { if (sauve === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, sauve); } catch (e) { /* idem */ }
  }
});

function briefingGearTest() {
  const g = mkGame({ loadout: { primary: 'hk416', sidearm: 'glock17' } });
  const game = g.game, ui = g.ui;
  game.paused = true;
  ui.showBriefing();
  const card = k => ui.panel.querySelector('.wcard[data-key="' + k + '"]');
  const acc = (k, a) => ui.panel.querySelector('.accbtn[data-key="' + k + '"][data-acc="' + a + '"]');
  ok(card('shieldL') && card('shieldH'), 'deux boucliers proposés');
  card('shieldL').click();
  eq(game.loadout.shield, 'shieldL', 'bouclier choisi');
  const p = game.player;
  ok(p.shield === SHIELDS.shieldL && p.slots.length === 1 && p.weapon.kind === 'pistol', 'il ne reste que l’arme de poing');
  ok(card('shieldL').classList.contains('sel') && !card('hk416').classList.contains('sel'), 'l’arme principale n’est plus cochée');
  ok(/NIJ IIIA/.test(ui.$('wdetail').textContent), 'fiche du bouclier');
  card('mp5').click();
  eq(game.loadout.shield, null, 'une arme principale remplace le bouclier');
  eq(game.player.slots[0].def, WEAPONS.mp5, 'et revient en main');
  // silencieux sur le MP5, laser sur le Glock
  acc('mp5', 'sup').click();
  acc('glock17', 'laser').click();
  ok(game.player.slots[0].def.suppressed && !game.player.slots[0].def.laser, 'MP5 au silencieux');
  ok(game.player.slots[1].def.laser && !game.player.slots[1].def.suppressed, 'Glock au laser');
  ok(acc('mp5', 'sup').classList.contains('sel') && !acc('mp5', 'laser').classList.contains('sel'), 'les boutons le montrent');
  card('hk416').click();
  ok(!game.player.slots[0].def.suppressed, 'le HK416 n’hérite pas du silencieux du MP5');
  card('mp5').click();
  ok(game.player.slots[0].def.suppressed, 'le MP5 a gardé le sien');
  card('m870').click();
  ok(acc('m870', 'sup').disabled && !acc('m870', 'laser').disabled, 'fusil à pompe : un laser, pas de silencieux');
  const back = Game.loadSavedLoadout('assault');
  ok(back.primary === 'm870' && back.acc.mp5.sup && back.acc.glock17.laser, 'choix retrouvés au rechargement, arme par arme');
  // les coéquipiers ont leur bouton à part, qui leur redonne une arme
  ui.panel.querySelector('#ovSup').click();
  ok(game.loadout.teamSup && game.mates.every(m => m.weapon.suppressed), 'coéquipiers au silencieux');
  ok(!game.player.slots[0].def.suppressed && game.player.slots[1].def.laser, 'le joueur garde ses accessoires');
  ui.hideOverlay();
  game.paused = false;
}

test('le bouclier arrête de face les balles de son niveau, pas de flanc ni de dos', () => {
  const g = mkGame({ alone: true, loadout: { primary: 'hk416', sidearm: 'glock17', shield: 'shieldL' } });
  const game = g.game, p = game.player;
  ok(p.shield === SHIELDS.shieldL, 'bouclier au bras');
  const spot = reachableSpot(game, p, 2.5 * U, 3.5 * U, true);
  ok(spot, 'un tireur en vue');
  const toward = Math.atan2(spot.y - p.y, spot.x - p.x);
  // dégâts encaissés d'une salve tirée depuis spot, le joueur tourné de turn par rapport au tireur
  const hurt = (key, turn) => {
    p.hp = p.maxHp; p.angle = toward + turn;
    const foe = new Enemy(spot.x, spot.y, toward + Math.PI, key);
    game.enemies = [foe]; game.bullets = [];
    let n = 0;
    for (let k = 0; k < 4; k++) { foe.bloom = 0; game.fireWeapon(foe); n += foe.weapon.pellets || 1; }
    for (let i = 0; i < 40 && game.bullets.length; i++) game.updateBullets(1 / 60);
    return (p.maxHp - p.hp) / n;
  };
  eq(hurt('pistol', 0), 0, 'de face, les balles d’arme de poing s’arrêtent');
  ok(hurt('pistol', Math.PI / 2) > 15, 'de flanc, elles touchent');
  ok(hurt('pistol', Math.PI) > 15, 'de dos aussi');
  near(hurt('ak', 0), WEAPONS.ak.damage * SHIELDS.shieldL.through, 0.01, 'une balle de fusil traverse le bouclier léger, un peu freinée');
  p.equip({ ...game.loadout, shield: 'shieldH' });
  eq(hurt('ak', 0), 0, 'le bouclier lourd l’arrête');
  ok(game.effects.some(f => f.type === 'spark'), 'étincelles sur le bouclier');
  // ça se dessine : tenu, puis lâché à la chute
  g.step(2);
  game.damage(p, 1000, null, 0);
  g.step(60);
  ok(!p.alive, 'tombé, bouclier compris');
});

test('avec un bouclier : l’arme de poing seule, plus lente, moins précise, et l’on ne ramasse qu’une arme de poing', () => {
  const plain = mkGame({ alone: true, loadout: { primary: 'hk416', sidearm: 'glock17' } });
  const g = mkGame({ alone: true, loadout: { primary: 'hk416', sidearm: 'glock17', shield: 'shieldL' } });
  const game = g.game, p = game.player, q = plain.game.player;
  eq(p.slots.length, 1, 'une seule arme');
  eq(p.slot.reserve, WEAPONS.glock17.reserve + SHIELD_EXTRA_MAGS * WEAPONS.glock17.mag, 'des chargeurs en plus');
  ok(p.fov < q.fov, 'la lucarne rétrécit le champ de vision');
  q.cur = 1; // même arme en main de part et d'autre
  ok(game.spreadOf(p, 100) > plain.game.spreadOf(q, 100) * 1.2, 'tenue d’une main : moins précis');
  ok(document.getElementById('weaponName').textContent.includes('bouclier léger'), 'le HUD le dit');
  // plus lent : même départ, même temps
  const run = h => {
    const pl = h.game.player, x0 = pl.x, key = h.game.map.circleFree(pl.x + 60, pl.y, 12, true) ? 'KeyD' : 'KeyA';
    h.game.input.keys[key] = true; h.step(60); h.game.input.keys[key] = false;
    return Math.abs(pl.x - x0);
  };
  const slow = run(g), fast = run(plain);
  ok(fast > 10 && slow < fast * 0.95, 'il avance moins vite : ' + slow.toFixed(1) + ' px contre ' + fast.toFixed(1));
  // un AKM au sol ne se prend pas, une arme de poing si
  const away = a => { a.x = (game.map.w - 4) * TILE; a.y = (game.map.h - 4) * TILE; };
  game.mates.forEach(away);
  const foe = new Enemy(p.x + 12, p.y, 0, 'ak');
  game.enemies = [foe];
  game.damage(foe, 1000, p, 0);
  g.step(60);
  game.input.pressed.KeyV = true; g.step(1);
  ok(!p.act && /bouclier au bras/.test(game.message.text), 'arme d’épaule refusée, et dit pourquoi');
  eq(p.slots.length, 1, 'rien n’a changé');
  away(foe);
  const foe2 = new Enemy(p.x - 12, p.y, 0, 'pistol');
  game.enemies.push(foe2);
  game.damage(foe2, 1000, p, 0);
  g.step(60);
  game.input.pressed.KeyV = true; g.step(40);
  eq(p.slot.def, WEAPONS.makarovP, 'arme de poing échangée');
  eq(p.slots.length, 1, 'toujours une seule arme');
});

// Suspect posé à côté du faisceau, tourné vers le mur où tombe le point, le joueur dans son dos.
function laserScene(lit) {
  const g = mkGame({ alone: true, loadout: { primary: 'hk416', sidearm: 'glock17', acc: { hk416: { laser: true } } } });
  const game = g.game, p = game.player, map = game.map;
  for (let k = 0; k < 32; k++) {
    const a = k * TAU / 32, r = map.castRay(p.x, p.y, a, 10 * U, false);
    if (!r.hit || r.dist < 5 * U) continue;
    for (const side of [1, -1]) {
      const ex = p.x + Math.cos(a) * r.dist * 0.45 - Math.sin(a) * U * side, ey = p.y + Math.sin(a) * r.dist * 0.45 + Math.cos(a) * U * side;
      if (!map.circleFree(ex, ey, 12, true) || !map.hasLOS(ex, ey, r.x - Math.cos(a) * 2, r.y - Math.sin(a) * 2)) continue;
      const e = new Enemy(ex, ey, Math.atan2(r.y - ey, r.x - ex), 'ak');
      game.enemies = [e];
      game.input.mouse.x = r.x; game.input.mouse.y = r.y;
      p.laserOn = lit;
      return { g, game, p, e, dot: r };
    }
  }
  return null;
}

test('le laser resserre le tir en mouvement, mais son point se voit', () => {
  const g = mkGame({ alone: true, loadout: { primary: 'hk416', sidearm: 'glock17', acc: { hk416: { laser: true } } } });
  const game = g.game, p = game.player;
  ok(p.weapon.laser && !p.slots[1].def.laser, 'laser sur le HK416 seulement');
  p.moving = true; p.walkMode = false;
  const lit = game.spreadOf(p, 100);
  p.laserOn = false;
  const off = game.spreadOf(p, 100);
  ok(lit < off * 0.8, 'en courant, le laser resserre la dispersion : ' + (lit / DEG).toFixed(2) + '° contre ' + (off / DEG).toFixed(2) + '°');
  p.moving = false; p.laserOn = true;
  g.press('KeyL');
  ok(!p.laserOn && /éteint/.test(game.message.text), 'L l’éteint');
  g.press('KeyL');
  ok(p.laserOn, 'et le rallume');
  ok(document.getElementById('laserMode').classList.contains('on'), 'le HUD le montre');
  // pendant un rechargement, il s'éteint de lui-même
  p.slot.mag = 1; g.press('KeyR');
  ok(p.reloadT > 0 && !game.laserBeam(p), 'arme basse : pas de faisceau');
  // le faisceau s'arrête au mur ; un suspect qui regarde le point se retourne vers vous
  const sc = laserScene(true);
  ok(sc, 'une mise en scène');
  sc.g.step(1);
  const b = sc.game.laserBeam(sc.p);
  ok(b && b.hit && dist(b.x1, b.y1, sc.dot.x, sc.dot.y) < 4, 'le point tombe sur le mur visé');
  eq(sc.e.target, null, 'au départ, il ne vous voit pas');
  sc.g.step(60);
  ok(sc.e.target === sc.p || sc.e.state === 'investigate', 'il a vu le point, il se retourne ou vient voir (état ' + sc.e.state + ')');
  const dark = laserScene(false);
  dark.g.step(61);
  ok(!dark.e.target && dark.e.state === 'idle' && dark.e.suspicion === 0, 'laser éteint : il ne se doute de rien');
});



// ---------------------------------------------------------------- rendu
test('chaque mission se joue sans exception, dans les deux modes', () => {
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
        if (i % 150 === 120) inp.pressed.KeyH = true;
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
