// Pure math, no DOM. Transforms are full 3x3 homogeneous matrices:
//   [ m00 m01 m02 ]   [x]
//   [ m10 m11 m12 ] · [y]
//   [ m20 m21 m22 ]   [1]
// with a perspective divide in applyToPoint (x' = x'/w', y' = y'/w'). This is
// the general projective-transform representation: composition is ordinary
// matrix multiplication (compose), and invert is a general 3x3 inverse — both
// work for any matrix, not just the affine ones every constructor here
// actually produces. The `affine(a,b,c,d,e,f)` constructor builds the affine
// special case (bottom row [0,0,1], same SVG matrix() convention as before:
// x'=a*x+c*y+e, y'=b*x+d*y+f), which is what similarityFromTwoPoints and
// translationToMatch use today. A true projective constructor (e.g. a
// 4-point-correspondence homography) isn't implemented yet — this is the
// socket for it: nothing downstream (compose/invert/applyToPoint, or the
// reptiling/combinatorial algorithms below) needs to change to support one.

const EPSILON = 1e-9;

export const STANDARD_SEGMENT = { p0: [0, 0], p1: [1, 0] };

// ---- complex-number helpers, used only inside similarityFromTwoPoints ----

function cMul([ar, ai], [br, bi]) {
  return [ar * br - ai * bi, ar * bi + ai * br];
}
function cSub([ar, ai], [br, bi]) {
  return [ar - br, ai - bi];
}
function cConj([ar, ai]) {
  return [ar, -ai];
}
function cAbs2([ar, ai]) {
  return ar * ar + ai * ai;
}
function cDiv(p, q) {
  const denom = cAbs2(q);
  if (denom < EPSILON) {
    throw new Error('geometry: division by a zero-length vector (degenerate ruler?)');
  }
  const num = cMul(p, cConj(q));
  return [num[0] / denom, num[1] / denom];
}

// ---- general 3x3 homogeneous transform ----

export function identity() {
  return { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0, m20: 0, m21: 0, m22: 1 };
}

// Builds the affine special case: x'=a*x+c*y+e, y'=b*x+d*y+f (bottom row fixed
// at [0,0,1] — no perspective). Same parameter convention as SVG's matrix().
export function affine(a, b, c, d, e, f) {
  return { m00: a, m01: c, m02: e, m10: b, m11: d, m12: f, m20: 0, m21: 0, m22: 1 };
}

export function applyToPoint(t, [x, y]) {
  const xp = t.m00 * x + t.m01 * y + t.m02;
  const yp = t.m10 * x + t.m11 * y + t.m12;
  const wp = t.m20 * x + t.m21 * y + t.m22;
  if (Math.abs(wp) < EPSILON) {
    throw new Error('geometry: point maps to infinity under this transform (w ≈ 0)');
  }
  return [xp / wp, yp / wp];
}

// t1 ∘ t2 — applies t2 first, then t1. Ordinary 3x3 matrix multiplication;
// works for any homogeneous matrix (affine, reflection, shear, projective).
export function compose(t1, t2) {
  return {
    m00: t1.m00 * t2.m00 + t1.m01 * t2.m10 + t1.m02 * t2.m20,
    m01: t1.m00 * t2.m01 + t1.m01 * t2.m11 + t1.m02 * t2.m21,
    m02: t1.m00 * t2.m02 + t1.m01 * t2.m12 + t1.m02 * t2.m22,
    m10: t1.m10 * t2.m00 + t1.m11 * t2.m10 + t1.m12 * t2.m20,
    m11: t1.m10 * t2.m01 + t1.m11 * t2.m11 + t1.m12 * t2.m21,
    m12: t1.m10 * t2.m02 + t1.m11 * t2.m12 + t1.m12 * t2.m22,
    m20: t1.m20 * t2.m00 + t1.m21 * t2.m10 + t1.m22 * t2.m20,
    m21: t1.m20 * t2.m01 + t1.m21 * t2.m11 + t1.m22 * t2.m21,
    m22: t1.m20 * t2.m02 + t1.m21 * t2.m12 + t1.m22 * t2.m22,
  };
}

