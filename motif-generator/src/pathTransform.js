// Parse and transform SVG path data (M, L, C, A, Z) and bezier node structures.

function tokenize(d) {
  const tokens = [];
  const re = /([MmLlCcAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : parseFloat(m[2]));
  }
  return tokens;
}

function parseSegs(d) {
  const tokens = tokenize(d);
  const segs = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'L') {
      segs.push({ cmd, x: tokens[i++], y: tokens[i++] });
    } else if (cmd === 'C') {
      segs.push({ cmd: 'C', cp1x: tokens[i++], cp1y: tokens[i++], cp2x: tokens[i++], cp2y: tokens[i++], x: tokens[i++], y: tokens[i++] });
    } else if (cmd === 'A') {
      segs.push({ cmd: 'A', rx: tokens[i++], ry: tokens[i++], xr: tokens[i++], la: tokens[i++], sw: tokens[i++], x: tokens[i++], y: tokens[i++] });
    } else if (cmd === 'Z' || cmd === 'z') {
      segs.push({ cmd: 'Z' });
    }
  }
  return segs;
}

function fmt(n) { return +n.toFixed(6); }

function emitSegs(segs) {
  return segs.map((s) => {
    if (s.cmd === 'M' || s.cmd === 'L') return `${s.cmd} ${fmt(s.x)} ${fmt(s.y)}`;
    if (s.cmd === 'C') return `C ${fmt(s.cp1x)} ${fmt(s.cp1y)} ${fmt(s.cp2x)} ${fmt(s.cp2y)} ${fmt(s.x)} ${fmt(s.y)}`;
    if (s.cmd === 'A') return `A ${fmt(s.rx)} ${fmt(s.ry)} ${s.xr} ${s.la} ${s.sw} ${fmt(s.x)} ${fmt(s.y)}`;
    return s.cmd;
  }).join(' ');
}

export function translatePath(d, dx, dy) {
  return emitSegs(parseSegs(d).map((s) => {
    if (s.cmd === 'M' || s.cmd === 'L') return { ...s, x: s.x + dx, y: s.y + dy };
    if (s.cmd === 'C') return { ...s, cp1x: s.cp1x + dx, cp1y: s.cp1y + dy, cp2x: s.cp2x + dx, cp2y: s.cp2y + dy, x: s.x + dx, y: s.y + dy };
    if (s.cmd === 'A') return { ...s, x: s.x + dx, y: s.y + dy };
    return s;
  }));
}

// Affine transform: x' = a*x + c*y + e,  y' = b*x + d*y + f
export function transformPath(d, a, b, c, dd, e, f) {
  const scaleX = Math.sqrt(a * a + b * b);
  const scaleY = Math.sqrt(c * c + dd * dd);
  return emitSegs(parseSegs(d).map((s) => {
    if (s.cmd === 'M' || s.cmd === 'L') {
      return { ...s, x: a * s.x + c * s.y + e, y: b * s.x + dd * s.y + f };
    }
    if (s.cmd === 'C') {
      return { ...s,
        cp1x: a * s.cp1x + c * s.cp1y + e, cp1y: b * s.cp1x + dd * s.cp1y + f,
        cp2x: a * s.cp2x + c * s.cp2y + e, cp2y: b * s.cp2x + dd * s.cp2y + f,
        x: a * s.x + c * s.y + e, y: b * s.x + dd * s.y + f,
      };
    }
    if (s.cmd === 'A') {
      return { ...s,
        x: a * s.x + c * s.y + e,
        y: b * s.x + dd * s.y + f,
        rx: Math.abs(s.rx * scaleX),
        ry: Math.abs(s.ry * scaleY),
      };
    }
    return s;
  }));
}

// Bounding box from a layer's points array.
export function pointsBBox(points) {
  if (!points || points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ---- Bezier node helpers ----
// A node: { x, y, cpOut: [x,y], cpIn: [x,y] }
// cpOut = outgoing control point (first CP of the cubic segment to the NEXT node)
// cpIn  = incoming control point (second CP of the cubic segment FROM the prev node)

// Build SVG path data from a closed bezier node array.
export function nodesToPathData(nodes) {
  if (!nodes || nodes.length === 0) return '';
  const parts = [`M ${fmt(nodes[0].x)} ${fmt(nodes[0].y)}`];
  for (let i = 0; i < nodes.length; i++) {
    const cur = nodes[i];
    const next = nodes[(i + 1) % nodes.length];
    parts.push(`C ${fmt(cur.cpOut[0])} ${fmt(cur.cpOut[1])} ${fmt(next.cpIn[0])} ${fmt(next.cpIn[1])} ${fmt(next.x)} ${fmt(next.y)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

export function translateNodes(nodes, dx, dy) {
  return nodes.map((n) => ({
    ...n, x: n.x + dx, y: n.y + dy,
    cpIn:  [n.cpIn[0]  + dx, n.cpIn[1]  + dy],
    cpOut: [n.cpOut[0] + dx, n.cpOut[1] + dy],
  }));
}

export function transformNodes(nodes, a, b, c, dd, e, f) {
  const pt = ([x, y]) => [a * x + c * y + e, b * x + dd * y + f];
  return nodes.map((n) => ({
    ...n,
    x: a * n.x + c * n.y + e,
    y: b * n.x + dd * n.y + f,
    cpIn:  pt(n.cpIn),
    cpOut: pt(n.cpOut),
  }));
}

// ---- Shape node constructors ----

export function rectNodes(x0, y0, x1, y1) {
  const c = (x, y) => ({ x, y, cpIn: [x, y], cpOut: [x, y] });
  return [c(x0, y0), c(x1, y0), c(x1, y1), c(x0, y1)];
}

const K = 0.5523; // cubic bezier quarter-circle approximation constant

export function ellipseNodes(cx, cy, rx, ry) {
  return [
    { x: cx + rx, y: cy,      cpIn: [cx + rx, cy + ry * K], cpOut: [cx + rx, cy - ry * K] },
    { x: cx,      y: cy - ry, cpIn: [cx + rx * K, cy - ry], cpOut: [cx - rx * K, cy - ry] },
    { x: cx - rx, y: cy,      cpIn: [cx - rx, cy - ry * K], cpOut: [cx - rx, cy + ry * K] },
    { x: cx,      y: cy + ry, cpIn: [cx - rx * K, cy + ry], cpOut: [cx + rx * K, cy + ry] },
  ];
}

export function polyNodes(pts) {
  return pts.map(([x, y]) => ({ x, y, cpIn: [x, y], cpOut: [x, y] }));
}

// Snap {x,y} to the nearest vertex across all layers within threshold.
export function snapPt(p, layers, threshold = 0.05) {
  let best = p, bestD = threshold;
  for (const layer of layers) {
    for (const [vx, vy] of layer.points ?? []) {
      const d = Math.hypot(p.x - vx, p.y - vy);
      if (d < bestD) { bestD = d; best = { x: vx, y: vy }; }
    }
  }
  return best;
}
