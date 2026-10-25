'use strict';
// Game : vos coéquipiers. Ordres, entrée coordonnée (colonne, entrée à la flash), formation, surveillance,
// discipline de tir et combat.

// Entrée coordonnée : délai entre l'ouverture de la porte et l'entrée de l'équipe (sans flash en préparation).
const ENTRY_DELAY = 0.5;
// Entrée à la flash (second clic droit sur la porte de la colonne) : le coéquipier posté du côté d'où une flash passe
// par l'entrebâillement (selon le sens du battant, voir Game.flashAimFrom) entrouvre la porte à FLASH_CRACK, glisse
// dans la pièce une flash dégoupillée depuis MATE_COOK s, et l'ouvre en grand à l'éclair.
const FLASH_CRACK = DOOR_PASS, MATE_COOK = 0.5;
// Une grenade à fragmentation glissée par une porte (colonne du groupe armé) tombe à FRAG_DEPTH cases au moins dans la
// pièce : son éclat n'atteint pas la colonne, de l'autre côté du mur.
const FRAG_DEPTH = (FRAG_RADIUS + 8) / U;
// Un coéquipier sans contact va menotter le suspect rendu à MATE_CUFF_REACH au plus, en vue, que personne ne menotte.
const MATE_CUFF_REACH = 6 * U;

