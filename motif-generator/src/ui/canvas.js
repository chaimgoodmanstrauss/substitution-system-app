import { initRenderer } from '../render.js';
import { uiState } from './uiState.js';

export function renderCanvas(store) {
  const field = document.createElement('div');
  field.className = 'canvas-field';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'canvas-field__surface');
  svg.setAttribute('viewBox', '-0.333 -0.333 1.667 1.667');
  field.appendChild(svg);

  const renderer = initRenderer(svg, store.getState());
  let lastMotifsJson = JSON.stringify(store.getState().motifs);

  function getDisplayConfig(s) {
    const selId = uiState.get('selectedMotifId');
    if (selId && s.motifs[selId]) {
      if (s.generationCount === 1) {
        // Rule-editing surface for the selected motif (actual editor arrives Session 6).
        return { type: 'motif', id: selId };
      }
      return { type: 'gen', id: selId, gen: s.generationCount };
    }
    return null; // renderer falls back to first motif with placements
  }

  function syncFromStore() {
    const s = store.getState();
    const display = getDisplayConfig(s);
    const motifsJson = JSON.stringify(s.motifs);
    if (motifsJson !== lastMotifsJson) {
      lastMotifsJson = motifsJson;
      renderer.rebuild(s, display);
    } else {
      renderer.update(s, display);
    }
  }

  store.subscribe(syncFromStore);
  uiState.on('selectedMotifId', () => syncFromStore());
  uiState.on('livePatch', (patch) => {
    if (patch) renderer.patchLayer(patch.motifId, patch.index, patch.pathData);
    if (!patch) { ghostEl?.remove(); ghostEl = null; }
  });

  // Ghost overlay for opt+drag duplicate preview
  let ghostEl = null;
  uiState.on('liveGhost', (g) => {
    if (!g) { ghostEl?.remove(); ghostEl = null; return; }
    if (!ghostEl) {
      ghostEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      ghostEl.classList.add('drag-ghost');
      const f = uiState.get('fill');
      const s = uiState.get('stroke');
      ghostEl.setAttribute('fill',         f.enabled ? f.color : 'none');
      ghostEl.setAttribute('fill-opacity', String(f.opacity));
      ghostEl.setAttribute('stroke',       s.enabled ? s.color : 'none');
      ghostEl.setAttribute('stroke-opacity', String(s.opacity));
      ghostEl.setAttribute('stroke-width', String(s.width));
      ghostEl.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(ghostEl);
    }
    ghostEl.setAttribute('d', g.pathData);
  });

  syncFromStore();

  return field;
}
