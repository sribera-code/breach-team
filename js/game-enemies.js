'use strict';
// Game : l'IA des suspects. Rondes, alerte générale, combat, tir dans les portes, déplacement le long d'un chemin
// (moveAlong, commun à toute l'IA), états (poste, recherche, retour).

// Tir dans une porte (suspects) : durée pendant laquelle il arrose une porte derrière laquelle il sait quelqu'un,
// écart latéral de ses rafales autour du point visé, et distance à laquelle une balle sortie d'une porte le fait riposter.
const BLIND_FIRE = 2.5, BLIND_SWEEP = 0.6 * U, BLIND_NEAR = 1.2 * U;

// Rondes (assaut) : PATROLS suspects font le tour de deux ou trois points au lieu de tenir leur poste, au pas
// (PATROL_SPEED de leur vitesse), avec une pause de PATROL_PAUSE s à chaque point ; une étape fait entre
// PATROL_LEG[0] et PATROL_LEG[1] de chemin.
const PATROLS = 2, PATROL_SPEED = 0.55, PATROL_PAUSE = [2, 5], PATROL_LEG = [4 * U, 12 * U];
// Alerte générale (assaut) : un suspect encore debout ALARM_TIME s après avoir vu un opérateur (le temps sonné
// ne compte pas) prévient tout le bâtiment. Les autres réagissent alors plus vite (ALARM_REACT), et les
// RESPONDERS les plus proches vont voir. Une fois par mission.
const ALARM_TIME = 3, ALARM_REACT = 0.7;
// Repli : blessé sous la moitié de ses forces, un suspect se replie une fois sur RETREAT_HURT ; seul face à deux d'entre
// vous au moins (aucun complice à moins de six cases), une fois sur RETREAT_ODDS, deux fois au plus par partie. Il gagne
// une place hors de vue de la menace et plus loin d'elle, à RETREAT_FAR au plus à pied, en tirant au besoin, et l'y attend.
const RETREAT_HURT = 0.6, RETREAT_ODDS = 0.35, RETREAT_FAR = 10 * U;
// Alerte générale : le suspect libre le plus proche de chaque otage (à THREAT_REACH au plus, à pied) va le tenir en joue ;
// s'il voit l'un de vous THREAT_TIME s (sonné, tout est à refaire ; hors de vue, la menace retombe), il l'abat. Parmi ceux
// qui ne vont pas voir, un sur BARRICADE_CHANCE ferme et verrouille les portes de sa pièce, puis guette l'entrée.
const THREAT_REACH = 8 * U, THREAT_TIME = 3.5, BARRICADE_CHANCE = 0.5;