// General 3x3 inverse (adjugate / determinant) — works for any invertible
// matrix, including genuinely projective ones, not just affine.
export function invert(t) {
  const { m00: a, m01: b, m02: c, m10: d, m11: e, m12: f, m20: g, m21: h, m22: i } = t;

  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const D = c * h - b * i;
  const E = a * i - c * g;
  const F = b * g - a * h;
  const G = b * f - c * e;
  const H = c * d - a * f;
  const I = a * e - b * d;

  const det = a * A + b * B + c * C;
  if (Math.abs(det) < EPSILON) {
    throw new Error('geometry: cannot invert a singular transform');
  }

  return {
    m00: A / det, m01: D / det, m02: G / det,
    m10: B / det, m11: E / det, m12: H / det,
    m20: C / det, m21: F / det, m22: I / det,
  };
}

// The unique transform mapping srcA->dstA, srcB->dstB, restricted to rigid +
// uniform scale (no shear) — an affine special case of the general matrix
// above. By default it's orientation-preserving (a rotation + scale); pass
// { reflect: true } for the orientation-reversing solution (a mirror +
// rotation + scale) — both satisfy the same two point constraints, since two
// points alone don't disambiguate handedness.
export function similarityFromTwoPoints(srcA, srcB, dstA, dstB, { reflect = false } = {}) {
  const src = cSub(srcB, srcA);
  const dst = cSub(dstB, dstA);

  if (!reflect) {
    const m = cDiv(dst, src); // m = (p,q); z -> m*z + c
    const c = cSub(dstA, cMul(m, srcA));
    return affine(m[0], m[1], -m[1], m[0], c[0], c[1]);
  }

  const m = cDiv(dst, cConj(src)); // m = (p,q); z -> m*conj(z) + c
  const c = cSub(dstA, cMul(m, cConj(srcA)));
  return affine(m[0], m[1], m[1], -m[0], c[0], c[1]);
}

// Translation only — keeps orientation/scale, just slides srcPoint onto dstPoint.
// Used for combinatorial single-vertex matches (spec §0.10).
export function translationToMatch(srcPoint, dstPoint) {
  return affine(1, 0, 0, 1, dstPoint[0] - srcPoint[0], dstPoint[1] - srcPoint[1]);
}

// Ruler: { p0, p1, extra? } — at least two points (p0 = local origin, p1 =
// local unit); `extra` may hold additional points beyond those two (purpose
// open — see development.md §0.6). p0/p1 are what h_r, anchors, and the
// generation algorithms use; `extra`, if present, just rides along.
export function applyToRuler(t, ruler) {
  const result = { p0: applyToPoint(t, ruler.p0), p1: applyToPoint(t, ruler.p1) };
  if (ruler.extra) result.extra = ruler.extra.map((p) => applyToPoint(t, p));
  return result;
}

export function applyToSymbol(t, symbol) {
  return {
    ruler: applyToRuler(t, symbol.ruler),
    points: symbol.points.map((p) => applyToPoint(t, p)),
  };
}

// h_r^{-1}: standard segment -> the ruler's own frame.
export function transformFromStandardToRuler(ruler) {
  return similarityFromTwoPoints(STANDARD_SEGMENT.p0, STANDARD_SEGMENT.p1, ruler.p0, ruler.p1);
}

// h_r: the ruler's own frame -> standard segment (spec §0.9).
export function transformFromRulerToStandard(ruler) {
  return invert(transformFromStandardToRuler(ruler));
}

// Re-express a symbol in its own ruler-normalized frame.
export function normalizeSymbol(symbol) {
  return applyToSymbol(transformFromRulerToStandard(symbol.ruler), symbol);
}

