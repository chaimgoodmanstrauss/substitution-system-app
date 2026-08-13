import { ellipseNodes, nodesToPathData, snapPt } from '../pathTransform.js';

const NS = 'http://www.w3.org/2000/svg';

function svgCoords(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function applyStyle(el, style) {
  if (style.outline) {
    el.setAttribute('class', 'tool-preview tool-preview--outline');
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

export function activate(svg, onCommit, getPreviewStyle = () => ({ outline: true }), getLayers = () => []) {
  let start = null;
  let preview = null;

  function onPointerDown(e) {
    e.preventDefault();
    const raw = svgCoords(svg, e);
    // Snap the anchor corner of the bounding box
    start = snapPt(raw, getLayers());
    preview = document.createElementNS(NS, 'ellipse');
    applyStyle(preview, getPreviewStyle());
    svg.appendChild(preview);
    svg.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!start) return;
    const raw = svgCoords(svg, e);
    const { x, y } = snapPt(raw, getLayers());
    preview.setAttribute('cx', (start.x + x) / 2);
    preview.setAttribute('cy', (start.y + y) / 2);
    preview.setAttribute('rx', Math.abs(x - start.x) / 2);
    preview.setAttribute('ry', Math.abs(y - start.y) / 2);
  }

  function onPointerUp(e) {
    if (!start) return;
    const raw = svgCoords(svg, e);
    const { x, y } = snapPt(raw, getLayers());
    preview.remove(); preview = null;
    const cx = (start.x + x) / 2, cy = (start.y + y) / 2;
    const rx = Math.abs(x - start.x) / 2, ry = Math.abs(y - start.y) / 2;
    start = null;
    if (rx < 0.01 || ry < 0.01) return;
    const nodes = ellipseNodes(cx, cy, rx, ry);
    const pathData = nodesToPathData(nodes);
    onCommit(pathData, nodes.map((n) => [n.x, n.y]), nodes);
  }

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);

  return function deactivate() {
    svg.removeEventListener('pointerdown', onPointerDown);
    svg.removeEventListener('pointermove', onPointerMove);
    svg.removeEventListener('pointerup', onPointerUp);
    preview?.remove(); preview = null; start = null;
  };
}
