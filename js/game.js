'use strict';
// Logique temps réel : joueur, ennemis, balles, portes, grenades, vision.
// Mode siège : effectif de chaque vague d'assaut, dans l'ordre d'entrée.
const SIEGE_WAVES = [3, 3, 3];
// Délai entre la mort du joueur et la reprise dans un coéquipier (on voit tomber son personnage).
const RELAY_DELAY = 1.2;
// Portée du ramassage d'une arme au sol, depuis le corps qui la porte.
const PICKUP_RANGE = 1.3 * U;
// Dégâts d'un seul coup au-delà desquels un otage meurt sans passer par la blessure.
const HOSTAGE_GRAVE = 45;
// Grenade à fragmentation (camp du groupe armé en siège) : rayon létal et dégâts au centre.
const FRAG_RADIUS = 3.5 * U;
const FRAG_DAMAGE = 200;

class Game {
  constructor() {
    this.levelIndex = 0;
    this.listeners = {};
    this.input = { keys: {}, pressed: {}, mouse: { x: 0, y: 0, down: false, rdown: false } };
    this.orderDrag = null; // ordre de déplacement en cours de tracé (clic droit maintenu)
    this.visionPolys = [];
    this.camShake = 0;
    this.camKick = { x: 0, y: 0 };
    this.paused = false;
    this.over = null;
    this.mode = Game.loadSavedMode();
    this.loadout = Game.loadSavedLoadout(this.mode);
  }

  static loadSavedMode() {
    try { const m = localStorage.getItem('breach.mode'); if (MODES[m]) return m; } catch (e) { /* stockage indisponible */ }
    return 'assault';
  }

  // Bascule assaut / siège : on recharge la mission dans l'autre rôle.
  setMode(mode) {
    if (!MODES[mode] || mode === this.mode) return;
    this.mode = mode;
    try { localStorage.setItem('breach.mode', mode); } catch (e) { /* stockage indisponible */ }
    this.loadout = Game.loadSavedLoadout(mode);
    this.loadLevel(this.levelIndex);
  }

  // Équipement choisi au briefing, mémorisé dans le navigateur quand c'est possible.
  static loadSavedLoadout(mode) {
    const m = MODES[mode] || MODES.assault;
    try {
      const l = JSON.parse(localStorage.getItem('breach.loadout.' + mode));
      if (l && m.primaries.includes(l.primary) && m.sidearms.includes(l.sidearm)) return l;
    } catch (e) { /* stockage indisponible */ }
    return { ...m.loadout };
  }

  setLoadout(l) {
    this.loadout = { ...this.loadout, ...l };
    try { localStorage.setItem('breach.loadout.' + this.mode, JSON.stringify(this.loadout)); } catch (e) { /* stockage indisponible */ }
    this.player.equip(this.loadout);
    this.emit('weapon');
  }

