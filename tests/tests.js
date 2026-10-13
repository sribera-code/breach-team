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
  game.lockDoors = !!opts.locks;     // pas de serrure au hasard, sauf demande
  game.saveRecords = false;          // pas de record écrit dans le navigateur
  game.patrols = !!opts.patrols;     // pas de ronde au hasard, sauf demande
  game.alarms = !!opts.alarm;        // ni d'alerte générale
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

test('l’IA tire à la cadence du modèle réel, en rafales qui ne se ressemblent pas', () => {
  for (const [ai, real] of [['hk416op', 'hk416'], ['mp5op', 'mp5'], ['akH', 'akP'], ['ak74H', 'ak74P'], ['ak', 'akP'], ['ak74E', 'ak74P'], ['uziE', 'uziP'], ['sgE', 'm870']]) {
    eq(WEAPONS[ai].rof, WEAPONS[real].rof, ai + ' : la cadence du ' + WEAPONS[real].name);
  }
  const game = mkGame({ alone: true }).game, a = {}, w = WEAPONS.akH;
  const lens = new Set(), pauses = [];
  for (let i = 0; i < 300; i++) { game.endBurst(a, w); lens.add(a.burstLeft); pauses.push(a.pauseT); }
  eq([...lens].sort().join(','), [w.burst - 1, w.burst, w.burst + 1].join(','), 'un coup de plus ou de moins d’une rafale à l’autre');
  const lo = Math.min(...pauses), hi = Math.max(...pauses);
  ok(lo >= w.pause * (1 - BURST_JITTER) - 1e-9 && hi <= w.pause * (1 + BURST_JITTER) + 1e-9 && hi - lo > w.pause * 0.3, 'des pauses inégales, dans la marge');
  game.endBurst(a, WEAPONS.sgE);
  eq(a.burstLeft, 1, 'le fusil à pompe reste au coup par coup');
});

