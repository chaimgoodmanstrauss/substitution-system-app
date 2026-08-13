import './styles.css';
import { createStore, createDefaultProject } from './model.js';
import { renderToolbar } from './ui/toolbar.js';
import { renderPanelStrip } from './ui/panels.js';
import { renderCanvas } from './ui/canvas.js';
import { initMobileGate } from './ui/mobileGate.js';

const MOBILE_GATE_MIN_WIDTH = 640;

function mount() {
  const store = createStore(createDefaultProject());

  const app = document.getElementById('app');
  app.innerHTML = '';

  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.appendChild(renderToolbar(store));

  const main = document.createElement('div');
  main.className = 'shell__main';
  main.appendChild(renderPanelStrip(store));
  main.appendChild(renderCanvas(store));
  shell.appendChild(main);

  app.appendChild(shell);

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      store.undo();
    } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      store.redo();
    }
  });
}

mount();
initMobileGate(MOBILE_GATE_MIN_WIDTH);
