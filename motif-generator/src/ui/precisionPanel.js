// Floating precision-transform panel — shown when Alt is held with a layer selected.
// Shows X, Y, W, H of the selection bounding box; edits apply absolute transforms.

export function createPrecisionPanel(onApply) {
  const panel = document.createElement('div');
  panel.className = 'precision-panel';
  panel.hidden = true;
  document.body.appendChild(panel);

  const inputs = {};
  for (const key of ['X', 'Y', 'W', 'H']) {
    const row = document.createElement('div');
    row.className = 'precision-row';
    const label = document.createElement('span');
    label.className = 'precision-label';
    label.textContent = key;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.className = 'precision-input';
    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      if (!isNaN(v)) onApply({ [key]: v });
    });
    inputs[key] = input;
    row.append(label, input);
    panel.appendChild(row);
  }

  function setValues(x, y, w, h) {
    inputs.X.value = +x.toFixed(3);
    inputs.Y.value = +y.toFixed(3);
    inputs.W.value = +w.toFixed(3);
    inputs.H.value = +h.toFixed(3);
  }

  return {
    el: panel,
    show(x, y, w, h) { setValues(x, y, w, h); panel.hidden = false; },
    update(x, y, w, h) { if (!panel.hidden) setValues(x, y, w, h); },
    hide() { panel.hidden = true; },
    destroy() { panel.remove(); },
  };
}