test('un coéquipier tire selon son arme : jamais plus vite qu’elle, en rafales courtes, pas en continu', () => {
  for (const key of ['m870', 'm4super90', 'glock17', 'hk416', 'akP']) {
    const g = mkGame({ alone: true });
    const game = g.game, m = game.mates[0], w = WEAPONS[key];
    m.alive = true;
    game.player.alive = false; // hors de l'axe de tir, quoi qu'il arrive (on ne fait pas avancer la partie)
    m.slot = { def: w, mag: 1000, reserve: Infinity };
    m.burstLeft = w.burst;
    const spot = freeSpotsAround(game, m, 12).find(q => dist(q.x, q.y, m.x, m.y) > 1.5 * U);
    ok(spot, key + ' : une cible en vue');
    const foe = new Enemy(spot.x, spot.y, 0, 'ak');
    foe.hp = foe.maxHp = 1e9;
    game.enemies = [foe];
    m.angle = Math.atan2(foe.y - m.y, foe.x - m.x);
    const times = [];
    let t = 0;
    const fire = game.fireWeapon.bind(game);
    game.fireWeapon = s => { if (s === m) times.push(t); fire(s); };
    for (let i = 0; i < 360; i++) { t = i / 60; m.fireT -= 1 / 60; m.pauseT -= 1 / 60; game.mateCombat(m, 1 / 60); }
    ok(times.length >= 4, key + ' : il tire (' + times.length + ' coups)');
    const gaps = times.slice(1).map((x, i) => x - times[i]);
    ok(Math.min(...gaps) >= 1 / w.rof - 1 / 60 - 1e-6, key + ' : jamais plus vite que l’arme (' + Math.min(...gaps).toFixed(2) + ' s entre deux coups)');
    if (w.burst > 1) {
      let run = 1, longest = 1;
      for (const d of gaps) { run = d < 1 / w.rof + 0.05 ? run + 1 : 1; longest = Math.max(longest, run); }
      ok(longest <= w.burst + 1, key + ' : des rafales de ' + w.burst + ' coups environ, pas plus de ' + (w.burst + 1) + ' (' + longest + ')');
      ok(gaps.some(d => d >= w.pause * (1 - BURST_JITTER) - 1e-6), key + ' : une pause entre deux rafales');
    }
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
  for (const k of ['ak74P', 'uziP', 'skorpionP', 'tt33']) {
    ok(WEAPONS[k] && WEAPONS[k].maker, k + ' : arme décrite');
    ok(SIEGE_MATE_POOL.includes(k), k + ' : un complice peut la porter');
  }
  ok(MODES.siege.primaries.includes('uziP') && MODES.siege.primaries.includes('skorpionP'), 'Uzi et Škorpion au briefing');
  ok(MODES.siege.sidearms.includes('tt33'), 'TT-33 au briefing');
  ok(MODES.siege.primaries.includes('ak74P'), 'un second fusil d’assaut au briefing');
  ok(WEAPONS.ak74P.cat === 'ar' && WEAPONS.ak74P.pen === 3, 'l’AK-74 est un fusil d’assaut, qui perce comme une balle de fusil');
  ok(WEAPONS.ak74P.damage < WEAPONS.akP.damage && WEAPONS.ak74P.recoil < WEAPONS.akP.recoil, 'moins d’arrêt que l’AKM, mais moins de recul');
  ok(WEAPONS.uziE.pickup === 'uziP', 'l’Uzi d’un suspect se ramasse');
  ok(WEAPONS.ak74E.pickup === 'ak74P', 'l’AK-74 d’un suspect se ramasse');
  ok(LEVELS.every(l => l.enemyWeapons.includes('ak74E')), 'des suspects portent l’AK-74');
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
    game.damage(old, 1000, null, 0);
    g.step(10);
    ok(!game.over, mode + ' : pas de défaite tant qu’un coéquipier est debout');
    eq(game.player, old, mode + ' : un court instant sur le corps avant le relais');
    // le relais revient au plus proche au moment du relais (les postes sont tirés au sort, et un complice
    // peut encore bouger pendant ce temps) : on le désigne juste avant
    g.step(Math.floor(RELAY_DELAY * 60) - 14);
    eq(game.player, old, mode + ' : toujours pas de relais');
    const heir = game.mates.filter(m => m.alive).sort((a, b) => dist(a.x, a.y, old.x, old.y) - dist(b.x, b.y, old.x, old.y))[0];
    const name = heir.name;
    g.step(8);
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
    if (LEVELS[i].outdoor) {
      // en plein air, on arrive par les entrées du terrain : la maison donne sur le jardin
      ok(map.breaches.every(b => b.kind === 'gate'), LEVELS[i].name + ' : seules les entrées du terrain mènent dehors');
      ok(map.breaches.length >= 3, LEVELS[i].name + ' : au moins trois entrées du terrain');
    } else {
      ok(map.breaches.some(b => b.kind === 'window'), LEVELS[i].name + ' : au moins une fenêtre');
      ok(map.breaches.some(b => b.kind === 'door'), LEVELS[i].name + ' : au moins une porte extérieure');
    }
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

test('plein air : on arrive par le bord du terrain, la haie arrête tout, personne n’attend dehors, et les cartes sont plus grandes', () => {
  const outdoor = LEVELS.filter(l => l.outdoor);
  ok(outdoor.length >= 2, 'au moins deux cartes en plein air');
  const indoor = Math.max(...LEVELS.filter(l => !l.outdoor).map(l => l.map[0].length * l.map.length));
  for (const l of outdoor) {
    const map = new GameMap(l);
    ok(l.map[0].length * l.map.length > 1.5 * indoor, l.name + ' : une fois et demie la plus grande carte d’intérieur, au moins');
    ok(map.breaches.every(b => {
      const tx = Math.floor(b.inside.x / TILE), ty = Math.floor(b.inside.y / TILE);
      return Math.min(b.x, b.y, map.w - 1 - b.x, map.h - 1 - b.y) === 0 && map.tile(tx, ty) === 0 && /^Entrée /.test(map.breachLabel(b));
    }), l.name + ' : entrées au bord de la carte, nommées « Entrée … »');
    ok(map.windows.length > 0 && map.doors.length > 0, l.name + ' : la maison a ses portes et ses fenêtres (sur le jardin)');
    const lawn = map.floorType.some(f => f === FLOOR['"']) && map.floorType.some(f => f === FLOOR['_']);
    ok(lawn, l.name + ' : de l’herbe et du gravier');
    ok(map.hedgeAt.size > 0 && [...map.hedgeAt].every(i => map.tiles[i] === 1), l.name + ' : la haie est un mur (pas, regard, balles)');
    ok(map.props.some(p => p.type === 'tree'), l.name + ' : des arbres');
    const c = document.createElement('canvas').getContext('2d');
    for (const p of map.props) Sprites.paintProp(c, p);
    // personne n'est posté dans le jardin, pas même tiré au sort
    for (const mode of ['assault', 'siege']) {
      const g = mkGame({ mode, level: LEVELS.indexOf(l) });
      const out = [...g.game.enemies, ...g.game.mates, ...g.game.hostages].filter(a => OUTDOOR_FLOORS.has(g.game.map.floor(Math.floor(a.x / TILE), Math.floor(a.y / TILE))));
      eq(out.length, mode === 'assault' ? 2 : 0, l.name + ' / ' + mode + ' : dehors, seulement ' + (mode === 'assault' ? 'vos coéquipiers' : 'personne'));
    }
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
  ok(s.gunLen > w.gunLen && s.weight > w.weight, 'plus long, plus lourd : il pèse dans la charge');
  eq(suppressedDef('m870'), WEAPONS.m870, 'pas de silencieux sur un fusil à pompe');
  // le silencieux ne freine pas la balle : seule une munition subsonique de remplacement l'affaiblit
  const same = (k, msg) => { const a = suppressedDef(k), b = WEAPONS[k]; ok(a.damage === b.damage && a.range === b.range && a.effRange === b.effRange && a.speed === b.speed, msg); };
  same('hk416', '5,56 supersonique : ni puissance ni portée perdues');
  same('mp7', '4,6 supersonique : rien de perdu');
  same('usp45', '.45 ACP subsonique d’origine : rien de perdu');
  const m5 = suppressedDef('mp5'), w5 = WEAPONS.mp5;
  ok(m5.damage < w5.damage && m5.range < w5.range && m5.effRange < w5.effRange && m5.speed < w5.speed, '9 mm subsonique : moins de dégâts, de portée et de vitesse');
  ok(suppressedDef('glock17').damage < WEAPONS.glock17.damage, 'Glock 17 aussi');
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

test('un otage accroché à l’angle d’un meuble s’en dégage d’un pas de côté', () => {
  const saved = LEVELS.slice();
  LEVELS.length = 0;
  LEVELS.push({ name: 'Essai', briefing: '', enemyWeapons: ['ak'], map: [
    '############',
    '#S.........#',
    '#...CCCC...#',
    '#..........#',
    '############',
  ] });
  try {
    const { game } = mkGame({ alone: true });
    // dans le passage sous le comptoir, un millième de pixel trop haut : le pas vers l'avant frôle son angle
    const h = new Hostage(119.68, 103.999);
    h.escort = game.player; // debout
    ok(!game.map.circleFree(h.x + 1, h.y, h.radius - 1, true) && game.map.circleFree(h.x, h.y, h.radius - 1, true), 'son cercle frôle le comptoir');
    h.path = [{ x: 300, y: 104 }];
    h.repathT = 10;
    for (let i = 0; i < 60; i++) game.stepAlong(h, 1.8, 1 / 60);
    ok(h.x > 200, 'il longe le comptoir au lieu de rester planté (' + Math.round(h.x) + ')');
    ok(game.map.circleFree(h.x, h.y, h.radius - 1, true), 'sans entrer dans le meuble');
  } finally { LEVELS.length = 0; saved.forEach(l => LEVELS.push(l)); }
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

// Tir dans une porte : le joueur d'un côté (w.a), un suspect de l'autre (w.b), ses tirs comptés.
function blindScene(doorOpen, faceAway, weapon) {
  const g = mkGame({ alone: true });
  const game = g.game, p = game.player;
  const w = doorWithRoom(game);
  setDoor(w.d, doorOpen ? 1 : 0);
  p.x = w.a.x; p.y = w.a.y; p.hp = p.maxHp = 1e6;
  const toYou = Math.atan2(w.a.y - w.b.y, w.a.x - w.b.x);
  const foe = new Enemy(w.b.x, w.b.y, faceAway ? toYou + Math.PI : toYou, weapon || 'ak');
  foe.hp = foe.maxHp = 1e6;
  game.enemies = [foe];
  const sc = { g, game, p, w, foe, shots: 0, through: false };
  const fire = game.fireWeapon.bind(game);
  game.fireWeapon = s => { if (s === foe) sc.shots++; fire(s); };
  sc.run = n => { for (let i = 0; i < n; i++) { g.step(1); sc.through = sc.through || game.bullets.some(b => b.shooter === foe && b.pierced > 0); } };
  return sc;
}

test('un suspect qui vous a vu disparaître derrière une porte tire dedans, puis vient voir', () => {
  const sc = blindScene(true, false), { game, p, w, foe } = sc;
  for (let i = 0; i < 60 && foe.target !== p; i++) sc.run(1);
  eq(foe.target, p, 'il vous voit par la porte ouverte');
  setDoor(w.d, 0); // on referme aussitôt, avant qu'il ait tiré
  sc.run(1);
  ok(foe.blind && !foe.target, 'porte refermée : il ne vous voit plus, mais il sait où vous êtes');
  sc.shots = 0;
  sc.run(120);
  ok(sc.shots >= 3, 'il tire dans la porte (' + sc.shots + ' coups)');
  ok(sc.through, 'ses balles la traversent');
  sc.run(60);
  ok(!foe.blind, 'il cesse au bout de quelques secondes');
  sc.run(150);
  ok(foe.state === 'investigate' || w.d.progress > 0, 'puis il vient voir (état ' + foe.state + ')');
  // la porte rouverte sur une pièce vide : il ne tire plus dans le vide
  const sc2 = blindScene(true, false);
  for (let i = 0; i < 60 && sc2.foe.target !== sc2.p; i++) sc2.run(1);
  setDoor(sc2.w.d, 0); sc2.run(1);
  sc2.p.x = sc2.w.a.x + 40 * U; // parti (hors de la carte : plus personne derrière la porte)
  setDoor(sc2.w.d, 1); sc2.run(1);
  ok(!sc2.foe.blind, 'porte rouverte : il voit qu’il n’y a plus personne');
  ok(game.map.doorsOnLine(foe.x, foe.y, foe.x, foe.y) === 0, 'un point sur lui-même : rien entre eux');
});

test('une balle venue à travers une porte fait riposter le suspect dans la porte', () => {
  const sc = blindScene(false, true), { game, p, w, foe } = sc;
  sc.run(30);
  ok(!foe.blind && !foe.target && sc.shots === 0, 'au départ, il ne se doute de rien');
  // une balle tirée de votre place, qui le frôle après avoir traversé la porte
  const lat = 0.7 * U, tx = foe.x + (w.d.horizontal ? lat : 0), ty = foe.y + (w.d.horizontal ? 0 : lat);
  const ang = Math.atan2(ty - p.y, tx - p.x);
  game.bullets.push({ x: p.x, y: p.y, vx: Math.cos(ang) * 1150, vy: Math.sin(ang) * 1150, team: 'ops', damage: 30, life: 1,
    shooter: p, ox: p.x, oy: p.y, trail: 18, pierce: 0.55, pierced: 0 });
  sc.run(10);
  ok(foe.blind, 'la balle sortie de la porte l’a frôlé : il sait qu’on tire de derrière');
  ok(dist(foe.blind.x, foe.blind.y, p.x, p.y) <= 0.5 * U + 1, 'il vise d’où le coup est parti, à une demi-case près');
  sc.shots = 0;
  sc.run(120);
  ok(sc.shots >= 3 && sc.through, 'il riposte à travers la porte (' + sc.shots + ' coups)');
});

test('au fusil à pompe scié, il tire dans la porte sans en faire sauter la serrure', () => {
  const sc = blindScene(false, false, 'sgE'), { w, foe } = sc;
  ok(foe.weapon.kind === 'shotgun', 'un fusil à pompe');
  ok(sc.game.startBlindFire(foe, w.a.x, w.a.y), 'il vous sait derrière la porte');
  sc.run(150);
  ok(sc.shots >= 1 && sc.through, 'la chevrotine traverse la porte (' + sc.shots + ' coups)');
  ok(!w.d.broken && w.d.progress === 0, 'tirée au jugé, elle ne vise pas la serrure : la porte tient');
});

test('à travers un mur, pas de tir à l’aveugle ; l’intervention ne tire jamais ainsi', () => {
  const sc = blindScene(false, false), { game, w, foe } = sc, map = game.map;
  eq(map.doorsOnLine(w.a.x, w.a.y, w.b.x, w.b.y), 1, 'porte fermée : une porte à traverser');
  setDoor(w.d, 1);
  eq(map.doorsOnLine(w.a.x, w.a.y, w.b.x, w.b.y), 0, 'porte ouverte : la vue est libre');
  setDoor(w.d, 0);
  // décalé le long du mur, au-delà de l'embrasure
  const off = w.d.len * TILE, ox = w.d.horizontal ? off : 0, oy = w.d.horizontal ? 0 : off;
  eq(map.doorsOnLine(w.a.x + ox, w.a.y + oy, w.b.x + ox, w.b.y + oy), -1, 'à travers le mur : rien ne passe');
  foe.x += ox; foe.y += oy;
  ok(!game.startBlindFire(foe, w.a.x + ox, w.a.y + oy) && !foe.blind, 'un mur entre eux : il ne tire pas');
  foe.x -= ox; foe.y -= oy;
  ok(game.startBlindFire(foe, w.a.x, w.a.y), 'une porte : il tire');
  const op = new Operator(w.b.x, w.b.y, 0, 'hk416op');
  ok(!game.startBlindFire(op, w.a.x, w.a.y) && !op.blind, 'un opérateur ne tire pas à l’aveugle (des otages peuvent être derrière)');
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

test('le briefing propose chaque mode et l’équipement du camp', () => {
  const g = mkGame();
  const ui = g.ui;
  ui.showBriefing();
  eq(ui.panel.querySelectorAll('.modebtn').length, Object.keys(MODES).filter(m => !MODES[m].variantOf).length, 'un bouton par mode (les deux camps des trinômes n’en font qu’un)');
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
  // la fiche dit ce que chaque accessoire change à cette arme
  const fiches = ui.$('wdetail').querySelectorAll('.wd');
  ok(/subsonique/.test(fiches[0].querySelector('.wd-acc').textContent), 'MP5 : la munition subsonique est annoncée');
  ok(/faisceau se voit/.test(fiches[1].querySelector('.wd-acc').textContent), 'Glock : le laser se voit');
  ok(/supersonique/.test(UI.accEffect('hk416', 'sup')), 'HK416 : la balle reste supersonique');
  const enMouvement = fiche => {
    const i = [...fiche.querySelectorAll('.wd-bars span')].findIndex(sp => sp.textContent === 'En mouvement');
    return parseFloat(fiche.querySelectorAll('.wd-bars .bar div')[i].style.width);
  };
  const avant = enMouvement(fiches[1]);
  acc('glock17', 'laser').click();
  ok(enMouvement(ui.$('wdetail').querySelectorAll('.wd')[1]) < avant, 'Glock : le laser améliore le tir en mouvement');
  acc('glock17', 'laser').click();
  card('hk416').click();
  ok(!game.player.slots[0].def.suppressed, 'le HK416 n’hérite pas du silencieux du MP5');
  card('mp5').click();
  ok(game.player.slots[0].def.suppressed, 'le MP5 a gardé le sien');
  card('m870').click();
  ok(acc('m870', 'sup').disabled && !acc('m870', 'laser').disabled, 'fusil à pompe : un laser, pas de silencieux');
  const back = Game.loadSavedLoadout('assault');
  ok(back.primary === 'm870' && back.acc.mp5.sup && back.acc.glock17.laser, 'choix retrouvés au rechargement, arme par arme');
  // les coéquipiers ont leur choix à part, deux boutons dont un en surbrillance, qui leur redonne une arme
  const team = sup => ui.panel.querySelector(`.teambtn[data-sup="${sup}"]`);
  ok(team(0).classList.contains('sel') && !team(1).classList.contains('sel'), 'équipe : « Sans » retenu au départ');
  team(1).click();
  ok(game.loadout.teamSup && game.mates.every(m => m.weapon.suppressed), 'coéquipiers au silencieux');
  ok(team(1).classList.contains('sel') && !team(0).classList.contains('sel'), 'équipe : « Silencieux » en surbrillance');
  const armes = ui.panel.querySelector('.teamarms').textContent;
  ok(game.mates.every(m => armes.includes(`${m.name} : ${m.weapon.name} 🔇`)), 'l’arme de chacun, silencieux compris : ' + armes);
  const avantClic = game.mates.map(m => m.weapon);
  team(1).click();
  ok(game.mates.every((m, i) => m.weapon === avantClic[i]), 'recliquer le choix en cours ne retire pas les armes');
  // le courant, pareil : deux boutons, l'état retenu en surbrillance
  const pow = c => ui.panel.querySelector(`.powbtn[data-cut="${c}"]`);
  ok(pow(0).classList.contains('sel') && !pow(1).classList.contains('sel'), 'courant : « Laissé » retenu au départ');
  pow(1).click();
  ok(game.dark && pow(1).classList.contains('sel') && !pow(0).classList.contains('sel'), 'courant coupé, en surbrillance');
  pow(0).click();
  ok(!game.dark && pow(0).classList.contains('sel'), 'courant rétabli');
  ok(!game.player.slots[0].def.suppressed && game.player.slots[1].def.laser, 'le joueur garde ses accessoires');
  // poignée et chargeur long sur le HK416 ; le MP7 n'accepte ni l'un ni l'autre
  card('hk416').click();
  eq(ui.$('waccs').querySelectorAll('.accrow')[0].querySelectorAll('.accbtn').length, 5, 'cinq accessoires par arme');
  acc('hk416', 'grip').click();
  acc('hk416', 'mag').click();
  const w = game.player.slots[0].def;
  ok(w.grip && w.bloom < WEAPONS.hk416.bloom && w.recoil < WEAPONS.hk416.recoil, 'poignée : moins d’ouverture et de recul en rafale');
  ok(w.extMag && game.player.slots[0].mag === 40 && w.reload > WEAPONS.hk416.reload, 'chargeur de 40, un peu plus long à changer');
  eq(game.player.slots[0].reserve, WEAPONS.hk416.reserve, 'pas une cartouche de plus en réserve');
  ok(w.weight > WEAPONS.hk416.weight + 0.3, 'les deux pèsent');
  ok(/40 coups/.test(ui.$('wdetail').textContent) && /Poignée avant/.test(ui.$('wdetail').textContent), 'la fiche les annonce');
  card('mp7').click();
  ok(acc('mp7', 'grip').disabled && acc('mp7', 'mag').disabled, 'MP7 : ni poignée ni chargeur long');
  // gilet : les deux côte à côte, celui qu'on porte en surbrillance (souple par défaut)
  const vb = k => ui.panel.querySelector('.vestbtn[data-vest="' + k + '"]');
  eq(game.loadout.vest, 'vestL', 'gilet souple par défaut');
  ok(vb('vestL') && vb('vestH'), 'les deux gilets proposés côte à côte');
  ok(vb('vestL').classList.contains('sel') && !vb('vestH').classList.contains('sel'), 'le gilet porté est en surbrillance');
  vb('vestH').click();
  eq(game.loadout.vest, 'vestH', 'gilet lourd choisi');
  ok(game.player.vest === VESTS.vestH && vb('vestH').classList.contains('sel') && !vb('vestL').classList.contains('sel'), 'porté, et la sélection le montre');
  ui.hideOverlay();
  game.paused = false;
}

test('briefing : icônes des accessoires, gilet porté en vue, bilan de la charge, de la vitesse et des dégâts encaissés', () => {
  // le briefing enregistre l'équipement : on remet celui du joueur en sortant
  const KEY = 'breach.loadout.assault';
  let sauve = null;
  try { sauve = localStorage.getItem(KEY); } catch (e) { /* stockage indisponible */ }
  try { gearSummaryTest(); } finally {
    try { if (sauve === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, sauve); } catch (e) { /* idem */ }
  }
});

function gearSummaryTest() {
  const g = mkGame({ loadout: { primary: 'hk416', sidearm: 'glock17', vest: 'vestL' } });
  const game = g.game, ui = g.ui;
  game.paused = true;
  ui.showBriefing();
  const accs = [...ui.panel.querySelectorAll('.accbtn')];
  ok(accs.length === 10 && accs.every(b => b.querySelector('svg.ico')), 'chaque accessoire a son icône');
  eq(ui.panel.querySelectorAll('.vestbtn svg.ico').length, 2, 'chaque gilet aussi');
  const sum = () => ui.panel.querySelector('#wsum');
  const line = label => [...sum().querySelectorAll('.ws-line')].find(l => l.textContent.includes(label)).querySelector('b').textContent;
  const cells = () => [...sum().querySelectorAll('.ws-res td')].map(td => parseInt(td.textContent, 10)).join();
  const speed = () => parseInt(line('Vitesse'), 10);
  // HK416 et gilet souple : la vitesse du jeu (la masse des deux armes), la masse de tout ce qu'on emporte
  eq(speed(), Math.round(100 * loadMobility(WEAPONS.hk416.weight + WEAPONS.glock17.weight) / MOBILITY_MAX), 'vitesse : les deux armes pèsent');
  near(parseFloat(line('Charge').replace(',', '.')), WEAPONS.hk416.weight + WEAPONS.glock17.weight + VESTS.vestL.weight, 0.06, 'charge totale');
  // dégâts encaissés : arme de poing puis fusil, de face, de flanc, de dos
  eq(cells(), '50,50,50,100,100,100', 'gilet souple : moitié des dégâts d’arme de poing partout, rien contre un fusil');
  const vite = speed(), lamp = () => ui.panel.querySelector('.accbtn[data-key="glock17"][data-acc="light"]');
  lamp().click();
  ok(speed() < vite, 'une lampe sur l’arme de poing ralentit, même avec le fusil en main');
  lamp().click();
  const avant = speed();
  ui.panel.querySelector('.vestbtn[data-vest="vestH"]').click();
  ok(speed() < avant, 'gilet lourd : plus lent');
  eq(cells(), '30,50,30,30,100,30', 'ses plaques arrêtent même un fusil, de face et de dos ; de flanc, le gilet souple seul');
  // le bilan dit ce que fait le jeu : une balle venue de face, de flanc ou de dos sur le joueur ainsi équipé
  const p = game.player, from = { face: Math.PI, flanc: Math.PI / 2, dos: 0 };
  eq([1, 3].map(pen => ['face', 'flanc', 'dos'].map(f => Math.round(game.vestHit(p, { pen }, p.angle + from[f], 100))).join()).join(), cells(), 'mêmes chiffres que Game.vestHit');
  ui.panel.querySelector('.wcard[data-key="shieldL"]').click();
  eq(cells(), '0,50,30,' + Math.round(SHIELDS.shieldL.through * VESTS.vestH.plateBlunt * 100) + ',100,30', 'bouclier léger : il arrête l’arme de poing de face, une balle de fusil le traverse');
  ok(/bouclier léger ×0,88/.test(sum().textContent) && /gilet lourd ×0,86/.test(sum().textContent), 'le bilan dit ce qui ralentit');
  ui.panel.querySelector('.accbtn[data-key="glock17"][data-acc="mag"]').click();
  near(parseFloat(line('Charge').replace(',', '.')), SHIELDS.shieldL.weight + fittedDef('glock17', { mag: true }).weight + VESTS.vestH.weight, 0.06, 'les accessoires comptent dans la charge');
  // en jeu, à côté de la santé
  ui.hideOverlay();
  game.paused = false;
  ui.update();
  eq(document.getElementById('gearLabel').textContent, 'Gilet lourd · Bouclier léger', 'le HUD rappelle le gilet et le bouclier portés');
  // le groupe armé : ni gilet ni bouclier, et une vitesse qui ne dépasse jamais 100 %
  const gs = mkGame({ mode: 'siege' });
  gs.ui.showBriefing();
  const ss = gs.ui.panel.querySelector('#wsum');
  ok(/Ni gilet ni bouclier/.test(ss.textContent) && !ss.querySelector('.ws-res'), 'siège : pas de protection, et c’est dit');
  ok([...ss.textContent.matchAll(/(\d+) %/g)].every(m => +m[1] <= 100), 'vitesses jusqu’à 100 % : ' + ss.querySelector('small').textContent);
  gs.ui.hideOverlay();
  eq(document.getElementById('gearLabel').textContent, '', 'siège : rien à côté de la santé');
}

test('briefing : les fiches gardent la même disposition, le plan choisit l’ouverture', () => {
  const KEYS = ['breach.loadout.assault', 'breach.entry'];
  const sauve = {};
  try { KEYS.forEach(k => { sauve[k] = localStorage.getItem(k); }); } catch (e) { /* stockage indisponible */ }
  try { briefingLayoutTest(); } finally {
    try { KEYS.forEach(k => { if (sauve[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, sauve[k]); }); } catch (e) { /* idem */ }
  }
});

function briefingLayoutTest() {
  const g = mkGame({ loadout: { primary: 'hk416', sidearm: 'glock17' } });
  const game = g.game, ui = g.ui;
  game.paused = true;
  ui.showBriefing();
  const cols = ui.panel.querySelectorAll('.brief-col');
  eq(cols.length, 3, 'trois colonnes');
  ok(cols[0].querySelector('#ovPlan') && cols[0].querySelector('.entrybtn'), 'à gauche : le plan et les ouvertures');
  ok(cols[1].querySelector('.wcard') && cols[1].querySelector('.accbtn'), 'au milieu : les armes et leurs accessoires');
  ok(cols[2].querySelector('#wdetail'), 'à droite : les caractéristiques');
  // chaque fiche a le même squelette : en-tête, 7 lignes de barres au plus, 8 données, puis le texte
  const forme = () => [...ui.$('wdetail').querySelectorAll('.wd')].map(w =>
    [w.children.length, w.querySelectorAll('.wd-specs dt').length, w.querySelectorAll('.wd-bars .bar').length <= 7, !!w.querySelector('.wd-slot')].join());
  const ref = forme();
  eq(ref.length, 2, 'deux fiches : arme principale (ou bouclier) et arme de poing');
  for (const b of ui.panel.querySelectorAll('.wcard')) {
    b.click();
    eq(forme().join('|'), ref.join('|'), b.dataset.key + ' : même disposition');
    eq(ui.$('waccs').querySelectorAll('.accrow').length, 2, b.dataset.key + ' : deux lignes d’accessoires');
  }
  // un clic sur une ouverture du plan la choisit comme point d'entrée
  const c = ui.panel.querySelector('#ovPlan'), r = c.getBoundingClientRect(), m = game.map, b = m.breaches[1];
  c.onclick({ clientX: r.left + (b.cx / TILE + PLAN_PAD) / (m.w + 2 * PLAN_PAD) * r.width,
              clientY: r.top + (b.cy / TILE + PLAN_PAD) / (m.h + 2 * PLAN_PAD) * r.height });
  ok(!game.entryRandom && game.entryIndex === 1, 'ouverture choisie sur le plan');
  ok(ui.panel.querySelector('.entrybtn[data-entry="1"]').classList.contains('sel'), 'son bouton est coché');
  // l'aide des commandes ramène au briefing
  ui.panel.querySelector('#ovHelp').click();
  ui.panel.querySelector('#ovClose').click();
  ok(ui.panel.querySelector('#ovGo'), 'retour au briefing après l’aide');
  ui.hideOverlay();
  game.paused = false;
}

test('le bouclier arrête de face les balles de son niveau, pas de flanc ni de dos', () => {
  const g = mkGame({ alone: true, loadout: { primary: 'hk416', sidearm: 'glock17', shield: 'shieldL' } });
  const game = g.game, p = game.player;
  ok(p.shield === SHIELDS.shieldL, 'bouclier au bras');
  p.vest = null; // le bouclier seul : le gilet souple amortirait les balles de flanc
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

test('la vitesse dépend du poids de toutes les armes portées, accessoires compris, pas de celle qu’on a en main', () => {
  // le joueur court quelques pas depuis le même départ, sans personne autour
  const run = (loadout, cur) => {
    const g = mkGame({ alone: true, loadout: { sidearm: 'glock17', ...loadout } });
    const game = g.game, p = game.player;
    p.cur = cur; p.walkMode = false;
    const x0 = p.x, y0 = p.y, ang = Math.atan2(game.map.h * TILE / 2 - p.y, game.map.w * TILE / 2 - p.x);
    game.input.mouse.x = p.x + Math.cos(ang) * 100; game.input.mouse.y = p.y + Math.sin(ang) * 100;
    game.input.keys = { [Math.cos(ang) > 0 ? 'KeyD' : 'KeyA']: true };
    for (let i = 0; i < 8; i++) game.update(1 / 60);
    return { d: dist(x0, y0, p.x, p.y), load: p.weaponLoad };
  };
  const rifle = run({ primary: 'hk416' }, 0), pistol = run({ primary: 'hk416' }, 1);
  ok(rifle.d > 5, 'il avance');
  near(pistol.d, rifle.d, 0.01, 'l’arme de poing en main ne rend pas plus rapide : le HK416 pèse toujours, à la bretelle');
  near(rifle.load, WEAPONS.hk416.weight + WEAPONS.glock17.weight, 1e-9, 'charge : les deux armes');
  const light = run({ primary: 'mp7' }, 0), heavy = run({ primary: 'scarh', acc: { scarh: { sup: true, grip: true, light: true } } }, 0);
  ok(light.d > rifle.d && heavy.d < rifle.d, 'MP7 plus vite, SCAR-H équipé plus lentement (' + [light, rifle, heavy].map(r => r.d.toFixed(1)).join(' / ') + ' px)');
  near(heavy.d / light.d, loadMobility(heavy.load) / loadMobility(light.load), 0.02, 'dans le rapport des charges');
  const loaded = run({ primary: 'hk416', acc: { glock17: { mag: true, light: true } } }, 0);
  ok(loaded.d < rifle.d, 'des accessoires sur l’arme de poing ralentissent aussi, même le fusil en main');
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
  // le bouclier léger remplace le fusil : presque l'allure d'un fusil et d'une arme de poing ; le lourd, bien moins
  const slow = run(g), fast = run(plain);
  ok(fast > 10 && slow < fast * 0.99, 'il avance un peu moins vite : ' + slow.toFixed(1) + ' px contre ' + fast.toFixed(1));
  const heavy = run(mkGame({ alone: true, loadout: { primary: 'hk416', sidearm: 'glock17', shield: 'shieldH' } }));
  ok(heavy < fast * 0.88, 'bouclier lourd : nettement moins vite : ' + heavy.toFixed(1) + ' px');
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



// ---------------------------------------------------------------- sommation, arrestation, note
// Le joueur seul, un suspect en vue à distance donnée (cases), de dos ou de face ; Math.random fixé pendant fn.
function surrenderScene(dMin, dMax, facing) {
  const g = mkGame({ alone: true });
  const game = g.game, p = game.player;
  const spot = freeSpotsAround(game, p, 40).find(s => { const d = dist(s.x, s.y, p.x, p.y); return d >= dMin * U && d <= dMax * U; });
  if (!spot) return null;
  const toYou = Math.atan2(p.y - spot.y, p.x - spot.x);
  const e = new Enemy(spot.x, spot.y, facing ? toYou : toYou + Math.PI, 'ak');
  e.homeAngle = e.angle;
  game.enemies = [e];
  game.input.mouse.x = e.x; game.input.mouse.y = e.y;
  g.step(1);
  return { g, game, p, e };
}
function withRandom(v, fn) {
  const r = Math.random;
  Math.random = () => v;
  try { return fn(); } finally { Math.random = r; }
}

test('sommation : un suspect pris de dos se rend, lâche son arme, et plus personne ne tire', () => {
  const sc = surrenderScene(1.5, 3, false);
  ok(sc, 'une scène de test');
  const { g, game, p, e } = sc;
  const back = game.surrenderChance(e);
  e.stun = 2; e.hp = 20;
  ok(game.surrenderChance(e) > back && game.surrenderChance(e) >= 0.9, 'aveuglé et blessé, il cède presque à coup sûr');
  e.stun = 0; e.hp = e.maxHp;
  e.angle = Math.atan2(p.y - e.y, p.x - e.x); e.target = p;
  const buddy = new Enemy(e.x + 12, e.y, e.angle, 'ak');
  game.enemies.push(buddy);
  ok(game.surrenderChance(e) < back, 'de face, en plein échange et avec un complice à côté, beaucoup moins');
  game.enemies = [e]; e.target = null; e.angle += Math.PI;
  withRandom(0.999, () => g.press('KeyC'));
  ok(!e.surrender && /refuse/.test(game.message.text), 'un refus se dit');
  game.shoutT = -9;
  withRandom(0, () => g.press('KeyC'));
  ok(e.surrender && /se rend/.test(game.message.text), 'il se rend');
  let shots = 0;
  const fire = game.fireWeapon.bind(game);
  game.fireWeapon = a => { if (a === e) shots++; fire(a); };
  e.angle = Math.atan2(p.y - e.y, p.x - e.x);
  g.step(120);
  eq(shots, 0, 'à genoux, il ne tire pas, même face à vous');
  eq(game.acquireFor(p, game.enemies), null, 'personne de l’équipe ne le prend pour cible');
  game.noise(e.x + 2 * U, e.y, 8 * U, null, 'shot');
  ok(!e.path.length && e.surrender, 'un coup de feu ne le fait pas bouger');
  ok(game.enemies.filter(Game.active).length === 1, 'rendu mais pas menotté : il compte encore');
});

test('H menotte un suspect rendu : menottés ou abattus, tous neutralisés, la mission est accomplie', () => {
  const sc = surrenderScene(0.75, 1.45, false);
  ok(sc, 'une scène de test');
  const { g, game, p, e } = sc;
  game.checkEnd = Game.prototype.checkEnd.bind(game);
  game.surrenderTo(e);
  ok(dist(p.x, p.y, e.x, e.y) < HOSTAGE_REACH, 'à portée de main');
  game.message.t = 0; // le rappel ne recouvre pas un message en cours
  g.step(10);
  ok(/menott/.test(game.message.text), 'on vous rappelle de le menotter : ' + game.message.text);
  g.press('KeyH');
  eq(p.act && p.act.type, 'cuff', 'il faut un geste pour menotter');
  g.step(Math.ceil(CUFF_TIME * 60) + 2);
  ok(e.cuffed && game.stats.arrests === 1, 'suspect menotté');
  eq(game.over, 'win', 'plus aucun suspect actif : mission accomplie');
  const line = game.score.lines.find(l => l.label === 'Suspects arrêtés');
  ok(line && line.detail === '1 / 1' && line.pts === 20, 'l’arrestation compte dans la note');
});

test('un suspect rendu laissé sans surveillance reprend son arme', () => {
  const sc = surrenderScene(2.6, 3, false);
  ok(sc, 'une scène de test');
  const { g, game, p, e } = sc;
  game.surrenderTo(e);
  g.step(Math.ceil(SURRENDER_LAPSE * 60) + 10);
  ok(e.surrender, 'tant que vous le tenez en vue, il reste à genoux');
  game.input.mouse.x = p.x - (e.x - p.x); game.input.mouse.y = p.y - (e.y - p.y); // on lui tourne le dos
  g.step(Math.ceil(SURRENDER_LAPSE * 60) + 10);
  ok(!e.surrender && !e.cuffed, 'seul trop longtemps, il se relève');
  eq(e.state, 'engage', 'et reprend le combat');
});

test('la note de fin récompense les arrestations et punit un suspect abattu après sa reddition', () => {
  const g = mkGame({ noEnd: false });
  const game = g.game;
  const n = game.enemies.length, H = game.hostages.length;
  game.enemies.forEach(e => { e.alive = false; });
  game.stats.kills = n;
  const killed = game.scoreReport('win');
  eq(killed.total, 70, 'tous abattus, otages en vie mais pas dehors, équipe indemne');
  game.enemies.forEach(e => { e.alive = true; e.surrender = { t: 0, lapse: 0 }; e.cuffed = true; });
  game.stats.kills = 0; game.stats.arrests = n;
  game.hostages.forEach(h => { h.evacuated = true; });
  const perfect = game.scoreReport('win');
  ok(perfect.total === 100 && perfect.grade === 'S', 'tout le monde arrêté, otages dehors : 100, note S');
  game.stats.badKills = 1;
  ok(game.scoreReport('win').total === 85, 'un suspect abattu à genoux : −15');
  game.hostages[0].alive = false;
  const lost = game.scoreReport('lose');
  ok(lost.total <= 49 && lost.grade === 'D', 'une mission échouée plafonne à D');
  game.over = 'win'; game.score = perfect; game.record = { prev: 70, beaten: true };
  g.ui.showEnd('win');
  eq(document.getElementById('endGrade').textContent, 'S', 'la lettre s’affiche en fin de mission');
  ok(/Nouveau record/.test(g.ui.panel.textContent), 'et le record battu');
  ok(H > 0, 'des otages sur la carte');
});

// ---------------------------------------------------------------- lampe et courant coupé
// Un suspect à distance (cases) dans l'axe d'une ligne dégagée, face au joueur.
function darkScene(cut, d, lamp) {
  const g = mkGame({ alone: true, loadout: { primary: 'hk416', sidearm: 'glock17', cutPower: cut, acc: { hk416: { light: lamp } } } });
  const game = g.game, p = game.player, map = game.map;
  for (let k = 0; k < 48; k++) {
    const a = k * TAU / 48, r = map.castRay(p.x, p.y, a, 14 * U, false);
    if (r.dist < (d + 1) * U) continue;
    const ex = p.x + Math.cos(a) * d * U, ey = p.y + Math.sin(a) * d * U;
    if (!map.circleFree(ex, ey, 12, true)) continue;
    const e = new Enemy(ex, ey, a + Math.PI, 'ak');
    game.enemies = [e];
    game.input.mouse.x = ex; game.input.mouse.y = ey;
    g.step(1);
    return { g, game, p, e };
  }
  return null;
}

test('courant coupé : on ne voit qu’à quelques pas, sauf ce qu’éclaire une lampe, ou qui tire', () => {
  const sc = darkScene(true, 7, true);
  ok(sc, 'une scène de test');
  const { g, game, p, e } = sc;
  ok(game.dark && p.weapon.light, 'noir, et une lampe sur le HK416');
  p.lampOn = false;
  ok(!game.canSee(p, e) && !game.canSee(e, p), 'lampe éteinte : personne ne voit personne à 7 cases');
  game.computeVision();
  ok(!game.visionPolys.some(q => q.lamp), 'pas de faisceau');
  p.lampOn = true;
  ok(game.canSee(p, e), 'la lampe allumée le fait voir');
  ok(game.canSee(e, p), 'mais elle se voit de loin');
  game.computeVision();
  ok(game.visionPolys.some(q => q.lamp), 'le faisceau compte dans la vision');
  p.lampOn = false;
  game.fireWeapon(e);
  ok(game.canSee(p, e), 'un coup de feu sans silencieux trahit le tireur');
  g.step(Math.ceil(SHOT_GLOW * 60) + 2);
  ok(!game.canSee(p, e), 'un instant seulement');
  game.dark = false;
  ok(game.canSee(p, e), 'bâtiment éclairé : on le voit sans lampe');
  // les coéquipiers ont une lampe dans le noir, et suivent la vôtre
  const g2 = mkGame({ loadout: { primary: 'hk416', sidearm: 'glock17', cutPower: true } });
  ok(g2.game.mates.every(m => m.weapon.light), 'courant coupé : une lampe pour chaque coéquipier');
  ok(g2.game.enemies.every(x => x.suspicion > 0.5), 'le courant tombe : les suspects s’inquiètent');
  g2.press('KeyX');
  ok(g2.game.mates.every(m => !m.lampOn) && /éteintes/.test(g2.game.message.text), 'X éteint aussi les leurs');
  const g3 = mkGame({ loadout: { primary: 'hk416', sidearm: 'glock17' } });
  ok(!g3.game.dark && g3.game.mates.every(m => !m.weapon.light), 'courant laissé : rien de tout ça');
});

test('la lampe éblouit le suspect qui la reçoit en face, de près', () => {
  const sc = darkScene(false, 3, true);
  ok(sc, 'une scène de test');
  const { game, p, e } = sc;
  e.target = null;
  game.enemyCombat(e, 0);
  ok(e.target === p, 'il vous voit');
  near(e.reactT, e.reaction + LAMP_DAZZLE, 1e-6, 'ébloui : il met plus de temps à viser');
  p.lampOn = false; e.target = null;
  game.enemyCombat(e, 0);
  near(e.reactT, e.reaction, 1e-6, 'sans lampe, son temps de réaction ordinaire');
});

// ---------------------------------------------------------------- serrures et charges
test('une porte verrouillée se crochète lentement ; les suspects ont la clé, la chevrotine la fait sauter', () => {
  let some = false;
  for (let i = 0; i < LEVELS.length && !some; i++) some = mkGame({ alone: true, level: i, locks: true }).game.map.doors.some(d => d.locked);
  ok(some, 'des portes fermées à clé en assaut');
  ok(!mkGame({ alone: true }).game.map.doors.some(d => d.locked), 'pas dans les tests, sauf demande');
  const g = mkGame({ alone: true });
  const game = g.game, p = game.player;
  const w = doorWithRoom(game);
  ok(w, 'une porte de test');
  w.d.locked = true;
  p.x = w.a.x; p.y = w.a.y;
  g.press('KeyE');
  ok(p.act && p.act.type === 'lockpick' && p.act.dur === LOCKPICK_TIME, 'E sur une porte verrouillée : crochetage');
  ok(w.d.lockKnown, 'on sait désormais qu’elle est fermée à clé');
  g.step(Math.ceil(LOCKPICK_TIME * 60) + 2);
  ok(!w.d.locked && w.d.progress === 0, 'déverrouillée, mais toujours fermée');
  w.d.locked = true;
  const e = new Enemy(w.b.x, w.b.y, 0, 'ak');
  game.enemies = [e];
  game.doorAction(e, w.d, 1);
  eq(e.act && e.act.type, 'door', 'un suspect l’ouvre normalement');
  g.step(80);
  ok(!w.d.locked && w.d.progress > 0, 'avec sa clé');
  setDoor(w.d, 0); w.d.locked = true;
  for (let i = 0; i < BREACH_PELLETS; i++) game.breachDoor(w.d, p);
  ok(w.d.broken && !w.d.locked, 'la chevrotine arrache la serrure');
});

test('une charge de brèche souffle la porte et sonne ceux qui se tiennent derrière', () => {
  const g = mkGame({ alone: true });
  const game = g.game, p = game.player;
  const w = doorWithRoom(game);
  ok(w, 'une porte de test');
  w.d.locked = true;
  p.x = w.a.x; p.y = w.a.y;
  const e = new Enemy(w.d.cx + w.nx * 0.9 * U, w.d.cy + w.ny * 0.9 * U, 0, 'ak');
  e.hp = e.maxHp = 1e6;
  game.enemies = [e];
  game.updateEnemy = () => {};
  const n = p.charges;
  g.press('KeyB');
  eq(p.act && p.act.type, 'charge', 'la pose demande un geste');
  g.step(Math.ceil(CHARGE_PLACE * 60) + 2);
  ok(game.charges.length === 1 && p.charges === n - 1, 'charge posée');
  ok(Math.sign(game.charges[0].x - w.d.cx || game.charges[0].y - w.d.cy) === Math.sign(-(w.nx + w.ny)), 'de votre côté du battant');
  const hp = p.hp;
  g.press('KeyB');
  ok(w.d.broken && w.d.open && !w.d.locked, 'la porte vole en éclats, serrure comprise');
  ok(e.stun > 1.5 && e.hp < e.maxHp, 'le suspect contre la porte est blessé et sonné');
  eq(p.hp, hp, 'à une case et demie, de l’autre côté, vous n’avez rien');
  eq(game.charges.length, 0, 'la charge est partie');
  // une charge tombe si quelqu'un ouvre la porte avant la mise à feu
  const g2 = mkGame({ alone: true });
  const w2 = doorWithRoom(g2.game), p2 = g2.game.player;
  p2.x = w2.a.x; p2.y = w2.a.y;
  g2.press('KeyB'); g2.step(Math.ceil(CHARGE_PLACE * 60) + 2);
  eq(g2.game.charges.length, 1, 'posée');
  g2.game.openDoor(p2, w2.d, 1); g2.step(2);
  ok(!g2.game.charges.length && /tombée/.test(g2.game.message.text), 'porte ouverte : la charge tombe');
});

// Porte intérieure dont l'autre côté (côté -1, celui où le battant se rabat) a de la place contre le mur, de part et
// d'autre du cadre : d'un côté derrière le battant ouvert, de l'autre loin dans l'angle du mur. null s'il n'y en a pas.
function doorWithWalls(game) {
  for (const d of game.map.doors) {
    if (game.map.breaches.some(b => b.door === d)) continue;
    const nx = d.horizontal ? 0 : 1, ny = d.horizontal ? 1 : 0, ax = ny, ay = nx, half = d.len * TILE / 2;
    const at = (lat, across) => ({ x: d.cx + ax * lat + nx * across, y: d.cy + ay * lat + ny * across });
    const leaf = at(-(half + 16), -21), wall = at(half + 48, -21), me = at(0, 1.5 * U);
    if ([leaf, wall, me].every(q => game.map.circleFree(q.x, q.y, 12, true))) return { d, leaf, wall, me };
  }
  return null;
}

test('le souffle d’une charge part de toute l’embrasure : derrière le battant ou contre le mur, on est sonné', () => {
  let w = null, g = null;
  for (let i = 0; i < LEVELS.length && !w; i++) { g = mkGame({ alone: true, level: i }); w = doorWithWalls(g.game); }
  ok(w, 'une porte de test');
  const game = g.game, p = game.player;
  // ce que voyait l'ancien souffle (une ligne de vue depuis le milieu de la porte grande ouverte) : ni l'un ni l'autre
  setDoor(w.d, 1);
  ok(!game.map.hasLOS(w.d.cx, w.d.cy, w.leaf.x, w.leaf.y) && !game.map.hasLOS(w.d.cx, w.d.cy, w.wall.x, w.wall.y), 'le battant et le mur les cachaient');
  setDoor(w.d, 0);
  const foes = [w.leaf, w.wall].map(q => { const e = new Enemy(q.x, q.y, 0, 'ak'); e.hp = e.maxHp = 1e6; return e; });
  game.enemies = foes;
  game.updateEnemy = () => {};
  p.x = w.me.x; p.y = w.me.y;
  g.press('KeyB');
  g.step(Math.ceil(CHARGE_PLACE * 60) + 2);
  eq(game.charges.length, 1, 'charge posée');
  g.press('KeyB');
  ok(w.d.broken, 'porte soufflée');
  ok(foes[0].stun > 1, 'derrière le battant rabattu : sonné (' + foes[0].stun.toFixed(2) + ')');
  ok(foes[1].stun > 1, 'contre le mur, loin du cadre : sonné (' + foes[1].stun.toFixed(2) + ')');
});

// ---------------------------------------------------------------- entrée coordonnée
test('clic droit sur une porte fermée : l’équipe se met en colonne, puis entre quand elle s’ouvre', () => {
  const g = mkGame({ noEnemyAI: true });
  const game = g.game, p = game.player, inp = game.input;
  game.enemies = []; game.hostages = [];
  const w = doorWithRoom(game);
  ok(w, 'une porte de test');
  p.x = w.a.x; p.y = w.a.y;
  const spots = freeSpotsAround(game, p, 2);
  game.mates.forEach((m, i) => { m.x = spots[i].x; m.y = spots[i].y; });
  inp.mouse.x = w.d.cx; inp.mouse.y = w.d.cy;
  inp.pressed.Mouse2 = true; inp.mouse.rdown = true; g.step(1);
  inp.mouse.rdown = false; inp.pressed.Mouse2Up = true; g.step(1);
  ok(game.stack && game.mates.every(m => m.order === 'stack'), 'ordre de colonne');
  const across = m => (w.d.horizontal ? m.y - w.d.cy : m.x - w.d.cx);
  const mine = Math.sign(w.d.horizontal ? p.y - w.d.cy : p.x - w.d.cx);
  for (let i = 0; i < 400 && !game.stack.ready; i++) g.step(1);
  ok(game.stack.ready, 'les deux en place');
  ok(game.mates.every(m => Math.sign(across(m)) === mine), 'de votre côté de la porte');
  ok(game.mates[0].stackSide !== game.mates[1].stackSide, 'un de chaque côté de l’embrasure');
  // une flash en vol : ils attendent qu'elle éclate
  game.grenades = [{ x: p.x, y: p.y, vx: 0, vy: 0, t: 1, flight: 0.35, friction: 4, fuse: 99, cooked: 0, h: 0, spin: 0, bounces: 0, post: null, kind: 'flash', team: 'ops', thrower: p }];
  setDoor(w.d, 1);
  g.step(60);
  ok(game.mates.every(m => m.order === 'stack'), 'porte ouverte, flash en l’air : ils attendent');
  game.grenades = [];
  g.step(Math.ceil(ENTRY_DELAY * 60) + 2);
  ok(game.mates.every(m => m.order === 'move') && !game.stack, 'la flash partie : ils entrent');
  for (let i = 0; i < 360 && !game.mates.every(m => Math.sign(across(m)) === -mine); i++) g.step(1);
  ok(game.mates.every(m => Math.sign(across(m)) === -mine), 'les deux sont dans la pièce');
  ok(game.mates.every(m => m.coverAngle !== null), 'chacun couvre le fond de la pièce');
});

// Colonne sur la porte d depuis le côté side (signe de la coordonnée perpendiculaire), puis second clic droit :
// ce qui s'est passé (qui a lancé, à quel cran était la porte au lancer, où et quand la flash a éclaté).
// before(game) s'exécute une fois la colonne en place, avant le second clic. null si la place manque.
function flashEntry(g, d, side, before) {
  const game = g.game, p = game.player, inp = game.input;
  const nx = d.horizontal ? 0 : 1, ny = d.horizontal ? 1 : 0;
  p.x = d.cx + nx * side * 1.5 * U; p.y = d.cy + ny * side * 1.5 * U;
  if (!game.map.circleFree(p.x, p.y, 12, true)) return null;
  const spots = freeSpotsAround(game, p, 2);
  if (spots.length < 2) return null;
  game.mates.forEach((m, i) => { m.x = spots[i].x; m.y = spots[i].y; });
  const tick = () => game.update(1 / 60); // sans dessin : le balayage des portes en fait beaucoup
  const click = () => {
    inp.mouse.x = d.cx; inp.mouse.y = d.cy;
    inp.pressed.Mouse2 = true; inp.mouse.rdown = true; tick();
    inp.mouse.rdown = false; inp.pressed.Mouse2Up = true; tick();
  };
  click();
  if (!game.stack) return null;
  for (let i = 0; i < 400 && !game.stack.ready; i++) tick();
  if (!game.stack.ready) return null;
  if (before) before(game);
  const out = { boom: null, crack: null, thrower: null };
  const spawn = game.spawnFlash.bind(game), det = game.detonateFlash.bind(game);
  game.spawnFlash = (a, x, y, c, via) => { out.crack = d.progress; out.thrower = a; out.at = { x: a.x, y: a.y }; spawn(a, x, y, c, via); };
  game.detonateFlash = (x, y, gr) => {
    det(x, y, gr);
    out.boom = { x, y, progress: d.progress, across: Math.sign(d.horizontal ? y - d.cy : x - d.cx), stunned: game.enemies.filter(e => e.stun > 0) };
  };
  click();
  out.ordered = !!(game.stack && game.stack.flash);
  for (let i = 0; i < 900 && game.stack; i++) tick();
  out.entered = !game.stack && game.mates.every(m => !m.alive || m.order === 'move');
  out.open = d.progress;
  return out;
}

test('second clic droit sur la porte de la colonne : flash par l’entrebâillement, puis porte grande ouverte et entrée', () => {
  const g = mkGame({ noEnemyAI: true });
  const game = g.game;
  game.hostages = [];
  const w = doorWithRoom(game);
  ok(w, 'une porte de test');
  // le battant s'ouvre vers la pièce : on entre du côté des gonds… de l'autre (+1), la colonne est côté a
  const foe = new Enemy(w.a.x - w.nx * U, w.a.y - w.ny * U, 0, 'ak');
  foe.hp = foe.maxHp = 1e6; // vu par l'entrebâillement, l'équipe lui tire dessus : qu'il tienne jusqu'à l'éclair
  game.enemies = [foe];
  let empty = null, post = null, posts = 0;
  const r = flashEntry(g, w.d, 1, gm => {
    // celui qui tient le poste d'où la flash passe n'en a plus : l'autre, qui en a, prend sa place
    const works = gm.mates.filter(m => gm.flashAimFrom(m.orderPos.x, m.orderPos.y, w.d, 1));
    posts = works.length;
    empty = works[0];
    post = empty && { ...empty.orderPos };
    if (empty) empty.flashbangs = 0;
  });
  ok(r, 'colonne en place');
  eq(posts, 1, 'battant poussé vers la pièce : un seul des deux postes a l’angle');
  ok(r.ordered, 'ordre d’entrée à la flash');
  ok(r.thrower && r.thrower !== empty && dist(r.at.x, r.at.y, post.x, post.y) < 10, 'lancée par l’autre, passé à ce poste');
  eq(r.thrower.flashbangs, MATE_FLASHES - 1, 'une flash de moins');
  near(r.crack, FLASH_CRACK, 0.01, 'porte entrouverte au lancer, pas grande ouverte');
  ok(r.boom && r.boom.across === -1, 'la flash éclate dans la pièce, de l’autre côté de la porte');
  ok(r.boom.progress < 1, 'la porte n’est ouverte en grand qu’après l’éclair');
  ok(r.boom.stunned.includes(foe), 'le suspect de la pièce est aveuglé');
  ok(r.entered && r.open >= 1, 'puis porte grande ouverte : ils entrent');
  g.step(1);
  ok(/Flash 1/.test(g.ui.$('squad').textContent), 'le HUD de l’équipe compte ses flashs');
  // plus une flash dans l'équipe : on le dit, et la colonne attend qu'on ouvre
  const g2 = mkGame({ noEnemyAI: true });
  g2.game.enemies = []; g2.game.hostages = [];
  const w2 = doorWithRoom(g2.game);
  const r2 = flashEntry(g2, w2.d, -1, gm => gm.mates.forEach(m => { m.flashbangs = 0; }));
  ok(r2 && !r2.ordered && !r2.thrower && /Plus de flash/.test(g2.game.message.text), 'sans flash : refus annoncé');
  ok(g2.game.stack && w2.d.progress === 0, 'la colonne attend toujours');
  // porte verrouillée : on la crochète d'abord, puis tout s'enchaîne
  const g3 = mkGame({ noEnemyAI: true });
  g3.game.enemies = []; g3.game.hostages = [];
  const w3 = doorWithRoom(g3.game);
  w3.d.locked = true;
  const r3 = flashEntry(g3, w3.d, -1);
  ok(r3 && !w3.d.locked && r3.boom && r3.boom.across === 1 && r3.entered, 'porte verrouillée : crochetée, flash, entrée');
});

test('l’entrée à la flash marche par chaque porte intérieure, d’un côté comme de l’autre', () => {
  const fails = [];
  let runs = 0;
  for (const [mode, list] of [['assault', LEVELS], ['escort', ESCORT_LEVELS]]) list.forEach((lvl, li) => {
    const probe = mkGame({ mode, level: li, noEnemyAI: true }).game;
    probe.map.doors.forEach((d0, di) => {
      if (probe.map.breaches.some(b => b.door === d0)) return;
      for (const side of [-1, 1]) {
        const g = mkGame({ mode, level: li, noEnemyAI: true });
        g.game.enemies = []; g.game.hostages = [];
        if (g.game.vip) g.game.vip.alive = false;
        const d = g.game.map.doors[di];
        const r = flashEntry(g, d, side);
        if (!r) continue; // pas la place d'une colonne ici
        runs++;
        if (!(r.boom && r.boom.across === -side && r.entered)) fails.push(`${lvl.name} porte ${di} (${Math.round(d.cx / U)},${Math.round(d.cy / U)}) côté ${side} : ${!r.ordered ? 'pas d’ordre' : !r.boom ? 'pas d’éclair' : r.boom.across !== -side ? 'éclair du mauvais côté' : 'pas d’entrée'}`);
      }
    });
  });
  ok(runs > 40, runs + ' colonnes essayées');
  ok(!fails.length, fails.length + ' échecs : ' + fails.join(' ; '));
});

test('un clic droit sur une porte ouverte reste un ordre de déplacement', () => {
  const g = mkGame({ noEnemyAI: true });
  const game = g.game, p = game.player, inp = game.input;
  game.enemies = [];
  const w = doorWithRoom(game);
  setDoor(w.d, 1);
  p.x = w.a.x; p.y = w.a.y;
  inp.mouse.x = w.d.cx; inp.mouse.y = w.d.cy;
  inp.pressed.Mouse2 = true; inp.mouse.rdown = true; g.step(1);
  inp.mouse.rdown = false; inp.pressed.Mouse2Up = true; g.step(1);
  ok(!game.stack && game.mates.every(m => m.order === 'move'), 'déplacement ordinaire');
});

// ---------------------------------------------------------------- entrée coordonnée de l'intervention (siège)
// La première vague (trois opérateurs aveugles : ni combat ni flash d'eux-mêmes) à deux cases de la porte d, côté side,
// leur dernier contact deux cases derrière elle ; la colonne est forcée (stackOdds), de la manière demandée (pickEntry).
// Plus de vague ensuite, ni otage ni complice ; le joueur, increvable, attend loin de là. null si la place manque.
function aiStack(g, d, side, tactic) {
  const game = g.game, s = game.siege, nx = d.horizontal ? 0 : 1, ny = d.horizontal ? 1 : 0;
  const across = o => Math.sign(d.horizontal ? o.y - d.cy : o.x - d.cx);
  s.prep = 0.01; g.step(2);
  s.wave = s.waves.length;
  game.hostages = [];
  game.mates.forEach(m => { m.alive = false; });
  const start = { x: d.cx + nx * side * 2 * U, y: d.cy + ny * side * 2 * U };
  if (!game.map.circleFree(start.x, start.y, 12, true)) return null;
  const spots = [start, ...freeSpotsAround(game, start, 4).filter(q => across(q) === side)].slice(0, 3);
  if (spots.length < 3) return null;
  const ops = game.enemies.slice(0, 3);
  game.enemies = ops;
  ops.forEach((o, i) => Object.assign(o, { x: spots[i].x, y: spots[i].y, act: null, waitDoor: null, path: [], viewRange: 0, flashCd: 1e9, target: null, alertAngle: null,
    hp: 1e9, maxHp: 1e9, lastKnown: { x: d.cx - nx * side * 2 * U, y: d.cy - ny * side * 2 * U } }));
  const p = game.player;
  p.hp = p.maxHp = 1e9;
  for (let ty = 2; ty < game.map.h - 2; ty++) for (let tx = 2; tx < game.map.w - 2; tx++) {
    const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
    if (dist(x, y, d.cx, d.cy) > 10 * U && game.map.circleFree(x, y, 12, true)) { p.x = x; p.y = y; ty = tx = 1e9; }
  }
  game.stackOdds = () => 1;
  game.pickEntry = () => tactic;
  return { game, ops, across };
}

test('siège : l’intervention se met en colonne sur une porte fermée, l’ouvre et entre', () => {
  const g = mkGame({ mode: 'siege' });
  const w = doorWithRoom(g.game);
  ok(w, 'une porte de test');
  const r = aiStack(g, w.d, -1, 'plain');
  ok(r, 'la place pour trois');
  const { game, ops, across } = r, s = game.hunt;
  let formed = null;
  for (let i = 0; i < 120 && !formed; i++) { game.update(1 / 60); formed = s.stacks[0]; }
  ok(formed && formed.door === w.d, 'une colonne se forme devant la porte');
  ok(formed.team.length === 3 && ops.every(o => o.entry === formed), 'les trois en sont');
  let ready = false, opener = null;
  const doorAction = game.doorAction.bind(game);
  game.doorAction = (a, d, t) => {
    if (d === w.d && t > 0 && !opener) {
      opener = a;
      ready = w.d.progress === 0 && ops.every(o => across(o) === -1 && dist(o.x, o.y, o.orderPos.x, o.orderPos.y) < 10);
    }
    return doorAction(a, d, t);
  };
  for (let i = 0; i < 900 && s.stacks.length; i++) game.update(1 / 60);
  ok(ready, 'chacun à son poste, de son côté, quand la porte s’ouvre');
  ok(!s.stacks.length && ops.includes(opener), 'l’un d’eux a ouvert la porte (' + who(opener) + ')');
  ok(ops.every(o => o.clear), 'chacun a un angle de la pièce à tenir');
  for (let i = 0; i < 300 && !ops.every(o => across(o) === 1); i++) game.update(1 / 60);
  ok(ops.every(o => across(o) === 1), 'tous sont entrés dans la pièce');
});

test('siège : à trois avec une flash, l’intervention la glisse dans la pièce, puis entre', () => {
  const g = mkGame({ mode: 'siege' });
  const w = doorWithRoom(g.game);
  const r = aiStack(g, w.d, -1, 'flash');
  ok(r, 'la place pour trois');
  const { game, ops, across } = r, s = game.hunt;
  // un complice (aveugle lui aussi : il ne tire pas) attend dans la pièce
  const m = game.mates[0];
  Object.assign(m, { alive: true, x: w.b.x, y: w.b.y, viewRange: 0, stun: 0 });
  const flashes = ops.reduce((n, o) => n + o.flashbangs, 0);
  let thrown = null, boom = null, formed = null;
  const spawn = game.spawnFlash.bind(game), det = game.detonateFlash.bind(game);
  game.spawnFlash = (a, x, y, c, via) => { thrown = { by: a, progress: w.d.progress }; spawn(a, x, y, c, via); };
  game.detonateFlash = (x, y, gr) => { det(x, y, gr); boom = { across: across({ x, y }), stunned: m.stun > 0, progress: w.d.progress }; };
  for (let i = 0; i < 1200 && (!formed || s.stacks.length); i++) { game.update(1 / 60); formed = formed || s.stacks[0]; }
  ok(formed && formed.tactic === 'flash', 'colonne pour une entrée à la flash');
  ok(thrown && ops.includes(thrown.by) && thrown.progress > 0, 'un opérateur la lance par la porte entrouverte ou ouverte (' + (thrown && thrown.progress) + ')');
  eq(ops.reduce((n, o) => n + o.flashbangs, 0), flashes - 1, 'une flash de moins dans l’équipe');
  ok(boom && boom.across === 1, 'elle éclate de l’autre côté de la porte');
  ok(boom.stunned, 'le complice qui attendait là est sonné');
  ok(!s.stacks.length && ops.every(o => o.clear || across(o) === 1), 'puis ils entrent');
  for (let i = 0; i < 300 && !ops.every(o => across(o) === 1); i++) game.update(1 / 60);
  ok(ops.every(o => across(o) === 1), 'tous sont dans la pièce');
});

test('siège : l’intervention pose une charge, s’écarte, la fait sauter et entre sur des défenseurs sonnés', () => {
  const g = mkGame({ mode: 'siege' });
  const w = doorWithRoom(g.game);
  const r = aiStack(g, w.d, -1, 'charge');
  ok(r, 'la place pour trois');
  const { game, ops, across } = r, s = game.hunt, p = game.player;
  const nx = w.nx, ny = w.ny;
  const m = game.mates[0];
  Object.assign(m, { alive: true, x: w.b.x, y: w.b.y, viewRange: 0, stun: 0 });
  // le joueur aussi, juste derrière la porte, un peu de côté
  const side = [1, -1].map(k => ({ x: w.b.x + ny * k * U - nx * 0.4 * U, y: w.b.y + nx * k * U - ny * 0.4 * U })).find(q => game.map.circleFree(q.x, q.y, 12, true));
  if (side) { p.x = side.x; p.y = side.y; }
  const carrier = ops.find(o => o.charges > 0);
  ok(carrier, 'un opérateur de la vague porte une charge');
  let placed = null, blast = null, formed = null;
  const det = game.detonateCharge.bind(game);
  game.detonateCharge = c => {
    const near = Math.min(...ops.map(o => dist(o.x, o.y, w.d.cx, w.d.cy)));
    det(c);
    blast = { near, mate: m.stun, player: p.stun, msg: game.message.text, hp: ops.map(o => o.hp) };
  };
  for (let i = 0; i < 1500 && (!formed || s.stacks.length); i++) {
    game.update(1 / 60);
    formed = formed || s.stacks[0];
    placed = placed || game.charges.find(c => c.door === w.d);
  }
  ok(formed && formed.tactic === 'charge', 'colonne pour une entrée à la charge');
  ok(placed && placed.by === carrier && placed.team === 'enemy' && carrier.charges === 0, 'le porteur l’a posée (' + who(placed && placed.by) + ')');
  ok(Math.sign(placed.x - w.d.cx || placed.y - w.d.cy) === -1, 'de leur côté du battant');
  ok(blast, 'mise à feu');
  ok(blast.near > CHARGE_NEAR, 'personne de leur côté à portée du souffle (' + (blast.near / U).toFixed(2) + ' case)');
  ok(blast.hp.every(h => h === 1e9), 'aucun opérateur blessé');
  ok(w.d.broken && w.d.open, 'la porte a sauté');
  ok(blast.mate > 1, 'le complice derrière la porte est sonné');
  if (side) ok(blast.player > 1 && /sonné/.test(blast.msg), 'le joueur aussi, et il le sait');
  ok(!s.stacks.length, 'ils entrent');
  for (let i = 0; i < 300 && !ops.every(o => across(o) === 1); i++) game.update(1 / 60);
  ok(ops.every(o => across(o) === 1), 'tous sont dans la pièce');
});

test('siège : la colonne de l’intervention aboutit par chaque porte intérieure, d’un côté comme de l’autre', () => {
  const fails = [], seen = { plain: 0, flash: 0, charge: 0 };
  let runs = 0;
  LEVELS.forEach((lvl, li) => {
    const probe = mkGame({ mode: 'siege', level: li }).game;
    probe.map.doors.forEach((d0, di) => {
      if (probe.map.breaches.some(b => b.door === d0)) return;
      [-1, 1].forEach((side, k) => {
        // une manière par porte et par côté, à tour de rôle
        const tactic = ['plain', 'flash', 'charge'][(di * 2 + k) % 3];
        const g = mkGame({ mode: 'siege', level: li });
        const d = g.game.map.doors[di];
        const r = aiStack(g, d, side, tactic);
        if (!r) return; // pas la place pour trois
        const { game, ops, across } = r, s = game.hunt;
        let formed = null, blown = false, thrown = false;
        const det = game.detonateCharge.bind(game), sp = game.spawnFlash.bind(game);
        game.detonateCharge = c => { blown = true; det(c); };
        game.spawnFlash = (...a) => { thrown = true; sp(...a); };
        for (let i = 0; i < 2400 && (!formed || s.stacks.includes(formed)); i++) { game.update(1 / 60); formed = formed || s.stacks[0]; }
        if (formed && formed.door !== d) return; // leur chemin passait par une autre porte
        runs++;
        const how = formed && formed.tactic, team = formed ? formed.team : [], inside = new Set();
        for (let j = 0; j < 600 && inside.size < team.length; j++) { game.update(1 / 60); team.forEach(o => { if (across(o) === -side) inside.add(o); }); }
        const why = !formed ? 'pas de colonne' : s.stacks.includes(formed) ? 'colonne bloquée (' + how + ')'
          : how === 'charge' && !blown ? 'charge jamais mise à feu' : how === 'flash' && !thrown ? 'flash jamais lancée'
          : inside.size < team.length ? (team.length - inside.size) + ' resté(s) dehors' : ops.some(o => o.hp < 1e9) ? 'un opérateur blessé' : null;
        if (why) fails.push(`${lvl.name} porte ${di} (${Math.round(d.cx / U)},${Math.round(d.cy / U)}) côté ${side}, ${tactic} : ${why}`);
        else seen[how]++;
      });
    });
  });
  ok(runs > 60, runs + ' colonnes essayées');
  ok(seen.plain && seen.flash && seen.charge, 'les trois manières ont abouti (' + JSON.stringify(seen) + ')');
  ok(!fails.length, fails.length + ' échecs : ' + fails.join(' ; '));
});

test('siège : la colonne reste occasionnelle, et la manière d’entrer dépend des effectifs et du matériel', () => {
  ok(AI_STACK_CHANCE < 1 && AI_STACK_THREAT < 1, 'pas à chaque porte');
  const g = mkGame({ mode: 'siege' });
  const game = g.game, w = doorWithRoom(game), d = w.d;
  ok(game.stackOdds(true) > game.stackOdds(false), 'plus souvent quand la menace est derrière la porte');
  game.siege.prep = 0.01; g.step(2);
  const hostages = game.hostages;
  game.hostages = [];
  const ops = game.enemies.slice(0, 3);
  eq(ops.filter(o => o.charges > 0).length, WAVE_CHARGES, 'chaque vague porte ses charges');
  const draws = (team, n) => {
    const c = { plain: 0, flash: 0, charge: 0 };
    for (let i = 0; i < n; i++) c[game.pickEntry(team, d, false)]++;
    return c;
  };
  ops.forEach((o, i) => { o.flashbangs = 2; o.charges = i ? 0 : 1; });
  const all = draws(ops, 400);
  ok(all.plain && all.flash && all.charge, 'à trois, avec flashs et charge : les trois manières (' + JSON.stringify(all) + ')');
  eq(draws(ops.slice(0, 2), 300).flash, 0, 'à deux : jamais de flash');
  setDoor(d, 0.3);
  eq(draws(ops, 300).charge, 0, 'porte entrebâillée : pas de charge');
  setDoor(d, 0);
  const h = hostages[0];
  Object.assign(h, { x: w.b.x, y: w.b.y, found: true });
  game.hostages = [h];
  eq(draws(ops, 300).charge, 0, 'un otage repéré derrière la porte : pas de charge');
  game.hostages = [];
  ops.forEach(o => { o.charges = 0; });
  eq(draws(ops, 300).charge, 0, 'plus de charge : pas d’entrée à la charge');
  ops.forEach(o => { o.flashbangs = 0; });
  eq(draws(ops, 300).flash, 0, 'plus de flash : pas d’entrée à la flash');
  // seul devant la porte, un opérateur l'ouvre en passant
  const g2 = mkGame({ mode: 'siege' });
  const w2 = doorWithRoom(g2.game);
  const r = aiStack(g2, w2.d, -1, 'plain');
  ok(r, 'la place');
  r.ops.slice(1).forEach(o => { o.alive = false; });
  let formed = false;
  for (let i = 0; i < 240 && w2.d.progress === 0; i++) { r.game.update(1 / 60); formed = formed || r.game.hunt.stacks.length > 0; }
  ok(!formed && w2.d.progress > 0, 'seul : pas de colonne, il ouvre lui-même');
});

// ---------------------------------------------------------------- poignée, chargeur, gilet
test('poignée avant : la rafale s’ouvre moins ; chargeur long : plus de coups avant de recharger', () => {
  ok(fittedDef('mp7', { grip: true }) === WEAPONS.mp7 && fittedDef('usp45', { mag: true }) === WEAPONS.usp45, 'refusés là où ils ne vont pas');
  const drum = fittedDef('akP', { mag: true });
  ok(drum.mag === 75 && drum.tint.extMag === 'drum' && drum.reload > WEAPONS.akP.reload, 'AKM : tambour de 75');
  eq(fittedDef('m870', { mag: true }).mag, 8, 'Remington : rallonge de deux cartouches');
  // dix coups en rafale, avec et sans poignée : l'ouverture accumulée est moindre
  const bloomAfter = acc => {
    const g = mkGame({ alone: true, loadout: { primary: 'hk416', sidearm: 'glock17', acc: { hk416: acc } } });
    const p = g.game.player;
    for (let i = 0; i < 10; i++) g.game.fireWeapon(p);
    return { bloom: p.bloom, mag: p.slot.mag };
  };
  const nu = bloomAfter({}), tenu = bloomAfter({ grip: true });
  ok(tenu.bloom < nu.bloom * 0.9, 'moins d’ouverture avec la poignée : ' + (tenu.bloom / DEG).toFixed(1) + '° contre ' + (nu.bloom / DEG).toFixed(1) + '°');
  eq(bloomAfter({ mag: true }).mag, 30, 'chargeur de 40 : il en reste trente après dix coups');
});

test('gilet : le souple arrête les balles d’arme de poing, le lourd celles de fusil de face ou de dos, et il ralentit', () => {
  const g = mkGame({ alone: true });
  const game = g.game, p = game.player;
  eq(p.vest, VESTS.vestL, 'gilet souple par défaut en assaut');
  eq(Game.normLoadout({ primary: 'akP', sidearm: 'makarovP', vest: 'vestH' }, MODES.siege).vest, null, 'pas de gilet en siège');
  p.angle = 0;
  // ang : sens de la course de la balle (de face, elle va vers l'ouest)
  const hit = (pen, ang) => game.vestHit(p, { pen }, ang, 100);
  near(hit(1, Math.PI), 50, 1e-9, 'pistolet de face : le choc seul');
  near(hit(1, Math.PI / 2), 50, 1e-9, 'de flanc aussi : le souple fait le tour');
  eq(hit(3, Math.PI), 100, 'une balle de fusil le traverse');
  p.equip({ ...game.loadout, vest: 'vestH' });
  near(hit(3, Math.PI), 30, 1e-9, 'plaque avant : la balle de fusil s’arrête');
  near(hit(3, 0), 30, 1e-9, 'plaque dorsale aussi');
  eq(hit(3, Math.PI / 2), 100, 'de flanc, pas de plaque');
  near(hit(1, Math.PI / 2), 50, 1e-9, 'mais le souple dessous arrête le pistolet');
  // de vraies balles : un pistolet de face sur le gilet souple
  p.equip({ ...game.loadout, vest: 'vestL' });
  const spot = reachableSpot(game, p, 2.5 * U, 3.5 * U, true);
  ok(spot, 'un tireur en vue');
  p.angle = Math.atan2(spot.y - p.y, spot.x - p.x);
  const foe = new Enemy(spot.x, spot.y, p.angle + Math.PI, 'pistol');
  game.enemies = [foe];
  let n = 0;
  for (let k = 0; k < 4; k++) { foe.bloom = 0; game.fireWeapon(foe); n++; }
  for (let i = 0; i < 40 && game.bullets.length; i++) game.updateBullets(1 / 60);
  near((p.maxHp - p.hp) / n, WEAPONS.pistolE.damage * VESTS.vestL.blunt, 0.01, 'chaque balle ne fait que la moitié de ses dégâts');
  game.enemies = [];
  // le gilet lourd ralentit
  const course = vest => {
    p.equip({ ...game.loadout, vest });
    p.x = spot.x; p.y = spot.y; p.walkMode = false;
    const x0 = p.x, y0 = p.y;
    const ang = Math.atan2(game.map.h * TILE / 2 - p.y, game.map.w * TILE / 2 - p.x);
    game.input.keys = { [Math.cos(ang) > 0 ? 'KeyD' : 'KeyA']: true };
    for (let i = 0; i < 20; i++) game.update(1 / 60);
    game.input.keys = {};
    return dist(x0, y0, p.x, p.y);
  };
  const leger = course('vestL'), lourd = course('vestH');
  ok(lourd > 0 && lourd < leger * 0.9, 'plus lent avec les plaques : ' + lourd.toFixed(1) + ' px contre ' + leger.toFixed(1));
});

// ---------------------------------------------------------------- rondes et alerte générale
test('rondes : un suspect fait le tour de ses points, au pas, et reprend sa ronde après être allé voir', () => {
  const g = mkGame({ patrols: true });
  const game = g.game;
  eq(game.enemies.filter(o => o.patrol).length, PATROLS, PATROLS + ' suspects en ronde');
  const e = game.enemies.find(o => o.patrol), P = e.patrol;
  ok(P.pts.length >= 2 && P.pts.length <= 3, 'deux ou trois points');
  ok(dist(P.pts[0].x, P.pts[0].y, e.x, e.y) < 1, 'son poste en fait partie');
  const b = game.map.breaches[game.entryIndex], room = game.map.roomOf(b.inside.x, b.inside.y);
  ok(P.pts.every(q => !room.has(Math.floor(q.y / TILE) * game.map.w + Math.floor(q.x / TILE))), 'aucun point dans la pièce d’entrée');
  game.enemies = [e]; e.viewRange = 0; // il ne voit personne : on suit sa ronde seule
  game.mates.forEach(m => { m.alive = false; });
  P.wait = 0;
  const seen = new Set();
  let top = 0;
  for (let i = 0; i < 90 * 60 && seen.size < P.pts.length + 1; i++) {
    const x0 = e.x, y0 = e.y;
    game.update(1 / 60);
    if (e.moving && !e.act) top = Math.max(top, dist(x0, y0, e.x, e.y) * 60);
    P.pts.forEach((q, k) => { if (dist(e.x, e.y, q.x, q.y) < 0.6 * U) seen.add(k); });
    if (seen.size === P.pts.length && dist(e.x, e.y, P.pts[0].x, P.pts[0].y) < 0.6 * U && P.i === 0) seen.add('tour');
  }
  ok(seen.size > P.pts.length, 'il a fait le tour complet (' + [...seen].join(', ') + ')');
  ok(top > 0 && top <= e.speed * PATROL_SPEED + 2, 'au pas : ' + top.toFixed(0) + ' px/s');
  // un bruit : il va voir, puis regagne sa ronde
  const spot = reachableSpot(game, e, 2 * U, 4 * U, false);
  ok(spot, 'un endroit où aller voir');
  game.investigate(e, spot.x, spot.y, 1);
  let back = false;
  for (let i = 0; i < 40 * 60 && !back; i++) {
    game.update(1 / 60);
    back = e.state === 'idle' && P.going && e.moving;
  }
  ok(back, 'après sa recherche, il repart sur sa ronde');
  ok(P.pts.some(q => q.x === e.home.x && q.y === e.home.y), 'son poste suit la ronde');
});

// Un suspect face au joueur, qui le voit, et deux autres loin de là. Le joueur ne tombe pas.
function alarmScene() {
  const g = mkGame({ alone: true, alarm: true });
  const game = g.game, p = game.player;
  p.hp = p.maxHp = 1e9;
  const spot = freeSpotsAround(game, p, 40).find(q => dist(q.x, q.y, p.x, p.y) >= 2 * U);
  const e = new Enemy(spot.x, spot.y, Math.atan2(p.y - spot.y, p.x - spot.x), 'pistol');
  const far = game.buildPosts(null, 30).filter(q => dist(q.x, q.y, p.x, p.y) > 9 * U).slice(0, 3);
  const others = far.map(q => { const o = new Enemy(q.x, q.y, 0, 'ak'); o.viewRange = 0; return o; });
  game.enemies = [e, ...others];
  game.input.mouse.x = e.x; game.input.mouse.y = e.y;
  return { g, game, p, e, others };
}

test('alerte générale : un suspect qui tient trois secondes après vous avoir vu prévient tout le bâtiment', () => {
  const { game, e, others } = alarmScene();
  eq(others.length, 3, 'trois suspects loin de là');
  for (let i = 0; i < 60; i++) game.update(1 / 60);
  ok(e.spotT !== null && !game.alarm, 'il vous a vu, l’alerte n’est pas encore donnée');
  const react = others[0].reaction;
  for (let i = 0; i < (ALARM_TIME + 0.5) * 60 && !game.alarm; i++) game.update(1 / 60);
  ok(game.alarm && game.alarm.by === e, 'au bout de trois secondes, il donne l’alerte');
  ok(others.every(o => o.alerted && o.reaction < react), 'tous sont prévenus et réagiront plus vite');
  const going = others.filter(o => o.state === 'investigate').length;
  ok(going >= 1 && going <= RESPONDERS, going + ' vont voir, pas plus de ' + RESPONDERS);
  ok(game.scoreReport('win').lines.some(l => /Alerte générale/.test(l.label)), 'la note de fin le retient');
});

test('alerte générale : abattu ou sonné à temps, il ne prévient personne', () => {
  const sc = alarmScene();
  for (let i = 0; i < 60; i++) sc.game.update(1 / 60);
  sc.game.damage(sc.e, 1000, sc.p, 0);
  for (let i = 0; i < (ALARM_TIME + 1) * 60; i++) sc.game.update(1 / 60);
  ok(!sc.game.alarm, 'abattu au bout d’une seconde : pas d’alerte');
  const sc2 = alarmScene();
  for (let i = 0; i < 60; i++) sc2.game.update(1 / 60);
  sc2.e.stun = 4; // une flash
  for (let i = 0; i < 3.5 * 60; i++) sc2.game.update(1 / 60);
  ok(!sc2.game.alarm, 'sonné, le temps ne compte pas');
  for (let i = 0; i < (ALARM_TIME + 1) * 60 && !sc2.game.alarm; i++) sc2.game.update(1 / 60);
  ok(sc2.game.alarm, 'revenu à lui, il finit par la donner');
});

// ---------------------------------------------------------------- trinômes
test('trinômes : deux trinômes par camp ; le vôtre par l’ouverture choisie, ceux d’en face par des ouvertures hors de vue', () => {
  for (const mode of ['squads', 'squadsArmed']) for (let lvl = 0; lvl < LEVELS.length; lvl++) {
    const g = mkGame({ mode, level: lvl });
    const game = g.game, map = game.map, tag = mode + ' / ' + LEVELS[lvl].name, police = mode === 'squads';
    const b0 = map.breaches[game.entryIndex];
    const crew = game.mates.filter(m => !m.hunter), auto = game.mates.filter(m => m.hunter);
    ok(crew.length === 2 && crew.every(m => m instanceof Teammate && m.order === 'follow'), tag + ' : deux coéquipiers à vos ordres');
    ok(auto.length === 3 && auto.every(m => m.team === 'ops' && m.group === auto[0].group && m.name), tag + ' : un second trinôme autonome, nommé');
    eq(game.enemies.length, 6, tag + ' : six en face');
    const groups = [...new Set(game.enemies.map(e => e.group))];
    ok(groups.length === 2 && groups.every(gr => gr && gr.members.length === 3 && gr.team === 'enemy'), tag + ' : en deux trinômes');
    eq(game.hostages.length, 0, tag + ' : pas d’otage');
    eq(game.squadSize, 6, tag + ' : six de votre côté');
    ok(police ? game.enemies.every(e => !(e instanceof Operator) && e.nade === 'frag') : game.enemies.every(e => e instanceof Operator && e.flashbangs > 0),
      tag + ' : l’autre camp en face');
    ok(police ? auto.every(m => m instanceof Operator) : auto.every(m => !(m instanceof Operator) && m.nade === 'frag' && m.style), tag + ' : votre second trinôme est de votre camp');
    eq(game.player.nade, police ? 'flash' : 'frag', tag + ' : vos grenades');
    eq(game.player.charges, police ? CHARGES : 0, tag + ' : vos charges');
    const hidden = b => !map.hasLOS(b.inside.x, b.inside.y, b0.inside.x, b0.inside.y) || dist(b.inside.x, b.inside.y, b0.inside.x, b0.inside.y) > SQUAD_APART;
    ok(groups.every(gr => gr.breach !== b0 && hidden(gr.breach)), tag + ' : l’adversaire n’entre pas en vue de votre ouverture');
    // (le joueur et ses coéquipiers partent comme en assaut ; les trinômes autonomes, eux, sont placés ici)
    const all = [...game.ops, ...game.enemies], placed = all.filter(a => a.group);
    ok(placed.every(a => map.circleFree(a.x, a.y, 10, false)), tag + ' : chacun à une place libre');
    ok(all.every((a, i) => all.every((b, j) => j <= i || dist(a.x, a.y, b.x, b.y) >= 18)), tag + ' : personne l’un sur l’autre');
  }
});

test('trinômes : vos ordres ne vont qu’à votre trinôme ; l’autre progresse seul, et le HUD le montre', () => {
  const g = mkGame({ mode: 'squads' });
  const game = g.game;
  game.enemies = [];
  const auto = game.mates.filter(m => m.hunter), crew = game.crew;
  const start = auto.map(m => ({ x: m.x, y: m.y }));
  g.press('KeyT');
  ok(crew.every(m => m.order === 'hold'), 'T : votre trinôme tient');
  ok(auto.every(m => m.order === undefined), 'le second trinôme ne prend pas d’ordre');
  let far = 0;
  const reach = auto.map(() => 0);
  for (let i = 0; i < 60 * 20; i++) {
    game.update(1 / 60);
    const spread = Math.max(...auto.map(a => Math.max(...auto.map(b => dist(a.x, a.y, b.x, b.y)))));
    if (spread > SQUAD_SPREAD + 2 * U) far++;
    auto.forEach((m, k) => { reach[k] = Math.max(reach[k], dist(m.x, m.y, start[k].x, start[k].y)); });
  }
  ok(reach.every(d => d > 4 * U), 'il a progressé dans le bâtiment (' + reach.map(d => (d / U).toFixed(1)).join(', ') + ' cases)');
  ok(far < 60 * 4, 'il reste groupé (dispersé ' + (far / 60).toFixed(1) + ' s sur 20)');
  g.step(1);
  const rows = [...document.querySelectorAll('#squad .mate')];
  eq(rows.length, 5, 'cinq lignes dans le HUD de l’équipe');
  eq(rows.filter(r => r.classList.contains('auto')).length, 3, 'le second trinôme à part');
  ok(/Adversaires : 0 \/ 0 · Votre camp : 6 \/ 6/.test(document.getElementById('objective').textContent), 'objectif : qui reste debout de chaque côté');
});

test('trinômes : le second trinôme de votre camp tire sur l’adversaire et partage ce qu’il apprend', () => {
  const g = mkGame({ mode: 'squads' });
  const game = g.game;
  const [a, b] = game.mates.filter(m => m.hunter), grp = a.group;
  const foe = game.enemies[0];
  game.enemies = [foe];
  Object.assign(foe, { viewRange: 0, hp: 1e6, maxHp: 1e6 });
  const spot = freeSpotsAround(game, a, 16).find(q => dist(q.x, q.y, a.x, a.y) > 2 * U);
  ok(spot, 'une place en vue');
  foe.x = spot.x; foe.y = spot.y;
  a.angle = Math.atan2(foe.y - a.y, foe.x - a.x);
  let shots = 0;
  const fire = game.fireWeapon.bind(game);
  game.fireWeapon = s => { if (s === a) shots++; fire(s); };
  for (let i = 0; i < 120 && !shots; i++) game.update(1 / 60);
  ok(shots > 0, 'il tire sur l’homme d’en face');
  ok(grp.contact && dist(grp.contact.x, grp.contact.y, foe.x, foe.y) < U, 'son trinôme sait où il est');
  // ce qu'il entend de l'adversaire, son trinôme le sait ; ce qu'il entend des siens ne l'égare pas
  grp.contact = null;
  for (const o of grp.members) { o.lastKnown = null; o.target = null; o.stun = 0; }
  game.noise(game.player.x, game.player.y, 14 * U, game.player, 'shot');
  eq(grp.contact, null, 'vos coups de feu ne les trompent pas');
  game.noise(foe.x, foe.y, 14 * U, foe, 'shot');
  ok(grp.contact && b.group === grp, 'un coup de feu d’en face entendu : le trinôme sait d’où');
});

test('trinômes : en face aussi, une balle touche qui se trouve sur sa trajectoire, ami ou ennemi', () => {
  const shoot = mode => {
    const g = mkGame({ mode });
    const game = g.game;
    const [e1, e2] = game.enemies;
    game.enemies = [e1, e2]; // personne d'autre sur la trajectoire
    game.ops.forEach(o => { o.x = e1.x - 6 * U; o.y = e1.y; });
    const s = freeSpotsAround(game, e1, 12).find(q => dist(q.x, q.y, e1.x, e1.y) > 1.5 * U);
    e2.x = s.x; e2.y = s.y; e2.hp = e2.maxHp = 1e6;
    const a = Math.atan2(e2.y - e1.y, e2.x - e1.x);
    game.bullets = [{ x: e1.x + Math.cos(a) * 14, y: e1.y + Math.sin(a) * 14, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, team: 'enemy', damage: 20, life: 1, shooter: e1, ox: e1.x, oy: e1.y, trail: 10, pierce: 0.4, pierced: 0, breach: 0, pen: 1 }];
    for (let i = 0; i < 10; i++) game.updateBullets(1 / 60);
    return e2.hp < e2.maxHp;
  };
  ok(shoot('squads'), 'trinômes : la balle d’en face touche l’un des siens');
  ok(!shoot('assault'), 'assaut : les suspects ne se touchent pas entre eux (inchangé)');
});

test('trinômes : à votre mort, la main passe à votre trinôme puis à l’autre ; le dernier camp debout l’emporte', () => {
  const g = mkGame({ mode: 'squads', noEnd: false });
  const game = g.game;
  game.enemies.forEach(e => { Object.assign(e, { viewRange: 0, hp: 1e9, maxHp: 1e9 }); });
  const foe = game.enemies[0];
  const kill = (a, by) => game.damage(a, 1e10, by || foe, 0);
  const crew = game.crew, auto = game.mates.filter(m => m.hunter), grp = auto[0].group;
  for (let k = 0; k < 2; k++) {
    kill(game.player);
    g.step(Math.ceil(RELAY_DELAY * 60) + 2);
    ok(crew.includes(game.player), 'relais ' + (k + 1) + ' : un coéquipier de votre trinôme (' + who(game.player) + ')');
  }
  kill(game.player);
  g.step(Math.ceil(RELAY_DELAY * 60) + 2);
  const p = game.player;
  ok(auto.includes(p) && !p.hunter && !p.group, 'votre trinôme tombé, un homme de l’autre prend la main (' + who(p) + ')');
  ok(!grp.members.includes(p), 'il quitte la manœuvre autonome');
  ok(p.weapon.name === 'HK416 A5' || p.weapon.name === 'HK MP5A3', 'avec son arme');
  ok(Number.isFinite(p.slot.mag), 'chargeur fini, comme une arme ramassée');
  ok(!game.over, 'la partie continue');
  game.enemies.forEach(e => kill(e, p));
  g.step(2);
  eq(game.over, 'win', 'plus personne en face : c’est gagné');
  g.ui.showEnd('win');
  ok(/Engagement remporté/.test(g.ui.panel.textContent) && /Adversaires neutralisés/.test(g.ui.panel.textContent), 'écran de fin du mode');
  const g2 = mkGame({ mode: 'squadsArmed', noEnd: false });
  g2.game.ops.forEach(o => g2.game.damage(o, 1e10, g2.game.enemies[0], 0));
  g2.step(2);
  eq(g2.game.over, 'lose', 'tout votre camp à terre : c’est perdu');
  ok(/trinômes/.test(g2.game.loseReason), 'raison affichée');
  ok(g2.game.score.lines.some(l => /Engagement/.test(l.label)) && g2.game.score.total <= 49, 'note de fin du mode');
});

test('trinômes : le groupe armé ne se met pas en colonne, et sa grenade ne part jamais près des siens', () => {
  const g = mkGame({ mode: 'squads' });
  const game = g.game, map = game.map;
  const [mil, bud] = game.enemies;
  ok(mil.hunter && !mil.drilled && mil.flashbangs === 2, 'un homme du groupe armé : autonome, pas entraîné à la colonne, deux grenades');
  ok(game.ops.filter(o => o.hunter).every(o => o.drilled), 'l’intervention, si');
  // un lancer dégagé de cinq cases
  let s = null;
  for (let ty = 2; ty < map.h - 2 && !s; ty++) for (let tx = 2; tx < map.w - 2 && !s; tx++) {
    const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
    if (map.circleFree(x, y, 12, true) && map.circleFree(x + 5 * U, y, 12, true) && game.clearThrow(x, y, x + 5 * U, y)) s = { x, y };
  }
  ok(s, 'un lancer dégagé');
  game.enemies = [mil, bud];
  game.ops.forEach(o => { o.alive = false; }); // personne pour l'abattre pendant le geste
  Object.assign(mil, { x: s.x, y: s.y, act: null, flashCd: 0, lastKnown: { x: s.x + 5 * U, y: s.y } });
  Object.assign(bud, { x: s.x + 5 * U, y: s.y + U });
  ok(!game.maybeFlash(mil, 1 / 60) && !mil.act, 'un équipier près du point visé : pas de grenade');
  bud.alive = false; mil.flashCd = 0;
  mil.lastKnown = { x: s.x + 3 * U, y: s.y };
  ok(!game.maybeFlash(mil, 1 / 60) && !mil.act, 'trop près de lui : pas de grenade non plus');
  mil.lastKnown = { x: s.x + 5 * U, y: s.y }; mil.flashCd = 0;
  ok(game.maybeFlash(mil, 1 / 60) && mil.act && mil.act.type === 'grenade', 'voie libre, à bonne distance : il dégoupille');
  for (let i = 0; i < 40; i++) game.update(1 / 60);
  ok(game.grenades.some(gr => gr.kind === 'frag' && gr.thrower === mil), 'une grenade à fragmentation');
});

test('trinômes : le groupe armé vient équipé — silencieux, laser, poignée, chargeur long —, pas celui du siège', () => {
  ok(!accFits('akP', 'sup', MODES.siege) && accFits('akP', 'sup', MODES.squadsArmed), 'AKM : silencieux en trinômes seulement');
  ok(accFits('akP', 'mag', MODES.siege), 'le tambour reste en siège');
  ok(accFits('skorpionP', 'sup', MODES.squadsArmed) && !accFits('skorpionP', 'laser', MODES.squadsArmed), 'Škorpion : un silencieux, pas de rail');
  const kit = { primary: 'akP', sidearm: 'makarovP', acc: { akP: { sup: true, grip: true, mag: true } } };
  const ls = Game.normLoadout(kit, MODES.siege).acc.akP, lt = Game.normLoadout(kit, MODES.squadsArmed).acc.akP;
  ok(!ls.sup && !ls.grip && ls.mag, 'en siège, seul le tambour reste monté');
  ok(lt.sup && lt.grip && lt.mag, 'en trinômes, tout reste');
  const pbs = fittedDef('akP', { sup: true, laser: true, grip: true });
  ok(pbs.suppressed && pbs.noise <= WEAPONS.akP.noise / 4 && pbs.damage < WEAPONS.akP.damage, 'PBS-1 : munition subsonique, presque muette, un peu moins forte');
  ok(pbs.laser && pbs.grip && pbs.bloom < WEAPONS.akP.bloom && pbs.weight > WEAPONS.akP.weight + 0.8, 'garde-main à rails : laser et poignée, qui pèsent');
  eq(fittedDef('skorpionP', { sup: true }).damage, WEAPONS.skorpionP.damage, 'le 7,65 Browning est subsonique d’origine : rien de perdu');
  // les hommes du groupe armé que mène l'IA en portent, dans un camp comme dans l'autre ; l'intervention, non
  for (const mode of ['squads', 'squadsArmed']) {
    const game = mkGame({ mode }).game;
    const armed = mode === 'squads' ? game.enemies : game.mates.filter(m => m.hunter);
    const police = mode === 'squads' ? game.mates.filter(m => m.hunter) : game.enemies;
    ok(armed.every(a => a.weapon.acc && Object.values(a.weapon.acc).some(Boolean)), mode + ' : chacun au moins un accessoire');
    ok(armed.every(a => a.weapon.mag === Infinity && a.slot.mag === Infinity && a.burstLeft === a.weapon.burst), mode + ' : chargeur sans fin, rafale prête');
    ok(police.every(a => !a.weapon.acc), mode + ' : les opérateurs n’en ont pas de plus');
  }
  // ramassée sur un corps, l'arme garde ce qu'elle porte, avec un vrai chargeur
  const got = mkGame({ alone: true }).game.pickupSlot({ def: fittedDef('akH', { sup: true, mag: true }), mag: Infinity, reserve: 0 });
  eq(got.def, fittedDef('akP', { sup: true, mag: true }), 'un AKM au PBS-1 et au tambour');
  eq(got.mag, 75, 'tambour plein');
  // un laser de l'IA aide à tirer en marchant, mais il se voit
  const g = mkGame({ mode: 'squads' });
  const game = g.game, e = game.enemies[0];
  const far = a => freeSpotsAround(game, a, 16).find(q => dist(q.x, q.y, a.x, a.y) > 1.5 * U);
  const o = game.mates.find(m => m.hunter && far(m));
  ok(o, 'un opérateur avec de la place autour de lui');
  game.enemies = [e];
  game.ops.forEach(a => { if (a !== o) a.alive = false; }); // personne d'autre dans le faisceau
  e.slot = { def: fittedDef('akH', { laser: true }), mag: Infinity, reserve: 0 };
  e.moving = true;
  const lit = game.spreadOf(e);
  e.laserOn = false;
  const off = game.spreadOf(e);
  e.laserOn = true; e.moving = false;
  ok(lit < off, 'laser allumé : moins de dispersion en marchant');
  const spot = far(o);
  e.x = spot.x; e.y = spot.y;
  e.angle = Math.atan2(o.y - e.y, o.x - e.x);
  o.angle = Math.atan2(e.y - o.y, e.x - o.x);
  o.alertAngle = null; o.laserT = 0;
  game.beams = [e, o].map(a => game.laserBeam(a)).filter(Boolean);
  ok(game.beams.length === 1 && game.beams[0].from === e && game.beams[0].on === o, 'son faisceau va jusqu’à l’opérateur');
  game.spotLaser(o, 1 / 60);
  ok(o.alertAngle !== null && Math.abs(angleDiff(o.alertAngle, o.angle)) < 0.05, 'l’opérateur qui le voit se tourne vers sa source');
  g.step(1);
  ok(game.beams.some(b => b.from === e), 'il compte parmi les faisceaux de la partie (dessinés là où on les voit)');
});

test('trinômes : au briefing, le groupe armé monte silencieux, laser et poignée sur ses AK ; en siège, non', () => {
  // le briefing enregistre l'équipement : on remet celui du joueur en sortant
  const KEYS = ['breach.loadout.siege', 'breach.loadout.squadsArmed'], sauve = {};
  try { KEYS.forEach(k => { sauve[k] = localStorage.getItem(k); }); } catch (e) { /* stockage indisponible */ }
  try {
    const acc = (ui, k, a) => ui.panel.querySelector('.accbtn[data-key="' + k + '"][data-acc="' + a + '"]');
    const gs = mkGame({ mode: 'siege', loadout: { primary: 'akP', sidearm: 'makarovP' } });
    gs.ui.showBriefing();
    ok(['sup', 'laser', 'light', 'grip'].every(a => acc(gs.ui, 'akP', a).disabled), 'siège : ni silencieux ni rails sur l’AKM');
    ok(/trinômes/.test(acc(gs.ui, 'akP', 'sup').title), 'et la bulle dit pourquoi');
    ok(!acc(gs.ui, 'akP', 'mag').disabled, 'le tambour, si');
    gs.ui.hideOverlay();
    const gt = mkGame({ mode: 'squadsArmed', loadout: { primary: 'akP', sidearm: 'makarovP' } });
    gt.ui.showBriefing();
    for (const a of ['sup', 'laser', 'grip']) acc(gt.ui, 'akP', a).click();
    const w = gt.game.player.slots[0].def;
    ok(w.suppressed && w.laser && w.grip, 'trinômes : l’AKM au silencieux, au laser et à la poignée');
    ok(/subsonique/.test(gt.ui.$('wdetail').textContent), 'la fiche annonce la munition subsonique');
    const txt = gt.ui.panel.textContent;
    ok(/Complices/.test(txt) && gt.game.crew.every(m => txt.includes(m.name + ' : ' + m.weapon.name)), 'l’arme de chaque complice, et ce qu’elle porte');
    gt.ui.hideOverlay();
  } finally {
    try { KEYS.forEach(k => { if (sauve[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, sauve[k]); }); } catch (e) { /* idem */ }
  }
});

test('trinômes : un seul bouton de mode ; le camp se choisit au briefing, avec son équipement', () => {
  const saved = localStorage.getItem('breach.mode');
  try {
    const g = mkGame({ mode: 'squads' });
    const ui = g.ui, game = g.game;
    ui.showBriefing();
    const btn = ui.panel.querySelector('.modebtn[data-mode="squads"]');
    ok(btn && btn.classList.contains('sel'), 'le bouton des trinômes');
    ok(!ui.panel.querySelector('.modebtn[data-mode="squadsArmed"]'), 'pas de second bouton pour l’autre camp');
    const camps = [...ui.panel.querySelectorAll('.campbtn')];
    ok(camps.length === 2 && camps.find(b => b.dataset.mode === 'squads').classList.contains('sel'), 'les deux camps, l’intervention retenue');
    ok(ui.panel.querySelectorAll('.entrybtn').length > 1, 'le choix de l’ouverture');
    ok(ui.panel.querySelectorAll('.vestbtn').length === 2 && /Engager/.test(ui.panel.querySelector('#ovGo').textContent), 'gilets, et « Engager »');
    camps.find(b => b.dataset.mode === 'squadsArmed').click();
    eq(game.mode, 'squadsArmed', 'groupe armé');
    ok(ui.panel.querySelector('.modebtn[data-mode="squads"]').classList.contains('sel'), 'toujours le même bouton de mode');
    const cards = [...ui.panel.querySelectorAll('.wcard')].map(b => b.dataset.key);
    ok(cards.length && cards.every(k => MODES.squadsArmed.primaries.includes(k) || MODES.squadsArmed.sidearms.includes(k)), 'l’équipement du groupe armé');
    eq(ui.panel.querySelectorAll('.vestbtn').length, 0, 'pas de gilet de ce côté');
    eq(game.player.nade, 'frag', 'des grenades à fragmentation');
    ok(game.enemies.every(e => e instanceof Operator), 'l’intervention en face');
  } finally {
    if (saved === null) localStorage.removeItem('breach.mode'); else localStorage.setItem('breach.mode', saved);
  }
});

// ---------------------------------------------------------------- escorte
const keyOf = (map, a) => Math.floor(a.y / TILE) * map.w + Math.floor(a.x / TILE);

test('escorte : chaque carte a son point A, sa zone B, un chemin de l’un à l’autre et ses terroristes', () => {
  ok(ESCORT_LEVELS.length >= 3, 'trois cartes d’escorte au moins');
  for (const l of ESCORT_LEVELS) {
    const map = new GameMap(l);
    ok(map.vipStart, l.name + ' : un point A');
    ok(map.goal && map.goal.cells.length >= 15, l.name + ' : une zone B assez grande');
    ok(map.goal.cells.every(c => !map.blocksMove(c.x, c.y)), l.name + ' : la zone B est praticable');
    const ax = (map.vipStart.x + 0.5) * TILE, ay = (map.vipStart.y + 0.5) * TILE;
    ok(map.circleFree(ax, ay, 12, true), l.name + ' : le point A est dégagé');
    const room = map.roomOf(ax, ay);
    ok(!map.goal.cells.some(c => room.has(c.y * map.w + c.x)), l.name + ' : A et B sont dans des pièces différentes');
    ok(!map.enemySpawns.some(s => room.has(s.y * map.w + s.x)), l.name + ' : la carte ne poste personne dans la pièce du point A');
    eq(map.hostageSpawns.length, 0, l.name + ' : pas d’otage, seulement le VIP');
    ok(map.enemySpawns.length >= 9, l.name + ' : ' + map.enemySpawns.length + ' terroristes');
    const c = map.goal.cells[Math.floor(map.goal.cells.length / 2)];
    const route = map.routeTo(ax, ay, c.x, c.y, 9);
    ok(route && route.length, l.name + ' : un chemin mène de A à B');
    // et il traverse des pièces tenues : plusieurs portes à passer
    const doors = new Set(route.map(q => map.door(Math.floor(q.x / TILE), Math.floor(q.y / TILE))).filter(Boolean));
    ok(doors.size >= 3, l.name + ' : ' + doors.size + ' portes sur le plus court chemin');
    // le VIP suit en file : chaque porte intérieure se franchit tout droit, sans meuble à frôler sur une case de part et d'autre
    for (const d of map.doors) {
      if (map.breaches.some(b => b.door === d)) continue;
      const nx = d.horizontal ? 0 : 1, ny = d.horizontal ? 1 : 0;
      for (let t = -U; t <= U; t += 2) ok(map.circleFree(d.cx + nx * t, d.cy + ny * t, 10, false), l.name + ' : porte ' + d.x / 2 + ',' + d.y / 2 + ' dégagée');
    }
  }
  for (const l of LEVELS) { const map = new GameMap(l); ok(!map.vipStart && !map.goal, l.name + ' : ni A ni B hors escorte'); }
});

test('escorte : le VIP part du point A avec l’équipe, personne n’attend dans sa pièce ni près du point B', () => {
  for (let i = 0; i < ESCORT_LEVELS.length; i++) for (let n = 0; n < 3; n++) {
    const { game } = mkGame({ mode: 'escort', level: i });
    const map = game.map, v = game.vip, p = game.player, where = ESCORT_LEVELS[i].name;
    eq(game.def, ESCORT_LEVELS[i], where + ' : la carte d’escorte');
    ok(v instanceof Vip && game.hostages.includes(v), where + ' : le VIP est là, parmi les civils');
    near(v.x, (map.vipStart.x + 0.5) * TILE, 1, where + ' : au point A');
    near(v.y, (map.vipStart.y + 0.5) * TILE, 1, where + ' : au point A');
    eq(v.escort, p, where + ' : il suit le joueur dès le départ');
    ok(game.escort && !game.escort.safe && !game.siege, where + ' : partie d’escorte en cours');
    const room = map.roomOf(v.x, v.y);
    ok(room.has(keyOf(map, p)) && game.mates.every(m => m.alive && room.has(keyOf(map, m))), where + ' : l’équipe démarre avec lui');
    ok(game.enemies.every(e => !room.has(keyOf(map, e))), where + ' : personne dans la pièce du point A');
    ok(game.enemies.every(e => map.goal.cells.every(c => dist(e.x, e.y, (c.x + 0.5) * TILE, (c.y + 0.5) * TILE) >= GOAL_MARGIN)), where + ' : personne collé au point B');
    eq(game.enemies.length, map.enemySpawns.length, where + ' : tous les terroristes postés');
    for (const a of [...game.enemies, ...game.mates]) {
      ok(map.circleFree(a.x, a.y, 11, false), where + ' : poste libre');
      ok(map.routeTo(p.x, p.y, a.tx, a.ty, 11), where + ' : chacun est joignable');
    }
    ok(Math.abs(angleDiff(p.angle, Math.atan2(map.goal.cy - p.y, map.goal.cx - p.x))) < 0.01, where + ' : le joueur regarde vers B');
  }
  const a = mkGame();
  ok(a.game.vip === null && a.game.escort === null, 'hors escorte : ni VIP ni zone d’extraction');
});

test('escorte : le VIP vous suit ; H le fait attendre à couvert, H à nouveau il repart', () => {
  const g = mkGame({ mode: 'escort', alone: true });
  const game = g.game, p = game.player, v = game.vip;
  const go = reachableSpot(game, p, 2 * U, 4 * U, true) || reachableSpot(game, p, 2 * U, 5 * U);
  ok(go, 'un point où aller');
  p.x = go.x; p.y = go.y;
  g.step(240);
  const d = dist(v.x, v.y, p.x, p.y);
  ok(d <= HOSTAGE_GAP + 14 && game.map.hasLOS(v.x, v.y, p.x, p.y), 'il vous a rejoint (' + Math.round(d) + ' px)');
  ok(v.standing, 'debout, il marche');
  game.input.mouse.x = v.x; game.input.mouse.y = v.y;
  g.press('KeyH');
  eq(v.escort, null, 'H : il attend');
  ok(!v.standing, 'à couvert, accroupi');
  ok(/VIP attend ici/.test(game.message.text), 'annoncé');
  const x = v.x, y = v.y;
  const go2 = reachableSpot(game, p, 2 * U, 4 * U, true) || reachableSpot(game, p, 2 * U, 5 * U);
  p.x = go2.x; p.y = go2.y;
  g.step(180);
  ok(dist(v.x, v.y, x, y) < 2, 'il ne bouge plus');
  ok(besideHostage(game, p, v), 'une place à côté de lui');
  game.input.mouse.x = v.x; game.input.mouse.y = v.y;
  g.press('KeyH');
  g.step(40);
  eq(v.escort, p, 'H à nouveau : il vous suit');
  ok(/VIP vous suit/.test(game.message.text), 'annoncé');
});

// Une ligne droite dégagée de longueur L vers l'est : rien ne s'y cogne, rien n'y arrête la vue.
function openLine(game, L) {
  const m = game.map;
  for (let ty = 2; ty < m.h - 2; ty++) for (let tx = 2; tx < m.w - 2; tx++) {
    const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
    if (m.segmentFree(x, y, x + L, y, 12) && m.hasLOS(x, y, x + L, y)) return { x, y };
  }
  return null;
}

test('escorte : un terroriste qui voit le VIP lui tire dessus, avant un opérateur plus proche, même en plein échange', () => {
  const g = mkGame({ mode: 'escort', alone: true });
  const game = g.game, p = game.player, v = game.vip;
  const o = openLine(game, 6 * U);
  ok(o, 'une ligne dégagée');
  const e = new Enemy(o.x, o.y, 0, 'ak');
  game.enemies = [e];
  game.releaseHostage(v); // il attend là où on le pose
  p.x = o.x + 3 * U; p.y = o.y;
  v.x = o.x + 3.8 * U; v.y = o.y;
  game.enemyCombat(e, 1 / 60);
  eq(e.target, v, 'le VIP, un peu plus loin, passe avant');
  e.target = null;
  v.x = o.x + 5.8 * U;
  game.enemyCombat(e, 1 / 60);
  eq(e.target, v, 'même deux fois plus loin que l’opérateur');
  // hors de vue, c'est l'opérateur ; dès qu'il réapparaît, le terroriste lâche l'opérateur pour lui
  v.x = o.x - 3 * U;
  e.target = null;
  game.enemyCombat(e, 1 / 60);
  eq(e.target, p, 'VIP dans son dos : il tire sur l’opérateur');
  e.reactT = 0;
  v.x = o.x + 5.8 * U;
  game.enemyCombat(e, 1 / 60);
  ok(e.target === v && e.reactT > 0, 'le VIP revient en vue : il se tourne vers lui');
  // l'équipe, elle, ne tire pas à travers lui
  const m = game.mates[0];
  m.alive = true; m.x = o.x + 4 * U; m.y = o.y;
  v.x = o.x + 2 * U;
  ok(!game.lineOfFireClear(m, e), 'pas de tir de l’équipe avec le VIP dans l’axe');
  m.alive = false;
  e.target = null;
  g.step(150);
  ok(v.hp < v.maxHp, 'le terroriste lui tire dessus (' + Math.round(v.hp) + ' PV)');
});

test('escorte : le VIP tient quelques balles, boite à moitié de ses forces, et l’équipe répond des siennes', () => {
  const g = mkGame({ mode: 'escort', alone: true });
  const game = g.game, v = game.vip, foe = new Enemy(v.x + 3 * U, v.y, Math.PI, 'ak');
  eq(game.vestHit(v, { pen: 1 }, 0, 18), 9, 'gilet souple : une balle de pistolet ne fait que la moitié');
  eq(game.vestHit(v, { pen: 3 }, 0, 18), 18, 'une balle de fusil le traverse');
  game.damage(v, 30, foe, 0);
  ok(v.alive && v.hp === 70 && !v.wounded, 'une blessure ne le tue pas');
  ok(/VIP est touché/.test(game.message.text), 'annoncé');
  game.damage(v, 25, foe, 0);
  ok(v.alive && v.wounded, 'à moitié de ses forces, il boite');
  eq(game.stats.vipHits, 0, 'balles du commando : rien à reprocher à l’équipe');
  game.damage(v, 10, game.player, 0);
  eq(game.stats.vipHits, 1, 'une balle de l’équipe est comptée');
  game.damage(v, 100, foe, 0);
  ok(!v.alive, 'il finit par tomber');
});

test('escorte : le VIP entré dans la zone B, c’est gagné ; tué, c’est perdu ; les terroristes à terre ne suffisent pas', () => {
  const g = mkGame({ mode: 'escort', noEnd: false, noEnemyAI: true });
  const game = g.game, v = game.vip, goal = game.map.goal;
  g.step(5);
  eq(game.over, null, 'rien de joué au départ');
  v.x = goal.cx; v.y = goal.cy;
  g.step(2);
  eq(game.over, 'win', 'le VIP est en sécurité au point B');
  ok(/sécurité au point B/.test(game.message.text), 'annoncé');
  ok(game.score.lines.some(l => l.label === 'Santé du VIP'), 'la note parle du VIP');
  g.ui.showEnd('win');
  ok(/VIP exfiltré/.test(g.ui.panel.textContent), 'écran de fin : VIP exfiltré');
  eq(document.getElementById('endVip').textContent, '100 %', 'santé du VIP au bilan');
  g.ui.hideOverlay();
  const g2 = mkGame({ mode: 'escort', noEnd: false, noEnemyAI: true });
  g2.game.damage(g2.game.vip, 500, g2.game.enemies[0], 0);
  g2.step(2);
  eq(g2.game.over, 'lose', 'VIP tué : mission échouée');
  ok(/VIP a été tué/.test(g2.game.loseReason), 'la raison est donnée');
  const g3 = mkGame({ mode: 'escort', noEnd: false, noEnemyAI: true });
  g3.game.enemies.forEach(e => { e.alive = false; });
  g3.step(2);
  eq(g3.game.over, null, 'tous les terroristes à terre : il faut encore amener le VIP au point B');
});

test('escorte : sur chaque carte, le VIP suit le joueur du point A jusque dans la zone B', () => {
  for (let i = 0; i < ESCORT_LEVELS.length; i++) {
    const g = mkGame({ mode: 'escort', level: i, alone: true, noEnd: false });
    const game = g.game, map = game.map, p = game.player, v = game.vip, a = { x: v.x, y: v.y };
    for (const d of map.doors) setDoor(d, 1); // on éprouve le chemin, pas les gestes
    // le joueur est mené à la main le long du chemin de l'IA, qui frôle les angles : on ne l'en décolle pas
    const unstick = game.unstick.bind(game);
    game.unstick = o => { if (o !== p) unstick(o); };
    // le joueur va jusqu'au bout de la zone, côté opposé au point A : le VIP, qui le suit à distance, y entre aussi
    const far = map.goal.cells.slice().sort((c1, c2) => dist(c2.x, c2.y, a.x / TILE, a.y / TILE) - dist(c1.x, c1.y, a.x / TILE, a.y / TILE))
      .find(c => map.circleFree((c.x + 0.5) * TILE, (c.y + 0.5) * TILE, 12, true));
    const route = map.routeTo(p.x, p.y, far.x, far.y, 11);
    ok(route && route.length, ESCORT_LEVELS[i].name + ' : un chemin jusqu’au point B');
    for (const wp of route) {
      for (let guard = 0; guard < 3000 && dist(p.x, p.y, wp.x, wp.y) > 1.6 && !game.over; guard++) {
        const k = 1.6 / dist(p.x, p.y, wp.x, wp.y);
        p.x += (wp.x - p.x) * k; p.y += (wp.y - p.y) * k;
        game.update(1 / 60);
      }
    }
    for (let t = 0; t < 600 && !game.over; t++) game.update(1 / 60);
    eq(game.over, 'win', ESCORT_LEVELS[i].name + ' : le VIP est arrivé (il est à ' + Math.round(dist(v.x, v.y, p.x, p.y)) + ' px du joueur)');
    eq(v.hp, v.maxHp, ESCORT_LEVELS[i].name + ' : indemne');
  }
});

test('escorte : à la mort du joueur, le VIP suit celui qui reprend la main', () => {
  const g = mkGame({ mode: 'escort', noEnd: false, noEnemyAI: true });
  const game = g.game, old = game.player, v = game.vip;
  game.enemies = [];
  game.damage(old, 1000, null, 0);
  g.step(5);
  eq(v.escort, null, 'son escorte tombée, il se met à couvert');
  ok(!game.over, 'pas de défaite tant qu’un coéquipier est debout');
  g.step(Math.ceil(RELAY_DELAY * 60) + 5);
  ok(game.player !== old, 'un coéquipier a pris la main');
  eq(v.escort, game.player, 'le VIP le suit');
  ok(/le VIP le suit/.test(game.message.text), 'annoncé');
});

test('escorte : la note récompense un VIP indemne et la discrétion, et punit les balles de l’équipe dans le VIP', () => {
  const g = mkGame({ mode: 'escort', noEnemyAI: true });
  const game = g.game;
  const perfect = game.scoreReport('win');
  ok(perfect.total === 100 && perfect.grade === 'S', 'VIP indemne, équipe au complet, aucune alerte : 100, note S (' + perfect.total + ')');
  game.vip.hp = 50; game.stats.vipHits = 1; game.alarm = { by: null, x: 0, y: 0, t: 0 };
  eq(game.scoreReport('win').total, 63, 'VIP à moitié, une balle de l’équipe dedans, alerte générale');
  game.vip.alive = false;
  const lost = game.scoreReport('lose');
  ok(lost.total <= 49 && lost.grade === 'D', 'VIP tué : D');
});

// Pixels proches d'une couleur sur un canvas.
function pixelsNear(c, rgb, tol) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let k = 0; k < d.length; k += 4) if (d[k + 3] && Math.abs(d[k] - rgb[0]) <= tol && Math.abs(d[k + 1] - rgb[1]) <= tol && Math.abs(d[k + 2] - rgb[2]) <= tol) n++;
  return n;
}

test('escorte : HUD, briefing et missions montrent le VIP et le chemin de A à B', () => {
  const g = mkGame({ mode: 'escort' });
  const game = g.game, ui = g.ui;
  ui.update();
  const obj = document.getElementById('objective').textContent;
  ok(/VIP : 100 %/.test(obj) && /vous suit/.test(obj) && /Point B : /.test(obj), 'objectif : ' + obj);
  const rows = [...document.querySelectorAll('#squad .mate')];
  eq(rows.length, game.mates.length + 1, 'une ligne de plus pour le VIP');
  ok(/VIP/.test(rows[rows.length - 1].textContent) && /Suit/.test(rows[rows.length - 1].textContent), 'le VIP suit');
  eq(UI.compass(5 * U, 5 * U), 'sud-est', 'boussole');
  eq(UI.compass(-6 * U, 0), 'ouest', 'boussole');
  eq(UI.compass(U, 0), 'tout près', 'boussole');
  ui.showBriefing();
  const modes = [...ui.panel.querySelectorAll('.modebtn')];
  eq(modes.length, 4, 'quatre modes');
  ok(modes.find(b => b.dataset.mode === 'escort').classList.contains('sel'), 'escorte sélectionnée');
  eq(ui.panel.querySelectorAll('.entrybtn').length, 0, 'pas de choix d’entrée : on part du point A');
  ok(/exfiltration/.test(ui.panel.querySelector('#ovGo').textContent), 'bouton de départ');
  const plan = ui.panel.querySelector('#ovPlan');
  ok(pixelsNear(plan, [100, 181, 246], 10) > 0 && pixelsNear(plan, [111, 207, 122], 10) > 0, 'le plan marque A et B');
  ui.showLevels();
  const btns = [...ui.panel.querySelectorAll('.levelbtn')];
  eq(btns.length, ESCORT_LEVELS.length, 'les cartes d’escorte, et elles seules');
  btns.forEach((b, i) => {
    ok(b.textContent.includes(ESCORT_LEVELS[i].name) && /de A à B/.test(b.textContent), ESCORT_LEVELS[i].name + ' : nommée');
    const c = b.querySelector('canvas');
    ok(pixelsNear(c, [100, 181, 246], 10) > 0 && pixelsNear(c, [111, 207, 122], 10) > 0, ESCORT_LEVELS[i].name + ' : A et B sur le plan');
  });
  ui.hideOverlay();
  game.paused = false;
});

test('passer en escorte charge ses propres cartes ; revenir retrouve la mission quittée', () => {
  // setMode mémorise le mode : on remet celui du joueur en sortant
  let sauve = null;
  try { sauve = localStorage.getItem('breach.mode'); } catch (e) { /* stockage indisponible */ }
  try {
    const { game } = mkGame({ level: 2 });
    game.setMode('escort');
    ok(game.levelIndex === 0 && game.def === ESCORT_LEVELS[0] && game.vip, 'escorte : première carte d’escorte, avec son VIP');
    game.loadLevel(1);
    game.setMode('assault');
    ok(game.levelIndex === 2 && game.def === LEVELS[2] && game.vip === null, 'retour à l’assaut : la mission quittée, sans VIP');
    game.setMode('siege');
    eq(game.def, LEVELS[2], 'le siège joue la même carte que l’assaut');
    game.setMode('escort');
    eq(game.def, ESCORT_LEVELS[1], 'l’escorte retrouve la sienne');
  } finally {
    try { if (sauve === null) localStorage.removeItem('breach.mode'); else localStorage.setItem('breach.mode', sauve); } catch (e) { /* idem */ }
  }
});

// ---------------------------------------------------------------- rendu
test('chaque mission se joue sans exception, en assaut, en siège et en trinômes (des deux côtés)', () => {
  for (const mode of ['assault', 'siege', 'squads', 'squadsArmed']) {
    for (let lvl = 0; lvl < LEVELS.length; lvl++) {
      // en assaut, une mission sur deux dans le noir, portes verrouillées, rondes, alerte générale, lampe en
      // main, poignée, chargeur long et gilet lourd
      const dark = mode === 'assault' && lvl % 2 === 1, live = mode === 'assault';
      const g = mkGame({ mode, level: lvl, locks: live, patrols: live, alarm: live, loadout: dark ? { primary: 'mp5', sidearm: 'glock17', cutPower: true, vest: 'vestH', acc: { mp5: { light: true, grip: true }, glock17: { mag: true } } } : undefined });
      if (live) ok(g.game.enemies.some(e => e.patrol), 'des rondes en mission ' + (lvl + 1));
      const p = g.game.player;
      if (g.game.siege) g.game.siege.prep = 0.5;
      for (let i = 0; i < 420; i++) {
        const inp = g.game.input;
        inp.mouse.x = p.x + Math.cos(i / 40) * 120; inp.mouse.y = p.y + Math.sin(i / 40) * 120;
        inp.mouse.down = i % 90 < 8;
        inp.keys.KeyD = g.game.squads && i % 120 < 30; // en trinômes, on avance un peu vers l'adversaire
        if (i % 150 === 40) inp.pressed.KeyE = true;
        if (i % 150 === 90) inp.pressed.Space = true;
        if (i % 150 === 120) inp.pressed.KeyH = true;
        if (i % 150 === 60) inp.pressed.KeyC = true;
        if (i % 210 === 100) inp.pressed.KeyB = true;
        if (i % 210 === 150) inp.pressed.KeyX = true;
        g.step(1);
      }
      ok(true, mode + ' / mission ' + (lvl + 1));
    }
  }
});

test('chaque carte d’escorte se joue sans exception', () => {
  for (let lvl = 0; lvl < ESCORT_LEVELS.length; lvl++) {
    // une carte sur deux dans le noir, avec lampe ; portes verrouillées, rondes et alerte générale partout
    const dark = lvl % 2 === 1;
    const g = mkGame({ mode: 'escort', level: lvl, locks: true, patrols: true, alarm: true, loadout: dark ? { primary: 'mp5', sidearm: 'glock17', cutPower: true, acc: { mp5: { light: true } } } : undefined });
    const game = g.game, map = game.map, room = map.roomOf(game.vip.x, game.vip.y);
    ok(game.enemies.some(e => e.patrol), ESCORT_LEVELS[lvl].name + ' : des rondes');
    ok(game.enemies.every(e => !e.patrol || e.patrol.pts.every(q => !room.has(keyOf(map, q)))), ESCORT_LEVELS[lvl].name + ' : aucune ronde par la pièce du point A');
    const p = game.player;
    for (let i = 0; i < 420; i++) {
      const inp = game.input;
      inp.mouse.x = p.x + Math.cos(i / 40) * 120; inp.mouse.y = p.y + Math.sin(i / 40) * 120;
      inp.mouse.down = i % 90 < 8;
      inp.keys.KeyD = i % 120 < 30;
      if (i % 150 === 40) inp.pressed.KeyE = true;
      if (i % 150 === 90) inp.pressed.Space = true;
      if (i % 150 === 120) inp.pressed.KeyH = true;
      if (i % 210 === 100) inp.pressed.KeyB = true;
      g.step(1);
    }
    ok(true, 'escorte / ' + ESCORT_LEVELS[lvl].name);
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
