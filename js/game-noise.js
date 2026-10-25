'use strict';
// Game : le bruit. Propagation à travers le bâtiment (soundField), ce qu'en retiennent les suspects et les agents
// autonomes (hearNoise, investigate), les repères du joueur, les pas.

// Bruit (voir Game.noise) : surcoût de propagation, en px de « distance acoustique », pour traverser un
// mur, une porte qu'on ne peut pas franchir ou une vitre. Le son contourne sinon les angles par les embrasures.
const SOUND_WALL = 3 * U, SOUND_DOOR = 1.5 * U, SOUND_GLASS = 0.75 * U;
// Natures de bruit : poids dans l'attention d'un suspect, bruits « importants » (on va voir dès qu'on les
// entend assez fort), durée et couleur de leur repère à l'écran.
const NOISE_KINDS = {
  shot:   { w: 1,    important: true, life: 1.5, col: '255,96,64' },   // coup de feu
  boom:   { w: 1.3,  important: true, life: 2,   col: '255,255,255' }, // explosion, flash
  breach: { w: 1.1,  important: true, life: 1.6, col: '255,255,255' }, // serrure arrachée
  voice:  { w: 1,    important: true, life: 1.6, col: '255,167,38' },  // cri d'alerte
  body:   { w: 0.8,  life: 1.3, col: '240,140,140' },                  // corps qui tombe
  impact: { w: 0.6,  life: 0.9, col: '255,204,128' },                  // balle dans un mur ou une porte
  door:   { w: 0.55, life: 1.3, col: '255,213,79' },                   // porte manœuvrée
  bounce: { w: 0.45, life: 0.9, col: '200,210,215' },                  // grenade qui rebondit
  step:   { w: 0.4,  life: 0.8, col: '200,210,215' },                  // pas de course
};
// Ce qu'un suspect retient d'un bruit de son propre camp : un coup de feu, un cri, un corps qui tombe.
const ALLY_ALARM = new Set(['shot', 'voice', 'body']);
// Seuils d'attention (intensité perçue × poids) : se tourner vers le bruit ; aller voir un bruit important ;
// aller voir à force de bruits répétés (inquiétude cumulée, qui s'estompe de SUSPICION_DECAY par seconde).
const HEAR_TURN = 0.08, HEAR_GO = 0.3, SUSPICION_GO = 1, SUSPICION_DECAY = 0.15;
// Au plus RESPONDERS suspects vont voir un même bruit : les autres se tournent et restent sur leurs gardes,
// sauf s'ils sont très inquiets (SUSPICION_ALL).
const RESPONDERS = 2, SUSPICION_ALL = 1.6;
// Voisins d'une case pour la propagation du son : [dx, dy, longueur].
const SOUND_NB = [[1, 0, TILE], [-1, 0, TILE], [0, 1, TILE], [0, -1, TILE],
  [1, 1, TILE * Math.SQRT2], [-1, 1, TILE * Math.SQRT2], [1, -1, TILE * Math.SQRT2], [-1, -1, TILE * Math.SQRT2]];
