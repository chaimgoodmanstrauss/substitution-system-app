import { rectNodes, nodesToPathData, snapPt } from '../pathTransform.js';

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
    start = snapPt(raw, getLayers());
    preview = document.createElementNS(NS, 'rect');
    applyStyle(preview, getPreviewStyle());
    svg.appendChild(preview);
    svg.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!start) return;
    const raw = svgCoords(svg, e);
    const { x, y } = snapPt(raw, getLayers());
    preview.setAttribute('x', Math.min(start.x, x));
    preview.setAttribute('y', Math.min(start.y, y));
    preview.setAttribute('width', Math.abs(x - start.x));
    preview.setAttribute('height', Math.abs(y - start.y));
  }

  function onPointerUp(e) {
    if (!start) return;
    const raw = svgCoords(svg, e);
    const { x, y } = snapPt(raw, getLayers());
    preview.remove(); preview = null;
    const x0 = Math.min(start.x, x), y0 = Math.min(start.y, y);
    const x1 = Math.max(start.x, x), y1 = Math.max(start.y, y);
    start = null;
    if (x1 - x0 < 0.02 || y1 - y0 < 0.02) return;
    const nodes = rectNodes(x0, y0, x1, y1);
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
