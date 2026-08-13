import {
  identity,
  affine,
  compose,
  invert,
  applyToPoint,
  applyToRuler,
  similarityFromTwoPoints,
  translationToMatch,
  transformFromRulerToStandard,
  computeReptileLevels,
  buildAdjacency,
  computeCombinatorialLevels,
  STANDARD_SEGMENT,
} from '../src/geometry.js';
import { createDefaultProject } from '../src/model.js';
import { test, assert, approxEqual, pointApproxEqual, pointSetContains, summary } from './assert.js';

// ---------------------------------------------------------------------------
// Transform primitives
// ---------------------------------------------------------------------------

test('identity leaves points unchanged', () => {
  pointApproxEqual(applyToPoint(identity(), [3, 4]), [3, 4]);
});

test('compose(t, invert(t)) is the identity', () => {
  const t = similarityFromTwoPoints([0, 0], [1, 0], [5, 2], [5, 5]);
  const roundTrip = compose(invert(t), t);
  pointApproxEqual(applyToPoint(roundTrip, [7, -3]), [7, -3]);
});

test('similarityFromTwoPoints reproduces both point constraints exactly', () => {
  const t = similarityFromTwoPoints([0, 0], [2, 0], [1, 1], [1, 4]);
  pointApproxEqual(applyToPoint(t, [0, 0]), [1, 1]);
  pointApproxEqual(applyToPoint(t, [2, 0]), [1, 4]);
});

test('similarityFromTwoPoints reflect:true still satisfies both points, but reverses orientation', () => {
  const t = similarityFromTwoPoints([0, 0], [1, 0], [0, 0], [1, 0], { reflect: true });
  pointApproxEqual(applyToPoint(t, [0, 0]), [0, 0]);
  pointApproxEqual(applyToPoint(t, [1, 0]), [1, 0]);
  // a point off the line should land on the mirror side (y flips)
  pointApproxEqual(applyToPoint(t, [0, 1]), [0, -1]);
  const det = t.m00 * t.m11 - t.m01 * t.m10;
  assert(det < 0, `expected a reflection (negative determinant), got det=${det}`);
});

test('non-reflected similarity keeps a positive determinant', () => {
  const t = similarityFromTwoPoints([0, 0], [1, 0], [2, 3], [5, 9]);
  const det = t.m00 * t.m11 - t.m01 * t.m10;
  assert(det > 0, `expected orientation-preserving (positive determinant), got det=${det}`);
});

test('the matrix form represents shear too, even with no constructor for it yet', () => {
  const shear = affine(1, 0, 0.5, 1, 0, 0); // x' = x + 0.5y, y' = y
  pointApproxEqual(applyToPoint(shear, [0, 2]), [1, 2]);
  pointApproxEqual(applyToPoint(shear, [0, 0]), [0, 0]);
});

test('the matrix form represents true projective transforms too (perspective divide)', () => {
  // m20 != 0 makes this genuinely projective, not affine — w depends on x.
  const projective = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0, m20: 0.5, m21: 0, m22: 1 };
  // x=2: w = 0.5*2+1 = 2, so (2,4) -> (2/2, 4/2) = (1,2)
  pointApproxEqual(applyToPoint(projective, [2, 4]), [1, 2]);
  // x=0: w = 1, unaffected
  pointApproxEqual(applyToPoint(projective, [0, 4]), [0, 4]);
});

test('compose/invert round-trip correctly for a genuinely projective matrix, not just affine ones', () => {
  const projective = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0, m20: 0.5, m21: 0, m22: 1 };
  const roundTrip = compose(invert(projective), projective);
  pointApproxEqual(applyToPoint(roundTrip, [2, 4]), [2, 4]);
  pointApproxEqual(applyToPoint(roundTrip, [-3, 7]), [-3, 7]);
});

test('translationToMatch slides a point exactly onto the target, no rotation/scale', () => {
  const t = translationToMatch([1, 1], [4, 2]);
  pointApproxEqual(applyToPoint(t, [1, 1]), [4, 2]);
  pointApproxEqual(applyToPoint(t, [2, 1]), [5, 2]); // offset by the same vector
});

test('applyToRuler carries along extra points beyond p0/p1', () => {
  const ruler = { p0: [0, 0], p1: [1, 0], extra: [[0.5, 0.5]] };
  const t = translationToMatch([0, 0], [10, 10]);
  const moved = applyToRuler(t, ruler);
  pointApproxEqual(moved.p0, [10, 10]);
  pointApproxEqual(moved.p1, [11, 10]);
  pointApproxEqual(moved.extra[0], [10.5, 10.5]);
});

test('h_r maps a ruler exactly onto the standard segment', () => {
  const ruler = { p0: [3, 3], p1: [3, 5] }; // length 2, vertical
  const h = transformFromRulerToStandard(ruler);
  pointApproxEqual(applyToPoint(h, ruler.p0), STANDARD_SEGMENT.p0);
  pointApproxEqual(applyToPoint(h, ruler.p1), STANDARD_SEGMENT.p1);
});

// ---------------------------------------------------------------------------
// Reptiling — default square, hand-computed (spec §0.9 / development.md §0.12)
// ---------------------------------------------------------------------------

