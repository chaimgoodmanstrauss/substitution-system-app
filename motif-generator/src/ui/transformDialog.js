// Small floating numeric-input dialog for transform tools (opt+click on rotate/scale).
// Returns a Promise resolving to { action: 'ok'|'copy'|'cancel', value: number|null }
// value is already converted: degrees for rotate, ratio (not %) for scale.

export function showTransformDialog({ screenX, screenY, unit, defaultVal = '' }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'transform-dialog';

    // Keep it on screen
    const GAP = 8;
    dialog.style.left = `${screenX + GAP}px`;
    dialog.style.top  = `${screenY + GAP}px`;

    const inputRow = document.createElement('div');
    inputRow.className = 'td-row';

    const input = document.createElement('input');
    input.className = 'td-input';
    input.type  = 'text';
    input.value = defaultVal;

    const unitSpan = document.createElement('span');
    unitSpan.className = 'td-unit';
    unitSpan.textContent = unit;

    inputRow.append(input, unitSpan);

    const btnRow = document.createElement('div');
    btnRow.className = 'td-buttons';

    function finish(action) {
      let value = parseFloat(input.value.replace(',', '.'));
      if (unit === '%') value = isNaN(value) ? null : value / 100;
      else              value = isNaN(value) ? null : value;
      cleanup();
      resolve({ action, value });
    }

    function cleanup() {
      dialog.remove();
      document.removeEventListener('keydown', onKey, true);
    }

    const copyBtn   = document.createElement('button');
    const cancelBtn = document.createElement('button');
    const okBtn     = document.createElement('button');
    copyBtn.textContent   = 'Copy';
    cancelBtn.textContent = 'Cancel';
    okBtn.textContent     = 'OK';
    copyBtn.addEventListener('click',   () => finish('copy'));
    cancelBtn.addEventListener('click', () => finish('cancel'));
    okBtn.addEventListener('click',     () => finish('ok'));

    btnRow.append(copyBtn, cancelBtn, okBtn);
    dialog.append(inputRow, btnRow);
    document.body.appendChild(dialog);

    // Nudge left if it would clip right edge
    requestAnimationFrame(() => {
      const r = dialog.getBoundingClientRect();
      if (r.right > window.innerWidth - GAP)
        dialog.style.left = `${Math.max(GAP, window.innerWidth - r.width - GAP)}px`;
      if (r.bottom > window.innerHeight - GAP)
        dialog.style.top  = `${Math.max(GAP, window.innerHeight - r.height - GAP)}px`;
    });

    input.focus();
    input.select();

    function onKey(e) {
      if (e.key === 'Enter')  { e.preventDefault(); finish('ok'); }
      if (e.key === 'Escape') { e.preventDefault(); finish('cancel'); }
    }
    document.addEventListener('keydown', onKey, true);
  });
}
