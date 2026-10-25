'use strict';
// Game : le tir (balles, boucliers, gilets, dégâts) et les grenades (lancer, rebonds, flash, fragmentation).

// Tir de l'IA en rafales : écart relatif de la pause d'une rafale à l'autre (voir Game.endBurst).
const BURST_JITTER = 0.25;

// Durée de mèche, décomptée dès la fin du geste d'armement (et non du lancer).
const FUSE = { flash: 1.7, frag: 2 };
// Lancer : la grenade vole GRENADE_FLIGHT s (au-dessus du mobilier), puis roule en freinant.
const GRENADE_FLIGHT = 0.35, GRENADE_FRICTION = 4;

// Dégâts d'un seul coup au-delà desquels un otage meurt sans passer par la blessure.
const HOSTAGE_GRAVE = 45;

// Grenade à fragmentation (camp du groupe armé en siège) : rayon létal et dégâts au centre.
const FRAG_RADIUS = 3.5 * U;
const FRAG_DAMAGE = 200;
// L'IA (suspects, opérateurs, trinômes, coéquipiers) n'ouvre le feu qu'à AI_FIRE_RANGE au plus, même si elle voit et
// porte plus loin : plus loin, elle se rapproche. L'écran n'en montre guère davantage dans la direction visée (voir
// VIEW_HALF dans js/render.js) : on n'est pas pris pour cible par un tireur qu'on ne peut pas voir à l'écran.
const AI_FIRE_RANGE = 9 * U;
// Sauf celui dont l'arme porte une lunette (le tireur d'un groupe de précision, en stratégie seulement, où l'on
// commande de haut) : il s'arrête pour tirer jusqu'à AI_SCOPE_RANGE, la portée de son arme allongée par la lunette ;
// AI_SNIPER_RANGE pour un fusil de précision (le tireur d'élite d'un groupe de précision).
const AI_SCOPE_RANGE = 16 * U, AI_SNIPER_RANGE = 24 * U;
// Une balle part à sa vitesse réelle (des centaines de mètres par seconde : une image suffit à traverser une pièce) et
// vole jusqu'au premier obstacle, BULLET_REACH au plus (la plus grande carte fait 66 m). Ce qu'elle parcourt pendant une
// image reste tracé TRACER_LIFE s (voir Renderer.drawBullets).
const BULLET_REACH = 80 * U, TRACER_LIFE = 0.08;
// Couvert bas (voir COVER_GUARD, js/map.js) : il arrête COVER_STOP des balles tirées sur qui s'abrite derrière (le reste
// passe : la tête, une épaule dépassent), et les éclats d'une grenade n'y portent plus que COVER_FRAG de leurs dégâts.
// Un tireur entraîné (coéquipier, agent autonome) dont la cible reste à l'abri COVER_FLANK s cherche à la déborder.
const COVER_STOP = 0.85, COVER_FRAG = 0.3, COVER_FLANK = 1.5;

