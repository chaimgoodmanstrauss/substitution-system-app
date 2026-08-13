import { activeTool } from './activeTool.js';
import { uiState } from './uiState.js';
import { createColorPicker } from './colorPicker.js';
import { cmdUpdateLayer } from '../model.js';

// Inline SVG icons. Pen/rect/ellipse cropped from resources/*.svg (Illustrator artboard 595×842).
const ICONS = {
  // Black arrow (select whole paths)
  select: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M5 2 L5 19 L9 15 L12 22 L14.5 21 L11.5 14 L17 14 Z"/>
  </svg>`,
  // White arrow (direct-select vertices) — same shape, outlined
  direct: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
    <path d="M5 2 L5 19 L9 15 L12 22 L14.5 21 L11.5 14 L17 14 Z"/>
  </svg>`,
  // Rotate
  rotate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <path d="M20 12 A8 8 0 1 1 14 4.5"/>
    <polyline points="14,2 14,6 18,6"/>
  </svg>`,
  // Scale
  scale: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="2" y="2" width="10" height="10"/>
    <rect x="12" y="12" width="10" height="10"/>
    <line x1="12" y1="2" x2="22" y2="2"/>
    <line x1="22" y1="2" x2="22" y2="12"/>
  </svg>`,
  // Reflect — two triangles mirrored across a dashed vertical axis
  reflect: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="12" y1="2" x2="12" y2="22" stroke-dasharray="3 2"/>
    <polygon points="2,6 9,12 2,18" fill="currentColor" stroke="none"/>
    <polygon points="22,6 15,12 22,18" fill="none" stroke="currentColor" stroke-width="1.5"/>
  </svg>`,
  // Pen — viewBox widened slightly right to avoid clipping the nib
  pen: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="282 408 26 27" fill="none" stroke="currentColor" stroke-width="1">
    <rect x="299.75" y="411.92" width="5.08" height="9" transform="translate(-205.44 332.77) rotate(-44.67)" stroke-miterlimit="10"/>
    <polygon points="299.25 418.53 296.53 415.78 291.6 418.02 287.27 429.67 287.62 430.03 292.5 425.21 293.63 424.4 294.29 424.26 294.21 424.99 293.39 426.12 288.52 430.93 288.87 431.28 300.57 427.09 302.86 422.19 300.14 419.44 299.25 418.53" stroke-linejoin="round"/>
  </svg>`,
  rect: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="274 444 27 23" fill="none" stroke="currentColor" stroke-width="1" stroke-miterlimit="10">
    <rect x="277.65" y="448.05" width="19.99" height="17.15"/>
  </svg>`,
  ellipse: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="284 410 27 23" fill="none" stroke="currentColor" stroke-width="1" stroke-miterlimit="10">
    <ellipse cx="297.37" cy="421.26" rx="9.99" ry="7.41"/>
  </svg>`,
};

// Tool groups (id must match activeTool values and XFORM_TOOLS/DRAW_TOOLS maps in panels.js)
// Note: 'direct' mode (A key / Option held) has no separate toolbar button — same arrow button.
const SELECTION_TOOLS = [
  { id: 'select', label: 'Select (V) · Direct (A / ⌥)' },
];
const TRANSFORM_TOOLS = [
  { id: 'rotate',  label: 'Rotate (R)' },
  { id: 'scale',   label: 'Scale (S)' },
  { id: 'reflect', label: 'Reflect (O)' },
];
const DRAW_TOOLS = [
  { id: 'pen',     label: 'Pen (P)' },
  { id: 'rect',    label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
];

function toolButton(tool) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tool-button';
  btn.dataset.tool = tool.id;
  btn.title = tool.label;
  btn.innerHTML = ICONS[tool.id] ?? `<span>${tool.label[0]}</span>`;
  return btn;
}


function divider() {
  const d = document.createElement('div');
  d.className = 'tool-divider';
  return d;
}

