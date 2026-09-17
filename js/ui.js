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
    this.$('objective').textContent = `Suspects : ${alive} / ${g.enemies.length}`;
    const fill = this.$('hpFill');
    fill.style.width = (100 * p.hp / p.maxHp) + '%';
    fill.style.background = p.hp > 60 ? '#4caf50' : p.hp > 30 ? '#ffb300' : '#ef5350';
    this.$('flashCount').textContent = p.flashbangs;
    const mode = this.$('moveMode');
    mode.textContent = p.walkMode ? 'MARCHE' : 'COURSE';
    mode.classList.toggle('walk', p.walkMode);
    this.updateSquad();
    const s = p.slot, w = s.def;
    if (this._weaponShown !== w) {
      this._weaponShown = w;
      this.$('weaponName').innerHTML = `${w.name} <small>${w.caliber || ''}${w.mode ? ' · ' + w.mode : ''}</small>`;
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
      box.innerHTML = g.mates.map(m => `<div class="mate"><span class="mname" style="color:${m.accent}">${m.name}</span><div class="mhp"><div></div></div><span class="morder"></span></div>`).join('');
    }
    const orders = { follow: 'Suit', hold: 'Tient', move: 'Se déplace' };
    box.querySelectorAll('.mate').forEach((el, i) => {
      const m = g.mates[i];
      el.classList.toggle('down', !m.alive);
      const bar = el.querySelector('.mhp div');
      bar.style.width = (100 * m.hp / m.maxHp) + '%';
      bar.style.background = m.hp > 60 ? '#4caf50' : m.hp > 30 ? '#ffb300' : '#ef5350';
      let s = !m.alive ? 'À terre' : m.stun > 0 ? 'Aveuglé' : m.target ? (m.blockedLine ? 'Axe bouché' : 'Au contact') : m.reloadT > 0 ? 'Recharge'
        : m.coverAngle !== null ? (m.order === 'move' ? 'Se déplace ▸ couvre' : 'Couvre') : orders[m.order];
      el.querySelector('.morder').textContent = s;
    });
  }

  showOverlay(html) { this.panel.classList.remove('wide'); this.panel.innerHTML = html; this.overlay.classList.remove('hidden'); }
  hideOverlay() { this.overlay.classList.add('hidden'); }
  isOpen() { return !this.overlay.classList.contains('hidden'); }

  showBriefing() {
    const g = this.game;
    g.paused = true;
    this.showOverlay(`<h1>Mission ${g.levelIndex + 1} — ${g.def.name}</h1><p>${g.def.briefing}</p>
      <p><small><kbd>ZQSD</kbd>/<kbd>WASD</kbd> se déplacer · <kbd>A</kbd> marche/course · souris viser · <kbd>clic</kbd> tirer · <kbd>R</kbd> / clic molette recharger · <kbd>E</kbd> ouvrir/fermer une porte · molette haut/bas ouvrir/fermer par étapes · <kbd>Alt</kbd> changer d'arme · <kbd>Espace</kbd> flash · <kbd>T</kbd> équipe suivre/tenir · clic droit envoyer l'équipe (maintenir et tirer : direction à couvrir ; sur vous : suivre) · <kbd>Échap</kbd> pause</small></p>
      <h2>Équipement</h2>
      <div class="loadout">
        ${['ar', 'smg', 'sg'].map(c => this.weaponGroup(c, PRIMARY_WEAPONS, 'primary')).join('')}
        ${this.weaponGroup('hg', SIDEARMS, 'sidearm')}
      </div>
      <div id="wdetail"></div>
      <div class="row"><button class="primary" id="ovGo">Lancer l'assaut</button><button id="ovLevels">Missions</button></div>`);
    this.panel.classList.add('wide');
    this.panel.querySelectorAll('.wcard').forEach(b => {
      UI.drawWeapon(b.querySelector('canvas'), WEAPONS[b.dataset.key]);
      b.onclick = () => { g.setLoadout({ [b.dataset.slot]: b.dataset.key }); this.refreshLoadout(); };
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

  // ---- Équipement ----
  weaponGroup(cat, keys, slot) {
    const cards = keys.filter(k => WEAPONS[k].cat === cat).map(k => {
      const w = WEAPONS[k];
      return `<button class="wcard" data-slot="${slot}" data-key="${k}"><canvas></canvas><span class="wname">${w.name}</span><small>${w.caliber}</small></button>`;
    }).join('');
    return `<div class="wcat"><div class="wcat-name">${WEAPON_CATS[cat]}</div><div class="wcards">${cards}</div></div>`;
  }

  refreshLoadout() {
    const l = this.game.loadout;
    this.panel.querySelectorAll('.wcard').forEach(b => b.classList.toggle('sel', l[b.dataset.slot] === b.dataset.key));
    this.$('wdetail').innerHTML = this.weaponDetail(WEAPONS[l.primary]) + this.weaponDetail(WEAPONS[l.sidearm]);
  }

  weaponDetail(w) {
    const n = (v, a, b) => clamp((v - a) / (b - a), 0.05, 1);
    const bars = [
      ['Puissance', Math.sqrt(w.damage * (w.pellets || 1) / 135)],
      ['Cadence', n(w.rof, 0, 16)],
      ['Précision', n(12 * DEG - (2 * w.spread + w.bloom), 0, 12 * DEG)],
      ['Portée', n(w.effRange, 0, 12 * U)],
      ['Mobilité', n(w.mobility, 0.85, 1.04)],
    ];
    const kg = w.weight.toFixed(1).replace('.', ',');
    const cap = w.reloadType === 'shell' ? `${w.mag} cartouches (tube)` : `${w.mag} coups`;
    const dmg = w.pellets ? `${w.pellets} × ${w.damage}` : w.damage;
    return `<div class="wd">
      <div class="wd-head"><b>${w.name}</b> ${w.name.startsWith(w.maker) ? '' : `<small>${w.maker}</small>`}</div>
      <div class="wd-specs">${w.caliber} · ${cap} · ${w.mode === 'Pompe' ? 'pompe' : w.rpm + ' cps/min'} · ${w.mode} · ${kg} kg · dégâts ${dmg}</div>
      <p>${w.note}</p>
      <div class="wd-bars">${bars.map(([k, v]) => `<span>${k}</span><div class="bar"><div style="width:${Math.round(v * 100)}%"></div></div>`).join('')}</div>
    </div>`;
  }

  // Arme vue de dessus, même dessin qu'en jeu et même échelle pour toutes (proportions réelles).
  static drawWeapon(canvas, w) {
    const W = 170, H = 50, dpr = window.devicePixelRatio || 1, sc = 3.9;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    const x0 = { pistol: 8.2, pdw: -2.8, smg: -5.4 }[w.kind] ?? -6.6;
    const x1 = 13 + w.gunLen;
    ctx.scale(dpr, dpr);
    // Plaquette claire : une arme vue de dessus est presque noire, il lui faut un fond contrasté.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#7a8189'); g.addColorStop(1, '#5c636b');
    roundRect(ctx, 1, 1, W - 2, H - 2, 4);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.translate((W - (x1 - x0) * sc) / 2 - x0 * sc, H / 2 - 4);
    ctx.scale(sc, sc * GUN_THICK);
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 1.2; ctx.shadowOffsetY = 0.8;
    Sprites.gun(ctx, w.kind, w.gunLen, w.tint);
  }

  showLevels(back) {
    const g = this.game;
    const ret = back || (() => this.showBriefing());
    let html = `<h1>Missions</h1><p>Objectif : neutraliser tous les suspects sans perdre l'opérateur ni tuer d'otage.</p>`;
    LEVELS.forEach((l, i) => {
      const n = l.map.join('').split('').filter(c => 'E^v<>'.includes(c)).length;
      html += `<button class="levelbtn" data-i="${i}"><span>${i + 1}. ${l.name}</span><small>${n} suspects</small></button>`;
    });
    html += `<div class="row"><button id="ovClose">Retour</button></div>`;
    this.showOverlay(html);
    this.panel.querySelectorAll('.levelbtn').forEach(b => b.onclick = () => { g.loadLevel(+b.dataset.i); this.showBriefing(); });
    this.panel.querySelector('#ovClose').onclick = ret;
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
    const html = `<h1 class="${win ? 'win' : 'lose'}">${win ? 'Mission accomplie' : 'Mission échouée'}</h1>
      <p>${win ? 'Tous les suspects sont neutralisés.' : g.loseReason}</p>
      <div class="stats">
        <span>Temps</span><b>${fmtTime(g.time)}</b>
        <span>Suspects neutralisés</span><b>${s.kills} / ${g.enemies.length}</b>
        <span>Tirs / touchés</span><b>${s.shots} / ${s.hits}</b>
        <span>Précision</span><b>${s.shots ? Math.round(100 * s.hits / s.shots) : 0} %</b>
        <span>Flashs utilisées</span><b>${s.flashes}</b>
        <span>Coéquipiers perdus</span><b>${s.losses} / ${g.mates.length}</b>
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
      <b>Portes</b> : <kbd>E</kbd> ouvre en grand la porte la plus proche, ou la ferme si elle est ouverte. La molette agit par étapes : vers le haut, fermée puis entrouverte puis ouverte ; vers le bas, l'inverse. Une porte entrouverte laisse passer le regard (le vôtre et celui des ennemis) mais pas le passage, et s'entrouvre sans bruit. On ne peut pas fermer une porte si quelqu'un se trouve dans l'embrasure.<br>
      <b>Flash</b> : <kbd>Espace</kbd> (ou <kbd>G</kbd>) lance une grenade aveuglante vers le curseur : la distance au curseur règle la force du lancer. Elle vole, retombe, roule et rebondit sur les murs, le mobilier et les portes fermées, puis explose au bout d'environ 1,7 s. Attention aux retours contre un mur proche. Collé à une porte entrouverte, visez l'embrasure pour glisser la grenade par l'entrebâillement ; de plus loin, elle rebondit sur le battant. Les ennemis aveuglés ne tirent plus pendant quelques secondes. Ne regardez pas l'explosion.<br>
      <b>Otages</b> : ne tirez pas dessus.<br>
      <b>Équipe</b> : Bravo et Charlie vous suivent en formation et couvrent vos flancs et vos arrières. <kbd>T</kbd> leur fait tenir la position (ou reprendre le suivi), le clic droit les envoie sur un point (ils ouvrent les portes sur ce trajet), et un clic droit sur vous-même les rappelle en suivi. En <b>maintenant</b> le clic droit puis en tirant vers une direction, vous ajoutez une consigne de couverture : celui des deux qui se place de ce côté gardera cet angle au lieu de choisir lui-même son point d'intérêt (jusqu'à l'ordre suivant ; un contact reste prioritaire). Ils tirent sur tout suspect visible, mais jamais à travers vous ou un otage : quand l'axe reste bouché, ils se décalent pour dégager l'angle (le HUD indique « Axe bouché »). Un ordre de déplacement reste prioritaire sur un contact : ils rompent et progressent en gardant le suspect en joue. Attention, vos propres balles peuvent les blesser.<br>
      <kbd>Échap</kbd> pause.</p>
      <div class="row"><button class="primary" id="ovClose">Compris</button></div>`);
    this.panel.querySelector('#ovClose').onclick = () => { if (this.game.paused) this.showPause(); else this.hideOverlay(); };
  }
}