// Pas de course : distance entre deux bruits de pas, et portée selon qui court.
const STEP_EVERY = 30, STEP_NOISE = { run: 2.5 * U, mate: 2.2 * U, operator: 2.4 * U, suspect: 2 * U };
// Ce que vous entendez (Game.hearAt) : la distance acoustique depuis l'auditeur est calculée jusqu'à EAR_RANGE, de
// nouveau quand il s'est déplacé de EAR_MOVE ou au bout de EAR_REFRESH s (une porte a pu s'ouvrir). Un coup de feu
// s'entend EAR_SPAN fois plus loin qu'il n'alerte un suspect (w.noise) : on entend la bataille avant d'y être.
const EAR_RANGE = 38 * U, EAR_MOVE = 2 * U, EAR_REFRESH = 0.6, EAR_SPAN = 2.1;
// Répliques (Game.voice) : chacun ne répète pas la même avant VOICE_GAP s ; une voix porte à VOICE_RANGE.
const VOICE_GAP = 6, VOICE_RANGE = 16 * U;
// Ce que dit chaque camp, selon la circonstance (une réplique tirée au sort).
const VOICE_LINES = {
  shout: { police: ['Police ! Personne ne bouge !', 'Police ! À terre !', 'Police ! Lâchez votre arme !'] },
  spot: { police: ['Contact !', 'Contact devant !', 'Suspect en vue !'], armed: ['Ils sont là !', 'Les flics !', 'Là-bas !', 'Contact !'] },
  alarm: { armed: ['Alerte ! Ils sont entrés !', 'Tout le monde en position !'], police: ['Contact, ils sont prévenus !'] },
  body: { armed: ['Ils ont eu un des nôtres !', 'Un homme à terre !'], police: ['Un des nôtres est à terre !'] },
  down: { police: ['Homme à terre !', 'On a un blessé !'], armed: ['Ils ont eu un des nôtres !'] },
  surrender: { armed: ['Je me rends ! Ne tirez pas !', 'D’accord, d’accord ! Je me rends !'] },
  threat: { armed: ['Reculez ou je la tue !', 'N’approchez pas ! Je vais tirer !', 'Un pas de plus et elle est morte !'] },
  flash: { police: ['Flash !', 'Flash, flash !'] },
  frag: { police: ['Grenade !'], armed: ['Grenade !'] },
  reload: { police: ['Je recharge !', 'Rechargement !'], armed: ['Je recharge !'] },
  cuff: { police: ['Suspect menotté.', 'Il est menotté.'] },
  entry: { police: ['Entrée !', 'On y va, on y va !'] },
  retreat: { armed: ['Repli !', 'On décroche !'], police: ['On se replie !'] },
  barricade: { armed: ['Fermez les portes !', 'On se barricade !'] },
};

