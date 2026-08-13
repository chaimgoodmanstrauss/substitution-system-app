// Arrow tool — V = select whole paths (black arrow), A = direct-select vertices (white arrow).
// Option held = temporary switch to direct mode while in select mode.
import { cmdUpdateLayer, cmdAddLayer, cmdDeleteLayer, cmdMoveLayerToTop, cmdMoveLayerToBottom, cmdMoveLayerUp, cmdMoveLayerDown } from '../model.js';
import { uiState } from '../ui/uiState.js';
import { activeTool } from '../ui/activeTool.js';
import { translatePath, nodesToPathData } from '../pathTransform.js';
import { svgCoords, getPathEl, makeGhost } from './shared.js';

// Module-level clipboard — survives tool switches
let _clipboard = null;

const NS   = 'http://www.w3.org/2000/svg';
const AH   = 0.018; // anchor square half-size in SVG units
const HR   = 0.022; // bezier handle circle radius
const SNAP = 0.04;  // snap threshold in SVG units

export function activate(svg, motifId, store) {
  const anchorsG = document.createElementNS(NS, 'g');
  svg.appendChild(anchorsG);
  const handlesG = document.createElementNS(NS, 'g');
  svg.appendChild(handlesG);

  let selIndex  = null;
  let selNode   = null;
  let altHeld   = false;
  let dragState = null;
  let ghost     = null; // duplicate-preview element during opt+drag

  const isDirect = () => activeTool.get() === 'direct' || altHeld;

  // ---- anchors / handles ----

  function renderAnchors(nodes, selectedNodeIdx) {
    anchorsG.innerHTML = '';
    handlesG.innerHTML = '';
    if (!nodes) return;

    nodes.forEach((node, i) => {
      const isSel = isDirect() && i === selectedNodeIdx;
      const sq = document.createElementNS(NS, 'rect');
      sq.setAttribute('x', node.x - AH); sq.setAttribute('y', node.y - AH);
      sq.setAttribute('width', AH * 2);  sq.setAttribute('height', AH * 2);
      sq.setAttribute('class', isSel ? 'anchor-pt anchor-pt--sel' : 'anchor-pt');
      sq.dataset.nodeIndex = i;
      anchorsG.appendChild(sq);
    });

    if (isDirect() && selectedNodeIdx !== null && nodes[selectedNodeIdx]) {
      const node = nodes[selectedNodeIdx];
      for (const cpKey of ['cpOut', 'cpIn']) {
        const [hx, hy] = node[cpKey];
        const arm = document.createElementNS(NS, 'line');
        arm.setAttribute('x1', node.x); arm.setAttribute('y1', node.y);
        arm.setAttribute('x2', hx);     arm.setAttribute('y2', hy);
        arm.setAttribute('class', 'bezier-arm');
        handlesG.appendChild(arm);
        const circ = document.createElementNS(NS, 'circle');
        circ.setAttribute('cx', hx); circ.setAttribute('cy', hy);
        circ.setAttribute('r', HR);
        circ.setAttribute('class', 'bezier-handle');
        circ.dataset.handleType = cpKey;
        circ.dataset.nodeIndex  = selectedNodeIdx;
        handlesG.appendChild(circ);
      }
    }
  }

  function clearAnchors() { anchorsG.innerHTML = ''; handlesG.innerHTML = ''; }

  // Ghost element for opt+drag duplicate preview
  function ensureGhost(layerIndex) {
    if (!ghost) ghost = makeGhost(svg, layerIndex);
  }
  function removeGhost() { ghost?.remove(); ghost = null; }

  function getLayerFromStore(idx) {
    return store.getState().motifs[motifId]?.layers[idx] ?? null;
  }

  function cloneNodes(nodes) {
    return nodes?.map((n) => ({ ...n, cpIn: [...n.cpIn], cpOut: [...n.cpOut] }));
  }

  function selectPath(index) {
    selIndex = index; selNode = null;
    const layer = getLayerFromStore(index);
    if (!layer) return;
    renderAnchors(layer.nodes, null);
    uiState.set('selectedLayer', { motifId, index });
    uiState.set('fill',   { enabled: layer.fillEnabled ?? false, color: layer.fill ?? '#ffffff', opacity: layer.fillOpacity ?? 1 });
    uiState.patch('stroke', { enabled: layer.strokeEnabled ?? true, color: layer.stroke ?? '#333333', opacity: layer.strokeOpacity ?? 1, width: layer.strokeWidth ?? 1, miterLimit: layer.strokeMiterLimit ?? 4 });
  }

  function clearSelection() {
    selIndex = null; selNode = null;
    clearAnchors();
    uiState.set('selectedLayer', null);
  }

  function findSnap(translatedPts) {
    const layers = store.getState().motifs[motifId]?.layers ?? [];
    let best = null, bestD = SNAP;
    for (let i = 0; i < layers.length; i++) {
      if (i === selIndex) continue;
      for (const [qx, qy] of layers[i].points ?? []) {
        for (const [px, py] of translatedPts) {
          const d = Math.hypot(px - qx, py - qy);
          if (d < bestD) { bestD = d; best = [qx - px, qy - py]; }
        }
      }
    }
    return best;
  }

  // ---- pointer events ----

  function onPointerDown(e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = svgCoords(svg, e);
    const direct = isDirect();

    // Bezier handle?
    const handleEl = e.target.closest('[data-handle-type]');
    if (handleEl && selIndex !== null) {
      const cpKey = handleEl.dataset.handleType;
      const ni    = parseInt(handleEl.dataset.nodeIndex, 10);
      const layer = getLayerFromStore(selIndex);
      if (!layer?.nodes?.[ni]) return;
      dragState = {
        mode: `handle-${cpKey}`, start: p, selIndex, nodeIdx: ni,
        origPathData: layer.pathData,
        origPoints:   [...layer.points],
        origNodes:    cloneNodes(layer.nodes),
        origNode:     { ...layer.nodes[ni], cpIn: [...layer.nodes[ni].cpIn], cpOut: [...layer.nodes[ni].cpOut] },
      };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    // Anchor point (direct mode)?
    const anchorEl = e.target.closest('[data-node-index]');
    if (anchorEl && direct && selIndex !== null) {
      const ni    = parseInt(anchorEl.dataset.nodeIndex, 10);
      const layer = getLayerFromStore(selIndex);
      if (!layer) return;
      selNode = ni;
      renderAnchors(layer.nodes, ni);
      dragState = {
        mode: 'node', start: p, selIndex, nodeIdx: ni,
        origPathData: layer.pathData,
        origPoints:   [...layer.points],
        origNodes:    cloneNodes(layer.nodes),
      };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    // Path element (visual or hit-area)?
    const layerEl = e.target.closest('[data-layer-index]');
    if (layerEl) {
      const index = parseInt(layerEl.dataset.layerIndex, 10);
      if (index !== selIndex) selectPath(index);
      const layer = getLayerFromStore(index);
      if (!layer) return;
      dragState = {
        mode: 'path', start: p, selIndex: index,
        origPathData: layer.pathData,
        origPoints:   [...(layer.points ?? [])],
        origNodes:    cloneNodes(layer.nodes),
      };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    clearSelection();
  }

  function applyPathDelta(ds, dx, dy) {
    const pathData = translatePath(ds.origPathData, dx, dy);
    const points   = ds.origPoints.map(([x, y]) => [x + dx, y + dy]);
    const nodes    = ds.origNodes?.map((n) => ({
      ...n, x: n.x + dx, y: n.y + dy,
      cpIn:  [n.cpIn[0]  + dx, n.cpIn[1]  + dy],
      cpOut: [n.cpOut[0] + dx, n.cpOut[1] + dy],
    }));
    return { pathData, points, nodes };
  }

  function emitLive(index, pathData) {
    uiState.set('livePatch', { motifId, index, pathData });
  }

  function onPointerMove(e) {
    if (!dragState) return;
    const p  = svgCoords(svg, e);
    let dx = p.x - dragState.start.x, dy = p.y - dragState.start.y;

    if (dragState.mode === 'path') {
      if (e.shiftKey) {
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const dist = Math.hypot(dx, dy);
        dx = dist * Math.cos(ang); dy = dist * Math.sin(ang);
      }
      const translated = dragState.origPoints.map(([x, y]) => [x + dx, y + dy]);
      const snap = findSnap(translated);
      if (snap) { dx += snap[0]; dy += snap[1]; }
      const { pathData, nodes } = applyPathDelta(dragState, dx, dy);
      if (e.altKey) {
        ensureGhost(dragState.selIndex);
        ghost?.setAttribute('d', pathData);
        getPathEl(svg, dragState.selIndex)?.setAttribute('d', dragState.origPathData);
        emitLive(dragState.selIndex, dragState.origPathData);
        uiState.set('liveGhost', { pathData });
        renderAnchors(dragState.origNodes, selNode);
      } else {
        removeGhost();
        getPathEl(svg, dragState.selIndex)?.setAttribute('d', pathData);
        emitLive(dragState.selIndex, pathData);
        uiState.set('liveGhost', null);
        renderAnchors(nodes, selNode);
      }

    } else if (dragState.mode === 'node') {
      const ni = dragState.nodeIdx;
      const orig = dragState.origNodes[ni];
      const snap = findSnap([[orig.x + dx, orig.y + dy]]);
      if (snap) { dx += snap[0]; dy += snap[1]; }
      const newNodes = dragState.origNodes.map((n, i) =>
        i !== ni ? n : { ...n, x: n.x + dx, y: n.y + dy, cpIn: [n.cpIn[0] + dx, n.cpIn[1] + dy], cpOut: [n.cpOut[0] + dx, n.cpOut[1] + dy] }
      );
      const pd = nodesToPathData(newNodes);
      getPathEl(svg, dragState.selIndex)?.setAttribute('d', pd);
      emitLive(dragState.selIndex, pd);
      renderAnchors(newNodes, ni);

    } else if (dragState.mode.startsWith('handle-')) {
      const cpKey   = dragState.mode.slice(7);
      const otherKey = cpKey === 'cpOut' ? 'cpIn' : 'cpOut';
      const ni      = dragState.nodeIdx;
      const origCp  = dragState.origNode[cpKey];
      const newCp   = [origCp[0] + dx, origCp[1] + dy];
      const anchor  = dragState.origNode; // {x, y, ...}
      const newNodes = dragState.origNodes.map((n, i) => {
        if (i !== ni) return n;
        const updated = { ...n, [cpKey]: newCp };
        // Symmetric by default; alt breaks symmetry (one side only)
        if (!e.altKey) {
          updated[otherKey] = [2 * anchor.x - newCp[0], 2 * anchor.y - newCp[1]];
        }
        return updated;
      });
      const pd = nodesToPathData(newNodes);
      getPathEl(svg, dragState.selIndex)?.setAttribute('d', pd);
      emitLive(dragState.selIndex, pd);
      renderAnchors(newNodes, ni);
    }
  }

  function onPointerUp(e) {
    if (!dragState) return;
    const p  = svgCoords(svg, e);
    let dx = p.x - dragState.start.x, dy = p.y - dragState.start.y;

    if (dragState.mode === 'path') {
      if (e.shiftKey) {
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const dist = Math.hypot(dx, dy);
        dx = dist * Math.cos(ang); dy = dist * Math.sin(ang);
      }
      const snap = findSnap(dragState.origPoints.map(([x, y]) => [x + dx, y + dy]));
      if (snap) { dx += snap[0]; dy += snap[1]; }
      removeGhost();
      if (Math.hypot(dx, dy) > 1e-4) {
        const patch = applyPathDelta(dragState, dx, dy);
        if (e.altKey) {
          // Duplicate: original stays, add copy at new position
          getPathEl(svg, dragState.selIndex)?.setAttribute('d', dragState.origPathData);
          const srcLayer = getLayerFromStore(dragState.selIndex);
          store.apply(cmdAddLayer(motifId, { ...srcLayer, ...patch }));
          const newIdx = store.getState().motifs[motifId].layers.length - 1;
          selIndex = newIdx;
          uiState.set('selectedLayer', { motifId, index: newIdx });
        } else {
          store.apply(cmdUpdateLayer(motifId, dragState.selIndex, patch));
        }
      }

    } else if (dragState.mode === 'node') {
      const ni = dragState.nodeIdx;
      const newNodes = dragState.origNodes.map((n, i) =>
        i !== ni ? n : { ...n, x: n.x + dx, y: n.y + dy, cpIn: [n.cpIn[0] + dx, n.cpIn[1] + dy], cpOut: [n.cpOut[0] + dx, n.cpOut[1] + dy] }
      );
      store.apply(cmdUpdateLayer(motifId, dragState.selIndex, {
        nodes: newNodes, pathData: nodesToPathData(newNodes), points: newNodes.map((n) => [n.x, n.y]),
      }));

    } else if (dragState.mode.startsWith('handle-')) {
      const cpKey   = dragState.mode.slice(7);
      const otherKey = cpKey === 'cpOut' ? 'cpIn' : 'cpOut';
      const ni      = dragState.nodeIdx;
      const origCp  = dragState.origNode[cpKey];
      const anchor  = dragState.origNode;
      const newCp   = [origCp[0] + dx, origCp[1] + dy];
      const newNodes = dragState.origNodes.map((n, i) => {
        if (i !== ni) return n;
        const updated = { ...n, [cpKey]: newCp };
        if (!e.altKey) {
          updated[otherKey] = [2 * anchor.x - newCp[0], 2 * anchor.y - newCp[1]];
        }
        return updated;
      });
      store.apply(cmdUpdateLayer(motifId, dragState.selIndex, {
        nodes: newNodes, pathData: nodesToPathData(newNodes), points: newNodes.map((n) => [n.x, n.y]),
      }));
    }

    dragState = null;
    uiState.set('livePatch', null);
    uiState.set('liveGhost', null);
    const layer = getLayerFromStore(selIndex);
    if (layer) renderAnchors(layer.nodes, selNode);
  }

  function onKeyDown(e) {
    // Tool switching — V / A (don't fire if modifier keys suggest a shortcut)
    if (!e.metaKey && !e.ctrlKey) {
      if (e.key === 'v' || e.key === 'V') { activeTool.set('select'); return; }
      if (e.key === 'a' || e.key === 'A') { activeTool.set('direct'); return; }
    }
    if (e.key === 'Alt') {
      altHeld = true;
      const layer = getLayerFromStore(selIndex);
      if (layer) renderAnchors(layer.nodes, selNode);
    }
    if (e.key === 'Escape') {
      if (dragState) {
        removeGhost();
        getPathEl(svg, dragState.selIndex)?.setAttribute('d', dragState.origPathData);
        dragState = null;
        const layer = getLayerFromStore(selIndex);
        if (layer) renderAnchors(layer.nodes, selNode);
      } else {
        clearSelection();
      }
      return;
    }
    // Delete selected layer (Backspace or Delete)
    if ((e.key === 'Delete' || e.key === 'Backspace') && selIndex !== null) {
      const idx = selIndex;
      clearSelection();
      store.apply(cmdDeleteLayer(motifId, idx));
      return;
    }
    // Copy / Paste
    if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selIndex !== null) {
      e.preventDefault();
      const layer = getLayerFromStore(selIndex);
      if (layer) _clipboard = {
        ...layer,
        nodes:  layer.nodes?.map((n) => ({ ...n, cpIn: [...n.cpIn], cpOut: [...n.cpOut] })),
        points: layer.points?.map((p) => [...p]),
      };
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'v' && _clipboard) {
      e.preventDefault();
      const off = 0.05;
      const pasted = {
        ..._clipboard,
        pathData: translatePath(_clipboard.pathData, off, off),
        points:   _clipboard.points?.map(([x, y]) => [x + off, y + off]),
        nodes:    _clipboard.nodes?.map((n) => ({
          ...n, x: n.x + off, y: n.y + off,
          cpIn:  [n.cpIn[0] + off, n.cpIn[1] + off],
          cpOut: [n.cpOut[0] + off, n.cpOut[1] + off],
        })),
      };
      store.apply(cmdAddLayer(motifId, pasted));
      const newIdx = store.getState().motifs[motifId].layers.length - 1;
      selectPath(newIdx);
      return;
    }
    // Cmd+] / Cmd+[ — step z-order by one; Cmd+Shift+] / Cmd+Shift+[ — to top / to bottom
    if ((e.metaKey || e.ctrlKey) && selIndex !== null) {
      if (e.key === ']') {
        e.preventDefault();
        if (e.shiftKey) {
          const layers = store.getState().motifs[motifId]?.layers ?? [];
          const oldIdx = selIndex; selIndex = layers.length - 1;
          store.apply(cmdMoveLayerToTop(motifId, oldIdx));
          uiState.set('selectedLayer', { motifId, index: selIndex });
        } else {
          const layers = store.getState().motifs[motifId]?.layers ?? [];
          if (selIndex < layers.length - 1) {
            const oldIdx = selIndex; selIndex = oldIdx + 1;
            store.apply(cmdMoveLayerUp(motifId, oldIdx));
            uiState.set('selectedLayer', { motifId, index: selIndex });
          }
        }
      } else if (e.key === '[') {
        e.preventDefault();
        if (e.shiftKey) {
          const oldIdx = selIndex; selIndex = 1;
          store.apply(cmdMoveLayerToBottom(motifId, oldIdx));
          uiState.set('selectedLayer', { motifId, index: selIndex });
        } else {
          if (selIndex > 1) {
            const oldIdx = selIndex; selIndex = oldIdx - 1;
            store.apply(cmdMoveLayerDown(motifId, oldIdx));
            uiState.set('selectedLayer', { motifId, index: selIndex });
          }
        }
      }
    }
    // Arrow keys — step z-order up or down by one (no modifier)
    if (selIndex !== null && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const layers = store.getState().motifs[motifId]?.layers ?? [];
        if (selIndex < layers.length - 1) {
          const oldIdx = selIndex; selIndex = oldIdx + 1;
          store.apply(cmdMoveLayerUp(motifId, oldIdx));
          uiState.set('selectedLayer', { motifId, index: selIndex });
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (selIndex > 1) {
          const oldIdx = selIndex; selIndex = oldIdx - 1;
          store.apply(cmdMoveLayerDown(motifId, oldIdx));
          uiState.set('selectedLayer', { motifId, index: selIndex });
        }
      }
    }
  }

  function onKeyUp(e) {
    if (e.key === 'Alt') {
      altHeld = false;
      const layer = getLayerFromStore(selIndex);
      if (layer) renderAnchors(layer.nodes, selNode);
    }
  }

  const unsubStore = store.subscribe(() => {
    if (selIndex === null || dragState) return;
    const layer = getLayerFromStore(selIndex);
    if (!layer) { clearSelection(); return; }
    renderAnchors(layer.nodes, selNode);
  });

  const offLayerSel = uiState.on('selectedLayer', (sel) => {
    if (!sel || sel.motifId !== motifId) {
      clearAnchors(); selIndex = null; selNode = null;
    } else if (sel.index !== selIndex) {
      selectPath(sel.index);
    }
  });

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup',   onPointerUp);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup',   onKeyUp);

  return function deactivate() {
    svg.removeEventListener('pointerdown', onPointerDown);
    svg.removeEventListener('pointermove', onPointerMove);
    svg.removeEventListener('pointerup',   onPointerUp);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup',   onKeyUp);
    removeGhost();
    uiState.set('liveGhost', null);
    anchorsG.remove();
    handlesG.remove();
    unsubStore();
    offLayerSel();
  };
}
