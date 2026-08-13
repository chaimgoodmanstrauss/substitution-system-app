// Scale tool: first click+drag sets the origin AND scales. Subsequent drags
// scale from the same origin. Shift = uniform scale. Esc clears origin.
// Opt+click opens numeric dialog (value in %, e.g. 150 = 1.5×).
// Opt+drag duplicates — original stays, copy is scaled.
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

// During scale drag: find {sx,sy} correction so a scaled vertex snaps to a nearby target.
function findScaleSnap(ox, oy, origNodes, currentSx, currentSy, targetPts, selPts, uniform, threshold = 0.045) {
  let bestPatch = null, bestDist = threshold;
  for (const node of origNodes) {
    const scaledX = ox + currentSx * (node.x - ox);
    const scaledY = oy + currentSy * (node.y - oy);
    for (const [tx, ty] of targetPts) {
      if (selPts.has(`${tx},${ty}`)) continue;
      const dist = Math.hypot(scaledX - tx, scaledY - ty);
      if (dist < bestDist) {
        bestDist = dist;
        const dxOrig = node.x - ox, dyOrig = node.y - oy;
        const dxTgt  = tx - ox,    dyTgt  = ty - oy;
        if (uniform) {
          const R2 = dxOrig*dxOrig + dyOrig*dyOrig;
          if (R2 < 1e-10) continue;
          const s = (dxTgt*dxOrig + dyTgt*dyOrig) / R2;
          bestPatch = { sx: s, sy: s };
        } else {
          const snapSx = Math.abs(dxOrig) > 1e-5 ? dxTgt / dxOrig : currentSx;
          const snapSy = Math.abs(dyOrig) > 1e-5 ? dyTgt / dyOrig : currentSy;
          bestPatch = { sx: snapSx, sy: snapSy };
        }
      }
    }
  }
  return bestPatch;
}

function doScale(ox, oy, sx, sy, origPathData, origPoints, origNodes) {
  const e = ox*(1-sx), f = oy*(1-sy);
  return {
    newPathData: transformPath(origPathData, sx, 0, 0, sy, e, f),
    newPoints:   origPoints.map(([px,py]) => [sx*px+e, sy*py+f]),
    newNodes:    origNodes ? transformNodes(origNodes, sx, 0, 0, sy, e, f) : null,
  };
}

export function activate(svg, motifId, store) {
  let origin   = null;
  let originEl = null;
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

  function showOrigin(x, y) {
    origin = [x,y]; originEl?.remove();
    originEl = buildCrosshair(x, y); svg.appendChild(originEl);
  }

  function clearOrigin() { origin = null; originEl?.remove(); originEl = null; }

  function removeGhost() { ghost?.remove(); ghost = null; }

  function ensureGhost(index) {
    if (!ghost) ghost = makeGhost(svg, index);
  }

  function startDrag(e, ox, oy) {
    const info = getSelLayerInfo();
    if (!info) return;
    const p = svgCoords(svg, e);
    dragState = {
      start: p, ox, oy, selIndex: info.index,
      origPathData: info.layer.pathData,
      origPoints:   [...(info.layer.points ?? [])],
      origNodes:    info.layer.nodes?.map((n) => ({...n, cpIn:[...n.cpIn], cpOut:[...n.cpOut]})) ?? null,
    };
    svg.setPointerCapture(e.pointerId);
  }

  function getScaleFactors(p, e) {
    const { ox, oy, start } = dragState;
    const startDist = Math.hypot(start.x-ox, start.y-oy);
    if (startDist < 1e-5) return { sx: 1, sy: 1 };
    if (e.shiftKey) {
      const s = Math.hypot(p.x-ox, p.y-oy) / startDist;
      return { sx: s, sy: s };
    }
    return { sx: (p.x-ox)/(start.x-ox) || 1, sy: (p.y-oy)/(start.y-oy) || 1 };
  }

  function commitScale(ox, oy, sx, sy, info, duplicate) {
    const { newPathData, newPoints, newNodes } = doScale(ox, oy, sx, sy, info.layer.pathData, info.layer.points ?? [], info.layer.nodes ?? null);
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

    if (!origin) {
      const snapped = snapToVertex(raw, getAllSnapPoints());
      showOrigin(snapped.x, snapped.y);
      startDrag(e, snapped.x, snapped.y);
      return;
    }
    startDrag(e, origin[0], origin[1]);
  }

  function onPointerMove(e) {
    if (!dragState) return;
    const p = svgCoords(svg, e);
    let { sx, sy } = getScaleFactors(p, e);
    const selPts = new Set((getAllLayers()[dragState.selIndex]?.points ?? []).map(([x,y]) => `${x},${y}`));
    const snap = findScaleSnap(dragState.ox, dragState.oy, dragState.origNodes ?? [], sx, sy, getAllSnapPoints(), selPts, e.shiftKey);
    if (snap) { sx = snap.sx; sy = snap.sy; }
    const { newPathData, newNodes } = doScale(dragState.ox, dragState.oy, sx, sy, dragState.origPathData, dragState.origPoints, dragState.origNodes);
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
      const [ox, oy] = [dragState.ox, dragState.oy];
      dragState = null;
      refreshAnchors();
      if (info) {
        showTransformDialog({ screenX: e.clientX, screenY: e.clientY, unit: '%', defaultVal: '100' })
          .then(({ action, value }) => {
            if (action === 'cancel' || value === null) return;
            commitScale(ox, oy, value, value, info, action === 'copy');
          });
      }
      return;
    }

    let { sx, sy } = getScaleFactors(p, e);
    const selPts2 = new Set((getAllLayers()[dragState.selIndex]?.points ?? []).map(([x,y]) => `${x},${y}`));
    const snap = findScaleSnap(dragState.ox, dragState.oy, dragState.origNodes ?? [], sx, sy, getAllSnapPoints(), selPts2, e.shiftKey);
    if (snap) { sx = snap.sx; sy = snap.sy; }
    removeGhost();
    const info = getSelLayerInfo();
    if (info && Math.abs(sx-1) + Math.abs(sy-1) > 1e-4) {
      commitScale(dragState.ox, dragState.oy, sx, sy, info, e.altKey);
    }
    dragState = null;
    uiState.set('livePatch', null);
    uiState.set('liveGhost', null);
    refreshAnchors();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { clearOrigin(); removeGhost(); dragState = null; uiState.set('liveGhost', null); refreshAnchors(); }
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
    clearOrigin(); removeGhost();
    uiState.set('liveGhost', null);
    anchors.remove();
    offSel(); unsubStr();
    dragState = null;
  };
}
