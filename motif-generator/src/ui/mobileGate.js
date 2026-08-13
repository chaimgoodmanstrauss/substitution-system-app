// Session 1: layout shell only. Breakpoint and copy are both placeholders —
// revisit once real screen-size testing happens (spec §0.3).
export function initMobileGate(minWidth) {
  const gate = document.getElementById('mobile-gate');
  const app = document.getElementById('app');

  function check() {
    const tooNarrow = window.innerWidth < minWidth;
    gate.hidden = !tooNarrow;
    app.hidden = tooNarrow;
  }

  check();
  window.addEventListener('resize', check);
}