function makeToggle(onLabel, offLabel, initiallyOn) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toggle-button';
  function setActive(on) {
    btn.textContent = on ? onLabel : offLabel;
    btn.classList.toggle('toggle-button--on', on);
  }
  setActive(initiallyOn);
  return { el: btn, setActive };
}

// ---- fill/stroke section ----

function dispatchLayerPatch(store, patch) {
  const sel = uiState.get('selectedLayer');
  if (sel) store.apply(cmdUpdateLayer(sel.motifId, sel.index, patch));
}

function buildFillStrokeSection(store) {
  const section = document.createElement('div');
  section.className = 'fill-stroke-section';

  const swatchWrap = document.createElement('div');
  swatchWrap.className = 'swatch-wrap';

  const strokeSwatch = document.createElement('button');
  strokeSwatch.type = 'button';
  strokeSwatch.className = 'swatch swatch--stroke';
  strokeSwatch.title = 'Stroke color';

  const fillSwatch = document.createElement('button');
  fillSwatch.type = 'button';
  fillSwatch.className = 'swatch swatch--fill';
  fillSwatch.title = 'Fill color';

  swatchWrap.append(strokeSwatch, fillSwatch);

  const widthRow = document.createElement('div');
  widthRow.className = 'tool-field tool-field--inline';
  const widthLabel = document.createElement('label');
  widthLabel.textContent = 'W';
  const widthInput = document.createElement('input');
  widthInput.type = 'number'; widthInput.min = '0.1'; widthInput.max = '100'; widthInput.step = '0.5';
  widthInput.value = uiState.get('stroke').width;
  widthInput.addEventListener('change', () => {
    const v = Math.max(0.1, parseFloat(widthInput.value) || 1);
    widthInput.value = v;
    uiState.patch('stroke', { width: v });
    dispatchLayerPatch(store, { strokeWidth: v });
  });
  uiState.on('stroke', () => { widthInput.value = uiState.get('stroke').width; });
  widthRow.append(widthLabel, widthInput);

  section.append(swatchWrap, widthRow);

  const fillPicker = createColorPicker((val) => {
    uiState.set('fill', val);
    updateSwatches();
    dispatchLayerPatch(store, { fill: val.color, fillOpacity: val.opacity, fillEnabled: val.enabled });
  });
  const strokePicker = createColorPicker((val) => {
    uiState.patch('stroke', val);
    updateSwatches();
    dispatchLayerPatch(store, { stroke: val.color, strokeOpacity: val.opacity, strokeEnabled: val.enabled });
  });

  function updateSwatches() {
    const f = uiState.get('fill');
    const s = uiState.get('stroke');
    if (f.enabled) { fillSwatch.style.background = f.color; fillSwatch.style.opacity = f.opacity; }
    else           { fillSwatch.style.background = ''; fillSwatch.style.opacity = ''; }
    fillSwatch.classList.toggle('swatch--none', !f.enabled);
    if (s.enabled) { strokeSwatch.style.background = s.color; strokeSwatch.style.opacity = s.opacity; }
    else           { strokeSwatch.style.background = ''; strokeSwatch.style.opacity = ''; }
    strokeSwatch.classList.toggle('swatch--none', !s.enabled);
  }

  fillSwatch.addEventListener('click', () => { fillPicker.update(uiState.get('fill')); strokePicker.hide(); fillPicker.toggle(fillSwatch); });
  strokeSwatch.addEventListener('click', () => { const s = uiState.get('stroke'); strokePicker.update({ enabled: s.enabled, color: s.color, opacity: s.opacity }); fillPicker.hide(); strokePicker.toggle(strokeSwatch); });

  uiState.on('fill', updateSwatches);
  uiState.on('stroke', updateSwatches);
  updateSwatches();

  return section;
}

