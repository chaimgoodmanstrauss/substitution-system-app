// Floating color+opacity picker popup. Appears to the right of the toolbar.
// onChange({ enabled, color, opacity }) fires on any change.
// "No color" swatch (white box + red diagonal) replaces the old "Enabled" checkbox:
//   clicking it → enabled=false; picking a color → enabled=true automatically.

const NO_COLOR_SVG = `<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
  <rect x="0.5" y="0.5" width="19" height="19" fill="white" stroke="#bbb" stroke-width="1"/>
  <line x1="1" y1="1" x2="19" y2="19" stroke="#e33" stroke-width="2" stroke-linecap="round"/>
</svg>`;

export function createColorPicker(onChange) {
  const popup = document.createElement('div');
  popup.className = 'color-picker-popup';
  popup.hidden = true;
  document.body.appendChild(popup);

  document.addEventListener('pointerdown', (e) => {
    if (!popup.hidden && !popup.contains(e.target) && e.target !== popup._anchor) {
      popup.hidden = true;
    }
  }, true);

  let current = { enabled: true, color: '#000000', opacity: 1 };

  // ── Swatch row ──────────────────────────────────────────────────────────────

  const swatchRow = document.createElement('div');
  swatchRow.className = 'cp-row cp-row--swatches';

  // No-color swatch
  const noColorSwatch = document.createElement('div');
  noColorSwatch.className = 'cp-swatch cp-swatch--none';
  noColorSwatch.innerHTML = NO_COLOR_SVG;
  noColorSwatch.title = 'No color';

  // Color swatch (native color input styled as a swatch)
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'cp-swatch cp-color-input';

  const hexSpan = document.createElement('span');
  hexSpan.className = 'cp-hex';

  swatchRow.append(noColorSwatch, colorInput, hexSpan);

  // ── Opacity row ──────────────────────────────────────────────────────────────

  const alphaRow = document.createElement('div');
  alphaRow.className = 'cp-row';
  const alphaLabel = document.createElement('span');
  alphaLabel.className = 'cp-alpha-label';
  alphaLabel.textContent = 'Opacity';
  const alphaInput = document.createElement('input');
  alphaInput.type = 'range';
  alphaInput.className = 'cp-alpha';
  alphaInput.min = '0'; alphaInput.max = '1'; alphaInput.step = '0.01';
  const alphaVal = document.createElement('span');
  alphaVal.className = 'cp-alpha-val';
  alphaRow.append(alphaLabel, alphaInput, alphaVal);

  popup.append(swatchRow, alphaRow);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function setEnabled(enabled) {
    noColorSwatch.classList.toggle('cp-swatch--active', !enabled);
    colorInput.classList.toggle('cp-swatch--active', enabled);
    alphaInput.disabled = !enabled;
  }

  function syncDisplay() {
    colorInput.value = current.color;
    hexSpan.textContent = current.color.toUpperCase();
    alphaInput.value = current.opacity;
    alphaVal.textContent = Math.round(current.opacity * 100) + '%';
    setEnabled(current.enabled);
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  noColorSwatch.addEventListener('click', () => {
    current = { ...current, enabled: false };
    setEnabled(false);
    onChange(current);
  });

  colorInput.addEventListener('click', () => {
    // Clicking the color well enables color even before the native picker changes value
    if (!current.enabled) {
      current = { ...current, enabled: true };
      setEnabled(true);
      onChange(current);
    }
  });

  colorInput.addEventListener('input', () => {
    current = { ...current, color: colorInput.value, enabled: true };
    hexSpan.textContent = colorInput.value.toUpperCase();
    setEnabled(true);
    onChange(current);
  });

  alphaInput.addEventListener('input', () => {
    current = { ...current, opacity: parseFloat(alphaInput.value) };
    alphaVal.textContent = Math.round(current.opacity * 100) + '%';
    onChange(current);
  });

  // ── Public API ────────────────────────────────────────────────────────────────

  return {
    el: popup,
    show(anchorEl) {
      popup._anchor = anchorEl;
      const rect = anchorEl.getBoundingClientRect();
      popup.style.left = `${rect.right + 6}px`;
      popup.style.top = `${rect.top}px`;
      popup.hidden = false;
    },
    hide() { popup.hidden = true; },
    toggle(anchorEl) {
      if (popup.hidden) this.show(anchorEl); else this.hide();
    },
    update(val) {
      current = { ...val };
      syncDisplay();
    },
  };
}