mixGame(class {
  // Rondes : PATROLS suspects tirés au sort reçoivent un circuit de deux ou trois points, leur poste compris.
  // Chaque étape fait entre PATROL_LEG[0] et PATROL_LEG[1] de chemin (des portes à franchir au besoin : ils ont
  // les clés), et aucune ne passe par la zone où l'équipe commence (room : pièce d'entrée de l'assaut, ou
  // point A de l'escorte et abords du point B ; voir loadLevel). n : combien (davantage sur un terrain tenu).
  buildPatrols(room, n = PATROLS) {
    const m = this.map;
    const inRoom = q => !!room && room.has(Math.floor(q.y / TILE) * m.w + Math.floor(q.x / TILE));
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const cand = [];
    for (let ty = 2; ty < m.h - 2; ty += 2) for (let tx = 2; tx < m.w - 2; tx += 2) {
      if (m.blocksMove(tx, ty) || m.door(tx, ty) || m.tile(tx, ty) !== 0) continue;
      const q = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      if (!inRoom(q) && m.circleFree(q.x, q.y, 12, true)) cand.push(q);
    }
    // longueur du chemin de a à b, ou null s'il n'y en a pas, s'il sort des bornes ou traverse la pièce d'entrée
    const leg = (a, b, r) => {
      const path = m.routeTo(a.x, a.y, Math.floor(b.x / TILE), Math.floor(b.y / TILE), r);
      if (!path || !path.length || path.some(inRoom)) return null;
      let L = 0, px = a.x, py = a.y;
      for (const q of path) { L += dist(px, py, q.x, q.y); px = q.x; py = q.y; }
      return L >= PATROL_LEG[0] && L <= PATROL_LEG[1] ? L : null;
    };
    let made = 0;
    for (const e of shuffle(this.enemies.slice())) {
      if (made >= n) break;
      const pts = [{ x: e.home.x, y: e.home.y }];
      for (const c of shuffle(cand)) {
        if (pts.length >= 3) break;
        const last = pts[pts.length - 1];
        if (pts.some(q => dist(q.x, q.y, c.x, c.y) < 3 * U) || dist(last.x, last.y, c.x, c.y) > PATROL_LEG[1]) continue;
        if (leg(last, c, e.radius) === null) continue;
        // le troisième point doit aussi ramener au poste
        if (pts.length === 2 && leg(c, pts[0], e.radius) === null) continue;
        pts.push(c);
      }
      if (pts.length < 2) continue;
      e.patrol = { pts, i: 0, wait: rand(0, 3), going: false };
      made++;
    }
  }

  // Ronde d'un suspect au calme : il marche jusqu'au point suivant, s'y arrête et regarde autour de lui, puis
  // repart. Son poste (home) suit la ronde : après être allé voir un bruit, il reprend où il en était.
  patrolStep(e, dt) {
    const P = e.patrol;
    if (e.shutBehind && this.shutDoorBehind(e)) return;
    if (e.path.length || e.waitDoor || e.holdT > 0) { this.moveAlong(e, dt); return; }
    if (P.going) { // arrivé : une pause, l'œil dans le sens de la marche
      P.going = false;
      P.wait = rand(PATROL_PAUSE[0], PATROL_PAUSE[1]);
      e.homeAngle = e.angle;
      e.idleT = rand(0.8, 1.6);
    }
    if (P.wait > 0) {
      P.wait -= dt;
      e.idleT -= dt;
      if (e.idleT <= 0) { e.idleT = rand(1, 2.2); e.lookAt = e.homeAngle + rand(-1.2, 1.2); }
      if (e.lookAt !== null && e.alertAngle === null && turnToward(e, e.lookAt, 2, dt)) e.lookAt = null;
      return;
    }
    P.i = (P.i + 1) % P.pts.length;
    const q = P.pts[P.i];
    e.home = { x: q.x, y: q.y };
    e.path = this.pathTo(e, q.x, q.y);
    e.lookAt = null;
    if (e.path.length) P.going = true;
    else P.wait = 2; // injoignable pour l'instant (quelqu'un dans le passage) : il essaiera le suivant
  }

  // Une ronde referme derrière elle la porte qu'elle a dû ouvrir (shutBehind, voir moveAlong), une fois passée de l'autre
  // côté, la poignée encore à portée : au fil de la partie, le bâtiment ne s'ouvre pas. true : il s'y emploie.
  shutDoorBehind(e) {
    const s = e.shutBehind, d = s.d, far = dist(e.x, e.y, d.cx, d.cy);
    if (Math.sign(d.horizontal ? e.y - d.cy : e.x - d.cx) === s.side) { if (far > 3 * U) e.shutBehind = null; return false; }
    if (far < 1.1 * U) return false; // encore dans l'embrasure
    e.shutBehind = null;
    if (far > 2 * U || !this.map.doorPassable(d) || d.broken || d.opening || this.doorBlocker(d)) return false;
    return this.doorAction(e, d, 0);
  }

  // Alerte générale : le suspect crie (on l'entend), et tout le bâtiment se met sur ses gardes. Chacun se tourne
  // vers l'endroit signalé et réagira plus vite ; les plus proches y vont.
  raiseAlarm(e) {
    const at = e.lastKnown || { x: e.x, y: e.y };
    this.alarm = { by: e, x: at.x, y: at.y, t: this.time };
    e.shoutT = this.time;
    this.noise(e.x, e.y, 8 * U, e, 'voice');
    Sound.alarm(); // (l'alerte s'entend partout : on la signale au joueur)
    this.voice(e, 'alarm');
    this.say(this.defense ? "Le groupe armé a donné l'alerte : tout le terrain est sur ses gardes" : "Un suspect a donné l'alerte : tout le bâtiment est sur ses gardes", 3.5);
    const free = [];
    for (const o of this.enemies) {
      if (o === e || !Game.active(o) || o.surrender) continue;
      o.alerted = true;
      o.reaction *= ALARM_REACT;
      o.suspicion = Math.max(o.suspicion, SUSPICION_GO * 0.9);
      if (o.target || o.blind || o.state === 'engage') continue;
      const toward = Math.atan2(at.y - o.y, at.x - o.x);
      o.alertAngle = toward;
      if (o.state !== 'investigate') { o.homeAngle = toward; free.push(o); }
    }
    // les otages d'abord : le plus proche de chacun va le tenir en joue ; parmi les autres, les plus proches vont voir, et
    // un sur deux de ceux qui restent se barricade
    const guards = this.assignGuards(free), rest = free.filter(o => !guards.includes(o));
    rest.sort((a, b) => dist(a.x, a.y, at.x, at.y) - dist(b.x, b.y, at.x, at.y));
    for (const o of rest.slice(0, RESPONDERS)) this.investigate(o, at.x, at.y, 0.7);
    for (const o of rest.slice(RESPONDERS)) if (!o.patrol && Math.random() < BARRICADE_CHANCE) this.planBarricade(o);
  }

  // Alerte générale : pour chaque otage qui attend (ni emmené, ni dehors), le suspect libre (free) le plus proche à pied,
  // à THREAT_REACH au plus, va le tenir en joue (guard). Renvoie ceux qui y vont.
  assignGuards(free) {
    const out = [];
    for (const h of this.hostages) {
      if (!h.alive || h.evacuated || h.escort || h.exiting || h.vip) continue;
      let best = null, bl = THREAT_REACH;
      for (const o of free) {
        if (out.includes(o) || dist(o.x, o.y, h.x, h.y) > bl) continue;
        const path = this.pathTo(o, h.x, h.y);
        let L = path.length ? 0 : dist(o.x, o.y, h.x, h.y) < U ? 0 : Infinity, x = o.x, y = o.y;
        for (const q of path) { L += dist(x, y, q.x, q.y); x = q.x; y = q.y; }
        if (L < bl) { bl = L; best = o; }
      }
      if (best) { out.push(best); Object.assign(best, { guard: { h, t: 0, hp: null, warned: false, post: null, look: 0 }, barricade: null }); }
    }
    return out;
  }

  // Les portes d'une pièce (room : ses petites cases, voir GameMap.roomOf) : celles dont l'embrasure la touche.
  roomDoors(room) {
    const m = this.map;
    return m.doors.filter(d => d.cells.some(c => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => room.has((c.y + dy) * m.w + c.x + dx))));
  }

  // Un suspect qui tient un otage en joue se poste contre lui, l'otage entre lui et la porte la plus proche (il fait
  // écran), et surveille l'entrée ; hors de vue de l'équipe, la menace retombe. true : il s'y tient.
  guardStep(e, dt) {
    const g = e.guard, h = g.h;
    if (!h.alive || h.evacuated || h.escort || h.exiting) { e.guard = null; return false; }
    g.t = Math.max(0, g.t - dt);
    if (!g.post) {
      const doors = this.roomDoors(this.map.roomOf(h.x, h.y)).sort((a, b) => dist(a.cx, a.cy, h.x, h.y) - dist(b.cx, b.cy, h.x, h.y));
      const from = doors.length ? { x: doors[0].cx, y: doors[0].cy } : { x: e.x, y: e.y }, a = Math.atan2(h.y - from.y, h.x - from.x);
      g.post = { x: e.x, y: e.y };
      // (à plus d'un pas : la bouche de son arme ne dépasse pas l'otage)
      search: for (const r of [1.4 * U, 1.7 * U, 1.2 * U]) for (const da of [0, 0.5, -0.5, 1, -1]) {
        const x = h.x + Math.cos(a + da) * r, y = h.y + Math.sin(a + da) * r;
        if (this.map.circleFree(x, y, e.radius, true)) { g.post = { x, y }; break search; }
      }
      g.look = Math.atan2(from.y - g.post.y, from.x - g.post.x);
    }
    const q = g.post;
    e.repathT -= dt;
    if (dist(e.x, e.y, q.x, q.y) > 6 && (e.path.length || e.waitDoor || e.act || e.repathT <= 0)) {
      if (!e.path.length && !e.waitDoor && !e.act) {
        e.path = this.pathTo(e, q.x, q.y);
        if (e.path.length) e.path[e.path.length - 1] = { x: q.x, y: q.y };
        else g.post = { x: e.x, y: e.y }; // (la place est prise : il tient d'où il est)
        e.repathT = 1;
      }
      this.moveAlong(e, dt);
      return true;
    }
    e.path = []; e.moving = false;
    e.home = { x: e.x, y: e.y }; e.homeAngle = g.look;
    if (e.alertAngle === null) turnToward(e, g.look + Math.sin(this.time * 0.8) * 0.25, e.turnRate * 0.6, dt);
    return true;
  }

  // Il tient un otage en joue et voit l'un de vous (t) : il crie, pointe son arme sur l'otage, et l'abat au bout de
  // THREAT_TIME s. Touché, il lâche l'otage pour se défendre. true : il ne tire pas sur vous.
  guardThreat(e, t, dt) {
    const g = e.guard, h = g.h;
    if (!h.alive || h.evacuated || h.escort || h.exiting || dist(e.x, e.y, h.x, h.y) > 2.5 * U) { e.guard = null; return false; }
    if (g.hp === null) g.hp = e.hp;
    if (e.hp < g.hp) { e.guard = null; return false; }
    if (!g.warned) {
      g.warned = true;
      e.shoutT = this.time;
      this.noise(e.x, e.y, 6 * U, e, 'voice');
      this.voice(e, 'threat');
      if (this.playerSees(e) || this.playerSees(h)) this.say('Un suspect menace un otage — aveuglez-le, sommez-le ou tirez juste : il va l’abattre', 3);
    }
    g.t += dt;
    const toH = Math.atan2(h.y - e.y, h.x - e.x);
    e.aimDist = dist(e.x, e.y, h.x, h.y);
    turnToward(e, toH, e.turnRate, dt);
    if (g.t < THREAT_TIME) return true;
    if (e.pauseT <= 0 && e.fireT <= 0 && !e.act && Math.abs(angleDiff(e.angle, toH)) < 0.2) {
      this.fireWeapon(e);
      if (--e.burstLeft <= 0) this.endBurst(e, e.weapon);
    }
    if (!h.alive) e.guard = null;
    return true;
  }

  // Alerte générale : ce suspect ferme les portes de sa pièce (trois au plus : une pièce plus ouverte ne se tient pas ; pas
  // dehors), donne un tour de clé à chacune, puis se poste là d'où il voit le plus d'entrées. false s'il n'y a rien à tenir.
  planBarricade(e) {
    const m = this.map;
    if (OUTDOOR_FLOORS.has(m.floor(e.tx, e.ty))) return false;
    const room = m.roomOf(e.x, e.y), doors = this.roomDoors(room);
    if (!doors.length || doors.length > 3) return false;
    const front = d => { // devant la porte, côté pièce
      for (const k of [1, -1]) {
        const x = d.cx + (d.horizontal ? 0 : k * 1.1 * U), y = d.cy + (d.horizontal ? k * 1.1 * U : 0);
        if (room.has(Math.floor(y / TILE) * m.w + Math.floor(x / TILE))) return { x, y };
      }
      return null;
    };
    const list = doors.filter(d => !d.broken).map(d => ({ d, front: front(d) })).filter(o => o.front);
    if (!list.length) return false;
    let post = null, best = -Infinity;
    for (const i of room) {
      const tx = i % m.w, ty = (i - tx) / m.w;
      if (tx % 2 || ty % 2 || m.blocksMove(tx, ty)) continue;
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE, near = Math.min(...doors.map(d => dist(x, y, d.cx, d.cy)));
      if (near < 2.5 * U || !m.circleFree(x, y, 12, true)) continue;
      const sc = 10 * list.filter(o => m.hasLOS(x, y, o.front.x, o.front.y)).length - Math.abs(near - 4 * U) / U;
      if (sc > best) { best = sc; post = { x, y }; }
    }
    const d0 = post && doors.slice().sort((a, b) => dist(a.cx, a.cy, post.x, post.y) - dist(b.cx, b.cy, post.x, post.y))[0];
    e.barricade = { list, i: 0, post, look: d0 ? Math.atan2(d0.cy - post.y, d0.cx - post.x) : e.homeAngle };
    this.voice(e, 'barricade');
    return true;
  }

  // Barricade en cours : porte après porte, il va devant, la ferme (si personne n'est dans l'embrasure), puis la verrouille ;
  // fini, il gagne son poste. true : il s'en occupe.
  barricadeStep(e, dt) {
    const b = e.barricade;
    if (e.act || e.waitDoor) { this.moveAlong(e, dt); return true; }
    e.repathT -= dt;
    while (b.i < b.list.length) {
      const { d, front } = b.list[b.i];
      if (d.broken || (d.locked && d.progress <= 0 && !d.opening)) { b.i++; continue; }
      if (dist(e.x, e.y, front.x, front.y) > 0.6 * U) {
        if (!e.path.length || e.repathT <= 0) {
          e.path = this.pathTo(e, front.x, front.y);
          e.repathT = 1;
          if (!e.path.length) { b.i++; continue; }
        }
        this.moveAlong(e, dt);
        return true;
      }
      e.path = [];
      if (d.opening) return true;
      if (d.progress > 0) {
        if (this.doorBlocker(d) || !this.doorAction(e, d, 0)) b.i++;
        return true;
      }
      // fermée : un tour de clé
      this.startAction(e, 'door', 0.5, () => { d.locked = true; d.lockKnown = false; });
      b.i++;
      return true;
    }
    e.barricade = null;
    if (b.post) { e.home = b.post; e.homeAngle = b.look; e.state = 'return'; e.path = this.pathTo(e, b.post.x, b.post.y); }
    return false;
  }

  // Repli d'un suspect engagé contre t (voir RETREAT_HURT). true : il part.
  considerRetreat(e, t, dt) {
    if (e.guard || e.blind || (e.retreated || 0) >= 2) return false;
    let go = false;
    if (e.hp < e.maxHp * 0.5 && !e.hurtRolled) { e.hurtRolled = true; go = Math.random() < RETREAT_HURT; }
    else if ((e.oddsT = (e.oddsT || 0) - dt) <= 0) {
      e.oddsT = 2;
      const foes = this.foesOf(e).filter(o => o.alive && !o.vip && this.canSee(e, o)).length;
      const friend = this.enemies.some(o => o !== e && Game.active(o) && !o.surrender && dist(o.x, o.y, e.x, e.y) < 6 * U);
      go = foes >= 2 && !friend && Math.random() < RETREAT_ODDS;
    }
    if (!go) return false;
    const spot = this.fallbackSpot(e, t), path = spot ? this.pathTo(e, spot.x, spot.y) : [];
    if (!path.length) return false;
    Object.assign(e, { state: 'retreat', retreated: (e.retreated || 0) + 1, retreat: { x: spot.x, y: spot.y, from: { x: t.x, y: t.y } }, repathT: 1, patrol: null, shutBehind: null });
    e.path = path;
    this.voice(e, 'retreat');
    return true;
  }

  // Où se replier devant une menace (threat : d'où elle tire) : une place hors de sa vue, plus loin d'elle qu'on ne l'est,
  // de 2 cases à RETREAT_FAR à pied (portes comprises : on les ouvre), la plus proche ; toward : plutôt de ce côté (les
  // siens). null s'il n'y en a pas.
  fallbackSpot(a, threat, toward) {
    const m = this.map, f = m.walkField(a.x, a.y), here = dist(a.x, a.y, threat.x, threat.y);
    // (hors de vue derrière un mur : une porte qu'il franchit restera peut-être ouverte derrière lui)
    const walled = (x, y) => {
      const L = dist(threat.x, threat.y, x, y), n = Math.ceil(L / 6);
      for (let i = 1; i < n; i++) if (m.tile(Math.floor(lerp(threat.x, x, i / n) / TILE), Math.floor(lerp(threat.y, y, i / n) / TILE)) !== 0) return true;
      return false;
    };
    let best = null, bs = Infinity;
    for (let ty = 1; ty < m.h - 1; ty += 2) for (let tx = 1; tx < m.w - 1; tx += 2) {
      const w = f[ty * m.w + tx];
      if (!(w >= 2 * U && w <= RETREAT_FAR) || m.blocksMove(tx, ty) || m.door(tx, ty)) continue;
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (dist(x, y, threat.x, threat.y) < here + U || !m.circleFree(x, y, 12, true) || !walled(x, y)) continue;
      const sc = w + (toward ? 0.4 * dist(x, y, toward.x, toward.y) : 0);
      if (sc < bs) { bs = sc; best = { x, y }; }
    }
    return best;
  }

  // En repli : il gagne sa place (engagé, il recule face à sa cible en tirant), puis s'y poste, tourné vers d'où venait la
  // menace : c'est son nouveau poste.
  retreatStep(e, dt) {
    const r = e.retreat;
    e.alertAngle = null; // (rien ne l'arrête en route)
    e.repathT -= dt;
    const far = dist(e.x, e.y, r.x, r.y) > 8;
    if (far && !e.path.length && !e.waitDoor && !e.act) { e.path = this.pathTo(e, r.x, r.y); e.repathT = 1; }
    if (far && (e.path.length || e.waitDoor || e.act || e.holdT > 0)) { this.moveAlong(e, dt); return; }
    Object.assign(e, { state: 'idle', retreat: null, path: [], moving: false, idleT: rand(1, 3), home: { x: e.x, y: e.y }, homeAngle: Math.atan2(r.from.y - e.y, r.from.x - e.x) });
  }

  enemyCombat(e, dt) {
    if (e.stun > 0) { e.stun -= dt; e.target = null; e.blind = null; e.moving = false; if (e.guard) e.guard.t = 0; return; }
    let t = e.target;
    if (t && (!t.alive || dist(e.x, e.y, t.x, t.y) > this.viewOf(e, Math.atan2(t.y - e.y, t.x - e.x)) || !this.map.hasLOS(e.x, e.y, t.x, t.y))) {
      // vu disparaître derrière une porte : il sait où, et tire dedans
      if (t.alive) { e.target = null; this.startBlindFire(e, t.x, t.y); }
      t = null;
    }
    // en escorte, le VIP aperçu en plein échange : il lâche l'opérateur et pivote vers lui
    const v = this.vip;
    if (t && v && e.team === 'enemy' && t !== v && v.alive && this.canSee(e, v)) { t = v; e.reactT = Math.max(e.reactT, VIP_SWITCH); }
    if (!t) {
      // en escorte, le commando cherche aussi le VIP (et le vise d'abord) ; un trinôme autonome de votre camp
      // cherche ceux d'en face
      t = this.acquireFor(e, this.foesOf(e));
      if (t) {
        e.blind = null;
        e.reactT = e.reaction + (this.dazzles(t, e) ? LAMP_DAZZLE : 0);
        // un suspect qui vous repère crie l'alerte : ses voisins accourent ; et s'il tient, il prévient tout le monde
        // (l'intervention se tait ; le groupe armé des trinômes crie, sans alerte générale)
        if (!e.drilled && this.time - e.shoutT > 5) { e.shoutT = this.time; this.noise(e.x, e.y, 6 * U, e, 'voice'); this.voice(e, 'spot'); }
        if (!e.hunter && e.spotT === null) e.spotT = 0;
      }
    }
    // un agent autonome qui tire dans un bouclier qui l'arrête passe à un autre adversaire en vue, s'il y en a un
    if (t && e.hunter && t !== v && this.shieldStops(t, e)) t = this.acquireFor(e, this.foesOf(e)) || t;
    e.target = t;
    e.fireT -= dt; e.pauseT -= dt;
    e.bloom = Math.max(0, e.bloom - dt * 6 * DEG);
    if (!t) {
      if (e.blind && this.blindFire(e, dt)) return;
      if (e.alertAngle !== null && turnToward(e, e.alertAngle, e.turnRate, dt)) e.alertAngle = null;
      return;
    }
    e.alertAngle = null;
    // il tient un otage en joue : il vous menace avant de tirer sur lui (guardThreat)
    if (e.guard && this.guardThreat(e, t, dt)) return;
    const a = Math.atan2(t.y - e.y, t.x - e.x);
    const d = dist(e.x, e.y, t.x, t.y);
    const w = e.weapon;
    e.aimDist = d;
    e.engaged = d <= this.fireRange(e);
    if (e.engaged || !e.path.length) turnToward(e, a, e.turnRate, dt);
    e.reactT -= dt;
    // L'intervention ne tire jamais avec un otage (ou un équipier) dans l'axe : si ça dure, elle se
    // décale (voir updateAssault). Les trinômes du groupe armé ménagent au moins les leurs ; les suspects du
    // mode assaut, eux, n'ont pas ces scrupules.
    let clear = true;
    if (e.hunter) {
      clear = this.lineOfFireClear(e, t);
      e.blockedT = clear ? 0 : (e.blockedT || 0) + dt;
      // la cible s'abrite derrière un couvert bas : au bout de COVER_FLANK s, il cherche à la déborder (firingSpot)
      e.coverT = this.map.coverShields(e.x, e.y, t.x, t.y) ? (e.coverT || 0) + dt : 0;
      e.blockedLine = e.blockedT > 0.35 || e.coverT > COVER_FLANK;
    }
    if (clear && e.engaged && e.reactT <= 0 && e.pauseT <= 0 && e.fireT <= 0 && !e.act && Math.abs(angleDiff(e.angle, a)) < 0.25) {
      this.fireWeapon(e);
      if (--e.burstLeft <= 0) this.endBurst(e, w);
    }
  }

  // Tir dans une porte : un suspect qui sait quelqu'un derrière une porte (il l'y a vu disparaître, ou une
  // balle en est sortie vers lui) l'arrose BLIND_FIRE s à travers le battant, puis va voir. Seules des portes
  // doivent le séparer du point : un mur arrête tout. L'intervention ne tire pas ainsi à l'aveugle (des
  // otages peuvent se trouver derrière). Renvoie false s'il ne tire pas.
  startBlindFire(e, x, y) {
    if (e.hunter || e.guard || e.state === 'retreat' || !e.alive || e.target || dist(e.x, e.y, x, y) > e.weapon.range) return false;
    if (this.map.doorsOnLine(e.x, e.y, x, y) <= 0) return false;
    e.blind = { x, y, t: BLIND_FIRE, off: e.blind ? e.blind.off : 0 };
    e.state = 'engage'; e.lostT = 0; e.lastKnown = { x, y };
    e.path = []; e.alertAngle = null;
    return true;
  }

  // Une rafale après l'autre dans la porte, chacune un peu décalée (il ne voit pas ce qu'il vise). Il cesse
  // au bout du temps, ou si la porte s'ouvre (il verrait qu'il n'y a plus personne) ou qu'un mur s'interpose.
  blindFire(e, dt) {
    const b = e.blind;
    b.t -= dt;
    if (b.t <= 0 || this.map.doorsOnLine(e.x, e.y, b.x, b.y) <= 0) { e.blind = null; return false; }
    const d = dist(e.x, e.y, b.x, b.y), w = e.weapon;
    const a = Math.atan2(b.y - e.y, b.x - e.x) + Math.atan2(b.off, d);
    e.aimDist = d;
    turnToward(e, a, e.turnRate, dt);
    e.reactT -= dt;
    if (e.reactT <= 0 && e.pauseT <= 0 && e.fireT <= 0 && !e.act && Math.abs(angleDiff(e.angle, a)) < 0.25) {
      this.fireWeapon(e);
      if (--e.burstLeft <= 0) { this.endBurst(e, w); b.off = rand(-BLIND_SWEEP, BLIND_SWEEP); }
    }
    return true;
  }

  // Une balle sortie d'une porte frôle ou touche un suspect : il sait qu'on tire de derrière et riposte dans
  // la porte, vers l'endroit d'où le coup est parti (à une demi-case près : il l'entend, il ne le voit pas).
  doorShotAlarm(b, cs, sn, len) {
    const ox = b.ox !== undefined ? b.ox : b.shooter && b.shooter.x, oy = b.oy !== undefined ? b.oy : b.shooter && b.shooter.y;
    if (ox == null) return;
    for (const e of this.enemies) {
      if (!e.alive || e.surrender || e.team === b.team || e.target || e.stun > 0) continue;
      const t = clamp((e.x - b.x) * cs + (e.y - b.y) * sn, 0, len);
      if (dist(b.x + cs * t, b.y + sn * t, e.x, e.y) > BLIND_NEAR) continue;
      const was = !!e.blind, a = rand(0, TAU), r = rand(0, 0.5 * U);
      if (!this.startBlindFire(e, ox + Math.cos(a) * r, oy + Math.sin(a) * r) && !this.startBlindFire(e, ox, oy)) continue;
      if (was) continue;
      e.reactT = e.reaction;
      if (this.time - e.shoutT > 5) { e.shoutT = this.time; this.noise(e.x, e.y, 6 * U, e, 'voice'); this.voice(e, 'spot'); }
    }
  }

  moveAlong(agent, dt) {
    agent.moving = false;
    if (agent.act) return; // geste en cours (poignée de porte) : on ne bouge pas
    if (agent.waitDoor) {
      if (!this.map.doorPassable(agent.waitDoor)) return;
      agent.waitDoor = null;
    }
    if (agent.holdT > 0) { agent.holdT -= dt; return; }
    if (agent.alertAngle !== null) return;
    if (!agent.path.length) return;
    const wp = agent.path[0];
    // déjà dans l'embrasure : on ne vise plus le milieu de la porte (à deux de front, chacun d'un côté du milieu, on
    // s'y bloquerait l'un l'autre)
    if (agent.path.length > 1 && this.inDoorway(agent, wp)) { agent.path.shift(); return; }
    const dx = wp.x - agent.x, dy = wp.y - agent.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) { agent.path.shift(); return; }
    const ang = Math.atan2(dy, dx);
    // un équipier d'un trinôme qui suit son chef regarde son côté en marchant (watchDir, voir followStep)
    if (!agent.engaged) turnToward(agent, agent.watchDir == null ? ang : agent.watchDir, agent.turnRate, dt);
    if (agent.hunter) agent.moveDir = ang; // le sens de sa marche : sa file s'y range derrière lui (formationPos)
    // (on ne regarde pas plus loin que le point visé : à un pixel de lui, une porte fermée juste à côté n'est pas sur le
    // chemin, et l'ouvrir défaisait une colonne qui changeait de poste)
    const look = Math.min(agent.radius + 4, d);
    const ax = agent.x + Math.cos(ang) * look, ay = agent.y + Math.sin(ang) * look;
    const door = this.map.door(Math.floor(ax / TILE), Math.floor(ay / TILE));
    if (door && !this.map.doorPassable(door)) {
      // (une ronde retient la porte qu'elle ouvre : elle la refermera derrière elle, voir shutDoorBehind)
      if (!door.opening && this.doorAction(agent, door, 1) && agent.patrol && agent.state === 'idle') {
        agent.shutBehind = { d: door, side: Math.sign(door.horizontal ? agent.y - door.cy : agent.x - door.cx) || 1 };
      }
      agent.waitDoor = door;
      return;
    }
    // un suspect en ronde marche, il ne court pas ; un trinôme hors combat avance au pas (pace, voir updateAssault)
    const step = Math.min(d, agent.speed * (agent.pace || 1) * (agent.patrol && agent.state === 'idle' ? PATROL_SPEED : 1) * dt);
    agent.x += Math.cos(ang) * step;
    agent.y += Math.sin(ang) * step;
    agent.moving = true;
    if (step >= d - 0.01) agent.path.shift();
    this.footstep(agent, step, this.stepNoise(agent));
  }

  // Le point wp est le milieu d'une porte ouverte (les chemins y passent, voir GameMap.routeTo) et l'agent se tient
  // déjà dans son embrasure, assez loin des montants pour en sortir tout droit.
  inDoorway(a, wp) {
    const d = this.map.door(Math.floor(wp.x / TILE), Math.floor(wp.y / TILE));
    if (!d || wp.x !== d.cx || wp.y !== d.cy || !this.map.doorPassable(d)) return false;
    const along = Math.abs(d.horizontal ? a.x - d.cx : a.y - d.cy), across = Math.abs(d.horizontal ? a.y - d.cy : a.x - d.cx);
    return across <= TILE / 2 && along <= (d.len * TILE) / 2 - a.radius + 2;
  }

  updateEnemy(e, dt) {
    if (!e.alive) return;
    if (e.surrender) { this.updateSurrendered(e, dt); return; }
    e.noiseT -= dt;
    e.suspicion = Math.max(0, e.suspicion - SUSPICION_DECAY * dt);
    this.enemyCombat(e, dt);
    // il vous a vu : s'il tient ALARM_TIME (sonné, le temps ne compte pas), tout le bâtiment est prévenu
    if (e.spotT !== null && !this.alarm && this.alarms && e.stun <= 0 && (e.spotT += dt) >= ALARM_TIME) this.raiseAlarm(e);
    if (e.stun > 0) return;
    if (e.state === 'retreat') { this.retreatStep(e, dt); return; }
    if (!e.target) { this.spotBody(e); this.spotLaser(e, dt); }
    if (e.target) {
      // blessé, ou seul contre plusieurs : il se replie (considerRetreat)
      if (this.considerRetreat(e, e.target, dt)) return;
      e.state = 'engage';
      e.lastKnown = { x: e.target.x, y: e.target.y };
      e.lostT = 0;
      e.repathT -= dt;
      // (celui qui tient un otage reste contre lui)
      if (e.engaged || e.guard) { e.path = []; e.moving = false; }
      else {
        if (!e.path.length || e.repathT <= 0) { e.path = this.pathTo(e, e.target.x, e.target.y); e.repathT = 1; }
        this.moveAlong(e, dt);
      }
      return;
    }
    e.engaged = false;
    // il arrose une porte sans bouger ; ensuite seulement il ira voir (état engage, puis investigate)
    if (e.blind) { e.lostT = 0; e.moving = false; return; }
    // alerte générale : il tient un otage en joue, ou il se barricade
    if (e.guard && this.guardStep(e, dt)) { e.state = 'idle'; return; }
    if (e.barricade && (e.state === 'idle' || e.state === 'return') && this.barricadeStep(e, dt)) return;
    switch (e.state) {
      case 'engage':
        e.lostT += dt;
        if (e.lostT > 1.2) {
          e.state = 'investigate';
          e.searchT = 0;
          e.path = e.lastKnown ? this.pathTo(e, e.lastKnown.x, e.lastKnown.y) : [];
        }
        break;
      case 'investigate':
        if (e.path.length || e.waitDoor || e.holdT > 0) this.moveAlong(e, dt);
        else {
          e.searchT += dt;
          if (e.alertAngle === null) e.angle += dt * 1.6;
          // rien trouvé : il regagne son poste, sur ses gardes du côté d'où venait le bruit
          if (e.searchT > 3.5) {
            e.state = 'return';
            e.path = dist(e.x, e.y, e.home.x, e.home.y) > U ? this.pathTo(e, e.home.x, e.home.y) : [];
          }
        }
        break;
      case 'return':
        if (e.path.length || e.waitDoor || e.holdT > 0) this.moveAlong(e, dt);
        else { e.state = 'idle'; e.idleT = rand(1, 3); }
        break;
      default:
        if (e.patrol) { this.patrolStep(e, dt); break; }
        e.idleT -= dt;
        if (e.idleT <= 0) { e.idleT = rand(2, 6); e.lookAt = e.homeAngle + rand(-0.9, 0.9); }
        if (e.lookAt !== null && e.alertAngle === null && turnToward(e, e.lookAt, 2, dt)) e.lookAt = null;
    }
  }

  // Un suspect qui découvre le corps d'un des siens crie l'alerte et va voir, même si rien ne s'est entendu.
  spotBody(e) {
    for (const o of this.enemies) {
      if (o === e || o.alive || o.dying || o.noticed) continue;
      if (!this.canSee(e, o)) continue;
      o.noticed = true;
      e.suspicion = 2;
      e.shoutT = this.time;
      this.noise(e.x, e.y, 6 * U, e, 'voice');
      this.voice(e, 'body');
      this.investigate(e, o.x, o.y, 1);
      return;
    }
  }
});
