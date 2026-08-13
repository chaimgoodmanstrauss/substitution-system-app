// Shared utilities for motif-panel tools.
// Import from here rather than duplicating across tool files.

const NS  = 'http://www.w3.org/2000/svg';
const AH  = 0.018; // anchor square half-size in SVG units

export function svgCoords(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

// Returns the visual path element for a layer (not the invisible hit area).
export function getPathEl(svg, index) {
  return svg.querySelector(`[data-layer-index="${index}"]:not([data-hit])`);
}

// Clones a layer's path element as an opt+drag ghost. Returns the element or null.
export function makeGhost(svg, index) {
  const orig = getPathEl(svg, index);
  if (!orig) return null;
  const g = orig.cloneNode(true);
  g.classList.add('drag-ghost');
  delete g.dataset.layerIndex;
  g.dataset.ghost = '1';
  svg.appendChild(g);
  return g;
}

// Manages a <g> of anchor squares for the nodes of a selected shape.
// draw(nodes, selIdx?) — redraw squares; selIdx (optional) highlights one node.
// clear() — empty the group.
// remove() — detach group from SVG.
export function AnchorLayer(svg) {
  const g = document.createElementNS(NS, 'g');
  svg.appendChild(g);
  return {
    el: g,
    draw(nodes, selIdx = null) {
      g.innerHTML = '';
      if (!nodes) return;
      nodes.forEach((node, i) => {
        const isSel = selIdx !== null && i === selIdx;
        const sq = document.createElementNS(NS, 'rect');
        sq.setAttribute('x', node.x - AH); sq.setAttribute('y', node.y - AH);
        sq.setAttribute('width', AH * 2);  sq.setAttribute('height', AH * 2);
        sq.setAttribute('class', isSel ? 'anchor-pt anchor-pt--sel' : 'anchor-pt');
        sq.dataset.nodeIndex = i;
        g.appendChild(sq);
      });
    },
    clear() { g.innerHTML = ''; },
    remove() { g.remove(); },
  };
}

// Crosshair indicator for rotation/scale/reflection center.
export function buildCrosshair(x, y) {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'transform-center');
  const R = 0.06;
  for (const [x1, y1, x2, y2] of [[x-R,y,x+R,y],[x,y-R,x,y+R]]) {
    const ln = document.createElementNS(NS, 'line');
    ln.setAttribute('x1',x1); ln.setAttribute('y1',y1);
    ln.setAttribute('x2',x2); ln.setAttribute('y2',y2);
    ln.setAttribute('class','center-line');
    g.appendChild(ln);
  }
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx',x); dot.setAttribute('cy',y);
  dot.setAttribute('r','0.018'); dot.setAttribute('class','center-dot');
  g.appendChild(dot);
  return g;
}
