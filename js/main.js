'use strict';
(function () {
  const canvas = document.getElementById('game');
  const game = new Game();
  const renderer = new Renderer(canvas, game);
  const ui = new UI(game);

  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());
  game.loadLevel(0);
  if (location.hash !== '#nobrief') ui.showBriefing();

  const inp = game.input;
  canvas.addEventListener('mousemove', e => { renderer.mouse.sx = e.clientX; renderer.mouse.sy = e.clientY; });
  canvas.addEventListener('mousedown', e => {
    Sound.init();
    if (e.button === 0) { inp.mouse.down = true; inp.pressed.Mouse0 = true; }
    if (e.button === 1) { e.preventDefault(); inp.pressed.Mouse1 = true; }
    if (e.button === 2) inp.pressed.Mouse2 = true;
  });
  window.addEventListener('mouseup', e => { if (e.button === 0) inp.mouse.down = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); inp.pressed[e.deltaY > 0 ? 'WheelDown' : 'WheelUp'] = true; }, { passive: false });
  window.addEventListener('blur', () => { inp.keys = {}; inp.mouse.down = false; if (!game.over && !ui.isOpen()) game.setPaused(true); });

  const NO_DEFAULT = ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'AltRight'];
  window.addEventListener('keydown', e => {
    if (NO_DEFAULT.includes(e.code)) e.preventDefault(); // Alt ne doit pas ouvrir le menu du navigateur
    if (e.repeat) return;
    if (e.code === 'Escape') {
      if (game.over) return;
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
    const m = renderer.toWorld(renderer.mouse.sx, renderer.mouse.sy);
    inp.mouse.x = m.x; inp.mouse.y = m.y;
    game.update(dt);
    renderer.draw(dt);
    ui.update();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