mixGame(class {
  // ---- Ce que vous entendez ----
  // L'auditeur : le joueur (même tombé, le temps du relais) ; en stratégie, le centre de la vue (ear, posé par js/main.js).
  earPos() { return this.ear || this.player; }

  // Distance acoustique depuis l'auditeur jusqu'à chaque case (soundField, jusqu'à EAR_RANGE), dans un tableau à elle.
  earField(L) {
    const E = this._ear, N = this.map.w * this.map.h;
    if (E && E.map === this.map && Math.abs(this.time - E.t) < EAR_REFRESH && dist(E.x, E.y, L.x, L.y) < EAR_MOVE) return E;
    const st = E && E.map === this.map ? E.st : { d: new Float32Array(N).fill(Infinity), done: new Uint8Array(N), touched: [] };
    this.soundField(L.x, L.y, EAR_RANGE, st);
    return (this._ear = { st, x: L.x, y: L.y, t: this.time, map: this.map });
  }

  // Ce que l'auditeur entend d'un son parti de (x, y), qui s'éteint à R : null s'il est trop loin ; sinon { gain, pan,
  // muffle } (voir Sound) : le volume, de 1 sur place à 0 à R, la distance comptée comme celle du bruit (par les
  // embrasures, à travers les murs qui coûtent cher) ; le côté de l'écran ; et l'étouffement, d'autant plus fort que le
  // son a dû contourner ou traverser des murs, et qu'il vient de loin.
  hearAt(x, y, R) {
    const L = this.earPos();
    if (!L || !this.map) return null;
    const straight = dist(x, y, L.x, L.y);
    if (straight >= R) return null;
    const E = this.earField(L), m = this.map, tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    let d = m.inBounds(tx, ty) ? E.st.d[ty * m.w + tx] : Infinity;
    d = Math.max(straight, d - dist(L.x, L.y, E.x, E.y)); // (l'auditeur a un peu bougé depuis le calcul)
    if (!(d < R)) return null;
    const k = 1 - d / R;
    if (k * k < 0.004) return null;
    return { gain: k * k, pan: clamp((x - L.x) / (10 * U), -1, 1) * 0.8, muffle: clamp((straight + U) / (d + U), 0, 1) * (1 - 0.45 * d / R) };
  }

  // Joue Sound[name](...args, o) pour un son parti de (x, y), audible jusqu'à R : rien sans audio (avant le premier clic,
  // et dans les tests), ni de trop loin.
  sfx(name, x, y, R, ...args) {
    if (!Sound.ctx || !this.map) return;
    const o = this.hearAt(x, y, R);
    if (o) Sound[name](...args, o);
  }

  // Le camp de celui qui parle : le vôtre pour votre camp ('ops'), l'autre en face.
  campOf(a) { return a.team === 'ops' ? this.camp : this.camp === 'police' ? 'armed' : 'police'; }

  // a dit une réplique de la sorte kind (VOICE_LINES), à voix haute là où il est : la synthèse vocale du navigateur, avec
  // une voix d'homme naturelle s'il y en a une (sinon rien), plus faible de loin (Sound.speak). Une seule voix à la fois :
  // la vôtre passe devant celles de l'équipe, qui passent devant les autres. Pas plus d'une fois toutes les VOICE_GAP s
  // par personne et par sorte (vous, autant que vous voulez). Rien que du son : ce que l'IA entend passe par noise.
  voice(a, kind, prio) {
    if (!Sound.ctx || !Sound.voices || !a || !this.map) return;
    const lines = (VOICE_LINES[kind] || {})[this.campOf(a)];
    if (!lines) return;
    a.voiceAt = a.voiceAt || {};
    if (a !== this.player && this.time - (a.voiceAt[kind] === undefined ? -99 : a.voiceAt[kind]) < VOICE_GAP) return;
    a.voiceAt[kind] = this.time;
    const o = this.hearAt(a.x, a.y, VOICE_RANGE);
    if (!o) return;
    if (a.voiceIdx === undefined) a.voiceIdx = Math.floor(Math.random() * 8); // (sa voix, s'il y en a plusieurs)
    Sound.speak(lines[Math.floor(Math.random() * lines.length)], o, prio || (a === this.player ? 3 : a.team === 'ops' ? 2 : 1), a.voiceIdx);
  }

  // ---- Bruit ----
  // Un bruit part de (x, y) avec une portée R en plein air (px) et une nature (NOISE_KINDS). Il se
  // propage case par case (soundField) : chacun l'entend avec une intensité de 1 (sur place) à 0 (hors
  // de portée), plus faible derrière un mur ou une porte fermée.
  noise(x, y, R, source, kind) {
    kind = kind || 'shot';
    if (!(R > 0) || !this.map) return;
    const K = NOISE_KINDS[kind] || NOISE_KINDS.shot;
    const f = this.soundField(x, y, R), w = this.map.w;
    const level = a => {
      const tx = Math.floor(a.x / TILE), ty = Math.floor(a.y / TILE);
      if (!this.map.inBounds(tx, ty)) return 0;
      const d = f[ty * w + tx];
      return d < R ? 1 - d / R : 0;
    };
    // coéquipiers (ou complices) : ils tournent la tête vers un bruit de l'autre camp, sans quitter leur poste ;
    // le trinôme autonome de votre camp, lui, converge sur ce qu'il entend, comme celui d'en face
    for (const m of this.mates || []) {
      if (!m.alive || m === source || m.target || m.stun > 0) continue;
      const ally = !!source && source.team === m.team;
      if (m.hunter) {
        const I = level(m);
        if (I > 0 && !(ally && !ALLY_ALARM.has(kind))) this.hearNoise(m, x, y, I, K, ally, source);
        continue;
      }
      if (ally) continue;
      if (m.coverAngle === null && level(m) * K.w >= HEAR_TURN) m.alertAngle = Math.atan2(y - m.y, x - m.x);
    }
    // suspects (ou opérateurs) : ils se tournent, s'inquiètent, et les plus proches vont voir
    const goers = [];
    for (const e of this.enemies) {
      if (!e.alive || e.surrender || e === source || e.stun > 0 || e.target) continue;
      const I = level(e);
      if (I <= 0) continue;
      const ally = !!source && source.team === e.team;
      if (ally && !ALLY_ALARM.has(kind)) continue;
      if (this.hearNoise(e, x, y, I, K, ally, source)) goers.push({ e, I });
    }
    if (goers.length) {
      // au plus RESPONDERS à la fois sur un même bruit : les plus proches à l'oreille d'abord
      const busy = this.enemies.filter(o => o.alive && o.state === 'investigate' && o.lastKnown && dist(o.lastKnown.x, o.lastKnown.y, x, y) < 3 * U).length;
      let slots = Math.max(0, RESPONDERS - busy);
      goers.sort((a, b) => b.I - a.I);
      for (const { e, I } of goers) {
        if (slots > 0) { slots--; this.investigate(e, x, y, I); }
        else if (e.suspicion >= SUSPICION_ALL) this.investigate(e, x, y, I);
      }
    }
    // le joueur : direction et force de ce qu'il entend sans le voir (ses propres pas et ceux de l'équipe exceptés)
    const p = this.player;
    if (p && p.alive && source !== p && !(kind === 'step' && source && source.team === p.team)) {
      const I = level(p);
      if (I >= 0.05 && !this.seesPoint(x, y)) this.addHeard(Math.atan2(y - p.y, x - p.x), I, kind);
    }
    // son propre bruit : jusqu'où il porte (halo affiché un instant)
    if (source === p && R >= 1.5 * U && kind !== 'step' && kind !== 'bounce') this.markOwnNoise(f, R);
  }

  // Distance acoustique depuis (x, y) jusqu'à R : Dijkstra sur la grille fine. Une case de sol coûte sa
  // longueur ; un mur, une porte infranchissable ou une vitre ajoutent SOUND_WALL / SOUND_DOOR / SOUND_GLASS ;
  // le vide extérieur ne transmet rien. Le tableau renvoyé est partagé : à lire tout de suite. st : un état à soi
  // ({ d, done, touched }, voir earField), réutilisé d'un appel à l'autre.
  soundField(x, y, R, st) {
    const m = this.map, w = m.w, N = w * m.h;
    if (!st) {
      if (!this._sf || this._sf.d.length !== N) this._sf = { d: new Float32Array(N).fill(Infinity), done: new Uint8Array(N), touched: [] };
      st = this._sf;
    }
    const d = st.d, done = st.done;
    for (const i of st.touched) { d[i] = Infinity; done[i] = 0; }
    const touched = st.touched = [];
    const sx = Math.floor(x / TILE), sy = Math.floor(y / TILE);
    if (!m.inBounds(sx, sy)) return d;
    const extra = i => {
      const t = m.tiles[i];
      if (t === 2) return Infinity;
      if (t === 1) return SOUND_WALL;
      const door = m.doorAt.get(i);
      if (door) return m.doorPassable(door) ? 0 : SOUND_DOOR;
      return m.windowAt.has(i) ? SOUND_GLASS : 0;
    };
    const start = sy * w + sx;
    d[start] = 0; touched.push(start);
    const heap = new MinHeap();
    heap.push(0, start);
    while (heap.size) {
      const i = heap.pop();
      if (done[i]) continue;
      done[i] = 1;
      const ix = i % w, iy = (i - ix) / w, di = d[i];
      for (let k = 0; k < 8; k++) {
        const dx = SOUND_NB[k][0], dy = SOUND_NB[k][1];
        const nx = ix + dx, ny = iy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= m.h) continue;
        const n = ny * w + nx;
        if (done[n]) continue;
        // en diagonale, pas à travers l'angle de deux murs
        if (dx && dy && m.tiles[iy * w + nx] === 1 && m.tiles[ny * w + ix] === 1) continue;
        const nd = di + SOUND_NB[k][2] + extra(n);
        if (nd < R && nd < d[n]) {
          if (d[n] === Infinity) touched.push(n);
          d[n] = nd;
          heap.push(nd, n);
        }
      }
    }
    return d;
  }

  // Un suspect (ou un opérateur) entend un bruit d'intensité I : il s'inquiète, se tourne vers lui, et
  // dit s'il voudrait aller voir (noise choisit ensuite qui y va vraiment).
  hearNoise(e, x, y, I, K, ally, source) {
    const s = I * K.w;
    // une rafale compte moins que des bruits distincts : c'est la répétition qui inquiète
    const gain = this.time - e.heardT < 0.4 ? 0.35 : 1;
    e.heardT = this.time;
    e.suspicion = Math.min(2, (e.suspicion || 0) + s * gain);
    if (s < HEAR_TURN) return false;
    const toward = Math.atan2(y - e.y, x - e.x);
    if (e.hunter) {
      if (ally) {
        // les siens qui tirent tout près, d'un autre trinôme : on vient en renfort sur ce qu'ils ont trouvé (on ne se
        // retourne pas vers eux : ce n'est pas là qu'est l'adversaire)
        const c = source && source.group && source.group !== e.group && source.group.contact;
        if (K === NOISE_KINDS.shot && s >= HEAR_GO && c && this.time - c.t < CONTACT_HOLD) this.know(e, c.x, c.y);
        return false;
      }
      // l'intervention (ou un trinôme) converge sur ce qu'elle entend du camp d'en face (un impact ou une grenade
      // qui rebondit ne disent pas où est le tireur)
      if (K !== NOISE_KINDS.impact && K !== NOISE_KINDS.bounce && (K.important || s >= HEAR_GO)) this.know(e, x, y);
      if (e.noiseT <= 0) { e.noiseT = 1; e.alertAngle = toward; }
      return false;
    }
    if (e.state === 'investigate' && e.noiseT > 0) return false; // il vient de partir voir
    e.alertAngle = toward;
    if (e.guard) return false; // (il tient un otage en joue : il regarde, il ne bouge pas)
    if (e.state !== 'investigate') e.homeAngle = toward; // il garde désormais un œil de ce côté
    return (K.important && s >= HEAR_GO) || e.suspicion >= SUSPICION_GO;
  }

  // Aller voir : vers l'endroit du bruit, localisé d'autant moins bien qu'il était faible.
  investigate(e, x, y, I) {
    const err = (1 - I) * 1.5 * U, a = rand(0, TAU), r = rand(0, err);
    let gx = x + Math.cos(a) * r, gy = y + Math.sin(a) * r;
    let path = this.pathTo(e, gx, gy);
    if (!path.length) { gx = x; gy = y; path = this.pathTo(e, x, y); }
    e.state = 'investigate';
    e.barricade = null; // (il laisse là ses portes)
    e.lastKnown = { x: gx, y: gy };
    e.searchT = 0;
    e.path = path;
    e.noiseT = 1.5;
    e.suspicion = Math.max(0, e.suspicion - 0.6); // il y va : l'inquiétude retombe un peu
  }

  // Repère d'un bruit entendu par le joueur (fusionné avec un repère proche de même nature).
  addHeard(a, I, kind) {
    for (const h of this.heard) {
      if (h.kind === kind && h.t < 0.35 && Math.abs(angleDiff(h.a, a)) < 16 * DEG) { h.i = Math.max(h.i, I); h.a = a; h.t = 0; return; }
    }
    this.heard.push({ a, i: I, kind, t: 0 });
    if (this.heard.length > 24) this.heard.shift();
  }

  // Halo du dernier bruit du joueur : les cases qu'il atteint et son intensité (au plus ~8 fois par seconde).
  markOwnNoise(f, R) {
    const n = this.ownNoise;
    if (n && this.time - n.at < 0.12 && n.R >= R) return;
    const cells = [];
    for (const i of this._sf.touched) if (f[i] < R) cells.push(i, 1 - f[i] / R);
    this.ownNoise = { cells, R, at: this.time, id: (n ? n.id : 0) + 1 };
  }

  // Pas de course : un bruit tous les STEP_EVERY px parcourus, et le son du sol sous le pied (de plus loin pour vous que
  // pour l'IA, qui n'y prête attention qu'à R). Marcher ne s'entend pas.
  footstep(a, moved, R) {
    if (!R) { a.stepAcc = 0; return; }
    a.stepAcc = (a.stepAcc || 0) + moved;
    if (a.stepAcc < STEP_EVERY) return;
    a.stepAcc = 0;
    this.noise(a.x, a.y, R, a, 'step');
    this.sfx('step', a.x, a.y, R * 2.6, this.map.floor(a.tx, a.ty));
  }

  // Portée des pas d'un agent de l'IA : un coéquipier qui marche ne fait pas de bruit, un suspect qui
  // va voir quelque chose presse le pas, celui qui regagne son poste marche.
  stepNoise(a) {
    if (a.hunter) return (a.pace || 1) < 1 ? 0 : STEP_NOISE.operator; // un trinôme au pas ne s'entend pas
    if (a.team === 'enemy') return a.state === 'investigate' || a.state === 'engage' ? STEP_NOISE.suspect : 0;
    return a.walkMode ? 0 : STEP_NOISE.mate;
  }
});