function pointDistance(p, q) {
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

// ---------------------------------------------------------------------------
// Reptiling (spec §0.9)
// ---------------------------------------------------------------------------

// F_i = h_{r(a)} ∘ g_i ∘ h_{r_i}^{-1} — the level-independent normalized
// placement of each placement, computed once from the rule + each referenced
// motif's own (level-0) ruler, and reused at every generation level.
export function computeNormalizedPlacementTransforms(rule, motifRulers) {
  const hRuleToStandard = transformFromRulerToStandard(rule.ruler);
  return rule.placements.map((placement) => {
    const motifRuler = motifRulers[placement.refMotifId];
    if (!motifRuler) {
      throw new Error(`geometry: unknown motif "${placement.refMotifId}" in rule`);
    }
    const hStandardToMotif = transformFromStandardToRuler(motifRuler);
    const F = compose(hRuleToStandard, compose(placement.transform, hStandardToMotif));
    return { refMotifId: placement.refMotifId, F };
  });
}

// Computes normalized symbols for every motif, for levels 1..maxLevel, in one
// global pass per level (so cross-motif rule references resolve correctly —
// spec §0.8/§2a). motifs: { [id]: { ruler, points } } — level-0 geometry.
// rules: { [id]: Rule } — one rule per motif.
export function computeReptileLevels(motifs, rules, maxLevel) {
  const motifIds = Object.keys(motifs);
  // Extract ruler from ruler layer (or fall back to motif.ruler for old state)
  function extractRuler(motif) {
    const rl = motif.layers?.find((l) => l.type === 'ruler');
    if (rl) return { p0: rl.points[0] ?? [0, 0], p1: rl.points[1] ?? [1, 0] };
    return motif.ruler ?? { p0: [0, 0], p1: [1, 0] };
  }
  const motifRulers = Object.fromEntries(motifIds.map((id) => [id, extractRuler(motifs[id])]));
  const normalizedMotifs = Object.fromEntries(
    motifIds.map((id) => [id, normalizeSymbol({ ...motifs[id], ruler: motifRulers[id] })])
  );
  const placementsByMotif = Object.fromEntries(
    motifIds.map((id) => [id, computeNormalizedPlacementTransforms(rules[id], motifRulers)])
  );

  const levels = [null]; // levels[0] unused; levels[1..maxLevel] populated below
  let previous = normalizedMotifs; // "level 0", used to build level 1

  for (let level = 1; level <= maxLevel; level += 1) {
    const current = {};
    for (const id of motifIds) {
      const points = [];
      for (const { refMotifId, F } of placementsByMotif[id]) {
        for (const p of previous[refMotifId].points) {
          points.push(applyToPoint(F, p));
        }
      }
      current[id] = { ruler: { p0: [...STANDARD_SEGMENT.p0], p1: [...STANDARD_SEGMENT.p1] }, points };
    }
    levels.push(current);
    previous = current;
  }

  return levels; // levels[k][motifId] = { ruler, points }, ruler always == STANDARD_SEGMENT
}

// ---------------------------------------------------------------------------
// Combinatorial (spec §0.10 / development.md §3a)
// ---------------------------------------------------------------------------

// Fixed adjacency pattern for a rule: for every pair of placements, whether
// their LEVEL-0 rulers share one or both endpoints, within `tolerance`.
// Computed once per rule and reused at every generation level.
//
// Known simplification: a "full" match is always treated as orientation-
// preserving (reflect: false in the similarityFromTwoPoints call inside
// combinatorialLevel). Detecting when a match should instead be a reflection
// (e.g. because one of the two placements was itself drawn mirrored) needs a
// real signal beyond "two endpoints coincide" — revisit once Session 5/6 adds
// an explicit flip tool, rather than guessing here.
export function buildAdjacency(rule, motifRulers, tolerance) {
  const n = rule.placements.length;
  const absRulers = rule.placements.map((p) => applyToRuler(p.transform, motifRulers[p.refMotifId]));
  const edges = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const ri = absRulers[i];
      const rj = absRulers[j];
      const matches = [];
      for (const ei of ['p0', 'p1']) {
        for (const ej of ['p0', 'p1']) {
          if (pointDistance(ri[ei], rj[ej]) <= tolerance) matches.push([ei, ej]);
        }
      }
      if (matches.length === 0) continue;
      if (matches.length >= 2) {
        const aligned = matches.some(([ei, ej]) => ei === 'p0' && ej === 'p0');
        edges[i].push({ to: j, type: 'full', aligned });
        edges[j].push({ to: i, type: 'full', aligned });
      } else {
        const [ei, ej] = matches[0];
        edges[i].push({ to: j, type: 'single', selfEndpoint: ei, otherEndpoint: ej });
        edges[j].push({ to: i, type: 'single', selfEndpoint: ej, otherEndpoint: ei });
      }
    }
  }
  return edges;
}