mixGame(class {
  // Rechargement d'un coéquipier : un chargeur d'un coup, ou le temps de remplir le magasin
  // cartouche par cartouche pour un fusil à pompe.
  mateReload(m) {
    const w = m.weapon;
    const n = w.reloadType === 'shell' ? Math.max(1, w.mag - m.slot.mag) : 1;
    m.reloadT = m.reloadDur = w.reload * n;
    if (m.target) this.voice(m, 'reload'); // (en plein échange : qu'on le couvre)
  }

  // ---- Coéquipiers ----
  // En siège, les complices ne reçoivent pas d'ordres : chacun tient son poste et se bat seul.
  canCommand(quiet) {
    if (!this.siege) return true;
    if (!quiet) this.say("Pas d'ordres : chacun tient son poste", 1.4);
    return false;
  }

  // ---- Ordres à un seul coéquipier ----
  // Vos ordres vont à toute l'équipe ; le menu d'actions sur l'un d'eux en donne un à lui seul (withOrderTo : orderTo le
  // temps de cet ordre), les autres gardent les leurs. ordered : ceux à qui l'ordre va.
  ordered() { const c = this.crew; return this.orderTo && c.includes(this.orderTo) ? [this.orderTo] : c; }
  // Qui reçoit l'ordre, dans les messages : « Équipe », ou le nom de celui à qui il va seul.
  orderName() { return this.orderTo && this.crew.includes(this.orderTo) ? this.orderTo.name : 'Équipe'; }
  withOrderTo(m, fn) { const was = this.orderTo; this.orderTo = m; try { fn(); } finally { this.orderTo = was; } }
  // Plus personne en colonne : la colonne n'est plus.
  dropStackIfEmpty() { if (!this.mates.some(o => o.alive && o.order === 'stack')) this.stack = null; }

  // ---- Escorte : couvrir le VIP ----
  // Celui qui couvre le VIP : votre dernier coéquipier debout (ou celui que vous en avez chargé, vipGuardPick), tant qu'il
  // vous suit ; null hors escorte, ou le VIP en sécurité.
  vipGuard() {
    const v = this.vip, crew = this.crew;
    if (!v || !v.alive || this.escort.safe || !crew.length) return null;
    const g = crew.includes(this.vipGuardPick) ? this.vipGuardPick : crew[crew.length - 1];
    return g.order === 'follow' ? g : null;
  }

  // Sa place : entre le VIP et l'adversaire en vue le plus proche (le VIP dans son dos), sinon derrière le VIP qui vous
  // suit (à l'opposé de vous), ou à côté de lui s'il attend ; hors de votre axe de tir. { x, y, look }.
  guardVipPos(m) {
    const v = this.vip, p = this.player;
    const foe = this.enemies.filter(e => Game.active(e) && !e.surrender && e.visible && dist(e.x, e.y, v.x, v.y) < 12 * U)
      .sort((a, b) => dist(a.x, a.y, v.x, v.y) - dist(b.x, b.y, v.x, v.y))[0];
    const away = Math.atan2(v.y - p.y, v.x - p.x), base = foe ? Math.atan2(foe.y - v.y, foe.x - v.x) : v.escort ? away : away + Math.PI / 2;
    for (const da of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) for (const r of [1.1 * U, 0.85 * U, 1.4 * U]) {
      const x = v.x + Math.cos(base + da) * r, y = v.y + Math.sin(base + da) * r;
      if (!this.map.circleFree(x, y, m.radius + 1, true) || !this.map.hasLOS(v.x, v.y, x, y)) continue;
      if (!foe && p.alive && this.inAimCone(x, y, 25 * DEG)) continue;
      return { x, y, look: foe ? Math.atan2(foe.y - y, foe.x - x) : base };
    }
    return { x: m.x, y: m.y, look: base };
  }

  // ---- Menottes ----
  // Un coéquipier sans contact, qui vous suit ou tient sa position, va menotter le suspect rendu le plus proche (à
  // MATE_CUFF_REACH, en vue) que personne d'autre ne menotte, puis reprend sa place. true : il s'en occupe.
  cuffStep(m, dt) {
    let e = m.cuffing;
    if (e && (!e.alive || !e.surrender || e.cuffed || e.cuffBy !== m)) { if (e.cuffBy === m) e.cuffBy = null; m.cuffing = e = null; }
    if (m.target || (m.order !== 'follow' && m.order !== 'hold')) { if (e) { e.cuffBy = null; m.cuffing = null; } return false; }
    if (!e) {
      e = this.enemies.filter(o => o.alive && o.surrender && !o.cuffed && !(o.cuffBy && o.cuffBy.alive && o.cuffBy !== m)
        && dist(o.x, o.y, m.x, m.y) < MATE_CUFF_REACH && this.map.hasLOS(m.x, m.y, o.x, o.y))
        .sort((a, b) => dist(a.x, a.y, m.x, m.y) - dist(b.x, b.y, m.x, m.y))[0];
      if (!e) return false;
      Object.assign(m, { cuffing: e, path: [], destTile: null, watchSpot: null });
      e.cuffBy = m;
    }
    if (m.act) { m.moving = false; return true; }
    if (dist(m.x, m.y, e.x, e.y) > 1.3 * U) {
      if (!m.path.length || m.repathT <= 0) {
        m.path = this.pathTo(m, e.x, e.y);
        m.repathT = 0.5;
        if (!m.path.length) { e.cuffBy = null; m.cuffing = null; return false; }
      }
      m.speed = 78; m.walkMode = true;
      this.moveAlong(m, dt);
      return true;
    }
    m.path = []; m.moving = false;
    turnToward(m, Math.atan2(e.y - m.y, e.x - m.x), m.turnRate, dt);
    this.startAction(m, 'cuff', CUFF_TIME, () => {
      if (!e.alive || !e.surrender || e.cuffed || !m.alive || dist(m.x, m.y, e.x, e.y) > 2 * U) return;
      e.cuffed = true;
      this.stats.arrests++;
      this.sfx('cuffs', m.x, m.y, 4 * U);
      this.voice(m, 'cuff');
      this.say(`${m.name} a menotté un suspect (${this.enemies.filter(o => o.cuffed).length} arrêté${this.stats.arrests > 1 ? 's' : ''})`, 1.8);
    });
    return true;
  }

  // coverAngle : direction imposée à l'un des coéquipiers une fois sur place (null = au choix de l'IA).
  orderMove(wx, wy, coverAngle) {
    if (!this.canCommand(true)) return;
    // case la plus proche du clic où un corps tient sans toucher de mur
    let tx = -1, ty = -1, bd = Infinity;
    const ctx0 = Math.floor(wx / TILE), cty0 = Math.floor(wy / TILE);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = ctx0 + dx, y = cty0 + dy;
      if (!this.map.inBounds(x, y) || this.map.blocksMove(x, y)) continue;
      if (!this.map.circleFree((x + 0.5) * TILE, (y + 0.5) * TILE, 12, false)) continue;
      const d = dist((x + 0.5) * TILE, (y + 0.5) * TILE, wx, wy);
      if (d < bd) { bd = d; tx = x; ty = y; }
    }
    if (tx < 0) { this.say('Point inaccessible', 1); return; }
    wx = (tx + 0.5) * TILE; wy = (ty + 0.5) * TILE;
    const alive = this.ordered();
    if (!alive.length) return;
    const p = this.player;
    const dir = Math.atan2(wy - p.y, wx - p.x);
    const spots = alive.map((m, i) => {
      // légère dispersion perpendiculaire pour ne pas s'empiler
      const side = (i - (alive.length - 1) / 2) * 0.8 * U;
      let x = wx - Math.sin(dir) * side, y = wy + Math.cos(dir) * side;
      if (!this.map.circleFree(x, y, m.radius, false)) { x = (tx + 0.5) * TILE; y = (ty + 0.5) * TILE; }
      return { x, y };
    });
    // Le coéquipier chargé de la direction est celui qui se place déjà de ce côté :
    // il n'a pas à traverser la ligne de l'autre.
    let cover = null;
    if (coverAngle !== null && coverAngle !== undefined) {
      let best = -Infinity;
      alive.forEach((m, i) => {
        const side = spots[i];
        const away = dist(side.x, side.y, wx, wy) < 1 ? dir : Math.atan2(side.y - wy, side.x - wx);
        const s = Math.cos(angleDiff(coverAngle, away));
        if (s > best) { best = s; cover = m; }
      });
    }
    alive.forEach((m, i) => {
      m.order = 'move'; m.orderPos = spots[i]; m.repathT = 0; m.destTile = null; m.watchSpot = null;
      m.coverAngle = m === cover ? coverAngle : null;
      m.holdAngle = m === cover ? coverAngle : dir;
    });
    this.orderMarker = { x: wx, y: wy, t: 0, angle: coverAngle === undefined ? null : coverAngle, mate: cover };
    this.dropStackIfEmpty();
    this.say(cover ? `${cover.name} : couvrez cette direction` : `${this.orderName()} : allez-y`, 1.4);
  }

  // ---- Entrée coordonnée ----
  // Case libre la plus proche de (x, y), du côté side de la porte (signe de la coordonnée perpendiculaire), d'où
  // l'on voit le pied du battant ; à minD au moins du milieu de la porte (hors de portée d'une charge, par exemple).
  stackSpot(d, side, x, y, r, taken, minD) {
    let best = null, bd = Infinity;
    const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
    const foot = { x: d.cx + (d.horizontal ? 0 : side * (TILE / 2 + 3)), y: d.cy + (d.horizontal ? side * (TILE / 2 + 3) : 0) };
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const tx = cx + dx, ty = cy + dy;
      if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty) || this.map.door(tx, ty)) continue;
      const px = (tx + 0.5) * TILE, py = (ty + 0.5) * TILE;
      if (Math.sign(d.horizontal ? py - d.cy : px - d.cx) !== side) continue;
      if (minD && dist(px, py, d.cx, d.cy) < minD) continue;
      if (!this.map.circleFree(px, py, r + 1, true) || !this.map.hasLOS(px, py, foot.x, foot.y)) continue;
      if (taken.some(o => dist(o.x, o.y, px, py) < 22)) continue;
      const dd = dist(px, py, x, y);
      if (dd < bd) { bd = dd; best = { x: px, y: py }; }
    }
    return best;
  }

  // Postes d'une colonne de n sur la porte d, du côté side : alternativement de part et d'autre du cadre, le long du
  // mur, les suivants derrière les premiers (rank) ; à minD au moins du milieu de la porte. k : côté du cadre.
  stackPosts(d, side, n, minD) {
    const half = (d.len * TILE) / 2, off = TILE / 2 + 14, taken = [], out = [];
    for (let i = 0; i < n; i++) {
      const k = i % 2 ? 1 : -1, rank = Math.floor(i / 2);
      let lat = half + 12 + rank * 24;
      if (minD > off) lat = Math.max(lat, Math.sqrt(minD * minD - off * off) + 2);
      const x = d.cx + (d.horizontal ? k * lat : side * off), y = d.cy + (d.horizontal ? side * off : k * lat);
      const sp = this.stackSpot(d, side, x, y, 11, taken, minD);
      if (sp) { taken.push(sp); out.push({ ...sp, k, rank }); }
    }
    return out;
  }

  // Clic droit sur une porte fermée : les coéquipiers se placent en colonne de part et d'autre de l'embrasure,
  // de votre côté, et attendent. Dès que la porte s'ouvre (vous l'ouvrez, la charge la souffle, la chevrotine
  // fait sauter la serrure), ils entrent chacun vers son angle de la pièce ; une flash en préparation ou en
  // vol, ils attendent qu'elle éclate.
  orderStack(d) {
    if (!this.canCommand(true)) return;
    const alive = this.ordered();
    if (!alive.length) return;
    const p = this.player;
    const side = Math.sign(d.horizontal ? p.y - d.cy : p.x - d.cx) || 1;
    const spots = this.stackPosts(d, side, 2, 0);
    if (!spots.length) { this.say('Pas la place de se mettre en colonne ici', 1.4); return; }
    // chacun prend le côté le plus proche de lui (le second prend l'autre)
    const order = alive.length > 1 && spots.length > 1
      && dist(alive[0].x, alive[0].y, spots[1].x, spots[1].y) + dist(alive[1].x, alive[1].y, spots[0].x, spots[0].y)
       < dist(alive[0].x, alive[0].y, spots[0].x, spots[0].y) + dist(alive[1].x, alive[1].y, spots[1].x, spots[1].y)
      ? [spots[1], spots[0]] : spots;
    // le poste d'où une flash passe par l'entrebâillement (il dépend du sens du battant) revient à qui en a encore une
    const good = order.findIndex(sp => this.flashAimFrom(sp.x, sp.y, d, side) || this.flashAimFrom(sp.x, sp.y, d, side, 1));
    if (good >= 0 && !(alive[good] && alive[good].flashbangs > 0)) {
      const holder = alive.findIndex((m, i) => i < order.length && m.flashbangs > 0);
      if (holder >= 0) [order[good], order[holder]] = [order[holder], order[good]];
    }
    alive.forEach((m, i) => {
      const sp = order[i % order.length];
      const look = Math.atan2(d.cy - sp.y, d.cx - sp.x);
      Object.assign(m, { order: 'stack', orderPos: { x: sp.x, y: sp.y }, stackSide: sp.k, repathT: 0, destTile: null, watchSpot: null, coverAngle: look, holdAngle: look });
    });
    this.stack = { door: d, side, ready: false, wait: null, go: false, tries: 0, flash: null, charge: null, then: null };
    this.orderMarker = { x: d.cx + (d.horizontal ? 0 : side * 8), y: d.cy + (d.horizontal ? side * 8 : 0), t: 0, angle: null, mate: null };
    this.say(alive.length > 1 ? 'Équipe : en colonne sur la porte — en position, E : comment entrer (ou ouvrez-la, ils entrent)'
      : `${alive[0].name} : en colonne sur la porte — en position, E : comment entrer (ou ouvrez-la, il entre)`, 2.2);
  }

  updateStack(dt) {
    const s = this.stack;
    if (!s) return;
    const team = this.mates.filter(m => m.alive && m.order === 'stack');
    if (!team.length) { this.stack = null; return; }
    const d = s.door;
    if (!s.ready && team.every(m => dist(m.x, m.y, m.orderPos.x, m.orderPos.y) < 8)) {
      s.ready = true;
      this.say(s.go ? 'Équipe en position — on entre' : 'Équipe en position — E : entrer, à la charge, à la flash ou à la grenade', 2.4);
    }
    if (s.charge) { this.updateChargeEntry(s, team, dt); return; }
    if (s.flash) { this.updateFlashEntry(s, team); return; }
    if (!d.broken && !this.map.doorPassable(d)) {
      s.wait = null;
      // « Entrer » : une fois en place, le plus proche ouvre (il crochète d'abord), l'équipe entre dès que la porte
      // laisse passer
      if (s.go && s.ready && !this.stackOpen(s, team)) { s.go = false; this.say('La porte résiste — ouvrez-la, ils entrent', 2); }
      return;
    }
    if (s.wait === null) s.wait = d.broken ? 0.15 : ENTRY_DELAY;
    // une flash dégoupillée ou en vol, ou votre grenade à fragmentation (on n'entre pas dessus) : on attend qu'elle éclate
    const p = this.player;
    const nade = (p.act && p.act.type === 'grenade') || p.cooking || this.grenades.some(g => g.team === 'ops' && (g.kind === 'flash' || g.thrower === p));
    if (nade) { s.wait = Math.max(s.wait, 0.15); return; }
    s.wait -= dt;
    if (s.wait > 0) return;
    this.endStack(s, team);
  }

  // Entrée à la flash (menu de E, la colonne en place). Celui qui tient le poste d'où une flash passe
  // par l'entrebâillement entrouvre, la glisse dans la pièce et, l'éclair passé, ouvre en grand : l'équipe entre sur
  // des suspects aveuglés. S'il n'a plus de flash et que l'autre en a, ils échangent leurs places d'abord. Quand
  // aucun poste n'a d'angle par l'entrebâillement (battant ouvert contre un mur), on ouvre en grand avant de lancer ;
  // et si même ainsi aucun n'en a, celui qui a une flash va se placer là d'où elle passe (flashSpot).
  // kind : 'frag', la grenade à fragmentation de l'un d'eux plutôt qu'une flash (la même manœuvre, la grenade tombant
  // plus loin dans la pièce, FRAG_DEPTH).
  orderFlashEntry(kind = 'flash') {
    const s = this.stack;
    if (!this.canCommand(true) || !s || s.flash || s.charge) return;
    const team = this.mates.filter(m => m.alive && m.order === 'stack'), nade = kind === 'frag' ? 'grenade' : 'flash';
    if (!team.some(o => o.nades[kind] > 0)) { this.say(`Plus de ${nade} dans l'équipe — ouvrez la porte, ils entrent`, 2); return; }
    const plan = this.planFlash(s, team, kind);
    if (!plan) { this.say(`Pas d'angle pour lancer une ${nade} par cette porte — ouvrez-la, ils entrent`, 2); return; }
    const { m, crack } = plan;
    s.flash = { m, crack, depth: plan.depth, kind, phase: 'place', g: null, tries: 0 };
    this.say(plan.moved ? `${m.name} : je me place pour la ${nade}, puis on entre`
      : crack < 1 ? `${m.name} : ${nade} dans la pièce, puis on entre` : `${m.name} : on ouvre, ${nade}, puis on entre`, 1.8);
  }

  // E sur la colonne prête : une charge sur la porte. Le coéquipier le plus près la pose (sur vos charges de brèche),
  // l'équipe recule hors du souffle, puis on choisit ce qui suit l'explosion (stackChoose) : entrer, à la flash, à la
  // grenade. B la fait sauter aussi : on entre.
  orderChargeEntry() {
    const s = this.stack, p = this.player;
    if (!this.canCommand(true) || !s || s.flash || s.charge) return;
    const d = s.door, team = this.mates.filter(m => m.alive && m.order === 'stack');
    if (this.camp === 'armed') { this.say('Pas de charge de brèche dans ce camp', 1.4); return; }
    if (p.charges <= 0) { this.say('Plus de charge de brèche', 1.4); return; }
    if (this.charges.some(c => c.team === p.team)) { this.say('Une charge est déjà posée — B : mise à feu', 1.6); return; }
    if (d.broken || d.progress > 0) { this.say('Une charge se pose sur une porte fermée', 1.4); return; }
    if (!this.chargePosts(s, team, p)) { this.say("Pas la place de s'écarter du souffle ici — entrez autrement", 2); return; }
    s.then = null;
    this.say(`${s.charge.by.name} : je pose la charge`, 1.6);
  }

  // La colonne s attend votre choix : en place, rien d'engagé (ni grenade, ni porte qu'on ouvre), ou sa charge posée
  // sans qu'on sache encore ce qui suivra l'explosion.
  stackWaits(s) {
    if (!s || !s.ready || s.flash) return false;
    if (s.charge) return !!s.charge.obj && !s.then && this.charges.includes(s.charge.obj);
    return s.ai ? s.tactic === 'wait' : !s.go;
  }

  // Votre choix pour la colonne s (la vôtre, ou celle d'un trinôme en stratégie) : 'plain' (on ouvre et on entre),
  // 'flash' ou 'frag' (la grenade d'abord), 'charge' (on la pose, puis on choisit de nouveau : c'est elle qui ouvrira).
  // La charge déjà posée, le choix dit ce qui suit l'explosion.
  stackChoose(s, choice) {
    const team = s.ai ? s.team.filter(o => o.alive && o.entry === s) : this.mates.filter(m => m.alive && m.order === 'stack');
    const nade = choice === 'frag' ? 'grenade' : 'flash';
    if (s.charge) {
      if ((choice === 'flash' || choice === 'frag') && !team.some(o => o.nades[choice] > 0)) { this.say(`Plus de ${nade} dans la colonne`, 1.6); return; }
      s.then = choice;
      this.say(choice === 'plain' ? 'Mise à feu, puis on entre' : `Mise à feu, ${nade}, puis on entre`, 1.6);
      return;
    }
    if (!s.ai) {
      if (choice === 'plain') { s.go = true; s.tries = 0; this.say(team.length > 1 ? 'Équipe : on ouvre et on entre' : `${team[0].name} : j'ouvre et j'entre`, 1.4); }
      else if (choice === 'charge') this.orderChargeEntry();
      else this.orderFlashEntry(choice);
      return;
    }
    if (choice === 'charge') {
      if (!team.some(o => o.charges > 0)) { this.say('Plus de charge dans ce trinôme', 1.6); return; }
      if (!this.chargePosts(s, team)) { this.say("Pas la place de s'écarter du souffle ici", 1.8); return; }
      s.tactic = 'charge'; s.then = null;
    } else if (choice === 'plain') s.tactic = 'plain';
    else {
      if (!team.some(o => o.nades[choice] > 0)) { this.say(`Plus de ${nade} dans la colonne`, 1.6); return; }
      Object.assign(s, { tactic: 'flash', kind: choice, flashTried: false });
    }
    s.t = 0;
  }

  // Second clic droit sur la porte de votre colonne : on entre, porte ouverte (charge posée : mise à feu, puis on entre),
  // dès qu'elle est en place ; rien à faire si une entrée à la grenade est déjà en route.
  stackPlain(s) {
    if (s.flash) { this.say('Entrée à la grenade déjà en route', 1.2); return; }
    if (!s.ready && !s.charge) { s.go = true; s.tries = 0; this.say('Équipe : on entre dès que vous êtes en place', 1.4); return; }
    this.stackChoose(s, 'plain');
  }

  // Le plus proche de la porte de la colonne l'ouvre en grand (et la crochète d'abord, si elle est fermée à clé).
  // false : elle résiste (quatre essais).
  stackOpen(s, team) {
    const d = s.door;
    if (d.opening || team.some(o => o.act)) return true;
    const opener = team.filter(o => !o.target && !(o.stun > 0) && dist(o.x, o.y, d.cx, d.cy) < 2 * U)
      .sort((a, b) => dist(a.x, a.y, d.cx, d.cy) - dist(b.x, b.y, d.cx, d.cy))[0];
    if (!opener) return true;
    if (++s.tries > 4) return false;
    if (this.doorAction(opener, d, 1)) s.committed = true;
    return true;
  }

  // Qui lance la flash d'une colonne, et à quel cran de la porte : celui qui tient le poste d'où une flash passe par
  // l'entrebâillement (s'il n'en a plus, il échange sa place avec un équipier qui en a) ; sans poste qui ait l'angle,
  // celui qui en a une va se placer là d'où elle passe (moved). null si personne n'a d'angle.
  planFlash(s, team, kind = 'flash') {
    const d = s.door, depth = kind === 'frag' ? FRAG_DEPTH : 0; // (une grenade à fragmentation : plus loin)
    const has = o => o.nades[kind] > 0;
    const crackOf = o => [FLASH_CRACK, 1].find(c => this.flashAimFrom(o.orderPos.x, o.orderPos.y, d, s.side, c, depth)) || 0;
    const posts = team.map(o => ({ o, crack: crackOf(o) })).filter(q => q.crack).sort((a, b) => a.crack - b.crack);
    if (!posts.length) {
      const o = team.find(has), sp = o && this.flashSpot(d, s.side, o, team, depth);
      if (!sp) return null;
      const look = Math.atan2(d.cy - sp.y, d.cx - sp.x);
      Object.assign(o, { orderPos: { x: sp.x, y: sp.y }, path: [], destTile: null, repathT: 0, coverAngle: look, holdAngle: look });
      return { m: o, crack: sp.crack, moved: true, depth, kind };
    }
    const crack = posts[0].crack;
    let m = (posts.find(q => q.crack === crack && has(q.o)) || {}).o;
    if (!m) {
      const post = posts[0].o, other = team.find(o => o !== post && has(o));
      if (!other) return null;
      for (const k of ['orderPos', 'stackSide', 'stackRank', 'coverAngle', 'holdAngle']) [post[k], other[k]] = [other[k], post[k]];
      for (const o of [post, other]) Object.assign(o, { path: [], destTile: null, repathT: 0 });
      m = other;
    }
    return { m, crack, moved: false, depth, kind };
  }

  // Les temps de l'entrée à la flash : en place → porte entrouverte (crochetée d'abord si elle est verrouillée)
  // → flash glissée par l'entrebâillement → éclair → porte ouverte en grand → entrée. Si le lanceur tombe ou que
  // la porte s'ouvre autrement, on retombe sur l'entrée ordinaire. Sert aussi aux colonnes de l'intervention (s.ai),
  // qui ne disent rien (sauf celles que vous commandez, s.cmd). f.kind : la sorte de grenade ; f.after : la porte vient
  // de sauter à la charge, on lance par la brèche.
  updateFlashEntry(s, team) {
    const f = s.flash, m = f.m, d = s.door, eps = 0.01, kind = f.kind || 'flash', name = kind === 'frag' ? 'grenade' : 'flash';
    const say = (t, k) => { if (!s.ai || s.cmd) this.say(t, k); };
    if (!m.alive || !(s.ai ? m.entry === s : m.order === 'stack')) { s.flash = null; return; }
    if (!f.after && f.phase !== 'open' && f.crack < 1 && (d.broken || d.progress >= 1 - eps)) { s.flash = null; return; }
    if (team.some(o => o.act) || m.stun > 0 || d.opening) return;
    // la porte, c'est le plus proche qui la manœuvre (le lanceur s'est parfois placé en retrait)
    const opener = team.filter(o => o.stun <= 0 && dist(o.x, o.y, d.cx, d.cy) < 2 * U)
      .sort((a, b) => dist(a.x, a.y, d.cx, d.cy) - dist(b.x, b.y, d.cx, d.cy))[0];
    const work = target => {
      if (!opener) return false;
      if (++f.tries > 4) { s.flash = null; say("La porte résiste — ouvrez-la, ils entrent", 2); return false; }
      return this.doorAction(opener, d, target);
    };
    switch (f.phase) {
      case 'place':
        if (dist(m.x, m.y, m.orderPos.x, m.orderPos.y) > 8) return;
        if (d.progress < f.crack - eps) { if (work(f.crack)) f.phase = 'crack'; return; }
        f.phase = 'throw';
        return;
      case 'crack':
        // crochetage puis ouverture : tant que la porte n'est pas au cran voulu, on recommence
        f.phase = d.progress < f.crack - eps ? 'place' : 'throw';
        return;
      case 'throw': {
        let aim = this.flashAimFrom(m.x, m.y, d, s.side, f.crack, f.depth || 0);
        // quelques pixels à côté du poste (bousculé en arrivant) : il s'y recale, l'angle a été pris de là
        if (!aim && this.map.circleFree(m.orderPos.x, m.orderPos.y, m.radius - 1, true)) {
          m.x = m.orderPos.x; m.y = m.orderPos.y;
          aim = this.flashAimFrom(m.x, m.y, d, s.side, f.crack, f.depth || 0);
        }
        if (!aim) { s.flash = null; say(`${m.name} : pas d'angle pour la ${name} — ${s.ai ? 'on entre' : 'ouvrez, on entre'}`, 2); return; }
        // une grenade à fragmentation ne part pas sur les siens (ni sur un otage) : on entre sans
        if (kind === 'frag' && [...this.teamOf(m), ...this.hostages].some(o => o.alive && !o.evacuated && dist(o.x, o.y, aim.x, aim.y) < FRAG_RADIUS + 0.5 * U)) {
          s.flash = null; say(`${m.name} : les nôtres sont trop près pour la grenade — on entre sans`, 2); return;
        }
        if (!(m.nades[kind] > 0)) { s.flash = null; return; }
        m.nades[kind]--;
        m.coverAngle = m.holdAngle = m.angle = Math.atan2(aim.y - m.y, aim.x - m.x);
        this.sfx('tick', m.x, m.y, 3 * U, 0.12); // goupille
        this.voice(m, kind);
        this.startAction(m, 'grenade', 0.45, () => {
          if (!m.alive) return;
          this.spawnFlash(m, aim.x, aim.y, MATE_COOK, d, kind);
          f.g = this.grenades[this.grenades.length - 1];
        });
        f.phase = 'boom';
        say(`${m.name} : ${name} !`, 1.2);
        return;
      }
      case 'boom':
        if (f.g && this.grenades.includes(f.g)) return;
        f.phase = 'open';
        f.tries = 0;
        if (d.progress < 1 - eps) work(1);
        return;
      case 'open':
        // (personne près de la porte pour finir de l'ouvrir : entrouverte, elle laisse passer, on entre ainsi)
        if (d.broken || d.progress >= 1 - eps || !opener) { this.endStack(s, team); return; }
        work(1);
    }
  }

  // Faute de poste qui convienne : une case de votre côté de la porte, libre (personne d'autre dessus, hors de la
  // course du battant), d'où une flash passe ; la plus proche de m, en préférant la porte seulement entrouverte.
  flashSpot(d, side, m, team, depth = 0) {
    // (une colonne de l'intervention ne tient compte que des siens : le joueur est en face)
    const cx = Math.floor(d.cx / TILE), cy = Math.floor(d.cy / TILE), others = (m.entry ? team : [this.player, ...team]).filter(o => o !== m);
    let best = null, bs = Infinity;
    for (const crack of [FLASH_CRACK, 1]) {
      const leaf = this.map.leafSeg({ ...d, progress: Math.max(d.progress, crack) });
      const lx = leaf.x1 - leaf.x0, ly = leaf.y1 - leaf.y0, ll = lx * lx + ly * ly;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const tx = cx + dx, ty = cy + dy, x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
        const across = (d.horizontal ? y - d.cy : x - d.cx) * side;
        if (across < 0.6 * U || across > 3 * U || !this.map.inBounds(tx, ty) || this.map.door(tx, ty)) continue;
        if (!this.map.circleFree(x, y, 12, true) || others.some(o => o.alive && dist(o.x, o.y, x, y) < 24)) continue;
        const t = clamp(((x - leaf.x0) * lx + (y - leaf.y0) * ly) / ll, 0, 1);
        if (dist(x, y, leaf.x0 + lx * t, leaf.y0 + ly * t) < 15) continue;
        const sc = dist(m.x, m.y, x, y);
        if (sc < bs && this.flashAimFrom(x, y, d, side, crack, depth)) { bs = sc; best = { x, y, crack }; }
      }
      if (best) return best;
    }
    return null;
  }

  // Point de chute d'une flash lancée de (x0, y0), du côté side de la porte, celle-ci ouverte au cran crack : dans la
  // pièce, à deux ou trois cases, sur une trajectoire qui franchit l'embrasure sans frôler le chambranle, ne touche le
  // battant ni avant ni après, et qu'aucun mur ni meuble n'arrête ; null s'il n'y en a pas. Le battant s'ouvrant
  // toujours du même côté, ce n'est pas le même poste qui convient selon qu'il part vers la pièce (on lance alors du
  // côté des gonds, en biais vers le bord libre) ou vers l'équipe (on lance du bord libre).
  flashAimFrom(x0, y0, d, side, crack = FLASH_CRACK, minDepth = 0) {
    const inX = d.horizontal ? 0 : -side, inY = d.horizontal ? -side : 0, ax = d.horizontal ? 1 : 0, ay = d.horizontal ? 0 : 1;
    const half = (d.len * TILE) / 2;
    const leaf = this.map.leafSeg({ ...d, progress: Math.max(d.progress, crack) });
    const lx = leaf.x1 - leaf.x0, ly = leaf.y1 - leaf.y0, ll = lx * lx + ly * ly;
    const nearLeaf = (x, y) => {
      const t = clamp(((x - leaf.x0) * lx + (y - leaf.y0) * ly) / ll, 0, 1);
      return dist(x, y, leaf.x0 + lx * t, leaf.y0 + ly * t) < 9;
    };
    const depthOf = (x, y) => (x - d.cx) * inX + (y - d.cy) * inY; // > 0 dans la pièce
    // en vol, près de la porte : ni mur ni fenêtre sous la grenade (l'embrasure de cette porte compte ouverte)
    const solid = (x, y) => this.map.door(Math.floor(x / TILE), Math.floor(y / TILE)) !== d && this.grenadeBlocked(x, y, true);
    const snag = (x, y) => solid(x - 5, y - 5) || solid(x + 5, y - 5) || solid(x - 5, y + 5) || solid(x + 5, y + 5);
    const d0 = depthOf(x0, y0);
    if (d0 >= 0) return null;
    for (const depth of [3, 2.5, 3.5, 2, 4, 1.5, 5].filter(k => k >= minDepth)) for (const lat of [0, -1, 1, -2, 2, -0.5, 0.5, -3, 3]) {
      const x = d.cx + inX * depth * U + ax * lat * U, y = d.cy + inY * depth * U + ay * lat * U;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty)) continue;
      const ang = Math.atan2(y - y0, x - x0);
      if (!this.aimCrossesDoor(x0, y0, ang, d)) continue;
      // passage de l'embrasure, à distance du chambranle
      const k = -d0 / (depthOf(x, y) - d0), along = d.horizontal ? x0 + (x - x0) * k - d.cx : y0 + (y - y0) * k - d.cy;
      if (Math.abs(along) > half - 8) continue;
      const sx = x0 + Math.cos(ang) * 14, sy = y0 + Math.sin(ang) * 14; // elle part de la main (voir spawnFlash)
      const len = dist(sx, sy, x, y), n = Math.ceil(len / 3);
      let ok = true, inside = null;
      for (let i = 0; i <= n && ok; i++) {
        const px = sx + (x - sx) * i / n, py = sy + (y - sy) * i / n, dp = depthOf(px, py);
        if (nearLeaf(px, py) || (dp < 12 && snag(px, py))) ok = false;
        else if (!inside && dp >= 12) inside = { x: px, y: py };
      }
      if (ok && inside && this.clearThrow(inside.x, inside.y, x, y)) return { x, y };
    }
    return null;
  }

  // Points d'arrivée d'une entrée : chacun vers l'angle de la pièce de son côté de l'embrasure (les suivants d'une
  // colonne plus longue, plus loin vers le milieu), tourné vers le fond.
  entrySpots(d, side, team) {
    const inX = d.horizontal ? 0 : -side, inY = d.horizontal ? -side : 0; // vers l'intérieur de la pièce
    const ax = d.horizontal ? 1 : 0, ay = d.horizontal ? 0 : 1;
    const taken = [];
    return team.map(m => {
      const rank = m.stackRank || 0, k = (m.stackSide || 1) * (rank ? 0.4 : 1), depth = 1.6 + rank * 0.8;
      const x = d.cx + inX * depth * U + ax * k * 1.5 * U, y = d.cy + inY * depth * U + ay * k * 1.5 * U;
      const sp = this.stackSpot(d, -side, x, y, m.radius, taken) || { x: d.cx + inX * 1.2 * U, y: d.cy + inY * 1.2 * U };
      taken.push(sp);
      const fx = d.cx + inX * 4 * U - ax * k * U, fy = d.cy + inY * 4 * U - ay * k * U;
      return { m, x: sp.x, y: sp.y, look: Math.atan2(fy - sp.y, fx - sp.x) };
    });
  }

  // Chacun franchit l'embrasure et file vers l'angle de la pièce de son côté, en surveillant le fond.
  launchEntry(d, side, team) {
    for (const sp of this.entrySpots(d, side, team)) {
      Object.assign(sp.m, { order: 'move', orderPos: { x: sp.x, y: sp.y }, repathT: 0, destTile: null, watchSpot: null, coverAngle: sp.look, holdAngle: sp.look, path: [] });
    }
    this.orderMarker = null;
    this.say('Entrée !', 1.2);
    this.voice(team.find(m => m.alive), 'entry');
  }

  // Fin d'une colonne : l'équipe du joueur entre sur ordre de déplacement (launchEntry) ; l'intervention rejoint ses
  // angles et les tient un instant avant de reprendre sa progression (clearStep).
  endStack(s, team) {
    if (!s.ai) { this.stack = null; this.launchEntry(s.door, s.side, team); return; }
    for (const sp of this.entrySpots(s.door, s.side, team)) {
      Object.assign(sp.m, { entry: null, path: [], repathT: 0, clear: { x: sp.x, y: sp.y, look: sp.look, t: AI_CLEAR, left: AI_CLEAR + 4 } });
    }
    this.dropStack(s);
  }

  orderFollow() {
    if (!this.canCommand(true)) return;
    const alive = this.ordered();
    if (!alive.length) return;
    for (const m of alive) { m.order = 'follow'; m.holdAngle = null; m.coverAngle = null; m.watchSpot = null; m.path = []; m.destTile = null; m.repathT = 0; }
    this.orderMarker = null;
    this.dropStackIfEmpty();
    this.say(`${this.orderName()} : suivez-moi`, 1.2);
  }

  toggleHold() {
    if (!this.canCommand(true)) return;
    const alive = this.ordered();
    if (!alive.length) return;
    const hold = !alive.every(m => m.order === 'hold');
    for (const m of alive) {
      m.order = hold ? 'hold' : 'follow';
      m.holdAngle = hold ? m.angle : null;
      m.coverAngle = null;
      m.watchSpot = null;
      m.path = []; m.destTile = null; m.repathT = 0;
    }
    this.orderMarker = null;
    this.dropStackIfEmpty();
    this.say(`${this.orderName()} : ${hold ? 'tenez la position' : 'suivez-moi'}`, 1.2);
  }

  // Un point est dans l'axe de tir du joueur (cône étroit devant lui), ou de p.
  inAimCone(x, y, halfAngle, p = this.player) {
    const d = dist(p.x, p.y, x, y);
    if (d < 6 || d > 7 * U) return false;
    return Math.abs(angleDiff(p.angle, Math.atan2(y - p.y, x - p.x))) < (halfAngle || 20 * DEG);
  }

  // Place du coéquipier en formation derrière le joueur, hors de son axe de tir,
  // sinon la case libre la plus proche visible du joueur. Un équipier d'un trinôme autonome se range de même derrière
  // son chef de file p, à la place off, dans le sens a (voir followStep).
  formationPos(m, p = this.player, off = m.slotOffset, a = p.moveDir === undefined ? p.angle : p.moveDir) {
    const [fx, fy] = off;
    const wx = p.x + (Math.cos(a) * fx - Math.sin(a) * fy) * U, wy = p.y + (Math.sin(a) * fx + Math.cos(a) * fy) * U;
    const bad = m.badDest && m.badDest.until > this.time && Math.abs(m.badDest.x - Math.floor(wx / TILE)) <= 1 && Math.abs(m.badDest.y - Math.floor(wy / TILE)) <= 1;
    if (!bad && this.map.circleFree(wx, wy, m.radius + 1, true) && this.map.hasLOS(p.x, p.y, wx, wy) && !this.inAimCone(wx, wy, 30 * DEG, p)) return { x: wx, y: wy };
    const mates = m.group ? m.group.members : this.mates;
    let best = null, bd = Infinity;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const tx = p.tx + dx, ty = p.ty + dy;
      if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty)) continue;
      if (!this.map.circleFree((tx + 0.5) * TILE, (ty + 0.5) * TILE, m.radius + 1, true)) continue;
      const dd = this.map.door(tx, ty);
      if (dd && !dd.open) continue;
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      if (dist(cx, cy, p.x, p.y) < U * 0.9) continue;
      if (!this.map.hasLOS(p.x, p.y, cx, cy)) continue;
      let score = dist(cx, cy, wx, wy);
      if (this.inAimCone(cx, cy, 35 * DEG, p)) score += 6 * U;
      if (m.badDest && m.badDest.until > this.time && Math.abs(m.badDest.x - tx) <= 1 && Math.abs(m.badDest.y - ty) <= 1) score += 10 * U;
      if (mates.some(o => o !== m && o.alive && o.destTile && o.destTile.x === tx && o.destTile.y === ty)) score += 2 * U;
      if (score < bd) { bd = score; best = { x: cx, y: cy }; }
    }
    return best || { x: p.x, y: p.y };
  }

  // Case libre proche, hors de l'axe de tir du joueur (pas de côté quand on tient la position).
  sidestepPos(m) {
    const p = this.player;
    let best = null, bd = Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const tx = m.tx + dx, ty = m.ty + dy;
      if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty) || this.map.door(tx, ty)) continue;
      if (!this.map.circleFree((tx + 0.5) * TILE, (ty + 0.5) * TILE, m.radius + 1, true)) continue;
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      if (this.inAimCone(cx, cy, 35 * DEG) || dist(cx, cy, p.x, p.y) < U) continue;
      const d = dist(cx, cy, m.x, m.y);
      if (d < bd) { bd = d; best = { x: cx, y: cy }; }
    }
    return best;
  }

  // Nombre de tuiles inexplorées le long d'un rayon (jusqu'au premier obstacle visuel).
  unexploredAlong(x, y, angle, maxDist) {
    const cs = Math.cos(angle), sn = Math.sin(angle);
    let count = 0, last = -1;
    for (let d = TILE / 2; d <= maxDist; d += TILE / 2) {
      const tx = Math.floor((x + cs * d) / TILE), ty = Math.floor((y + sn * d) / TILE);
      const k = ty * this.map.w + tx;
      if (k === last) continue;
      last = k;
      if (this.map.blocksSight(tx, ty)) break;
      if (!this.map.explored[k]) count++;
    }
    return count;
  }

  // Un allié (joueur ou autre coéquipier) se trouve sur la ligne de visée de (x,y) vers (tx,ty).
  friendOnLine(m, x, y, tx, ty, margin) {
    margin = margin === undefined ? 7 : margin;
    const d = dist(x, y, tx, ty);
    if (d < 1) return false;
    const cs = (tx - x) / d, sn = (ty - y) / d;
    for (const f of this.ops) {
      if (f === m || !f.alive) continue;
      // un coéquipier en route vers une autre case est jugé sur sa destination
      let fx = f.x, fy = f.y;
      if (f !== this.player && f.watchSpot) { fx = f.watchSpot.x; fy = f.watchSpot.y; }
      const rx = fx - x, ry = fy - y;
      const t = rx * cs + ry * sn;
      if (t < 4 || t > d) continue;
      if (Math.abs(rx * sn - ry * cs) < f.radius + margin) return true;
    }
    return false;
  }

  // Points d'intérêt vus depuis (x,y) : portes et zones inexplorées, avec un point cible.
  watchCandidates(x, y) {
    const cands = [];
    for (const d of this.map.doors) {
      const cx = d.cx, cy = d.cy;
      const dd = dist(x, y, cx, cy);
      if (dd < U || dd > 9 * U) continue;
      // Une porte fermée bloque la vue dans sa propre case : il suffit que le rayon atteigne cette case.
      const ang = Math.atan2(cy - y, cx - x);
      const r = this.map.castRay(x, y, ang, dd, false);
      if (r.hit && this.map.door(r.tx, r.ty) !== d) continue;
      cands.push({ angle: ang, score: 2.8 - dd / (9 * U) + (d.open ? 0.4 : 0), kind: 'door', tx: cx, ty: cy, door: d });
    }
    for (let k = 0; k < 24; k++) {
      const a = TAU * k / 24;
      const n = this.unexploredAlong(x, y, a, 10 * U);
      if (n < 4) continue;
      const r = this.map.castRay(x, y, a, 10 * U, false);
      cands.push({ angle: a, score: Math.min(2.4, 0.175 * n), kind: 'unknown', tx: r.x, ty: r.y });
    }
    return cands;
  }

  // Direction à surveiller au repos : portes visibles, zones inexplorées, sinon son secteur.
  // Chaque coéquipier évite la direction déjà couverte par un autre et toute ligne masquée par un allié :
  // soit il change de point d'intérêt, soit (si le point masqué vaut nettement mieux) il se décale.
  pickWatch(m) {
    // Direction imposée par le joueur : elle prime sur le choix automatique du point d'intérêt.
    if (m.coverAngle !== null) { m.watchKind = 'consigne'; return m.coverAngle; }
    const base = this.vipGuard() === m && m.vipPos ? m.vipPos.look
      : m.order === 'follow' ? this.player.moveDir + m.sector : (m.holdAngle === null ? m.angle : m.holdAngle);
    const cands = this.watchCandidates(m.x, m.y);
    cands.push({ angle: base, score: 0.6, kind: 'sector', tx: m.x + Math.cos(base) * 5 * U, ty: m.y + Math.sin(base) * 5 * U });
    const others = this.mates.filter(o => o !== m && o.alive && o.watchAngle !== undefined && o.watchAngle !== null);
    const scoreOf = c => {
      let s = c.score;
      // ne regarde pas le joueur ni ce que le joueur couvre déjà
      if (Math.abs(angleDiff(this.player.angle, c.angle)) < 25 * DEG) s -= 1.5;
      if (Math.abs(angleDiff(base, c.angle)) < 60 * DEG) s += 0.4;
      for (const o of others) if (Math.abs(angleDiff(o.watchAngle, c.angle)) < 35 * DEG) s -= 2;
      if (m.watchAngle !== null && m.watchAngle !== undefined && Math.abs(angleDiff(m.watchAngle, c.angle)) < 15 * DEG) s += 0.3; // stabilité
      return s;
    };
    let bestFree = null, bf = -Infinity, bestBlocked = null, bb = -Infinity;
    for (const c of cands) {
      const s = scoreOf(c);
      if (this.friendOnLine(m, m.x, m.y, c.tx, c.ty)) { if (s > bb) { bb = s; bestBlocked = c; } }
      else if (s > bf) { bf = s; bestFree = c; }
    }
    // Point masqué nettement plus intéressant : chercher une case proche d'où la ligne est dégagée.
    m.relocT = (m.relocT || 0);
    if (bestBlocked && bestBlocked.kind !== 'sector' && bb > bf + 0.8 && m.relocT <= this.time) {
      m.relocT = this.time + 2;
      const spot = this.findWatchSpot(m, bestBlocked);
      if (spot && dist(spot.x, spot.y, m.x, m.y) < 10) {
        // déjà sur cette case et toujours masqué : case écartée pour un moment
        m.badSpots = (m.badSpots || []).filter(b => b.until > this.time);
        m.badSpots.push({ x: spot.x, y: spot.y, until: this.time + 8 });
        m.watchSpot = null;
      } else if (spot) {
        m.watchSpot = spot;
        m.watchKind = bestBlocked.kind + ' (déplacement)';
        return Math.atan2(bestBlocked.ty - spot.y, bestBlocked.tx - spot.x);
      }
    }
    const best = bestFree || { angle: base, kind: 'sector' };
    m.watchKind = best.kind;
    return best.angle;
  }

  // Case libre proche de la position de référence, d'où le point visé est visible sans allié dans l'axe.
  findWatchSpot(m, c) {
    const ref = m.order === 'follow' ? this.formationPos(m) : { x: m.x, y: m.y };
    const rtx = Math.floor(ref.x / TILE), rty = Math.floor(ref.y / TILE);
    let best = null, bd = Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const tx = rtx + dx, ty = rty + dy;
      if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty) || this.map.door(tx, ty)) continue;
      if (!this.map.circleFree((tx + 0.5) * TILE, (ty + 0.5) * TILE, m.radius + 1, true)) continue;
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (dist(x, y, this.player.x, this.player.y) < U) continue;
      if (this.inAimCone(x, y, 35 * DEG)) continue;
      if (this.mates.some(o => o !== m && o.alive && dist(x, y, o.watchSpot ? o.watchSpot.x : o.x, o.watchSpot ? o.watchSpot.y : o.y) < U)) continue;
      if ((m.badSpots || []).some(b => b.until > this.time && dist(b.x, b.y, x, y) < 4)) continue;
      // le point doit rester visible depuis la case
      const d = dist(x, y, c.tx, c.ty);
      const r = this.map.castRay(x, y, Math.atan2(c.ty - y, c.tx - x), d, false);
      if (c.door) { if (r.hit && this.map.door(r.tx, r.ty) !== c.door) continue; }
      else if (r.dist < d - U) continue;
      if (this.friendOnLine(m, x, y, c.tx, c.ty, 14)) continue; // marge large : la position finale peut varier
      if (m.order === 'follow' && !this.map.hasLOS(this.player.x, this.player.y, x, y)) continue;
      const score = dist(x, y, m.x, m.y) + dist(x, y, ref.x, ref.y) * 0.5;
      if (score < bd) { bd = score; best = { x, y }; }
    }
    return best;
  }

  // Aucun allié ni otage sur la ligne de tir (alliés : l'équipe du tireur, quel que soit son camp).
  // x, y : position de tir supposée (par défaut celle du tireur).
  // extra : marge supplémentaire, pour choisir un point de tir qui restera valable une fois sur place.
  lineOfFireClear(shooter, target, x, y, extra) {
    if (x === undefined) { x = shooter.x; y = shooter.y; }
    const d = dist(x, y, target.x, target.y);
    const cs = (target.x - x) / d, sn = (target.y - y) / d;
    const friends = shooter.team === 'ops' ? this.ops : this.enemies;
    // Les tireurs entraînés (équipe et intervention) tiennent compte de la dispersion de leur rafale
    // et des otages juste derrière la cible : une balle qui la manque continue sa course.
    const trained = shooter instanceof Operator || shooter instanceof Teammate || !!shooter.hunter;
    // seule l'intervention se refuse aussi un otage derrière la cible : c'est sa mission
    const strict = shooter instanceof Operator;
    // L'intervention garde toute la marge de sa gerbe ; l'équipe s'en tient à la moitié, sans quoi
    // elle ne tire plus jamais dans une pièce encombrée. Une chevrotine ouvre en plus sa gerbe de plombs.
    const spread = this.spreadOf(shooter, d) + (shooter.weapon.pattern || 0);
    const cone = trained ? Math.tan(spread * (strict ? 1 : 0.5) + (strict ? 2 : 1) * DEG) : 0;
    for (const f of [...friends, ...this.hostages]) {
      if (f === shooter || f === target || !f.alive || f.evacuated) continue;
      const rx = f.x - x, ry = f.y - y;
      const t = rx * cs + ry * sn;
      const behind = strict && f.team === 'civ' ? 2.5 * U : 0;
      if (t < 0 || t > d + behind) continue;
      if (Math.abs(rx * sn - ry * cs) < f.radius + 6 + cone * t + (extra || 0)) return false;
    }
    return true;
  }

  // Case proche d'où la cible est visible sans allié ni otage dans l'axe (recalculée par à-coups).
  firingSpot(m, t) {
    if (m.fireSpotT > this.time && m.fireSpot) return m.fireSpot;
    m.fireSpotT = this.time + 0.5;
    let best = null, bd = Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const tx = m.tx + dx, ty = m.ty + dy;
      if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty) || this.map.door(tx, ty)) continue;
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (!this.map.circleFree(x, y, m.radius + 1, true)) continue;
      // un coéquipier ne se place ni sur le joueur ni dans son axe de visée (s'il est debout)
      if (m.team === 'ops' && this.player.alive && dist(x, y, this.player.x, this.player.y) < 0.8 * U) continue;
      if (m.team === 'ops' && this.player.alive && this.inAimCone(x, y, 30 * DEG)) continue;
      if (dist(x, y, t.x, t.y) > this.fireRange(m)) continue;
      if (!this.map.hasLOS(x, y, t.x, t.y)) continue;
      if (!this.lineOfFireClear(m, t, x, y, 12)) continue; // de quoi rester dégagé une fois arrivé
      if (this.map.coverShields(x, y, t.x, t.y)) continue;  // (ni d'où elle reste à l'abri d'un couvert bas)
      const score = dist(x, y, m.x, m.y);
      if (score < bd) { bd = score; best = { x, y }; }
    }
    m.fireSpot = best;
    return best;
  }

  mateCombat(m, dt) {
    let t = m.target;
    if (t && (!t.alive || t.surrender || dist(m.x, m.y, t.x, t.y) > this.viewOf(m, Math.atan2(t.y - m.y, t.x - m.x)) || !this.map.hasLOS(m.x, m.y, t.x, t.y))) t = null;
    if (!t) {
      t = this.acquireFor(m, this.enemies);
      if (t) {
        m.reactT = m.reaction;
        // le premier qui voit l'annonce (un seul à la fois dans l'équipe)
        if (this.time - (this.calloutT || -9) > 4) { this.calloutT = this.time; this.voice(m, 'spot'); }
        // un suspect qui ne les a pas vus, ou sonné : d'abord la sommation (canSummon, une à la fois pour l'équipe)
        if (this.canSummon() && !t.hunter && (t.stun > 0 || !t.target) && this.time - this.shoutT >= SHOUT_COOLDOWN && dist(m.x, m.y, t.x, t.y) <= SHOUT_RANGE) {
          const r = this.summon(m);
          if (r.gave) this.say(`${m.name} : ${r.gave > 1 ? `${r.gave} suspects se rendent` : 'le suspect se rend'}`, 1.8);
          if (t.surrender) t = null;
        }
      }
    }
    m.target = t;
    if (!t) {
      m.engaged = false;
      m.blockedT = 0; m.blockedLine = false; m.fireSpot = null;
      if (m.alertAngle !== null && turnToward(m, m.alertAngle, m.turnRate, dt)) m.alertAngle = null;
      return;
    }
    m.alertAngle = null;
    const a = Math.atan2(t.y - m.y, t.x - m.x);
    const d = dist(m.x, m.y, t.x, t.y);
    m.aimDist = d;
    m.engaged = d <= this.fireRange(m);
    // Discipline de tir : un allié ou un otage dans l'axe interdit le tir. Si ça dure, le coéquipier
    // ne doit pas rester planté : il redevient mobile (ordres, repli de côté) tout en gardant sa cible.
    const clear = this.lineOfFireClear(m, t);
    m.blockedT = clear ? 0 : m.blockedT + dt;
    // la cible s'abrite derrière un couvert bas : au bout de COVER_FLANK s, il cherche à la déborder (firingSpot)
    m.coverT = this.map.coverShields(m.x, m.y, t.x, t.y) ? (m.coverT || 0) + dt : 0;
    m.blockedLine = m.blockedT > 0.35 || m.coverT > COVER_FLANK;
    turnToward(m, a, m.turnRate, dt);
    m.reactT -= dt;
    if (m.engaged && m.reactT <= 0 && m.pauseT <= 0 && m.fireT <= 0 && m.reloadT <= 0 && !m.act && Math.abs(angleDiff(m.angle, a)) < 0.15) {
      if (m.slot.mag <= 0) { this.mateReload(m); return; }
      if (!clear) return;
      this.fireWeapon(m);
      // rafales courtes, paires en semi-automatique, coup par coup à la pompe (selon l'arme, voir BURST_PAUSE)
      if (--m.burstLeft <= 0) this.endBurst(m, m.weapon);
    }
  }

  // Détection de blocage d'un équipier qui suit (repoussé par un allié, coincé contre un angle) : nouveau trajet,
  // puis, si ça persiste, abandon temporaire de cette case.
  trackStuck(m, dt) {
    if (m.lastStep && m.moving) {
      if (dist(m.x, m.y, m.lastStep.x, m.lastStep.y) < 0.4) m.stuckT = (m.stuckT || 0) + dt;
      else { m.stuckT = 0; }
    }
    if ((m.stuckT || 0) > 0.6) {
      m.stuckT = 0;
      m.stuckCount = (m.stuckCount || 0) + 1;
      m.repathT = 0; m.path = [];
      if (m.destTile && m.stuckCount >= 2) {
        m.badDest = { x: m.destTile.x, y: m.destTile.y, until: this.time + 4 };
        m.watchSpot = null; m.formT = 0;
        m.stuckCount = 0;
      }
    }
    if (m.stuckCount && !m.moving) m.stuckCount = 0;
  }

  updateMate(m, dt) {
    if (!m.alive) return;
    this.trackStuck(m, dt);
    m.fireT -= dt; m.pauseT -= dt; m.repathT -= dt;
    m.bloom = Math.max(0, m.bloom - dt * 7 * DEG);
    if (m.reloadT > 0) {
      const k0 = 1 - m.reloadT / m.reloadDur;
      m.reloadT -= dt;
      this.reloadCues(m, m.weapon, k0, 1 - Math.max(0, m.reloadT) / m.reloadDur);
      if (m.reloadT <= 0) m.slot.mag = m.weapon.mag;
    }
    if (m.stun > 0) { m.stun -= dt; m.target = null; m.moving = false; return; }
    this.mateCombat(m, dt);
    // recharge tranquille quand rien en vue
    if (!m.target && m.reloadT <= 0 && !m.act && m.slot.mag <= m.weapon.mag * 0.35) this.mateReload(m);
    if (this.cuffStep(m, dt)) return;

    let dest = null;
    const guard = this.vipGuard() === m; // (escorte : il couvre le VIP plutôt que de vous suivre)
    if (m.watchSpot) {
      // position d'observation : abandonnée si le joueur s'éloigne ou vise dessus, ou pendant un ordre de déplacement
      const invalid = m.order === 'move' || m.order === 'stack' || m.target || guard
        || (m.order === 'follow' && (this.player.moving || dist(m.watchSpot.x, m.watchSpot.y, this.player.x, this.player.y) > 3.5 * U))
        || this.inAimCone(m.watchSpot.x, m.watchSpot.y, 25 * DEG);
      if (invalid) m.watchSpot = null;
    }
    if (m.order === 'move' || m.order === 'stack') dest = m.orderPos;
    else if (m.blockedLine && m.target) dest = this.firingSpot(m, m.target);
    else if (guard) {
      if (!m.vipPos || m.vipPosT <= this.time) { m.vipPos = this.guardVipPos(m); m.vipPosT = this.time + 0.25; }
      dest = m.vipPos;
    } else if (m.watchSpot) dest = m.watchSpot;
    else if (m.order === 'follow') dest = this.formationPos(m);
    else if (m.order === 'hold' && this.inAimCone(m.x, m.y, 18 * DEG)) {
      // en position mais dans l'axe de tir du joueur : pas à pas de côté
      m.aimT = (m.aimT || 0) + dt;
      if (m.aimT > 0.4) dest = this.sidestepPos(m);
    } else m.aimT = 0;
    if (m.order === 'follow') {
      // déjà en place mais le joueur vise à travers lui : on laisse formationPos choisir une autre case
      m.aimT = this.inAimCone(m.x, m.y, 18 * DEG) ? (m.aimT || 0) + dt : 0;
    }
    // Au contact on s'arrête pour tirer, sauf sous un ordre de déplacement (il reste prioritaire)
    // et sauf si l'axe est bouché (il faut alors se décaler).
    if (m.engaged && !m.blockedLine && m.order !== 'move' && !guard) { m.path = []; m.moving = false; }
    else if (dest) {
      const d = dist(m.x, m.y, dest.x, dest.y);
      const arrive = m.order === 'move' || m.order === 'stack' || dest === m.watchSpot || dest === m.fireSpot ? 4 : 12;
      if (d > arrive) {
        const tile = { x: Math.floor(dest.x / TILE), y: Math.floor(dest.y / TILE) };
        const changed = !m.destTile || m.destTile.x !== tile.x || m.destTile.y !== tile.y;
        if (changed || m.repathT <= 0 || !m.path.length) {
          const avoid = this.ops.filter(o => o !== m && o.alive).map(o => ({ x: o.x, y: o.y, r: (m.stuckCount ? 30 : 22) }));
          // en suivi ou en colonne, on n'ouvre pas de porte (la colonne attend justement devant la sienne)
          const path = this.map.routeTo(m.x, m.y, tile.x, tile.y, m.radius, { noClosedDoors: m.order === 'follow' || m.order === 'stack', avoid });
          m.path = path || [];
          if (m.path.length) m.path[m.path.length - 1] = { x: dest.x, y: dest.y };
          // déjà dans la case de son point, à quelques pixels : le chemin est vide, il finit en ligne droite (sans quoi il
          // s'arrêtait là, à côté de son poste de colonne)
          else if (d < 1.5 * TILE) m.path = [{ x: dest.x, y: dest.y }];
          m.destTile = tile;
          m.repathT = 0.4;
        }
        m.speed = d > 3 * U ? 118 : 78;
        m.walkMode = d <= 3 * U;
        const bx = m.x, by = m.y;
        this.moveAlong(m, dt);
        m.lastStep = { x: bx, y: by };
      } else {
        m.path = []; m.moving = false;
        if (m.order === 'move') { m.order = 'hold'; this.orderMarker = null; }
      }
    } else { m.moving = false; }

    // posture au repos : surveille un point d'intérêt et fait des balayages de contrôle
    if (!m.target && !m.moving && m.alertAngle === null) {
      m.watchT = (m.watchT || 0) - dt;
      if (m.watchT <= 0) { m.watchT = rand(0.8, 1.3); m.watchAngle = this.pickWatch(m); }
      m.sweepT = (m.sweepT === undefined ? rand(2.5, 4.5) : m.sweepT) - dt;
      // pas de balayage quand la direction est imposée par le joueur
      if (m.sweepT <= 0 && !m.sweep && m.coverAngle === null) { m.sweep = { t: 0, dur: rand(1.4, 2), amp: rand(0.5, 0.85) * (Math.random() < 0.5 ? -1 : 1) }; m.sweepT = rand(3.5, 6.5); }
      let want = m.watchAngle === undefined || m.watchAngle === null ? m.angle : m.watchAngle;
      if (m.sweep) {
        m.sweep.t += dt;
        const off = Math.sin(m.sweep.t / m.sweep.dur * Math.PI) * m.sweep.amp;
        const sa = want + off;
        // le balayage ne passe pas sur un allié : il s'arrête avant
        if (this.friendOnLine(m, m.x, m.y, m.x + Math.cos(sa) * 6 * U, m.y + Math.sin(sa) * 6 * U)) m.sweep.t = Math.max(m.sweep.t, m.sweep.dur - m.sweep.t);
        else want = sa;
        if (m.sweep.t >= m.sweep.dur) m.sweep = null;
      }
      turnToward(m, want, 3.5, dt);
    } else if (m.moving) { m.watchT = 0; m.sweep = null; }
  }
});
