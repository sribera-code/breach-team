'use strict';
// HUD DOM + overlays (briefing, pause, fin de mission, missions, aide).

// Taille des cartes d'équipement du briefing par rapport au dessin de référence (170 × 50).
const CARD_SCALE = 0.62;
// Marge autour du plan du briefing, en petites cases.
const PLAN_PAD = 3;
// Petites icônes vectorielles, dessinées par le code comme tout le reste : accessoires et gilets (repère 24 × 16).
// Elles prennent la couleur du texte (classes f : forme pleine, t : trait) ; le laser et la lampe gardent leur rayon.
const ICONS = {
  sup: '<rect x="2" y="4.5" width="20" height="7" rx="2.5" class="f"/><path d="M8 4.5v7M12.5 4.5v7M17 4.5v7" class="t"/>',
  laser: '<rect x="1.5" y="5" width="8" height="6" rx="1.2" class="f"/><path d="M9.5 8h8.5" stroke="#ff6a5a" stroke-width="1.3" stroke-dasharray="2 1.4"/><circle cx="20.5" cy="8" r="2.2" fill="#ff6a5a"/>',
  light: '<path d="M10.5 5.2 23 2v12l-12.5-3.2z" fill="#ffd27a" opacity=".5"/><rect x="1.5" y="5.5" width="6" height="5" rx="1" class="f"/><rect x="7.5" y="4.5" width="3.5" height="7" rx=".8" class="f"/>',
  grip: '<path d="M2 3.2h20" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M9 4.5h6l-.5 10a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1z" class="f"/><path d="M9.5 8h5M9.5 11h5" class="t"/>',
  scope: '<rect x="6" y="6" width="11" height="4" rx="1" class="f"/><path d="M2 5h4v6H2zM17 3.8h5v8.4h-5z" class="f"/><path d="M11.5 3.5v9" class="t"/>',
  mag: '<path d="M8 1.5h8l1.5 12.5a1 1 0 0 1-1 1.1h-7a1 1 0 0 1-1-1z" class="f"/><path d="M9 4.5h7M9.4 7.5h7.2M9.8 10.5h7.4" class="t"/>',
  // canon nu et départ de coup : sans silencieux
  loud: '<rect x="1.5" y="6" width="11" height="4" rx="1" class="f"/><path d="M15 8h6.5M14.5 4.8l5-2.6M14.5 11.2l5 2.6" class="f"/>',
  vestL: '<path d="M8 1.5l2.5 2h3l2.5-2 4 2.5-.8 11H4.8L4 4z" class="f"/><path d="M12 3.5v11.5" class="t"/>',
  vestH: '<path d="M8 1.5l2.5 2h3l2.5-2 4 2.5-.8 11H4.8L4 4z" class="f"/><rect x="8.5" y="5.5" width="7" height="7.5" rx="1" fill="currentColor"/>',
  // grenades : la flash (cylindre percé, éclair), la fragmentation (corps quadrillé, cuillère), et les deux
  flash: '<rect x="8.5" y="5" width="7" height="10" rx="1.2" class="f"/><rect x="10" y="2.5" width="4" height="2.5" class="f"/><path d="M10.5 8.5h3M10.5 11.5h3" class="t"/><path d="M3 4.5l3 1.6M21 4.5l-3 1.6M2.5 10.5h3.5M21.5 10.5H18" stroke="#ffd27a" stroke-width="1.3" stroke-linecap="round"/>',
  frag: '<circle cx="11" cy="10" r="5" class="f"/><rect x="9" y="2.5" width="4" height="2.6" class="f"/><path d="M13 3.6l4.5 3.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M6.5 10h9M11 5.5v9" class="t"/>',
  mix: '<rect x="2" y="6" width="6" height="9" rx="1" class="f"/><rect x="3.4" y="3.6" width="3.2" height="2.4" class="f"/><circle cx="16.5" cy="10.5" r="4.5" class="f"/><rect x="14.8" y="3.6" width="3.4" height="2.4" class="f"/><path d="M12.5 10.5h8M16.5 6.5v8" class="t"/>',
};
class UI {
  constructor(game) {
    this.game = game;
    this.$ = id => document.getElementById(id);
    this.overlay = this.$('overlay');
    this.panel = this.$('overlayPanel');
    game.on('level', () => { this.hideOverlay(); this.$('levelName').textContent = `${MODES[game.mode].name} — ${game.def.name}`; this.update(); });
    game.on('over', r => setTimeout(() => this.showEnd(r), 900));
    game.on('pause', () => { if (game.paused) this.showPause(); else this.hideOverlay(); });
  }

  update() {
    const g = this.game, p = g.player;
    // guerre totale : le temps qui reste, pas celui qui passe
    this.$('timer').textContent = fmtTime(g.war ? Math.max(0, WAR_TIME - g.time) : g.time);
    const alive = g.enemies.filter(e => e.alive).length;
    const held = g.hostages.filter(h => h.alive && !h.evacuated).length;
    if (g.war) {
      // guerre totale : le décompte des deux armées, et quand revient votre trinôme s'il est anéanti
      const W = g.war, back = W.respawn.ops[0];
      const mine = g.ops.filter(o => o.alive).length;
      this.$('objective').textContent = `Score : ${W.kills.ops} – ${W.kills.enemy} · Votre armée : ${mine} debout · En face : ${alive}`
        + (back !== null ? ` · Renforts dans ${Math.max(0, Math.ceil(back - g.time))} s` : '');
    } else if (g.siege) {
      const s = g.siege;
      this.$('objective').textContent = s.prep > 0
        ? `Préparation : ${fmtTime(Math.max(0, s.prep)).slice(0, 5)} — prenez position`
        : (alive ? `Vague ${s.wave} / ${s.waves.length} · Assaut : ${alive}`
          : s.wave < s.waves.length ? `Vague ${s.wave + 1} / ${s.waves.length} dans ${Math.ceil(Math.max(0, s.nextWave))} s`
          : `Vague ${s.wave} / ${s.waves.length} repoussée`) + ` · Otages : ${held}`;
    } else if (g.squads) {
      // trinômes : qui reste debout de part et d'autre
      const mine = g.ops.filter(o => o.alive).length;
      this.$('objective').textContent = `Adversaires : ${alive} / ${g.enemies.length} · Votre camp : ${mine} / ${g.squadSize}`;
    } else if (g.escort) {
      // escorte : l'état du VIP, la direction du point B depuis vous, et les suspects encore debout
      const v = g.vip, left = g.enemies.filter(Game.active).length, goal = g.escort.goal;
      const where = !v.alive ? 'tué' : g.escort.safe ? 'en sécurité' : v.escort ? 'vous suit' : 'à couvert';
      const dir = goal ? UI.compass(goal.cx - p.x, goal.cy - p.y) : '?';
      this.$('objective').textContent = `VIP : ${Math.round(100 * v.hp / v.maxHp)} % (${where}) · Point B : ${dir} · Suspects : ${left} / ${g.enemies.length}${g.dark ? ' · Courant coupé' : ''}${g.alarm ? ' · Alerte générale' : ''}`;
    } else {
      const out = g.hostages.filter(h => h.evacuated).length;
      const left = g.enemies.filter(Game.active).length, held = g.enemies.filter(e => e.cuffed).length;
      this.$('objective').textContent = `Suspects : ${left} / ${g.enemies.length}${held ? ` (${held} arrêté${held > 1 ? 's' : ''})` : ''} · Otages évacués : ${out} / ${g.hostages.length}${g.dark ? ' · Courant coupé' : ''}${g.alarm ? ' · Alerte générale' : ''}`;
    }
    // ce qui protège : le gilet (et le bouclier), à côté de la santé
    const gear = this.$('gearLabel');
    if (gear) {
      const t = [p.vest && p.vest.short, p.shield && p.shield.name].filter(Boolean).join(' · ');
      if (gear.textContent !== t) gear.textContent = t;
    }
    const fill = this.$('hpFill');
    fill.style.width = (100 * p.hp / p.maxHp) + '%';
    fill.style.background = p.hp > 60 ? '#4caf50' : p.hp > 30 ? '#ffb300' : '#ef5350';
    this.$('flashCount').textContent = p.flashbangs;
    const cb = this.$('chargeBox');
    if (cb) { cb.style.display = g.camp === 'armed' ? 'none' : ''; this.$('chargeCount').textContent = g.charges.some(c => c.team === p.team) ? 'posée' : p.charges; }
    const nl = this.$('nadeLabel');
    if (nl) nl.textContent = g.camp === 'armed' ? 'Grenades' : NADE_NAMES[p.nade] || 'Flash';
    // lot mixte : l'autre sorte de grenade, et la touche qui la met en main
    const no = this.$('nadeOther');
    if (no) {
      const k = g.camp === 'armed' ? null : Object.keys(p.nades || {}).find(n => n !== p.nade && p.nades[n] > 0);
      const html = k ? `· ${NADE_NAMES[k]} <b>${p.nades[k]}</b> <small>(N)</small>` : '';
      if (this._nadeOther !== html) { this._nadeOther = html; no.innerHTML = html; }
    }
    // aide du bas d'écran : pas de fibre et des grenades à fragmentation côté groupe armé ; ni otage ni sommation
    // en trinômes
    const rh = this.$('reloadHint');
    if (rh) {
      if (this._reloadHint === undefined) this._reloadHint = rh.textContent;
      const txt = g.camp === 'armed' ? this._reloadHint.replace(' · F (maintenu) : fibre sous la porte', '').replace(' · N : autre grenade', '')
        .replace(' · H : otage / menottes', '').replace(' · C : sommation', '').replace(' · B : charge', '')
        : g.squads ? this._reloadHint.replace(' · H : otage / menottes', '').replace(' · C : sommation', '')
        : g.escort ? this._reloadHint.replace('H : otage / menottes', 'H : VIP (suivre / attendre) / menottes') : this._reloadHint;
      if (rh.textContent !== txt) rh.textContent = txt;
    }
    const mode = this.$('moveMode');
    mode.textContent = p.walkMode ? 'MARCHE' : 'COURSE';
    mode.classList.toggle('walk', p.walkMode);
    const fib = this.$('fiberMode');
    if (fib) fib.classList.toggle('on', !!p.fiber);
    this.updateSquad();
    const s = p.slot, w = s.def;
    // laser de l'arme en main : allumé, ou barré quand on l'a éteint (L)
    const las = this.$('laserMode');
    if (las) { las.classList.toggle('on', !!w.laser); las.classList.toggle('off', !p.laserOn); }
    const lamp = this.$('lampMode');
    if (lamp) { lamp.classList.toggle('on', !!w.light); lamp.classList.toggle('off', !p.lampOn); }
    // lunette de l'arme en main : vive à l'œil (à l'arrêt), barrée en mouvement
    const sc = this.$('scopeMode');
    if (sc) { sc.classList.toggle('on', !!w.scope); sc.classList.toggle('off', !this.game.scoped(p)); }
    if (this._weaponShown !== w || this._shieldShown !== p.shield) {
      this._weaponShown = w; this._shieldShown = p.shield;
      const tags = [w.caliber, w.mode, w.suppressed && 'silencieux', w.laser && 'laser', w.light && 'lampe', w.scope && 'lunette', p.shield && p.shield.name.toLowerCase()].filter(Boolean);
      this.$('weaponName').innerHTML = `${w.name} <small>${tags.join(' · ')}</small>`;
    }
    const ammo = this.$('ammo');
    // Chargement cartouche par cartouche : le compteur reste visible et monte.
    this.$('ammoMag').textContent = p.reloadT > 0 && w.reloadType !== 'shell' ? '⟳' : s.mag;
    this.$('ammoReserve').textContent = s.reserve;
    ammo.classList.toggle('low', s.mag <= Math.ceil(w.mag * 0.2));
    this.$('message').textContent = g.message.t > 0 ? g.message.text : '';
  }

