// Rotate tool. First click+drag sets the center AND starts rotation. Subsequent drags
// reuse the same center. Esc clears. Opt+click opens numeric dialog.
// Opt+drag duplicates — original stays, copy is rotated.
// Anchor squares stay visible on the selected path while this tool is active.
import { cmdUpdateLayer, cmdAddLayer } from '../model.js';
import { uiState } from '../ui/uiState.js';
import { transformPath, transformNodes } from '../pathTransform.js';
import { showTransformDialog } from '../ui/transformDialog.js';
import { svgCoords, getPathEl, buildCrosshair, makeGhost, AnchorLayer } from './shared.js';

const SNAP = 0.05;

// Snap a click position to the nearest point in a flat [[x,y]] array
function snapToVertex(p, pts) {
  let best = p, bestD = SNAP;
  for (const [vx, vy] of pts) {
    const d = Math.hypot(p.x-vx, p.y-vy);
    if (d < bestD) { bestD = d; best = {x:vx, y:vy}; }
  }
  return best;
}

// During rotation drag: find the angle correction that snaps a rotated vertex to a nearby target.
function findRotateSnap(cx, cy, origNodes, currentAngle, targetPts, selPts, threshold = 0.045) {
  let bestDelta = null, bestDist = threshold;
  for (const node of origNodes) {
    const dx = node.x - cx, dy = node.y - cy;
    const R = Math.hypot(dx, dy);
    if (R < 1e-5) continue;
    const phi = Math.atan2(dy, dx);
    const rotX = cx + R * Math.cos(phi + currentAngle);
    const rotY = cy + R * Math.sin(phi + currentAngle);
    for (const [tx, ty] of targetPts) {
      if (selPts.has(`${tx},${ty}`)) continue;
      const dist = Math.hypot(rotX - tx, rotY - ty);
      if (dist < bestDist) {
        bestDist = dist;
        bestDelta = Math.atan2(ty - cy, tx - cx) - phi - currentAngle;
      }
    }
  }
  return bestDelta;
}

function doRotate(cx, cy, angle, origPathData, origPoints, origNodes) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const e = cx*(1-cos)+cy*sin, f = cy*(1-cos)-cx*sin;
  return {
    newPathData: transformPath(origPathData, cos, sin, -sin, cos, e, f),
    newPoints:   origPoints.map(([px,py]) => [cos*px-sin*py+e, sin*px+cos*py+f]),
    newNodes:    origNodes ? transformNodes(origNodes, cos, sin, -sin, cos, e, f) : null,
  };
}

