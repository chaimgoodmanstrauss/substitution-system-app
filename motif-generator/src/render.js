import {
  computeNormalizedPlacementTransforms,
  transformFromRulerToStandard,
} from './geometry.js';

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

// SVG matrix(a,b,c,d,e,f) encodes [[a,c,e],[b,d,f],[0,0,1]].
// Our 3x3: a=m00, b=m10, c=m01, d=m11, e=m02, f=m12.
function matrixAttr({ m00, m10, m01, m11, m02, m12 }) {
  return `matrix(${m00},${m10},${m01},${m11},${m02},${m12})`;
}

// <symbol id="motif-{id}"> — motif paths and ruler, normalized to standard segment.
function buildMotifSymbol(motif) {
  const sym = el('symbol', { id: `motif-${motif.id}`, overflow: 'visible' });

  // Get ruler from ruler layer (always [0,0]->[1,0]).
  const rulerLayer = motif.layers.find((l) => l.type === 'ruler');
  const rulerPts = rulerLayer?.points ?? [];
  const [rx0, ry0] = rulerPts[0] ?? [0, 0];
  const [rx1, ry1] = rulerPts[1] ?? [1, 0];
  const rulerObj = { p0: [rx0, ry0], p1: [rx1, ry1] };
  const normT = transformFromRulerToStandard(rulerObj);
  const g = el('g', { transform: matrixAttr(normT) });

  motif.layers.forEach((layer, i) => {
    if (layer.type === 'ruler') return; // rendered below as ruler visuals
    const fill   = layer.fillEnabled   ? layer.fill   : 'none';
    const stroke = layer.strokeEnabled ? layer.stroke : 'none';
    const path = el('path', {
      d: layer.pathData,
      fill,
      stroke,
      'vector-effect': 'non-scaling-stroke',
    });
    if (fill !== 'none') path.setAttribute('fill-opacity', String(layer.fillOpacity ?? 1));
    if (stroke !== 'none') {
      path.setAttribute('stroke-opacity',   String(layer.strokeOpacity  ?? 1));
      path.setAttribute('stroke-width',     String(layer.strokeWidth    ?? 1));
      path.setAttribute('stroke-miterlimit',String(layer.strokeMiterLimit ?? 4));
    }
    path.classList.add('motif-path');
    path.dataset.layerIndex = i;
    g.appendChild(path);
  });

  // Ruler: p0→p1 line plus any extra points.
  g.appendChild(el('line', {
    class: 'ruler',
    x1: rx0, y1: ry0, x2: rx1, y2: ry1,
    stroke: '#888888',
    'stroke-width': '1',
    'vector-effect': 'non-scaling-stroke',
  }));
  // p0: small filled dot; p1: small hollow dot; extra points: small filled dots.
  g.appendChild(el('circle', { class: 'ruler', cx: rx0, cy: ry0, r: '0.014', fill: '#000000' }));
  g.appendChild(el('circle', {
    class: 'ruler', cx: rx1, cy: ry1, r: '0.014',
    fill: '#ffffff', stroke: '#000000', 'stroke-width': '0.007',
  }));
  for (let k = 2; k < rulerPts.length; k++) {
    const [ex, ey] = rulerPts[k];
    g.appendChild(el('circle', { class: 'ruler', cx: ex, cy: ey, r: '0.014', fill: '#444444' }));
  }

  sym.appendChild(g);
  return sym;
}

// <symbol id="gen-{motifId}-{level}"> — <use> refs to level-1 children, same
// normalized transforms F_i at every generation level (reptiling, spec §0.9).
// Combinatorial mode builds different transforms per level — wired in Session 8.
function buildGenSymbol(motifId, level, normalizedPlacements) {
  const sym = el('symbol', { id: `gen-${motifId}-${level}`, overflow: 'visible' });
  const childLevel = level - 1;

  for (const { refMotifId, F } of normalizedPlacements) {
    const refId = childLevel === 0 ? `motif-${refMotifId}` : `gen-${refMotifId}-${childLevel}`;
    sym.appendChild(el('use', { href: `#${refId}`, transform: matrixAttr(F) }));
  }

  // Ruler for this level is always the standard segment in normalized space.
  sym.appendChild(el('line', {
    class: 'ruler',
    x1: 0, y1: 0, x2: 1, y2: 0,
    stroke: '#4488ff',
    'stroke-width': '2.5',
    'vector-effect': 'non-scaling-stroke',
  }));

  return sym;
}

