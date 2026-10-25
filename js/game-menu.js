'use strict';
// Game : les menus contextuels. À pied, E ouvre ce qu'on peut faire de ce qui est à portée de main ; en stratégie, des
// boutons apparaissent sur la porte où un trinôme en colonne attend vos ordres.

// Le menu de E s'ouvre sur ce qui est à MENU_REACH de vous, et se referme au-delà de MENU_KEEP ; il propose au plus
// MENU_DROPS armes au sol, les plus proches.
const MENU_REACH = 1.8 * U, MENU_KEEP = 2.4 * U, MENU_DROPS = 3;
// Menu ouvert, une autre touche ne fait que le fermer (elle ne tire pas, ne donne pas d'ordre) ; sauf celles-ci : E et
// la molette le mènent, Échap met en pause (ce qui le ferme), et les relâchements de boutons ne comptent pas.
const MENU_KEYS = new Set(['KeyE', 'WheelUp', 'WheelDown', 'Escape', 'Mouse0Up', 'Mouse2Up']);
// Double clic droit : deux clics à moins de DOUBLE_RIGHT s et DOUBLE_RIGHT_GAP l'un de l'autre ouvrent le menu de la zone
// cliquée ; une grenade s'y lance d'au plus ZONE_THROW (la portée d'un lancer, voir spawnFlash).
const DOUBLE_RIGHT = 0.3, DOUBLE_RIGHT_GAP = 0.8 * U, ZONE_THROW = 7 * U;