const project = createDefaultProject();

test('reptiling level 1: 16 points, matching the hand-computed 2x2 layout', () => {
  const levels = computeReptileLevels(project.motifs, project.rules, 3);
  const level1 = levels[1].square;
  assert(level1.points.length === 16, `expected 16 points, got ${level1.points.length}`);
  // hand-derived corners (see chat/development.md working): each unit square's
  // corners scaled by 1/2 then offset to its quadrant.
  for (const p of [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]]) {
    assert(pointSetContains(level1.points, p), `missing bottom-left corner ${p}`);
  }
  for (const p of [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]]) {
    assert(pointSetContains(level1.points, p), `missing top-right corner ${p}`);
  }
});

test('reptiling levels 1-3: point counts grow ×4 per level (4^level)', () => {
  const levels = computeReptileLevels(project.motifs, project.rules, 3);
  approxEqual(levels[1].square.points.length, 16, 0);
  approxEqual(levels[2].square.points.length, 64, 0);
  approxEqual(levels[3].square.points.length, 256, 0);
});

test('reptiling: the (0,0) and (1,1) corners survive at every level (fixed points of placements 0 and 3)', () => {
  const levels = computeReptileLevels(project.motifs, project.rules, 3);
  for (let level = 1; level <= 3; level += 1) {
    const pts = levels[level].square.points;
    assert(pointSetContains(pts, [0, 0]), `level ${level} missing (0,0)`);
    assert(pointSetContains(pts, [1, 1]), `level ${level} missing (1,1)`);
  }
});

test("reptiling: every level's own ruler is the standard segment (scale normalized away, spec §0.8)", () => {
  const levels = computeReptileLevels(project.motifs, project.rules, 3);
  for (let level = 1; level <= 3; level += 1) {
    pointApproxEqual(levels[level].square.ruler.p0, STANDARD_SEGMENT.p0);
    pointApproxEqual(levels[level].square.ruler.p1, STANDARD_SEGMENT.p1);
  }
});

// ---------------------------------------------------------------------------
// Combinatorial — default square: a real finding, not an assumption
// ---------------------------------------------------------------------------
//
// The default square's ruler is each square's own BASE edge. Only same-row
// placements' rulers touch end-to-end (bottom-left/bottom-right share a
// vertex; top-left/top-right share a vertex) — there is no ruler-vertex
// adjacency between a square and the one stacked above/below it. So in
// combinatorial mode, starting from the bottom-left square as seed, only the
// bottom row is reachable; the top row is a separate component and gets
// dropped. This is NOT a bug — it's what spec §0.10's literal rule produces
// for this particular ruler placement. Reptiling does not have this issue
// (it doesn't depend on ruler-vertex adjacency), so the two modes genuinely
// disagree for this example — they are different algorithms, not two
// descriptions of the same result.

test('combinatorial adjacency: default square rule connects bottom row and top row separately', () => {
  const motifRulers = { square: project.motifs.square.ruler };
  const edges = buildAdjacency(project.rules.square, motifRulers, 1e-6);
  // placement order: 0=bottom-left, 1=bottom-right, 2=top-left, 3=top-right
  const edgeTargets = (i) => edges[i].map((e) => e.to).sort();
  assert(JSON.stringify(edgeTargets(0)) === JSON.stringify([1]), 'bottom-left should only connect to bottom-right');
  assert(JSON.stringify(edgeTargets(2)) === JSON.stringify([3]), 'top-left should only connect to top-right');
});

test('combinatorial level 1: only the bottom row is reachable from the seed (placement 0)', () => {
  const levels = computeCombinatorialLevels(project.motifs, project.rules, 1);
  const reachable = levels[1].square.reachable;
  assert(reachable[0] === true && reachable[1] === true, 'bottom row should be reachable');
  assert(reachable[2] === false && reachable[3] === false, 'top row should be dropped, not reachable');
});

test('combinatorial level 1: reachable squares keep a consistent scale (8 points, not 16)', () => {
  const levels = computeCombinatorialLevels(project.motifs, project.rules, 1);
  assert(levels[1].square.points.length === 8, `expected 8 points (2 squares), got ${levels[1].square.points.length}`);
});

test('combinatorial levels 1-2: the connected row keeps the same per-square scale (seed placed via identity)', () => {
  const levels = computeCombinatorialLevels(project.motifs, project.rules, 2);
  // Level 1: two unit squares side by side -> ruler (0,0)-(2,0)
  pointApproxEqual(levels[1].square.ruler.p0, [0, 0]);
  pointApproxEqual(levels[1].square.ruler.p1, [2, 0]);
  // Level 2: the level-1 "domino" repeated the same way -> ruler doubles again, (0,0)-(4,0).
  // If the seed were instead normalized to the standard segment, this would come out
  // wrong (mismatched scale between the seed copy and its translated neighbor) — this
  // test is what catches that regression.
  pointApproxEqual(levels[2].square.ruler.p0, [0, 0]);
  pointApproxEqual(levels[2].square.ruler.p1, [4, 0]);
});

summary();