// Builds all <symbol> elements into <defs> and places a single <use> for the
// current generation. Returns { update(project), rebuild(project) }.
// Only reptiling symbols are built here; combinatorial rendering arrives in Session 8.
export function initRenderer(svg, project) {
  // Inline <style> inside the SVG so the rules reach into <use> shadow trees,
  // which external stylesheets cannot do in modern Chrome.
  const inlineStyle = document.createElementNS(NS, 'style');
  svg.appendChild(inlineStyle);

  const defs = document.createElementNS(NS, 'defs');
  svg.appendChild(defs);
  const displayUse = document.createElementNS(NS, 'use');
  svg.appendChild(displayUse);

  // Mutable renderer state — reset on rebuild.
  let motifIds = [];
  let normalizedPlacementsByMotif = {};
  // Build gen symbols lazily — only up to what is currently needed.
  // Adding all 10 levels upfront caused Chrome to eagerly resolve the full
  // <use> chain (4^10 ≈ 1M implicit renders at gen 10), freezing the page.
  let builtUpToLevel = 0;

  function buildFromProject(proj) {
    defs.textContent = '';
    builtUpToLevel = 0;
    motifIds = Object.keys(proj.motifs);
    const motifRulers = Object.fromEntries(motifIds.map((id) => {
      const m = proj.motifs[id];
      const rl = m.layers?.find((l) => l.type === 'ruler');
      return [id, rl ? { p0: rl.points[0] ?? [0,0], p1: rl.points[1] ?? [1,0] } : (m.ruler ?? { p0:[0,0], p1:[1,0] })];
    }));

    for (const id of motifIds) {
      defs.appendChild(buildMotifSymbol(proj.motifs[id]));
    }

    normalizedPlacementsByMotif = Object.fromEntries(
      motifIds.map((id) => [
        id,
        computeNormalizedPlacementTransforms(proj.rules[id], motifRulers),
      ])
    );
  }

  function ensureGenSymbols(upToLevel) {
    for (let level = builtUpToLevel + 1; level <= upToLevel; level += 1) {
      for (const id of motifIds) {
        defs.appendChild(buildGenSymbol(id, level, normalizedPlacementsByMotif[id]));
      }
    }
    builtUpToLevel = Math.max(builtUpToLevel, upToLevel);
  }

  // display: { type: 'motif', id } | { type: 'gen', id, gen } | null
  // When omitted, falls back to first motif with rule placements.
  function update(state, display) {
    let href = null;
    if (display) {
      if (display.type === 'motif') {
        href = `#motif-${display.id}`;
      } else {
        ensureGenSymbols(display.gen);
        href = `#gen-${display.id}-${display.gen}`;
      }
    } else {
      // Default: show first motif that has rule placements.
      const id = motifIds.find((i) => normalizedPlacementsByMotif[i].length > 0) || motifIds[0];
      if (id) {
        ensureGenSymbols(state.generationCount);
        href = `#gen-${id}-${state.generationCount}`;
      }
    }
    if (href) {
      displayUse.setAttribute('href', href);
    } else {
      displayUse.removeAttribute('href');
    }
    svg.classList.toggle('show-rulers', state.showRulers);
    inlineStyle.textContent = state.viewMode === 'outline'
      ? 'path.motif-path { fill: none !important; stroke: #000 !important; stroke-opacity: 1 !important; stroke-width: 1 !important; vector-effect: non-scaling-stroke; }'
      : '';
  }

  buildFromProject(project);
  update(project, null);

  return {
    update,
    rebuild(newProject, display) {
      buildFromProject(newProject);
      update(newProject, display || null);
    },
    // Update a single path d-attribute in the symbol without a full rebuild.
    patchLayer(motifId, index, pathData) {
      const path = defs.querySelector(`#motif-${motifId} [data-layer-index="${index}"]`);
      if (path) path.setAttribute('d', pathData);
    },
  };
}
