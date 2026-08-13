import { identity, affine } from './geometry.js';

// Generic command-based store (spec §2a: undo/redo designed in from the start).
// Commands are { do(state) -> newState }; state must be treated immutably —
// `do` should return a new object, never mutate `state` in place. Undo/redo
// work by snapshotting `prevState`, so commands don't need their own inverse.
export function createStore(initialState) {
  let state = initialState;
  const undoStack = [];
  const redoStack = [];
  const listeners = [];

  function notify() {
    for (const fn of listeners) fn();
  }

  function apply(command) {
    const prevState = state;
    state = command.do(state);
    undoStack.push({ command, prevState });
    redoStack.length = 0;
    notify();
    return state;
  }

  function undo() {
    if (undoStack.length === 0) return state;
    const entry = undoStack.pop();
    redoStack.push(entry);
    state = entry.prevState;
    notify();
    return state;
  }

  function redo() {
    if (redoStack.length === 0) return state;
    const entry = redoStack.pop();
    state = entry.command.do(entry.prevState);
    undoStack.push(entry);
    notify();
    return state;
  }

  return {
    getState: () => state,
    apply,
    undo,
    redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    subscribe: (fn) => {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
}

// ---- motif editing commands ----

let _idSeq = 0;
export function freshId() {
  return `m${++_idSeq}`;
}

function emptyRule(motifId) {
  return {
    motifId,
    placements: [],
    ruler: { p0: [0, 0], p1: [1, 0] },
    rulerAnchors: null,
  };
}

function makeRulerLayer() {
  return { type: 'ruler', points: [[0, 0], [1, 0]] };
}

// Return the ruler as { p0, p1 } from a motif's ruler layer (always [0,0]->[1,0]).
export function getMotifRuler(motif) {
  const rl = motif.layers?.find((l) => l.type === 'ruler');
  if (rl) return { p0: rl.points[0] ?? [0, 0], p1: rl.points[1] ?? [1, 0] };
  return motif.ruler ?? { p0: [0, 0], p1: [1, 0] }; // backward compat
}

export function cmdAddMotif({ id, name }) {
  const motif = {
    id,
    name,
    points: [],
    layers: [makeRulerLayer()],
  };
  return {
    do: (state) => ({
      ...state,
      motifs: { ...state.motifs, [id]: motif },
      rules: { ...state.rules, [id]: emptyRule(id) },
    }),
  };
}

export function cmdAddLayer(motifId, layer) {
  return {
    do: (state) => {
      const motif = state.motifs[motifId];
      const layers = [...motif.layers, layer];
      const points = layers.flatMap((l) => l.points);
      return {
        ...state,
        motifs: { ...state.motifs, [motifId]: { ...motif, layers, points } },
      };
    },
  };
}

export function cmdUpdateLayer(motifId, index, patch) {
  return {
    do: (state) => {
      const motif = state.motifs[motifId];
      const layers = motif.layers.map((l, i) => (i === index ? { ...l, ...patch } : l));
      return {
        ...state,
        motifs: { ...state.motifs, [motifId]: { ...motif, layers } },
      };
    },
  };
}

export function cmdDeleteLayer(motifId, index) {
  return {
    do: (state) => {
      const motif = state.motifs[motifId];
      const layers = motif.layers.filter((l, i) => i !== index || l.type === 'ruler');
      const points = layers.flatMap((l) => l.points ?? []);
      return {
        ...state,
        motifs: { ...state.motifs, [motifId]: { ...motif, layers, points } },
      };
    },
  };
}

export function cmdMoveLayerToTop(motifId, index) {
  return {
    do: (state) => {
      const motif = state.motifs[motifId];
      const layers = [...motif.layers];
      const [layer] = layers.splice(index, 1);
      layers.push(layer);
      return { ...state, motifs: { ...state.motifs, [motifId]: { ...motif, layers } } };
    },
  };
}

export function cmdMoveLayerToBottom(motifId, index) {
  return {
    do: (state) => {
      const motif = state.motifs[motifId];
      const layers = [...motif.layers];
      const [layer] = layers.splice(index, 1);
      layers.unshift(layer);
      return { ...state, motifs: { ...state.motifs, [motifId]: { ...motif, layers } } };
    },
  };
}

export function cmdMoveLayerUp(motifId, index) {
  return {
    do: (state) => {
      const motif = state.motifs[motifId];
      const layers = [...motif.layers];
      if (index >= layers.length - 1) return state;
      [layers[index], layers[index + 1]] = [layers[index + 1], layers[index]];
      return { ...state, motifs: { ...state.motifs, [motifId]: { ...motif, layers } } };
    },
  };
}

export function cmdMoveLayerDown(motifId, index) {
  return {
    do: (state) => {
      const motif = state.motifs[motifId];
      const layers = [...motif.layers];
      if (index <= 1) return state; // index 0 is always the ruler layer
      [layers[index], layers[index - 1]] = [layers[index - 1], layers[index]];
      return { ...state, motifs: { ...state.motifs, [motifId]: { ...motif, layers } } };
    },
  };
}

export function cmdDeleteMotif(motifId) {
  return {
    do: (state) => {
      const { [motifId]: _m, ...motifs } = state.motifs;
      const { [motifId]: _r, ...rules } = state.rules;
      return { ...state, motifs, rules };
    },
  };
}

// Default project on first load (spec §0.12): one square motif, ruler along
// its base; its rule is four copies in a 2x2 grid, ruler along the base of
// the overall block. rulerAnchors satisfy §0.7 (both endpoints land on a
// placement's own ruler-vertex). Transforms are the affine special case of
// geometry.js's general 3x3 matrix (here, just plain translations).
function translate(tx, ty) {
  return affine(1, 0, 0, 1, tx, ty);
}

export function createDefaultProject() {
  const squareMotif = {
    id: 'square',
    name: 'Square',
    points: [[0, 0], [1, 0], [1, 1], [0, 1]],
    layers: [
      makeRulerLayer(),
      {
        pathData: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
        nodes: [
          { x: 0, y: 0, cpIn: [0, 0], cpOut: [0, 0] },
          { x: 1, y: 0, cpIn: [1, 0], cpOut: [1, 0] },
          { x: 1, y: 1, cpIn: [1, 1], cpOut: [1, 1] },
          { x: 0, y: 1, cpIn: [0, 1], cpOut: [0, 1] },
        ],
        points: [[0, 0], [1, 0], [1, 1], [0, 1]],
        fill: '#000000',
        stroke: '#cccccc',
        fillOpacity: 1,
        strokeOpacity: 1,
        fillEnabled: false,
        strokeEnabled: true,
        strokeWidth: 1,
        strokeMiterLimit: 4,
      },
    ],
  };

  const squareRule = {
    motifId: 'square',
    placements: [
      { refMotifId: 'square', transform: identity(), wrapped: false }, // bottom-left
      { refMotifId: 'square', transform: translate(1, 0), wrapped: false }, // bottom-right
      { refMotifId: 'square', transform: translate(0, 1), wrapped: false }, // top-left
      { refMotifId: 'square', transform: translate(1, 1), wrapped: false }, // top-right
    ],
    ruler: { p0: [0, 0], p1: [2, 0] },
    rulerAnchors: {
      p0: { placementIndex: 0, endpoint: 'p0' },
      p1: { placementIndex: 1, endpoint: 'p1' },
    },
  };

  return {
    motifs: { square: squareMotif },
    rules: { square: squareRule },
    mode: 'reptiling',
    generationCount: 1,
    showRulers: true,
    showBorders: false,
    viewMode: 'preview',
  };
}
