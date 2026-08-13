// Reflect tool (O). Click sets the axis origin (snaps to vertices/ruler); dragging
// defines the axis direction through that point. Release commits the reflection.
// Shift: constrains axis to 0°/45°/90° etc. Opt+release: duplicate.
// Opt+click: numeric dialog (angle of axis in °).
// Anchor squares stay visible on selected path while tool is active.
import { cmdUpdateLayer, cmdAddLayer } from '../model.js';
import { uiState } from '../ui/uiState.js';
import { transformPath, transformNodes } from '../pathTransform.js';
import { showTransformDialog } from '../ui/transformDialog.js';
import { svgCoords, getPathEl, buildCrosshair, makeGhost, AnchorLayer } from './shared.js';

const NS   = 'http://www.w3.org/2000/svg';
const SNAP = 0.05;

// Reflection across the line through (cx,cy) at angle theta (radians from x-axis).
function doReflect(cx, cy, theta, origPathData, origPoints, origNodes) {
  const c2 = Math.cos(2*theta), s2 = Math.sin(2*theta);
  const e = cx*(1-c2) - cy*s2;
  const f = -cx*s2 + cy*(1+c2);
  return {
    newPathData: transformPath(origPathData, c2, s2, s2, -c2, e, f),
    newPoints:   origPoints.map(([px,py]) => [c2*px+s2*py+e, s2*px-c2*py+f]),
    newNodes:    origNodes ? transformNodes(origNodes, c2, s2, s2, -c2, e, f) : null,
  };
}

function snapToPoint(p, allPoints) {
  let best = p, bestD = SNAP;
  for (const [vx, vy] of allPoints) {
    const d = Math.hypot(p.x-vx, p.y-vy);
    if (d < bestD) { bestD = d; best = {x:vx, y:vy}; }
  }
  return best;
}

export function activate(svg, motifId, store) {
  let center   = null;
  let centerEl = null;
  let axisLine = null;
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

  function clearCenter() {
    center = null; centerEl?.remove(); centerEl = null;
    axisLine?.remove(); axisLine = null;
  }

  function showAxisLine(cx, cy, theta) {
    axisLine?.remove();
    const EXT = 0.8;
    const ln = document.createElementNS(NS, 'line');
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    ln.setAttribute('x1', cx - EXT*cosT); ln.setAttribute('y1', cy - EXT*sinT);
    ln.setAttribute('x2', cx + EXT*cosT); ln.setAttribute('y2', cy + EXT*sinT);
    ln.setAttribute('class', 'reflect-axis');
    axisLine = ln;
    svg.appendChild(ln);
  }

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

  function axisAngle(p, ds, shiftKey) {
    let theta = Math.atan2(p.y-ds.cy, p.x-ds.cx);
    if (shiftKey) theta = Math.round(theta / (Math.PI/4)) * (Math.PI/4);
    return theta;
  }

  function commitReflect(cx, cy, theta, info, duplicate) {
    const { newPathData, newPoints, newNodes } = doReflect(cx, cy, theta, info.layer.pathData, info.layer.points ?? [], info.layer.nodes ?? null);
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
    if (e.altKey) e.preventDefault();
    const raw = svgCoords(svg, e);

    if (!center) {
      const snapped = snapToPoint(raw, getAllSnapPoints());
      showCenter(snapped.x, snapped.y);
      startDrag(e, snapped.x, snapped.y);
      return;
    }
    startDrag(e, center[0], center[1]);
  }

  function onPointerMove(e) {
    if (!dragState) return;
    const p = svgCoords(svg, e);
    const theta = axisAngle(p, dragState, e.shiftKey);
    showAxisLine(dragState.cx, dragState.cy, theta);
    const { newPathData, newNodes } = doReflect(dragState.cx, dragState.cy, theta, dragState.origPathData, dragState.origPoints, dragState.origNodes);
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
    const moveDist = Math.hypot(p.x - dragState.start.x, p.y - dragState.start.y);

    if (e.altKey && moveDist < 0.01) {
      removeGhost();
      getPathEl(svg, dragState.selIndex)?.setAttribute('d', dragState.origPathData);
      uiState.set('livePatch', null);
      const info = getSelLayerInfo();
      const [cx, cy] = [dragState.cx, dragState.cy];
      dragState = null;
      refreshAnchors();
      if (info) {
        showTransformDialog({ screenX: e.clientX, screenY: e.clientY, unit: '°', defaultVal: '0' })
          .then(({ action, value }) => {
            if (action === 'cancel' || value === null) return;
            commitReflect(cx, cy, value * Math.PI / 180, info, action === 'copy');
          });
      }
      return;
    }

    const theta = axisAngle(p, dragState, e.shiftKey);
    removeGhost();
    const info = getSelLayerInfo();
    const dragDist = Math.hypot(p.x - dragState.cx, p.y - dragState.cy);
    if (info && dragDist > 1e-4) {
      commitReflect(dragState.cx, dragState.cy, theta, info, e.altKey);
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