  static icon(name) { return `<svg class="ico" viewBox="0 0 24 16" aria-hidden="true">${ICONS[name]}</svg>`; }

  // Direction d'un point en huit aires de vent (y vers le bas : le sud), « tout près » à moins de trois cases.
  static compass(dx, dy) {
    if (Math.hypot(dx, dy) < 3 * U) return 'tout près';
    const names = ['est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest', 'nord', 'nord-est'];
    return names[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
  }

  // Lignes de l'équipe : vos coéquipiers (en escorte, le VIP en plus) ; en guerre totale, les trois trinômes de votre
  // armée tels qu'ils sont en ce moment (pas les corps des précédents).
  squadRows() {
    const g = this.game;
    if (g.war) return g.war.slots.ops.flatMap(s => (s ? s.members : [])).filter(m => m !== g.player);
    return g.vip ? [...g.mates, g.vip] : g.mates;
  }

  updateSquad() {
    const g = this.game, box = this.$('squad');
    // en escorte, le VIP a sa ligne sous l'équipe : sa santé et ce qu'il fait
    const rows = this.squadRows();
    const same = this._squadRows && this._squadRows.length === rows.length && rows.every((r, i) => r === this._squadRows[i]);
    if (!same) {
      this._squadRows = rows;
      box.classList.toggle('many', rows.length > 4);
      // en siège, pas d'ordres : l'aide sur les commandes d'équipe n'a pas lieu d'être
      const hint = this.$('squadHint');
      if (hint) {
        if (!this._squadHint) this._squadHint = hint.textContent;
        hint.textContent = g.siege ? "Vos complices tiennent leur poste : vous ne leur donnez pas d'ordres"
          : g.war ? `${this._squadHint} — les deux autres trinômes (en italique) tiennent les flancs seuls`
          : g.squads ? `${this._squadHint} — le second trinôme (en italique) progresse seul` : this._squadHint;
      }
      // en trinômes, le second trinôme de votre camp, autonome, en italique sous le vôtre
      box.innerHTML = rows.map(m => `<div class="mate${m.hunter ? ' auto' : ''}"><span class="mname" style="color:${m.vip ? '#ffd54f' : m.accent}${m.hunter ? ';font-style:italic' : ''}">${m.name}</span><div class="mhp"><div></div></div><span class="morder"></span><span class="mnade"></span></div>`).join('');
    }
    const orders = { follow: 'Suit', hold: g.siege ? 'Au poste' : 'Tient', move: 'Se déplace', stack: 'En colonne' };
    const acts = { lockpick: 'Crochète', grenade: 'Lance une flash', charge: 'Pose une charge' };
    box.querySelectorAll('.mate').forEach((el, i) => {
      const m = rows[i];
      el.classList.toggle('down', !m.alive);
      const bar = el.querySelector('.mhp div');
      bar.style.width = (100 * m.hp / m.maxHp) + '%';
      bar.style.background = m.hp > 60 ? '#4caf50' : m.hp > 30 ? '#ffb300' : '#ef5350';
      let s = m.vip ? (!m.alive ? 'Tué' : g.escort.safe ? 'En sécurité' : m.duckT > 0 ? 'À terre' : m.escort ? 'Suit' : 'À couvert')
        : !m.alive ? 'À terre' : m.stun > 0 ? 'Aveuglé' : m.act ? (m.act.type === 'grenade' && m.nade === 'frag' ? 'Lance une grenade' : acts[m.act.type] || 'Ouvre la porte') : m.target ? (m.blockedLine ? 'Axe bouché' : 'Au contact') : m.reloadT > 0 ? 'Recharge'
        : m.hunter ? (m.entry ? 'En colonne' : m.clear ? 'Entre' : 'Progresse')
        : m.order === 'stack' ? orders.stack
        : m.coverAngle !== null ? (m.order === 'move' ? 'Se déplace ▸ couvre' : 'Couvre') : orders[m.order];
      el.querySelector('.morder').textContent = s;
      // flashs (ou grenades) qui lui restent (l'entrée à la flash en consomme une)
      el.querySelector('.mnade').textContent = !m.vip && m.alive && m.flashbangs > 0 ? `${m.nade === 'frag' ? 'Grenade' : 'Flash'} ${m.flashbangs}` : '';
    });
  }

  showOverlay(html) { this.panel.classList.remove('wide', 'brief'); this.panel.innerHTML = html; this.overlay.classList.remove('hidden'); }
  hideOverlay() { this.overlay.classList.add('hidden'); }
  isOpen() { return !this.overlay.classList.contains('hidden'); }

  // Texte d'ambiance du mode siège (le briefing des missions est écrit côté intervention).
  siegeBriefing() {
    return `Vous tenez le bâtiment avec vos hommes et vos otages. Une équipe d'intervention va donner
      l'assaut par les portes et les fenêtres. Vos complices tiennent chacun leur poste et vous ne leur
      donnez pas d'ordres. Fermez ou entrebâillez les portes, choisissez votre poste, puis repoussez les ${SIEGE_WAVES.length} vagues, le
      temps que les négociations aboutissent. Les otages sont votre seule protection : s'il ne vous en reste plus un seul de vivant, tout est perdu.`;
  }

  // Texte d'ambiance du mode trinômes, selon le camp.
  squadsBriefing() {
    return this.game.camp === 'armed'
      ? `Deux trinômes d'intervention vont entrer dans le bâtiment pour vous déloger. Vous menez le vôtre — vous et deux
        complices, à vos ordres — et un second trinôme du groupe armé entre de son côté et chasse seul. Ils ont des flashs,
        des charges de brèche et savent entrer en colonne ; vous avez vos grenades, des silencieux et des rails sur vos
        AK. Le premier camp entièrement hors de combat a perdu.`
      : `Deux trinômes armés tiennent à se battre dans le bâtiment. Vous menez votre trinôme — vous, Bravo et Charlie, à
        vos ordres — et le trinôme Delta, Echo et Fox entre de son côté et progresse seul. En face, deux trinômes du groupe
        armé chassent, grenades à fragmentation en main, certains au silencieux ou au laser. Pas d'otage, pas de
        sommation : le premier camp entièrement hors de combat a perdu.`;
  }

  // Texte d'ambiance de la guerre totale, selon le camp ; la carte ajoute le sien.
  warBriefing() {
    const g = this.game, min = Math.round(WAR_TIME / 60);
    return (g.camp === 'armed'
      ? `Deux armées de trois trinômes : la vôtre, celle du groupe armé, contre l'intervention. Vous menez un trinôme — vous et
        deux complices, à vos ordres — au centre ; deux autres tiennent les flancs seuls.`
      : `Deux armées de trois trinômes : la vôtre, celle de l'intervention, contre le groupe armé. Vous menez un trinôme — vous,
        Bravo et Charlie, à vos ordres — au centre ; deux autres tiennent les flancs seuls.`)
      + ` Un trinôme anéanti revient de sa base ${WAR_RESPAWN} s plus tard, le vôtre comme les autres. Au bout de ${min} minutes, l'armée qui a abattu
        le plus d'adversaires l'emporte. ${g.def.briefing || ''}`;
  }

  // Ce que le briefing (et la pause) raconte de la mission.
  briefText() {
    const g = this.game;
    return g.mode === 'siege' ? (g.def.siegeBriefing || this.siegeBriefing()) : g.war ? this.warBriefing()
      : g.squads ? `${this.squadsBriefing()} ${g.def.briefing || ''}` : g.def.briefing;
  }

  // Où l'on en est des trois écrans de départ : le mode, la carte, l'équipement. Les deux premiers se rouvrent d'un clic.
  static steps(at, mode, map) {
    const s = (n, label, id) => (n === at ? `<b>${n}. ${label}</b>` : id ? `<button class="crumb" id="${id}">${n}. ${label}</button>` : `<span>${n}. ${label}</span>`);
    return `<div class="steps">${s(1, mode ? `Mode : ${mode}` : 'Mode', at > 1 ? 'ovModes' : null)}<i>›</i>${s(2, map ? `Carte : ${map}` : 'Carte', at > 2 ? 'ovLevels' : null)}<i>›</i>${s(3, 'Équipement')}</div>`;
  }

  // Premier écran : le mode de jeu, puis la carte (showLevels), puis l'équipement (showBriefing). Les deux camps d'un
  // mode n'ont qu'une carte de mode : le camp se choisit au briefing. back : écran à rouvrir avec « Retour ».
  showModes(back) {
    const g = this.game;
    g.paused = true;
    const shown = MODES[g.mode].variantOf || g.mode;
    const cards = Object.keys(MODES).filter(m => !MODES[m].variantOf).map(m => {
      const M = MODES[m], n = M.levels.length;
      return `<button class="modebtn${m === shown ? ' sel' : ''}" data-mode="${m}"><span class="mtitle">${M.pitch}</span><small>${M.desc}</small><span class="mcount">${n} carte${n > 1 ? 's' : ''}</span></button>`;
    }).join('');
    this.showOverlay(`<h1>Breach Team</h1>${UI.steps(1)}<div class="modecards">${cards}</div>
      <div class="row">${back ? '<button id="ovClose">Retour</button>' : ''}<button id="ovHelp">Commandes</button></div>`);
    this.panel.classList.add('wide');
    this.panel.querySelectorAll('.modebtn').forEach(b => {
      b.onclick = () => { if (b.dataset.mode !== shown) g.setMode(b.dataset.mode); this.showLevels(back); };
    });
    const close = this.panel.querySelector('#ovClose');
    if (close) close.onclick = back;
    this.panel.querySelector('#ovHelp').onclick = () => this.showHelp(() => this.showModes(back));
  }

  // Briefing sur un seul écran, sans défilement : à gauche le plan et le point d'entrée (la base en guerre totale), au
  // milieu l'équipement et ses accessoires, à droite les fiches de ce qu'on emporte, toujours à la même place. Les
  // variantes d'un mode (l'autre camp des trinômes et de la guerre totale) se choisissent à gauche.
  showBriefing() {
    const g = this.game;
    g.paused = true;
    const siege = g.mode === 'siege', escort = g.mode === 'escort', squads = !!g.squads, war = !!g.war, armed = g.camp === 'armed';
    const M = MODES[g.mode];
    this.showOverlay(`<div class="brief-head"><h1>${g.def.name} <small>${M.name}</small></h1>${UI.steps(3, M.name, g.def.name)}</div>
      <p class="brief-text">${this.briefText()}</p>
      <div class="brief-cols">
        <section class="brief-col">${siege ? this.buildingPlan() : escort ? this.routePlan() : war ? this.basePicker(this.campRow()) : this.entryPicker(squads ? this.campRow() : this.powerRow())}</section>
        <section class="brief-col">
          <h2>Équipement</h2>
          <div class="loadout">
            ${['ar', 'smg', 'sg'].map(c => this.weaponGroup(c, MODES[g.mode].primaries, 'primary')).join('')}
            ${this.shieldGroup(MODES[g.mode].shields)}
            ${this.weaponGroup('hg', MODES[g.mode].sidearms, 'sidearm')}
          </div>
          <h2>Accessoires</h2>
          <div id="waccs"></div>
          ${armed ? (squads ? `<div class="suprow">${this.crewKit()}</div>` : '') : `<div class="suprow">${this.vestPicker()}</div><div class="suprow">${this.nadePicker()}</div><div class="suprow">${this.teamPicker()}</div>`}
        </section>
        <section class="brief-col brief-specs"><div class="brief-specs-in"><h2>Caractéristiques</h2><div id="wsum" class="wsum"></div><div id="wdetail"></div></div></section>
      </div>
      <div class="row"><button class="primary" id="ovGo">${siege ? 'Prendre position' : escort ? "Lancer l'exfiltration" : war ? 'Au combat' : squads ? 'Engager' : "Lancer l'assaut"}</button><button id="ovHelp">Commandes</button></div>`);
    this.panel.classList.add('wide', 'brief');
    this.panel.querySelector('#ovModes').onclick = () => this.showModes(() => this.showBriefing());
    // camp des trinômes et de la guerre totale : l'autre variante du mode, avec son équipement
    this.panel.querySelectorAll('.campbtn').forEach(b => {
      b.onclick = () => { if (b.dataset.mode !== g.mode) { g.setMode(b.dataset.mode); this.showBriefing(); } };
    });
    this.panel.querySelectorAll('.entrybtn').forEach(b => {
      b.onclick = () => { g.setEntry(b.dataset.entry === 'random' ? null : +b.dataset.entry); this.showBriefing(); };
      b.onmouseenter = () => this.drawBriefPlan(b.dataset.entry === 'random' ? null : +b.dataset.entry);
      b.onmouseleave = () => this.drawBriefPlan();
    });
    this.hookPlan();
    // silencieux des coéquipiers et courant : changer recharge la mission (nouvelles armes, noir), d'où le
    // briefing redessiné ; on ne fait rien si l'on reclique le choix en cours
    this.panel.querySelectorAll('.teambtn').forEach(b => {
      b.onclick = () => { const on = b.dataset.sup === '1'; if (on !== !!g.loadout.teamSup) { g.setLoadout({ teamSup: on }); this.showBriefing(); } };
    });
    this.panel.querySelectorAll('.vestbtn').forEach(b => {
      b.onclick = () => { g.setLoadout({ vest: b.dataset.vest }); this.refreshLoadout(); };
    });
    this.panel.querySelectorAll('.nadebtn').forEach(b => {
      b.onclick = () => { g.setLoadout({ nades: b.dataset.nades }); this.refreshLoadout(); };
    });
    this.panel.querySelectorAll('.powbtn').forEach(b => {
      b.onclick = () => { const cut = b.dataset.cut === '1'; if (cut !== !!g.loadout.cutPower) { g.setLoadout({ cutPower: cut }); this.showBriefing(); } };
    });
    // une arme principale remplace le bouclier, et inversement
    this.panel.querySelectorAll('.wcard').forEach(b => {
      const k = b.dataset.key, slot = b.dataset.slot;
      b.onclick = () => { g.setLoadout(slot === 'primary' ? { primary: k, shield: null } : { [slot]: k }); this.refreshLoadout(); };
    });
    this.refreshLoadout();
    this.panel.querySelector('#ovGo').onclick = () => {
      Sound.init();
      if (g.over) g.restart(); // mission déjà gagnée ou perdue : on repart de zéro plutôt que de rester figé
      g.paused = false;
      this.hideOverlay();
    };
    this.panel.querySelector('#ovLevels').onclick = () => this.showLevels(() => this.showBriefing());
    this.panel.querySelector('#ovHelp').onclick = () => this.showHelp(() => this.showBriefing());
  }

  // Guerre totale : la base d'où part votre armée, sur le plan ou par son nom (l'autre revient à l'adversaire). extra :
  // ce qui suit (le camp).
  basePicker(extra) {
    const g = this.game, bs = g.map.bases;
    const hasard = `<button class="entrybtn${g.entryRandom ? ' sel' : ''}" data-entry="random">Au hasard</button>`;
    const btns = bs.map((b, i) => `<button class="entrybtn${!g.entryRandom && i === g.entryIndex ? ' sel' : ''}" data-entry="${i}">${g.map.baseLabel(b)}</button>`).join('');
    return `<h2>Votre base</h2><canvas class="plan pick" id="ovPlan" title="Cliquez une base pour en partir"></canvas>
      <p class="planlegend"><i class="lg-door"></i> porte <i class="lg-win"></i> fenêtre <i class="lg-home"></i> votre base <i class="lg-foe"></i> la leur</p>
      <div class="entries">${hasard}${btns}</div>${extra}`;
  }

  // Point d'entrée : l'équipe choisit par où elle pénètre dans le bâtiment, sur le plan ou par son nom. extra : ce qui
  // suit (le courant en assaut, le camp en trinômes).
  entryPicker(extra) {
    const g = this.game, bs = g.map.breaches;
    const legend = `<p class="planlegend"><i class="lg-door"></i> porte <i class="lg-win"></i> fenêtre <i class="lg-entry"></i> ouverture</p>`;
    if (bs.length < 2) return `<h2>Point d'entrée</h2><canvas class="plan" id="ovPlan"></canvas>${legend}${extra}`;
    // « Au hasard » ne dit pas ce qui est sorti : on le découvre sur place
    const hasard = `<button class="entrybtn${g.entryRandom ? ' sel' : ''}" data-entry="random">Au hasard</button>`;
    const btns = bs.map((b, i) =>
      `<button class="entrybtn${!g.entryRandom && i === g.entryIndex ? ' sel' : ''}" data-entry="${i}">${g.map.breachLabel(b)}</button>`).join('');
    return `<h2>Point d'entrée</h2><canvas class="plan pick" id="ovPlan" title="Cliquez une ouverture pour entrer par là"></canvas>${legend}<div class="entries">${hasard}${btns}</div>${extra}`;
  }

  // Trinômes et guerre totale : le camp que l'on mène (chacun son équipement, gardé à part), et d'où viennent les autres.
  campRow() {
    const g = this.game, police = MODES[g.mode].variantOf || g.mode, armed = Object.keys(MODES).find(m => MODES[m].variantOf === police);
    const btn = (mode, label, tip) => `<button class="supbtn campbtn${g.mode === mode ? ' sel' : ''}" data-mode="${mode}" title="${tip}">${label}</button>`;
    return `<div class="powerrow"><div class="suprow"><span class="rowlabel">Camp</span>${btn(police, '🛡 Intervention', 'Flashs ou grenades à fragmentation (au choix), charges de brèche, fibre, gilet ; en face, le groupe armé et ses grenades à fragmentation.')}${btn(armed, '☠ Groupe armé', "Grenades à fragmentation ; en face, l'intervention, ses flashs, ses charges et ses colonnes.")}</div>
      <small>${g.war ? 'Vos deux autres trinômes partent de votre base, sur les flancs ; l\'armée d\'en face, de l\'autre base.'
        : "Votre second trinôme entre par l'ouverture la plus proche de la vôtre, les deux d'en face par les plus éloignées."}</small></div>`;
  }

  // Gilet pare-balles : tous ceux du mode côte à côte, celui qu'on porte en surbrillance ; ce qu'il arrête en
  // bulle d'aide, et en chiffres dans le bilan (à droite).
  vestPicker() {
    const g = this.game, keys = MODES[g.mode].vests || [];
    if (!keys.length) return '';
    return `<span class="rowlabel">Gilet</span>${keys.map(k => {
      const v = VESTS[k], kg = String(v.weight).replace('.', ',');
      return `<button class="supbtn vestbtn${g.loadout.vest === k ? ' sel' : ''}" data-vest="${k}" title="${v.name}, ${v.rating}, ${kg} kg. ${v.note}">${UI.icon(v.plate ? 'vestH' : 'vestL')} ${v.label} · ${kg} kg</button>`;
    }).join('')}`;
  }

  // Grenades de l'intervention : les lots côte à côte (NADE_KITS), celui qu'on emporte en surbrillance ; ce qu'il
  // contient en bulle d'aide.
  nadePicker() {
    const g = this.game;
    return `<span class="rowlabel">Grenades</span>${Object.keys(NADE_KITS).map(k => {
      const n = NADE_KITS[k];
      return `<button class="supbtn nadebtn${g.loadout.nades === k ? ' sel' : ''}" data-nades="${k}" title="${n.note}">${UI.icon(n.icon)} ${n.label}</button>`;
    }).join('')}`;
  }

  // Silencieux des coéquipiers : les deux choix côte à côte, celui retenu en surbrillance, et dessous l'arme
  // que chacun a reçue (tirée au sort parmi celles qui acceptent un silencieux quand on en veut un).
  teamPicker() {
    const g = this.game, on = !!g.loadout.teamSup;
    const btn = (sup, icon, label, tip) =>
      `<button class="supbtn teambtn${sup === on ? ' sel' : ''}" data-sup="${sup ? 1 : 0}" title="${tip}">${UI.icon(icon)} ${label}</button>`;
    const arms = g.mates.filter(m => !m.hunter).map(m => `${m.name} : ${m.weapon ? m.weapon.name + (m.weapon.suppressed ? ' 🔇' : '') : '—'}`).join(' · ');
    return `<span class="rowlabel">Équipe</span>
      ${btn(true, 'sup', 'Silencieux', "Bravo et Charlie tirent au silencieux : ils reçoivent une arme qui en accepte un (pas de fusil à pompe).")}
      ${btn(false, 'loud', 'Sans', 'Bravo et Charlie tirent sans silencieux : chaque coup s’entend loin.')}
      <small class="teamarms">${arms}</small>`;
  }

  // Trinômes, côté groupe armé : l'arme de chacun de vos complices et ce qu'elle porte (tiré au sort, MILITANT_KITS).
  crewKit() {
    const names = { sup: 'silencieux', laser: 'laser', light: 'lampe', grip: 'poignée', mag: 'chargeur long', scope: 'lunette' };
    const arms = this.game.crew.map(m => {
      const w = m.weapon, on = Object.keys(names).filter(n => w.acc && w.acc[n]).map(n => names[n]);
      return `${m.name} : ${w.name}${on.length ? ` (${on.join(', ')})` : ''}`;
    }).join(' · ');
    return `<span class="rowlabel">Complices</span><small class="teamarms">${arms}</small>`;
  }

  // Bilan de ce qu'on emporte : la charge, la vitesse (celle du jeu : la masse de toutes les armes portées, puis le
  // gilet et le bouclier), et la part des dégâts encaissés selon l'arme d'en face et le côté d'où vient la balle.
  gearSummary() {
    const l = this.game.loadout, sh = SHIELDS[l.shield] || null, v = VESTS[l.vest] || null;
    const prim = sh ? null : this.loadoutDef(l.primary), side = this.loadoutDef(l.sidearm);
    const arms = (prim ? prim.weight : 0) + side.weight, kg = arms + (sh ? sh.weight : 0) + (v ? v.weight : 0);
    const items = [prim && prim.name, side.name, sh && sh.name, v && v.name].filter(Boolean).join(', ');
    // même produit que Game.updatePlayer, rapporté à la plus grande vitesse possible (une arme de poing seule)
    const sp = Math.round(100 * loadMobility(arms) * (sh ? sh.mobility : 1) * (v ? v.mobility : 1) / MOBILITY_MAX);
    const num = (x, d) => x.toFixed(d).replace('.', ',');
    const why = [`armes ${num(arms, 1)} kg`, v && v.mobility < 1 && `${v.short.toLowerCase()} ×${num(v.mobility, 2)}`,
      sh && `${sh.name.toLowerCase()} ×${num(sh.mobility, 2)}`].filter(Boolean).join(' · ');
    const bar = (label, k, val, tip) => `<div class="ws-line" title="${tip}"><span>${label}</span><div class="bar"><div style="width:${Math.round(clamp(k, 0.03, 1) * 100)}%"></div></div><b>${val}</b></div>`;
    let res;
    if (!v && !sh) res = '<p class="ws-none">Ni gilet ni bouclier : chaque balle porte tous ses dégâts.</p>';
    else {
      // même calcul que Game.vestHit et Game.shieldHit : plaques de face et de dos, bouclier de face seulement
      const vestPart = (pen, plates) => !v ? 1 : v.plate && plates && pen <= v.plate ? v.plateBlunt : pen <= v.soft ? v.blunt : 1;
      const taken = (pen, from) => from === 'face' && sh ? (pen <= sh.stops ? 0 : sh.through * vestPart(pen, true)) : vestPart(pen, from !== 'flanc');
      const cell = t => `<td class="${t <= 0.35 ? 'good' : t <= 0.6 ? 'mid' : 'bad'}">${Math.round(t * 100)} %</td>`;
      const rows = [['Pistolet, Uzi, pompe', 1], ['AKM, AK-74', 3]];
      res = `<table class="ws-res" title="Part des dégâts d'une balle qui vous touche, selon l'arme qui tire et le côté d'où elle vient">
        <tr><th>Dégâts encaissés</th><th>face</th><th>flanc</th><th>dos</th></tr>
        ${rows.map(([n, pen]) => `<tr><th>${n}</th>${['face', 'flanc', 'dos'].map(f => cell(taken(pen, f))).join('')}</tr>`).join('')}</table>`;
    }
    return `<div class="ws-left">${bar('Charge', kg / 25, `${num(kg, 1)} kg`, items)}${bar('Vitesse', sp / 100, `${sp} %`, 'Rapportée à la plus grande vitesse possible : une arme de poing seule, sans gilet lourd ni bouclier. Toutes les armes portées pèsent, en main ou à la bretelle.')}
      <small title="Ce qui ralentit : la masse de toutes les armes (3,5 % par kilo), puis le gilet et le bouclier">${why}</small></div>
      <div class="ws-right">${res}</div>`;
  }

  // Couper le courant avant d'entrer : tout le bâtiment dans le noir. On n'y voit plus qu'à quelques pas
  // sans lampe, les suspects non plus, mais une lampe allumée se voit de loin.
  powerRow() {
    const cut = this.game.loadout.cutPower;
    const btn = (c, label) => `<button class="supbtn powbtn${c === cut ? ' sel' : ''}" data-cut="${c ? 1 : 0}" title="Dans le noir, on ne voit qu'à quatre cases sans lampe, les suspects non plus ; une lampe allumée se voit de loin.">${label}</button>`;
    return `<div class="powerrow"><div class="suprow"><span class="rowlabel">Courant</span>${btn(false, '💡 Laissé')}${btn(true, '🌑 Coupé')}</div>
      <small>${cut ? 'Coupé avant d\'entrer : noir complet, prenez une lampe.' : 'Tout est éclairé, pour vous comme pour eux.'}</small></div>`;
  }

  // Escorte : le plan, le point A d'où l'on part avec le VIP et le point B où on l'emmène.
  routePlan() {
    return `<h2>Itinéraire</h2><canvas class="plan" id="ovPlan"></canvas>
      <p class="planlegend"><i class="lg-door"></i> porte <i class="lg-win"></i> fenêtre <i class="lg-a"></i> départ (A) <i class="lg-b"></i> extraction (B)</p>
      <p class="brief-note">Le VIP part avec vous du point A et vous suit (H : il attend à couvert, H à nouveau : il repart). Amenez-le vivant jusqu'au point B : inutile de neutraliser tout le monde. Les postes des terroristes sont tirés au sort.</p>${this.powerRow()}`;
  }

  // Siège : le plan du bâtiment à tenir et les ouvertures par où l'assaut peut venir.
  buildingPlan() {
    const m = this.game.map;
    return `<h2>Le bâtiment</h2><canvas class="plan" id="ovPlan"></canvas>
      <p class="planlegend"><i class="lg-door"></i> porte <i class="lg-win"></i> fenêtre <i class="lg-entry threat"></i> ouverture à surveiller</p>
      <p class="brief-note">${m.breaches.length} ouvertures : ${m.breaches.map(b => m.breachLabel(b).toLowerCase()).join(', ')}. Votre poste et ceux de vos complices sont tirés au sort.</p>`;
  }

  // Plan du briefing : l'ouverture retenue (ou survolée) ressort, un clic sur une autre la choisit.
  drawBriefPlan(hover = null) {
    const g = this.game, c = this.panel.querySelector('#ovPlan');
    if (!c) return;
    const siege = g.mode === 'siege';
    UI.drawPlan(c, g.def, { map: g.map, s: 4, pad: PLAN_PAD, threat: siege, sel: siege || g.escort || g.entryRandom ? null : g.entryIndex, hover });
  }

  hookPlan() {
    const g = this.game, c = this.panel.querySelector('#ovPlan');
    if (!c) return;
    this._planHover = null;
    this.drawBriefPlan();
    if (!c.classList.contains('pick')) return;
    // l'ouverture la plus proche du pointeur, à deux cases au plus (une base : à quatre cases de son centre)
    const war = !!g.war, spots = war ? g.map.bases : g.map.breaches, label = i => (war ? g.map.baseLabel(spots[i]) : g.map.breachLabel(spots[i]));
    const tip = war ? 'Cliquez une base pour en partir' : 'Cliquez une ouverture pour entrer par là';
    const at = ev => {
      const r = c.getBoundingClientRect(), m = g.map;
      const x = ((ev.clientX - r.left) / r.width * (m.w + 2 * PLAN_PAD) - PLAN_PAD) * TILE;
      const y = ((ev.clientY - r.top) / r.height * (m.h + 2 * PLAN_PAD) - PLAN_PAD) * TILE;
      let best = null, bd = (war ? 4 : 2) * U;
      spots.forEach((b, i) => { const d = Math.hypot(b.cx - x, b.cy - y); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    c.onmousemove = ev => {
      const i = at(ev);
      c.style.cursor = i === null ? '' : 'pointer';
      c.title = i === null ? tip : label(i);
      if (i !== this._planHover) { this._planHover = i; this.drawBriefPlan(i); }
    };
    c.onmouseleave = () => { this._planHover = null; this.drawBriefPlan(); };
    c.onclick = ev => { const i = at(ev); if (i !== null) { g.setEntry(i); this.showBriefing(); } };
  }

  // ---- Équipement ----
  shieldGroup(keys) {
    if (!keys || !keys.length) return '';
    const cards = keys.map(k => {
      const sh = SHIELDS[k];
      return `<button class="wcard" data-slot="shield" data-key="${k}"><canvas></canvas><span class="wtxt"><span class="wname">${sh.name}</span><small>${sh.rating} · ${String(sh.weight).replace('.', ',')} kg</small></span></button>`;
    }).join('');
    return `<div class="wcat"><div class="wcat-name">${WEAPON_CATS.sh}</div><div class="wcards">${cards}</div></div>`;
  }

  weaponGroup(cat, keys, slot) {
    if (!keys.some(k => WEAPONS[k].cat === cat)) return '';
    const cards = keys.filter(k => WEAPONS[k].cat === cat).map(k => {
      const w = WEAPONS[k];
      return `<button class="wcard" data-slot="${slot}" data-key="${k}" title="${w.name} · ${w.caliber}"><canvas></canvas><span class="wtxt"><span class="wname">${w.name}</span><small>${w.caliber}</small></span></button>`;
    }).join('');
    return `<div class="wcat"><div class="wcat-name">${WEAPON_CATS[cat]}</div><div class="wcards">${cards}</div></div>`;
  }

  // L'arme telle qu'on l'emporte : avec les accessoires choisis pour elle (ceux qu'elle accepte).
  loadoutDef(key) {
    return fittedDef(key, accOf(this.game.loadout, key));
  }

  // Cartes (sélection, et dessin qui montre les accessoires), boutons d'accessoires et fiches de ce
  // qu'on emporte. Les fiches gardent la même disposition d'une arme à l'autre : on compare d'un coup d'œil.
  refreshLoadout() {
    const g = this.game, l = g.loadout;
    this.panel.querySelectorAll('.wcard').forEach(b => {
      const k = b.dataset.key, slot = b.dataset.slot;
      b.classList.toggle('sel', slot === 'shield' ? l.shield === k : slot === 'primary' ? !l.shield && l.primary === k : l[slot] === k);
      if (slot === 'shield') UI.drawShield(b.querySelector('canvas'), SHIELDS[k], CARD_SCALE);
      else UI.drawWeapon(b.querySelector('canvas'), this.loadoutDef(k), CARD_SCALE);
    });
    this.panel.querySelectorAll('.vestbtn').forEach(b => b.classList.toggle('sel', b.dataset.vest === l.vest));
    this.panel.querySelectorAll('.nadebtn').forEach(b => b.classList.toggle('sel', b.dataset.nades === l.nades));
    const sum = this.panel.querySelector('#wsum');
    if (sum) sum.innerHTML = this.gearSummary();
    const sh = SHIELDS[l.shield];
    this.$('waccs').innerHTML = (sh ? this.accRow(null, sh.name) : this.accRow(l.primary)) + this.accRow(l.sidearm);
    this.$('waccs').querySelectorAll('.accbtn').forEach(b => {
      b.onclick = () => { const k = b.dataset.key, a = b.dataset.acc; g.setAccessory(k, a, !accOf(g.loadout, k)[a]); this.refreshLoadout(); };
    });
    this.$('wdetail').innerHTML = (sh ? this.shieldDetail(sh) : this.weaponDetail(this.loadoutDef(l.primary), l.primary, 'Arme principale'))
      + this.weaponDetail(this.loadoutDef(l.sidearm), l.sidearm, 'Arme de poing');
    this.$('wdetail').querySelectorAll('.wd-text').forEach(t => {
      const fade = () => t.classList.toggle('more', t.scrollTop + t.clientHeight < t.scrollHeight - 2);
      t.onscroll = fade; fade();
    });
  }

  // Accessoires d'une arme : un bouton par accessoire, grisé si l'arme n'en accepte pas (ou pas dans ce mode : le
  // matériel des trinômes, voir SQUAD_KIT), son effet sur cette arme en bulle d'aide. Sans clé (un bouclier), la
  // ligne reste là, boutons grisés.
  accRow(key, label) {
    const m = MODES[this.game.mode], a = key ? accOf(this.game.loadout, key) : {}, w = key && WEAPONS[key];
    const tip = name => { const t = UI.accEffect(key, name); return t[0].toUpperCase() + t.slice(1); };
    const btn = (name, txt, why) => {
      const fits = accFits(key, name, m);
      const off = !w ? 'Pas d\'accessoire sur un bouclier'
        : ACC_TABLES[name][key] ? 'En trinômes et en guerre totale seulement : le groupe armé qui tient un bâtiment n\'a pas ce matériel' : why;
      return `<button class="accbtn${fits && a[name] ? ' sel' : ''}" data-key="${key}" data-acc="${name}" title="${fits ? tip(name) : off}"${fits ? '' : ' disabled'}>${UI.icon(name)}<span>${txt}</span></button>`;
    };
    const supWhy = w && w.kind === 'shotgun' ? 'Pas de silencieux sur un fusil à pompe' : 'Pas de silencieux pour cette arme';
    const gripWhy = w && w.cat === 'hg' ? 'Pas de poignée avant sur une arme de poing' : key === 'mp7' ? 'Le MP7 a déjà sa poignée avant, repliable' : 'Pas de rail sous le garde-main';
    const scopeWhy = w && w.cat === 'hg' ? 'Pas de lunette sur une arme de poing' : w && w.kind === 'shotgun' ? 'Pas de lunette sur un fusil à pompe : la gerbe ne porte pas assez loin'
      : key === 'mp7' ? 'Le MP7 garde son point rouge : trop court pour une lunette' : 'Pas de rail pour fixer une lunette';
    return `<div class="accrow"><span class="accname">${w ? w.name : label}</span><div class="accbtns">${btn('sup', 'Silencieux', supWhy)}${btn('laser', 'Laser', 'Pas de rail pour fixer un laser')}${btn('light', 'Lampe', 'Pas de rail pour fixer une lampe')}${btn('grip', 'Poignée', gripWhy)}${btn('mag', 'Chargeur', 'Pas de chargeur grande capacité pour cette arme')}${btn('scope', 'Lunette', scopeWhy)}</div></div>`;
  }

  // Effet des accessoires montés, en clair dans la fiche.
  accNotes(key) {
    const m = MODES[this.game.mode], a = accOf(this.game.loadout, key);
    const notes = [['sup', 'Silencieux'], ['laser', 'Laser'], ['light', 'Lampe'], ['grip', 'Poignée avant'], ['mag', 'Chargeur grande capacité'], ['scope', 'Lunette']]
      .filter(([name]) => accFits(key, name, m) && a[name]).map(([name, label]) => `<b>${UI.icon(name)} ${label}</b> : ${UI.accEffect(key, name)}`);
    return notes.length ? `<p class="wd-acc">${notes.join('<br>')}</p>` : '';
  }

  // Ce qu'un accessoire change sur une arme donnée. Le silencieux dépend de la munition : une balle
  // supersonique ne perd rien mais claque encore, une munition subsonique de remplacement est plus faible.
  static accEffect(key, name) {
    const w = WEAPONS[key], num = v => String(v).replace('.', ',');
    if (name === 'grip') {
      return `la main avant tient l'arme : ${Math.round((1 - GRIP.bloom) * 100)} % d'ouverture en moins à chaque tir en rafale, ${Math.round((1 - GRIP.recoil) * 100)} % de recul en moins. Rien de changé au premier coup. +${num(GRIPS[key])} kg.`;
    }
    if (name === 'mag') {
      const m = MAGS[key], what = m.drum ? `tambour de ${m.mag} coups` : m.tube ? `rallonge de tube : ${m.mag} cartouches au lieu de ${w.mag}` : `${m.mag} coups au lieu de ${w.mag}`;
      const rl = m.reload > 1 ? `, rechargement ${Math.round((m.reload - 1) * 100)} % plus long` : '';
      return `${what}. On recharge moins souvent, pas avec plus de munitions en tout. Plus lourd (+${num(m.weight)} kg)${rl}.`;
    }
    if (name === 'scope') {
      const pct = v => Math.round((v - 1) * 100);
      return `${SCOPES[key].name}, à l'arrêt seulement : l'arme épaulée, il faut ${num(SCOPE.settle)} s pour poser l'œil. Elle porte la vue ${pct(SCOPE.sight)} % plus loin dans l'axe, divise par deux la dispersion de base, allonge de ${pct(SCOPE.reach)} % la portée efficace. La vue glisse vers le point visé sans le lâcher : on peut pousser le viseur plus loin, même pris au bord de l'écran. Le moindre pas la fait quitter l'œil. +${num(SCOPES[key].weight)} kg.`;
    }
    if (name === 'light') {
      return "éclaire un cône devant l'arme. Inutile si le bâtiment est éclairé ; courant coupé, c'est elle qui fait voir loin. Prise en face de près, elle éblouit un suspect, qui met plus de temps à viser. Mais elle se voit de loin dans le noir. X l'éteint ou la rallume (celles de l'équipe avec).";
    }
    if (name === 'laser') {
      return "dispersion en mouvement divisée par deux (la gêne du bouclier aussi), rien de gagné à l'arrêt, arme épaulée. Mais le faisceau se voit : un adversaire qui l'aperçoit se tourne vers vous, puis vient voir.";
    }
    const s = SUPPRESSORS[key], cases = String(s.noise).replace('.', ','), kg = `Plus lourd (+${String(s.weight).replace('.', ',')} kg) et plus long.`;
    const pct = m => `−${Math.round((1 - m) * 100)} %`; // insécable : « −15 % » ne se coupe pas
    if (s.subsonic === 'load') return `munition subsonique (${SUBSONIC.mps} m/s au lieu de ${w.mps}), presque muette (${cases} cases), mais ${pct(SUBSONIC.damage)} de dégâts et ${pct(SUBSONIC.effRange)} de portée efficace. ${kg}`;
    if (s.subsonic === 'native') return `le ${w.caliber} est subsonique d'origine : presque muet (${cases} cases) sans rien perdre. ${kg}`;
    return `la balle reste supersonique : ni puissance ni portée perdues, mais son claquement s'entend encore à ${cases} cases. ${kg}`;
  }

  // Fiche : en-tête d'une ligne, barres et données côte à côte sur un nombre fixe de lignes, puis le
  // texte, qui défile seul s'il déborde. Rien ne bouge quand on change d'arme.
  static fiche(name, sub, slot, bars, specs, text) {
    return `<div class="wd">
      <div class="wd-head"><b>${name}</b>${sub ? ` <small>${sub}</small>` : ''}<span class="wd-slot">${slot}</span></div>
      <div class="wd-grid">
        <div class="wd-bars">${bars.map(([k, v]) => `<span>${k}</span><div class="bar"><div style="width:${Math.round(v * 100)}%"></div></div>`).join('')}</div>
        <dl class="wd-specs">${specs.map(([k, v]) => `<dt>${k}</dt><dd title="${v}">${v}</dd>`).join('')}</dl>
      </div>
      <div class="wd-text">${text}</div>
    </div>`;
  }

  shieldDetail(sh) {
    const n = (v, a, b) => clamp((v - a) / (b - a), 0.05, 1);
    const bars = [
      ['Protection', sh.stops / 3],
      ['Mobilité', n(sh.mobility, 0.6, 1)],
      ['Précision', n(1 / sh.aim, 0.5, 1)],
      ['Champ de vision', n(sh.fov, 60 * DEG, 120 * DEG)],
    ];
    const specs = [
      ['Niveau', sh.rating],
      ['Taille', sh.size],
      ['Poids', String(sh.weight).replace('.', ',') + ' kg'],
      ['Arrête', sh.stops >= 3 ? 'tout, fusils compris' : 'pas les fusils'],
      ['Vision', Math.round(sh.fov / DEG) + '°'],
      ['Chargeurs', `+${SHIELD_EXTRA_MAGS} de poing`],
      ['Arme', 'de poing, à une main'],
      ['Couvre', "l'avant seulement"],
    ];
    const stops = sh.stops >= 3 ? 'armes de poing, pistolets mitrailleurs, chevrotine et fusils' : 'armes de poing, pistolets mitrailleurs (pas le 4,6 mm) et chevrotine';
    return UI.fiche(sh.name, '', 'À la place de l\'arme principale', bars, specs,
      `<p>${sh.note} Arrête : ${stops}. Il ne couvre que l'avant : de flanc ou de dos, on est à découvert. L'arme de poing se tient d'une main, moins précise ; pas d'arme d'épaule, et on ne ramasse qu'une arme de poing.</p>`);
  }

  weaponDetail(w, key, slot) {
    const n = (v, a, b) => clamp((v - a) / (b - a), 0.05, 1);
    const bars = [
      ['Puissance', Math.sqrt(w.damage * (w.pellets || 1) / 135)],
      ['Cadence', n(w.rof, 0, 16)],
      // la lunette, à l'arrêt : dispersion de base réduite et portée efficace allongée
      ['Précision', n(12 * DEG - (2 * (w.spread * (w.scope ? SCOPE.spread : 1) + (w.pattern || 0)) + w.bloom), 0, 12 * DEG)],
      // ce que le laser améliore : la visée sans épauler
      ['En mouvement', n(6 * DEG - w.moveSpread * (w.laser ? LASER_MOVE : 1), 0, 6 * DEG)],
      ['Portée', n(w.effRange * (w.scope ? SCOPE.reach : 1), 0, 12 * U)],
      // une arme légère pèse moins dans la charge, donc ralentit moins (voir loadMobility)
      ['Mobilité', n(5.5 - w.weight, 0, 4.7)],
      ['Discrétion', n(12 - w.noise, 0, 10)],
    ];
    const specs = [
      ['Calibre', w.caliber],
      ['Capacité', w.reloadType === 'shell' ? `${w.mag} cartouches` : `${w.mag} coups`],
      ['Cadence', `${w.mode.toLowerCase()}, ${w.rpm}/min`],
      [w.pellets ? 'Plombs' : 'Balle', `${w.mps} m/s`],
      ['Poids', w.weight.toFixed(1).replace('.', ',') + ' kg'],
      ['Dégâts', w.pellets ? `${w.pellets} × ${w.damage}` : w.damage],
      ['Porte', `${Math.round((w.pierce === undefined ? 0.4 : w.pierce) * 100)} % traverse`],
      ['Bruit', `${String(w.noise).replace('.', ',')} cases${w.suppressed ? ' (silencieux)' : ''}`],
    ];
    return UI.fiche(w.name, w.name.startsWith(w.maker) ? '' : w.maker, slot, bars, specs, this.accNotes(key) + `<p>${w.note}</p>`);
  }

  // Plaquette claire des cartes d'équipement : une arme vue de dessus est presque noire, il lui faut
  // un fond contrasté. Renvoie le contexte, à l'échelle de l'écran.
  static cardPlate(canvas, W, H) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#7a8189'); g.addColorStop(1, '#5c636b');
    roundRect(ctx, 1, 1, W - 2, H - 2, 4);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    return ctx;
  }

  // Bouclier vu de face, couché sur la plaquette comme lâché au sol en jeu.
  static drawShield(canvas, sh, k = 1) {
    const W = Math.round(170 * k), H = Math.round(50 * k), ctx = UI.cardPlate(canvas, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.scale(2.7 * k, 2.7 * k);
    Sprites.shieldFlat(ctx, sh.look);
  }

  // Arme vue de dessus, même dessin qu'en jeu et même échelle pour toutes (proportions réelles) : la
  // plus longue, le SCAR-H avec son silencieux, tient tout juste sur la plaquette.
  static drawWeapon(canvas, w, k = 1) {
    const W = Math.round(170 * k), H = Math.round(50 * k), sc = 3.45 * k, ctx = UI.cardPlate(canvas, W, H);
    const x0 = { pistol: 8.2, pdw: -2.8, smg: -5.4 }[w.kind] ?? -6.6;
    const x1 = 13 + w.gunLen;
    // un chargeur long (ou un tambour) descend plus bas : on remonte un peu l'arme pour qu'il tienne
    const up = !w.tint || !w.tint.extMag || w.kind === 'pistol' || w.kind === 'shotgun' ? 0 : w.tint.extMag === 'drum' ? 4.5 * k : 3 * k;
    ctx.translate((W - (x1 - x0) * sc) / 2 - x0 * sc, H / 2 - 4 * k - up);
    ctx.scale(sc, sc * GUN_THICK);
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 1.2; ctx.shadowOffsetY = 0.8;
    Sprites.gun(ctx, w.kind, w.gunLen, w.tint);
  }

  // Deuxième écran : la carte, parmi celles du mode (chacun a les siennes). Un clic la charge et ouvre l'équipement.
  // back : écran à rouvrir avec « Retour » (le briefing, la pause, la fin de partie) ; « ◀ Modes » ramène au premier.
  showLevels(back) {
    const g = this.game, M = MODES[g.mode];
    g.paused = true;
    const siege = g.mode === 'siege', escort = g.mode === 'escort', war = !!M.war, squads = !!M.squads && !war;
    let html = `<h1>${M.name} — choisissez la carte</h1>${UI.steps(2, M.name)}<p>${siege
      ? `Objectif : repousser les ${SIEGE_WAVES.length} vagues d'assaut avec vos otages vivants et entre vos mains.`
      : escort ? "Objectif : conduire le VIP vivant du point A au point B, à travers les pièces tenues par le commando. Inutile de neutraliser tout le monde."
      : war ? `Objectif : abattre plus d'adversaires que l'armée d'en face en ${Math.round(WAR_TIME / 60)} minutes. Chaque trinôme anéanti revient de sa base.`
      : squads ? "Objectif : deux trinômes contre deux, l'intervention contre le groupe armé. Le premier camp entièrement hors de combat a perdu."
      : "Objectif : neutraliser tous les suspects, sans perdre toute l'équipe ni tuer d'otage. Escorter les otages dehors, par une porte extérieure ou une fenêtre, les met à l'abri en attendant."}</p>
      <p class="planlegend"><i class="lg-door"></i> porte <i class="lg-win"></i> fenêtre ${escort ? '<i class="lg-a"></i> départ (A) <i class="lg-b"></i> extraction (B)'
        : war ? '<i class="lg-base"></i> base d\'une armée' : "<i class=\"lg-entry\"></i> ouverture sur l'extérieur"}</p>`;
    html += '<div class="levels">';
    g.levels.forEach((l, i) => {
      const txt = l.map.join('');
      const n = txt.split('').filter(c => 'E^v<>'.includes(c)).length;
      const h = txt.split('').filter(c => c === 'H').length;
      // en plein air, on arrive par les entrées du terrain (O) ; ailleurs, par les portes extérieures et les fenêtres
      const ent = txt.split('').filter(c => (l.outdoor ? 'O' : 'XW').includes(c)).length;
      const what = war ? '2 bases · 3 trinômes contre 3' : squads ? `${ent} ouvertures · 2 trinômes contre 2`
        : `${siege ? ent + ' entrées à surveiller' : n + ' suspects'} · ${escort ? 'VIP à conduire de A à B' : h + ' otages'}`;
      html += `<button class="levelbtn${i === g.levelIndex ? ' sel' : ''}" data-i="${i}"><canvas></canvas>
        <span class="lname">${i + 1}. ${l.name}${war ? ' <em>· champ de bataille</em>' : l.outdoor ? ' <em>· plein air</em>' : ''}</span><small>${what}</small></button>`;
    });
    html += `</div><div class="row"><button id="ovToModes">◀ Modes</button>${back ? '<button id="ovClose">Retour</button>' : ''}</div>`;
    this.showOverlay(html);
    this.panel.classList.add('wide');
    this.panel.querySelectorAll('.levelbtn').forEach(b => {
      UI.drawPlan(b.querySelector('canvas'), g.levels[+b.dataset.i]);
      b.onclick = () => { g.loadLevel(+b.dataset.i); this.showBriefing(); };
    });
    // (le fil et le bouton du bas ramènent tous deux aux modes)
    for (const b of this.panel.querySelectorAll('#ovModes, #ovToModes')) b.onclick = () => this.showModes(back);
    const close = this.panel.querySelector('#ovClose');
    if (close) close.onclick = back;
  }

  // Aperçu d'une mission : le plan de la minimap, portes fermées comprises, et ses ouvertures sur
  // l'extérieur soulignées. Les postes des suspects et des otages sont tirés au sort : on ne les montre pas.
  // opts (briefing) : map (déjà construite), s (pixels par case), sel (l'ouverture d'entrée, pleine,
  // flèche vers l'intérieur), hover (survolée, cerclée de blanc), threat (siège : ouvertures en rouge).
  // Une carte d'escorte montre son itinéraire (points A et B) au lieu de ses ouvertures, qui n'y servent pas.
  static drawPlan(canvas, def, opts = {}) {
    const m = opts.map || new GameMap(def), s = opts.s || 3, dpr = window.devicePixelRatio || 1;
    const pad = (opts.pad || 0) * s; // marge en cases : les anneaux des ouvertures ne sont pas coupés au bord
    canvas.width = (m.w * s + 2 * pad) * dpr; canvas.height = (m.h * s + 2 * pad) * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.translate(pad, pad);
    Renderer.paintPlan(ctx, m, s, true);
    if (m.bases.length) {
      // guerre totale : les deux bases, la vôtre (sel) en bleu et l'autre en rouge, ou toutes deux en orange tant que
      // le sort décide ; celle qu'on survole, cernée de blanc
      const chosen = opts.sel !== null && opts.sel !== undefined;
      m.bases.forEach((b, i) => {
        ctx.fillStyle = !chosen ? 'rgba(255,179,71,0.9)' : i === opts.sel ? 'rgba(100,181,246,0.9)' : 'rgba(239,106,90,0.9)';
        for (const c of b.cells) ctx.fillRect(c.x * s, c.y * s, s, s);
        if (i !== opts.hover) return;
        const xs = b.cells.map(c => c.x), ys = b.cells.map(c => c.y);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.strokeRect(Math.min(...xs) * s - 1.5, Math.min(...ys) * s - 1.5, (Math.max(...xs) - Math.min(...xs) + 1) * s + 3, (Math.max(...ys) - Math.min(...ys) + 1) * s + 3);
      });
      return;
    }
    if (m.vipStart && m.goal) {
      const mark = (x, y, txt, col) => {
        const r = Math.max(5, 2.2 * s);
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#0b0d10'; ctx.font = `bold ${Math.round(r * 1.35)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x, y + 0.5);
      };
      mark((m.vipStart.x + 0.5) * s, (m.vipStart.y + 0.5) * s, 'A', '#64b5f6');
      mark(m.goal.cx / TILE * s, m.goal.cy / TILE * s, 'B', '#6fcf7a');
      return;
    }
    const col = opts.threat ? '#ef6a5a' : '#ffb347', r = 1.5 * s;
    ctx.lineWidth = 1.5;
    m.breaches.forEach((b, i) => {
      const x = (b.cx / TILE) * s, y = (b.cy / TILE) * s;
      ctx.strokeStyle = i === opts.hover ? '#fff' : col;
      ctx.beginPath(); ctx.arc(x, y, i === opts.hover ? r + 1.5 : r, 0, TAU); ctx.stroke();
      if (i !== opts.sel) return;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      // flèche : l'équipe entre par là
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle), L = 4 * s;
      const tx = x + ca * (r + L), ty = y + sa * (r + L);
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + ca * (r + 1), y + sa * (r + 1)); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tx + ca * 2, ty + sa * 2);
      ctx.lineTo(tx - ca * 4 - sa * 4, ty - sa * 4 + ca * 4);
      ctx.lineTo(tx - ca * 4 + sa * 4, ty - sa * 4 - ca * 4);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1.5;
    });
  }

  showPause() {
    const g = this.game;
    this.showOverlay(`<h1>Pause</h1><p>${g.war ? this.warBriefing() : g.squads ? this.squadsBriefing() : g.def.briefing}</p>
      <div class="row"><button class="primary" id="ovResume">Reprendre</button><button id="ovRestart">↺ Recommencer</button><button id="ovLevels">Cartes</button><button id="ovModes">Modes</button><button id="ovHelp">Aide</button></div>`);
    this.panel.querySelector('#ovResume').onclick = () => g.setPaused(false);
    this.panel.querySelector('#ovRestart').onclick = () => { g.restart(); this.showBriefing(); };
    this.panel.querySelector('#ovLevels').onclick = () => this.showLevels(() => this.showPause());
    this.panel.querySelector('#ovModes').onclick = () => this.showModes(() => this.showPause());
    this.panel.querySelector('#ovHelp').onclick = () => this.showHelp();
  }

  showEnd(result) {
    const g = this.game, s = g.stats;
    const win = result === 'win', draw = result === 'draw';
    const siege = !!g.siege, escort = !!g.escort, war = !!g.war, squads = !!g.squads && !war, armed = g.camp === 'armed';
    const W = g.war, tally = W ? `${W.kills.ops} adversaires abattus contre ${W.kills.enemy}` : '';
    const title = siege ? (win ? 'Assaut repoussé' : 'Bâtiment repris') : escort ? (win ? 'VIP exfiltré' : 'Mission échouée')
      : war ? (win ? 'Bataille remportée' : draw ? 'Égalité' : 'Bataille perdue')
      : squads ? (win ? 'Engagement remporté' : 'Engagement perdu') : (win ? 'Mission accomplie' : 'Mission échouée');
    const intro = war ? (win ? `Votre armée l'emporte : ${tally}.` : draw ? `Personne ne l'emporte : ${tally}.` : g.loseReason)
      : win
      ? (siege ? 'Toutes les vagues sont repoussées : les négociations aboutissent.'
        : escort ? (g.vip.hp < g.vip.maxHp ? 'Le VIP est arrivé au point B, blessé mais vivant.' : 'Le VIP est arrivé sain et sauf au point B.')
        : squads ? `Les deux trinômes ${armed ? "d'intervention" : 'du groupe armé'} sont hors de combat.`
        : 'Tous les suspects sont neutralisés, et les otages sont saufs.')
      : g.loseReason;
    const out = g.hostages.filter(h => h.evacuated).length;
    // la note est calculée à la fin de la partie ; un écran ouvert autrement la calcule sur place
    const sc = g.score || g.scoreReport(result), rec = g.record;
    const best = rec ? (rec.beaten ? (rec.prev === null ? 'Première note sur cette mission' : `Nouveau record (avant : ${rec.prev})`) : `Record : ${rec.prev}`) : '';
    const pts = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
    const html = `<h1 class="${win ? 'win' : draw ? 'draw' : 'lose'}">${title}</h1>
      <p>${intro}</p>
      <div class="score"><div class="grade grade-${sc.grade}" id="endGrade">${sc.grade}</div>
        <div class="score-sum"><b id="endScore">${sc.total} / 100</b>${best ? `<small>${best}</small>` : ''}</div>
        <div class="score-lines">${sc.lines.map(l => `<span>${l.label}</span><span class="sd">${l.detail}</span><b class="${l.pts < 0 ? 'neg' : ''}">${pts(l.pts)}</b>`).join('')}</div></div>
      <div class="stats">
        <span>Temps</span><b>${fmtTime(g.time)}</b>
        <span>${siege ? 'Opérateurs neutralisés' : war ? 'Abattus par votre armée / par vous' : squads ? 'Adversaires neutralisés' : 'Suspects abattus / arrêtés'}</span><b id="endKills">${war ? `${W.kills.ops} / ${W.mine}` : siege || squads ? `${s.kills} / ${g.enemies.length}` : `${s.kills} / ${s.arrests}`}</b>
        <span>Tirs / touchés</span><b>${s.shots} / ${s.hits}</b>
        <span>Précision</span><b>${s.shots ? Math.round(100 * s.hits / s.shots) : 0} %</b>
        <span>${armed || g.loadout.nades !== 'flash' ? 'Grenades utilisées' : 'Flashs utilisées'}</span><b>${s.flashes}</b>
        <span>${war ? 'Pertes de votre armée' : armed ? 'Terroristes perdus' : 'Opérateurs perdus'}</span><b>${war ? W.kills.enemy : `${g.ops.filter(o => !o.alive).length} / ${g.squadSize}`}</b>
        ${war ? `<span>Votre trinôme revenu de la base</span><b>${W.reinforce} fois</b>`
          : squads ? '' : escort ? `<span>Santé du VIP</span><b id="endVip">${g.vip.alive ? Math.round(100 * g.vip.hp / g.vip.maxHp) + ' %' : 'tué'}</b>`
          : `<span>Otages tués</span><b id="endHostagesKilled">${g.hostages.filter(h => !h.alive).length} / ${g.hostages.length}</b>
        <span>${siege ? "Otages évacués par l'intervention" : 'Otages évacués'}</span><b id="endHostagesOut">${out} / ${g.hostages.length}</b>`}
      </div>
      <div class="row">
        <button id="ovRetry">↺ Rejouer</button>
        ${win && g.levelIndex + 1 < g.levels.length ? '<button class="primary" id="ovNext">Carte suivante ▶</button>' : ''}
        <button id="ovLevels">Cartes</button>
        <button id="ovModes">Modes</button>
      </div>`;
    this.showOverlay(html);
    this.panel.querySelector('#ovRetry').onclick = () => { g.restart(); this.showBriefing(); };
    const nx = this.panel.querySelector('#ovNext');
    if (nx) nx.onclick = () => { g.loadLevel(g.levelIndex + 1); this.showBriefing(); };
    this.panel.querySelector('#ovLevels').onclick = () => this.showLevels(() => this.showEnd(result));
    this.panel.querySelector('#ovModes').onclick = () => this.showModes(() => this.showEnd(result));
  }

  // back : écran à rouvrir en fermant l'aide (le briefing) ; sinon la pause, ou le jeu.
  showHelp(back) {
    this.showOverlay(`<h1>Comment jouer</h1>
      <p>Vous contrôlez un seul opérateur en temps réel. Les ennemis ne sont visibles que dans votre champ de vision ; les portes fermées bloquent la vue dans les deux sens.</p>
      <p><b>Déplacement</b> : <kbd>ZQSD</kbd> / <kbd>WASD</kbd> / flèches. <kbd>A</kbd> (ou <kbd>Maj</kbd>) bascule entre course et marche : en marchant on est lent mais précis.<br>
      <b>Précision</b> : le viseur montre la zone réelle où les balles peuvent tomber. Elle grandit avec la distance, en courant, et à chaque tir (recul) ; au-delà de la portée efficace de l'arme elle s'ouvre encore. Tirez par courtes rafales et laissez le viseur se resserrer.<br>
      <b>Tir</b> : clic gauche (maintenu pour les armes automatiques). <kbd>R</kbd> ou clic molette recharge, <kbd>Alt</kbd> (ou <kbd>1</kbd>/<kbd>2</kbd>) change d'arme.<br>
      <b>Gestes</b> : manœuvrer une porte ou lancer une grenade occupe les deux mains. Le geste dure un instant (l'anneau du viseur montre où il en est), pendant lequel on ne tire pas et on avance au ralenti, et la visée reste perturbée juste après : ne le faites pas nez à nez avec un suspect. Les coéquipiers et les suspects sont soumis aux mêmes délais.<br>
      <b>Portes</b> : <kbd>E</kbd> ouvre en grand la porte la plus proche, ou la ferme si elle est ouverte. La molette agit par crans : fermée, entrebâillée, entrouverte, ouverte ; vers le bas, l'inverse. Une porte qui n'est pas grande ouverte ne laisse ni passer ni voir autrement que par l'entrebâillement : le battant arrête le regard, et vous ne découvrez qu'un mince cône de la pièce (le vôtre comme celui des ennemis s'élargit avec le cran). Entrebâiller est silencieux et plus rapide qu'ouvrir en grand, puisque le battant a moins de chemin à faire ; comptez un second geste pour entrer. On ne peut pas fermer une porte si quelqu'un se trouve dans l'embrasure.<br>
      <b>Portes verrouillées</b> : en assaut, certaines portes sont fermées à clé. <kbd>E</kbd> (ou la molette) sur l'une d'elles lance le crochetage : quatre secondes, presque sans bruit, arme basse ; la porte est alors déverrouillée et c'est à vous de l'ouvrir comme vous voulez. Une serrure rouge marque celles qu'on a essayées. Plus vite : la chevrotine dans la serrure, ou une charge. Les suspects, eux, ont les clés.<br>
      <b>Charge de brèche</b> : deux par mission. <kbd>B</kbd> devant une porte fermée pose une charge sur le battant, de votre côté ; <kbd>B</kbd> à nouveau la fait sauter, où que vous soyez. La porte vole en éclats (elle ne se referme plus) ; derrière, tout ce qui se tient près de l'embrasure est sonné quelques secondes, et blessé tout contre — un otage aussi : regardez d'abord à la fibre. De votre côté, écartez-vous. Si quelqu'un ouvre la porte avant, la charge tombe.<br>
      <b>Fibre optique</b> : devant une porte fermée ou entrouverte, maintenez <kbd>F</kbd> pour glisser une fibre sous le battant : vous découvrez un large cône de la pièce voisine, suspects compris, sans ouvrir ni faire de bruit. La mise en place demande un geste ; tant que vous observez, vous ne tirez pas et vous ne pouvez pas bouger — le moindre pas retire la fibre.<br>
      <b>Flash</b> : <kbd>Espace</kbd> (ou <kbd>G</kbd>) lance une grenade aveuglante vers le curseur : la distance au curseur règle la force du lancer. Elle vole par-dessus le mobilier (tables, plantes, caisses...), retombe, puis roule et rebondit sur les murs, les meubles et les portes fermées, et explose au bout d'environ 1,7 s. Attention aux retours contre un mur proche. Collé à une porte entrouverte, visez l'embrasure pour glisser la grenade par l'entrebâillement ; de plus loin, elle rebondit sur le battant. Les ennemis aveuglés ne tirent plus pendant quelques secondes. Ne regardez pas l'explosion.<br>
      <b>Grenades à emporter</b> : au briefing, l'intervention choisit son lot : trois flashs, deux flashs et une grenade à fragmentation, ou deux grenades à fragmentation. La fragmentation se lance pareil et éclate au bout de 2 s : elle tue dans un rayon de trois cases et demie, vous, les vôtres et les otages compris ; un mur ou une porte fermée arrête l'éclat. <kbd>N</kbd> passe d'une sorte à l'autre (le HUD montre celle en main, et ce qui reste de l'autre) ; la dernière d'une sorte lancée, l'autre passe en main. Bravo et Charlie gardent leurs flashs pour l'entrée à la flash, et une colonne n'entre pas tant que votre grenade n'a pas éclaté.<br>
      <b>À travers les portes</b> : un battant n'est pas un abri. Les balles le traversent en perdant de l'énergie (un tiers pour du 7,62, les quatre cinquièmes pour de la chevrotine) et en déviant un peu. Vous pouvez arroser une porte fermée — et un suspect peut faire de même. Les murs, eux, arrêtent tout.<br>
      <b>Balles</b> : elles partent à leur vitesse réelle (de 260 à 900 m/s) et traversent une pièce en une image : qui tire juste le premier touche le premier. Celle qui manque sa cible continue sa course jusqu'au premier obstacle, par une porte ouverte jusque dans la pièce voisine : pensez à ce qu'il y a derrière. La chevrotine part en gerbe serrée : à quelques mètres, toute la charge arrive où vous visez.<br>
      <b>Relais et armes au sol</b> : si vous tombez, vous reprenez la main dans le coéquipier debout le plus proche ; la mission n'est perdue que quand toute l'équipe est à terre. Près d'un corps, <kbd>V</kbd> ramasse son arme et laisse au sol la vôtre de même catégorie (vous pouvez la reprendre).<br>
      <b>Bruit</b> : coups de feu, portes, impacts, grenades, cris et pas de course s'entendent à une certaine distance, qui fond à travers les murs et les portes fermées (le son contourne les angles par les portes ouvertes). Marcher (<kbd>A</kbd>) est silencieux ; courir s'entend à deux ou trois cases. Un suspect qui entend quelque chose se tourne vers le bruit et s'inquiète ; un bruit fort (tir, cri, explosion) ou des bruits qui se répètent le font venir voir — deux au plus à la fois, les autres guettent de ce côté —, puis il regagne son poste. Un « ? » au-dessus de lui le signale. Celui qui vous repère crie l'alerte, celui qui découvre le corps d'un des siens aussi.<br>
      <b>Rondes et alerte générale</b> : en assaut, deux suspects ne tiennent pas un poste mais font une ronde, au pas, entre deux ou trois points, avec une pause à chacun : observez avant d'entrer. Un suspect qui vous a vu et reste debout trois secondes prévient tout le bâtiment (un « ! » rouge, dont l'anneau se remplit, le signale) : tous les autres réagissent alors plus vite et les plus proches viennent voir. Abattez-le, arrêtez-le ou aveuglez-le avant (sonné, le temps ne compte pas). L'alerte générale coûte cinq points à la note de fin. Autour de vous, des arcs montrent la direction et la force de ce que vous entendez hors de vue : rouge pour un tir, jaune pour une porte, gris pour des pas ou une grenade qui rebondit, orange pour un cri, blanc pour une explosion. Après chacun de vos propres bruits, un halo montre jusqu'où il a porté.<br>
      <b>Sommation et arrestation</b> : <kbd>C</kbd> crie « Police ! À terre ! ». Chaque suspect que vous voyez à portée de voix peut se rendre : il lâche son arme et se met à genoux, mains sur la tête. Il cède plus facilement aveuglé par une flash, blessé, pris de dos ou tenu en joue par plusieurs d'entre vous ; bien moins en plein échange de tirs ou avec un complice à côté. Approchez-vous et <kbd>H</kbd> le menotte. Un suspect rendu que plus personne ne surveille finit par reprendre son arme. Il compte comme neutralisé une fois menotté. Le cri s'entend : les autres viennent voir. Abattre un suspect rendu coûte cher dans la note de fin.<br>
      <b>Note de fin</b> : chaque mission est notée sur 100, de S à D : otages en vie et évacués, suspects arrêtés plutôt qu'abattus, équipe indemne ; un suspect abattu après sa reddition, une balle dans un coéquipier ou l'alerte générale retirent des points. Votre meilleure note par mission est gardée.<br>
      <b>Courant coupé et lampe</b> : au briefing, vous pouvez couper le courant avant d'entrer. Dans le noir, on ne voit qu'à quatre cases, vous comme les suspects, sauf ce qu'éclaire une lampe, et un tireur sans silencieux se trahit un instant par sa flamme. La <b>lampe</b> (accessoire, sur toute arme à rail) éclaire un cône loin devant vous et éblouit un suspect pris en face de près, mais dans le noir elle se voit de loin. <kbd>X</kbd> l'éteint ou la rallume ; Bravo et Charlie, équipés d'une lampe quand le courant est coupé, font comme vous.<br>
      <b>Accessoires</b> : au briefing, arme par arme. Le <b>silencieux</b> : un tir ne s'entend plus qu'à 2 à 5 cases selon le calibre, au lieu de 13 à 18, mais l'arme est plus lourde et plus longue, et l'impact d'une balle manquée s'entend toujours ; la ligne « Équipe » en munit aussi Bravo et Charlie, et montre l'arme que chacun a reçue. Le <b>laser</b> : le point montre où part la balle, ce qui divise par deux la dispersion en mouvement ; mais le faisceau se voit, et un suspect qui aperçoit le trait ou le point se tourne vers vous, puis vient voir. <kbd>L</kbd> l'éteint ou le rallume ; il s'éteint de lui-même pendant un geste ou un rechargement. La <b>poignée avant</b> (HK416, SCAR-H, MP5) : la rafale s'ouvre d'un quart de moins et l'arme relève moins. La <b>lunette</b> (HK416, SCAR-H, MP5, AKM, AK-74) ne sert qu'à l'arrêt : immobile, l'œil posé (quatre dixièmes de seconde), on voit 60 % plus loin dans l'axe de l'arme, la dispersion de base est divisée par deux, la portée efficace allongée de moitié, et la vue glisse vers le point visé sans le lâcher, ce qui laisse pousser le viseur plus loin, même depuis le bord de l'écran ; au moindre pas, il ne reste que son poids. Le <b>chargeur grande capacité</b> (40 coups pour le HK416, 33 pour le Glock, rallonge de tube pour le Remington ; en siège, tambour de 75 pour l'AKM, 45 pour l'AK-74, 40 pour l'Uzi) : on recharge moins souvent, mais pas avec plus de cartouches en tout, l'arme est plus lourde et le rechargement un peu plus long.<br>
      <b>Bilan</b> : au briefing, en haut des caractéristiques, la charge emportée, la vitesse (toutes vos armes pèsent, en main ou à la bretelle, accessoires compris, puis le gilet et le bouclier) et, avec un gilet ou un bouclier, la part des dégâts qu'une balle vous fait selon l'arme qui tire et le côté d'où elle vient.<br>
      <b>Gilet</b> : au briefing, en assaut et en escorte, les deux côte à côte, celui que vous portez en surbrillance ; en jeu, il est rappelé à côté de la santé. Le <b>souple</b> (NIJ IIIA, la référence) arrête tout autour du torse les balles d'arme de poing, de pistolet mitrailleur en 9 mm et la chevrotine : il n'en reste que le choc, la moitié des dégâts. Une balle de fusil le traverse. Le <b>lourd</b> y ajoute des plaques devant et derrière qui arrêtent même une balle de fusil (il n'en reste qu'un tiers), mais pas de flanc ; onze kilos, on avance nettement moins vite.<br>
      <b>Bouclier</b> : à choisir au briefing à la place de l'arme principale. Tenu au bras gauche, il ne laisse que l'arme de poing, tirée d'une main par-dessus le bord, donc moins précise (un laser compense en partie), avec deux chargeurs de plus. De face, il arrête les balles de son niveau : le léger (NIJ IIIA) celles d'arme de poing, de pistolet mitrailleur et la chevrotine, mais pas celles d'un fusil (une balle d'AK le traverse) ; le lourd (NIJ III) arrête tout, mais il ralentit nettement et sa lucarne rétrécit le champ de vision. De flanc et de dos, on est à découvert. Bouclier au bras, on ne ramasse qu'une arme de poing.<br>
      <b>Minimap</b> : en haut à droite, le plan de ce que vous avez exploré, avec les portes, les fenêtres, le mobilier, votre équipe, les otages connus et les adversaires visibles. En siège, la pièce où une vague d'assaut vient d'entrer y clignote en rouge quelques secondes. <kbd>M</kbd> la replie.<br>
      <b>Otages</b> : ne tirez pas dessus, y compris à travers une porte. Un otage n'est sauvé qu'une fois sorti du bâtiment : près de lui, <kbd>H</kbd> le relève et il vous suit, en file s'ils sont plusieurs ; <kbd>H</kbd> à nouveau, il attend à genoux. Il n'ouvre pas les portes lui-même (laissez-les au moins entrouvertes derrière vous) et se jette à terre quand on tire près de lui. Amenez-le devant une porte extérieure ouverte ou une fenêtre : il sort, et il est évacué. Pendant l'escorte, les sorties battent en vert sur la minimap. Les faire sortir n'est pas exigé, mais un otage dehors ne risque plus rien : la mission est accomplie dès que tous les suspects sont neutralisés, et perdue si un otage meurt.<br>
      <b>Équipe</b> : Bravo et Charlie vous suivent en formation et couvrent vos flancs et vos arrières. <kbd>T</kbd> leur fait tenir la position (ou reprendre le suivi), le clic droit les envoie sur un point (ils ouvrent les portes sur ce trajet), et un clic droit sur vous-même les rappelle en suivi. Un clic droit sur une <b>porte fermée</b> les met en colonne de part et d'autre de l'embrasure, de votre côté : dès que la porte s'ouvre (vous l'ouvrez, la charge la souffle, la chevrotine fait sauter la serrure), ils entrent chacun vers son angle de la pièce ; si une flash est dégoupillée ou en vol, ils attendent qu'elle éclate. Un <b>second clic droit</b> sur la même porte : entrée à la flash — celui qui a l'angle entrouvre, glisse une flash dans la pièce, puis ouvre en grand à l'éclair, et ils entrent (deux flashs chacun, comptées dans le HUD de l'équipe). En <b>maintenant</b> le clic droit puis en tirant vers une direction, vous ajoutez une consigne de couverture : celui des deux qui se place de ce côté gardera cet angle au lieu de choisir lui-même son point d'intérêt (jusqu'à l'ordre suivant ; un contact reste prioritaire). Ils tirent sur tout suspect visible, mais jamais à travers vous ou un otage : quand l'axe reste bouché, ils se décalent pour dégager l'angle (le HUD indique « Axe bouché »). Un ordre de déplacement reste prioritaire sur un contact : ils rompent et progressent en gardant le suspect en joue. Attention, vos propres balles peuvent les blesser.<br>
      <kbd>Échap</kbd> pause.</p>
      <p><b>Mode siège</b> : vous incarnez le chef du groupe armé. L'équipe d'intervention entre par l'entrée
      de la carte après un court temps de préparation, progresse secteur par secteur et converge sur le moindre coup
      de feu. Quand un opérateur trouve un otage, il le relève et l'emmène vers la sortie la plus proche : abattez
      l'escorte avant qu'elle n'y arrive, l'otage reste alors à genoux sur place (un autre viendra le chercher).
      Un otage évacué est perdu pour vous. Vos huit complices tiennent chacun leur poste et se battent seuls : personne ne commande personne, ni <kbd>T</kbd> ni le clic droit ne leur donnent d'ordres. Pas de fibre optique de ce côté, et deux grenades à fragmentation au lieu des flashs : elles tuent autour d'elles (vous et vos otages compris), mais une porte fermée ou un mur arrête l'éclat. Il y a ${SIEGE_WAVES.length} vagues : la
      suivante entre quelques secondes après l'élimination de la précédente, ou au bout de trente secondes si
      elle tient encore. Repoussez la dernière et vous avez gagné. Portes, fibre optique et
      tir à travers les battants sont vos meilleurs outils ; les otages sont votre protection, jamais une cible.</p>
      <p><b>Mode escorte</b> : sur ses propres cartes, vous menez Bravo et Charlie, et vous conduisez un VIP du point A,
      où vous le trouvez, jusqu'à la zone d'extraction, le point B (hachurée de vert au sol, elle bat sur la minimap).
      Le VIP vous suit dès le départ ; près de lui, <kbd>H</kbd> le fait attendre à couvert, <kbd>H</kbd> à nouveau il repart.
      Comme un otage, il n'ouvre pas les portes et se jette à terre quand on tire près de lui ; mais il porte un gilet
      souple et tient quelques balles, et à moitié de ses forces il boite. Le commando le cherche : un terroriste qui
      le voit le vise avant vous. Si vous tombez, il suit celui qui reprend la main. La mission est accomplie dès qu'il
      entre dans la zone B, vivant, quels que soient les terroristes encore debout ; elle échoue s'il meurt. La note
      récompense sa santé, l'équipe indemne et la discrétion (pas d'alerte générale), et punit chaque balle de l'équipe qui le touche.</p>
      <p><b>Mode trinômes</b> : sur ses propres cartes (des bâtiments symétriques, ouverts sur chaque façade), deux trinômes
      contre deux, l'intervention contre le groupe armé ; au briefing, vous
      choisissez votre camp et votre ouverture. Vous menez votre trinôme (vous et deux coéquipiers, avec les ordres
      habituels) ; le second trinôme de votre camp entre par l'ouverture la plus proche et progresse seul, et les deux
      d'en face entrent par les plus éloignées. Chaque trinôme autonome ratisse le bâtiment pièce par pièce (les deux d'en face
      se le partagent), converge sur ce qu'il voit ou entend en gardant le cap sur le plus proche, fouille là où il n'a
      rien trouvé, partage ses contacts et reste groupé ; ceux de l'intervention se mettent de temps en temps en
      colonne sur une porte et entrent porte ouverte, à la flash ou à la charge, ceux du groupe armé lancent leur grenade
      à fragmentation là où ils vous savent. Ni otage ni sommation. Si vous tombez, vous reprenez la main dans un
      coéquipier, puis, quand votre trinôme n'est plus, dans un homme de l'autre. Le premier camp entièrement hors de
      combat a perdu.</p>
      <p><b>Guerre totale</b> : sur des champs de bataille en plein air, deux armées de trois trinômes, l'intervention contre
      le groupe armé, dans le camp de votre choix. Au briefing, vous choisissez aussi votre base (ou le sort). Vous menez le
      trinôme du centre, avec les ordres habituels ; les deux autres de votre armée tiennent les flancs seuls, chacun son
      couloir, et ceux d'en face font de même. Un trinôme dont plus personne n'est debout revient de sa base
      ${WAR_RESPAWN} secondes plus tard : le vôtre aussi (si vous tombez, vous reprenez d'abord la main dans un coéquipier,
      puis vous repartez de la base avec un trinôme frais). La bataille dure ${Math.round(WAR_TIME / 60)} minutes (le chrono
      décompte) ; chaque homme abattu compte un point pour l'armée d'en face, et l'armée qui a le plus de points l'emporte,
      à égalité personne. Le champ de bataille est connu d'avance : la minimap le montre en entier, mais l'adversaire ne se
      voit que dans le champ de vision de votre armée.</p>
      <p><b>Pour commencer</b> : choisissez le mode, puis la carte (chaque mode a les siennes), puis l'équipement au briefing.
      Le fil en haut du briefing ramène au choix du mode ou de la carte ; en pause et en fin de partie, « Cartes » et
      « Modes » aussi.</p>
      <div class="row"><button class="primary" id="ovClose">Compris</button></div>`);
    this.panel.querySelector('#ovClose').onclick = back || (() => { if (this.game.paused) this.showPause(); else this.hideOverlay(); });
  }
}