export function activate(svg, motifId, store) {
  let center   = null;
  let centerEl = null;
  let dragState = null;
  let ghost     = null;

  const anchors = AnchorLayer(svg);

  function refreshAnchors(liveNodes) {
    if (Array.isArray(liveNodes)) { anchors.draw(liveNodes); return; }
    const sel = uiState.get('selectedLayer');
    if (!sel || sel.motifId !== motifId) { anchors.clear(); return; }
    anchors.draw(store.getState().motifs[motifId]?.layers[sel.index]?.nodes ?? []);
  }

  refreshAnchors();
  const offSel   = uiState.on('selectedLayer', refreshAnchors);
  const unsubStr = store.subscribe(() => { if (!dragState) refreshAnchors(); });

  function getAllLayers() { return store.getState().motifs[motifId]?.layers ?? []; }

  function getAllSnapPoints() {
    return (store.getState().motifs[motifId]?.layers ?? []).flatMap((l) => l.points ?? []);
  }

  function getSelLayerInfo() {
    const sel = uiState.get('selectedLayer');
    if (!sel || sel.motifId !== motifId) return null;
    const layer = store.getState().motifs[motifId]?.layers[sel.index];
    return layer ? { index: sel.index, layer } : null;
  }

  function showCenter(x, y) {
    center = [x,y]; centerEl?.remove();
    centerEl = buildCrosshair(x, y); svg.appendChild(centerEl);
  }

  function clearCenter() { center = null; centerEl?.remove(); centerEl = null; }

  function removeGhost() { ghost?.remove(); ghost = null; }

  function ensureGhost(index) {
    if (!ghost) ghost = makeGhost(svg, index);
  }

  function startDrag(e, cx, cy) {
    const info = getSelLayerInfo();
    if (!info) return;
    const p = svgCoords(svg, e);
    dragState = {
      start: p, cx, cy, selIndex: info.index,
      origPathData: info.layer.pathData,
      origPoints:   [...(info.layer.points ?? [])],
      origNodes:    info.layer.nodes?.map((n) => ({...n, cpIn:[...n.cpIn], cpOut:[...n.cpOut]})) ?? null,
    };
    svg.setPointerCapture(e.pointerId);
  }

  function currentAngle(p, ds) {
    return Math.atan2(p.y-ds.cy, p.x-ds.cx) - Math.atan2(ds.start.y-ds.cy, ds.start.x-ds.cx);
  }

  function applyAndCommit(cx, cy, angle, info, duplicate) {
    const { newPathData, newPoints, newNodes } = doRotate(cx, cy, angle, info.layer.pathData, info.layer.points ?? [], info.layer.nodes ?? null);
    const patch = { pathData: newPathData, points: newPoints };
    if (newNodes) patch.nodes = newNodes;
    if (duplicate) {
      store.apply(cmdAddLayer(motifId, { ...info.layer, ...patch }));
    } else {
      store.apply(cmdUpdateLayer(motifId, info.index, patch));
    }
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const raw = svgCoords(svg, e);
    if (e.altKey) e.preventDefault();

    if (!center) {
      const snapped = snapToVertex(raw, getAllSnapPoints());
      showCenter(snapped.x, snapped.y);
      startDrag(e, snapped.x, snapped.y);
      return;
    }
    startDrag(e, center[0], center[1]);
  }

  function onPointerMove(e) {
    if (!dragState) return;
    const p = svgCoords(svg, e);
    let angle = currentAngle(p, dragState);
    if (e.shiftKey) {
      angle = Math.round(angle / (Math.PI/4)) * (Math.PI/4);
    } else {
      const selPts = new Set((getAllLayers()[dragState.selIndex]?.points ?? []).map(([x,y]) => `${x},${y}`));
      const delta = findRotateSnap(dragState.cx, dragState.cy, dragState.origNodes ?? [], angle, getAllSnapPoints(), selPts);
      if (delta !== null) angle += delta;
    }
    const { newPathData, newNodes } = doRotate(dragState.cx, dragState.cy, angle, dragState.origPathData, dragState.origPoints, dragState.origNodes);
    if (e.altKey) {
      ensureGhost(dragState.selIndex);
      ghost?.setAttribute('d', newPathData);
      getPathEl(svg, dragState.selIndex)?.setAttribute('d', dragState.origPathData);
      uiState.set('livePatch', { motifId, index: dragState.selIndex, pathData: dragState.origPathData });
      uiState.set('liveGhost', { pathData: newPathData });
      refreshAnchors(dragState.origNodes);
    } else {
      removeGhost();
      getPathEl(svg, dragState.selIndex)?.setAttribute('d', newPathData);
      uiState.set('livePatch', { motifId, index: dragState.selIndex, pathData: newPathData });
      uiState.set('liveGhost', null);
      refreshAnchors(newNodes);
    }
  }

  function onPointerUp(e) {
    if (!dragState) return;
    const p = svgCoords(svg, e);
    const dist = Math.hypot(p.x - dragState.start.x, p.y - dragState.start.y);

    if (e.altKey && dist < 0.01) {
      removeGhost();
      getPathEl(svg, dragState.selIndex)?.setAttribute('d', dragState.origPathData);
      uiState.set('livePatch', null);
      const info = getSelLayerInfo();
      const [cx, cy] = [dragState.cx, dragState.cy];
      dragState = null;
      refreshAnchors();
      if (info) {
        showTransformDialog({ screenX: e.clientX, screenY: e.clientY, unit: '°', defaultVal: '45' })
          .then(({ action, value }) => {
            if (action === 'cancel' || value === null) return;
            applyAndCommit(cx, cy, value * Math.PI / 180, info, action === 'copy');
          });
      }
      return;
    }

    let angle = currentAngle(p, dragState);
    if (e.shiftKey) {
      angle = Math.round(angle / (Math.PI/4)) * (Math.PI/4);
    } else {
      const selPts = new Set((getAllLayers()[dragState.selIndex]?.points ?? []).map(([x,y]) => `${x},${y}`));
      const delta = findRotateSnap(dragState.cx, dragState.cy, dragState.origNodes ?? [], angle, getAllSnapPoints(), selPts);
      if (delta !== null) angle += delta;
    }
    removeGhost();
    if (Math.abs(angle) > 1e-4) {
      const info = getSelLayerInfo();
      if (info) applyAndCommit(dragState.cx, dragState.cy, angle, info, e.altKey);
    }
    dragState = null;
    uiState.set('livePatch', null);
    uiState.set('liveGhost', null);
    refreshAnchors();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { clearCenter(); removeGhost(); dragState = null; uiState.set('liveGhost', null); refreshAnchors(); }
  }

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup',   onPointerUp);
  document.addEventListener('keydown', onKeyDown);

  return function deactivate() {
    svg.removeEventListener('pointerdown', onPointerDown);
    svg.removeEventListener('pointermove', onPointerMove);
    svg.removeEventListener('pointerup',   onPointerUp);
    document.removeEventListener('keydown', onKeyDown);
    clearCenter(); removeGhost();
    uiState.set('liveGhost', null);
    anchors.remove();
    offSel(); unsubStr();
    dragState = null;
  };
}
