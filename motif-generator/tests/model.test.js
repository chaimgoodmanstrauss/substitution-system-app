import { createStore } from '../src/model.js';
import { test, assert, summary } from './assert.js';

// Generic example commands — real ones (addMotif, deleteMotif, ...) land with
// the actual UI in Sessions 4-6. These just exercise the store mechanism.
function setCount(value) {
  return { do: (state) => ({ ...state, count: value }) };
}

function increment(by) {
  return { do: (state) => ({ ...state, count: state.count + by }) };
}

test('apply runs the command and updates state', () => {
  const store = createStore({ count: 0 });
  store.apply(setCount(5));
  assert(store.getState().count === 5, `expected 5, got ${store.getState().count}`);
});

test('undo restores the exact previous state', () => {
  const store = createStore({ count: 0 });
  store.apply(setCount(5));
  store.apply(increment(3));
  assert(store.getState().count === 8);
  store.undo();
  assert(store.getState().count === 5, `expected 5 after undo, got ${store.getState().count}`);
  store.undo();
  assert(store.getState().count === 0, `expected 0 after second undo, got ${store.getState().count}`);
});

test('redo re-applies an undone command', () => {
  const store = createStore({ count: 0 });
  store.apply(setCount(5));
  store.apply(increment(3));
  store.undo();
  store.undo();
  store.redo();
  store.redo();
  assert(store.getState().count === 8, `expected 8 after two redos, got ${store.getState().count}`);
});

test('a new command after undo clears the redo stack', () => {
  const store = createStore({ count: 0 });
  store.apply(setCount(5));
  store.apply(increment(3));
  store.undo();
  store.apply(increment(100));
  assert(store.canRedo() === false, 'redo should be unavailable after a fresh command');
  assert(store.getState().count === 105, `expected 105, got ${store.getState().count}`);
});

test('scripted round-trip: 5 mutations, undo all, redo all, state matches at every step', () => {
  const store = createStore({ count: 0 });
  const steps = [setCount(1), increment(1), increment(1), setCount(10), increment(5)];
  const snapshots = [store.getState()];
  for (const step of steps) {
    store.apply(step);
    snapshots.push(store.getState());
  }
  for (let i = steps.length; i >= 1; i -= 1) {
    assert(store.getState().count === snapshots[i].count, `mismatch before undo #${i}`);
    store.undo();
    assert(store.getState().count === snapshots[i - 1].count, `undo #${i} landed on the wrong state`);
  }
  for (let i = 1; i <= steps.length; i += 1) {
    store.redo();
    assert(store.getState().count === snapshots[i].count, `redo #${i} landed on the wrong state`);
  }
  assert(store.canRedo() === false, 'redo stack should be empty after redoing everything');
});

test('canUndo/canRedo reflect store state correctly', () => {
  const store = createStore({ count: 0 });
  assert(store.canUndo() === false);
  store.apply(setCount(1));
  assert(store.canUndo() === true);
  assert(store.canRedo() === false);
  store.undo();
  assert(store.canUndo() === false);
  assert(store.canRedo() === true);
});

summary();