mixGame(class {
  // ---- Menu contextuel (E) ----
  // E ouvre, au bord de ce qu'il désigne, la liste de ce qu'on peut en faire : votre colonne en place (entrer, poser une
  // charge, entrer à la flash, à la grenade ; la charge posée, ce qui suit sa mise à feu), une porte (l'ouvrir,
  // l'entrouvrir, la crocheter, la fibre, la charge, la colonne), votre charge posée (la mise à feu, d'aussi loin qu'on
  // soit), un coéquipier tout près (le rappeler, le faire tenir), et les armes au sol à portée. La première ligne annule ; celle choisie d'avance, juste en dessous, est la plus simple
  // (ouvrir la porte, entrer) : E, E fait donc ce que faisait E. La molette choisit une autre ligne, E la valide ; une
  // ligne impossible reste grisée, avec la raison. Le temps ne s'arrête pas et la visée suit le curseur, mais toute
  // autre touche ne fait que fermer le menu (MENU_KEYS) ; il se ferme aussi quand on s'éloigne. En stratégie, voir
  // stratDoorMenus.
  // Ce que désigne E, dans l'ordre : votre colonne qui attend vos ordres (où que vous soyez), votre charge posée (où
  // qu'elle soit), une porte à portée de main, un coéquipier tout près, une arme au sol ; null : rien. near : la porte à
  // portée quand c'est la colonne ou la charge qui mène le menu (elle y prend sa section). keep : un menu déjà ouvert
  // (portée plus large).
  menuContext(keep) {
    const p = this.player, s = this.stack, reach = keep ? MENU_KEEP : MENU_REACH;
    const waits = this.canCommand(true) && this.stackWaits(s);
    const d = this.nearestDoor(p, reach);
    if (waits) return { kind: 'stack', door: s.door, st: s, near: d };
    const charge = this.ownCharge();
    if (charge) return { kind: 'charge', door: charge.door, charge, near: d };
    if (d) return { kind: 'door', door: d };
    const m = this.canCommand(true) ? this.crew.filter(o => o.alive && dist(o.x, o.y, p.x, p.y) <= reach)
      .sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y))[0] : null;
    if (m) return { kind: 'mate', mate: m };
    const drop = this.dropsNear(p, reach)[0];
    return drop ? { kind: 'drop', body: drop } : null;
  }

  // La charge de brèche de votre camp posée quelque part (B, ou votre colonne), null sinon.
  ownCharge() {
    const p = this.player;
    return p.alive && this.camp !== 'armed' ? this.charges.find(c => c.team === p.team) || null : null;
  }

  // Les corps qui portent encore une arme, à r de p et en vue, du plus proche au plus loin (MENU_DROPS au plus).
  dropsNear(p, r) {
    return [...this.enemies, ...this.mates]
      .filter(a => !a.alive && !a.dying && a.slot && a !== p && dist(a.x, a.y, p.x, p.y) <= r && this.map.hasLOS(p.x, p.y, a.x, a.y))
      .sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y)).slice(0, MENU_DROPS);
  }

  openMenu() {
    const c = this.menuContext();
    if (!c) { this.say('Rien à portée de main', 1); return null; }
    const mn = this.menu = { ...c, sel: null, title: '', items: [] };
    this.menuItems(mn);
    const first = mn.items.find(it => it.id !== 'cancel' && !it.sep);
    if (!first) { this.menu = null; return null; }
    // la plus simple d'abord (sous « Annuler »), même grisée : E, E tente toujours le geste principal (et dit pourquoi
    // il est impossible)
    mn.sel = first.id;
    Sound.tick(0.05);
    return mn;
  }

  // À chaque image (updatePlayer) : E ouvre ou valide, la molette choisit, toute autre touche ferme le menu sans rien
  // faire d'autre (un clic ne tire pas tant qu'on ne l'a pas relâché). Le menu se ferme aussi quand ce qu'il désigne
  // n'est plus là (porte trop loin, colonne entrée ou défaite).
  updateMenu() {
    const pr = this.input.pressed, mn = this.menu;
    const e = pr.KeyE, dir = (pr.WheelDown ? 1 : 0) - (pr.WheelUp ? 1 : 0);
    delete pr.KeyE; delete pr.WheelUp; delete pr.WheelDown;
    if (!mn) { if (e) this.openMenu(); return; }
    const other = Object.keys(pr).filter(code => pr[code] && !MENU_KEYS.has(code));
    if (other.length) {
      for (const code of other) delete pr[code];
      if (other.includes('Mouse0')) this.fireLock = true;
      this.closeMenu();
      return;
    }
    if (mn.kind !== 'zone') {
      // (le menu de la zone, lui, reste ouvert sur son point)
      const c = this.menuContext(true);
      if (!c || c.kind !== mn.kind || (c.kind !== 'drop' && c.door !== mn.door) || c.mate !== mn.mate) { this.menu = null; if (e) this.openMenu(); return; }
      mn.near = c.near;
    }
    this.menuItems(mn); // (l'état change pendant qu'on choisit : porte qui bouge, charge posée)
    if (!mn.items.some(it => it.id !== 'cancel' && !it.sep)) { this.menu = null; return; }
    let i = Math.max(0, mn.items.findIndex(it => it.id === mn.sel));
    if (mn.items[i].sep) i = mn.items.findIndex(it => !it.sep);
    if (dir) {
      // la molette saute les lignes grisées et les intertitres
      for (let j = i + dir; j >= 0 && j < mn.items.length; j += dir) if (!mn.items[j].off && !mn.items[j].sep) { i = j; Sound.tick(0.04); break; }
    }
    mn.sel = mn.items[i].id;
    if (e) this.menuPick(mn.items[i]);
  }

  closeMenu() { this.menu = null; Sound.tick(0.03); }

  // Ligne grisée : on dit pourquoi, et le menu reste ouvert pour un autre choix.
  menuPick(it) {
    if (it.sep) return;
    if (it.off) { this.say(`${it.label} : ${it.off}`, 1.4); return; }
    if (this.menu && this.menu.items.includes(it)) this.menu = null;
    it.run();
  }

  // Remplit mn.title et mn.items : { id, label, key (le raccourci, s'il y en a un), off (raison si impossible), run }, ou
  // un intertitre { sep: true, label } qui ouvre une section (la porte à portée, sous la colonne ; les armes au sol). À
  // pied, « Annuler » vient en tête (au-dessus de la ligne choisie d'avance) ; les boutons des portes en stratégie n'en
  // ont pas.
  menuItems(mn) {
    const items = [];
    const add = (id, label, key, off, run) => items.push({ id, label, key: key || '', off: off || null, run });
    const sep = label => items.push({ id: 'sep' + items.length, label, sep: true, key: '', off: null, run: () => {} });
    if (!this.strat) add('cancel', 'Annuler', '', null, () => {});
    if (mn.kind === 'stack') {
      this.stackMenu(mn, add);
      const d = mn.near, c = this.ownCharge(), s = mn.st;
      if (c && !s.ai && !(s.charge && s.charge.obj === c)) {
        // une charge à vous ailleurs que sur la porte de la colonne : sa mise à feu, sous la colonne
        sep('Charge posée');
        add('blast', 'Faire sauter la charge', 'B', null, () => this.detonateCharge(c));
      }
      if (d && d === mn.door) {
        // devant la porte même de la colonne : la fibre, pour voir ce qui attend derrière avant d'entrer
        if (this.camp !== 'armed') { sep('Porte'); this.fiberLine(d, add); }
      } else if (d) this.doorSection(d, add, sep);
    } else if (mn.kind === 'charge') {
      // votre charge, d'aussi loin qu'on soit : la mise à feu d'abord (E, E), puis la porte à portée, s'il y en a une
      const c = mn.charge;
      mn.title = 'Charge posée';
      add('blast', 'Faire sauter la charge', 'B', null, () => this.detonateCharge(c));
      if (mn.near) this.doorSection(mn.near, add, sep);
    } else if (mn.kind === 'zone') this.zoneMenu(mn, add);
    else if (mn.kind === 'mate') this.mateMenu(mn, add);
    else if (mn.kind === 'door') this.doorMenu(mn, add);
    else mn.title = 'Armes au sol';
    if (!this.strat && mn.kind !== 'zone') this.dropMenu(mn, add, sep);
    mn.items = items;
    return items;
  }

  // Les gestes d'une porte à portée, dans leur section sous la colonne ou la charge (ids préfixés : ceux de la colonne
  // ont les mêmes ; la mise à feu y est déjà).
  doorSection(d, add, sep) {
    const sub = { door: d, title: '' }, lines = [];
    this.doorMenu(sub, (...a) => lines.push(a));
    sep(sub.title);
    for (const [id, ...rest] of lines) if (id !== 'blast') add('door:' + id, ...rest);
  }

  // ---- Menu de la zone (double clic droit) ----
  // Deux clics droits au même endroit : ce qu'on peut faire là, surtout y lancer une grenade, vous-même ou par celui de
  // vos coéquipiers qui a une trajectoire libre jusque-là, et y envoyer l'équipe (l'ordre du clic simple). La molette
  // choisit, E valide, comme le menu de E.
  openZoneMenu(x, y) {
    const mn = this.menu = { kind: 'zone', at: { x, y }, sel: null, title: '', items: [] };
    this.menuItems(mn);
    const first = mn.items.find(it => it.id !== 'cancel' && !it.sep && !it.off) || mn.items.find(it => it.id !== 'cancel' && !it.sep);
    if (!first) { this.menu = null; return null; }
    mn.sel = first.id;
    Sound.tick(0.05);
    return mn;
  }

  zoneMenu(mn, add) {
    const p = this.player, at = mn.at, d = dist(p.x, p.y, at.x, at.y);
    const kinds = this.camp === 'armed' ? ['frag'] : ['flash', 'frag'], what = { flash: 'une flash', frag: 'une grenade' };
    const none = kind => (kind === 'frag' ? 'plus de grenade' : 'plus de flash');
    const busy = p.act || p.cooking || p.fiber || p.stun > 0 ? 'mains occupées' : null;
    mn.title = this.map.blocksMove(Math.floor(at.x / TILE), Math.floor(at.y / TILE)) ? 'Là-bas' : 'Ici';
    for (const kind of kinds) {
      add('p' + kind, `Lancer ${what[kind]} ici`, '', !(p.nades[kind] > 0) ? none(kind) : d > ZONE_THROW ? 'trop loin' : busy || this.zoneDanger(kind, at),
        () => this.throwAt(p, kind, at));
    }
    if (!this.canCommand(true) || !this.crew.some(m => m.alive)) return;
    for (const kind of kinds) {
      const m = this.zoneThrower(kind, at), any = this.crew.some(o => o.alive && o.nades[kind] > 0);
      add('m' + kind, `${m ? m.name : 'Équipe'} : ${what[kind]} ici`, '', !any ? none(kind) : !m ? 'personne n’a de trajectoire libre' : this.zoneDanger(kind, at),
        () => this.mateThrowAt(m, kind, at));
    }
    add('move', `${this.orderName()} : allez là`, 'clic droit', null, () => this.orderMove(at.x, at.y));
  }

  // Une grenade à fragmentation tue tout ce qui se tient à FRAG_RADIUS : pas sur les vôtres ni sur un otage.
  zoneDanger(kind, at) {
    if (kind !== 'frag') return null;
    const r = FRAG_RADIUS + 0.5 * U, near = o => o.alive && !o.evacuated && dist(o.x, o.y, at.x, at.y) < r && this.map.hasLOS(at.x, at.y, o.x, o.y);
    if (near(this.player)) return 'trop près de vous';
    if (this.ops.some(near)) return 'trop près des vôtres';
    return this.hostages.some(near) ? 'un otage trop près' : null;
  }

  // Celui de vos coéquipiers qui lancera là une grenade de cette sorte : il en a une, les mains libres, et une
  // trajectoire libre de 1,5 à ZONE_THROW ; le plus proche du point.
  zoneThrower(kind, at) {
    let best = null, bd = Infinity;
    for (const m of this.crew) {
      if (!m.alive || !(m.nades[kind] > 0) || m.act || m.stun > 0) continue;
      const d = dist(m.x, m.y, at.x, at.y);
      if (d < 1.5 * U || d > ZONE_THROW || d >= bd || !this.clearThrow(m.x, m.y, at.x, at.y)) continue;
      bd = d; best = m;
    }
    return best;
  }

  mateThrowAt(m, kind, at) {
    if (!m || !m.alive || m.act || !(m.nades[kind] > 0)) return;
    m.nades[kind]--;
    m.angle = Math.atan2(at.y - m.y, at.x - m.x);
    m.path = [];
    this.startAction(m, 'grenade', 0.5, () => this.spawnFlash(m, at.x, at.y, MATE_COOK, null, kind));
    this.voice(m, kind);
    this.say(`${m.name} : ${kind === 'frag' ? 'grenade' : 'flash'} !`, 1.2);
    this.emit('weapon');
  }

  // Les armes au sol à portée (dropsNear) : une ligne chacune, la plus proche aussi sur V. Bouclier au bras, seule une
  // arme de poing se prend ; une arme trop loin pour les mains reste grisée.
  dropMenu(mn, add, sep) {
    const p = this.player, bodies = this.dropsNear(p, MENU_KEEP);
    if (!bodies.length) return;
    if (mn.kind !== 'drop') sep('Armes au sol');
    const busy = p.act || p.fiber || p.cooking ? 'mains occupées' : null;
    bodies.forEach((b, k) => {
      const got = this.pickupSlot(b.slot).def, near = dist(b.x, b.y, p.x, p.y) <= PICKUP_RANGE;
      const off = p.shield && got.kind !== 'pistol' ? 'bouclier au bras' : !near ? 'trop loin' : busy;
      add('pick' + k, `Ramasser : ${got.name}`, k === 0 ? 'V' : '', off, () => this.pickUp(p, b));
    });
  }

  // La fibre optique sous la porte d, ou la retirer (intervention).
  fiberLine(d, add) {
    const p = this.player, gap = dist(p.x, p.y, d.cx, d.cy);
    const reach = gap > 1.6 * U ? 'trop loin' : p.act || p.fiber || p.cooking ? 'mains occupées' : null;
    if (p.fiber && p.fiber.door === d) add('fiber', 'Retirer la fibre', 'F', null, () => this.endFiber(p));
    else add('fiber', 'Fibre optique sous la porte', 'F', d.open ? 'porte ouverte' : reach, () => this.startFiber(p, d, true));
  }

  // Une porte : d'abord le geste le plus simple (l'ouvrir en grand, la refermer, la crocheter), puis les autres crans, la
  // fibre et la charge (intervention), et la colonne de votre équipe.
  doorMenu(mn, add) {
    const p = this.player, d = mn.door, eps = 0.01, gap = dist(p.x, p.y, d.cx, d.cy);
    const busy = p.act || p.fiber || p.cooking ? 'mains occupées' : null;
    const hands = gap > 1.8 * U ? 'trop loin' : d.opening ? 'en mouvement' : busy;
    const lock = d.locked && d.lockKnown;
    mn.title = 'Porte ' + (d.broken ? 'enfoncée' : lock ? 'verrouillée' : d.progress >= 1 - eps ? 'ouverte'
      : d.progress >= DOOR_PASS - eps ? 'entrouverte' : d.progress > eps ? 'entrebâillée' : 'fermée');
    if (lock) add('pick', 'Crocheter la serrure', '', hands, () => this.doorAction(p, d, 1));
    else if (d.broken) add('broken', 'La refermer', '', 'serrure arrachée', () => {});
    else {
      // le geste de E d'autrefois (ouvrir en grand, ou fermer), puis les autres crans
      const steps = [['open', 'Ouvrir', 1], ['ajar', 'Entrouvrir', DOOR_STEPS[2]], ['crack', 'Entrebâiller', DOOR_STEPS[1]], ['close', 'Fermer', 0]]
        .filter(q => Math.abs(d.progress - q[2]) >= eps);
      const first = d.open ? 'close' : 'open';
      steps.sort((a, b) => (b[0] === first) - (a[0] === first));
      for (const [id, label, at] of steps) add(id, id === 'open' && d.progress > eps ? 'Ouvrir en grand' : label, '', hands, () => this.doorAction(p, d, at));
    }
    if (this.camp !== 'armed') {
      const reach = gap > 1.6 * U ? 'trop loin' : busy;
      this.fiberLine(d, add);
      const placed = this.charges.find(c => c.team === p.team);
      if (placed && placed.door === d) add('blast', 'Faire sauter la charge', 'B', null, () => this.detonateCharge(placed));
      else add('charge', 'Poser une charge', 'B', placed ? 'une autre est posée' : p.charges <= 0 ? 'plus de charge'
        : d.progress > 0 || d.broken ? 'porte pas fermée' : reach, () => this.placeChargeOn(p, d));
    }
    if (this.canCommand(true) && this.crew.length) {
      const shut = !d.broken && !this.map.doorPassable(d), here = !!this.stack && this.stack.door === d;
      add('stack', `${this.orderName()} : en colonne`, 'clic droit', !shut ? 'porte ouverte' : here ? 'en route' : null, () => this.orderStack(d));
    }
  }

  // Une colonne en place qui attend vos ordres (la vôtre, ou celle d'un trinôme en stratégie : mn.st, mn.group) : entrer,
  // poser une charge, entrer à la flash, à la grenade ; la charge posée, ce qui suit sa mise à feu.
  stackMenu(mn, add) {
    const s = mn.st, ai = !!s.ai, team = ai ? s.team.filter(o => o.alive && o.entry === s) : this.mates.filter(m => m.alive && m.order === 'stack');
    const who = ai ? mn.group.label : this.orderName(), armed = this.camp === 'armed';
    const nades = kind => armed && kind === 'flash' ? 'aucune dans ce camp' : team.some(o => o.nades[kind] > 0) ? null : kind === 'frag' ? 'plus de grenade' : 'plus de flash';
    const choose = c => () => this.stackChoose(s, c);
    if (s.charge) {
      mn.title = `${who} · charge posée`;
      add('plain', 'Mise à feu et entrée', '', null, choose('plain'));
      add('flash', 'Mise à feu, flash, entrée', '', nades('flash'), choose('flash'));
      add('frag', 'Mise à feu, grenade, entrée', '', nades('frag'), choose('frag'));
      return;
    }
    mn.title = `${who} · en position`;
    add('plain', 'Entrer', '', null, choose('plain'));
    const stock = ai ? team.some(o => o.charges > 0) : this.player.charges > 0;
    add('charge', 'Poser une charge', '', armed ? 'aucune dans ce camp' : !stock ? 'plus de charge' : s.door.progress > 0 ? 'porte pas fermée'
      : !ai && this.charges.some(c => c.team === this.player.team) ? 'une autre est posée' : null, choose('charge'));
    add('flash', 'Entrer à la flash', '', nades('flash'), choose('flash'));
    add('frag', 'Entrer à la grenade', '', nades('frag'), choose('frag'));
    if (ai) add('break', 'Rompre la colonne', 'H', null, () => this.stratHold([mn.group]));
    else add('break', 'Rompre la colonne : suivez-moi', '', null, () => this.orderFollow());
  }

  // Un de vos coéquipiers, tout près : le rappeler, le faire tenir, le charger du VIP (escorte) ; lui seul, les autres
  // gardent leurs ordres.
  mateMenu(mn, add) {
    const m = mn.mate;
    mn.title = m.name;
    add('mfollow', `${m.name} : suivez-moi`, '', m.order === 'follow' ? 'il vous suit' : null, () => this.withOrderTo(m, () => this.orderFollow()));
    add('mhold', `${m.name} : tenez ici`, '', m.order === 'hold' ? 'il tient' : null, () => this.withOrderTo(m, () => this.toggleHold()));
    if (this.vip) {
      add('vip', `${m.name} : couvrez le VIP`, '', !this.vip.alive ? 'le VIP est tombé' : this.vipGuard() === m ? 'il le couvre' : null, () => {
        this.vipGuardPick = m;
        if (m.order !== 'follow') this.withOrderTo(m, () => this.orderFollow());
        this.say(`${m.name} couvre le VIP`, 1.6);
      });
    }
  }
});
