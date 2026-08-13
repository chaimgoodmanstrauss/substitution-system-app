import { freshId, cmdAddMotif, cmdAddLayer, cmdDeleteMotif } from '../model.js';
import { activeTool } from './activeTool.js';
import { uiState } from './uiState.js';
import * as rectTool    from '../tools/rect.js';
import * as ellipseTool from '../tools/ellipse.js';
import * as penTool     from '../tools/pen.js';
import * as selectTool  from '../tools/select.js';
import * as rotateTool  from '../tools/rotate.js';
import * as scaleTool   from '../tools/scale.js';
import * as reflectTool from '../tools/reflect.js';
import { AnchorLayer } from '../tools/shared.js';

const NS = 'http://www.w3.org/2000/svg';
// Drawing tools that use the (svg, onCommit, getPreviewStyle) signature
const DRAW_TOOLS = { rect: rectTool, ellipse: ellipseTool, pen: penTool };
// Transform tools that use the (svg, motifId, store) signature (same as select)
const XFORM_TOOLS = { select: selectTool, direct: selectTool, rotate: rotateTool, scale: scaleTool, reflect: reflectTool };

// viewBox: motif [0,1]×[0,1] appears at ~60% of panel width
const PANEL_VIEWBOX = '-0.333 -0.333 1.667 1.667';

function getPreviewStyle(store) {
  const viewMode = store.getState().viewMode;
  if (viewMode === 'outline') return { outline: true };
  const f = uiState.get('fill');
  const s = uiState.get('stroke');
  return {
    fill: f.enabled ? f.color : 'none',
    fillOpacity: f.opacity,
    stroke: s.enabled ? s.color : 'none',
    strokeOpacity: s.opacity,
    strokeWidth: s.width,
  };
}

// ---- panel drawing SVG ----

function buildPanelSvg(motifId, initialLayers, store) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'panel-svg');
  svg.setAttribute('viewBox', PANEL_VIEWBOX);

  const layersG = document.createElementNS(NS, 'g');
  svg.appendChild(layersG);

  // Ruler
  const ruler = document.createElementNS(NS, 'line');
  ruler.setAttribute('x1', 0); ruler.setAttribute('y1', 0);
  ruler.setAttribute('x2', 1); ruler.setAttribute('y2', 0);
  ruler.setAttribute('class', 'panel-ruler');
  svg.appendChild(ruler);

  function renderLayers(layers) {
    layersG.innerHTML = '';
    layers.forEach((layer, i) => {
      if (layer.type === 'ruler') return; // rendered as separate ruler SVG element
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', layer.pathData);
      path.dataset.layerIndex = i;
      const fill   = layer.fillEnabled   ? layer.fill   : 'none';
      const stroke = layer.strokeEnabled ? layer.stroke : 'none';
      path.setAttribute('fill', fill);
      if (fill !== 'none') path.setAttribute('fill-opacity', layer.fillOpacity ?? 1);
      path.setAttribute('stroke', stroke);
      if (stroke !== 'none') {
        path.setAttribute('stroke-opacity', layer.strokeOpacity ?? 1);
        path.setAttribute('stroke-width', layer.strokeWidth ?? 1);
        path.setAttribute('stroke-miterlimit', layer.strokeMiterLimit ?? 4);
        path.setAttribute('vector-effect', 'non-scaling-stroke');
      }
      layersG.appendChild(path);

      // Hit-area overlay: invisible wide stroke for easier 3px-ish clicking
      const hit = document.createElementNS(NS, 'path');
      hit.setAttribute('d', layer.pathData);
      hit.setAttribute('fill', layer.fillEnabled ? 'transparent' : 'none');
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '6');
      hit.setAttribute('vector-effect', 'non-scaling-stroke');
      hit.setAttribute('pointer-events', 'all');
      hit.dataset.layerIndex = i;
      hit.dataset.hit = '1';
      layersG.appendChild(hit);
    });
  }

  renderLayers(initialLayers);

  // Persistent anchor layer — shows vertex squares for selected layer
  // regardless of which tool is active. Clears during live drags so the tool's
  // live-position anchors take over without duplication.
  const selAnchors = AnchorLayer(svg);

  function refreshSelAnchors() {
    if (uiState.get('livePatch')) { selAnchors.clear(); return; }
    const sel = uiState.get('selectedLayer');
    if (!sel || sel.motifId !== motifId) { selAnchors.clear(); return; }
    const layer = store.getState().motifs[motifId]?.layers[sel.index];
    selAnchors.draw(layer?.nodes ?? null);
  }

  const offSelAnchor    = uiState.on('selectedLayer', refreshSelAnchors);
  const offLivePatch    = uiState.on('livePatch',     refreshSelAnchors);
  const unsubSelAnchor  = store.subscribe(refreshSelAnchors);
  refreshSelAnchors();

  let deactivateTool = null;

  function reattach(toolName) {
    deactivateTool?.();
    deactivateTool = null;
    svg.dataset.tool = toolName;

    if (XFORM_TOOLS[toolName]) {
      deactivateTool = XFORM_TOOLS[toolName].activate(svg, motifId, store);
    } else if (DRAW_TOOLS[toolName]) {
      deactivateTool = DRAW_TOOLS[toolName].activate(
        svg,
        (pathData, points, nodes) => {
          const f = uiState.get('fill');
          const s = uiState.get('stroke');
          store.apply(cmdAddLayer(motifId, {
            pathData, points, nodes,
            fill: f.color, fillOpacity: f.opacity, fillEnabled: f.enabled,
            stroke: s.color, strokeOpacity: s.opacity, strokeEnabled: s.enabled,
            strokeWidth: s.width, strokeMiterLimit: s.miterLimit,
          }));
          uiState.set('selectedMotifId', motifId);
        },
        () => getPreviewStyle(store),
        () => store.getState().motifs[motifId]?.layers ?? [],
        store,
        motifId,
      );
    }
  }

  reattach(activeTool.get());
  const offToolChange = activeTool.onChange(reattach);

  return {
    el: svg,
    renderLayers,
    cleanup() { deactivateTool?.(); offToolChange(); offSelAnchor(); offLivePatch(); unsubSelAnchor(); selAnchors.remove(); },
  };
}

