'use strict';
// Game : les otages (prise en charge, file derrière l'escorte, sortie par une ouverture) et le mode escorte.

// Otage escorté : distance à laquelle il suit son escorte (plus un écart par otage déjà dans la file),
// vitesse de marche, et portée de la prise en charge.
const HOSTAGE_GAP = 1.15 * U, HOSTAGE_GAP_STEP = 0.8 * U, HOSTAGE_SPEED = 112, HOSTAGE_REACH = 1.6 * U;
// Il se jette à genoux ce temps-là quand on tire à moins de HOSTAGE_DUCK_RANGE de lui.
const HOSTAGE_DUCK = 1.2, HOSTAGE_DUCK_RANGE = 7 * U;

// Escorte : un terroriste qui voit le VIP le vise, quoi qu'il fasse (même en plein échange avec l'équipe, il
// pivote vers lui en VIP_SWITCH s au moins) ; personne n'est posté à moins de GOAL_MARGIN de la zone d'extraction.
const VIP_SWITCH = 0.2, GOAL_MARGIN = 2 * U;

mixGame(class {
  // Escorte : personne n'est posté dans la pièce du point A, ni aux abords de la zone d'extraction.
  escortQuiet(a) {
    const m = this.map, zone = m.roomOf((a.x + 0.5) * TILE, (a.y + 0.5) * TILE), r = Math.ceil(GOAL_MARGIN / TILE);
    for (const g of m.goal ? m.goal.cells : []) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (m.inBounds(g.x + dx, g.y + dy)) zone.add((g.y + dy) * m.w + g.x + dx);
      }
    }
    return zone;
  }

  // Case de départ du joueur en escorte : une case de carte devant le VIP, vers le point B (il le suit).
  escortStart(a) {
    const m = this.map, ax = (a.x + 0.5) * TILE, ay = (a.y + 0.5) * TILE, room = m.roomOf(ax, ay);
    const ang = m.goal ? Math.atan2(m.goal.cy - ay, m.goal.cx - ax) : 0;
    const wx = ax + Math.cos(ang) * U, wy = ay + Math.sin(ang) * U;
    let best = a, bd = Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const tx = a.x + dx, ty = a.y + dy, x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (!room.has(ty * m.w + tx) || !m.circleFree(x, y, 14, true) || dist(x, y, ax, ay) < 26) continue;
      const d = dist(x, y, wx, wy);
      if (d < bd) { bd = d; best = { x: tx, y: ty }; }
    }
    return best;
  }

  // ---- Otages ----
  // Un otage n'est sauvé qu'une fois sorti du bâtiment. Pris en charge, il se relève et suit son
  // escorte en file ; amené devant une ouverture sur l'extérieur (porte extérieure assez ouverte
  // pour passer, ou fenêtre à enjamber), il sort : il est évacué. Seul le camp de l'intervention
  // emmène des otages : le joueur en assaut (H), les opérateurs de l'IA en siège (updateAssault).

  // H : l'otage à portée se relève et vous suit ; H à nouveau, il attend sur place, à genoux.
  toggleEscort(p) {
    if (p.team !== this.rescueTeam) { this.say("Vos otages restent à genoux : seule l'intervention les emmène", 1.6); return; }
    if (p.act) return;
    const h = this.nearestHostage(p, HOSTAGE_REACH);
    if (!h) { this.say('Aucun otage à portée', 1); return; }
    if (h.escort === p) { this.releaseHostage(h); this.say(h.vip ? 'Le VIP attend ici, à couvert' : "L'otage attend ici, à genoux", 1.4); return; }
    if (h.escort) return;
    // une main pour l'aider à se relever : un bref geste, arme basse
    this.startAction(p, 'hostage', 0.5, () => {
      if (!h.alive || h.evacuated || h.escort || !p.alive || dist(p.x, p.y, h.x, h.y) > 2 * U) return;
      this.takeCharge(h, p);
      this.hostHint = h;
      this.say(h.vip ? 'Le VIP vous suit — conduisez-le au point B' : "L'otage vous suit — conduisez-le à une sortie", 2.2);
    });
  }

  // Otage vivant, encore dans le bâtiment et pas déjà en train de sortir, le plus proche à vue.
  nearestHostage(a, R) {
    let best = null, bd = R;
    for (const h of this.hostages) {
      if (!h.alive || h.evacuated || h.exiting) continue;
      const d = dist(a.x, a.y, h.x, h.y);
      if (d < bd && this.map.hasLOS(a.x, a.y, h.x, h.y)) { bd = d; best = h; }
    }
    return best;
  }

  takeCharge(h, escort) {
    h.escort = escort;
    h.escortSince = this.time;
    h.path = []; h.repathT = 0; h.blockedT = 0; h.duckT = 0;
    this.unstick(h); // debout, il prend un peu plus de place qu'à genoux
  }

  // L'otage n'a plus d'escorte : il se remet à genoux là où il est.
  releaseHostage(h) {
    const e = h.escort;
    h.escort = null;
    h.path = []; h.moving = false;
    if (e && e.escorting === h) { e.escorting = null; e.exit = null; }
  }

  updateHostages(dt) {
    for (const h of this.hostages) {
      if (!h.alive || h.evacuated) continue;
      if (h.exiting) { this.stepExit(h, dt); continue; }
      h.moving = false;
      if (h.duckT > 0) h.duckT -= dt;
      const e = h.escort;
      if (!e) continue;
      if (!e.alive) {
        this.releaseHostage(h);
        if (h.vip) h.lostEscort = e; // il se met à couvert, et suivra celui qui reprend la main
        if (this.siege) this.say("Son escorte est tombée : l'otage reste à terre", 2.5);
        continue;
      }
      if (h.duckT > 0) continue; // à genoux le temps que ça tire
      // le VIP ne sort pas par la première ouverture venue : seule la zone d'extraction compte (updateEscort)
      const b = e.team === this.rescueTeam && !h.vip ? this.exitFor(h) : null;
      if (b) this.startExit(h, b);
      else this.followEscort(h, e, dt);
    }
  }

  // Suivre l'escorte à distance, chacun à son rang dans la file : le plus proche d'elle en tête, ce qui
  // évite qu'un otage resté derrière ne bute sur celui qui le précède dans un passage étroit. Un otage
  // n'ouvre pas les portes : s'il n'a pas de chemin, il attend qu'on lui en ouvre une.
  followEscort(h, e, dt) {
    const d = dist(h.x, h.y, e.x, e.y);
    const rank = this.hostages.filter(o => o !== h && o.escort === e && o.alive && !o.evacuated && !o.exiting
      && (dist(o.x, o.y, e.x, e.y) < d || (dist(o.x, o.y, e.x, e.y) === d && o.escortSince < h.escortSince))).length;
    const gap = HOSTAGE_GAP + rank * HOSTAGE_GAP_STEP;
    if (d <= gap && this.map.hasLOS(h.x, h.y, e.x, e.y)) {
      h.path = []; h.blockedT = 0;
      turnToward(h, Math.atan2(e.y - h.y, e.x - h.x), 6, dt);
      return;
    }
    h.repathT -= dt;
    if (!h.path.length || h.repathT <= 0) {
      h.path = this.map.routeTo(h.x, h.y, e.tx, e.ty, h.radius, { passableDoors: true }) || [];
      h.repathT = 0.5;
    }
    if (!h.path.length) {
      h.blockedT += dt;
      if (e === this.player && h.blockedT > 1.5 && !h.blockedSaid) {
        h.blockedSaid = true;
        this.say(h.vip ? 'Le VIP ne peut pas vous suivre : ouvrez-lui la porte' : "Un otage ne peut pas vous suivre : ouvrez-lui la porte", 2.2);
      }
      return;
    }
    h.blockedT = 0; h.blockedSaid = false;
    this.unstick(h);
    // il presse le pas quand il est distancé et ralentit en arrivant dans la file
    const speed = clamp((d - gap) * 3 + 45, 45, HOSTAGE_SPEED) * (h.wounded ? 0.8 : 1);
    this.stepAlong(h, speed * dt, dt);
  }

  // Avance le long de h.path, avec les collisions (portes non franchissables comprises).
  stepAlong(h, step, dt) {
    while (step > 0.01 && h.path.length) {
      const wp = h.path[0];
      const dx = wp.x - h.x, dy = wp.y - h.y, d = Math.hypot(dx, dy);
      if (d < 1) { h.path.shift(); continue; }
      const s = Math.min(step, d);
      const bx = h.x, by = h.y;
      this.tryMove(h, dx / d * s, dy / d * s);
      const moved = dist(bx, by, h.x, h.y);
      turnToward(h, Math.atan2(dy, dx), 8, dt);
      if (moved > 0.05) h.moving = true;
      if (moved < s * 0.5) {
        // accroché : son cercle frôle l'angle d'un meuble ou d'un mur. Un écart de côté de quelques pixels qui
        // libère le pas suivant suffit souvent ; sinon, nouveau trajet bientôt.
        const ux = dx / d, uy = dy / d, r = h.radius - 1;
        for (const off of [1, -1, 2, -2, 3, -3]) {
          const x = h.x - uy * off, y = h.y + ux * off;
          if (this.map.circleFree(x, y, r, true) && this.map.circleFree(x + ux * s, y + uy * s, r, true)) { h.x = x; h.y = y; break; }
        }
        h.repathT = Math.min(h.repathT, 0.1);
        return;
      }
      step -= s;
      if (s >= d - 0.01) h.path.shift();
    }
  }

  // Ouverture par laquelle cet otage peut sortir maintenant : il est sur le seuil, ou son escorte
  // s'y tient et il la voit d'où il est. Une porte extérieure doit être assez ouverte pour passer ;
  // une fenêtre, elle, s'enjambe.
  exitFor(h) {
    const e = h.escort;
    for (const b of this.map.breaches) {
      if (b.door && !this.map.doorPassable(b.door)) continue;
      if (!this.map.hasLOS(h.x, h.y, b.inside.x, b.inside.y)) continue;
      if (dist(h.x, h.y, b.inside.x, b.inside.y) <= 0.9 * U) return b;
      if (dist(e.x, e.y, b.cx, b.cy) <= 1.5 * U && dist(h.x, h.y, b.cx, b.cy) <= 4.5 * U
          && this.map.hasLOS(e.x, e.y, b.inside.x, b.inside.y)) return b;
    }
    return null;
  }

  // Sortie : l'otage gagne le seuil, franchit l'ouverture (en enjambant l'appui d'une fenêtre) et
  // disparaît de l'autre côté de la façade. Il reste une cible jusqu'au bout.
  startExit(h, b) {
    const out = { x: b.cx - Math.cos(b.angle) * 14, y: b.cy - Math.sin(b.angle) * 14 };
    const sill = { x: b.cx, y: b.cy, climb: b.kind === 'window' ? 1.1 : 0 };
    const pts = dist(h.x, h.y, b.cx, b.cy) < dist(b.inside.x, b.inside.y, b.cx, b.cy)
      ? [sill, out] : [{ x: b.inside.x, y: b.inside.y }, sill, out];
    h.exiting = { b, pts, climb: 0, alpha: 1 };
    h.path = [];
    h.duckT = 0;
  }

  stepExit(h, dt) {
    const ex = h.exiting;
    h.moving = ex.climb <= 0;
    if (ex.climb > 0) { ex.climb = Math.max(0, ex.climb - dt); return; }
    let step = HOSTAGE_SPEED * 0.8 * dt;
    while (step > 0 && ex.pts.length) {
      const a = ex.pts[0];
      const d = dist(h.x, h.y, a.x, a.y);
      if (d > 0.01) h.angle = Math.atan2(a.y - h.y, a.x - h.x);
      if (d > step) { h.x += (a.x - h.x) / d * step; h.y += (a.y - h.y) / d * step; step = 0; }
      else {
        h.x = a.x; h.y = a.y; step -= d;
        ex.pts.shift();
        if (a.climb) { ex.climb = a.climb; break; }
      }
    }
    // il s'efface en franchissant la façade
    const last = ex.pts.length === 1 ? ex.pts[0] : null;
    ex.alpha = last && ex.climb <= 0 ? clamp(dist(h.x, h.y, last.x, last.y) / 14, 0, 1) : ex.pts.length ? 1 : 0;
    if (!ex.pts.length) this.evacuate(h);
  }

  evacuate(h) {
    this.releaseHostage(h);
    h.evacuated = true;
    h.exiting = null;
    h.visible = false;
    Sound.tick(0.15);
    if (this.siege) {
      const left = this.hostages.filter(o => o.alive && !o.evacuated).length;
      this.say(left ? `L'intervention a évacué un otage — il vous en reste ${left}` : "L'intervention a évacué votre dernier otage", 3);
    } else {
      this.say(`Otage évacué (${this.hostages.filter(o => o.evacuated).length} / ${this.hostages.length})`, 2.5);
    }
  }

  // ---- Escorte ----
  // Le VIP entré dans la zone d'extraction (le point B) est en sécurité : la mission est accomplie (voir checkEnd).
  updateEscort() {
    const v = this.vip;
    if (!v.alive || this.escort.safe || !this.map.inGoal(v.x, v.y)) return;
    this.escort.safe = true;
    Sound.tick(0.15);
    this.say('Le VIP est en sécurité au point B', 3);
  }

  // Un otage debout cède toujours le passage : il s'écarte de quiconque il chevauche (deux otages
  // debout se partagent l'écart). Il enjambe en revanche un otage à genoux, qui sinon pourrait lui
  // barrer une porte.
  separateHostages() {
    const others = [...this.ops, ...this.enemies, ...this.hostages];
    for (const h of this.hostages) {
      if (!h.alive || h.evacuated || h.exiting || !h.standing) continue;
      for (const o of others) {
        if (o === h || !o.alive || o.evacuated || o.exiting || (o.team === 'civ' && !o.standing)) continue;
        const dx = h.x - o.x, dy = h.y - o.y, d = Math.hypot(dx, dy), min = h.radius + o.radius - 4;
        if (d >= min) continue;
        const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
        const push = (min - d) * (o.team === 'civ' && o.standing ? 0.5 : 1);
        if (this.map.circleFree(h.x + nx * push, h.y + ny * push, h.radius - 1, true)) { h.x += nx * push; h.y += ny * push; }
      }
    }
  }

  // Sortie la plus proche à pied (longueur du trajet jusqu'à son seuil), pour une escorte de l'IA.
  nearestExit(a) {
    let best = null, bl = Infinity;
    for (const b of this.map.breaches) {
      const r = this.map.routeTo(a.x, a.y, Math.floor(b.inside.x / TILE), Math.floor(b.inside.y / TILE), a.radius);
      if (!r) continue;
      let len = 0, px = a.x, py = a.y;
      for (const q of r) { len += dist(px, py, q.x, q.y); px = q.x; py = q.y; }
      if (len < bl) { bl = len; best = b; }
    }
    return best;
  }
});