  on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); }
  emit(evt, data) { (this.listeners[evt] || []).forEach(fn => fn(data)); }

  loadLevel(i) {
    const def = LEVELS[i];
    this.levelIndex = i;
    this.def = def;
    this.map = new GameMap(def);
    const c = t => ({ x: (t.x + 0.5) * TILE, y: (t.y + 0.5) * TILE });
    const entry = this.map.spawns[0] || { x: 1, y: 1 };
    const siege = this.mode === 'siege';
    // En siège, on incarne le groupe armé : on part d'un poste de suspect, le plus loin de l'entrée,
    // et c'est l'équipe d'intervention qui arrive par l'entrée.
    const posts = this.map.enemySpawns.slice().sort((a, b) =>
      dist(c(b).x, c(b).y, c(entry).x, c(entry).y) - dist(c(a).x, c(a).y, c(entry).x, c(entry).y));
    // En assaut, l'équipe entre par une ouverture sur l'extérieur (choisie au briefing).
    const breaches = this.map.breaches;
    this.entryIndex = breaches.length ? clamp(this.entryIndex || 0, 0, breaches.length - 1) : 0;
    const entryBreach = !siege && breaches.length ? breaches[this.entryIndex] : null;
    const s = siege && posts.length ? posts[0]
      : entryBreach ? this.entryStart(entryBreach)
      : entry;
    this.player = new Player(c(s).x, c(s).y, this.loadout);
    this.player.style = siege ? { ...STYLE_BOSS } : { ...STYLE_PLAYER };
    this.armGrenades(this.player);
    this.player.angle = Math.atan2(this.map.h * TILE / 2 - this.player.y, this.map.w * TILE / 2 - this.player.x);
    const weps = def.enemyWeapons || ['ak'];
    this.enemies = siege ? [] : this.map.enemySpawns.map(sp => {
      const p = c(sp);
      return new Enemy(p.x, p.y, sp.angle, weps[Math.floor(Math.random() * weps.length)]);
    });
    this.hostages = this.map.hostageSpawns.map(sp => { const p = c(sp); return new Hostage(p.x, p.y); });
    if (entryBreach) this.clearEntryZone(entryBreach);
    this.player.moveDir = this.player.angle;
    // Coéquipiers : cases libres les plus proches du point de départ.
    const free = [];
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const tx = s.x + dx, ty = s.y + dy;
      if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty) || this.map.door(tx, ty)) continue;
      if (!this.map.circleFree((tx + 0.5) * TILE, (ty + 0.5) * TILE, 12, true)) continue;
      free.push({ x: tx, y: ty, d: Math.hypot(dx, dy) });
    }
    free.sort((a, b) => a.d - b.d);
    const taken = [{ x: this.player.x, y: this.player.y }];
    const mateDefs = siege ? SIEGE_MATE_DEFS.slice(0, Math.max(1, Math.min(SIEGE_MATE_DEFS.length, posts.length - 1))) : TEAMMATE_DEFS;
    this.mates = mateDefs.map(d => {
      let t = free.find(f => taken.every(o => dist((f.x + 0.5) * TILE, (f.y + 0.5) * TILE, o.x, o.y) >= 26)) || s;
      taken.push({ x: (t.x + 0.5) * TILE, y: (t.y + 0.5) * TILE });
      const m = new Teammate((t.x + 0.5) * TILE, (t.y + 0.5) * TILE, d);
      m.angle = this.player.angle;
      return m;
    });
    if (siege) {
      // Les complices démarrent à leur poste (les autres emplacements de suspects), en position tenue.
      const free = posts.slice(1);
      this.mates.forEach((m, i) => {
        const sp = free[i % Math.max(1, free.length)];
        if (sp) { const q = c(sp); m.x = q.x; m.y = q.y; m.angle = sp.angle === null || sp.angle === undefined ? rand(0, TAU) : sp.angle; }
        m.order = 'hold';
        m.holdAngle = m.angle;
      });
      this.startSiege(entry, c(entry));
    } else this.siege = null;
    this.bullets = [];
    this.grenades = [];
    this.effects = [];
    this.casings = [];
    this.decals = []; // file d'attente consommée par le rendu
    this.time = 0;
    this.over = null;
    this.loseReason = '';
    this.paused = false;
    this.stats = { kills: 0, shots: 0, hits: 0, flashes: 0, losses: 0 };
    this.orderMarker = null;
    this.orderDrag = null;
    this.relayT = 0;
    this.pickHint = null;
    this.message = { text: '', t: 0 };
    this.computeVision();
    this.emit('level');
  }

  // Case de départ en assaut : un peu en retrait de l'ouverture, pour ne pas coller l'équipe au mur
  // (un coéquipier coincé entre le joueur et la façade ne pourrait plus passer).
  entryStart(b) {
    let best = { x: Math.floor(b.inside.x / TILE), y: Math.floor(b.inside.y / TILE) };
    const room = this.map.roomOf(b.inside.x, b.inside.y);
    for (let k = 1; k <= 4; k++) {
      const tx = best.x + Math.round(Math.cos(b.angle)), ty = best.y + Math.round(Math.sin(b.angle));
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (!room.has(ty * this.map.w + tx) || !this.map.circleFree(x, y, 14, true)) break;
      best = { x: tx, y: ty };
      if (k >= 2) break; // deux cases fines (une case de carte) suffisent
    }
    return best;
  }

  // En assaut, personne n'attend dans la pièce d'entrée : un suspect ou un otage placé là par la
  // carte est reporté sur la case libre la plus proche hors de cette pièce (donc derrière une porte).
  clearEntryZone(breach) {
    const room = this.map.roomOf(breach.inside.x, breach.inside.y);
    if (!room.size) return;
    const all = [...this.enemies, ...this.hostages];
    const key = a => Math.floor(a.y / TILE) * this.map.w + Math.floor(a.x / TILE);
    for (const a of all) {
      if (!room.has(key(a))) continue;
      let best = null, bestD = Infinity;
      for (let ty = 0; ty < this.map.h; ty++) for (let tx = 0; tx < this.map.w; tx++) {
        const i = ty * this.map.w + tx;
        if (room.has(i) || this.map.tiles[i] !== 0 || this.map.blocksMove(tx, ty) || this.map.door(tx, ty)) continue;
        const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
        if (!this.map.circleFree(x, y, 12, true)) continue;
        if (all.some(o => o !== a && dist(o.x, o.y, x, y) < 26)) continue;
        const d = dist(a.x, a.y, x, y);
        if (d < bestD) { bestD = d; best = { x, y }; }
      }
      if (best) { a.x = best.x; a.y = best.y; }
    }
  }

  get ops() { return [this.player, ...(this.mates || [])]; }

  // ---- Mode siège ----
  // L'équipe d'intervention entre par l'entrée de la carte après un temps de préparation, puis
  // nettoie le bâtiment secteur par secteur. On gagne en repoussant toutes les vagues.
  startSiege(entryTile, entryPos) {
    const breaches = this.map.breaches.length
      ? this.map.breaches
      : [{ kind: 'door', cx: entryPos.x, cy: entryPos.y, inside: entryPos, angle: 0, door: null }];
    this.siege = {
      entry: entryPos,
      breaches,
      prep: 10,        // temps de préparation avant l'assaut
      waves: SIEGE_WAVES.slice(), // effectif de chaque vague ; on gagne quand la dernière est repoussée
      wave: 0,         // vagues déjà entrées
      nextWave: 0,     // compte à rebours de la vague suivante
      gap: 6,          // répit une fois la vague en cours éliminée
      maxGap: 30,      // au-delà, la vague suivante entre même si la précédente tient encore
      lastBreach: -1,
      sectors: this.buildSectors(entryPos),
    };
    // Vous connaissez les lieux : le plan est acquis dès le départ (mais on ne voit toujours
    // que ce qui est dans son champ de vision).
    const m = this.map;
    for (let i = 0; i < m.explored.length; i++) if (m.tiles[i] !== 2) m.explored[i] = 1;
  }

  // Points de passage à nettoyer, du plus proche de l'entrée au plus lointain.
  buildSectors(entry) {
    const m = this.map, out = [];
    for (let ty = 2; ty < m.h - 2; ty += 5) for (let tx = 2; tx < m.w - 2; tx += 5) {
      if (m.blocksMove(tx, ty) || m.tile(tx, ty) !== 0) continue;
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (!m.circleFree(x, y, 12, false)) continue;
      out.push({ x, y, done: false });
    }
    const near = p => Math.min(...(this.map.breaches.length ? this.map.breaches : [{ cx: entry.x, cy: entry.y }])
      .map(b => dist(p.x, p.y, b.cx, b.cy)));
    out.sort((a, b) => near(a) - near(b));
    return out;
  }

  // Une vague entre par une ouverture, différente de la précédente quand c'est possible :
  // on ne doit jamais être sûr du côté par lequel ils arrivent.
  spawnAssault(n) {
    const s = this.siege, weps = ['hk416op', 'mp5op'], bs = s.breaches;
    const i = bs.length > 1
      ? (s.lastBreach + 1 + Math.floor(Math.random() * (bs.length - 1))) % bs.length
      : 0;
    s.lastBreach = i;
    const b = bs[i];
    const placed = [];
    for (let k = 0; k < n; k++) {
      // en file vers l'intérieur, puis de côté si la place manque : jamais deux au même point
      let x = b.inside.x, y = b.inside.y;
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
      search: for (let r = 0; r <= 5; r++) for (const side of [0, 1, -1, 2, -2]) {
        const cx = b.inside.x + ca * r * 16 - sa * side * 16, cy = b.inside.y + sa * r * 16 + ca * side * 16;
        if (!this.map.circleFree(cx, cy, 11, false)) continue;
        if (placed.some(q => dist(q.x, q.y, cx, cy) < 20)) continue;
        x = cx; y = cy; break search;
      }
      placed.push({ x, y });
      const op = new Operator(x, y, b.angle, weps[k % weps.length]);
      // entrer prend du temps : on enjambe la fenêtre ou on pousse la porte, arme basse
      if (b.door && k === 0) this.doorAction(op, b.door, 1);
      else this.startAction(op, b.kind === 'window' ? 'window' : 'door', b.kind === 'window' ? 1.3 : 0.6, null);
      this.enemies.push(op);
    }
    s.wave++;
    return b;
  }

  updateSiege(dt) {
    const s = this.siege;
    if (s.prep > 0) {
      s.prep -= dt;
      if (s.prep <= 0) {
        const b = this.spawnAssault(s.waves[0]);
        s.nextWave = s.maxGap;
        this.say(`L'assaut commence — ${this.map.breachLabel(b)} (vague 1 / ${s.waves.length})`, 3);
        Sound.door();
      }
      return;
    }
    if (s.wave < s.waves.length) {
      // Pas d'attente inutile : la vague suivante suit de peu l'élimination de la précédente.
      if (!this.enemies.some(e => e.alive) && s.nextWave > s.gap) {
        s.nextWave = s.gap;
        this.say(`Vague repoussée — la suivante arrive (${s.wave + 1} / ${s.waves.length})`, 2.5);
      }
      s.nextWave -= dt;
      if (s.nextWave <= 0) {
        const b = this.spawnAssault(s.waves[s.wave]);
        s.nextWave = s.maxGap;
        this.say(`Vague ${s.wave} / ${s.waves.length} — ${this.map.breachLabel(b)}`, 2.5);
        Sound.door();
      }
    }
    this.updateHostageRescue(dt);
  }

  // L'intervention ne vient pas seulement vous chercher : elle récupère les otages. Un otage
  // gardé quelques secondes par un opérateur est sorti du jeu, et sans otage il n'y a plus rien
  // à négocier.
  updateHostageRescue(dt) {
    for (const h of this.hostages) {
      if (!h.alive || h.secured) continue;
      let op = null;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (this.canSee(e, h)) h.found = true;
        if (dist(e.x, e.y, h.x, h.y) < 1.3 * U && this.map.hasLOS(e.x, e.y, h.x, h.y)) op = e;
      }
      h.secureT = op ? h.secureT + dt : Math.max(0, h.secureT - dt * 0.6);
      if (h.secureT >= 4) {
        h.secured = true;
        this.say('Un otage vient de leur être remis', 3);
      }
    }
  }

  restart() { this.loadLevel(this.levelIndex); }
  say(text, t) { this.message = { text, t: t || 2.5 }; }
  setPaused(v) { if (this.over) return; this.paused = v; this.emit('pause'); }

  // ---- Boucle ----
  update(dt) {
    if (!this.over && !this.paused) this.step(dt);
    if (!this.paused) this.updateDying(dt);
    this.computeVision();
    this.camShake = Math.max(0, this.camShake - dt * 10);
    const kd = Math.pow(0.002, dt);
    this.camKick.x *= kd; this.camKick.y *= kd;
    for (const a of [...this.ops, ...this.enemies]) if (a.kick > 0) a.kick = Math.max(0, a.kick - dt * 9);
    this.input.pressed = {};
  }

  // Dispersion courante (demi-angle) : arme + déplacement (réduit en marche) + tirs récents (recul)
  // + distance de visée au-delà de la portée efficace. L'erreur linéaire à la cible vaut tan(spread) * distance.
  spreadOf(agent, aimDist) {
    const w = agent.weapon;
    const move = agent.moving ? w.moveSpread * (agent.walkMode ? 0.25 : 1) : 0;
    // mains occupées (porte, grenade) : l'arme n'est plus épaulée, le viseur s'ouvre en grand
    let s = w.spread + move + agent.bloom + (agent.handBloom || 0) + (agent.act ? 7 * DEG : 0);
    const d = aimDist === undefined ? agent.aimDist || 0 : aimDist;
    if (w.effRange && d > w.effRange) s += (w.rangeSpread || 0) * Math.min(1.5, (d - w.effRange) / w.effRange);
    return s * (agent.spreadMul || 1);
  }

  // Animation de mort : l'agent glisse un peu dans la direction du tir puis s'effondre.
  updateDying(dt) {
    for (const a of [...this.ops, ...this.enemies]) {
      const d = a.dying;
      if (!d) continue;
      d.t += dt;
      const k = clamp(d.t / d.dur, 0, 1);
      if (k < 0.5) {
        const sp = 40 * (1 - k * 2);
        const nx = a.x + Math.cos(d.dir) * sp * dt, ny = a.y + Math.sin(d.dir) * sp * dt;
        if (this.map.circleFree(nx, ny, a.radius - 3, false)) { a.x = nx; a.y = ny; }
      }
      if (k >= 1) {
        a.dying = null;
        this.decals.push({ type: 'pool', x: a.x, y: a.y, rot: a.bodyAngle });
      }
    }
  }

  step(dt) {
    this.time += dt;
    for (const d of this.map.doors) {
      if (d.opening) {
        // animation dans les deux sens (ouverture ou fermeture)
        const dir = Math.sign(d.target - d.progress);
        d.progress += dir * dt / d.duration;
        if ((dir >= 0 && d.progress >= d.target) || (dir < 0 && d.progress <= d.target)) {
          d.progress = d.target;
          d.opening = false;
          d.open = d.target >= 1;
          d.ajar = !d.open && d.target > 0;
        }
      }
    }
    if (this.siege) this.updateSiege(dt);
    this.updateActions(dt);
    this.updatePlayer(dt);
    for (const m of this.mates) this.updateMate(m, dt);
    for (const e of this.enemies) (this.siege ? this.updateAssault(e, dt) : this.updateEnemy(e, dt));
    this.separate();
    this.updateBullets(dt);
    this.updateGrenades(dt);
    for (const c of this.casings) {
      c.t += dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= 0.9; c.vy *= 0.9; c.rot += c.spin * dt;
      if (c.t >= c.life) this.decals.push({ type: 'casing', x: c.x, y: c.y, rot: c.rot });
    }
    this.casings = this.casings.filter(c => c.t < c.life);
    for (const f of this.effects) f.t += dt;
    this.effects = this.effects.filter(f => f.t < f.life);
    if (this.message.t > 0) this.message.t -= dt;
    // Joueur tombé : après un court instant, on reprend la partie dans un coéquipier encore debout.
    if (!this.player.alive && this.mates.some(m => m.alive)) {
      this.relayT += dt;
      if (this.relayT >= RELAY_DELAY) this.takeOver();
    }
    this.checkEnd();
  }

  checkEnd() {
    if (this.over) return;
    if (this.siege) {
      if (!this.ops.some(o => o.alive)) { this.over = 'lose'; this.loseReason = 'Vous êtes tous tombés : le bâtiment est repris.'; }
      // Perdre un otage coûte cher, mais la partie ne s'arrête que quand il n'en reste plus
      // aucun de vivant entre vos mains (tous morts, ou morts et récupérés).
      else if (this.hostages.length && this.hostages.every(h => !h.alive)) { this.over = 'lose'; this.loseReason = "Tous les otages sont morts : vous n'avez plus rien à négocier, l'assaut passe en force."; }
      else if (this.hostages.length && this.hostages.every(h => h.secured || !h.alive)) {
        this.over = 'lose';
        this.loseReason = this.hostages.every(h => h.secured)
          ? 'Tous les otages ont été récupérés : vous ne négociez plus rien.'
          : "Plus aucun otage vivant entre vos mains : vous ne négociez plus rien.";
      }
      else if (this.siege.wave >= this.siege.waves.length && !this.enemies.some(e => e.alive)) this.over = 'win';
    } else if (!this.ops.some(o => o.alive)) { this.over = 'lose'; this.loseReason = "Toute l'équipe est hors de combat."; }
    else if (this.hostages.some(h => !h.alive)) { this.over = 'lose'; this.loseReason = 'Un otage a été tué.'; }
    else if (this.enemies.every(e => !e.alive)) this.over = 'win';
    if (this.over) this.emit('over', this.over);
  }

  // ---- Joueur ----
  updatePlayer(dt) {
    const p = this.player, k = this.input.keys, m = this.input.mouse, pr = this.input.pressed;
    if (!p.alive) return;
    if (p.flashT > 0) p.flashT -= dt;
    if (p.stun > 0) p.stun -= dt;
    p.angle = Math.atan2(m.y - p.y, m.x - p.x);
    p.aimDist = dist(p.x, p.y, m.x, m.y);

    let dx = ((k.KeyD || k.ArrowRight) ? 1 : 0) - ((k.KeyA || k.ArrowLeft) ? 1 : 0);
    let dy = ((k.KeyS || k.ArrowDown) ? 1 : 0) - ((k.KeyW || k.ArrowUp) ? 1 : 0);
    if (pr.KeyQ || pr.ShiftLeft || pr.ShiftRight) {
      p.walkMode = !p.walkMode;
      this.say(p.walkMode ? 'Mode marche : précis et discret' : 'Mode course', 1.2);
    }
    p.moving = false;
    this.unstick(p);
    if (dx || dy) {
      const l = Math.hypot(dx, dy); dx /= l; dy /= l;
      const spd = (p.walkMode ? p.walkSpeed : p.runSpeed) * p.weapon.mobility * (p.reloadT > 0 ? 0.8 : 1) * (p.act ? 0.55 : 1);
      const bx = p.x, by = p.y;
      this.tryMove(p, dx * spd * dt, dy * spd * dt);
      p.moving = true;
      p.moveDir = Math.atan2(dy, dx);
      // Bloqué contre une porte fermée : rappel des commandes (pas d'ouverture automatique).
      if (Math.abs(p.x - bx) + Math.abs(p.y - by) < 0.01) {
        const ax = p.x + dx * (p.radius + 6), ay = p.y + dy * (p.radius + 6);
        const door = this.map.door(Math.floor(ax / TILE), Math.floor(ay / TILE));
        if (door && !door.open && this.message.t <= 0) this.say('E : ouvrir · molette haut : entrouvrir', 1.2);
      }
    }

    this.updateFiber(p, dt);
    if (pr.KeyE || pr.WheelUp || pr.WheelDown) {
      const d = this.nearestDoor(p, 1.8 * U);
      if (!d) this.say('Aucune porte à portée', 1);
      else {
        // E : ouvre en grand ou ferme d'un coup ; la molette avance d'un cran (DOOR_STEPS).
        // doorAction se charge des refus (porte en mouvement, déjà fermée, embrasure occupée).
        const target = pr.KeyE ? (d.open ? 0 : 1) : this.doorStep(d, pr.WheelUp ? 1 : -1);
        this.doorAction(p, d, target);
      }
    }
    if (pr.KeyR || pr.Mouse1) this.startReload(p);
    if (pr.Digit1) this.switchWeapon(p, 0);
    if (pr.Digit2) this.switchWeapon(p, 1);
    if (pr.AltLeft || pr.AltRight) this.switchWeapon(p, (p.cur + 1) % p.slots.length);
    if (pr.Space || pr.KeyG) this.throwFlash(p);
    if (pr.KeyV) this.pickUp(p);
    else {
      // rappel discret en passant près d'une arme au sol (une fois par corps)
      const drop = this.nearestDrop(p);
      if (!drop) this.pickHint = null;
      else if (drop !== this.pickHint && this.message.t <= 0) {
        this.say(`V : ramasser ${this.pickupSlot(drop.slot).def.name}`, 1.5);
        this.pickHint = drop;
      }
    }
    // Clic droit : ordre de déplacement. Maintenu puis tiré, il fixe en plus une direction
    // à couvrir, confiée au coéquipier placé de ce côté. En siège, personne ne commande : pas d'ordres.
    if ((pr.Mouse2 || pr.KeyT) && !this.canCommand()) { /* refus annoncé par canCommand */ }
    else if (pr.Mouse2) this.orderDrag = { x: m.x, y: m.y, angle: null, onSelf: dist(m.x, m.y, p.x, p.y) <= p.radius + 6 };
    if (this.orderDrag && this.input.mouse.rdown) {
      const d = dist(this.orderDrag.x, this.orderDrag.y, m.x, m.y);
      this.orderDrag.angle = d >= 0.7 * U ? Math.atan2(m.y - this.orderDrag.y, m.x - this.orderDrag.x) : null;
    }
    if (pr.Mouse2Up && this.orderDrag) {
      const o = this.orderDrag;
      this.orderDrag = null;
      // clic droit sur soi : l'équipe reprend le suivi ; ailleurs : ordre de déplacement
      if (o.onSelf) this.orderFollow();
      else this.orderMove(o.x, o.y, o.angle);
    }
    if (pr.KeyT && this.canCommand(true)) this.toggleHold();

    const s = p.slot, w = s.def;
    p.fireT -= dt;
    p.switchT -= dt;
    p.bloom = Math.max(0, p.bloom - dt * 7 * DEG);
    // Chargement cartouche par cartouche : un tir interrompt le rechargement s'il reste une cartouche.
    if (p.reloadT > 0 && w.reloadType === 'shell' && pr.Mouse0 && s.mag > 0) p.reloadT = 0;
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) {
        if (w.reloadType === 'shell') {
          s.mag++; s.reserve--;
          Sound.tick(0.2);
          if (s.mag < w.mag && s.reserve > 0) p.reloadT = w.reload;
        } else {
          const take = Math.min(w.mag - s.mag, s.reserve);
          s.mag += take; s.reserve -= take;
        }
      }
    } else if (p.switchT <= 0 && p.stun <= 0 && !p.act && !p.fiber) {
      const want = w.auto ? m.down : pr.Mouse0;
      if (want && p.fireT <= 0) {
        if (s.mag <= 0) { if (pr.Mouse0) { if (s.reserve > 0) this.startReload(p); else this.say('Plus de munitions', 1.5); } }
        else this.fireWeapon(p);
      }
    }
  }

  tryMove(agent, mx, my) {
    const r = agent.radius - 1;
    if (this.map.circleFree(agent.x + mx, agent.y, r, true)) agent.x += mx;
    if (this.map.circleFree(agent.x, agent.y + my, r, true)) agent.y += my;
  }

  nearestDoor(agent, R) {
    let best = null, bd = R;
    for (const d of this.map.doors) {
      const dd = dist(agent.x, agent.y, d.cx, d.cy);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  startReload(p) {
    const s = p.slot, w = s.def;
    if (p.reloadT > 0 || p.act || p.fiber || s.mag >= w.mag || s.reserve <= 0) return;
    p.reloadT = w.reload;
    if (w.reloadType === 'shell') Sound.tick(0.2); else Sound.reload();
  }

  switchWeapon(p, i) {
    if (i === p.cur || i >= p.slots.length || p.act) return;
    p.cur = i; p.reloadT = 0; p.switchT = 0.45; p.bloom = 0;
    this.emit('weapon');
  }

  // Grenades selon le camp : l'intervention a des flashs, le groupe armé deux grenades à fragmentation.
  armGrenades(p, flashes) {
    if (this.mode === 'siege') { p.nade = 'frag'; p.flashbangs = 2; }
    else { p.nade = 'flash'; if (flashes !== undefined) p.flashbangs = flashes; }
  }

  // ---- Relais et armes au sol ----
  // Le joueur est tombé : on reprend la main dans le coéquipier debout le plus proche. On garde le
  // même objet (les ennemis qui le visaient le visent toujours) en lui donnant le prototype du joueur.
  takeOver() {
    const old = this.player;
    const m = this.mates.filter(x => x.alive)
      .sort((a, b) => dist(a.x, a.y, old.x, old.y) - dist(b.x, b.y, old.x, old.y))[0];
    if (!m) return;
    const main = this.pickupSlot(m.slot);
    delete m.slot; // la propriété propre du coéquipier masquerait l'accesseur du joueur
    Object.setPrototypeOf(m, Player.prototype);
    m.slots = main.def.kind === 'pistol' ? [main] : [main, makeSlot(this.loadout.sidearm)];
    m.cur = 0;
    Object.assign(m, {
      runSpeed: 118, walkSpeed: 62, walkMode: old.walkMode, fov: 120 * DEG, viewRange: 15 * U, spreadMul: 1,
      reloadT: 0, switchT: 0.3, fiber: null, flashT: 0, act: null, path: [], moving: false,
      target: null, lookAt: null, alertAngle: null, order: null, coverAngle: null, blockedLine: false,
    });
    m.moveDir = m.angle;
    this.armGrenades(m, 1);
    // l'ancien joueur reste au sol, dans la liste de l'équipe (« À terre »)
    old.accent = '#9aa4ae';
    this.mates = [...this.mates.filter(x => x !== m), old];
    this.player = m;
    this.relayT = 0;
    this.orderDrag = null;
    if (this.orderMarker && this.orderMarker.mate === m) this.orderMarker = null;
    this.say(`${m.name} prend le relais`, 3);
    this.emit('weapon');
  }

  // Arme ramassée : les armes de l'IA (chargeur infini) redeviennent leur modèle réel, avec des
  // munitions finies ; une arme déjà portée par un joueur garde son chargeur et sa réserve.
  pickupSlot(s) {
    const def = WEAPONS[s.def.pickup] || s.def;
    const mag = Number.isFinite(s.mag) ? Math.min(s.mag, def.mag) : def.mag;
    const reserve = def === s.def && Number.isFinite(s.reserve) ? s.reserve : def.reserve;
    return { def, mag, reserve };
  }

  // Corps le plus proche portant encore une arme, à portée de ramassage.
  nearestDrop(p) {
    let best = null, bd = PICKUP_RANGE;
    for (const a of [...this.enemies, ...this.mates]) {
      if (a.alive || a.dying || !a.slot || a === p) continue;
      const d = dist(a.x, a.y, p.x, p.y);
      if (d < bd && this.map.hasLOS(p.x, p.y, a.x, a.y)) { bd = d; best = a; }
    }
    return best;
  }

  // V : ramasser l'arme d'un corps. Elle remplace celle de même catégorie (arme de poing ou arme
  // principale), qui reste au sol à sa place : c'est un échange.
  pickUp(p) {
    if (p.act || p.fiber) return;
    const body = this.nearestDrop(p);
    if (!body) { this.say('Aucune arme à ramasser', 1); return; }
    this.startAction(p, 'pickup', 0.5, () => {
      if (!body.slot || !p.alive) return;
      const got = this.pickupSlot(body.slot);
      const side = got.def.kind === 'pistol';
      let i = side ? p.slots.length - 1 : 0;
      const sameKind = s => (s.def.kind === 'pistol') === side;
      let given = null;
      if (sameKind(p.slots[i])) given = p.slots[i];
      else if (p.slots.length === 1) i = side ? 1 : 0; // un seul emplacement : on ajoute sans rien lâcher
      if (given) p.slots[i] = got;
      else p.slots.splice(i, 0, got);
      if (body.slots) body.slots[body.cur] = given; else body.slot = given;
      p.cur = i; p.reloadT = 0; p.switchT = 0.3; p.bloom = 0;
      this.pickHint = null;
      this.say(given ? `${got.def.name} ramassé — ${given.def.name} laissé au sol` : `${got.def.name} ramassé`, 2);
      Sound.reload();
      this.emit('weapon');
    });
  }

  // Dégoupiller et armer le bras prend un instant ; la grenade part à la fin du geste,
  // vers le curseur de ce moment-là.
  throwFlash(p) {
    if (p.flashbangs <= 0 || p.stun > 0 || p.act) return;
    p.flashbangs--;
    this.stats.flashes++;
    Sound.tick(0.12); // goupille
    this.startAction(p, 'grenade', 0.45, () => this.releaseFlash(p));
  }

  releaseFlash(p) {
    const m = this.input.mouse;
    this.spawnFlash(p, m.x, m.y);
  }

  // Jet d'une flash depuis un agent vers un point : la distance règle la force du lancer.
  spawnFlash(p, mx, my) {
    const m = { x: mx, y: my };
    // Portée = distance au curseur (plafonnée). Vol en l'air puis roulement avec frottement :
    // distance ≈ v0 * (flight + 1/friction), d'où v0.
    const d = clamp(dist(p.x, p.y, m.x, m.y), 0.5 * U, 7 * U);
    const ang = Math.atan2(m.y - p.y, m.x - p.x);
    const flight = 0.35, friction = 4;
    const v0 = d / (flight + 1 / friction);
    let gx = p.x + Math.cos(ang) * 14, gy = p.y + Math.sin(ang) * 14;
    if (this.grenadeBlocked(gx, gy)) { gx = p.x; gy = p.y; }
    const kind = p.nade || 'flash';
    const g = { x: gx, y: gy, vx: Math.cos(ang) * v0, vy: Math.sin(ang) * v0, t: 0, flight, friction, fuse: kind === 'frag' ? 2 : 1.7, h: 0, spin: rand(0, TAU), bounces: 0, post: null,
      kind, team: p.team, thrower: p };
    // Collé à une porte entrouverte et visant l'embrasure : la grenade est glissée par l'entrebâillement
    // (le battant est ignoré le temps de franchir la porte).
    const door = this.nearestDoor(p, 1.8 * U);
    if (door && door.progress >= 0.4 && !door.open) {
      const cross = this.aimCrossesDoor(p.x, p.y, ang, door);
      if (cross) {
        g.post = door;
        g.postSide = Math.sign(cross.side);
        if (this.grenadeBlocked(g.x, g.y) || dist(p.x, p.y, g.x, g.y) < 1) { g.x = p.x; g.y = p.y; }
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

  // Obstacles pour une grenade : murs, mobilier, portes non ouvertes en grand.
  grenadeBlocked(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (this.map.blocksMove(tx, ty)) return true;
    // seule une porte complètement fermée bloque l'embrasure ; sinon on teste le battant (doorLeafHit)
    const d = this.map.door(tx, ty);
    return d ? d.progress <= 0 : false;
  }

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
        if (speed > 40) { Sound.tick(Math.min(0.25, speed / 900)); this.noise(g.x, g.y, 2.5 * U, null); }
      }
    }
  }

  // ---- Gestes à deux mains (porte, grenade) ----
  // Manipuler une porte ou lancer une grenade occupe les mains : l'agent ne tire pas pendant
  // le geste, et sa visée reste perturbée un court instant après (handBloom).
  startAction(agent, type, dur, done) {
    if (agent.act || !agent.alive) return false;
    agent.act = { type, t: 0, dur, done };
    agent.reloadT = 0; // on lâche le chargeur : les mains servent à autre chose
    return true;
  }

  updateActions(dt) {
    for (const a of [...this.ops, ...this.enemies]) {
      if (a.handBloom > 0) a.handBloom = Math.max(0, a.handBloom - dt * 10 * DEG);
      if (!a.act) continue;
      if (!a.alive) { a.act = null; continue; } // une grenade dégoupillée part quand même : seul la mort interrompt
      a.act.t += dt;
      if (a.act.t < a.act.dur) continue;
      const done = a.act.done;
      a.act = null;
      a.handBloom = 6 * DEG;
      if (done) done();
    }
  }

  // ---- Fibre optique sous la porte ----
  // Maintenir F glisse une fibre sous le battant : on voit la pièce voisine sans ouvrir, mais
  // on est immobile et incapable de tirer tant qu'on regarde.
  updateFiber(p, dt) {
    const k = this.input.keys, pr = this.input.pressed;
    if (p.fiber) {
      const f = p.fiber;
      if (!k.KeyF || !p.alive || p.stun > 0 || p.moving || f.door.opening || f.door.open
          || dist(p.x, p.y, f.door.cx, f.door.cy) > 2 * U) {
        p.fiber = null;
        Sound.tick(0.07);
      }
      return;
    }
    if (!pr.KeyF || p.act || !p.alive) return;
    if (this.siege) { this.say('Pas de fibre optique dans ce camp', 1.2); return; }
    const d = this.nearestDoor(p, 1.6 * U);
    if (!d) { this.say('Aucune porte à portée', 1); return; }
    if (d.open) { this.say('La porte est déjà ouverte', 1); return; }
    const spot = this.fiberSpot(p, d);
    if (!spot) { this.say('Impossible de glisser la fibre ici', 1.2); return; }
    Sound.tick(0.1);
    this.startAction(p, 'fiber', 0.7, () => { if (this.input.keys.KeyF && p.alive) p.fiber = spot; });
  }

  // Point d'observation : juste de l'autre côté du battant, au milieu de l'embrasure.
  fiberSpot(p, d) {
    const nx = d.horizontal ? 0 : 1, ny = d.horizontal ? 1 : 0;
    const s = Math.sign((d.horizontal ? d.cy - p.y : d.cx - p.x)) || 1;
    const x = d.cx + nx * s * (TILE / 2 + 7), y = d.cy + ny * s * (TILE / 2 + 7);
    if (this.map.blocksMove(Math.floor(x / TILE), Math.floor(y / TILE))) return null;
    return { door: d, x, y, angle: Math.atan2(y - p.y, x - p.x), fov: 150 * DEG, range: 6 * U };
  }

  // ---- Portes ----
  // Cran d'ouverture suivant (dir > 0) ou précédent, ou null s'il n'y en a plus.
  doorStep(d, dir) {
    const eps = 0.01;
    if (dir > 0) { const up = DOOR_STEPS.find(s => s > d.progress + eps); return up === undefined ? null : up; }
    const down = DOOR_STEPS.filter(s => s < d.progress - eps);
    return down.length ? down[down.length - 1] : null;
  }

  // Ouvrir, entrouvrir ou fermer demande d'abord de manœuvrer la poignée : c'est ce geste qui prend
  // du temps, la porte ne bouge qu'ensuite. Entrouvrir en silence est le plus lent.
  doorAction(agent, door, target) {
    const say = t => { if (agent === this.player) this.say(t, 1.2); };
    // Retours explicites : sans eux, appuyer sur la touche semble simplement ne rien faire.
    if (target === null || target === undefined) {
      say(door.progress >= 1 ? 'La porte est déjà grande ouverte' : 'La porte est déjà fermée');
      return false;
    }
    if (agent.act) return false;
    if (door.opening) { say('La porte est déjà en mouvement'); return false; }
    if (target === door.progress) return false;
    const opening = target > door.progress;
    if (!opening) {
      // on vérifie avant le geste, pour ne pas manœuvrer la poignée pour rien
      const blocker = this.doorBlocker(door);
      if (blocker) { say(this.doorBlockedMsg(agent, blocker)); return false; }
    }
    // Poignée à manœuvrer, puis course du battant : entrouvrir demande moins d'effort qu'ouvrir en grand.
    let dur = 0.25 + 0.3 * Math.abs(target - door.progress);
    if (agent.team === 'enemy') dur *= 1.3;
    Sound.tick(0.08); // poignée
    return this.startAction(agent, 'door', dur, () => {
      if (dist(agent.x, agent.y, door.cx, door.cy) > 2.2 * U) return; // on s'est éloigné entre-temps
      if (opening) this.openDoor(agent, door, target);
      else this.closeDoor(agent, door, target);
    });
  }


  // target : 1 = ouverte en grand, 0.3 = entrouverte (laisse passer le regard, pas le passage).
  openDoor(agent, door, target) {
    target = target === undefined ? 1 : target;
    if (target <= door.progress) return;
    door.target = target;
    door.opening = true;
    door.duration = agent.team === 'ops' ? 0.3 : 0.45;
    const quiet = target < 1;
    this.noise(door.cx, door.cy, (quiet ? 1.5 : 4) * U, agent);
    if (!quiet) Sound.door();
  }

  // Qui se trouve dans l'embrasure (et empêche donc de refermer) : agent, 'grenade', ou null.
  // On ne compte que ce qui est vraiment dans le cadre, pas ce qui passe devant.
  doorBlocker(door) {
    const half = (door.len * TILE) / 2, hw = TILE / 2;
    const inFrame = (x, y, r) => {
      const dx = Math.abs(x - door.cx), dy = Math.abs(y - door.cy);
      const along = door.horizontal ? dx : dy, across = door.horizontal ? dy : dx;
      return along < half + r * 0.4 && across < hw + r * 0.4;
    };
    for (const a of [...this.ops, ...this.enemies]) if (a.alive && inFrame(a.x, a.y, a.radius)) return a;
    for (const g of this.grenades) if (inFrame(g.x, g.y, 4)) return 'grenade';
    return null;
  }

  doorBlockedMsg(agent, blocker) {
    return blocker === agent ? "Dégagez l'embrasure pour fermer"
      : blocker === 'grenade' ? 'Une grenade est dans l\'embrasure'
      : "Quelqu'un est dans l'embrasure";
  }

  // Fermeture (target 0 = fermée, crans intermédiaires possibles). Impossible si l'embrasure est occupée.
  closeDoor(agent, door, target) {
    if (target >= door.progress) return;
    const blocker = this.doorBlocker(door);
    if (blocker) { if (agent === this.player) this.say(this.doorBlockedMsg(agent, blocker), 1.2); return; }
    door.target = target;
    door.opening = true;
    door.duration = 0.3;
    // la porte bloque le passage dès le début de la fermeture ; la vue passe jusqu'à la fin
    door.open = false;
    door.ajar = true;
    const quiet = door.progress < 1;
    this.noise(door.cx, door.cy, (quiet ? 1.5 : 3) * U, agent);
    Sound.door();
  }

  // ---- Tir ----
  fireWeapon(shooter) {
    const s = shooter.slot, w = s.def;
    const n = w.pellets || 1;
    const spread = this.spreadOf(shooter);
    const ml = muzzleDist(w.gunLen);
    const mx = shooter.x + Math.cos(shooter.angle) * ml, my = shooter.y + Math.sin(shooter.angle) * ml;
    for (let i = 0; i < n; i++) {
      const a = shooter.angle + rand(-spread, spread);
      this.bullets.push({ x: mx, y: my, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, team: shooter.team, damage: w.damage, life: w.range / w.speed, shooter, trail: w.heavy ? 10 : 18, pierce: w.pierce === undefined ? 0.4 : w.pierce, pierced: 0 });
    }
    shooter.bloom = Math.min(shooter.bloom + w.bloom, w.bloomMax || 8 * DEG);
    shooter.kick = 1;
    s.mag--;
    shooter.fireT = Math.max(shooter.fireT, -0.02) + 1 / w.rof; // report du reste : cadence réelle malgré le pas de 1/60 s
    shooter.muzzleT = 0.06;
    if (shooter === this.player) {
      const r = w.recoil || 4;
      this.camKick.x -= Math.cos(shooter.angle) * r; this.camKick.y -= Math.sin(shooter.angle) * r;
    }
    this.effects.push({ type: 'muzzle', x: mx, y: my, angle: shooter.angle, t: 0, life: 0.06, big: w.heavy });
    const ca = shooter.angle + Math.PI / 2 + rand(-0.4, 0.4);
    this.casings.push({ x: shooter.x + Math.cos(shooter.angle) * 8, y: shooter.y + Math.sin(shooter.angle) * 8, vx: Math.cos(ca) * rand(70, 130), vy: Math.sin(ca) * rand(70, 130), rot: rand(0, TAU), spin: rand(-12, 12), t: 0, life: 0.45 });
    if (shooter === this.player) { this.stats.shots++; this.camShake = Math.max(this.camShake, w.heavy ? 4 : 1.5); }
    this.noise(shooter.x, shooter.y, 11 * U, shooter);
    Sound.shot(shooter.team === 'ops' ? 0.3 : 0.2, w);
  }

  updateBullets(dt) {
    const keep = [];
    for (const b of this.bullets) {
      const len = Math.hypot(b.vx, b.vy) * dt;
      const ang = Math.atan2(b.vy, b.vx), cs = Math.cos(ang), sn = Math.sin(ang);
      const r = this.map.castRay(b.x, b.y, ang, len, false);
      let hitT = r.hit ? r.dist : len;
      let victim = null;
      // Tir ami possible : les balles de l'équipe touchent aussi les coéquipiers (sauf le tireur).
      const cands = b.team === 'ops'
        ? [...this.enemies, ...this.hostages, ...this.ops.filter(o => o !== b.shooter)]
        : [...this.ops, ...this.hostages];
      for (const c of cands) {
        if (!c.alive) continue;
        const rx = c.x - b.x, ry = c.y - b.y;
        const t = rx * cs + ry * sn;
        if (t < -c.radius || t > hitT + c.radius) continue;
        const perp = Math.abs(rx * sn - ry * cs);
        if (perp > c.radius) continue;
        const tt = Math.max(0, t - Math.sqrt(c.radius * c.radius - perp * perp));
        if (tt <= hitT) { hitT = tt; victim = c; }
      }
      if (victim) {
        this.damage(victim, b.damage, b.shooter, ang);
        if (b.shooter === this.player && victim.team === 'enemy') this.stats.hits++;
        continue;
      }
      if (r.hit) {
        // Une porte n'est pas un mur : la balle la traverse en perdant de l'énergie (et un peu sa ligne).
        if (r.door && b.pierced < 2) {
          b.pierced++;
          b.damage *= b.pierce;
          const na = ang + rand(-1.6, 1.6) * DEG;
          const sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
          b.x = r.x + Math.cos(na) * 3; b.y = r.y + Math.sin(na) * 3; // ressort de l'autre côté
          b.life -= dt;
          this.effects.push({ type: 'splinter', x: r.x, y: r.y, angle: ang, t: 0, life: 0.25 });
          Sound.pierce();
          this.noise(r.x, r.y, 4 * U, b.shooter); // l'impact s'entend de l'autre côté
          if (b.life > 0 && b.damage >= 2) keep.push(b);
          continue;
        }
        this.decals.push({ type: 'hole', x: r.x - cs * 1.5, y: r.y - sn * 1.5 });
        this.effects.push({ type: 'spark', x: r.x, y: r.y, t: 0, life: 0.15 });
        continue;
      }
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life > 0) keep.push(b);
    }
    this.bullets = keep;
  }

  damage(target, dmg, shooter, ang) {
    if (!target.alive) return;
    this.effects.push({ type: 'hit', x: target.x, y: target.y, t: 0, life: 0.25 });
    for (let i = 0; i < 3; i++) {
      const d = rand(4, 22);
      this.decals.push({ type: 'blood', x: target.x + Math.cos(ang + rand(-0.6, 0.6)) * d, y: target.y + Math.sin(ang + rand(-0.6, 0.6)) * d, r: rand(2, 5) });
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
      this.decals.push({ type: 'pool', x: target.x, y: target.y, rot: target.angle });
      if (this.siege) {
        const left = this.hostages.filter(h => h.alive && !h.secured).length;
        if (left) this.say(`Un otage est tombé — il vous en reste ${left}`, 3);
      }
      return;
    }
    target.hp -= dmg;
    if (target !== this.player && !target.target && shooter) target.alertAngle = Math.atan2(shooter.y - target.y, shooter.x - target.x);
    if (target === this.player) this.camShake = Math.max(this.camShake, 5);
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.path = [];
      target.target = null;
      target.moving = false;
      target.bodyAngle = ang + rand(-0.6, 0.6);
      target.dying = { t: 0, dur: 0.7, dir: ang, spin: Math.random() < 0.5 ? -1 : 1 };
      if (target.team === 'enemy') this.stats.kills++;
      else if (target !== this.player) { this.stats.losses++; this.say(`${target.name} est à terre !`, 2.5); }
      else if (this.mates.some(m => m.alive)) { this.stats.losses++; this.say('Vous êtes à terre — un coéquipier reprend la main', RELAY_DELAY + 0.3); }
    }
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
        const nx = g.x + g.vx * sdt;
        if (g.vx !== 0 && this.grenadeBlocked(nx + Math.sign(g.vx) * R, g.y)) this.bounceGrenade(g, 'x');
        else g.x = nx;
        const ny = g.y + g.vy * sdt;
        if (g.vy !== 0 && this.grenadeBlocked(g.x, ny + Math.sign(g.vy) * R)) this.bounceGrenade(g, 'y');
        else g.y = ny;
        this.doorLeafHit(g, R);
      }
      g.spin += speed * dt * 0.05;
      if (g.t < g.flight) g.h = Math.sin(g.t / g.flight * Math.PI) * 12;           // en l'air
      else if (g.t < g.flight + 0.18) g.h = Math.sin((g.t - g.flight) / 0.18 * Math.PI) * 3; // petit rebond à l'atterrissage
      else g.h = 0;
      if (g.t >= g.flight) { const f = Math.exp(-g.friction * dt); g.vx *= f; g.vy *= f; }   // roulement
      if (speed < 4) { g.vx = 0; g.vy = 0; }
      if (g.t >= g.fuse) { if (g.kind === 'frag') this.detonateFrag(g); else this.detonateFlash(g.x, g.y, g); }
    }
    this.grenades = this.grenades.filter(g => g.t < g.fuse);
  }

  bounceGrenade(g, axis) {
    const speed = Math.hypot(g.vx, g.vy);
    if (axis === 'x') { g.vx = -g.vx * 0.45; g.vy *= 0.8; } else { g.vy = -g.vy * 0.45; g.vx *= 0.8; }
    g.bounces++;
    if (speed > 40) { Sound.tick(Math.min(0.25, speed / 900)); this.noise(g.x, g.y, 2.5 * U, null); }
  }

  detonateFlash(x, y, g) {
    this.effects.push({ type: 'flash', x, y, t: 0, life: 0.7 });
    Sound.flash();
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
    this.noise(x, y, 9 * U, null);
  }

  // Grenade à fragmentation : dégâts décroissants jusqu'à FRAG_RADIUS, pour tous ceux qu'aucun mur ni
  // porte fermée ne protège — lanceur, alliés et otages compris.
  detonateFrag(g) {
    const { x, y } = g;
    this.effects.push({ type: 'frag', x, y, t: 0, life: 0.9 });
    this.decals.push({ type: 'scorch', x, y });
    Sound.frag();
    for (const a of [...this.enemies, ...this.ops, ...this.hostages]) {
      if (!a.alive) continue;
      const d = dist(x, y, a.x, a.y);
      if (d >= FRAG_RADIUS || !this.map.hasLOS(x, y, a.x, a.y)) continue;
      const k = 1 - d / FRAG_RADIUS;
      this.damage(a, FRAG_DAMAGE * k * k + 8, g.thrower, Math.atan2(a.y - y, a.x - x));
      if (a.alive && a.team !== 'civ') { a.stun = Math.max(a.stun || 0, 0.8 * k); a.target = null; }
    }
    this.camShake = Math.max(this.camShake, 11);
    this.noise(x, y, 11 * U, null);
  }

  // ---- Ennemis ----
  noise(x, y, radius, source) {
    // les coéquipiers (ou complices) tournent la tête vers un bruit proche, sans quitter leur poste
    for (const m of this.mates || []) {
      if (!m.alive || m === source || m.target || m.stun > 0) continue;
      if (dist(x, y, m.x, m.y) > radius * 0.8) continue;
      if (source && source.team === m.team) continue;
      if (m.coverAngle === null) m.alertAngle = Math.atan2(y - m.y, x - m.x);
    }
    for (const e of this.enemies) {
      if (!e.alive || e === source || e.stun > 0 || e.target) continue;
      if (dist(x, y, e.x, e.y) > radius) continue;
      if (e.noiseT > 0) continue;
      e.noiseT = 1.5;
      e.alertAngle = Math.atan2(y - e.y, x - e.x);
      if (source && source.team === 'enemy') continue;
      e.state = 'investigate';
      e.lastKnown = { x, y };
      e.searchT = 0;
      e.path = this.pathTo(e, x, y);
    }
  }

  pathTo(agent, wx, wy) {
    return this.map.routeTo(agent.x, agent.y, Math.floor(wx / TILE), Math.floor(wy / TILE), agent.radius) || [];
  }

  canSee(agent, other) {
    const d = dist(agent.x, agent.y, other.x, other.y);
    if (d > agent.viewRange) return false;
    const a = Math.atan2(other.y - agent.y, other.x - agent.x);
    if (Math.abs(angleDiff(agent.angle, a)) > agent.fov / 2) return false;
    return this.map.hasLOS(agent.x, agent.y, other.x, other.y);
  }

  // Cible visible la plus proche parmi des candidats.
  acquireFor(agent, cands) {
    let best = null, bd = Infinity;
    for (const c of cands) {
      if (!c.alive) continue;
      const d = dist(agent.x, agent.y, c.x, c.y);
      if (d < bd && this.canSee(agent, c)) { bd = d; best = c; }
    }
    return best;
  }

  enemyCombat(e, dt) {
    if (e.stun > 0) { e.stun -= dt; e.target = null; e.moving = false; return; }
    let t = e.target;
    if (t && (!t.alive || dist(e.x, e.y, t.x, t.y) > e.viewRange || !this.map.hasLOS(e.x, e.y, t.x, t.y))) t = null;
    if (!t) { t = this.acquireFor(e, this.ops); if (t) e.reactT = e.reaction; }
    e.target = t;
    e.fireT -= dt; e.pauseT -= dt;
    e.bloom = Math.max(0, e.bloom - dt * 6 * DEG);
    if (!t) {
      if (e.alertAngle !== null && turnToward(e, e.alertAngle, e.turnRate, dt)) e.alertAngle = null;
      return;
    }
    e.alertAngle = null;
    const a = Math.atan2(t.y - e.y, t.x - e.x);
    const d = dist(e.x, e.y, t.x, t.y);
    const w = e.weapon;
    e.aimDist = d;
    e.engaged = d <= w.range;
    if (e.engaged || !e.path.length) turnToward(e, a, e.turnRate, dt);
    e.reactT -= dt;
    // L'intervention ne tire jamais avec un otage (ou un équipier) dans l'axe : si ça dure, elle se
    // décale (voir updateAssault). Les suspects du mode assaut, eux, n'ont pas ces scrupules.
    let clear = true;
    if (e instanceof Operator) {
      clear = this.lineOfFireClear(e, t);
      e.blockedT = clear ? 0 : (e.blockedT || 0) + dt;
      e.blockedLine = e.blockedT > 0.35;
    }
    if (clear && e.engaged && e.reactT <= 0 && e.pauseT <= 0 && e.fireT <= 0 && !e.act && Math.abs(angleDiff(e.angle, a)) < 0.25) {
      this.fireWeapon(e);
      if (--e.burstLeft <= 0) { e.burstLeft = w.burst; e.pauseT = w.pause; }
    }
  }

  moveAlong(agent, dt) {
    agent.moving = false;
    if (agent.act) return; // geste en cours (poignée de porte) : on ne bouge pas
    if (agent.waitDoor) {
      if (!agent.waitDoor.open) return;
      agent.waitDoor = null;
    }
    if (agent.holdT > 0) { agent.holdT -= dt; return; }
    if (agent.alertAngle !== null) return;
    if (!agent.path.length) return;
    const wp = agent.path[0];
    const dx = wp.x - agent.x, dy = wp.y - agent.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) { agent.path.shift(); return; }
    const ang = Math.atan2(dy, dx);
    if (!agent.engaged) turnToward(agent, ang, agent.turnRate, dt);
    const ax = agent.x + Math.cos(ang) * (agent.radius + 4), ay = agent.y + Math.sin(ang) * (agent.radius + 4);
    const door = this.map.door(Math.floor(ax / TILE), Math.floor(ay / TILE));
    if (door && !door.open) {
      if (!door.opening) this.doorAction(agent, door, 1);
      agent.waitDoor = door;
      return;
    }
    const step = Math.min(d, agent.speed * dt);
    agent.x += Math.cos(ang) * step;
    agent.y += Math.sin(ang) * step;
    agent.moving = true;
    if (step >= d - 0.01) agent.path.shift();
  }

  // Progression de l'équipe d'intervention pendant un siège : elle avance vers le dernier bruit
  // entendu, sinon vers le prochain secteur à nettoyer, et s'arrête pour tirer dès qu'elle voit.
  updateAssault(e, dt) {
    if (!e.alive) return;
    e.noiseT -= dt;
    if (this.siege.prep > 0) { e.moving = false; return; } // ils attendent devant la porte
    this.enemyCombat(e, dt);
    if (e.stun > 0) return;
    e.repathT -= dt;
    if (e.target) {
      e.lastKnown = { x: e.target.x, y: e.target.y };
      if (e.blockedLine) {
        // otage dans l'axe : on cherche un angle dégagé plutôt que de tirer à travers
        const spot = this.firingSpot(e, e.target);
        if (spot && (!e.path.length || e.repathT <= 0)) { e.path = this.pathTo(e, spot.x, spot.y); e.repathT = 0.5; }
        this.moveAlong(e, dt); // engagé, il se déplace sans lâcher la cible des yeux (enemyCombat)
        return;
      }
      if (e.engaged) { e.path = []; e.moving = false; return; }
      if (!e.path.length || e.repathT <= 0) { e.path = this.pathTo(e, e.target.x, e.target.y); e.repathT = 0.8; }
      this.moveAlong(e, dt);
      return;
    }
    e.engaged = false;
    if (this.maybeFlash(e, dt)) return;
    let goal = e.lastKnown;
    if (goal && dist(e.x, e.y, goal.x, goal.y) < 1.2 * U) { e.lastKnown = null; goal = null; }
    if (!goal) goal = this.assaultGoal(e);
    if (!goal) { this.moveAlong(e, dt); return; }
    if (!e.path.length || e.repathT <= 0) { e.path = this.pathTo(e, goal.x, goal.y); e.repathT = 1.2; }
    this.moveAlong(e, dt);
  }

  // Flash avant d'entrer : un opérateur qui sait où était la menace, sans la voir, dégoupille
  // plutôt que de franchir la porte à l'aveugle.
  maybeFlash(e, dt) {
    e.flashCd -= dt;
    if (e.act) return true;          // geste en cours (l'armement du bras)
    if (e.flashbangs <= 0 || e.flashCd > 0 || !e.lastKnown) return false;
    const d = dist(e.x, e.y, e.lastKnown.x, e.lastKnown.y);
    if (d < 2.5 * U || d > 6 * U) return false;
    // Une grenade lancée contre une porte fermée ou un mur revient aux pieds du lanceur : on
    // attend d'avoir la voie libre (la porte ouverte), et on ne la lance pas sur ses équipiers.
    const aim0 = e.lastKnown;
    const allyNear = this.enemies.some(o => o !== e && o.alive && dist(o.x, o.y, aim0.x, aim0.y) < 2 * U);
    if (allyNear || !this.clearThrow(e.x, e.y, aim0.x, aim0.y)) { e.flashCd = 0.5; return false; }
    e.flashbangs--;
    e.flashCd = 14;
    e.path = [];
    const aim = e.lastKnown;
    this.startAction(e, 'grenade', 0.5, () => this.spawnFlash(e, aim.x, aim.y));
    return true;
  }

  // Trajectoire de lancer libre jusqu'au point visé : ni mur, ni meuble, ni porte non ouverte.
  clearThrow(x0, y0, x1, y1) {
    if (!this.map.hasLOS(x0, y0, x1, y1)) return false;
    const d = dist(x0, y0, x1, y1), n = Math.ceil(d / 6);
    for (let i = 2; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      if (this.grenadeBlocked(x, y)) return false;
      const dd = this.map.door(Math.floor(x / TILE), Math.floor(y / TILE));
      if (dd && !dd.open) return false;
    }
    return true;
  }

  // Prochain secteur à nettoyer ; quand tout est passé, on recommence le tour.
  assaultGoal(e) {
    // priorité aux otages repérés : c'est leur mission
    let best = null, bd = Infinity;
    for (const h of this.hostages) {
      if (!h.alive || h.secured || !h.found) continue;
      const d = dist(e.x, e.y, h.x, h.y);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) return { x: best.x, y: best.y };
    const secs = this.siege.sectors;
    let all = true;
    for (const g of secs) {
      if (g.done) continue;
      all = false;
      if (dist(e.x, e.y, g.x, g.y) < 1.4 * U) { g.done = true; continue; }
      return g;
    }
    if (all) for (const g of secs) g.done = false;
    return null;
  }

  updateEnemy(e, dt) {
    if (!e.alive) return;
    e.noiseT -= dt;
    this.enemyCombat(e, dt);
    if (e.stun > 0) return;
    if (e.target) {
      e.state = 'engage';
      e.lastKnown = { x: e.target.x, y: e.target.y };
      e.lostT = 0;
      e.repathT -= dt;
      if (e.engaged) { e.path = []; e.moving = false; }
      else {
        if (!e.path.length || e.repathT <= 0) { e.path = this.pathTo(e, e.target.x, e.target.y); e.repathT = 1; }
        this.moveAlong(e, dt);
      }
      return;
    }
    e.engaged = false;
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
          if (e.searchT > 3) { e.state = 'idle'; e.homeAngle = e.angle; e.idleT = rand(1, 3); }
        }
        break;
      default:
        e.idleT -= dt;
        if (e.idleT <= 0) { e.idleT = rand(2, 6); e.lookAt = e.homeAngle + rand(-0.9, 0.9); }
        if (e.lookAt !== null && e.alertAngle === null && turnToward(e, e.lookAt, 2, dt)) e.lookAt = null;
    }
  }

  // ---- Coéquipiers ----
  // En siège, les complices ne reçoivent pas d'ordres : chacun tient son poste et se bat seul.
  canCommand(quiet) {
    if (!this.siege) return true;
    if (!quiet) this.say("Pas d'ordres : chacun tient son poste", 1.4);
    return false;
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
    const alive = this.mates.filter(m => m.alive);
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
    this.say(cover ? `${cover.name} : couvrez cette direction` : 'Équipe : allez-y', 1.4);
  }

  orderFollow() {
    if (!this.canCommand(true)) return;
    const alive = this.mates.filter(m => m.alive);
    if (!alive.length) return;
    for (const m of alive) { m.order = 'follow'; m.holdAngle = null; m.coverAngle = null; m.watchSpot = null; m.path = []; m.destTile = null; m.repathT = 0; }
    this.orderMarker = null;
    this.say('Équipe : suivez-moi', 1.2);
  }

  toggleHold() {
    if (!this.canCommand(true)) return;
    const alive = this.mates.filter(m => m.alive);
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
    this.say(hold ? 'Équipe : tenez la position' : 'Équipe : suivez-moi', 1.2);
  }

  // Un point est dans l'axe de tir du joueur (cône étroit devant lui).
  inAimCone(x, y, halfAngle) {
    const p = this.player;
    const d = dist(p.x, p.y, x, y);
    if (d < 6 || d > 7 * U) return false;
    return Math.abs(angleDiff(p.angle, Math.atan2(y - p.y, x - p.x))) < (halfAngle || 20 * DEG);
  }

  // Place du coéquipier en formation derrière le joueur, hors de son axe de tir,
  // sinon la case libre la plus proche visible du joueur.
  formationPos(m) {
    const p = this.player, a = p.moveDir;
    const [fx, fy] = m.slotOffset;
    const wx = p.x + (Math.cos(a) * fx - Math.sin(a) * fy) * U, wy = p.y + (Math.sin(a) * fx + Math.cos(a) * fy) * U;
    const bad = m.badDest && m.badDest.until > this.time && Math.abs(m.badDest.x - Math.floor(wx / TILE)) <= 1 && Math.abs(m.badDest.y - Math.floor(wy / TILE)) <= 1;
    if (!bad && this.map.circleFree(wx, wy, m.radius + 1, true) && this.map.hasLOS(p.x, p.y, wx, wy) && !this.inAimCone(wx, wy, 30 * DEG)) return { x: wx, y: wy };
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
      if (this.inAimCone(cx, cy, 35 * DEG)) score += 6 * U;
      if (m.badDest && m.badDest.until > this.time && Math.abs(m.badDest.x - tx) <= 1 && Math.abs(m.badDest.y - ty) <= 1) score += 10 * U;
      if (this.mates.some(o => o !== m && o.alive && o.destTile && o.destTile.x === tx && o.destTile.y === ty)) score += 2 * U;
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
    const base = m.order === 'follow' ? this.player.moveDir + m.sector : (m.holdAngle === null ? m.angle : m.holdAngle);
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
  lineOfFireClear(shooter, target, x, y) {
    if (x === undefined) { x = shooter.x; y = shooter.y; }
    const d = dist(x, y, target.x, target.y);
    const cs = (target.x - x) / d, sn = (target.y - y) / d;
    const friends = shooter.team === 'ops' ? this.ops : this.enemies;
    // L'intervention est plus stricte : elle tient compte de la dispersion de sa rafale et des
    // otages juste derrière la cible (une balle qui la manque continue sa course).
    const strict = shooter instanceof Operator;
    const cone = strict ? Math.tan(this.spreadOf(shooter, d) + 2 * DEG) : 0;
    for (const f of [...friends, ...this.hostages]) {
      if (f === shooter || f === target || !f.alive) continue;
      const rx = f.x - x, ry = f.y - y;
      const t = rx * cs + ry * sn;
      const behind = strict && f.team === 'civ' ? 2.5 * U : 0;
      if (t < 0 || t > d + behind) continue;
      if (Math.abs(rx * sn - ry * cs) < f.radius + 6 + cone * t) return false;
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
      // un coéquipier ne se place ni sur le joueur ni dans son axe de visée
      if (m.team === 'ops' && dist(x, y, this.player.x, this.player.y) < 0.8 * U) continue;
      if (m.team === 'ops' && this.inAimCone(x, y, 30 * DEG)) continue;
      if (dist(x, y, t.x, t.y) > m.weapon.range) continue;
      if (!this.map.hasLOS(x, y, t.x, t.y)) continue;
      if (!this.lineOfFireClear(m, t, x, y)) continue;
      const score = dist(x, y, m.x, m.y);
      if (score < bd) { bd = score; best = { x, y }; }
    }
    m.fireSpot = best;
    return best;
  }

  mateCombat(m, dt) {
    let t = m.target;
    if (t && (!t.alive || dist(m.x, m.y, t.x, t.y) > m.viewRange || !this.map.hasLOS(m.x, m.y, t.x, t.y))) t = null;
    if (!t) { t = this.acquireFor(m, this.enemies); if (t) m.reactT = m.reaction; }
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
    m.engaged = d <= m.weapon.range;
    // Discipline de tir : un allié ou un otage dans l'axe interdit le tir. Si ça dure, le coéquipier
    // ne doit pas rester planté : il redevient mobile (ordres, repli de côté) tout en gardant sa cible.
    const clear = this.lineOfFireClear(m, t);
    m.blockedT = clear ? 0 : m.blockedT + dt;
    m.blockedLine = m.blockedT > 0.35;
    turnToward(m, a, m.turnRate, dt);
    m.reactT -= dt;
    if (m.engaged && m.reactT <= 0 && m.fireT <= 0 && m.reloadT <= 0 && !m.act && Math.abs(angleDiff(m.angle, a)) < 0.15) {
      if (m.slot.mag <= 0) { m.reloadT = m.weapon.reload; return; }
      if (!clear) return;
      this.fireWeapon(m);
      if (++m.burst >= 3) { m.burst = 0; m.fireT = 0.4; } // rafales de trois
    }
  }

  updateMate(m, dt) {
    if (!m.alive) return;
    // Détection de blocage (repoussé par un allié, coincé contre un angle) : nouveau trajet,
    // puis, si ça persiste, abandon temporaire de cette case.
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
        m.watchSpot = null;
        m.stuckCount = 0;
      }
    }
    if (m.stuckCount && !m.moving) m.stuckCount = 0;
    m.fireT -= dt; m.repathT -= dt;
    m.bloom = Math.max(0, m.bloom - dt * 7 * DEG);
    if (m.reloadT > 0) { m.reloadT -= dt; if (m.reloadT <= 0) m.slot.mag = m.weapon.mag; }
    if (m.stun > 0) { m.stun -= dt; m.target = null; m.moving = false; return; }
    this.mateCombat(m, dt);
    // recharge tranquille quand rien en vue
    if (!m.target && m.reloadT <= 0 && !m.act && m.slot.mag <= m.weapon.mag * 0.35) m.reloadT = m.weapon.reload;

    let dest = null;
    if (m.watchSpot) {
      // position d'observation : abandonnée si le joueur s'éloigne ou vise dessus, ou pendant un ordre de déplacement
      const invalid = m.order === 'move' || m.target
        || (m.order === 'follow' && (this.player.moving || dist(m.watchSpot.x, m.watchSpot.y, this.player.x, this.player.y) > 3.5 * U))
        || this.inAimCone(m.watchSpot.x, m.watchSpot.y, 25 * DEG);
      if (invalid) m.watchSpot = null;
    }
    if (m.order === 'move') dest = m.orderPos;
    else if (m.blockedLine && m.target) dest = this.firingSpot(m, m.target);
    else if (m.watchSpot) dest = m.watchSpot;
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
    if (m.engaged && !m.blockedLine && m.order !== 'move') { m.path = []; m.moving = false; }
    else if (dest) {
      const d = dist(m.x, m.y, dest.x, dest.y);
      const arrive = m.order === 'move' || dest === m.watchSpot || dest === m.fireSpot ? 4 : 12;
      if (d > arrive) {
        const tile = { x: Math.floor(dest.x / TILE), y: Math.floor(dest.y / TILE) };
        const changed = !m.destTile || m.destTile.x !== tile.x || m.destTile.y !== tile.y;
        if (changed || m.repathT <= 0 || !m.path.length) {
          const avoid = this.ops.filter(o => o !== m && o.alive).map(o => ({ x: o.x, y: o.y, r: (m.stuckCount ? 30 : 22) }));
          const path = this.map.routeTo(m.x, m.y, tile.x, tile.y, m.radius, { noClosedDoors: m.order === 'follow', avoid });
          m.path = path || [];
          if (m.path.length) m.path[m.path.length - 1] = { x: dest.x, y: dest.y };
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

  separate() {
    const all = [...this.ops, ...this.enemies].filter(a => a.alive);
    const p = this.player;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy), min = a.radius + b.radius;
      if (d < min) {
        // exactement superposés : on les écarte dans une direction arbitraire mais stable
        const k = i * 2.39996 + j;
        const nx = d > 0.001 ? dx / d : Math.cos(k), ny = d > 0.001 ? dy / d : Math.sin(k);
        // Les coéquipiers cèdent le passage : ils ne poussent jamais le joueur.
        const aMate = a !== p && a.team === 'ops', bMate = b !== p && b.team === 'ops';
        const onlyB = a === p && bMate, onlyA = b === p && aMate;
        const pushA = onlyA ? min - d : onlyB ? 0 : (min - d) / 2;
        const pushB = onlyB ? min - d : onlyA ? 0 : (min - d) / 2;
        const solidA = a.team === 'ops', solidB = b.team === 'ops';
        if (pushA && this.map.circleFree(a.x - nx * pushA, a.y - ny * pushA, a.radius - 1, solidA)) { a.x -= nx * pushA; a.y -= ny * pushA; }
        if (pushB && this.map.circleFree(b.x + nx * pushB, b.y + ny * pushB, b.radius - 1, solidB)) { b.x += nx * pushB; b.y += ny * pushB; }
      }
    }
  }

  // Si un agent est coincé dans un obstacle, on le ramène à la position libre la plus proche.
  unstick(agent) {
    const r = agent.radius - 1;
    if (this.map.circleFree(agent.x, agent.y, r, true)) return;
    for (let ring = 2; ring <= 28; ring += 2) {
      for (let k = 0; k < 16; k++) {
        const a = TAU * k / 16;
        const x = agent.x + Math.cos(a) * ring, y = agent.y + Math.sin(a) * ring;
        if (this.map.circleFree(x, y, r, true)) { agent.x = x; agent.y = y; return; }
      }
    }
  }

  // ---- Vision ----
  computeVision() {
    const p = this.player;
    const polys = [];
    if (p.alive) {
      this.map.markExplored(p.tx, p.ty);
      const cone = [];
      const n = Math.ceil(p.fov / (1 * DEG));
      for (let i = 0; i <= n; i++) {
        const a = p.angle - p.fov / 2 + p.fov * i / n;
        cone.push(this.map.castRay(p.x, p.y, a, p.viewRange, true));
      }
      polys.push({ x: p.x, y: p.y, pts: cone });
      const near = [];
      const NR = 2.6 * U, nn = 72;
      for (let i = 0; i <= nn; i++) near.push(this.map.castRay(p.x, p.y, TAU * i / nn, NR, true));
      polys.push({ x: p.x, y: p.y, pts: near });
      this.nearRange = NR;
      // fibre glissée sous la porte : un large cône depuis l'autre côté du battant
      const f = p.fiber;
      if (f) {
        const fc = [];
        const fn = Math.ceil(f.fov / (1.5 * DEG));
        for (let i = 0; i <= fn; i++) fc.push(this.map.castRay(f.x, f.y, f.angle - f.fov / 2 + f.fov * i / fn, f.range, true));
        polys.push({ x: f.x, y: f.y, pts: fc });
      }
    }
    for (const m of this.mates || []) {
      if (!m.alive) continue;
      this.map.markExplored(m.tx, m.ty);
      const cone = [];
      const n = Math.ceil(m.fov / (1.5 * DEG));
      for (let i = 0; i <= n; i++) cone.push(this.map.castRay(m.x, m.y, m.angle - m.fov / 2 + m.fov * i / n, m.viewRange, true));
      polys.push({ x: m.x, y: m.y, pts: cone });
    }
    this.visionPolys = polys;
    const mates = (this.mates || []).filter(m => m.alive);
    const f = p.fiber;
    const fiberSees = o => f && dist(f.x, f.y, o.x, o.y) < f.range
      && Math.abs(angleDiff(f.angle, Math.atan2(o.y - f.y, o.x - f.x))) < f.fov / 2
      && this.map.hasLOS(f.x, f.y, o.x, o.y);
    const sees = o => (p.alive && (this.canSee(p, o) || (dist(p.x, p.y, o.x, o.y) < this.nearRange && this.map.hasLOS(p.x, p.y, o.x, o.y)) || fiberSees(o)))
      || mates.some(m => this.canSee(m, o));
    for (const e of this.enemies) e.visible = (e.alive || !!e.dying) && sees(e);
    for (const h of this.hostages) h.visible = sees(h);
  }
}
