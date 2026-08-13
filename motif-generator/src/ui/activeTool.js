const listeners = [];
let _current = 'select';

export const activeTool = {
  get() { return _current; },
  set(name) {
    _current = name;
    listeners.forEach((fn) => fn(name));
  },
  onChange(fn) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
};
