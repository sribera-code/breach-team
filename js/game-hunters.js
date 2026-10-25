'use strict';
// Game : les agents autonomes (hunter) : l'intervention du siège et les trinômes des deux camps. Contacts,
// progression en file derrière un chef, colonnes sur les portes, ratissage des secteurs.

// Entrée coordonnée de l'intervention (siège) : devant une porte fermée sur son chemin, un opérateur qui a au moins un
// équipier libre à AI_STACK_RANGE de la porte, de son côté, forme de temps en temps une colonne, comme l'équipe du joueur
// au clic droit : une fois sur AI_STACK_CHANCE, AI_STACK_THREAT quand le dernier contact est derrière la porte, au plus
// une colonne toutes les AI_STACK_GAP s (une même porte n'est retentée qu'au double). L'entrée se fait porte ouverte, à
// la flash (au moins AI_FLASH_MIN opérateurs, et une flash dans l'équipe) ou à la charge (chaque vague en porte
// WAVE_CHARGES). Une colonne qui n'a rien entamé au bout de AI_STACK_TIMEOUT s se défait. Entré, chacun tient son angle
// AI_CLEAR s.
const AI_STACK_RANGE = 5 * U, AI_STACK_CHANCE = 0.5, AI_STACK_THREAT = 0.85, AI_STACK_GAP = 8, AI_FLASH_MIN = 3;
const AI_STACK_TIMEOUT = 15, WAVE_CHARGES = 1, AI_CLEAR = 1.5;

// Trinômes : un contact signalé par un équipier reste une destination SQUAD_CONTACT s.
const SQUAD_CONTACT = 20;
// Trinômes autonomes : un chef de file mène, les deux autres le suivent en file décalée comme vos coéquipiers vous
// suivent (SQUAD_FILE : leurs places en cases, vers l'avant et vers la droite de sa marche ; la troisième sert au
// quatrième homme d'un groupe d'assaut, en stratégie). Hors combat, le chef avance
// à SQUAD_PACE de sa vitesse, sans bruit de pas, marque SQUAD_DOOR_PAUSE s avant de franchir une porte et attend celui
// des siens resté à plus de SQUAD_SPREAD (SQUAD_WAIT s au plus : un équipier coincé ne fige pas le trinôme). Un équipier
// distancé de plus de SQUAD_CATCH de sa place court la reprendre. L'adversaire en vue, ceux qui ne le voient pas viennent
// à hauteur du chef (SQUAD_LINE, dans le repère de la direction de l'adversaire).
const SQUAD_FILE = [[-1.3, -0.6], [-2.4, 0.5], [-3.5, -0.4]], SQUAD_LINE = [[-0.4, -1.1], [-0.4, 1.1], [-0.4, 2.2]];
const SQUAD_PACE = 0.7, SQUAD_DOOR_PAUSE = 0.6, SQUAD_SPREAD = 4 * U, SQUAD_WAIT = 4, SQUAD_CATCH = 0.6 * U;
// Agents autonomes : un secteur à ratisser compte comme vu dès qu'un homme passe à SWEEP_SEEN, la vue dégagée ; le
// suivant est le plus proche à pied, de SWEEP_AHEAD plus volontiers devant que derrière. Un trinôme garde son contact
// CONTACT_HOLD s : un bruit ne le remplace que s'il est plus proche, et jamais une vue fraîche. Arrivé sur un contact sans
// rien y trouver, il fouille les alentours SQUAD_SEARCH s avant de reprendre le ratissage.
const SWEEP_SEEN = 3 * U, SWEEP_AHEAD = 1.5 * U, CONTACT_HOLD = 4, SQUAD_SEARCH = 2;
// Le groupe armé (trinômes, guerre totale) se met lui aussi en colonne sur une porte fermée, moins souvent que
// l'intervention (AI_STACK_ARMED : sans menace connue derrière la porte, puis avec), et entre à la grenade à fragmentation.
const AI_STACK_ARMED = [0.25, 0.6];
// Repli d'un trinôme : réduit à deux hommes ou moins, face à plus d'adversaires qu'il n'en reste debout (vus depuis moins
// de GROUP_RETREAT_SEEN s), il décroche hors de vue (une fois toutes les GROUP_RETREAT_GAP s au plus), en tirant au
// besoin, puis tient l'angle.
const GROUP_RETREAT_SEEN = 3, GROUP_RETREAT_GAP = 20;
// Embuscade : un trinôme qui entend l'adversaire (sans le voir) à AMBUSH_RANGE au plus l'attend, une fois sur AMBUSH_CHANCE
// (AMBUSH_CHANCE_ARMED pour le groupe armé), en ligne et face au passage par où il viendra, AMBUSH_TIME s au plus, au lieu
// d'aller au-devant.
const AMBUSH_RANGE = 10 * U, AMBUSH_CHANCE = 0.3, AMBUSH_CHANCE_ARMED = 0.5, AMBUSH_TIME = 8;
// Un trinôme annonce aux autres trinômes de son camp l'adversaire qu'il voit, et vous aussi (ce que votre trinôme voit, le
// second l'apprend) ; en guerre totale, seulement à ceux qui en sont à RADIO_RANGE au plus (un flanc enfoncé appelle ses
// voisins, pas toute l'armée).
const RADIO_RANGE = 14 * U;