export function renderToolbar(store) {
  const s = store.getState();
  const toolbar = document.createElement('aside');
  toolbar.className = 'toolbar';

  // All interactive tool buttons in one flat map for active-state management
  const allToolBtns = {};

  function makeGroup(tools) {
    const g = document.createElement('div');
    g.className = 'tool-group';
    for (const tool of tools) {
      const btn = toolButton(tool);
      btn.addEventListener('click', () => activeTool.set(tool.id));
      allToolBtns[tool.id] = btn;
      g.appendChild(btn);
    }
    return g;
  }

  const selGroup   = makeGroup(SELECTION_TOOLS);
  const xformGroup = makeGroup(TRANSFORM_TOOLS);
  const drawGroup  = makeGroup(DRAW_TOOLS);

  function syncActiveTool(name) {
    for (const [id, btn] of Object.entries(allToolBtns)) {
      // 'select' button lights up for both 'select' and 'direct' modes
      const isActive = id === name || (id === 'select' && name === 'direct');
      btn.classList.toggle('tool-button--active', isActive);
    }
  }
  activeTool.onChange(syncActiveTool);
  syncActiveTool(activeTool.get());

  // Global keyboard shortcuts for tool switching
  function onGlobalKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    switch (e.key) {
      case 'v': case 'V': activeTool.set('select');  break;
      case 'a': case 'A': activeTool.set('direct');  break;
      case 'r': case 'R': activeTool.set('rotate');  break;
      case 's': case 'S': activeTool.set('scale');   break;
      case 'o': case 'O': activeTool.set('reflect'); break;
      case 'p': case 'P': activeTool.set('pen');     break;
    }
  }
  document.addEventListener('keydown', onGlobalKey);
  // toolbar lives for the app lifetime — no cleanup needed

  const top = document.createElement('div');
  top.className = 'toolbar__section';
  top.append(selGroup, divider(), xformGroup, divider(), drawGroup);

  const fsSection = buildFillStrokeSection(store);

  const genWrap = document.createElement('div');
  genWrap.className = 'tool-field';
  const genLabel = document.createElement('label');
  genLabel.textContent = 'Gen';
  genLabel.htmlFor = 'generation-count';
  const genInput = document.createElement('input');
  genInput.type = 'number'; genInput.id = 'generation-count'; genInput.min = '1'; genInput.max = '10';
  genInput.value = String(s.generationCount);
  genInput.addEventListener('input', () => {
    const v = Math.max(1, Math.min(10, parseInt(genInput.value, 10) || 1));
    store.apply({ do: (st) => ({ ...st, generationCount: v }) });
  });
  genWrap.append(genLabel, genInput);

  const viewToggle    = makeToggle('Outline', 'Show', s.viewMode === 'outline');
  const rulersToggle  = makeToggle('Rulers on', 'Rulers off', s.showRulers);
  const bordersToggle = makeToggle('Borders on', 'Borders off', s.showBorders);
  const modeToggle    = makeToggle('Combinatorial', 'Reptiling', s.mode === 'combinatorial');

  viewToggle.el.addEventListener('click', () => store.apply({ do: (st) => ({ ...st, viewMode: st.viewMode === 'preview' ? 'outline' : 'preview' }) }));
  rulersToggle.el.addEventListener('click', () => store.apply({ do: (st) => ({ ...st, showRulers: !st.showRulers }) }));
  bordersToggle.el.addEventListener('click', () => store.apply({ do: (st) => ({ ...st, showBorders: !st.showBorders }) }));
  modeToggle.el.addEventListener('click', () => store.apply({ do: (st) => ({ ...st, mode: st.mode === 'reptiling' ? 'combinatorial' : 'reptiling' }) }));

  store.subscribe(() => {
    const st = store.getState();
    genInput.value = String(st.generationCount);
    viewToggle.setActive(st.viewMode === 'outline');
    rulersToggle.setActive(st.showRulers);
    bordersToggle.setActive(st.showBorders);
    modeToggle.setActive(st.mode === 'combinatorial');
  });

  const bottom = document.createElement('div');
  bottom.className = 'toolbar__section toolbar__section--bottom';
  bottom.append(fsSection, divider(), genWrap, viewToggle.el, rulersToggle.el, bordersToggle.el, modeToggle.el);

  toolbar.append(top, bottom);
  return toolbar;
}
