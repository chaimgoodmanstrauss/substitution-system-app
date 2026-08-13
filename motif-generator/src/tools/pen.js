// Pen tool — click to place straight vertices, drag-before-release to set symmetric
// bezier handles.
// Idle (not drawing):
//   hover at last node of any path → pen+ cursor, click continues that path
//   hover near a segment of selected path → pen+ cursor, click inserts a vertex
//   alt+hover near a vertex of selected path → pen− cursor, click deletes vertex (min 3)
// Drawing:
//   click at own start (≥3 placed) → close path
//   click at either endpoint of another path → connect (merge) the two paths
//   double-click or Escape → commit open path if ≥2 nodes, else discard
//   Enter → close path
import { nodesToPathData, snapPt } from '../pathTransform.js';
import { cmdUpdateLayer } from '../model.js';
import { uiState } from '../ui/uiState.js';

const NS          = 'http://www.w3.org/2000/svg';
const CLOSE_SNAP  = 0.06;
const DRAG_THRESH = 0.012;
const HR          = 0.022;
const VERTEX_HIT  = 0.04;
const SEG_HIT     = 0.025;

function penCursorSvg(sign) {
  const s = sign === '+' ? '%2B' : '-';
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Cpath d='M14,2 L4,15 L2,18' stroke='white' stroke-width='2' fill='none' stroke-linecap='round'/%3E%3Cpath d='M14,2 L4,15 L2,18' stroke='black' stroke-width='1.2' fill='none' stroke-linecap='round'/%3E%3Ctext x='13' y='19' font-size='9' font-weight='bold' fill='black' font-family='sans-serif'%3E${s}%3C/text%3E%3C/svg%3E") 2 18, crosshair`;
}
const CURSOR_PLUS  = penCursorSvg('+');
const CURSOR_MINUS = penCursorSvg('-');

function lerp2(t, [ax, ay], [bx, by]) {
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

function evalBezier(t, P0, C0, C1, P1) {
  const e = lerp2(t, P0, C0), f = lerp2(t, C0, C1), g = lerp2(t, C1, P1);
  return lerp2(t, lerp2(t, e, f), lerp2(t, f, g));
}

function splitBezier(t, P0, C0, C1, P1) {
  const e = lerp2(t, P0, C0), f = lerp2(t, C0, C1), g = lerp2(t, C1, P1);
  const h = lerp2(t, e, f),   j = lerp2(t, f, g);
  const k = lerp2(t, h, j);
  return { left: { c0: e, c1: h, p1: k }, right: { c0: j, c1: g } };
}

function closestTOnSegment(px, py, P0, C0, C1, P1) {
  let bestT = 0, bestD = Infinity;
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    const [x, y] = evalBezier(t, P0, C0, C1, P1);
    const d = Math.hypot(x - px, y - py);
    if (d < bestD) { bestD = d; bestT = t; }
  }
  return { t: bestT, dist: bestD };
}