mixGame(class {
  // Jet d'une grenade depuis un agent vers un point : la distance règle la force du lancer. kind : sa sorte, celle que
  // l'agent a en main sinon.
  spawnFlash(p, mx, my, cooked, via, kind) {
    const m = { x: mx, y: my };
    // Portée = distance au curseur (plafonnée). Vol en l'air puis roulement avec frottement :
    // distance ≈ v0 * (flight + 1/friction), d'où v0.
    const d = clamp(dist(p.x, p.y, m.x, m.y), 0.5 * U, 7 * U);
    const ang = Math.atan2(m.y - p.y, m.x - p.x);
    const flight = GRENADE_FLIGHT, friction = GRENADE_FRICTION;
    const v0 = d / (flight + 1 / friction);
    let gx = p.x + Math.cos(ang) * 14, gy = p.y + Math.sin(ang) * 14;
    // la main ne passe pas à travers un mur : si un obstacle sépare le lanceur du point de départ, elle part de lui
    if (this.grenadeBlocked(gx, gy, true) || this.map.castRay(p.x, p.y, ang, 14, false).hit) { gx = p.x; gy = p.y; }
    kind = kind || p.nade || 'flash';
    // temps déjà brûlé dans la main : la mèche a commencé à la fin du geste d'armement
    const burnt = cooked || 0;
    const g = { x: gx, y: gy, vx: Math.cos(ang) * v0, vy: Math.sin(ang) * v0, t: 0, flight, friction, fuse: FUSE[kind === 'frag' ? 'frag' : 'flash'], cooked: burnt, h: 0, spin: rand(0, TAU), bounces: 0, post: null,
      kind, team: p.team, thrower: p };
    // Collé à une porte entrouverte et visant l'embrasure : la grenade est glissée par l'entrebâillement
    // (le battant est ignoré le temps de franchir la porte).
    const door = via || this.nearestDoor(p, 1.8 * U); // via : la porte visée, quand le lanceur la connaît
    if (door && door.progress >= 0.4 && !door.open) {
      const cross = this.aimCrossesDoor(p.x, p.y, ang, door);
      if (cross) {
        g.post = door;
        g.postSide = Math.sign(cross.side);
        if (this.grenadeBlocked(g.x, g.y, true) || dist(p.x, p.y, g.x, g.y) < 1) { g.x = p.x; g.y = p.y; }
      }
    }
    this.grenades.push(g);
    this.emit('weapon');
  }

  // La visée depuis (x,y) traverse-t-elle l'embrasure de la porte ? Renvoie le côté du tireur, sinon null.
  aimCrossesDoor(x, y, ang, d) {
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const half = (d.len * TILE) / 2;
    // repère de la porte : "along" le long de l'embrasure, "across" perpendiculaire
    const side = d.horizontal ? y - d.cy : x - d.cx;
    const vAcross = d.horizontal ? sn : cs;
    if (Math.abs(vAcross) < 0.2 || Math.sign(vAcross) === Math.sign(side) || side === 0) return null;
    const t = -side / vAcross;
    const along = d.horizontal ? x + cs * t - d.cx : y + sn * t - d.cy;
    return Math.abs(along) <= half - 3 ? { side } : null;
  }

  // Obstacles pour une grenade : murs, fenêtres, portes non ouvertes en grand, et le mobilier sauf
  // quand elle passe par-dessus (overProps : en vol, ou retombée sur un meuble dont elle roule).
  grenadeBlocked(x, y, overProps) {
    const m = this.map, tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (m.isWall(tx, ty) || m.window(tx, ty)) return true;
    if (!overProps && m.prop(tx, ty)) return true;
    // seule une porte complètement fermée bloque l'embrasure ; sinon on teste le battant (doorLeafHit)
    const d = m.door(tx, ty);
    return d ? d.progress <= 0 : false;
  }

  // Grenade posée sur un meuble (retombée sur une table, un lit...).
  grenadeOnProp(g) { return !!this.map.prop(Math.floor(g.x / TILE), Math.floor(g.y / TILE)); }

  // Battant d'une porte : segment partant de la charnière (même géométrie que le rendu).
  doorLeaf(d) { return this.map.leafSeg(d); }

  // Rebond d'une grenade sur le battant des portes entrouvertes ou ouvertes.
  doorLeafHit(g, R) {
    for (const d of this.map.doors) {
      if (d.progress <= 0) continue;
      if (Math.abs(g.x - d.cx) > 60 || Math.abs(g.y - d.cy) > 60) continue;
      if (g.post === d) {
        // grenade glissée par l'entrebâillement : battant ignoré jusqu'à ce qu'elle ait franchi la porte
        const side = d.horizontal ? g.y - d.cy : g.x - d.cx;
        if (Math.sign(side) !== g.postSide && Math.abs(side) > 12) g.post = null;
        continue;
      }
      const s = this.doorLeaf(d);
      const ex = s.x1 - s.x0, ey = s.y1 - s.y0;
      const t = clamp(((g.x - s.x0) * ex + (g.y - s.y0) * ey) / (ex * ex + ey * ey), 0, 1);
      const px = s.x0 + ex * t, py = s.y0 + ey * t;
      let nx = g.x - px, ny = g.y - py;
      const dd = Math.hypot(nx, ny);
      const minD = R + 2.5; // demi-épaisseur du battant
      if (dd >= minD) continue;
      if (dd < 0.001) { nx = -ey; ny = ex; } // pile sur le battant : normale arbitraire
      const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
      // repousse hors du battant
      g.x = px + nx * minD; g.y = py + ny * minD;
      const vn = g.vx * nx + g.vy * ny;
      if (vn < 0) {
        const speed = Math.hypot(g.vx, g.vy);
        const tx = g.vx - vn * nx, ty = g.vy - vn * ny;
        g.vx = tx * 0.8 - vn * nx * 0.45;
        g.vy = ty * 0.8 - vn * ny * 0.45;
        g.bounces++;
        if (speed > 40) { this.sfx('tick', g.x, g.y, 5 * U, Math.min(0.25, speed / 900)); this.noise(g.x, g.y, 2.5 * U, g.thrower, 'bounce'); }
      }
    }
  }

  // ---- Tir ----
  fireWeapon(shooter) {
    const s = shooter.slot, w = s.def;
    const n = w.pellets || 1;
    // l'erreur de visée vaut pour tout le coup ; les plombs s'ouvrent ensuite en gerbe autour (pattern)
    const spread = this.spreadOf(shooter), aim = shooter.angle + rand(-spread, spread), pattern = w.pattern || 0;
    const ml = muzzleDist(w.gunLen);
    // Collé à un mur ou à une porte, le canon dépasse de l'autre côté : la balle part alors du tireur
    // (et bute sur l'obstacle, ou le traverse avec le malus d'une porte) au lieu de naître derrière.
    const muzzle = this.map.castRay(shooter.x, shooter.y, shooter.angle, ml, false);
    const blocked = muzzle.hit;
    // la chevrotine fait sauter une serrure ; tirée au jugé dans une porte (blindFire), elle vise quelqu'un, pas la serrure
    const breach = w.kind === 'shotgun' && !shooter.blind ? 1 : 0;
    const mx = blocked ? muzzle.x - Math.cos(shooter.angle) * 2 : shooter.x + Math.cos(shooter.angle) * ml;
    const my = blocked ? muzzle.y - Math.sin(shooter.angle) * 2 : shooter.y + Math.sin(shooter.angle) * ml;
    for (let i = 0; i < n; i++) {
      const a = aim + rand(-pattern, pattern);
      const clear = !blocked && !this.map.castRay(shooter.x, shooter.y, a, ml, false).hit;
      const bx = clear ? shooter.x + Math.cos(a) * ml : shooter.x, by = clear ? shooter.y + Math.sin(a) * ml : shooter.y;
      this.bullets.push({ x: bx, y: by, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, team: shooter.team, damage: w.damage, life: BULLET_REACH / w.speed, shooter, ox: shooter.x, oy: shooter.y, heavy: w.heavy, pierce: w.pierce === undefined ? 0.4 : w.pierce, pierced: 0, breach, pen: w.pen || 1, wname: w.name });
    }
    shooter.bloom = Math.min(shooter.bloom + w.bloom, w.bloomMax || 8 * DEG);
    shooter.kick = 1;
    s.mag--;
    shooter.fireT = Math.max(shooter.fireT, -0.02) + 1 / w.rof; // report du reste : cadence réelle malgré le pas de 1/60 s
    shooter.muzzleT = 0.06;
    if (!w.suppressed) shooter.glowT = SHOT_GLOW; // la flamme de bouche éclaire le tireur (courant coupé)
    if (shooter === this.player) {
      const r = w.recoil || 4;
      this.camKick.x -= Math.cos(shooter.angle) * r; this.camKick.y -= Math.sin(shooter.angle) * r;
    }
    this.effects.push({ type: 'muzzle', x: mx, y: my, angle: shooter.angle, t: 0, life: 0.06, big: w.heavy });
    const ca = shooter.angle + Math.PI / 2 + rand(-0.4, 0.4);
    this.casings.push({ x: shooter.x + Math.cos(shooter.angle) * 8, y: shooter.y + Math.sin(shooter.angle) * 8, vx: Math.cos(ca) * rand(70, 130), vy: Math.sin(ca) * rand(70, 130), rot: rand(0, TAU), spin: rand(-12, 12), t: 0, life: 0.45 });
    if (shooter === this.player) { this.stats.shots++; this.camShake = Math.max(this.camShake, w.heavy ? 4 : 1.5); }
    this.noise(shooter.x, shooter.y, w.noise * U, shooter, 'shot');
    // un otage debout se jette à genoux quand on tire près de lui, le temps que ça cesse
    for (const h of this.hostages) if (h.escort && !h.exiting && dist(h.x, h.y, shooter.x, shooter.y) < HOSTAGE_DUCK_RANGE) h.duckT = HOSTAGE_DUCK;
    // le coup s'entend bien plus loin qu'il n'alerte (EAR_SPAN) ; une pompe se réarme après chaque coup, un fusil à
    // verrou aussi (on manœuvre la culasse)
    this.sfx('shot', shooter.x, shooter.y, Math.max(2, w.noise) * U * EAR_SPAN, w);
    if (w.kind === 'shotgun' && !(w.tint && w.tint.semi) && s.mag > 0) this.sfx('pump', shooter.x, shooter.y, 5 * U);
    if (w.mode === 'Verrou' && s.mag > 0) this.sfx('cycle', shooter.x, shooter.y, 4 * U);
  }

  updateBullets(dt) {
    const keep = [];
    const civs = this.hostages.filter(h => !h.evacuated); // un otage sorti est hors d'atteinte
    for (const b of this.bullets) {
      // au bout de sa course (BULLET_REACH), elle s'arrête en l'air : on ne la fait pas voler une image de trop
      const step = Math.min(dt, b.life), sp = Math.hypot(b.vx, b.vy), len = sp * step;
      const ang = Math.atan2(b.vy, b.vx), cs = Math.cos(ang), sn = Math.sin(ang);
      const r = this.map.castRay(b.x, b.y, ang, len, false);
      let hitT = r.hit ? r.dist : len;
      let victim = null, onShield = false;
      // Tir ami possible : les balles de l'équipe touchent aussi les coéquipiers (sauf le tireur). En trinômes, celles
      // d'en face aussi : les deux camps se valent.
      const cands = b.team === 'ops'
        ? [...this.enemies, ...civs, ...this.ops.filter(o => o !== b.shooter)]
        : [...this.ops, ...civs, ...(this.squads ? this.enemies.filter(o => o !== b.shooter) : [])];
      for (const c of cands) {
        if (!c.alive) continue;
        const rx = c.x - b.x, ry = c.y - b.y;
        const t = rx * cs + ry * sn;
        const perp = Math.abs(rx * sn - ry * cs);
        // Bouclier : un arc devant le porteur, à SHIELD_REACH de son centre. Une balle qui y entre de face
        // s'y arrête avant d'atteindre le corps ; de côté ou de dos, elle passe à côté et touche le corps.
        if (c.shield && t >= -SHIELD_REACH && t <= hitT + SHIELD_REACH && perp <= SHIELD_REACH) {
          const ts = Math.max(0, t - Math.sqrt(SHIELD_REACH * SHIELD_REACH - perp * perp));
          const ia = Math.atan2(b.y + sn * ts - c.y, b.x + cs * ts - c.x);
          if (ts <= hitT && Math.abs(angleDiff(c.angle, ia)) <= c.shield.arc) { hitT = ts; victim = c; onShield = true; continue; }
        }
        if (t < -c.radius || t > hitT + c.radius) continue;
        if (perp > c.radius) continue;
        const tt = Math.max(0, t - Math.sqrt(c.radius * c.radius - perp * perp));
        if (tt <= hitT) { hitT = tt; victim = c; onShield = false; }
      }
      // la cible s'abrite derrière un couvert bas : la balle s'y arrête, le plus souvent (COVER_STOP)
      const cov = victim && this.map.coverShields(b.ox, b.oy, victim.x, victim.y);
      if (cov && Math.random() < COVER_STOP) hitT = clamp((cov.x - b.x) * cs + (cov.y - b.y) * sn, 0, hitT);
      else if (cov) b.overCover = true; // (passée au ras du couvert : elle frappe)
      const covered = cov && !b.overCover;
      // ce qu'elle a parcouru pendant cette image, jusqu'à ce qui l'arrête, reste tracé un instant
      this.tracers.push({ x0: b.x, y0: b.y, x1: b.x + cs * hitT, y1: b.y + sn * hitT, t: 0, heavy: !!b.heavy });
      if (b.pierced) this.doorShotAlarm(b, cs, sn, hitT);
      if (covered) { this.coverHit(b, cov); continue; }
      if (victim && onShield) { this.shieldHit(victim, b, b.x + cs * hitT, b.y + sn * hitT, ang); continue; }
      if (victim) {
        this.damage(victim, this.vestHit(victim, b, ang, b.damage), b.shooter, ang, b.wname);
        this.sfx('impact', victim.x, victim.y, 6 * U, 'flesh');
        if (b.shooter === this.player && victim.team === 'enemy') this.stats.hits++;
        continue;
      }
      if (r.hit) {
        // Une porte n'est pas un mur : la balle la traverse en perdant de l'énergie (et un peu sa ligne).
        if (r.door && b.pierced < 2) {
          if (b.breach && b.pierced === 0) this.breachDoor(r.door, b.shooter);
          b.pierced++;
          b.damage *= b.pierce;
          const na = ang + rand(-1.6, 1.6) * DEG;
          b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
          b.x = r.x + Math.cos(na) * 3; b.y = r.y + Math.sin(na) * 3; // ressort de l'autre côté
          b.life -= r.dist / sp;
          this.effects.push({ type: 'splinter', x: r.x, y: r.y, angle: ang, t: 0, life: 0.25 });
          this.sfx('pierce', r.x, r.y, 8 * U);
          this.noise(r.x, r.y, 3 * U, b.shooter, 'impact'); // l'impact s'entend de l'autre côté
          if (b.life > 0 && b.damage >= 2) keep.push(b);
          continue;
        }
        this.addDecal({ type: 'hole', x: r.x - cs * 1.5, y: r.y - sn * 1.5 });
        this.effects.push({ type: 'spark', x: r.x, y: r.y, t: 0, life: 0.15 });
        // l'impact claque : même tiré au silencieux, un coup manqué s'entend près du mur
        this.noise(r.x - cs * 2, r.y - sn * 2, 2.5 * U, b.shooter, 'impact');
        this.sfx('impact', r.x - cs * 2, r.y - sn * 2, 7 * U, 'wall');
        continue;
      }
      b.x += b.vx * step; b.y += b.vy * step; b.life -= step;
      if (b.life > 1e-9) keep.push(b);
    }
    this.bullets = keep;
  }

  // Balle arrêtée par un couvert bas : un éclat (et un trou dans le muret ou la tôle), et l'impact s'entend, de la
  // matière du couvert (sable, pierre, tôle).
  coverHit(b, cov) {
    const mat = LOW_COVER[cov.prop.type];
    this.effects.push({ type: 'spark', x: cov.x, y: cov.y, t: 0, life: 0.15 });
    if (mat !== 'sand') this.addDecal({ type: 'hole', x: cov.x, y: cov.y });
    this.noise(cov.x, cov.y, 2.5 * U, b.shooter, 'impact');
    this.sfx('impact', cov.x, cov.y, 7 * U, mat);
  }

  // Balle sur un bouclier : arrêtée (étincelle, choc dans le bras, impact qui claque) si le bouclier est
  // de niveau suffisant, sinon elle le traverse et le porteur encaisse une partie des dégâts.
  shieldHit(c, b, x, y, ang) {
    const sh = c.shield;
    this.effects.push({ type: 'spark', x, y, t: 0, life: 0.18 });
    this.sfx('ping', x, y, 9 * U);
    this.noise(x, y, 2.5 * U, b.shooter, 'impact');
    if (b.pen > sh.stops) {
      this.damage(c, this.vestHit(c, b, ang, b.damage * sh.through), b.shooter, ang, b.wname);
      if (b.shooter === this.player && c.team === 'enemy') this.stats.hits++;
      return;
    }
    c.kick = Math.max(c.kick, 0.6);
    c.handBloom = Math.max(c.handBloom || 0, 2 * DEG); // le choc dérange la visée
    if (c === this.player) { this.camShake = Math.max(this.camShake, 2.5); this.hurtFrom(ang + Math.PI, 0, true); }
    if (c !== this.player && !c.target && b.shooter) c.alertAngle = Math.atan2(b.shooter.y - c.y, b.shooter.x - c.x);
  }

  // Balle sur un porteur de gilet (ang : sens de sa course) : dégâts encaissés. De face ou de dos, dans l'arc
  // des plaques, elles arrêtent jusqu'à vest.plate ; partout, le gilet souple arrête jusqu'à vest.soft. Une
  // balle arrêtée ne laisse que le choc ; une balle qui perce frappe de tous ses dégâts.
  vestHit(c, b, ang, dmg) {
    const v = c.vest;
    if (!v || !c.alive) return dmg;
    const plate = v.plate && (Math.abs(angleDiff(c.angle, ang + Math.PI)) <= v.arc || Math.abs(angleDiff(c.angle, ang)) <= v.arc);
    if (plate && b.pen <= v.plate) { this.vestStop(c); return dmg * v.plateBlunt; }
    if (b.pen <= v.soft) { this.vestStop(c); return dmg * v.blunt; }
    return dmg;
  }

  vestStop(c) {
    c.handBloom = Math.max(c.handBloom || 0, 1.5 * DEG); // le choc dérange la visée
  }

  // Des dégâts : target encaisse dmg de shooter, le coup venant dans la direction ang (sa course : la balle, ou du centre
  // d'une explosion vers lui) ; cause : ce qui l'a frappé (nom de l'arme, 'grenade', 'charge'), pour le fil des morts.
  damage(target, dmg, shooter, ang, cause) {
    if (!target.alive) return;
    this.effects.push({ type: 'hit', x: target.x, y: target.y, t: 0, life: 0.25 });
    if (target === this.player) this.hurtFrom(ang + Math.PI, dmg);
    for (let i = 0; i < 3; i++) {
      const d = rand(4, 22);
      this.addDecal({ type: 'blood', x: target.x + Math.cos(ang + rand(-0.6, 0.6)) * d, y: target.y + Math.sin(ang + rand(-0.6, 0.6)) * d, r: rand(2, 5) });
    }
    if (target.vip) {
      // Le VIP encaisse comme un homme (son gilet a déjà pris sa part, voir vestHit) ; à moitié de ses
      // forces, il boite et suit moins vite. Une balle de l'équipe compte lourd dans la note de fin.
      target.hp -= dmg;
      if (shooter && shooter.team === 'ops') this.stats.vipHits++;
      target.wounded = target.hp <= target.maxHp / 2;
      if (target.hp > 0) { this.say(target.wounded ? 'Le VIP est grièvement touché !' : 'Le VIP est touché !', 2); return; }
      target.hp = 0;
      target.alive = false;
      this.addDecal({ type: 'pool', x: target.x, y: target.y, rot: target.angle });
      this.noise(target.x, target.y, 2 * U, target, 'body');
      return;
    }
    if (target.team === 'civ') {
      // Un otage survit à une première blessure légère ; une deuxième, ou une blessure grave
      // (HOSTAGE_GRAVE et plus : balle lourde à bout portant, éclat de grenade), le tue.
      if (!target.wounded && dmg < HOSTAGE_GRAVE) {
        target.wounded = true;
        this.say('Un otage est blessé', 2);
        return;
      }
      target.alive = false;
      this.addDecal({ type: 'pool', x: target.x, y: target.y, rot: target.angle });
      this.noise(target.x, target.y, 2 * U, target, 'body');
      if (this.siege) {
        const left = this.hostages.filter(h => h.alive && !h.evacuated).length;
        if (left) this.say(`Un otage est tombé — il vous en reste ${left}`, 3);
      }
      return;
    }
    target.hp -= dmg;
    // balle (ou éclat) de l'équipe dans l'un des siens : comptée dans la note de fin (en guerre totale, seulement les
    // vôtres : votre armée compte des dizaines de tireurs que vous ne commandez pas)
    if (target.team === 'ops' && shooter && shooter.team === 'ops' && shooter !== target && !this.siege && (!this.war || shooter === this.player)) this.stats.friendly++;
    if (target !== this.player && !target.target && shooter && !target.surrender) target.alertAngle = Math.atan2(shooter.y - target.y, shooter.x - target.x);
    if (target === this.player) this.camShake = Math.max(this.camShake, 5);
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.path = [];
      target.target = null;
      target.moving = false;
      target.bodyAngle = ang + rand(-0.6, 0.6);
      target.dying = { t: 0, dur: 0.7, dir: ang, spin: Math.random() < 0.5 ? -1 : 1 };
      target.diedAt = this.time;
      // un corps qui tombe s'entend un peu : un suspect abattu sans bruit peut encore alerter ses voisins
      this.noise(target.x, target.y, 2 * U, target, 'body');
      this.sfx('body', target.x, target.y, 6 * U);
      // guerre totale : chaque mort compte pour l'armée d'en face, quoi qui l'ait tué
      if (this.war) {
        this.war.kills[target.team === 'ops' ? 'enemy' : 'ops']++;
        if (shooter === this.player && target.team === 'enemy') this.war.mine++;
      }
      if (this.squads) this.feedKill(shooter, target, cause);
      if (target.team === 'enemy') {
        this.stats.kills++;
        if (target.surrender) this.stats.badKills++; // abattu à genoux, les mains sur la tête
      }
      // (en guerre totale, seuls ceux de votre trinôme sont annoncés : les autres tombent par dizaines)
      else if (target !== this.player) {
        this.stats.losses++;
        if (!(this.war && target.hunter)) {
          this.say(`${target.name} est à terre !`, 2.5);
          const near = this.crew.filter(m => m !== target).sort((a, b) => dist(a.x, a.y, target.x, target.y) - dist(b.x, b.y, target.x, target.y))[0];
          this.voice(near, 'down');
        }
      }
      else if (this.war ? this.crew.length : this.mates.some(m => m.alive)) { this.stats.losses++; this.say('Vous êtes à terre — un coéquipier reprend la main', RELAY_DELAY + 0.3); }
      else if (this.war) this.stats.losses++;
    }
  }

  // Vous êtes touché : d'où le coup est venu (a, l'angle vers sa source) et combien il a fait (k) ; blocked : arrêté par
  // le bouclier. Le rendu en tire un arc rouge autour de vous (Renderer.drawHurt), un instant (HURT_LIFE).
  hurtFrom(a, dmg, blocked) {
    if (!Number.isFinite(a)) return;
    const k = blocked ? 0.35 : clamp(dmg / 40, 0.35, 1);
    const near = this.hurt.find(h => h.t < 0.3 && !h.blocked === !blocked && Math.abs(angleDiff(h.a, a)) < 20 * DEG);
    if (near) { near.k = Math.max(near.k, k); near.a = a; near.t = 0; return; }
    this.hurt.push({ a, k, t: 0, blocked: !!blocked });
    if (this.hurt.length > 8) this.hurt.shift();
  }

  // Trinômes et guerre totale : une ligne du fil des morts (UI.updateFeed) : qui a abattu qui, et avec quoi.
  feedKill(shooter, target, cause) {
    const who = a => (!a ? '?' : a === this.player ? 'Vous' : a.name || (a.team === 'enemy' ? (this.defense ? 'Défenseur' : 'Adversaire') : 'Allié'));
    const color = a => (!a ? '#9aa4ae' : a.team === 'ops' ? (a === this.player ? '#ffffff' : a.accent || '#9be7a6') : '#ef8a7a');
    const by = cause === 'grenade' ? 'grenade' : cause === 'charge' ? 'charge' : cause || (shooter && shooter.weapon ? shooter.weapon.name : '');
    this.feed.push({
      killer: who(shooter), kcol: color(shooter), victim: who(target), vcol: color(target), by, t: this.time,
      mine: shooter === this.player || target === this.player, friendly: !!shooter && shooter.team === target.team,
    });
    if (this.feed.length > 12) this.feed.shift();
  }

  // ---- Grenades ----
  updateGrenades(dt) {
    const R = 3.5; // rayon de la grenade
    for (const g of this.grenades) {
      g.t += dt;
      const speed = Math.hypot(g.vx, g.vy);
      // sous-pas pour ne jamais traverser un mur
      const steps = Math.max(1, Math.ceil(speed * dt / 4));
      const sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        // En vol, elle passe au-dessus du mobilier (plantes, tables, caisses...) ; au sol elle rebondit
        // dessus, sauf si elle est retombée sur un meuble : elle en roule jusqu'à tomber.
        const over = g.t - dt + s * sdt < g.flight || this.grenadeOnProp(g);
        const nx = g.x + g.vx * sdt;
        if (g.vx !== 0 && this.grenadeBlocked(nx + Math.sign(g.vx) * R, g.y, over)) this.bounceGrenade(g, 'x');
        else g.x = nx;
        const ny = g.y + g.vy * sdt;
        if (g.vy !== 0 && this.grenadeBlocked(g.x, ny + Math.sign(g.vy) * R, over)) this.bounceGrenade(g, 'y');
        else g.y = ny;
        this.doorLeafHit(g, R);
      }
      g.spin += speed * dt * 0.05;
      if (g.t < g.flight) g.h = Math.sin(g.t / g.flight * Math.PI) * 12;           // en l'air
      else if (g.t < g.flight + 0.18) g.h = Math.sin((g.t - g.flight) / 0.18 * Math.PI) * 3; // petit rebond à l'atterrissage
      else g.h = 0;
      if (g.t >= g.flight && this.grenadeOnProp(g)) g.h = Math.max(g.h, 5); // sur le plateau du meuble
      if (g.t >= g.flight) { const f = Math.exp(-g.friction * dt); g.vx *= f; g.vy *= f; }   // roulement
      if (speed < 4) { g.vx = 0; g.vy = 0; }
      if (g.t + g.cooked >= g.fuse) { if (g.kind === 'frag') this.detonateFrag(g); else this.detonateFlash(g.x, g.y, g); }
    }
    this.grenades = this.grenades.filter(g => g.t + g.cooked < g.fuse);
  }

  bounceGrenade(g, axis) {
    const speed = Math.hypot(g.vx, g.vy);
    if (axis === 'x') { g.vx = -g.vx * 0.45; g.vy *= 0.8; } else { g.vy = -g.vy * 0.45; g.vx *= 0.8; }
    g.bounces++;
    if (speed > 40) { this.sfx('tick', g.x, g.y, 5 * U, Math.min(0.25, speed / 900)); this.noise(g.x, g.y, 2.5 * U, g.thrower, 'bounce'); }
  }

  detonateFlash(x, y, g) {
    this.effects.push({ type: 'flash', x, y, t: 0, life: 0.7 });
    this.sfx('flash', x, y, 34 * U);
    const R = 6.5 * U;
    // Ceux du camp du lanceur savent qu'elle part : ils détournent les yeux et ne sont gênés
    // que si elle éclate presque à leurs pieds.
    const warned = a => g && a.team === g.team;
    const reach = a => (warned(a) ? 1.2 * U : R);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < reach(e) && this.map.hasLOS(x, y, e.x, e.y)) {
        e.stun = Math.max(e.stun, 2.5 + 3.5 * (1 - d / R));
        e.target = null;
        e.path = [];
      }
    }
    const p = this.player;
    const dp = dist(x, y, p.x, p.y);
    if (p.alive && dp < reach(p) && this.map.hasLOS(x, y, p.x, p.y)) {
      const facing = Math.abs(angleDiff(p.angle, Math.atan2(y - p.y, x - p.x))) < p.fov / 2;
      p.flashT = Math.max(p.flashT, (facing ? 2.2 : 0.8) * (1 - dp / R) + 0.3);
    }
    for (const m of this.mates) {
      if (!m.alive) continue;
      const dm = dist(x, y, m.x, m.y);
      if (dm < reach(m) && this.map.hasLOS(x, y, m.x, m.y)) { m.stun = Math.max(m.stun, 1.5 * (1 - dm / R) + 0.3); m.target = null; }
    }
    this.camShake = Math.max(this.camShake, 6);
    this.noise(x, y, 14 * U, g ? g.thrower : null, 'boom');
  }

  // Grenade à fragmentation : dégâts décroissants jusqu'à FRAG_RADIUS, pour tous ceux qu'aucun mur ni
  // porte fermée ne protège — lanceur, alliés et otages compris ; un couvert bas en arrête l'essentiel (COVER_FRAG).
  detonateFrag(g) {
    const { x, y } = g;
    this.effects.push({ type: 'frag', x, y, t: 0, life: 0.9 });
    this.addDecal({ type: 'scorch', x, y });
    this.sfx('frag', x, y, 40 * U);
    for (const a of [...this.enemies, ...this.ops, ...this.hostages]) {
      if (!a.alive || a.evacuated) continue;
      const d = dist(x, y, a.x, a.y);
      if (d >= FRAG_RADIUS || !this.map.hasLOS(x, y, a.x, a.y)) continue;
      const k = 1 - d / FRAG_RADIUS, cover = this.map.coverShields(x, y, a.x, a.y, 0) ? COVER_FRAG : 1;
      this.damage(a, (FRAG_DAMAGE * k * k + 8) * cover, g.thrower, Math.atan2(a.y - y, a.x - x), 'grenade');
      if (a.alive && a.team !== 'civ') { a.stun = Math.max(a.stun || 0, 0.8 * k); a.target = null; }
    }
    this.camShake = Math.max(this.camShake, 11);
    this.noise(x, y, 18 * U, g.thrower, 'boom');
  }

  // Distance d'où l'IA ouvre le feu : la portée de son arme, sans dépasser AI_FIRE_RANGE (AI_SCOPE_RANGE à la lunette,
  // AI_SNIPER_RANGE au fusil de précision).
  fireRange(a) {
    const w = a.weapon;
    if (!w.scope) return Math.min(w.range, AI_FIRE_RANGE);
    return Math.min(w.range * scopeOf(w).reach, w.optic ? AI_SNIPER_RANGE : AI_SCOPE_RANGE);
  }

  // Fin d'une rafale de l'IA : le temps de ramener l'arme sur la cible avant la suivante. Personne ne tire au
  // métronome : la rafale suivante compte un coup de plus ou de moins (une arme qui tire coup par coup reste au
  // coup par coup), et la pause varie de ±BURST_JITTER.
  endBurst(a, w) {
    a.burstLeft = w.burst > 1 ? w.burst + Math.round(rand(-1, 1)) : w.burst;
    a.pauseT = w.pause * rand(1 - BURST_JITTER, 1 + BURST_JITTER);
  }
});