// ---- single motif panel ----

function createPanel(motif, store) {
  const panelEl = document.createElement('div');
  panelEl.className = 'motif-panel';
  panelEl.addEventListener('click', () => uiState.set('selectedMotifId', motif.id));

  const header = document.createElement('div');
  header.className = 'motif-panel__header';
  const nameEl = document.createElement('span');
  nameEl.className = 'motif-panel__name';
  nameEl.textContent = motif.name;
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'motif-panel__delete';
  delBtn.title = 'Delete motif';
  delBtn.textContent = '×';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    store.apply(cmdDeleteMotif(motif.id));
    if (uiState.get('selectedMotifId') === motif.id) uiState.set('selectedMotifId', null);
  });
  header.append(nameEl, delBtn);

  const svgState = buildPanelSvg(motif.id, motif.layers, store);

  panelEl.append(header, svgState.el);

  const offSelect = uiState.on('selectedMotifId', (id) => {
    panelEl.classList.toggle('motif-panel--selected', id === motif.id);
  });
  panelEl.classList.toggle('motif-panel--selected', uiState.get('selectedMotifId') === motif.id);

  return {
    panelEl,
    syncLayers(layers) { svgState.renderLayers(layers); },
    cleanup() { svgState.cleanup(); offSelect(); },
  };
}

// ---- panel strip ----

export function renderPanelStrip(store) {
  const panels = new Map();

  const strip = document.createElement('div');
  strip.className = 'panel-strip';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'add-motif-btn';
  addBtn.title = 'Add motif';
  addBtn.textContent = '+';
  addBtn.addEventListener('click', () => {
    const id = freshId();
    store.apply(cmdAddMotif({ id, name: `Motif ${id}` }));
  });
  strip.appendChild(addBtn);

  function sync() {
    const { motifs } = store.getState();
    for (const [id, ps] of panels) {
      if (!motifs[id]) { ps.panelEl.remove(); ps.cleanup(); panels.delete(id); }
    }
    for (const [id, motif] of Object.entries(motifs)) {
      if (!panels.has(id)) {
        const ps = createPanel(motif, store);
        panels.set(id, ps);
        strip.insertBefore(ps.panelEl, addBtn);
      } else {
        panels.get(id).syncLayers(motif.layers);
      }
    }
  }

  store.subscribe(sync);
  sync();
  return strip;
}
