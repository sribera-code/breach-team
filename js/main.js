'use strict';
(function () {
  const canvas = document.getElementById('game');
  const game = new Game();
  const renderer = new Renderer(canvas, game);
  const ui = new UI(game);

  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());
  game.loadLevel(0);
  // on choisit le mode, puis la carte, puis l'équipement (#nobrief : on joue tout de suite la première carte du mode ;
  // #fps : compteur d'images ; les deux : #nobrief&fps)
  const flags = location.hash.slice(1).split(/[&,]/);
  if (!flags.includes('nobrief')) ui.showModes();
  const fps = flags.includes('fps') && document.getElementById('fps');
  if (fps) fps.hidden = false;

  const inp = game.input;
  // Souris verrouillée dans le jeu (Pointer Lock) : le curseur est celui qu'on dessine, il ne bute plus sur le bord de
  // la fenêtre, et la lunette peut faire glisser la vue sans lâcher le point visé. Un clic en jeu la verrouille, un
  // menu ouvert la libère.
  const locked = () => document.pointerLockElement === canvas;
  const lock = () => {
    if (locked() || ui.isOpen() || !canvas.requestPointerLock) return;
    try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* refusé : souris libre */ }
  };
  canvas.addEventListener('mousemove', e => renderer.pointerMove(e.movementX || 0, e.movementY || 0, e.clientX, e.clientY, locked()));
  document.addEventListener('click', lock); // après « Lancer l'assaut » ou « Reprendre », le menu fermé
  // Échap libère d'abord la souris (le navigateur s'en charge) : c'est aussi la pause, comptée une seule fois
  let unlockedAt = -1e9;
  document.addEventListener('pointerlockchange', () => {
    if (locked() || ui.isOpen() || game.over || game.paused) return;
    unlockedAt = performance.now();
    game.setPaused(true);
  });
  // Stratégie : la barre latérale. Souris verrouillée, ses clics arrivent au canvas : on donne l'ordre du bouton qui est
  // sous le curseur dessiné (UI.panelHit), et le terrain n'en voit rien ; souris libre, le bouton reçoit le clic lui-même.
  const panelCmd = (hit, e) => { if (e.button === 0 && hit && hit.cmd) game.stratCommand(hit.cmd); };
  canvas.addEventListener('mousedown', e => {
    Sound.init();
    lock();
    if (e.button === 1) e.preventDefault();
    if (game.strat && !renderer.overMinimap()) {
      const hit = ui.panelHit(renderer.mouse.sx, renderer.mouse.sy);
      if (hit) { panelCmd(hit, e); return; }
    }
    if (e.button === 0) { inp.mouse.down = true; inp.pressed.Mouse0 = true; }
    if (e.button === 1) inp.pressed.Mouse1 = true; // recharger
    if (e.button === 2) { inp.pressed.Mouse2 = true; inp.mouse.rdown = true; }
  });
  const panel = document.getElementById('stratPanel');
  panel.addEventListener('mousedown', e => {
    Sound.init();
    e.preventDefault();
    const b = e.target.closest('[data-cmd]');
    panelCmd(b ? { cmd: b.dataset.cmd } : null, e);
    lock();
  });
  panel.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('mouseup', e => {
    if (e.button === 0 && inp.mouse.down) { inp.mouse.down = false; inp.pressed.Mouse0Up = true; }
    if (e.button === 2 && inp.mouse.rdown) { inp.mouse.rdown = false; inp.pressed.Mouse2Up = true; }
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); inp.pressed[e.deltaY > 0 ? 'WheelDown' : 'WheelUp'] = true; }, { passive: false });
  window.addEventListener('blur', () => { inp.keys = {}; inp.mouse.down = false; inp.mouse.rdown = false; if (!game.over && !ui.isOpen()) game.setPaused(true); });

  const NO_DEFAULT = ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'AltRight'];
  window.addEventListener('keydown', e => {
    if (NO_DEFAULT.includes(e.code)) e.preventDefault(); // Alt ne doit pas ouvrir le menu du navigateur
    if (e.repeat) return;
    if (e.code === 'Escape') {
      if (game.over || performance.now() - unlockedAt < 300) return;
      if (ui.isOpen() && !game.paused) return;
      game.setPaused(!game.paused);
      return;
    }
    if (ui.isOpen()) return;
    inp.keys[e.code] = true;
    inp.pressed[e.code] = true;
  });
  window.addEventListener('keyup', e => { if (NO_DEFAULT.includes(e.code)) e.preventDefault(); inp.keys[e.code] = false; });

  // #fps : images par seconde et pire écart entre deux images (ce que l'on voit, GPU compris), temps de calcul moyens
  // de la simulation, du dessin (commandes seulement : le GPU travaille ensuite) et du HUD, par demi-seconde
  const perf = { n: 0, gap: 0, worst: 0, u: 0, d: 0, h: 0, t: 0 };
  function countFps(now, gap, u, d, h) {
    perf.n++; perf.gap += gap; perf.worst = Math.max(perf.worst, gap); perf.u += u; perf.d += d; perf.h += h;
    if (now - perf.t < 500) return;
    const n = perf.n;
    fps.textContent = `${Math.round(1000 * n / perf.gap)} i/s · pire ${perf.worst.toFixed(0)} ms · simulation ${(perf.u / n).toFixed(1)} · dessin ${(perf.d / n).toFixed(1)} · HUD ${(perf.h / n).toFixed(1)} ms`;
    Object.assign(perf, { n: 0, gap: 0, worst: 0, u: 0, d: 0, h: 0, t: now });
  }

  let last = performance.now();
  function frame(now) {
    const gap = now - last;
    const dt = Math.min(0.05, gap / 1000);
    last = now;
    if (locked() && ui.isOpen()) document.exitPointerLock();
    renderer.locked = locked(); // (stratégie : la vue glisse quand le curseur bute sur un bord)
    const m = renderer.aimWorld();
    inp.mouse.x = m.x; inp.mouse.y = m.y;
    // pixels du monde par pixel d'écran (tolérance d'un clic), et curseur sur la minimap (stratégie : la vue y va)
    inp.mouse.ppx = renderer.dpr / renderer.zoom;
    inp.mouse.mini = renderer.overMinimap();
    // stratégie : le curseur sur la barre latérale (le terrain ne le voit pas), sur un bouton posé sur une porte ; la
    // place de la minimap dans la barre
    renderer.overUi = !!(game.strat && !inp.mouse.mini && ui.panelHit(renderer.mouse.sx, renderer.mouse.sy));
    inp.mouse.ui = renderer.overUi;
    inp.mouse.item = renderer.menuItemAt();
    if (game.strat) { renderer.miniSlot = ui.miniSlot(); renderer.panelW = ui.panelWidth(); }
    // ce qu'on entend : depuis le joueur, ou en stratégie depuis le centre de la vue (voir Game.hearAt)
    game.ear = game.strat ? { x: renderer.cam.x, y: renderer.cam.y } : null;
    const t0 = performance.now();
    game.update(dt);
    const t1 = performance.now();
    renderer.draw(dt);
    const t2 = performance.now();
    ui.update();
    ui.hoverAt(game.strat && locked() ? renderer.mouse.sx : null, renderer.mouse.sy);
    if (fps) countFps(now, gap, t1 - t0, t2 - t1, performance.now() - t2);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
