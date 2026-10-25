'use strict';
// Game : le joueur. Commandes au clavier et à la souris, armes et rechargement, grenades en main, relais dans un
// coéquipier, armes ramassées, sommation et menottes, fibre optique.

// Portée du ramassage d'une arme au sol, depuis le corps qui la porte.
const PICKUP_RANGE = 1.3 * U;

// Sommation (assaut) : portée de la voix, délai entre deux cris ; un suspect rendu mais laissé sans
// surveillance SURRENDER_LAPSE s reprend son arme ; menotter prend CUFF_TIME s.
const SHOUT_RANGE = 7 * U, SHOUT_COOLDOWN = 1.5, SURRENDER_LAPSE = 7, CUFF_TIME = 1.6;
// Les temps d'un rechargement (voir Game.reloadCues), à cette part de son déroulement : le chargeur sort, entre, puis on
// réarme (la culasse d'une arme d'épaule, la glissière d'une arme de poing).
const RELOAD_CUES = { box: [[0.12, 'out'], [0.55, 'in'], [0.85, 'bolt']], pistol: [[0.15, 'out'], [0.6, 'in'], [0.88, 'slide']] };

mixGame(class {
  // ---- Joueur ----
  updatePlayer(dt) {
    const p = this.player, k = this.input.keys, m = this.input.mouse, pr = this.input.pressed;
    // (mort, le menu se ferme ; le commandant de la stratégie, jamais vivant, n'en a pas : updateCommander)
    if (!p.alive) { this.menu = null; return; }
    if (p.flashT > 0) p.flashT -= dt;
    if (p.stun > 0) p.stun -= dt;
    // E et la molette : le menu contextuel (il prend ces touches avant tout le reste)
    this.updateMenu();
    if (!m.down) this.fireLock = false; // (le clic qui a retiré la fibre ne part pas en rafale)
    p.angle = Math.atan2(m.y - p.y, m.x - p.x);
    p.aimDist = dist(p.x, p.y, m.x, m.y);

    let dx = ((k.KeyD || k.ArrowRight) ? 1 : 0) - ((k.KeyA || k.ArrowLeft) ? 1 : 0);
    let dy = ((k.KeyS || k.ArrowDown) ? 1 : 0) - ((k.KeyW || k.ArrowUp) ? 1 : 0);
    if (pr.KeyQ || pr.ShiftLeft || pr.ShiftRight) this.toggleWalk(p);
    p.moving = false;
    this.unstick(p);
    if (dx || dy) {
      const l = Math.hypot(dx, dy); dx /= l; dy /= l;
      // toutes les armes portées pèsent, pas seulement celle qu'on a en main
      const spd = (p.walkMode ? p.walkSpeed : p.runSpeed) * loadMobility(p.weaponLoad) * (p.shield ? p.shield.mobility : 1) * (p.vest ? p.vest.mobility : 1)
        * (p.reloadT > 0 ? 0.8 : 1) * (p.act ? 0.55 : 1);
      const bx = p.x, by = p.y;
      this.tryMove(p, dx * spd * dt, dy * spd * dt);
      p.moving = true;
      p.moveDir = Math.atan2(dy, dx);
      this.footstep(p, dist(bx, by, p.x, p.y), p.walkMode ? 0 : STEP_NOISE.run);
      // Bloqué contre une porte fermée : rappel des commandes (pas d'ouverture automatique).
      if (Math.abs(p.x - bx) + Math.abs(p.y - by) < 0.01) {
        const ax = p.x + dx * (p.radius + 6), ay = p.y + dy * (p.radius + 6);
        const door = this.map.door(Math.floor(ax / TILE), Math.floor(ay / TILE));
        if (door && !door.open && !this.menu && this.message.t <= 0) this.say(door.locked && door.lockKnown ? 'Porte verrouillée — E : crocheter · B : charge' : 'E, E : ouvrir · E, molette : entrouvrir, fibre, charge', 1.4);
      }
    }

    this.updateFiber(p, dt);
    // R, ou le clic molette : recharger
    if (pr.KeyR || pr.Mouse1) this.startReload(p);
    if (pr.Digit1) this.switchWeapon(p, 0);
    if (pr.Digit2) this.switchWeapon(p, 1);
    if (pr.AltLeft || pr.AltRight) this.switchWeapon(p, (p.cur + 1) % p.slots.length);
    if (pr.Space || pr.KeyG) this.throwFlash(p);
    if (pr.KeyN) this.cycleNade(p);
    if (pr.KeyL) this.toggleLaser(p);
    if (pr.KeyX) this.toggleLamp(p);
    if (pr.KeyC) this.shout(p);
    if (pr.KeyB) this.chargeKey(p);
    if (pr.KeyV) this.pickUp(p, this.nearestDrop(p));
    else {
      // rappel discret en passant près d'une arme au sol (une fois par corps)
      const drop = this.nearestDrop(p);
      if (!drop) this.pickHint = null;
      else if (drop !== this.pickHint && this.message.t <= 0) {
        this.say(`V (ou E) : ramasser ${this.pickupSlot(drop.slot).def.name}`, 1.5);
        this.pickHint = drop;
      }
    }
    if (pr.KeyH) this.interact(p);
    else if (p.team === this.rescueTeam) {
      // même rappel en passant près d'un otage qui attend, ou d'un suspect rendu (une fois chacun)
      const e = this.nearestSurrendered(p, HOSTAGE_REACH);
      const h = e ? null : this.nearestHostage(p, HOSTAGE_REACH);
      const who = e || (h && !h.escort ? h : null);
      if (!who) this.hostHint = null;
      else if (who !== this.hostHint && this.message.t <= 0) { this.say(e ? 'H : menotter le suspect' : who.vip ? 'H : le VIP vous suit' : "H : emmener l'otage", 1.5); this.hostHint = who; }
    }
    // Clic droit : ordre de déplacement. Maintenu puis tiré, il fixe en plus une direction
    // à couvrir, confiée au coéquipier placé de ce côté. En siège, personne ne commande : pas d'ordres.
    // Double clic droit (DOUBLE_RIGHT, au même endroit) : le menu de la zone (zoneMenu) au lieu de l'ordre du premier
    // clic, qui attend donc ce délai avant de partir (rightClick)
    if (pr.Mouse2) {
      const rc = this.rightClick;
      if (rc && this.time - rc.t <= DOUBLE_RIGHT && dist(rc.x, rc.y, m.x, m.y) <= DOUBLE_RIGHT_GAP) {
        this.rightClick = null; this.orderDrag = null; pr.Mouse2 = false;
        this.openZoneMenu(rc.x, rc.y);
      } else this.rightClick = { t: this.time, x: m.x, y: m.y, o: null };
    }
    if ((pr.Mouse2 || pr.KeyT) && !this.canCommand()) { /* refus annoncé par canCommand */ }
    else if (pr.Mouse2) this.orderDrag = { x: m.x, y: m.y, angle: null, onSelf: dist(m.x, m.y, p.x, p.y) <= p.radius + 6 };
    if (this.orderDrag && this.input.mouse.rdown) {
      const d = dist(this.orderDrag.x, this.orderDrag.y, m.x, m.y);
      this.orderDrag.angle = d >= 0.7 * U ? Math.atan2(m.y - this.orderDrag.y, m.x - this.orderDrag.x) : null;
    }
    if (pr.Mouse2Up && this.orderDrag) {
      const o = this.orderDrag;
      this.orderDrag = null;
      // (une direction tirée part tout de suite : ce n'est pas un double clic)
      if (o.angle !== null || !this.rightClick) this.rightOrder(o);
      else this.rightClick.o = o;
    }
    const rc = this.rightClick;
    if (rc && this.time - rc.t > DOUBLE_RIGHT) { this.rightClick = null; if (rc.o) this.rightOrder(rc.o); }
    if (pr.KeyT && this.canCommand(true)) this.toggleHold();

    const s = p.slot, w = s.def;
    p.fireT -= dt;
    p.switchT -= dt;
    p.bloom = Math.max(0, p.bloom - dt * 7 * DEG);
    // Chargement cartouche par cartouche : un tir interrompt le rechargement s'il reste une cartouche.
    if (p.reloadT > 0 && w.reloadType === 'shell' && pr.Mouse0 && s.mag > 0) p.reloadT = 0;
    if (p.reloadT > 0) {
      const k0 = 1 - p.reloadT / p.reloadDur;
      p.reloadT -= dt;
      this.reloadCues(p, w, k0, 1 - Math.max(0, p.reloadT) / p.reloadDur);
      if (p.reloadT <= 0) {
        if (w.reloadType === 'shell') {
          s.mag++; s.reserve--;
          if (s.mag < w.mag && s.reserve > 0) p.reloadT = p.reloadDur = w.reload;
        } else {
          const take = Math.min(w.mag - s.mag, s.reserve);
          s.mag += take; s.reserve -= take;
        }
      }
    } else if (p.switchT <= 0 && p.stun <= 0 && !p.act && !p.fiber && !p.cooking && !this.fireLock) {
      const want = w.auto ? m.down : pr.Mouse0;
      if (want && p.fireT <= 0) {
        if (s.mag <= 0) { if (pr.Mouse0) { if (s.reserve > 0) this.startReload(p); else this.say('Plus de munitions', 1.5); } }
        else this.fireWeapon(p);
      }
    }
  }

  toggleWalk(p) {
    p.walkMode = !p.walkMode;
    this.say(p.walkMode ? 'Mode marche : précis et discret' : 'Mode course', 1.2);
  }

  toggleLaser(p) {
    if (!p.slots.some(s => s.def.laser)) { this.say('Aucun laser sur vos armes', 1.2); return; }
    p.laserOn = !p.laserOn;
    this.say(p.laserOn ? 'Laser allumé' : 'Laser éteint', 1.2);
  }

  // La lampe, et celles des coéquipiers avec (ils ne la gardent pas allumée quand vous éteignez la vôtre).
  hasLamp(p) { return p.slots.some(s => s.def.light) || this.mates.some(m => m.alive && m.weapon && m.weapon.light); }
  toggleLamp(p) {
    const team = this.mates.some(m => m.alive && m.weapon && m.weapon.light);
    if (!this.hasLamp(p)) { this.say('Aucune lampe sur vos armes', 1.2); return; }
    p.lampOn = !p.lampOn;
    for (const m of this.mates) m.lampOn = p.lampOn;
    this.say(p.lampOn ? (team ? 'Lampes allumées' : 'Lampe allumée') : (team ? 'Lampes éteintes' : 'Lampe éteinte'), 1.2);
  }

  startReload(p) {
    const s = p.slot, w = s.def;
    if (p.reloadT > 0 || p.act || p.fiber || p.cooking || s.mag >= w.mag || s.reserve <= 0) return;
    p.reloadT = p.reloadDur = w.reload;
  }

  // Les sons d'un rechargement, joués au fil de l'animation : avant / après, où il en était (de 0 à 1) avant et après ce
  // pas de temps. Un fusil à pompe glisse ses cartouches une à une (une par tranche de w.reload, à six dixièmes).
  reloadCues(a, w, before, after) {
    if (!Sound.ctx) return;
    if (w.reloadType === 'shell') {
      const n = Math.max(1, Math.round((a.reloadDur || w.reload) / w.reload));
      for (let i = 0; i < n; i++) { const k = (i + 0.6) / n; if (before < k && after >= k) this.sfx('reload', a.x, a.y, 4 * U, 'shell', w); }
      return;
    }
    for (const [k, cue] of RELOAD_CUES[w.kind === 'pistol' ? 'pistol' : 'box']) if (before < k && after >= k) this.sfx('reload', a.x, a.y, 4 * U, cue, w);
  }

  // L'ordre d'un clic droit relâché : sur soi, l'équipe reprend le suivi ; sur une porte fermée, en colonne de part et
  // d'autre, prête à entrer (sur la porte de la colonne, elle entre) ; ailleurs, ordre de déplacement.
  rightOrder(o) {
    if (!this.canCommand(true)) return;
    const door = o.onSelf ? null : this.doorAtPoint(o.x, o.y);
    if (o.onSelf) this.orderFollow();
    else if (door && this.stack && this.stack.door === door && !door.broken && door.progress < 1) this.stackPlain(this.stack);
    else if (door && !door.broken && !this.map.doorPassable(door)) this.orderStack(door);
    else this.orderMove(o.x, o.y, o.angle);
  }

  // Lancer une grenade de cette sorte au point at, sans viser ni tenir la touche (menu de la zone) : elle part dès la fin
  // du geste ; la sorte en main ne change pas.
  throwAt(p, kind, at) {
    const prev = p.nade;
    p.nade = kind;
    this.throwFlash(p, { x: at.x, y: at.y });
    if (prev !== kind && p.nades[prev] > 0) p.nade = prev;
    this.emit('weapon');
  }

  switchWeapon(p, i) {
    if (i === p.cur || i >= p.slots.length || p.act) return;
    p.cur = i; p.reloadT = 0; p.switchT = 0.45; p.bloom = 0;
    this.sfx('draw', p.x, p.y, 4 * U);
    this.emit('weapon');
  }

  // Grenades du joueur selon le camp : le groupe armé a deux grenades à fragmentation ; l'intervention, le lot choisi au
  // briefing (NADE_KITS). kept : les grenades d'un coéquipier qui reprend la main (il garde les siennes). En main, les
  // flashs d'abord.
  armGrenades(p, kept) {
    const kit = NADE_KITS[this.loadout.nades] || NADE_KITS.flash;
    p.nades = this.camp === 'armed' ? { flash: 0, frag: 2 }
      : kept ? { flash: kept.flash || 0, frag: kept.frag || 0 }
      : { flash: kit.flash, frag: kit.frag };
    p.nade = p.nades.flash > 0 || !p.nades.frag ? 'flash' : 'frag';
  }

  // N : l'autre sorte de grenade en main, s'il en reste (lot mixte). Pas pendant qu'on en dégoupille une.
  cycleNade(p) {
    if (p.cooking || (p.act && p.act.type === 'grenade')) return;
    const other = Object.keys(p.nades).find(k => k !== p.nade && p.nades[k] > 0);
    if (!other) { this.say("Pas d'autre grenade", 1.2); return; }
    p.nade = other;
    this.say(other === 'frag' ? 'Grenade à fragmentation en main' : 'Flash en main', 1.2);
    this.emit('weapon');
  }

  // ---- Relais et armes au sol ----
  // Le joueur est tombé : on reprend la main dans le coéquipier debout le plus proche. On garde le
  // même objet (les ennemis qui le visaient le visent toujours) en lui donnant le prototype du joueur.
  takeOver() {
    const old = this.player;
    // d'abord un coéquipier de votre trinôme ; en trinômes, quand il n'en reste plus, un homme de l'autre (en guerre
    // totale, non : votre trinôme reviendra de la base)
    const crew = this.crew, pool = crew.length || this.war ? crew : this.mates.filter(x => x.alive);
    const m = pool.sort((a, b) => dist(a.x, a.y, old.x, old.y) - dist(b.x, b.y, old.x, old.y))[0];
    if (!m) return;
    if (m.hunter) {
      // il quitte la manœuvre autonome (et la colonne où il était) pour vos commandes
      if (m.group) m.group.members = m.group.members.filter(o => o !== m);
      Object.assign(m, { hunter: false, drilled: false, group: null, entry: null, clear: null, escorting: null, blind: null, pace: 1, watchDir: null });
    }
    // un homme de l'intervention qui menait au bouclier le garde au bras, avec ses chargeurs en plus (voir Player.equip)
    const main = this.pickupSlot(m.slot), kept = m.nades, sh = m.shield || null;
    if (sh) main.reserve += main.def.mag * SHIELD_EXTRA_MAGS;
    delete m.slot; // la propriété propre du coéquipier masquerait l'accesseur du joueur
    Object.setPrototypeOf(m, Player.prototype);
    m.slots = main.def.kind === 'pistol' ? [main] : [main, makeSlot(this.loadout.sidearm, accOf(this.loadout, this.loadout.sidearm))];
    m.cur = 0;
    Object.assign(m, {
      runSpeed: 118, walkSpeed: 62, walkMode: old.walkMode, fov: sh ? sh.fov : 120 * DEG, viewRange: 15 * U, spreadMul: 1, shield: sh, laserOn: true,
      reloadT: 0, switchT: 0.3, fiber: null, flashT: 0, act: null, path: [], moving: false, charges: old.charges || 0,
      target: null, lookAt: null, alertAngle: null, order: null, coverAngle: null, blockedLine: false,
    });
    m.moveDir = m.angle;
    this.armGrenades(m, kept); // il garde les grenades qui lui restent
    // l'ancien joueur reste au sol, dans la liste de l'équipe (« À terre »)
    old.accent = '#9aa4ae';
    this.mates = [...this.mates.filter(x => x !== m), old];
    this.player = m;
    this.relayT = 0;
    this.orderDrag = null;
    this.menu = null;
    if (this.orderMarker && this.orderMarker.mate === m) this.orderMarker = null;
    // le VIP qui suivait l'ancien joueur suit celui qui reprend la main
    const v = this.vip, follows = v && v.alive && !v.escort && v.lostEscort === old;
    if (follows) { this.takeCharge(v, m); v.lostEscort = null; }
    this.say(follows ? `${m.name} prend le relais — le VIP le suit` : `${m.name} prend le relais`, 3);
    this.emit('weapon');
  }

  // Arme ramassée : les armes de l'IA (chargeur infini) redeviennent leur modèle réel, avec des
  // munitions finies et les accessoires montés dessus ; une arme déjà portée par un joueur garde son chargeur
  // et sa réserve.
  pickupSlot(s) {
    const def = WEAPONS[s.def.pickup] ? fittedDef(s.def.pickup, s.def.acc) : s.def;
    const mag = Number.isFinite(s.mag) ? Math.min(s.mag, def.mag) : def.mag;
    const reserve = def === s.def && Number.isFinite(s.reserve) ? s.reserve : def.reserve;
    return { def, mag, reserve };
  }

  // Corps le plus proche portant encore une arme, à portée de ramassage. Bouclier au bras, on n'a
  // qu'une main libre : seule une arme de poing se prend.
  nearestDrop(p) {
    let best = null, bd = PICKUP_RANGE;
    for (const a of [...this.enemies, ...this.mates]) {
      if (a.alive || a.dying || !a.slot || a === p) continue;
      if (p.shield && this.pickupSlot(a.slot).def.kind !== 'pistol') continue;
      const d = dist(a.x, a.y, p.x, p.y);
      if (d < bd && this.map.hasLOS(p.x, p.y, a.x, a.y)) { bd = d; best = a; }
    }
    return best;
  }

  // V (ou une ligne du menu de E) : ramasser l'arme du corps body. Elle remplace celle de même catégorie (arme de poing ou
  // arme principale), qui reste au sol à sa place : c'est un échange.
  pickUp(p, body) {
    if (p.act || p.fiber) return;
    if (!body) { this.say(p.shield ? 'Aucune arme de poing à ramasser (bouclier au bras)' : 'Aucune arme à ramasser', 1.2); return; }
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
      this.sfx('draw', p.x, p.y, 4 * U);
      this.emit('weapon');
    });
  }

  // ---- Sommation et arrestation (assaut) ----
  // C : « Police ! À terre ! ». Chaque suspect que vous voyez à portée de voix peut se rendre : il lâche son
  // arme et se met à genoux, les mains sur la tête. Ses chances montent s'il est aveuglé, blessé, pris de
  // dos ou tenu en joue par plusieurs d'entre vous ; elles baissent s'il est en plein échange de tirs ou si un
  // complice est à côté de lui. Le cri s'entend comme tout cri : les autres viennent voir.
  shout(p) {
    if (this.squads) { this.say('Pas de sommation : ils sont venus se battre', 1.6); return; }
    if (this.siege) { this.say("Personne ne se rend de ce côté-ci : c'est vous qu'on somme", 1.6); return; }
    if (!p.alive || this.time - this.shoutT < SHOUT_COOLDOWN) return;
    const { asked, gave } = this.summon(p);
    this.say(gave > 1 ? `${gave} suspects se rendent — H : menotter` : gave ? 'Le suspect se rend — H : menotter'
      : asked ? 'Police ! — il refuse de se rendre' : 'Police ! — personne en vue', 1.8);
  }

  // La sommation de a (vous, ou un coéquipier, voir mateCombat) : chaque suspect qu'il voit à portée de voix peut se
  // rendre (surrenderChance) ; le cri s'entend comme tout cri. Renvoie { asked, gave } : combien l'ont entendue en face,
  // combien se rendent.
  summon(a) {
    this.shoutT = this.time;
    // (sans les voix, ou sans voix française, deux syllabes graves)
    if (Sound.voices) this.voice(a, 'shout'); else this.sfx('shout', a.x, a.y, VOICE_RANGE);
    let asked = 0, gave = 0;
    for (const e of this.enemies) {
      if (!e.alive || e.surrender || e.hunter) continue;
      if (dist(a.x, a.y, e.x, e.y) > SHOUT_RANGE || !(a === this.player ? this.playerSees(e) : this.canSee(a, e))) continue;
      asked++;
      if (Math.random() < this.surrenderChance(e, a)) { this.surrenderTo(e); gave++; }
    }
    this.noise(a.x, a.y, SHOUT_RANGE, a, 'voice');
    return { asked, gave };
  }

  // Sommation possible : en assaut et en escorte, du côté de l'intervention.
  canSummon() { return !this.squads && !this.siege && this.camp === 'police'; }

  // Le joueur voit-il cet agent (dans son champ, ou tout près) ?
  playerSees(o) {
    const p = this.player;
    return p.alive && (this.canSee(p, o) || (dist(p.x, p.y, o.x, o.y) < (this.nearRange || 2.6 * U) && this.map.hasLOS(p.x, p.y, o.x, o.y)));
  }

  // Chance que le suspect e se rende à la sommation de by (vous, par défaut).
  surrenderChance(e, by = this.player) {
    const p = by;
    let c = 0.15;
    if (e.stun > 0) c += 0.45;                                   // aveuglé, sonné
    if (e.hp < e.maxHp) c += e.hp < e.maxHp * 0.5 ? 0.35 : 0.2;  // blessé
    const facing = e.stun <= 0 && this.canSee(e, p);
    if (!facing) c += 0.25;                                      // pris de dos ou à l'aveugle
    else if (e.target) c -= 0.2;                                 // en plein échange de tirs
    c += 0.1 * this.ops.filter(o => o !== p && o.alive && this.canSee(o, e)).length; // tenu en joue par l'équipe
    c -= 0.2 * this.enemies.filter(o => o !== e && o.alive && !o.surrender
      && dist(o.x, o.y, e.x, e.y) < 4 * U && this.map.hasLOS(o.x, o.y, e.x, e.y)).length; // un complice à côté
    return clamp(c, 0.05, 0.95);
  }

  surrenderTo(e) {
    this.voice(e, 'surrender');
    e.surrender = { t: 0, lapse: 0 };
    Object.assign(e, { target: null, blind: null, path: [], act: null, waitDoor: null, alertAngle: null, lookAt: null,
      moving: false, engaged: false, stun: 0, reloadT: 0, state: 'idle', guard: null, barricade: null, retreat: null });
  }

  // Un suspect rendu reste à genoux tant qu'on le surveille. Laissé seul trop longtemps (personne de l'équipe
  // ne le voit), il ramasse son arme et reprend le combat. Menotté, il ne bouge plus.
  updateSurrendered(e, dt) {
    const s = e.surrender;
    s.t += dt;
    e.moving = false;
    if (e.cuffed) return;
    const watched = this.ops.some(o => o.alive && (this.canSee(o, e) || (dist(o.x, o.y, e.x, e.y) < 2.5 * U && this.map.hasLOS(o.x, o.y, e.x, e.y))));
    s.lapse = watched ? 0 : s.lapse + dt;
    if (s.lapse < SURRENDER_LAPSE) return;
    e.surrender = null;
    const near = this.ops.filter(o => o.alive).sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y))[0];
    Object.assign(e, { state: 'engage', lostT: 0, suspicion: 2, reactT: e.reaction, lastKnown: near ? { x: near.x, y: near.y } : null });
    this.startAction(e, 'pickup', 0.8, null);
    if (this.playerSees(e)) this.say('Un suspect laissé sans surveillance reprend son arme !', 2.2);
  }

  // Suspect rendu, pas encore menotté, le plus proche à vue.
  nearestSurrendered(a, R) {
    let best = null, bd = R;
    for (const e of this.enemies) {
      if (!e.alive || !e.surrender || e.cuffed) continue;
      const d = dist(a.x, a.y, e.x, e.y);
      if (d < bd && this.map.hasLOS(a.x, a.y, e.x, e.y)) { bd = d; best = e; }
    }
    return best;
  }

  // H : menotter le suspect rendu à portée, sinon s'occuper de l'otage (voir toggleEscort).
  interact(p) {
    const e = p.team === this.rescueTeam ? this.nearestSurrendered(p, HOSTAGE_REACH) : null;
    const h = e ? this.nearestHostage(p, HOSTAGE_REACH) : null;
    if (e && (!h || dist(p.x, p.y, e.x, e.y) <= dist(p.x, p.y, h.x, h.y))) this.cuff(p, e);
    else this.toggleEscort(p);
  }

  cuff(p, e) {
    if (p.act) return;
    this.startAction(p, 'cuff', CUFF_TIME, () => {
      if (!e.alive || !e.surrender || e.cuffed || !p.alive || dist(p.x, p.y, e.x, e.y) > 2 * U) return;
      e.cuffed = true;
      this.stats.arrests++;
      this.hostHint = e;
      this.sfx('cuffs', p.x, p.y, 4 * U);
      this.say(`Suspect menotté (${this.enemies.filter(o => o.cuffed).length} arrêté${this.stats.arrests > 1 ? 's' : ''})`, 1.8);
    });
  }

  // Dégoupiller et armer le bras prend un instant. La mèche part à la fin de ce geste, pas au
  // lancer : tant qu'on garde la touche, la grenade brûle dans la main (on « compte » avant de
  // la jeter, quitte à la garder une seconde de trop).
  // at : un point visé d'avance ; la grenade part alors dès la fin du geste, sans attendre de relâcher.
  throwFlash(p, at) {
    if (p.flashbangs <= 0 || p.stun > 0 || p.act || p.cooking) return;
    p.flashbangs--;
    this.stats.flashes++;
    this.sfx('tick', p.x, p.y, 3 * U, 0.12); // goupille
    const kind = p.nade || 'flash';
    this.startAction(p, 'grenade', 0.45, () => {
      p.cooking = { t: 0, kind, fuse: FUSE[kind === 'frag' ? 'frag' : 'flash'], at: at || null };
      this.sfx('tick', p.x, p.y, 3 * U, 0.1); // la cuillère part : la mèche brûle
    });
  }

  // La dernière de sa sorte partie, l'autre sorte (lot mixte) passe en main.
  nextNade(p) {
    if (!p.nades || p.nades[p.nade] > 0) return;
    const other = Object.keys(p.nades).find(k => p.nades[k] > 0);
    if (other) p.nade = other;
  }

  // Grenade dégoupillée en main : elle part au relâchement de la touche, et éclate sur place
  // si on la garde jusqu'au bout.
  updateCooking(p, dt) {
    const c = p.cooking;
    if (!c) return;
    c.t += dt;
    if (c.t >= c.fuse) {
      p.cooking = null;
      this.nextNade(p);
      if (c.kind === 'frag') this.detonateFrag({ x: p.x, y: p.y, thrower: p, team: p.team, kind: 'frag' });
      else this.detonateFlash(p.x, p.y, null); // à bout portant, même son camp est aveuglé
      this.say('Elle vous a explosé dans la main', 3); // après l'explosion : ce message-là prime
      return;
    }
    const k = this.input.keys;
    if (!p.alive || c.at || !(k.Space || k.KeyG)) {
      p.cooking = null;
      const m = c.at || this.input.mouse;
      this.spawnFlash(p, p.alive ? m.x : p.x, p.alive ? m.y : p.y, c.t, null, c.kind);
      if (p.alive) this.voice(p, c.kind === 'frag' ? 'frag' : 'flash');
      this.nextNade(p);
    }
  }

  // ---- Fibre optique sous la porte ----
  // Maintenir F glisse une fibre sous le battant : on voit la pièce voisine sans ouvrir, mais
  // on est immobile et incapable de tirer tant qu'on regarde. Posée depuis le menu de E (sticky), elle reste
  // sans tenir la touche, jusqu'au premier pas, à un clic ou à F.
  updateFiber(p, dt) {
    const k = this.input.keys, pr = this.input.pressed;
    if (p.fiber) {
      const f = p.fiber;
      if (f.sticky && pr.Mouse0) this.fireLock = true; // (le clic qui la retire ne tire pas)
      if ((f.sticky ? pr.Mouse0 || pr.KeyF : !k.KeyF) || !p.alive || p.stun > 0 || p.moving || f.door.opening || f.door.open
          || dist(p.x, p.y, f.door.cx, f.door.cy) > 2 * U) this.endFiber(p);
      return;
    }
    if (!pr.KeyF || p.act || !p.alive) return;
    this.startFiber(p, this.nearestDoor(p, 1.6 * U), false);
  }

  startFiber(p, d, sticky) {
    if (p.act || p.fiber || !p.alive) return;
    if (this.camp === 'armed') { this.say('Pas de fibre optique dans ce camp', 1.2); return; }
    if (!d || dist(p.x, p.y, d.cx, d.cy) > 1.6 * U) { this.say('Aucune porte à portée', 1); return; }
    if (d.open) { this.say('La porte est déjà ouverte', 1); return; }
    const spot = this.fiberSpot(p, d);
    if (!spot) { this.say('Impossible de glisser la fibre ici', 1.2); return; }
    this.sfx('tick', p.x, p.y, 2 * U, 0.1);
    this.startAction(p, 'fiber', 0.7, () => {
      if ((sticky || this.input.keys.KeyF) && p.alive) p.fiber = { ...spot, sticky };
      if (sticky && p.fiber) this.say('Fibre en place — un pas, un clic ou F la retire', 1.6);
    });
  }

  endFiber(p) {
    p.fiber = null;
    this.sfx('tick', p.x, p.y, 2 * U, 0.07);
  }

  // Point d'observation : juste de l'autre côté du battant, au milieu de l'embrasure.
  fiberSpot(p, d) {
    const nx = d.horizontal ? 0 : 1, ny = d.horizontal ? 1 : 0;
    const s = Math.sign((d.horizontal ? d.cy - p.y : d.cx - p.x)) || 1;
    const x = d.cx + nx * s * (TILE / 2 + 7), y = d.cy + ny * s * (TILE / 2 + 7);
    if (this.map.blocksMove(Math.floor(x / TILE), Math.floor(y / TILE))) return null;
    return { door: d, x, y, angle: Math.atan2(y - p.y, x - p.x), fov: 150 * DEG, range: 6 * U };
  }
});
