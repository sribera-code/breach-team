'use strict';
(function () {
  const canvas = document.getElementById('game');
  const game = new Game();
  const renderer = new Renderer(canvas, game);
  const ui = new UI(game);

  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());
  game.loadLevel(0);
  // on choisit le mode, puis la carte, puis l'équipement (#nobrief : on joue tout de suite la première carte du mode)
  if (location.hash !== '#nobrief') ui.showModes();

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
  canvas.addEventListener('mousedown', e => {
    Sound.init();
    lock();
    if (e.button === 0) { inp.mouse.down = true; inp.pressed.Mouse0 = true; }
    if (e.button === 1) { e.preventDefault(); inp.pressed.Mouse1 = true; }
    if (e.button === 2) { inp.pressed.Mouse2 = true; inp.mouse.rdown = true; }
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) inp.mouse.down = false;
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

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (locked() && ui.isOpen()) document.exitPointerLock();
    const m = renderer.aimWorld();
    inp.mouse.x = m.x; inp.mouse.y = m.y;
    game.update(dt);
    renderer.draw(dt);
    ui.update();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
