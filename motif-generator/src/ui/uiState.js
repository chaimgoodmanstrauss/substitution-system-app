function makeObservable(init) {
  let state = { ...init };
  const listeners = {};

  function notify(key) {
    (listeners[key] || []).forEach((fn) => fn(state[key]));
    (listeners['*'] || []).forEach((fn) => fn(key, state[key]));
  }

  return {
    get(key) { return state[key]; },
    set(key, value) { state[key] = value; notify(key); },
    patch(key, patch) { state[key] = { ...state[key], ...patch }; notify(key); },
    on(key, fn) {
      (listeners[key] = listeners[key] || []).push(fn);
      return () => {
        const a = listeners[key] || [];
        const i = a.indexOf(fn);
        if (i >= 0) a.splice(i, 1);
      };
    },
  };
}

export const uiState = makeObservable({
  selectedMotifId: null,
  selectedLayer: null,      // { motifId, index } | null
  fill:   { enabled: false, color: '#ffffff', opacity: 1 },
  stroke: { enabled: true,  color: '#333333', opacity: 1, width: 1, miterLimit: 4 },
});