function resolveRulerFromAnchors(rule, childSymbols, placedTransform, placed) {
  function resolveEndpoint(anchor) {
    if (!placed[anchor.placementIndex]) {
      throw new Error(
        `geometry: rule's ruler anchor (placement ${anchor.placementIndex}) was dropped — ` +
          'not reachable from the seed. The rule is malformed for combinatorial mode.'
      );
    }
    const localRuler = childSymbols[rule.placements[anchor.placementIndex].refMotifId].ruler;
    return applyToRuler(placedTransform[anchor.placementIndex], localRuler)[anchor.endpoint];
  }
  return { p0: resolveEndpoint(rule.rulerAnchors.p0), p1: resolveEndpoint(rule.rulerAnchors.p1) };
}

// Flood-fills one generation level of combinatorial assembly (spec §0.10/§3a).
// childSymbols: { [refMotifId]: { ruler, points } } — the level-(k-1) symbol to
// use for each placement's referenced motif (level-0 motif data when k = 1).
// adjacency: from buildAdjacency — computed once, reused at every level.
// The seed is placed via identity (its own natural frame, unscaled) so that
// pieces glued on by translation-only matches stay at a consistent scale —
// normalizing the seed's ruler to the standard segment instead would rescale
// it relative to neighbors that keep their natural size, an inconsistency that
// only shows up once children are supertiles rather than raw motifs (level ≥2).
export function combinatorialLevel(rule, childSymbols, adjacency, seedIndex = 0) {
  const n = rule.placements.length;
  const placedTransform = new Array(n).fill(null);
  const placed = new Array(n).fill(false);

  placedTransform[seedIndex] = identity();
  placed[seedIndex] = true;

  const queue = [seedIndex];
  while (queue.length > 0) {
    const i = queue.shift();
    const iLocalRuler = childSymbols[rule.placements[i].refMotifId].ruler;
    const placedRulerI = applyToRuler(placedTransform[i], iLocalRuler);

    for (const edge of adjacency[i]) {
      if (placed[edge.to]) continue; // first path found wins (development.md §3a)
      const neighborRuler = childSymbols[rule.placements[edge.to].refMotifId].ruler;

      let transform;
      if (edge.type === 'full') {
        const [dstA, dstB] = edge.aligned
          ? [placedRulerI.p0, placedRulerI.p1]
          : [placedRulerI.p1, placedRulerI.p0];
        transform = similarityFromTwoPoints(neighborRuler.p0, neighborRuler.p1, dstA, dstB);
      } else {
        const dstPoint = placedRulerI[edge.selfEndpoint];
        const srcPoint = neighborRuler[edge.otherEndpoint];
        transform = translationToMatch(srcPoint, dstPoint);
      }

      placedTransform[edge.to] = transform;
      placed[edge.to] = true;
      queue.push(edge.to);
    }
  }

  const points = [];
  for (let i = 0; i < n; i += 1) {
    if (!placed[i]) continue; // unreachable from the seed — dropped, not drawn
    const childPoints = childSymbols[rule.placements[i].refMotifId].points;
    for (const p of childPoints) points.push(applyToPoint(placedTransform[i], p));
  }

  return {
    ruler: resolveRulerFromAnchors(rule, childSymbols, placedTransform, placed),
    points,
    reachable: placed,
  };
}

// Computes combinatorial symbols for every motif, for levels 1..maxLevel, in
// one global pass per level (mirrors computeReptileLevels — spec §0.8/§2a).
export function computeCombinatorialLevels(motifs, rules, maxLevel, tolerance = 1e-6) {
  const motifIds = Object.keys(motifs);
  const motifRulers = Object.fromEntries(motifIds.map((id) => [id, motifs[id].ruler]));
  const adjacencyByMotif = Object.fromEntries(
    motifIds.map((id) => [id, buildAdjacency(rules[id], motifRulers, tolerance)])
  );

  const levels = [null];
  let previousSymbols = motifs; // level 0

  for (let level = 1; level <= maxLevel; level += 1) {
    const current = {};
    for (const id of motifIds) {
      const rule = rules[id];
      const childSymbols = {};
      for (const refId of new Set(rule.placements.map((p) => p.refMotifId))) {
        childSymbols[refId] = previousSymbols[refId];
      }
      current[id] = combinatorialLevel(rule, childSymbols, adjacencyByMotif[id], 0);
    }
    levels.push(current);
    previousSymbols = current;
  }

  return levels;
}