mixGame(class {
  // Points de passage à nettoyer, du plus proche de l'entrée au plus lointain (from : d'un point précis, sinon de la
  // plus proche des ouvertures).
  buildSectors(entry, from) {
    const m = this.map, out = [];
    for (let ty = 2; ty < m.h - 2; ty += 5) for (let tx = 2; tx < m.w - 2; tx += 5) {
      if (m.blocksMove(tx, ty) || m.tile(tx, ty) !== 0) continue;
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (!m.circleFree(x, y, 12, false)) continue;
      out.push({ x, y, done: false });
    }
    const near = p => (from ? dist(p.x, p.y, from.x, from.y) : Math.min(...(this.map.breaches.length ? this.map.breaches : [{ cx: entry.x, cy: entry.y }])
      .map(b => dist(p.x, p.y, b.cx, b.cy))));
    out.sort((a, b) => near(a) - near(b));
    return out;
  }

  // n places derrière l'ouverture b, en file vers l'intérieur puis de côté si la place manque : jamais deux au même
  // point, ni sur quelqu'un de taken.
  breachFile(b, n, taken) {
    const placed = [], others = taken || [];
    const free = (cx, cy) => this.map.circleFree(cx, cy, 11, false) && ![...placed, ...others].some(q => dist(q.x, q.y, cx, cy) < 20);
    let room = null;
    for (let k = 0; k < n; k++) {
      let spot = null;
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
      search: for (let r = 0; r <= 8; r++) for (const side of [0, 1, -1, 2, -2]) {
        const cx = b.inside.x + ca * r * 16 - sa * side * 16, cy = b.inside.y + sa * r * 16 + ca * side * 16;
        if (free(cx, cy)) { spot = { x: cx, y: cy }; break search; }
      }
      if (!spot) {
        // la file déborde (deux trinômes par la même ouverture) : la case libre la plus proche dans la pièce d'arrivée
        room = room || this.map.roomOf(b.inside.x, b.inside.y);
        let bd = Infinity;
        for (const i of room) {
          const cx = (i % this.map.w + 0.5) * TILE, cy = (Math.floor(i / this.map.w) + 0.5) * TILE, d = dist(cx, cy, b.inside.x, b.inside.y);
          if (d < bd && free(cx, cy)) { bd = d; spot = { x: cx, y: cy }; }
        }
      }
      placed.push(spot || { x: b.inside.x, y: b.inside.y });
    }
    return placed;
  }

  // Un agent autonome apprend où est l'adversaire (seen : celui qu'il voit, lui ou son laser ; rien s'il l'entend) :
  // son trinôme le sait aussitôt, à moins de tenir mieux depuis moins de CONTACT_HOLD s. Ce qu'on voit passe avant ce
  // qu'on entend ; un second adversaire en vue ne remplace pas le premier tant qu'on voit encore celui-ci ; un bruit
  // ailleurs ne remplace un bruit que s'il est plus proche. Sans quoi chaque coup de feu de la bataille ferait changer
  // le trinôme de cap.
  know(e, x, y, seen) {
    e.lastKnown = { x, y };
    const g = e.group;
    if (!g) return;
    if (seen) (g.seen || (g.seen = new Map())).set(seen, this.time); // (qui il a vu, et quand : voir groupTactics)
    const c = g.contact, age = c ? this.time - c.t : Infinity;
    if (age < CONTACT_HOLD) {
      if (c.seen && !seen) return;
      if (seen ? c.foe && c.foe !== seen && age < 0.5
        : dist(c.x, c.y, x, y) > 2 * U && dist(e.x, e.y, x, y) > dist(e.x, e.y, c.x, c.y) - U) return;
    }
    g.contact = { x, y, t: this.time, seen: !!seen, foe: seen || null };
  }

  // Progression d'un agent autonome : l'équipe d'intervention du siège, ou un trinôme (d'un camp comme de l'autre).
  // Seul, il avance vers le dernier contact, sinon vers le prochain secteur à nettoyer ; en trinôme, le chef de file
  // (leaderOf) mène où va le trinôme (son contact, la fouille qui suit, le secteur choisi pour tous), au pas, en marquant
  // les portes, et attend les siens (waitsForGroup) ; les deux autres le suivent en file (followStep). Chacun s'arrête
  // pour tirer dès qu'il voit.
  updateAssault(e, dt) {
    if (!e.alive) return;
    e.pace = 1; e.watchDir = null; // au pas, et le regard d'un équipier en file : voir followStep
    e.noiseT -= dt;
    e.suspicion = Math.max(0, e.suspicion - SUSPICION_DECAY * dt);
    if (this.siege && this.siege.prep > 0) { e.moving = false; return; } // ils attendent devant la porte
    this.enemyCombat(e, dt);
    // le laser trahit celui qui le porte : allumé seulement au contact (une cible, ou le trinôme qui vient de voir l'adversaire)
    if (e.weapon && e.weapon.laser) { const c = e.group && e.group.contact; e.laserOn = !!e.target || !!(c && c.seen && this.time - c.t < 2); }
    if (e.stun > 0) return;
    if (!e.target) this.spotLaser(e, dt);
    this.markSwept(e, dt);
    e.repathT -= dt;
    const h = e.escorting;
    if (h && (!h.alive || h.evacuated || h.escort !== e)) { e.escorting = null; e.exit = null; }
    // en colonne sur une porte : il tient son poste (voir updateAiStack)
    if (e.entry) { this.stackStep(e, dt); return; }
    const falling = !!(e.group && e.group.retreat); // (le trinôme décroche : on recule en tirant, sans s'arrêter)
    if (e.target && !falling) {
      this.know(e, e.target.x, e.target.y, e.target);
      if (e.blockedLine) {
        // otage dans l'axe : on cherche un angle dégagé plutôt que de tirer à travers
        const spot = this.firingSpot(e, e.target);
        if (spot && (!e.path.length || e.repathT <= 0)) { e.path = this.pathTo(e, spot.x, spot.y); e.repathT = 0.5; }
        this.moveAlong(e, dt); // engagé, il se déplace sans lâcher la cible des yeux (enemyCombat)
        return;
      }
      // un bouclier qui arrête ses balles : le groupe armé lui lance une grenade à fragmentation (s'il en a une, et la
      // trajectoire libre, voir maybeFlash), qui le prend par en dessous
      if (e.engaged && e.nade === 'frag' && this.shieldStops(e.target, e) && this.maybeFlash(e, dt)) return;
      if (e.engaged) { e.path = []; e.moving = false; return; }
      // en escorte, on ne court pas après une cible hors de portée : la sortie d'abord ; un trinôme sous vos ordres
      // (stratégie) non plus, sauf s'il a l'ordre d'attaquer : il tient son poste ou poursuit sa route
      const ordered = e.group && e.group.order && e.group.order.type !== 'attack';
      if (!e.escorting && !ordered) {
        if (!e.path.length || e.repathT <= 0) { e.path = this.pathTo(e, e.target.x, e.target.y); e.repathT = 0.8; }
        this.moveAlong(e, dt);
        return;
      }
    }
    if (e.target) this.know(e, e.target.x, e.target.y, e.target);
    else e.engaged = false;
    if (e.escorting) { this.escortToExit(e, dt); return; }
    if (this.maybeFlash(e, dt)) return;
    if (this.takeHostage(e)) return;
    if (e.clear && this.clearStep(e, dt)) return;
    const g = e.group;
    let goal = e.lastKnown;
    if (goal && dist(e.x, e.y, goal.x, goal.y) < 1.2 * U) { e.lastKnown = null; goal = null; }
    let lead = null;
    if (g) {
      // un trinôme sous vos ordres (stratégie) fait ce que vous lui dites ; sans ordre, il ratisse son couloir
      if (g.order) { this.orderStep(g, e, dt); return; }
      // en trinôme, ce que l'un sait, tous le savent (voir know) : on va ensemble au contact, on fouille là où il
      // n'a rien donné, et seulement ensuite on reprend le ratissage ; seul le chef de file choisit le chemin
      lead = this.leaderOf(g);
      if (g.retreat && this.time > g.retreat.until) g.retreat = null; // (repli qui n'aboutit pas : on reprend)
      if (lead === e) this.groupTactics(g, e);
      if (!g.retreat && this.searchStep(g, e, dt)) return;
      if (lead !== e) { this.followStep(e, lead, dt); return; }
      goal = null;
      if (g.retreat) {
        // repli : vers la place choisie ; arrivé, on tient l'angle d'où venait la menace
        const r = g.retreat;
        if (dist(e.x, e.y, r.x, r.y) > 0.6 * U) goal = r;
        else Object.assign(g, { retreat: null, contact: null, ambush: { x: e.x, y: e.y, angle: Math.atan2(r.from.y - e.y, r.from.x - e.x), until: this.time + AMBUSH_TIME, line: null } });
      }
      if (!goal && g.ambush) {
        if (this.ambushStep(g, e, dt)) return;
        if (g.ambush) goal = g.ambush;
      }
      if (!goal) goal = this.contactGoal(g, e) || g.search;
    }
    if (!goal) goal = this.assaultGoal(e);
    if (!goal) { this.moveAlong(e, dt); return; }
    // un nouveau but : on y part aussitôt, sans finir le chemin de l'ancien (path.to : le but de ce chemin-ci ; un
    // chemin tracé ailleurs, vers une cible ou un poste, n'en a pas)
    const to = e.path.to;
    if (!e.path.length || e.repathT <= 0 || !to || dist(to.x, to.y, goal.x, goal.y) > 1.5 * U) {
      e.path = this.pathTo(e, goal.x, goal.y);
      e.path.to = { x: goal.x, y: goal.y };
      e.repathT = 1.2;
      // point injoignable (au ras d'un mur, derrière un meuble) : on l'oublie et on reprend le ratissage (un secteur
      // injoignable compte comme fait)
      if (!e.path.length && dist(e.x, e.y, goal.x, goal.y) > 1.2 * U) {
        if (goal === e.lastKnown) e.lastKnown = null;
        if (g && goal === g.contact) g.contact = null;
        if (g && goal === g.search) g.search = null;
        if (g && goal === g.retreat) g.retreat = null;
        if (g && goal === g.ambush) g.ambush = null;
        if (goal.done === false) goal.done = true;
      }
    }
    if (!falling && this.considerStack(e)) return;
    if (lead && !falling) {
      if (this.waitsForGroup(e, dt)) { e.moving = false; return; }
      // hors combat, le chef avance au pas et marque les portes ; les siens viennent de voir l'adversaire : il y court
      const c = g.contact;
      if (!(c && c.seen && this.time - c.t < 2)) { e.pace = SQUAD_PACE; this.doorPause(e, g); }
    }
    this.moveAlong(e, dt);
  }

  // Le chef de file d'un trinôme : le premier des siens encore debout (celui qui entrait en tête). S'il tombe, le
  // suivant prend la tête.
  leaderOf(g) { return g.members.find(o => o.alive && o.group === g) || null; }

  // Le chef d'un trinôme sans ordre juge la situation : en infériorité, il fait décrocher les siens (g.retreat) ; un
  // adversaire entendu, pas vu, qui approche, il l'attend en embuscade (g.ambush) plutôt que d'aller au-devant.
  groupTactics(g, e) {
    if (this.time < (g.tacticsT || 0) || g.retreat) return;
    g.tacticsT = this.time + 0.3;
    const up = g.members.filter(o => o.alive && o.group === g).length;
    const seen = g.seen ? [...g.seen].filter(([f, t]) => f.alive && this.time - t < GROUP_RETREAT_SEEN).map(([f]) => f) : [];
    if (up <= 2 && seen.length > up && this.time - (g.retreatAt === undefined ? -99 : g.retreatAt) > GROUP_RETREAT_GAP) {
      const c = g.contact || seen[0];
      const toward = this.war ? { x: this.war.bases[g.team].cx, y: this.war.bases[g.team].cy } : g.breach && g.breach.inside;
      const spot = this.fallbackSpot(e, c, toward);
      if (spot) {
        Object.assign(g, { retreat: { x: spot.x, y: spot.y, from: { x: c.x, y: c.y }, until: this.time + 15 }, retreatAt: this.time, ambush: null, search: null });
        this.voice(e, 'retreat');
        return;
      }
    }
    const k = g.contact;
    if (k && !k.seen && !k.decided && !g.ambush) {
      k.decided = true;
      const odds = g.camp === 'armed' ? AMBUSH_CHANCE_ARMED : AMBUSH_CHANCE;
      if (dist(e.x, e.y, k.x, k.y) < AMBUSH_RANGE && Math.random() < odds) this.setAmbush(g, e, k);
    }
  }

  // Embuscade : sur le chemin de ce qu'on a entendu (k), le premier passage (une porte, sinon le point à quatre cases) ; une
  // place près du chef, de deux cases et demie à huit de ce passage, la vue dégagée sur lui. Le trinôme s'y met en ligne,
  // face au passage (followStep). false s'il n'y a pas de place.
  setAmbush(g, e, k) {
    const path = this.pathTo(e, k.x, k.y);
    if (!path.length) return false;
    let watch = null, x = e.x, y = e.y, L = 0;
    for (const q of path) {
      const n = Math.max(1, Math.ceil(dist(x, y, q.x, q.y) / 8));
      for (let i = 1; i <= n && !watch; i++) {
        const px = x + (q.x - x) * i / n, py = y + (q.y - y) * i / n, d = this.map.door(Math.floor(px / TILE), Math.floor(py / TILE));
        if (d) watch = { x: d.cx, y: d.cy };
        else if (L + dist(x, y, px, py) >= 4 * U) watch = { x: px, y: py };
      }
      if (watch) break;
      L += dist(x, y, q.x, q.y); x = q.x; y = q.y;
    }
    watch = watch || { x: k.x, y: k.y };
    let best = null, bs = Infinity;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const tx = e.tx + dx, ty = e.ty + dy, px = (tx + 0.5) * TILE, py = (ty + 0.5) * TILE;
      if (!this.map.inBounds(tx, ty) || this.map.blocksMove(tx, ty) || this.map.door(tx, ty)) continue;
      const dw = dist(px, py, watch.x, watch.y);
      if (dw < 2.5 * U || dw > 8 * U || !this.map.circleFree(px, py, 12, true) || !this.map.hasLOS(px, py, watch.x, watch.y)) continue;
      const sc = dist(px, py, e.x, e.y) + Math.abs(dw - 4 * U) * 0.5;
      if (sc < bs) { bs = sc; best = { x: px, y: py }; }
    }
    if (!best) return false;
    g.ambush = { x: best.x, y: best.y, angle: Math.atan2(watch.y - best.y, watch.x - best.x), until: this.time + AMBUSH_TIME, line: null };
    return true;
  }

  // En embuscade, le chef tient sa place, face au passage, tant que rien ne se montre (AMBUSH_TIME s au plus). true : il y
  // est ; false : il y va (ou l'embuscade est finie).
  ambushStep(g, e, dt) {
    const A = g.ambush;
    if (this.time >= A.until || (g.contact && g.contact.seen && this.time - g.contact.t < 1)) { g.ambush = null; return false; }
    if (dist(e.x, e.y, A.x, A.y) > 0.5 * U) return false;
    e.path = []; e.moving = false; e.moveDir = A.angle;
    if (!e.target && e.alertAngle === null) turnToward(e, A.angle + Math.sin(this.time * 0.7) * 0.25, e.turnRate * 0.5, dt);
    return true;
  }

  // Deux fois par seconde, chaque trinôme sans ordre apprend des autres trinômes de son camp l'adversaire qu'ils voient en
  // ce moment (en guerre totale, s'il en est à RADIO_RANGE au plus) ; ceux de votre camp, aussi ce que vous et votre
  // trinôme voyez. Un contact transmis vaut un bruit entendu : il ne fait pas tourner la tête comme une vue.
  radioStep() {
    if (!this.squads || this.time < (this.radioT || 0)) return;
    this.radioT = this.time + 0.5;
    const crew = [this.player, ...this.crew].filter(o => o.alive);
    const crewSees = this.enemies.filter(f => f.alive && crew.some(o => this.canSee(o, f)));
    for (const g of this.squads.groups) {
      if (g.order) continue;
      const lead = this.leaderOf(g);
      if (!lead) continue;
      let best = null, bd = Infinity;
      const take = (x, y) => { const d = dist(lead.x, lead.y, x, y); if ((!this.war || d <= RADIO_RANGE) && d < bd) { bd = d; best = { x, y }; } };
      for (const o of this.squads.groups) {
        const c = o.contact;
        if (o !== g && o.team === g.team && c && c.seen && this.time - c.t < 1) take(c.x, c.y);
      }
      if (g.team === 'ops') for (const f of crewSees) take(f.x, f.y);
      if (best) this.know(lead, best.x, best.y);
    }
  }

  // Chemin restant d'un agent (px).
  pathLeft(a) {
    let L = 0, x = a.x, y = a.y;
    for (const q of a.path) { L += dist(x, y, q.x, q.y); x = q.x; y = q.y; }
    return L;
  }

  // Le chef de file attend celui des siens resté à plus de SQUAD_SPREAD (à vol d'oiseau ou à pied), SQUAD_WAIT s au plus
  // de suite : un équipier coincé ne fige pas le trinôme. Celui qui se bat ou tient son poste en colonne ne compte pas.
  waitsForGroup(e, dt) {
    const g = e.group;
    const lag = g.members.some(o => o !== e && o.alive && o.group === g && !o.target && !o.entry && !o.clear
      && (dist(o.x, o.y, e.x, e.y) > SQUAD_SPREAD || this.pathLeft(o) > SQUAD_SPREAD + U));
    if (!lag) { g.waitT = 0; return false; }
    g.waitT = (g.waitT || 0) + dt;
    return g.waitT < SQUAD_WAIT;
  }

  // Avant de franchir une porte (ouverte, ou qu'il vient d'ouvrir), le chef de file marque SQUAD_DOOR_PAUSE s sur le
  // seuil : il regarde dans la pièce, et sa file se resserre derrière lui. Une fois par porte (une même porte, de
  // nouveau au bout de 8 s).
  doorPause(e, g) {
    if (e.holdT > 0 || e.act) return;
    const r = this.doorAhead(e, 1.2 * U);
    if (!r || r.at < 8 || !this.map.doorPassable(r.d)) return;
    const was = g.doorPaused;
    if (was && was.d === r.d && this.time - was.t < 8) return;
    g.doorPaused = { d: r.d, t: this.time };
    e.holdT = SQUAD_DOOR_PAUSE;
  }

  // Un équipier d'un trinôme suit son chef de file en file décalée (SQUAD_FILE), sans ouvrir de porte (c'est le chef
  // qui les ouvre), au pas du chef près de sa place, au pas de course s'il en est à plus de SQUAD_CATCH. Le trinôme vient
  // de voir l'adversaire : il se porte d'un pas de côté là d'où il le verrait aussi (firingSpot), sinon à hauteur du chef
  // (SQUAD_LINE, face à l'adversaire). En marche, le second couvre le flanc gauche, le troisième le flanc droit, avec un
  // coup d'œil en arrière de temps en temps ; arrêtés, le second garde la gauche, le troisième les arrières. Le quatrième
  // d'un groupe d'assaut (stratégie) ferme la file et surveille les arrières.
  // Un groupe qui tient une position sur votre ordre (stratégie) se met en ligne, à hauteur du chef, face à la direction
  // donnée, chacun couvrant son côté.
  followStep(e, lead, dt) {
    const g = e.group, fol = g.members.filter(o => o !== lead && o.alive && o.group === g);
    let rank = Math.min(SQUAD_FILE.length - 1, fol.indexOf(e));
    this.trackStuck(e, dt);
    // (le trinôme décroche : chacun suit son chef sans chercher d'angle de tir)
    const c = g.contact, foe = !g.retreat && c && c.seen && c.foe && c.foe.alive && this.time - c.t < 1.5 ? c.foe : null;
    const hold = foe || lead.moving ? null : g.order ? (g.order.type === 'hold' ? g.order : null) : g.ambush || null;
    const head = foe ? Math.atan2(foe.y - lead.y, foe.x - lead.x) : hold ? hold.angle : lead.moveDir === undefined ? lead.angle : lead.moveDir;
    if (hold && fol.length >= 2) {
      // en ligne, chacun prend sa place du côté du chef où il se trouve déjà (choisie une fois par ordre, de gauche à
      // droite) : personne ne croise
      if (!hold.line || hold.line.length !== fol.length || !fol.every(o => hold.line.includes(o))) {
        const lat = o => (o.y - lead.y) * Math.cos(head) - (o.x - lead.x) * Math.sin(head);
        hold.line = fol.slice().sort((a, b) => lat(a) - lat(b));
      }
      rank = Math.min(SQUAD_LINE.length - 1, hold.line.indexOf(e));
    }
    let dest = null;
    if (foe && dist(e.x, e.y, lead.x, lead.y) < 4 * U) dest = this.firingSpot(e, foe);
    if (!dest) {
      // la place en file ne se recalcule que par à-coups : la chercher coûte (formationPos)
      if (!e.formAt || e.formT <= this.time) {
        e.formAt = this.formationPos(e, lead, (foe || hold ? SQUAD_LINE : SQUAD_FILE)[rank], head);
        e.formT = this.time + 0.15;
      }
      dest = e.formAt;
    }
    const d = dist(e.x, e.y, dest.x, dest.y);
    // il ne recule pas vers une place restée un peu derrière lui ; le chef arrêté, il ne bouge plus pour quelques pas
    // d'écart ; le chef en marche, il marche avec lui
    const behind = (dest.x - e.x) * Math.cos(head) + (dest.y - e.y) * Math.sin(head) < 0;
    const settle = dest === e.fireSpot ? 4 : behind ? 1.5 * U : lead.moving ? 4 : e.moving ? 12 : 0.7 * U;
    if (d > settle) {
      const tile = { x: Math.floor(dest.x / TILE), y: Math.floor(dest.y / TILE) };
      const changed = !e.destTile || e.destTile.x !== tile.x || e.destTile.y !== tile.y;
      if (changed || e.repathT <= 0 || !e.path.length) {
        const avoid = this.teamOf(e).filter(o => o !== e && o.alive && dist(o.x, o.y, e.x, e.y) < 4 * U).map(o => ({ x: o.x, y: o.y, r: e.stuckCount ? 30 : 22 }));
        let path = this.map.routeTo(e.x, e.y, tile.x, tile.y, e.radius, { noClosedDoors: true, avoid });
        if (path && path.length) path[path.length - 1] = { x: dest.x, y: dest.y };
        // pas de chemin sans ouvrir de porte (une porte s'est refermée entre eux) : il rejoint le chef, porte comprise
        else if (!path) path = this.map.routeTo(e.x, e.y, lead.tx, lead.ty, e.radius, { avoid });
        e.path = path || [];
        e.destTile = tile;
        e.repathT = 0.4;
      }
      // à sa place, au pas du chef ; un peu en retard, un peu plus vite (toujours sans bruit) ; distancé, il court
      if (d <= SQUAD_CATCH) e.pace = d < 0.3 * U ? SQUAD_PACE : SQUAD_PACE * 1.3;
      // il couvre son côté en marchant (le dernier jette un coup d'œil derrière, 1,2 s toutes les 5 s) ; l'adversaire
      // vu à l'instant, il le cherche des yeux
      if (foe) e.watchDir = Math.atan2(foe.y - e.y, foe.x - e.x);
      else if (e.alertAngle === null && d <= 3 * U) {
        e.coverPhase = e.coverPhase === undefined ? rand(0, 5) : e.coverPhase;
        e.watchDir = head + (rank === 0 ? -55 * DEG : rank === 2 || (this.time + e.coverPhase) % 5 < 1.2 ? Math.PI : 55 * DEG);
      }
      e.lastStep = { x: e.x, y: e.y };
      this.moveAlong(e, dt);
      return;
    }
    e.path = []; e.moving = false;
    if (e.alertAngle !== null) return;
    const want = foe ? Math.atan2(foe.y - e.y, foe.x - e.x)
      : hold ? head + (rank === 0 ? -35 * DEG : 35 * DEG) + Math.sin(this.time * 0.8 + rank * 2) * 0.3
      : head + (rank === 0 ? -80 * DEG : rank === 1 && fol.length > 2 ? 80 * DEG : Math.PI) + Math.sin(this.time * 0.9 + rank * 2) * 0.45;
    turnToward(e, want, e.turnRate * 0.5, dt);
  }

  // Entré à la suite d'une colonne : il rejoint son angle de la pièce et le tient AI_CLEAR s, arme vers le fond.
  // false quand c'est fini (ou que l'angle est injoignable) : il reprend sa progression.
  clearStep(e, dt) {
    const c = e.clear;
    c.left -= dt;
    if (c.left <= 0) { e.clear = null; return false; }
    if (dist(e.x, e.y, c.x, c.y) > 6) {
      if (!e.path.length || e.repathT <= 0) {
        e.path = this.pathTo(e, c.x, c.y);
        if (e.path.length) e.path[e.path.length - 1] = { x: c.x, y: c.y };
        e.repathT = 0.6;
      }
      if (!e.path.length) { e.clear = null; return false; }
      this.moveAlong(e, dt);
      return true;
    }
    e.path = []; e.moving = false;
    if (e.alertAngle === null) turnToward(e, c.look, e.turnRate, dt);
    if ((c.t -= dt) <= 0) e.clear = null;
    return true;
  }

  // Première porte sur le chemin d'un agent, à moins de range : { d, at }, at le chemin qui l'en sépare.
  doorAhead(a, range) {
    let x = a.x, y = a.y, walked = 0;
    for (const wp of a.path) {
      const L = dist(x, y, wp.x, wp.y), n = Math.max(1, Math.ceil(L / 6));
      for (let i = 1; i <= n; i++) {
        if (walked + L * i / n > range) return null;
        const d = this.map.door(Math.floor((x + (wp.x - x) * i / n) / TILE), Math.floor((y + (wp.y - y) * i / n) / TILE));
        if (d) return { d, at: walked + L * i / n };
      }
      walked += L; x = wp.x; y = wp.y;
      if (walked >= range) return null;
    }
    return null;
  }

  // Première porte sur le chemin d'un agent, à moins de range : null si elle laisse déjà passer (ou s'ouvre).
  doorOnPath(a, range) {
    const r = this.doorAhead(a, range);
    return r && !r.d.opening && !this.map.doorPassable(r.d) ? r.d : null;
  }

  // Une porte fermée à franchir : de temps en temps (stackOdds), l'opérateur et les équipiers libres qui sont avec lui
  // se mettent en colonne au lieu de l'ouvrir en passant. Une porte où une colonne se prépare, on attend à distance
  // qu'elle s'ouvre. true : il ne bouge pas cette fois-ci.
  considerStack(e) {
    const s = this.hunt;
    if (!s || e.act || e.waitDoor) return false;
    const d = this.doorOnPath(e, 2.5 * U);
    if (!d || this.map.breaches.some(b => b.door === d)) return false;
    if (s.stacks.some(st => st.door === d && st.team[0].team === e.team)) { e.moving = false; return true; }
    // l'intervention (le siège, ses trinômes) et les trinômes du groupe armé, moins souvent (stackOdds)
    if (!e.drilled && !e.group) return false;
    const tried = e.team + ':' + this.map.doors.indexOf(d);
    if (this.time - (s.stackT[e.team] || -99) < AI_STACK_GAP || (s.tried.has(tried) && this.time - s.tried.get(tried) < 2 * AI_STACK_GAP)) return false;
    const side = Math.sign(d.horizontal ? e.y - d.cy : e.x - d.cx) || 1;
    const across = o => Math.sign(d.horizontal ? o.y - d.cy : o.x - d.cx);
    // les équipiers libres de son trinôme (au siège, toute la vague)
    const team = this.teamOf(e).filter(o => o === e || (o.hunter && o.group === e.group && o.alive && !o.entry && !o.escorting
      && !o.target && !(o.stun > 0) && !o.act && across(o) === side && dist(o.x, o.y, d.cx, d.cy) < AI_STACK_RANGE && this.map.hasLOS(o.x, o.y, e.x, e.y)));
    if (team.length < 2) return false;
    s.tried.set(tried, this.time);
    // la menace est-elle derrière cette porte ?
    const behind = team.some(o => o.lastKnown && across(o.lastKnown) === -side && dist(o.lastKnown.x, o.lastKnown.y, d.cx, d.cy) < 8 * U);
    if (Math.random() >= this.stackOdds(behind, e)) return false;
    return this.formStack(d, side, team, this.pickEntry(team, d, behind));
  }

  // Chance de se mettre en colonne devant une porte fermée (e : le groupe armé s'y met moins souvent).
  stackOdds(behind, e) { return e && !e.drilled ? AI_STACK_ARMED[behind ? 1 : 0] : behind ? AI_STACK_THREAT : AI_STACK_CHANCE; }

  // Manière d'entrer : à la charge s'il en reste une dans l'équipe (et qu'aucun otage repéré n'attend derrière la
  // porte), à la flash s'ils sont au moins AI_FLASH_MIN et qu'il leur en reste (d'autant plus volontiers qu'ils en
  // ont), sinon porte ouverte. Une menace connue derrière la porte rend la charge et la flash plus probables. Le groupe
  // armé entre de même à la grenade à fragmentation (le compteur flashbangs est celui de la grenade en main), jamais
  // près d'un otage.
  pickEntry(team, d, behind) {
    const flashes = team.reduce((n, o) => n + Math.max(0, o.flashbangs || 0), 0), frag = team.some(o => o.nade === 'frag');
    const hostage = this.hostages.some(h => h.alive && !h.evacuated && (h.found || frag) && dist(h.x, h.y, d.cx, d.cy) < (frag ? FRAG_RADIUS + 6 * U : CHARGE_RADIUS + U));
    const w = {
      charge: d.progress <= 0 && !hostage && team.some(o => o.charges > 0) ? (behind ? 1.5 : 0.7) : 0,
      flash: team.length >= AI_FLASH_MIN && flashes > 0 && !(frag && hostage) ? (behind ? 1.5 : 0.8) * Math.min(1, flashes / team.length) : 0,
    };
    let r = Math.random() * (1 + w.charge + w.flash);
    for (const k of ['charge', 'flash']) if ((r -= w[k]) < 0) return k;
    return 'plain';
  }

  // Colonne de l'intervention sur la porte d : un poste par opérateur de part et d'autre du cadre, le plus proche de
  // chacun ; pour une entrée à la charge, tous hors de portée du souffle (CHARGE_NEAR), le poseur se tenant d'abord
  // devant la porte (chargePosts). false s'il n'y a pas la place. tactic : 'plain', 'flash' (la grenade que chacun a en
  // main), 'frag' (une grenade à fragmentation, sur votre ordre), 'charge', ou 'wait' : en place, elle attend vos ordres
  // (stackChoose, stratégie). cmd : une colonne que vous commandez (elle ne se défait pas d'elle-même, et parle).
  formStack(d, side, team, tactic, cmd) {
    const st = { ai: true, cmd: !!cmd, door: d, side, team: [], tactic, kind: null, t: 0, ready: false, wait: null, flash: null, flashTried: false,
      charge: null, then: cmd ? null : 'plain', tries: 0, committed: false };
    if (tactic === 'frag') st.tactic = 'flash', st.kind = 'frag';
    else if (tactic === 'flash') st.kind = team.some(o => o.nade === 'frag') ? 'frag' : 'flash';
    if (tactic === 'charge' && !this.chargePosts(st, team)) st.tactic = 'plain';
    if (st.tactic !== 'charge') {
      const posts = this.stackPosts(d, side, team.length, 0);
      if (posts.length < 2) return false;
      st.team = this.assignPosts(d, team, posts);
    }
    for (const o of st.team) o.entry = st;
    this.hunt.stacks.push(st);
    this.hunt.stackT[st.team[0].team] = this.time;
    return true;
  }

  // Chacun prend le poste le plus proche de lui, les plus proches d'abord, tourné vers le cadre de la porte d. Renvoie
  // ceux qui ont un poste.
  assignPosts(d, team, posts) {
    const members = [], free = team.slice(), left = posts.slice();
    while (free.length && left.length) {
      let bi = 0, bj = 0, bd = Infinity;
      free.forEach((o, i) => left.forEach((q, j) => { const dd = dist(o.x, o.y, q.x, q.y); if (dd < bd) { bd = dd; bi = i; bj = j; } }));
      const o = free.splice(bi, 1)[0], q = left.splice(bj, 1)[0], look = Math.atan2(d.cy - q.y, d.cx - q.x);
      Object.assign(o, { orderPos: { x: q.x, y: q.y }, stackSide: q.k, stackRank: q.rank, holdAngle: look, path: [], repathT: 0, clear: null });
      if (o.order === 'stack') Object.assign(o, { coverAngle: look, destTile: null }); // (vos coéquipiers)
      members.push(o);
    }
    return members;
  }

  // Une entrée à la charge pour la colonne s : chacun à un poste hors de portée du souffle, et le poseur (le plus proche
  // de la porte parmi ceux qui ont une charge, ou parmi tous quand elle vient de stock : le joueur, pour vos coéquipiers)
  // d'abord devant elle. false s'il n'y a pas la place, ni de poseur.
  chargePosts(s, team, stock) {
    const d = s.door, side = s.side, off = TILE / 2 + 14;
    const posts = this.stackPosts(d, side, team.length, CHARGE_NEAR + 8);
    const front = posts.length >= team.length && this.stackSpot(d, side, d.cx + (d.horizontal ? 0 : side * off), d.cy + (d.horizontal ? side * off : 0), 11, posts);
    const placer = team.filter(o => (stock || o).charges > 0 && !(o.stun > 0)).sort((a, b) => dist(a.x, a.y, d.cx, d.cy) - dist(b.x, b.y, d.cx, d.cy))[0];
    if (!front || !placer || posts.length < 2) return false;
    s.team = this.assignPosts(d, team, posts);
    s.charge = { by: placer, stock: stock || placer, phase: 'place', post: placer.orderPos, obj: null, wait: 0 };
    const look = Math.atan2(d.cy - front.y, d.cx - front.x);
    Object.assign(placer, { orderPos: { x: front.x, y: front.y }, holdAngle: look, path: [], repathT: 0 });
    if (placer.order === 'stack') placer.coverAngle = look;
    return true;
  }

  // Un opérateur en colonne : il gagne son poste sans ouvrir de porte et s'y tient face au cadre ; s'il voit quelqu'un,
  // il tire d'où il est. Ouvrir, lancer la flash ou poser la charge se décide pour toute la colonne (updateAiStack).
  stackStep(e, dt) {
    if (e.target) { e.lastKnown = { x: e.target.x, y: e.target.y }; e.path = []; e.moving = false; return; }
    e.engaged = false;
    if (e.act) { e.moving = false; return; }
    const p = e.orderPos;
    if (dist(e.x, e.y, p.x, p.y) > 4) {
      if (!e.path.length || e.repathT <= 0) {
        const path = this.map.routeTo(e.x, e.y, Math.floor(p.x / TILE), Math.floor(p.y / TILE), e.radius, { noClosedDoors: true });
        // poste injoignable sans ouvrir de porte : il le tient d'où il est
        if (!path) { e.orderPos = { x: e.x, y: e.y }; e.path = []; return; }
        e.path = path.length ? path : [{ x: p.x, y: p.y }];
        e.path[e.path.length - 1] = { x: p.x, y: p.y };
        e.repathT = 0.5;
      }
      this.moveAlong(e, dt);
    } else {
      e.path = []; e.moving = false;
      if (e.alertAngle === null) turnToward(e, e.holdAngle, e.turnRate, dt);
    }
  }

  // Une colonne de l'intervention, du rassemblement à l'entrée : porte ouverte en grand par le plus proche, flash glissée
  // par l'entrebâillement (les temps de l'équipe du joueur, voir updateFlashEntry), ou charge (updateChargeEntry). Une
  // porte ouverte entre-temps par l'autre camp : on entre aussitôt. Ce qui échoue retombe sur l'entrée porte ouverte.
  updateAiStack(s, dt) {
    const d = s.door, team = s.team.filter(o => o.alive && o.entry === s);
    if (!team.length) { this.dropStack(s); return; }
    s.t += dt;
    if (!s.ready && team.every(o => o.target || dist(o.x, o.y, o.orderPos.x, o.orderPos.y) < 10)) {
      s.ready = true;
      if (s.cmd && s.tactic === 'wait') this.say(`${team[0].group ? team[0].group.label : 'Colonne'} en position — à vous : comment entrer`, 2);
    }
    // (celle que vous commandez attend vos ordres aussi longtemps qu'il faut)
    if (!s.cmd && s.t > AI_STACK_TIMEOUT * (s.committed ? 2 : 1)) {
      if (d.broken || this.map.doorPassable(d)) this.endStack(s, team); else this.dropStack(s);
      return;
    }
    // ouverte par l'autre camp pendant qu'elle attend vos ordres : on entre
    if (s.tactic === 'wait') { if (d.broken || this.map.doorPassable(d)) this.endStack(s, team); return; }
    if (s.tactic === 'charge') { this.updateChargeEntry(s, team, dt); return; }
    if (s.tactic === 'flash') {
      if (s.flash) {
        if (s.flash.phase !== 'place') s.committed = true;
        this.updateFlashEntry(s, team);
        return;
      }
      if (s.flashTried) s.tactic = 'plain'; // le lancer a avorté
      else if (s.ready) {
        s.flashTried = true;
        const plan = this.planFlash(s, team, s.kind || 'flash');
        if (plan) s.flash = { m: plan.m, crack: plan.crack, depth: plan.depth, kind: plan.kind, phase: 'place', g: null, tries: 0, after: d.broken };
        else if (s.cmd) this.say(`Pas d'angle pour la ${s.kind === 'frag' ? 'grenade' : 'flash'} par cette porte — on entre`, 2);
      }
      return;
    }
    if (!d.broken && !this.map.doorPassable(d)) {
      s.wait = null;
      if (!s.ready) return;
      if (!this.stackOpen(s, team)) this.dropStack(s);
      return;
    }
    if (s.wait === null) s.wait = d.broken ? 0.15 : ENTRY_DELAY;
    if ((s.wait -= dt) <= 0) this.endStack(s, team);
  }

  // Entrée à la charge (une colonne de l'IA, ou la vôtre) : le poseur va devant la porte et pose la charge
  // (CHARGE_PLACE), puis regagne son poste hors de portée ; elle saute dès qu'on sait ce qui suit (s.then : 'plain', ou
  // la grenade à lancer par la brèche ; vous le choisissez pour celles que vous commandez) et qu'aucun des siens ne
  // reste à moins de CHARGE_NEAR de la porte (l'IA n'attend pas plus de six secondes ; vous, on vous attend). Porte
  // ouverte avant (la charge tombe), poseur abattu : on entre porte ouverte ; la charge sautée par B : on entre aussi.
  updateChargeEntry(s, team, dt) {
    const d = s.door, c = s.charge, p = c.by, mine = !s.ai || s.cmd;
    const inStack = o => o.alive && (s.ai ? o.entry === s : o.order === 'stack');
    const back = () => {
      if (!inStack(p)) return;
      const look = Math.atan2(d.cy - c.post.y, d.cx - c.post.x);
      Object.assign(p, { orderPos: c.post, holdAngle: look, path: [], repathT: 0 });
      if (p.order === 'stack') Object.assign(p, { coverAngle: look, destTile: null });
    };
    const plain = () => { s.tactic = 'plain'; s.charge = null; s.wait = null; back(); };
    if (c.phase === 'blown') { if ((s.wait -= dt) <= 0) this.endStack(s, team); return; }
    if (d.broken || d.progress > 0) {
      if (mine && c.obj && !d.broken) this.say('La porte s’est ouverte : la charge est tombée — on entre', 1.8);
      plain(); return;
    }
    if (c.phase === 'place') {
      if (!inStack(p)) { plain(); return; }
      if (!s.ready || p.act || p.target || d.opening || dist(p.x, p.y, p.orderPos.x, p.orderPos.y) > 8) return;
      s.committed = true;
      c.phase = 'placing';
      this.sfx('tick', p.x, p.y, 3 * U, 0.08);
      this.startAction(p, 'charge', CHARGE_PLACE, () => {
        if (!p.alive || d.progress > 0 || d.broken || dist(p.x, p.y, d.cx, d.cy) > 2.2 * U) return;
        c.obj = this.placeCharge(p, d, s.side, c.stock);
        if (mine && !s.then) this.say('Charge posée — à vous : mise à feu, puis entrée simple, à la flash ou à la grenade', 2.4);
        if (c.stock === this.player) this.emit('weapon');
      });
      return;
    }
    if (c.phase === 'placing') {
      if (p.alive && p.act) return;
      if (!c.obj) { plain(); return; }
      c.phase = 'clear';
      back();
      return;
    }
    // 'clear' : la charge posée, chacun s'écarte ; on attend de savoir ce qui suit, puis mise à feu
    if (!this.charges.includes(c.obj)) { plain(); return; }
    if (!s.then) return;
    c.wait += dt;
    const near = this.teamOf(p).filter(o => o.alive && dist(o.x, o.y, d.cx, d.cy) < CHARGE_NEAR + 4);
    if (c.wait < 0.3 || (near.length && (c.wait < 6 || near.includes(this.player)))) {
      if (near.includes(this.player) && c.wait > 0.3 && this.time - (c.warnAt || -9) > 3) { c.warnAt = this.time; this.say('Écartez-vous de la porte : la charge va sauter', 2); }
      return;
    }
    this.detonateCharge(c.obj);
    this.afterBlast(s, team);
  }

  // La charge vient de sauter : on entre après un instant (phase 'blown'), ou la grenade choisie part d'abord par la brèche.
  afterBlast(s, team) {
    const kind = s.then;
    if (kind === 'flash' || kind === 'frag') {
      const plan = this.planFlash(s, team, kind);
      if (plan) {
        s.charge = null;
        s.flash = { m: plan.m, crack: 1, depth: plan.depth, kind, phase: 'place', g: null, tries: 0, after: true };
        if (s.ai) Object.assign(s, { tactic: 'flash', kind, flashTried: true });
        return;
      }
      if (!s.ai || s.cmd) this.say(`Pas d'angle pour la ${kind === 'frag' ? 'grenade' : 'flash'} par la brèche — on entre`, 2);
    }
    s.charge.phase = 'blown';
    s.wait = 0.15;
  }

  // Une colonne se défait : chacun reprend sa progression (et ouvrira la porte en passant).
  dropStack(s) {
    for (const o of s.team) if (o.entry === s) { o.entry = null; o.path = []; o.repathT = 0; }
    this.hunt.stacks = this.hunt.stacks.filter(q => q !== s);
  }

  // Un opérateur libre arrivé auprès d'un otage repéré le prend en charge : un instant, arme basse.
  takeHostage(e) {
    if (e.act) return false;
    const h = this.hostages.find(o => o.alive && !o.evacuated && o.found && !o.escort && !o.exiting
      && dist(e.x, e.y, o.x, o.y) < 1.2 * U && this.map.hasLOS(e.x, e.y, o.x, o.y));
    if (!h) return false;
    e.path = []; e.moving = false;
    this.startAction(e, 'hostage', 1, () => {
      if (!h.alive || h.evacuated || h.escort || dist(e.x, e.y, h.x, h.y) > 2 * U) return;
      this.takeCharge(h, e);
      e.escorting = h;
      e.exit = this.nearestExit(e);
      this.say("L'intervention emmène un otage !", 2.5);
    });
    return true;
  }

  // Escorte de l'IA : vers la sortie la plus proche, en attendant l'otage s'il traîne et en retournant
  // le chercher s'il ne suit plus (une porte refermée entre eux : elle la rouvre en passant).
  escortToExit(e, dt) {
    const h = e.escorting;
    if (!e.exit) e.exit = this.nearestExit(e);
    const b = e.exit;
    if (!b) { e.moving = false; return; }
    if (b.door && !this.map.doorPassable(b.door) && !b.door.opening && dist(e.x, e.y, b.cx, b.cy) < 1.8 * U) {
      this.doorAction(e, b.door, 1); // la porte de sortie : il l'ouvre pour l'otage
      return;
    }
    const lag = dist(e.x, e.y, h.x, h.y);
    let goal = b.inside;
    if (lag > 3 * U || h.blockedT > 1) goal = h;
    else if (lag > 2 * U) {
      e.path = []; e.moving = false;
      turnToward(e, Math.atan2(h.y - e.y, h.x - e.x), e.turnRate, dt);
      return;
    }
    if (!e.path.length || e.repathT <= 0 || e.escortGoal !== goal) {
      e.path = this.pathTo(e, goal.x, goal.y);
      e.repathT = 0.6;
      e.escortGoal = goal;
    }
    this.moveAlong(e, dt);
  }

  // Flash avant d'entrer : un opérateur qui sait où était la menace, sans la voir, dégoupille
  // plutôt que de franchir la porte à l'aveugle. Le groupe armé (trinômes) en fait autant avec ses grenades à
  // fragmentation, de plus loin, et jamais là où se tiennent les siens.
  maybeFlash(e, dt) {
    e.flashCd -= dt;
    if (e.act) return true;          // geste en cours (l'armement du bras)
    // stratégie : sous vos ordres, un trinôme ne lance que sur votre ordre (G, menu d'actions, entrée à la flash), pas
    // sur ce qu'il entend en route ou une fois en place ; à l'assaut, ou laissé à ratisser seul, il garde l'initiative
    const g = e.group, o = g && g.order;
    if (o && o.type !== 'attack') return false;
    // (même alors, votre armée ne lance que sur un adversaire vu à l'instant, un homme par groupe à la fois : sans quoi
    // l'ordre de ratisser faisait lancer à chacun sa grenade sur le dernier bruit entendu)
    const mine = !!(this.strat && g && e.team === this.player.team), c = g && g.contact;
    if (mine && (!c || !c.seen || this.time - c.t > STRAT_NADE_FRESH || this.time < (g.nadeAt || 0))) return false;
    const frag = e.nade === 'frag', keep = frag ? FRAG_RADIUS + 0.5 * U : 2 * U;
    // (le groupe armé lance aussi là où son trinôme a signalé quelqu'un)
    const aim0 = mine ? c : e.lastKnown || (frag && c);
    if (e.flashbangs <= 0 || e.flashCd > 0 || !aim0) return false;
    const d = dist(e.x, e.y, aim0.x, aim0.y);
    if (d < (frag ? FRAG_RADIUS + U : 2.5 * U) || d > (frag ? 7 : 6) * U) return false;
    // Une grenade lancée contre une porte fermée ou un mur revient aux pieds du lanceur : on
    // attend d'avoir la voie libre (la porte ouverte), et on ne la lance pas sur ses équipiers.
    const allyNear = [...this.teamOf(e), ...(frag ? this.hostages : [])]
      .some(o => o !== e && o.alive && !o.evacuated && dist(o.x, o.y, aim0.x, aim0.y) < keep);
    if (allyNear || !this.clearThrow(e.x, e.y, aim0.x, aim0.y)) { e.flashCd = 0.5; return false; }
    e.flashbangs--;
    e.flashCd = 14;
    if (mine) g.nadeAt = this.time + STRAT_NADE_GAP;
    e.path = [];
    const aim = { x: aim0.x, y: aim0.y };
    this.startAction(e, 'grenade', 0.5, () => this.spawnFlash(e, aim.x, aim.y));
    return true;
  }

  // Trajectoire de lancer libre jusqu'au point visé : ni mur, ni porte non ouverte, ni meuble sur la
  // partie où la grenade roule (elle survole ceux qui se trouvent sous sa trajectoire en vol).
  clearThrow(x0, y0, x1, y1) {
    if (!this.map.hasLOS(x0, y0, x1, y1)) return false;
    const d = dist(x0, y0, x1, y1), n = Math.ceil(d / 6);
    // elle part de la main (14 px devant, voir spawnFlash) et fait en vol cette part du trajet
    const air = 14 + d * GRENADE_FLIGHT / (GRENADE_FLIGHT + 1 / GRENADE_FRICTION);
    for (let i = 2; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      if (this.grenadeBlocked(x, y, d * i / n < air)) return false;
      const dd = this.map.door(Math.floor(x / TILE), Math.floor(y / TILE));
      if (dd && !dd.open) return false;
    }
    return true;
  }

  // Les otages repérés que personne n'emmène encore (c'est leur mission), sinon le prochain secteur à ratisser.
  assaultGoal(e) {
    let best = null, bd = Infinity;
    for (const h of this.hostages) {
      if (!h.alive || h.evacuated || h.escort || h.exiting || !h.found) continue;
      const d = dist(e.x, e.y, h.x, h.y);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) return { x: best.x, y: best.y };
    return this.sweepGoal(e);
  }

  // Le contact du trinôme, tant qu'il vaut quelque chose : le premier arrivé dessus sans rien voir le lève, et le
  // trinôme fouille les alentours (searchStep).
  contactGoal(g, e) {
    const c = g.contact;
    if (!c) return null;
    if (this.time - c.t > SQUAD_CONTACT) { g.contact = null; return null; }
    if (dist(e.x, e.y, c.x, c.y) >= 1.2 * U) return c;
    g.contact = null;
    for (const o of g.members) if (o.lastKnown && dist(o.lastKnown.x, o.lastKnown.y, c.x, c.y) < 2 * U) o.lastKnown = null;
    g.search = { x: c.x, y: c.y, dir: e.angle, until: this.time + SQUAD_SEARCH };
    return null;
  }

  // Fouille : le trinôme s'arrête SQUAD_SEARCH s là où le contact n'a rien donné, chacun regardant de son côté (celui
  // qui traîne à plus de 2,5 cases rejoint d'abord). Un nouveau contact l'interrompt. true : il fouille sur place.
  searchStep(g, e, dt) {
    const s = g.search;
    if (!s) return false;
    if (this.time >= s.until || g.contact) { g.search = null; return false; }
    if (dist(e.x, e.y, s.x, s.y) > 2.5 * U) return false;
    e.path = []; e.moving = false;
    const k = g.members.indexOf(e);
    if (e.alertAngle === null) turnToward(e, s.dir + (k - 1) * 2.1 + Math.sin(this.time * 1.5 + k) * 0.6, e.turnRate * 0.4, dt);
    return true;
  }

  // Les secteurs à ratisser d'un agent autonome : ceux de son trinôme, ou ceux que se partage l'intervention du siège.
  sectorsOf(e) { return (e.group && e.group.sectors) || (this.siege && this.siege.sectors) || []; }

  // Quatre fois par seconde, les secteurs que l'agent a sous les yeux (à moins de SWEEP_SEEN, la vue dégagée) ou qu'il
  // touche presque sont ratissés : on ne va pas toucher chaque recoin d'une pièce qu'on voit déjà.
  markSwept(e, dt) {
    if ((e.sectorT = (e.sectorT || 0) - dt) > 0) return;
    e.sectorT = 0.25;
    for (const s of this.sectorsOf(e)) {
      if (s.done) continue;
      const d = dist(e.x, e.y, s.x, s.y);
      if (d < 1.4 * U || (d < SWEEP_SEEN && this.map.hasLOS(e.x, e.y, s.x, s.y))) s.done = true;
    }
  }

  // Le secteur à ratisser, choisi pour tout le trinôme (pour l'agent seul, au siège) et gardé jusqu'à ce qu'il soit vu :
  // tous les hommes vont au même endroit, et l'on ne change pas d'avis en route.
  sweepGoal(e) {
    const own = e.group || e, secs = this.sectorsOf(e);
    if (own.sweepTo && !own.sweepTo.done && secs.includes(own.sweepTo)) return own.sweepTo;
    if (!secs.length || this.time < (own.pickAt || 0)) return null;
    own.sweepTo = this.pickSector(own, e, secs);
    if (!own.sweepTo) own.pickAt = this.time + 1; // rien de joignable : on ne recalcule pas à chaque image
    return own.sweepTo;
  }

  // Le secteur suivant, vu de l'homme le plus au centre du trinôme : le plus proche à pied (walkField), de SWEEP_AHEAD
  // plus volontiers dans le sens de la marche ; quand d'autres de son camp ratissent la même liste (l'autre trinôme
  // d'en face, ou vous avec le vôtre), parmi ceux qui sont plus près de lui que d'eux. Un couloir de la guerre totale se
  // parcourt dans l'ordre : on le rejoint au plus près et l'on continue vers l'avant, puis, au bout, dans l'autre sens.
  // Tout ratissé, on recommence.
  pickSector(own, e, secs) {
    const m = this.map, at = this.anchorOf(own, e);
    if (!secs.some(s => !s.done)) {
      for (const s of secs) s.done = false;
      if (own.pingpong) secs.reverse();
    }
    const f = m.walkField(at.x, at.y), cell = s => Math.floor(s.y / TILE) * m.w + Math.floor(s.x / TILE);
    if (own.pingpong) {
      let k = 0;
      secs.forEach((s, i) => { if (dist(s.x, s.y, at.x, at.y) < dist(secs[k].x, secs[k].y, at.x, at.y)) k = i; });
      secs.forEach((s, i) => { if (i < k || f[cell(s)] === Infinity) s.done = true; });
      return secs.find(s => !s.done) || null;
    }
    const others = (this.squads ? this.squads.groups : []).filter(o => o !== own && o.sectors === secs).map(o => this.anchorOf(o)).filter(Boolean);
    if (this.squads && !this.war && own.team === 'ops' && this.player.alive) others.push(this.player);
    const fo = others.map(o => m.walkField(o.x, o.y));
    let best = null, bs = Infinity, any = null, as = Infinity;
    for (const s of secs) {
      if (s.done) continue;
      const i = cell(s), d = f[i];
      if (d === Infinity) { s.done = true; continue; } // injoignable
      const sc = own.sectorDir === undefined ? d : d - SWEEP_AHEAD * Math.cos(angleDiff(Math.atan2(s.y - at.y, s.x - at.x), own.sectorDir));
      if (sc < as) { as = sc; any = s; }
      if (fo.some(o => o[i] + U < d)) continue; // plus près d'un autre des siens : à lui
      if (sc < bs) { bs = sc; best = s; }
    }
    const pick = best || any;
    if (pick) own.sectorDir = Math.atan2(pick.y - at.y, pick.x - at.x);
    return pick;
  }

  // Où se tient un trinôme : celui de ses hommes debout le plus près de leur centre (l'agent lui-même, hors trinôme).
  anchorOf(own, e) {
    const ms = own.members ? own.members.filter(o => o.alive && o.group === own) : [e];
    if (!ms.length) return null;
    const cx = ms.reduce((s, o) => s + o.x, 0) / ms.length, cy = ms.reduce((s, o) => s + o.y, 0) / ms.length;
    return ms.reduce((b, o) => (dist(o.x, o.y, cx, cy) < dist(b.x, b.y, cx, cy) ? o : b));
  }
});