function svgCoords(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function applyStyle(el, style) {
  if (style.outline) {
    el.setAttribute('class', 'tool-preview tool-preview--outline');
    el.removeAttribute('fill');
    el.removeAttribute('fill-opacity');
    el.removeAttribute('stroke');
    el.removeAttribute('stroke-opacity');
    el.removeAttribute('stroke-width');
    el.removeAttribute('vector-effect');
  } else {
    el.setAttribute('class', 'tool-preview tool-preview--live');
    el.setAttribute('fill', style.fill ?? 'none');
    el.setAttribute('fill-opacity', style.fillOpacity ?? 1);
    el.setAttribute('stroke', style.stroke ?? 'none');
    el.setAttribute('stroke-opacity', style.strokeOpacity ?? 1);
    el.setAttribute('stroke-width', style.strokeWidth ?? 1);
    el.setAttribute('vector-effect', 'non-scaling-stroke');
  }
}

// Open-path d string for a node sequence (no closing Z).
function openPathD(nodes) {
  if (nodes.length < 2) return '';
  const parts = [`M ${nodes[0].x} ${nodes[0].y}`];
  for (let i = 0; i < nodes.length - 1; i++) {
    const cur = nodes[i], next = nodes[i + 1];
    parts.push(`C ${cur.cpOut[0]} ${cur.cpOut[1]} ${next.cpIn[0]} ${next.cpIn[1]} ${next.x} ${next.y}`);
  }
  return parts.join(' ');
}

// Reverse a node array, swapping cpIn/cpOut on each node so bezier handles stay correct.
function reverseNodes(nds) {
  return [...nds].reverse().map((n) => ({
    x: n.x, y: n.y,
    cpIn:  [...n.cpOut],
    cpOut: [...n.cpIn],
  }));
}

export function activate(svg, onCommit, getPreviewStyle = () => ({ outline: true }), getLayers = () => [], store = null, motifId = null) {
  let nodes             = [];
  let continuingLayerIdx = null; // non-null when extending an existing layer
  let downPt            = null;
  let isDragging        = false;

  let previewPath = null;
  let handleGroup = null;

  let hoverMode  = null;
  let lastCursor = null;

  function removeHandleGroup() { handleGroup?.remove(); handleGroup = null; }

  function showHandles(anchor, cpOut) {
    removeHandleGroup();
    const cpIn = [2 * anchor.x - cpOut[0], 2 * anchor.y - cpOut[1]];
    handleGroup = document.createElementNS(NS, 'g');
    for (const [hx, hy] of [cpOut, cpIn]) {
      const arm = document.createElementNS(NS, 'line');
      arm.setAttribute('x1', anchor.x); arm.setAttribute('y1', anchor.y);
      arm.setAttribute('x2', hx);       arm.setAttribute('y2', hy);
      arm.setAttribute('class', 'bezier-arm');
      handleGroup.appendChild(arm);
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', hx); dot.setAttribute('cy', hy);
      dot.setAttribute('r', HR);
      dot.setAttribute('class', 'bezier-handle');
      handleGroup.appendChild(dot);
    }
    svg.appendChild(handleGroup);
  }

  // Builds the full in-progress path: committed nodes plus an optional next node at cursor.
  // During drag, cursor is the handle position for the node being placed at downPt.
  function updatePreview(cursor) {
    let previewNodes = nodes;

    if (cursor) {
      if (downPt && isDragging) {
        const pending = {
          x: downPt.x, y: downPt.y,
          cpIn:  [2 * downPt.x - cursor.x, 2 * downPt.y - cursor.y],
          cpOut: [cursor.x, cursor.y],
        };
        previewNodes = [...nodes, pending];
      } else if (nodes.length > 0) {
        previewNodes = [...nodes, { x: cursor.x, y: cursor.y, cpIn: [cursor.x, cursor.y], cpOut: [cursor.x, cursor.y] }];
      }
    }

    if (previewNodes.length < 2) {
      previewPath?.remove(); previewPath = null;
      return;
    }

    if (!previewPath) {
      previewPath = document.createElementNS(NS, 'path');
      svg.appendChild(previewPath);
    }
    applyStyle(previewPath, getPreviewStyle());
    previewPath.setAttribute('d', openPathD(previewNodes));
  }

  // Commit to the store, routing to the continued layer or a new layer.
  function commitToStore(pathData, points, finalNodes, close) {
    if (continuingLayerIdx !== null) {
      store.apply(cmdUpdateLayer(motifId, continuingLayerIdx, {
        nodes: finalNodes,
        pathData,
        points,
      }));
    } else {
      onCommit(pathData, points, finalNodes);
    }
  }

  function commitPath(close) {
    if (nodes.length < 2) return;
    const pathData = close ? nodesToPathData(nodes) : openPathD(nodes);
    commitToStore(pathData, nodes.map((n) => [n.x, n.y]), nodes, close);
    clear();
  }

  // Commit as open path then clear — used by Esc and double-click.
  function commitRelease() {
    if (nodes.length >= 2) {
      commitToStore(openPathD(nodes), nodes.map((n) => [n.x, n.y]), nodes, false);
    }
    clear();
  }

  // Merge our current nodes + a terminal node into another layer.
  // terminalNode: { x, y, cpIn, cpOut } to append to our nodes first.
  // combineWith: function(ourNodes, theirNodes) → combinedNodes
  function commitMerge(targetLayerIdx, combinedNodes) {
    store.apply(cmdUpdateLayer(motifId, targetLayerIdx, {
      nodes: combinedNodes,
      pathData: openPathD(combinedNodes),
      points: combinedNodes.map((n) => [n.x, n.y]),
    }));
    clear();
  }

  function clear() {
    nodes = []; continuingLayerIdx = null;
    downPt = null; isDragging = false;
    previewPath?.remove(); previewPath = null;
    removeHandleGroup();
  }

  // --- add / delete / continue ---

  function getSelectedNodes() {
    if (!store || !motifId) return null;
    const sel = uiState.get('selectedLayer');
    if (!sel || sel.motifId !== motifId) return null;
    const layer = store.getState().motifs[motifId]?.layers[sel.index];
    if (!layer?.nodes?.length) return null;
    return { index: sel.index, nodes: layer.nodes };
  }

  function detectHoverMode(cursor, altKey) {
    if (nodes.length > 0) return null;

    // Check for 'continue': hover at the last node of any non-ruler path layer.
    // Checked before add/delete so the endpoint doesn't accidentally trigger add.
    if (!altKey && store && motifId) {
      const layers = getLayers();
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        if (layer.type === 'ruler' || !layer.nodes?.length) continue;
        const last = layer.nodes[layer.nodes.length - 1];
        if (Math.hypot(cursor.x - last.x, cursor.y - last.y) < VERTEX_HIT) {
          return { type: 'continue', layerIdx: li };
        }
      }
    }

    // add / delete on the selected layer
    const info = getSelectedNodes();
    if (!info) return null;
    const nds = info.nodes;

    for (let i = 0; i < nds.length; i++) {
      if (Math.hypot(cursor.x - nds[i].x, cursor.y - nds[i].y) < VERTEX_HIT) {
        return altKey ? { type: 'delete', vtxIdx: i, layerIdx: info.index } : null;
      }
    }

    for (let i = 0; i < nds.length; i++) {
      const j = (i + 1) % nds.length;
      const a = nds[i], b = nds[j];
      const { dist } = closestTOnSegment(cursor.x, cursor.y,
        [a.x, a.y], a.cpOut, b.cpIn, [b.x, b.y]);
      if (dist < SEG_HIT) {
        return { type: 'add', segIdx: i, t: closestTOnSegment(cursor.x, cursor.y,
          [a.x, a.y], a.cpOut, b.cpIn, [b.x, b.y]).t, layerIdx: info.index };
      }
    }
    return null;
  }

  function commitAddVertex({ segIdx, t, layerIdx }) {
    const info = getSelectedNodes();
    if (!info) return;
    const nds = info.nodes;
    const i = segIdx, j = (i + 1) % nds.length;
    const a = nds[i], b = nds[j];
    const sp = splitBezier(t, [a.x, a.y], a.cpOut, b.cpIn, [b.x, b.y]);

    const newNode = {
      x: sp.left.p1[0], y: sp.left.p1[1],
      cpIn: sp.left.c1, cpOut: sp.right.c0,
    };
    const newNodes = nds.map((n, k) => {
      if (k === i) return { ...n, cpOut: sp.left.c0 };
      if (k === j) return { ...n, cpIn:  sp.right.c1 };
      return n;
    });
    newNodes.splice(i + 1, 0, newNode);

    store.apply(cmdUpdateLayer(motifId, layerIdx, {
      nodes: newNodes,
      pathData: nodesToPathData(newNodes),
      points: newNodes.map((n) => [n.x, n.y]),
    }));
  }

  function commitDeleteVertex({ vtxIdx, layerIdx }) {
    const info = getSelectedNodes();
    if (!info || info.nodes.length <= 3) return;
    const newNodes = info.nodes.filter((_, i) => i !== vtxIdx);
    store.apply(cmdUpdateLayer(motifId, layerIdx, {
      nodes: newNodes,
      pathData: nodesToPathData(newNodes),
      points: newNodes.map((n) => [n.x, n.y]),
    }));
  }

  // Load an existing layer's nodes and start drawing from its end.
  function startContinuePath(layerIdx) {
    if (!store || !motifId) return;
    const layers = getLayers();
    const layer = layers[layerIdx];
    if (!layer?.nodes?.length) return;
    nodes = layer.nodes.map((n) => ({ ...n, cpIn: [...n.cpIn], cpOut: [...n.cpOut] }));
    continuingLayerIdx = layerIdx;
    downPt = null; isDragging = false;
    updatePreview(lastCursor);
  }

  // Check if snapped position is at either endpoint of another path layer.
  // Returns { layerIdx, atStart } or null.
  function findEndpointHit(snapped) {
    if (!store || !motifId) return null;
    const layers = getLayers();
    for (let li = 0; li < layers.length; li++) {
      if (li === continuingLayerIdx) continue;
      const layer = layers[li];
      if (layer.type === 'ruler' || !layer.nodes?.length || layer.nodes.length < 2) continue;
      const bNodes = layer.nodes;
      if (Math.hypot(snapped.x - bNodes[0].x, snapped.y - bNodes[0].y) < VERTEX_HIT) {
        return { layerIdx: li, atStart: true };
      }
      const last = bNodes[bNodes.length - 1];
      if (Math.hypot(snapped.x - last.x, snapped.y - last.y) < VERTEX_HIT) {
        return { layerIdx: li, atStart: false };
      }
    }
    return null;
  }

  function updateCursor(mode) {
    if (mode?.type === 'add' || mode?.type === 'continue') svg.style.cursor = CURSOR_PLUS;
    else if (mode?.type === 'delete')                      svg.style.cursor = CURSOR_MINUS;
    else                                                   svg.style.cursor = '';
  }

  // --- events ---

  function onPointerDown(e) {
    if (e.button !== 0) return;

    // Idle hover actions: recompute from click position (don't rely on stale hoverMode)
    if (nodes.length === 0) {
      const raw    = svgCoords(svg, e);
      const cursor = snapPt(raw, getLayers());
      const mode   = detectHoverMode(cursor, e.altKey);
      if (mode?.type === 'add')      { commitAddVertex(mode);              return; }
      if (mode?.type === 'delete')   { commitDeleteVertex(mode);           return; }
      if (mode?.type === 'continue') { startContinuePath(mode.layerIdx);  return; }
    }

    // Double-click = release (same as Esc)
    if (e.detail >= 2) { commitRelease(); return; }

    const raw     = svgCoords(svg, e);
    const snapped = snapPt(raw, getLayers());

    // Close path: click near our own start (≥3 nodes placed)
    if (nodes.length >= 3) {
      const d = Math.hypot(snapped.x - nodes[0].x, snapped.y - nodes[0].y);
      if (d < CLOSE_SNAP) { commitPath(true); return; }
    }

    // Connect to another path: click near either endpoint of any other layer
    if (nodes.length >= 1) {
      const hit = findEndpointHit(snapped);
      if (hit) {
        const layers = getLayers();
        const bNodes = layers[hit.layerIdx].nodes;
        const terminal = { x: snapped.x, y: snapped.y, cpIn: [snapped.x, snapped.y], cpOut: [snapped.x, snapped.y] };
        let combined;
        if (hit.atStart) {
          // our path ends at b0; combined = [our_nodes..terminal, b1..bM]
          combined = [...nodes, terminal, ...bNodes.slice(1)];
        } else {
          // our path ends at bM; combined = [b0..bM-1, reversed_our_nodes..terminal]
          combined = [...bNodes.slice(0, -1), ...reverseNodes([...nodes, terminal])];
        }
        commitMerge(hit.layerIdx, combined);
        return;
      }
    }

    downPt = snapped; isDragging = false;
    svg.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const raw    = svgCoords(svg, e);
    const cursor = snapPt(raw, getLayers());
    lastCursor   = cursor;

    if (downPt && (e.buttons & 1)) {
      const dist = Math.hypot(cursor.x - downPt.x, cursor.y - downPt.y);
      if (dist > DRAG_THRESH) {
        isDragging = true;
        showHandles(downPt, [cursor.x, cursor.y]);
        updatePreview(cursor);
      }
    } else {
      removeHandleGroup();
      hoverMode = detectHoverMode(cursor, e.altKey);
      updateCursor(hoverMode);
      updatePreview(cursor);
    }
  }

  function onPointerUp(e) {
    if (!downPt) return;
    const raw    = svgCoords(svg, e);
    const cursor = snapPt(raw, getLayers());
    const dist   = Math.hypot(cursor.x - downPt.x, cursor.y - downPt.y);

    let newNode;
    if (isDragging && dist > DRAG_THRESH) {
      newNode = {
        x: downPt.x, y: downPt.y,
        cpOut: [cursor.x, cursor.y],
        cpIn:  [2 * downPt.x - cursor.x, 2 * downPt.y - cursor.y],
      };
    } else {
      newNode = { x: downPt.x, y: downPt.y, cpIn: [downPt.x, downPt.y], cpOut: [downPt.x, downPt.y] };
    }

    nodes.push(newNode);
    downPt = null; isDragging = false;
    removeHandleGroup();
    updatePreview(lastCursor);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { commitRelease(); return; }
    if (e.key === 'Enter')  { commitPath(true); return; }
    if (e.key === 'Alt' && lastCursor && nodes.length === 0) {
      hoverMode = detectHoverMode(lastCursor, true);
      updateCursor(hoverMode);
    }
  }

  function onKeyUp(e) {
    if (e.key === 'Alt' && lastCursor && nodes.length === 0) {
      hoverMode = detectHoverMode(lastCursor, false);
      updateCursor(hoverMode);
    }
  }

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
    svg.style.cursor = '';
    clear();
  };
}
