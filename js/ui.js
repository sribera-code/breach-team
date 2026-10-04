'use strict';
// HUD DOM + overlays (briefing, pause, fin de mission, missions, aide).
class UI {
  constructor(game) {
    this.game = game;
    this.$ = id => document.getElementById(id);
    this.overlay = this.$('overlay');
    this.panel = this.$('overlayPanel');
    game.on('level', () => { this.hideOverlay(); this.$('levelName').textContent = `Mission ${game.levelIndex + 1} — ${game.def.name}`; this.update(); });
    game.on('over', r => setTimeout(() => this.showEnd(r), 900));
    game.on('pause', () => { if (game.paused) this.showPause(); else this.hideOverlay(); });
  }

  update() {
    const g = this.game, p = g.player;
    this.$('timer').textContent = fmtTime(g.time);
    const alive = g.enemies.filter(e => e.alive).length;
    const held = g.hostages.filter(h => h.alive && !h.evacuated).length;
    if (g.siege) {
      const s = g.siege;
      this.$('objective').textContent = s.prep > 0
        ? `Préparation : ${fmtTime(Math.max(0, s.prep)).slice(0, 5)} — prenez position`
        : (alive ? `Vague ${s.wave} / ${s.waves.length} · Assaut : ${alive}`
          : s.wave < s.waves.length ? `Vague ${s.wave + 1} / ${s.waves.length} dans ${Math.ceil(Math.max(0, s.nextWave))} s`
          : `Vague ${s.wave} / ${s.waves.length} repoussée`) + ` · Otages : ${held}`;
    } else {
      const out = g.hostages.filter(h => h.evacuated).length;
      this.$('objective').textContent = `Suspects : ${alive} / ${g.enemies.length} · Otages évacués : ${out} / ${g.hostages.length}`;
    }
    const fill = this.$('hpFill');
    fill.style.width = (100 * p.hp / p.maxHp) + '%';
    fill.style.background = p.hp > 60 ? '#4caf50' : p.hp > 30 ? '#ffb300' : '#ef5350';
    this.$('flashCount').textContent = p.flashbangs;
    const nl = this.$('nadeLabel');
    if (nl) nl.textContent = p.nade === 'frag' ? 'Grenades' : 'Flash';
    // aide du bas d'écran : pas de fibre et des grenades à fragmentation côté groupe armé
    const rh = this.$('reloadHint');
    if (rh) {
      if (this._reloadHint === undefined) this._reloadHint = rh.textContent;
      const txt = g.siege ? this._reloadHint.replace(' · F (maintenu) : fibre sous la porte', '').replace('Espace : flash', 'Espace : grenade').replace(' · H : emmener / laisser un otage', '') : this._reloadHint;
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
    if (this._weaponShown !== w || this._shieldShown !== p.shield) {
      this._weaponShown = w; this._shieldShown = p.shield;
      const tags = [w.caliber, w.mode, w.suppressed && 'silencieux', w.laser && 'laser', p.shield && p.shield.name.toLowerCase()].filter(Boolean);
      this.$('weaponName').innerHTML = `${w.name} <small>${tags.join(' · ')}</small>`;
    }
    const ammo = this.$('ammo');
    // Chargement cartouche par cartouche : le compteur reste visible et monte.
    this.$('ammoMag').textContent = p.reloadT > 0 && w.reloadType !== 'shell' ? '⟳' : s.mag;
    this.$('ammoReserve').textContent = s.reserve;
    ammo.classList.toggle('low', s.mag <= Math.ceil(w.mag * 0.2));
    this.$('message').textContent = g.message.t > 0 ? g.message.text : '';
  }

  updateSquad() {
    const g = this.game, box = this.$('squad');
    if (!this._squadFor || this._squadFor !== g.mates) {
      this._squadFor = g.mates;
      box.classList.toggle('many', g.mates.length > 4);
      // en siège, pas d'ordres : l'aide sur les commandes d'équipe n'a pas lieu d'être
      const hint = this.$('squadHint');
      if (hint) {
        if (!this._squadHint) this._squadHint = hint.textContent;
        hint.textContent = g.siege ? "Vos complices tiennent leur poste : vous ne leur donnez pas d'ordres" : this._squadHint;
      }
      box.innerHTML = g.mates.map(m => `<div class="mate"><span class="mname" style="color:${m.accent}">${m.name}</span><div class="mhp"><div></div></div><span class="morder"></span></div>`).join('');
    }
    const orders = { follow: 'Suit', hold: g.siege ? 'Au poste' : 'Tient', move: 'Se déplace' };
    box.querySelectorAll('.mate').forEach((el, i) => {
      const m = g.mates[i];
      el.classList.toggle('down', !m.alive);
      const bar = el.querySelector('.mhp div');
      bar.style.width = (100 * m.hp / m.maxHp) + '%';
      bar.style.background = m.hp > 60 ? '#4caf50' : m.hp > 30 ? '#ffb300' : '#ef5350';
      let s = !m.alive ? 'À terre' : m.stun > 0 ? 'Aveuglé' : m.act ? 'Ouvre la porte' : m.target ? (m.blockedLine ? 'Axe bouché' : 'Au contact') : m.reloadT > 0 ? 'Recharge'
        : m.coverAngle !== null ? (m.order === 'move' ? 'Se déplace ▸ couvre' : 'Couvre') : orders[m.order];
      el.querySelector('.morder').textContent = s;
    });
  }

  showOverlay(html) { this.panel.classList.remove('wide'); this.panel.innerHTML = html; this.overlay.classList.remove('hidden'); }
  hideOverlay() { this.overlay.classList.add('hidden'); }
  isOpen() { return !this.overlay.classList.contains('hidden'); }

  // Texte d'ambiance du mode siège (le briefing des missions est écrit côté intervention).
  siegeBriefing() {
    return `Vous tenez le bâtiment avec vos hommes et vos otages. Une équipe d'intervention va donner
      l'assaut par les portes et les fenêtres. Vos complices tiennent chacun leur poste et vous ne leur
      donnez pas d'ordres. Fermez ou entrebâillez les portes, choisissez votre poste, puis repoussez les ${SIEGE_WAVES.length} vagues, le
      temps que les négociations aboutissent. Les otages sont votre seule protection : s'il ne vous en reste plus un seul de vivant, tout est perdu.`;
  }

  showBriefing() {
    const g = this.game;
    g.paused = true;
    const siege = g.mode === 'siege';
    this.showOverlay(`<h1>Mission ${g.levelIndex + 1} — ${g.def.name}</h1>
      <div class="modes">${Object.keys(MODES).map(m => `<button class="modebtn${m === g.mode ? ' sel' : ''}" data-mode="${m}">${m === 'siege' ? '☠ Siège — vous tenez le bâtiment' : '🛡 Assaut — vous menez l\'intervention'}</button>`).join('')}</div>
      <p>${siege ? (g.def.siegeBriefing || this.siegeBriefing()) : g.def.briefing}</p>
      ${siege ? '' : this.entryPicker()}
      <p><small><kbd>ZQSD</kbd>/<kbd>WASD</kbd> se déplacer · <kbd>A</kbd> marche/course · souris viser · <kbd>clic</kbd> tirer · <kbd>R</kbd> / clic molette recharger · <kbd>E</kbd> ouvrir/fermer une porte · molette haut/bas ouvrir/fermer par étapes · <kbd>Alt</kbd> changer d'arme · <kbd>L</kbd> allumer/éteindre le laser · ${siege ? '<kbd>Espace</kbd> grenade à fragmentation · ' : '<kbd>Espace</kbd> flash · <kbd>F</kbd> fibre sous la porte · <kbd>H</kbd> emmener un otage / le faire attendre · '}<kbd>V</kbd> ramasser une arme · <kbd>M</kbd> minimap · ${siege ? '' : "<kbd>T</kbd> équipe suivre/tenir · clic droit envoyer l'équipe (maintenir et tirer : direction à couvrir ; sur vous : suivre) · "}<kbd>Échap</kbd> pause</small></p>
      <h2>Équipement</h2>
      <div class="loadout">
        ${['ar', 'smg', 'sg'].map(c => this.weaponGroup(c, MODES[g.mode].primaries, 'primary')).join('')}
        ${this.shieldGroup(MODES[g.mode].shields)}
        ${this.weaponGroup('hg', MODES[g.mode].sidearms, 'sidearm')}
      </div>
      <div id="wdetail"></div>
      <p class="accnote"><small>Accessoires, arme par arme. <b>Silencieux</b> : un coup de feu ne s'entend plus qu'à 2 à 5 cases au lieu de 13 à 18 ; l'arme s'alourdit et s'allonge. Il ne freine pas la balle : une balle de fusil ne perd rien mais claque encore, et le 9 mm ne se tait qu'avec une munition subsonique, plus faible (le .45 l'est d'origine). <b>Laser</b> : en mouvement, la dispersion est divisée par deux (la gêne du bouclier aussi), mais le faisceau se voit — un adversaire qui l'aperçoit se tourne vers vous, puis vient voir. <kbd>L</kbd> l'éteint en jeu.</small></p>
      ${siege ? '' : `<div class="suprow"><button class="supbtn${g.loadout.teamSup ? ' sel' : ''}" id="ovSup">${g.loadout.teamSup ? '🔇 Coéquipiers au silencieux' : '🔊 Coéquipiers sans silencieux'}</button>
        <small>Bravo et Charlie montent un silencieux : chacun reçoit alors une arme qui en accepte un (pas de fusil à pompe).</small></div>`}
      <div class="row"><button class="primary" id="ovGo">${siege ? 'Prendre position' : "Lancer l'assaut"}</button><button id="ovLevels">Missions</button></div>`);
    this.panel.classList.add('wide');
    this.panel.querySelectorAll('.modebtn').forEach(b => {
      b.onclick = () => { g.setMode(b.dataset.mode); this.showBriefing(); };
    });
    this.panel.querySelectorAll('.entrybtn').forEach(b => {
      b.onclick = () => { g.setEntry(b.dataset.entry === 'random' ? null : +b.dataset.entry); this.showBriefing(); };
    });
    const sup = this.panel.querySelector('#ovSup');
    if (sup) sup.onclick = () => { g.setLoadout({ teamSup: !g.loadout.teamSup }); this.showBriefing(); };
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
  }

  // Point d'entrée : l'équipe choisit par où elle pénètre dans le bâtiment.
  entryPicker() {
    const g = this.game, bs = g.map.breaches;
    if (bs.length < 2) return '';
    // « Au hasard » ne dit pas ce qui est sorti : on le découvre sur place
    const hasard = `<button class="entrybtn${g.entryRandom ? ' sel' : ''}" data-entry="random">Au hasard</button>`;
    const btns = bs.map((b, i) =>
      `<button class="entrybtn${!g.entryRandom && i === g.entryIndex ? ' sel' : ''}" data-entry="${i}">${g.map.breachLabel(b)}</button>`).join('');
    return `<h2>Point d'entrée</h2><div class="entries">${hasard}${btns}</div>`;
  }

  // ---- Équipement ----
  shieldGroup(keys) {
    if (!keys || !keys.length) return '';
    const cards = keys.map(k => {
      const sh = SHIELDS[k];
      return `<button class="wcard" data-slot="shield" data-key="${k}"><canvas></canvas><span class="wname">${sh.name}</span><small>${sh.rating} · ${String(sh.weight).replace('.', ',')} kg</small></button>`;
    }).join('');
    return `<div class="wcat"><div class="wcat-name">${WEAPON_CATS.sh}</div><div class="wcards">${cards}</div></div>`;
  }

  weaponGroup(cat, keys, slot) {
    if (!keys.some(k => WEAPONS[k].cat === cat)) return '';
    const cards = keys.filter(k => WEAPONS[k].cat === cat).map(k => {
      const w = WEAPONS[k];
      return `<button class="wcard" data-slot="${slot}" data-key="${k}"><canvas></canvas><span class="wname">${w.name}</span><small>${w.caliber}</small></button>`;
    }).join('');
    return `<div class="wcat"><div class="wcat-name">${WEAPON_CATS[cat]}</div><div class="wcards">${cards}</div></div>`;
  }

  // L'arme telle qu'on l'emporte : avec les accessoires choisis pour elle (ceux qu'elle accepte).
  loadoutDef(key) {
    return fittedDef(key, accOf(this.game.loadout, key));
  }

  // Cartes (sélection, et dessin qui montre les accessoires) et fiches de ce qu'on emporte.
  refreshLoadout() {
    const g = this.game, l = g.loadout;
    this.panel.querySelectorAll('.wcard').forEach(b => {
      const k = b.dataset.key, slot = b.dataset.slot;
      b.classList.toggle('sel', slot === 'shield' ? l.shield === k : slot === 'primary' ? !l.shield && l.primary === k : l[slot] === k);
      if (slot === 'shield') UI.drawShield(b.querySelector('canvas'), SHIELDS[k]);
      else UI.drawWeapon(b.querySelector('canvas'), this.loadoutDef(k));
    });
    const sh = SHIELDS[l.shield];
    this.$('wdetail').innerHTML = (sh ? this.shieldDetail(sh) : this.weaponDetail(this.loadoutDef(l.primary), l.primary))
      + this.weaponDetail(this.loadoutDef(l.sidearm), l.sidearm);
    this.$('wdetail').querySelectorAll('.accbtn').forEach(b => {
      b.onclick = () => { const k = b.dataset.key, a = b.dataset.acc; g.setAccessory(k, a, !accOf(g.loadout, k)[a]); this.refreshLoadout(); };
    });
  }

  // Accessoires d'une arme : un bouton par accessoire, grisé si l'arme n'en accepte pas ; son effet sur
  // cette arme en bulle d'aide, et en clair sous les boutons une fois monté.
  accRow(key) {
    const a = accOf(this.game.loadout, key), w = WEAPONS[key];
    const tip = name => { const t = UI.accEffect(key, name); return t[0].toUpperCase() + t.slice(1); };
    const btn = (name, label, fits, why) => `<button class="accbtn${fits && a[name] ? ' sel' : ''}" data-key="${key}" data-acc="${name}" title="${fits ? tip(name) : why}"${fits ? '' : ' disabled'}>${fits && a[name] ? '✓' : '+'} ${label}</button>`;
    const fitted = [['sup', 'Silencieux', SUPPRESSORS[key]], ['laser', 'Laser', LASERS[key]]].filter(([name, , fits]) => fits && a[name]);
    const notes = fitted.map(([name, label]) => `<b>${label}</b> : ${UI.accEffect(key, name)}`).join('<br>');
    return `<div class="accrow">${btn('sup', 'Silencieux', !!SUPPRESSORS[key], w.kind === 'shotgun' ? 'Pas de silencieux sur un fusil à pompe' : 'Pas de silencieux pour cette arme')}${btn('laser', 'Laser', !!LASERS[key], 'Pas de rail pour fixer un laser')}</div>${notes ? `<p class="wd-acc">${notes}</p>` : ''}`;
  }

  // Ce qu'un accessoire change sur une arme donnée. Le silencieux dépend de la munition : une balle
  // supersonique ne perd rien mais claque encore, une munition subsonique de remplacement est plus faible.
  static accEffect(key, name) {
    const w = WEAPONS[key];
    if (name === 'laser') {
      return "dispersion en mouvement divisée par deux (la gêne du bouclier aussi), rien de gagné à l'arrêt, arme épaulée. Mais le faisceau se voit : un adversaire qui l'aperçoit se tourne vers vous, puis vient voir.";
    }
    const s = SUPPRESSORS[key], cases = String(s.noise).replace('.', ','), kg = `Plus lourd (+${String(s.weight).replace('.', ',')} kg) et plus long.`;
    const pct = m => `−${Math.round((1 - m) * 100)} %`; // insécable : « −15 % » ne se coupe pas
    if (s.subsonic === 'load') return `munition subsonique, presque muette (${cases} cases), mais ${pct(SUBSONIC.damage)} de dégâts, ${pct(SUBSONIC.effRange)} de portée efficace et ${pct(SUBSONIC.range)} de portée. ${kg}`;
    if (s.subsonic === 'native') return `le ${w.caliber} est subsonique d'origine : presque muet (${cases} cases) sans rien perdre. ${kg}`;
    return `la balle reste supersonique : ni puissance ni portée perdues, mais son claquement s'entend encore à ${cases} cases. ${kg}`;
  }

  shieldDetail(sh) {
    const n = (v, a, b) => clamp((v - a) / (b - a), 0.05, 1);
    const bars = [
      ['Protection', sh.stops / 3],
      ['Mobilité', n(sh.mobility, 0.6, 1)],
      ['Précision', n(1 / sh.aim, 0.5, 1)],
      ['Champ de vision', n(sh.fov, 60 * DEG, 120 * DEG)],
    ];
    const stops = sh.stops >= 3 ? 'armes de poing, pistolets mitrailleurs, chevrotine et fusils' : 'armes de poing, pistolets mitrailleurs (pas le 4,6 mm) et chevrotine';
    return `<div class="wd">
      <div class="wd-head"><b>${sh.name}</b> <small>${sh.rating}</small></div>
      <div class="wd-specs">${sh.size} · ${String(sh.weight).replace('.', ',')} kg · arrête : ${stops} · champ de vision ${Math.round(sh.fov / DEG)}° · ${SHIELD_EXTRA_MAGS} chargeurs de poing en plus</div>
      <p>${sh.note} Il ne couvre que l'avant : de flanc ou de dos, on est à découvert. L'arme de poing se tient d'une main, moins précise ; pas d'arme d'épaule, et on ne ramasse qu'une arme de poing.</p>
      <div class="wd-bars">${bars.map(([k, v]) => `<span>${k}</span><div class="bar"><div style="width:${Math.round(v * 100)}%"></div></div>`).join('')}</div>
    </div>`;
  }

  weaponDetail(w, key) {
    const n = (v, a, b) => clamp((v - a) / (b - a), 0.05, 1);
    const bars = [
      ['Puissance', Math.sqrt(w.damage * (w.pellets || 1) / 135)],
      ['Cadence', n(w.rof, 0, 16)],
      ['Précision', n(12 * DEG - (2 * w.spread + w.bloom), 0, 12 * DEG)],
      // ce que le laser améliore : la visée sans épauler
      ['En mouvement', n(6 * DEG - w.moveSpread * (w.laser ? LASER_MOVE : 1), 0, 6 * DEG)],
      ['Portée', n(w.effRange, 0, 12 * U)],
      ['Mobilité', n(w.mobility, 0.85, 1.04)],
      ['Discrétion', n(12 - w.noise, 0, 10)],
    ];
    const kg = w.weight.toFixed(1).replace('.', ',');
    const cap = w.reloadType === 'shell' ? `${w.mag} cartouches (tube)` : `${w.mag} coups`;
    const dmg = w.pellets ? `${w.pellets} × ${w.damage}` : w.damage;
    const pierce = Math.round((w.pierce === undefined ? 0.4 : w.pierce) * 100);
    return `<div class="wd">
      <div class="wd-head"><b>${w.name}</b> ${w.name.startsWith(w.maker) ? '' : `<small>${w.maker}</small>`}</div>
      <div class="wd-specs">${w.caliber} · ${cap} · ${w.mode === 'Pompe' ? 'pompe' : w.rpm + ' cps/min'} · ${w.mode} · ${kg} kg · dégâts ${dmg} · à travers une porte ${pierce} % · ${w.suppressed ? 'silencieux : ' : ''}s'entend à ${String(w.noise).replace('.', ',')} cases</div>
      <p>${w.note}</p>
      ${this.accRow(key)}
      <div class="wd-bars">${bars.map(([k, v]) => `<span>${k}</span><div class="bar"><div style="width:${Math.round(v * 100)}%"></div></div>`).join('')}</div>
    </div>`;
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
  static drawShield(canvas, sh) {
    const W = 170, H = 50, ctx = UI.cardPlate(canvas, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.scale(2.7, 2.7);
    Sprites.shieldFlat(ctx, sh.look);
  }

  // Arme vue de dessus, même dessin qu'en jeu et même échelle pour toutes (proportions réelles) : la
  // plus longue, le SCAR-H avec son silencieux, tient tout juste sur la plaquette.
  static drawWeapon(canvas, w) {
    const W = 170, H = 50, sc = 3.45, ctx = UI.cardPlate(canvas, W, H);
    const x0 = { pistol: 8.2, pdw: -2.8, smg: -5.4 }[w.kind] ?? -6.6;
    const x1 = 13 + w.gunLen;
    ctx.translate((W - (x1 - x0) * sc) / 2 - x0 * sc, H / 2 - 4);
    ctx.scale(sc, sc * GUN_THICK);
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 1.2; ctx.shadowOffsetY = 0.8;
    Sprites.gun(ctx, w.kind, w.gunLen, w.tint);
  }

  showLevels(back) {
    const g = this.game;
    const ret = back || (() => this.showBriefing());
    let html = `<h1>Missions</h1><p>${g.mode === 'siege'
      ? `Objectif : repousser les ${SIEGE_WAVES.length} vagues d'assaut avec vos otages vivants et entre vos mains.`
      : "Objectif : neutraliser tous les suspects, sans perdre toute l'équipe ni tuer d'otage. Escorter les otages dehors, par une porte extérieure ou une fenêtre, les met à l'abri en attendant."}</p>
      <p class="planlegend"><i class="lg-door"></i> porte <i class="lg-win"></i> fenêtre <i class="lg-entry"></i> ouverture sur l'extérieur</p>`;
    const siege = g.mode === 'siege';
    html += '<div class="levels">';
    LEVELS.forEach((l, i) => {
      const txt = l.map.join('');
      const n = txt.split('').filter(c => 'E^v<>'.includes(c)).length;
      const h = txt.split('').filter(c => c === 'H').length;
      const ent = txt.split('').filter(c => 'XW'.includes(c)).length;
      html += `<button class="levelbtn${i === g.levelIndex ? ' sel' : ''}" data-i="${i}"><canvas></canvas>
        <span class="lname">${i + 1}. ${l.name}</span><small>${siege ? ent + ' entrées à surveiller' : n + ' suspects'} · ${h} otages</small></button>`;
    });
    html += `</div><div class="row"><button id="ovClose">Retour</button></div>`;
    this.showOverlay(html);
    this.panel.classList.add('wide');
    this.panel.querySelectorAll('.levelbtn').forEach(b => {
      UI.drawPlan(b.querySelector('canvas'), LEVELS[+b.dataset.i]);
      b.onclick = () => { g.loadLevel(+b.dataset.i); this.showBriefing(); };
    });
    this.panel.querySelector('#ovClose').onclick = ret;
  }

  // Aperçu d'une mission : le plan de la minimap, portes fermées comprises, et ses ouvertures sur
  // l'extérieur soulignées. Les postes des suspects et des otages sont tirés au sort : on ne les montre pas.
  static drawPlan(canvas, def) {
    const m = new GameMap(def), s = 3, dpr = window.devicePixelRatio || 1;
    canvas.width = m.w * s * dpr; canvas.height = m.h * s * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    Renderer.paintPlan(ctx, m, s, true);
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 1.5;
    for (const b of m.breaches) {
      ctx.beginPath(); ctx.arc((b.cx / TILE) * s, (b.cy / TILE) * s, 4.5, 0, TAU); ctx.stroke();
    }
  }

  showPause() {
    const g = this.game;
    this.showOverlay(`<h1>Pause</h1><p>${g.def.briefing}</p>
      <div class="row"><button class="primary" id="ovResume">Reprendre</button><button id="ovRestart">↺ Recommencer</button><button id="ovLevels">Missions</button><button id="ovHelp">Aide</button></div>`);
    this.panel.querySelector('#ovResume').onclick = () => g.setPaused(false);
    this.panel.querySelector('#ovRestart').onclick = () => { g.restart(); this.showBriefing(); };
    this.panel.querySelector('#ovLevels').onclick = () => this.showLevels(() => this.showPause());
    this.panel.querySelector('#ovHelp').onclick = () => this.showHelp();
  }

  showEnd(result) {
    const g = this.game, s = g.stats;
    const win = result === 'win';
    const siege = !!g.siege;
    const title = siege ? (win ? 'Assaut repoussé' : 'Bâtiment repris') : (win ? 'Mission accomplie' : 'Mission échouée');
    const intro = win
      ? (siege ? 'Toutes les vagues sont repoussées : les négociations aboutissent.' : 'Tous les suspects sont neutralisés, et les otages sont saufs.')
      : g.loseReason;
    const out = g.hostages.filter(h => h.evacuated).length;
    const html = `<h1 class="${win ? 'win' : 'lose'}">${title}</h1>
      <p>${intro}</p>
      <div class="stats">
        <span>Temps</span><b>${fmtTime(g.time)}</b>
        <span>${siege ? 'Opérateurs neutralisés' : 'Suspects neutralisés'}</span><b>${s.kills} / ${g.enemies.length}</b>
        <span>Tirs / touchés</span><b>${s.shots} / ${s.hits}</b>
        <span>Précision</span><b>${s.shots ? Math.round(100 * s.hits / s.shots) : 0} %</b>
        <span>${siege ? 'Grenades utilisées' : 'Flashs utilisées'}</span><b>${s.flashes}</b>
        <span>${siege ? 'Terroristes perdus' : 'Opérateurs perdus'}</span><b>${g.ops.filter(o => !o.alive).length} / ${g.squadSize}</b>
        <span>Otages tués</span><b id="endHostagesKilled">${g.hostages.filter(h => !h.alive).length} / ${g.hostages.length}</b>
        <span>${siege ? "Otages évacués par l'intervention" : 'Otages évacués'}</span><b id="endHostagesOut">${out} / ${g.hostages.length}</b>
      </div>
      <div class="row">
        <button id="ovRetry">↺ Rejouer</button>
        ${win && g.levelIndex + 1 < LEVELS.length ? '<button class="primary" id="ovNext">Mission suivante ▶</button>' : ''}
        <button id="ovLevels">Missions</button>
      </div>`;
    this.showOverlay(html);
    this.panel.querySelector('#ovRetry').onclick = () => { g.restart(); this.showBriefing(); };
    const nx = this.panel.querySelector('#ovNext');
    if (nx) nx.onclick = () => { g.loadLevel(g.levelIndex + 1); this.showBriefing(); };
    this.panel.querySelector('#ovLevels').onclick = () => this.showLevels(() => this.showEnd(result));
  }

  showHelp() {
    this.showOverlay(`<h1>Comment jouer</h1>
      <p>Vous contrôlez un seul opérateur en temps réel. Les ennemis ne sont visibles que dans votre champ de vision ; les portes fermées bloquent la vue dans les deux sens.</p>
      <p><b>Déplacement</b> : <kbd>ZQSD</kbd> / <kbd>WASD</kbd> / flèches. <kbd>A</kbd> (ou <kbd>Maj</kbd>) bascule entre course et marche : en marchant on est lent mais précis.<br>
      <b>Précision</b> : le viseur montre la zone réelle où les balles peuvent tomber. Elle grandit avec la distance, en courant, et à chaque tir (recul) ; au-delà de la portée efficace de l'arme elle s'ouvre encore. Tirez par courtes rafales et laissez le viseur se resserrer.<br>
      <b>Tir</b> : clic gauche (maintenu pour les armes automatiques). <kbd>R</kbd> ou clic molette recharge, <kbd>Alt</kbd> (ou <kbd>1</kbd>/<kbd>2</kbd>) change d'arme.<br>
      <b>Gestes</b> : manœuvrer une porte ou lancer une flash occupe les deux mains. Le geste dure un instant (l'anneau du viseur montre où il en est), pendant lequel on ne tire pas et on avance au ralenti, et la visée reste perturbée juste après : ne le faites pas nez à nez avec un suspect. Les coéquipiers et les suspects sont soumis aux mêmes délais.<br>
      <b>Portes</b> : <kbd>E</kbd> ouvre en grand la porte la plus proche, ou la ferme si elle est ouverte. La molette agit par crans : fermée, entrebâillée, entrouverte, ouverte ; vers le bas, l'inverse. Une porte qui n'est pas grande ouverte ne laisse ni passer ni voir autrement que par l'entrebâillement : le battant arrête le regard, et vous ne découvrez qu'un mince cône de la pièce (le vôtre comme celui des ennemis s'élargit avec le cran). Entrebâiller est silencieux et plus rapide qu'ouvrir en grand, puisque le battant a moins de chemin à faire ; comptez un second geste pour entrer. On ne peut pas fermer une porte si quelqu'un se trouve dans l'embrasure.<br>
      <b>Fibre optique</b> : devant une porte fermée ou entrouverte, maintenez <kbd>F</kbd> pour glisser une fibre sous le battant : vous découvrez un large cône de la pièce voisine, suspects compris, sans ouvrir ni faire de bruit. La mise en place demande un geste ; tant que vous observez, vous ne tirez pas et vous ne pouvez pas bouger — le moindre pas retire la fibre.<br>
      <b>Flash</b> : <kbd>Espace</kbd> (ou <kbd>G</kbd>) lance une grenade aveuglante vers le curseur : la distance au curseur règle la force du lancer. Elle vole par-dessus le mobilier (tables, plantes, caisses...), retombe, puis roule et rebondit sur les murs, les meubles et les portes fermées, et explose au bout d'environ 1,7 s. Attention aux retours contre un mur proche. Collé à une porte entrouverte, visez l'embrasure pour glisser la grenade par l'entrebâillement ; de plus loin, elle rebondit sur le battant. Les ennemis aveuglés ne tirent plus pendant quelques secondes. Ne regardez pas l'explosion.<br>
      <b>À travers les portes</b> : un battant n'est pas un abri. Les balles le traversent en perdant de l'énergie (un tiers pour du 7,62, les quatre cinquièmes pour de la chevrotine) et en déviant un peu. Vous pouvez arroser une porte fermée — et un suspect peut faire de même. Les murs, eux, arrêtent tout.<br>
      <b>Relais et armes au sol</b> : si vous tombez, vous reprenez la main dans le coéquipier debout le plus proche ; la mission n'est perdue que quand toute l'équipe est à terre. Près d'un corps, <kbd>V</kbd> ramasse son arme et laisse au sol la vôtre de même catégorie (vous pouvez la reprendre).<br>
      <b>Bruit</b> : coups de feu, portes, impacts, grenades, cris et pas de course s'entendent à une certaine distance, qui fond à travers les murs et les portes fermées (le son contourne les angles par les portes ouvertes). Marcher (<kbd>A</kbd>) est silencieux ; courir s'entend à deux ou trois cases. Un suspect qui entend quelque chose se tourne vers le bruit et s'inquiète ; un bruit fort (tir, cri, explosion) ou des bruits qui se répètent le font venir voir — deux au plus à la fois, les autres guettent de ce côté —, puis il regagne son poste. Un « ? » au-dessus de lui le signale. Celui qui vous repère crie l'alerte, celui qui découvre le corps d'un des siens aussi. Autour de vous, des arcs montrent la direction et la force de ce que vous entendez hors de vue : rouge pour un tir, jaune pour une porte, gris pour des pas ou une grenade qui rebondit, orange pour un cri, blanc pour une explosion. Après chacun de vos propres bruits, un halo montre jusqu'où il a porté.<br>
      <b>Accessoires</b> : au briefing, arme par arme. Le <b>silencieux</b> : un tir ne s'entend plus qu'à 2 à 5 cases selon le calibre, au lieu de 13 à 18, mais l'arme est plus lourde et plus longue, et l'impact d'une balle manquée s'entend toujours ; un bouton à part en munit aussi Bravo et Charlie. Le <b>laser</b> : le point montre où part la balle, ce qui divise par deux la dispersion en mouvement ; mais le faisceau se voit, et un suspect qui aperçoit le trait ou le point se tourne vers vous, puis vient voir. <kbd>L</kbd> l'éteint ou le rallume ; il s'éteint de lui-même pendant un geste ou un rechargement.<br>
      <b>Bouclier</b> : à choisir au briefing à la place de l'arme principale. Tenu au bras gauche, il ne laisse que l'arme de poing, tirée d'une main par-dessus le bord, donc moins précise (un laser compense en partie), avec deux chargeurs de plus. De face, il arrête les balles de son niveau : le léger (NIJ IIIA) celles d'arme de poing, de pistolet mitrailleur et la chevrotine, mais pas celles d'un fusil (une balle d'AK le traverse) ; le lourd (NIJ III) arrête tout, mais il ralentit nettement et sa lucarne rétrécit le champ de vision. De flanc et de dos, on est à découvert. Bouclier au bras, on ne ramasse qu'une arme de poing.<br>
      <b>Minimap</b> : en haut à droite, le plan de ce que vous avez exploré, avec les portes, les fenêtres, le mobilier, votre équipe, les otages connus et les adversaires visibles. En siège, la pièce où une vague d'assaut vient d'entrer y clignote en rouge quelques secondes. <kbd>M</kbd> la replie.<br>
      <b>Otages</b> : ne tirez pas dessus, y compris à travers une porte. Un otage n'est sauvé qu'une fois sorti du bâtiment : près de lui, <kbd>H</kbd> le relève et il vous suit, en file s'ils sont plusieurs ; <kbd>H</kbd> à nouveau, il attend à genoux. Il n'ouvre pas les portes lui-même (laissez-les au moins entrouvertes derrière vous) et se jette à terre quand on tire près de lui. Amenez-le devant une porte extérieure ouverte ou une fenêtre : il sort, et il est évacué. Pendant l'escorte, les sorties battent en vert sur la minimap. Les faire sortir n'est pas exigé, mais un otage dehors ne risque plus rien : la mission est accomplie dès que tous les suspects sont neutralisés, et perdue si un otage meurt.<br>
      <b>Équipe</b> : Bravo et Charlie vous suivent en formation et couvrent vos flancs et vos arrières. <kbd>T</kbd> leur fait tenir la position (ou reprendre le suivi), le clic droit les envoie sur un point (ils ouvrent les portes sur ce trajet), et un clic droit sur vous-même les rappelle en suivi. En <b>maintenant</b> le clic droit puis en tirant vers une direction, vous ajoutez une consigne de couverture : celui des deux qui se place de ce côté gardera cet angle au lieu de choisir lui-même son point d'intérêt (jusqu'à l'ordre suivant ; un contact reste prioritaire). Ils tirent sur tout suspect visible, mais jamais à travers vous ou un otage : quand l'axe reste bouché, ils se décalent pour dégager l'angle (le HUD indique « Axe bouché »). Un ordre de déplacement reste prioritaire sur un contact : ils rompent et progressent en gardant le suspect en joue. Attention, vos propres balles peuvent les blesser.<br>
      <kbd>Échap</kbd> pause.</p>
      <p><b>Mode siège</b> : vous incarnez le chef du groupe armé. L'équipe d'intervention entre par l'entrée
      de la carte après un court temps de préparation, progresse secteur par secteur et converge sur le moindre coup
      de feu. Quand un opérateur trouve un otage, il le relève et l'emmène vers la sortie la plus proche : abattez
      l'escorte avant qu'elle n'y arrive, l'otage reste alors à genoux sur place (un autre viendra le chercher).
      Un otage évacué est perdu pour vous. Vos huit complices tiennent chacun leur poste et se battent seuls : personne ne commande personne, ni <kbd>T</kbd> ni le clic droit ne leur donnent d'ordres. Pas de fibre optique de ce côté, et deux grenades à fragmentation au lieu des flashs : elles tuent autour d'elles (vous et vos otages compris), mais une porte fermée ou un mur arrête l'éclat. Il y a ${SIEGE_WAVES.length} vagues : la
      suivante entre quelques secondes après l'élimination de la précédente, ou au bout de trente secondes si
      elle tient encore. Repoussez la dernière et vous avez gagné. Portes, fibre optique et
      tir à travers les battants sont vos meilleurs outils ; les otages sont votre protection, jamais une cible.</p>
      <div class="row"><button class="primary" id="ovClose">Compris</button></div>`);
    this.panel.querySelector('#ovClose').onclick = () => { if (this.game.paused) this.showPause(); else this.hideOverlay(); };
  }
}
