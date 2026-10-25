'use strict';
// Game : les gestes à deux mains (startAction), les portes (crans, poignée, serrures, chevrotine, embrasure) et les
// charges de brèche.

// Chevrotine dans la serrure : nombre de plombs qu'il faut mettre dans une porte pour la faire sauter.
const BREACH_PELLETS = 5;

// Portes fermées à clé (assaut) : part des portes verrouillées, durée du crochetage.
const LOCK_CHANCE = 0.3, LOCKPICK_TIME = 4;
// Charge de brèche : nombre par mission, durée de la pose, portée du souffle derrière la porte, et de votre côté.
const CHARGES = 2, CHARGE_PLACE = 1.4, CHARGE_RADIUS = 2.5 * U, CHARGE_NEAR = 1.4 * U;

mixGame(class {
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
    if (!opening && door.broken) { say('La serrure est arrachée : la porte ne ferme plus'); return false; }
    if (!opening) {
      // on vérifie avant le geste, pour ne pas manœuvrer la poignée pour rien
      const blocker = this.doorBlocker(door);
      if (blocker) { say(this.doorBlockedMsg(agent, blocker)); return false; }
    }
    // Porte fermée à clé : les suspects ont la clé (un tour de plus) ; l'équipe crochète la serrure, lentement
    // et presque sans bruit. Le joueur s'arrête une fois la porte déverrouillée (à lui de choisir comment
    // l'ouvrir) ; un coéquipier en route l'ouvre dans la foulée.
    if (door.locked && opening && agent.team === 'ops') {
      door.lockKnown = true;
      say('Porte verrouillée : crochetage… (B : charge, ou fusil à pompe dans la serrure)');
      this.sfx('tick', door.cx, door.cy, 3 * U, 0.06);
      this.noise(door.cx, door.cy, 1.2 * U, agent, 'door');
      return this.startAction(agent, 'lockpick', LOCKPICK_TIME, () => {
        if (!door.locked || dist(agent.x, agent.y, door.cx, door.cy) > 2.2 * U) return;
        door.locked = false;
        this.sfx('tick', door.cx, door.cy, 3 * U, 0.1);
        if (agent === this.player) this.say('Serrure crochetée : la porte est déverrouillée', 1.6);
        else this.openDoor(agent, door, target);
      });
    }
    // Poignée à manœuvrer, puis course du battant : entrouvrir demande moins d'effort qu'ouvrir en grand.
    let dur = 0.25 + 0.3 * Math.abs(target - door.progress);
    if (agent.team === 'enemy') { dur *= 1.3; if (door.locked && opening) { dur += 0.4; door.locked = false; } }
    this.sfx('tick', door.cx, door.cy, 4 * U, 0.08); // poignée
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
    this.noise(door.cx, door.cy, (quiet ? 1.5 : 5) * U, agent, 'door');
    this.sfx('door', door.cx, door.cy, (quiet ? 3.5 : 12) * U);
  }

  // Une porte encaisse la chevrotine jusqu'à ce que la serrure lâche : elle s'ouvre alors d'un coup
  // et ne se referme plus (le pêne est arraché).
  breachDoor(door, shooter) {
    if (door.broken) return;
    if (this.time - (door.hitT || -9) > 3) door.hits = 0; // impacts trop espacés : le bois tient
    door.hitT = this.time;
    door.hits = (door.hits || 0) + 1;
    if (door.hits < BREACH_PELLETS) return;
    door.broken = true;
    door.locked = false;
    door.opening = true;
    door.target = 1;
    door.duration = 0.25;
    door.ajar = false;
    this.sfx('door', door.cx, door.cy, 20 * U);
    this.noise(door.cx, door.cy, 10 * U, shooter, 'breach');
    if (shooter === this.player) this.say('Serrure arrachée : la porte ne ferme plus', 2);
  }

  // ---- Charge de brèche (assaut) ----
  // B devant une porte fermée : on pose une charge sur le battant, de son côté. B à nouveau, où qu'on soit : mise
  // à feu. La porte vole en éclats, la serrure avec ; derrière, tout ce qui se tient près de l'embrasure est
  // sonné, et blessé tout contre. De votre côté, mieux vaut s'être écarté. Une seule charge posée à la fois.
  chargeKey(p) {
    if (this.camp === 'armed') { this.say('Pas de charge de brèche dans ce camp', 1.2); return; }
    if (!p.alive) return;
    const placed = this.charges.find(c => c.team === p.team);
    if (placed) { this.detonateCharge(placed); return; }
    this.placeChargeOn(p, this.nearestDoor(p, 1.6 * U));
  }

  // Poser la charge sur cette porte-là (B : la plus proche ; le menu d'actions : celle qu'il désigne).
  placeChargeOn(p, d) {
    if (this.camp === 'armed' || !p.alive || p.act || p.fiber || p.cooking) return;
    if (p.charges <= 0) { this.say('Plus de charge de brèche', 1.2); return; }
    if (!d || dist(p.x, p.y, d.cx, d.cy) > 1.6 * U) { this.say('Aucune porte à portée', 1); return; }
    if (d.progress > 0 || d.broken) { this.say('Une charge se pose sur une porte fermée', 1.2); return; }
    const side = Math.sign(d.horizontal ? p.y - d.cy : p.x - d.cx) || 1;
    this.sfx('tick', p.x, p.y, 3 * U, 0.08);
    this.startAction(p, 'charge', CHARGE_PLACE, () => {
      if (!p.alive || d.progress > 0 || d.broken || dist(p.x, p.y, d.cx, d.cy) > 2.2 * U) return;
      this.placeCharge(p, d, side);
      this.say('Charge posée — écartez-vous, B : mise à feu', 2.2);
      this.emit('weapon');
    });
  }

  // La charge collée au battant, du côté side : celui qui la pose en a une de moins (le joueur, ou un opérateur
  // de l'intervention, voir updateChargeEntry) ; stock : celui sur qui on la prend (vos coéquipiers posent les vôtres).
  placeCharge(a, d, side, stock = a) {
    stock.charges--;
    const off = TILE / 2 + 2;
    const c = { door: d, side, x: d.cx + (d.horizontal ? 0 : side * off), y: d.cy + (d.horizontal ? side * off : 0), t: 0, by: a, team: a.team };
    this.charges.push(c);
    this.noise(d.cx, d.cy, 1 * U, a, 'door');
    this.sfx('tick', d.cx, d.cy, 3 * U, 0.12);
    return c;
  }

  // Une charge tient tant que la porte reste fermée : si quelqu'un l'ouvre, elle tombe.
  updateCharges(dt) {
    for (const c of this.charges) c.t += dt;
    const fallen = this.charges.filter(c => c.door.progress > 0 && !c.door.broken);
    if (!fallen.length) return;
    this.charges = this.charges.filter(c => !fallen.includes(c));
    if (fallen.some(c => c.team === this.player.team)) this.say("La porte s'est ouverte : la charge est tombée", 2);
  }

  // Le souffle part de toute l'embrasure, du côté de a (la charge ouvre la porte en grand, et ses éclats ne
  // s'arrêtent pas au battant) : on atteint donc aussi qui se tient contre le mur, de part et d'autre du cadre,
  // ou derrière le battant rabattu.
  blastReaches(d, a) {
    const s = Math.sign(d.horizontal ? a.y - d.cy : a.x - d.cx) || 1, half = (d.len * TILE) / 2, off = TILE / 2 + 1;
    for (const k of [-1, 0, 1]) {
      const lat = k * (half - 4);
      const x = d.cx + (d.horizontal ? lat : s * off), y = d.cy + (d.horizontal ? s * off : lat);
      if (this.map.hasLOS(x, y, a.x, a.y, d)) return true;
    }
    return false;
  }

  detonateCharge(c) {
    this.charges = this.charges.filter(o => o !== c);
    const d = c.door, by = c.by || this.player;
    Object.assign(d, { broken: true, locked: false, opening: false, progress: 1, target: 1, open: true, ajar: false });
    this.effects.push({ type: 'frag', x: c.x, y: c.y, t: 0, life: 0.6, small: true });
    for (let i = 0; i < 4; i++) {
      const a = (d.horizontal ? -c.side * Math.PI / 2 : (c.side > 0 ? Math.PI : 0)) + rand(-0.7, 0.7);
      this.effects.push({ type: 'splinter', x: d.cx, y: d.cy, angle: a, t: 0, life: 0.35 });
    }
    this.addDecal({ type: 'scorch', x: c.x, y: c.y });
    this.sfx('frag', d.cx, d.cy, 40 * U);
    const across = a => (d.horizontal ? a.y - d.cy : a.x - d.cx);
    const p = this.player, wasStunned = p.stun > 0;
    for (const a of [...this.enemies, ...this.ops, ...this.hostages]) {
      if (!a.alive || a.evacuated) continue;
      const dd = dist(d.cx, d.cy, a.x, a.y);
      if (dd > CHARGE_RADIUS || !this.blastReaches(d, a)) continue;
      const ang = Math.atan2(a.y - d.cy, a.x - d.cx);
      if (Math.sign(across(a)) !== c.side) {
        // derrière la porte : le souffle sonne tout le monde, blesse qui se tenait contre le battant
        if (dd < 1.2 * U) this.damage(a, 55 * (1 - dd / (1.2 * U)) + 5, by, ang, 'charge');
        if (!a.alive || a.team === 'civ') continue;
        a.stun = Math.max(a.stun || 0, 1.5 + 2.5 * (1 - dd / CHARGE_RADIUS));
        a.target = null; a.path = []; a.blind = null;
        if (a === p) a.flashT = Math.max(a.flashT, 1);
      } else if (dd < CHARGE_NEAR) {
        // du côté de la charge, tout près : on encaisse aussi
        this.damage(a, 35 * (1 - dd / CHARGE_NEAR) + 5, by, ang, 'charge');
        if (a.alive && a.team !== 'civ') a.stun = Math.max(a.stun || 0, 0.8);
      }
    }
    this.camShake = Math.max(this.camShake, 9);
    this.noise(d.cx, d.cy, 16 * U, by, 'boom');
    if (c.team === p.team) this.say('Brèche !', 1.2);
    else if (p.alive && p.stun > 0 && !wasStunned) this.say('Charge de brèche : vous êtes sonné', 1.6);
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
    for (const h of this.hostages) if (h.alive && !h.evacuated && inFrame(h.x, h.y, h.radius)) return h;
    for (const g of this.grenades) if (inFrame(g.x, g.y, 4)) return 'grenade';
    return null;
  }

  doorBlockedMsg(agent, blocker) {
    return blocker === agent ? "Dégagez l'embrasure pour fermer"
      : blocker === 'grenade' ? 'Une grenade est dans l\'embrasure'
      : blocker.team === 'civ' ? "Un otage est dans l'embrasure"
      : "Quelqu'un est dans l'embrasure";
  }

  // Fermeture (target 0 = fermée, crans intermédiaires possibles). Impossible si l'embrasure est occupée.
  closeDoor(agent, door, target) {
    if (target >= door.progress || door.broken) return;
    const blocker = this.doorBlocker(door);
    if (blocker) { if (agent === this.player) this.say(this.doorBlockedMsg(agent, blocker), 1.2); return; }
    door.target = target;
    door.opening = true;
    door.duration = 0.3;
    // la porte bloque le passage dès le début de la fermeture ; la vue passe jusqu'à la fin
    door.open = false;
    door.ajar = true;
    const quiet = door.progress < 1;
    this.noise(door.cx, door.cy, (quiet ? 1.5 : 3.5) * U, agent, 'door');
    this.sfx('door', door.cx, door.cy, (quiet ? 3.5 : 9) * U);
  }

  // Porte dont l'embrasure contient le point (clic droit), à une demi-case près.
  doorAtPoint(x, y) {
    for (const d of this.map.doors) {
      const half = (d.len * TILE) / 2, along = Math.abs(d.horizontal ? x - d.cx : y - d.cy), across = Math.abs(d.horizontal ? y - d.cy : x - d.cx);
      if (along <= half + 4 && across <= TILE) return d;
    }
    return null;
  }
});
