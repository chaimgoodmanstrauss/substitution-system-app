let failures = 0;
let total = 0;

export function test(name, fn) {
  total += 1;
  try {
    fn();
    console.log(`ok   - ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL - ${name}`);
    console.log(`       ${err.message}`);
  }
}

export function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}

export function approxEqual(a, b, tolerance = 1e-6, message = '') {
  if (Math.abs(a - b) > tolerance) {
    throw new Error(`${message} expected ${a} ≈ ${b} (tolerance ${tolerance})`);
  }
}

export function pointApproxEqual(p, q, tolerance = 1e-6, message = '') {
  const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
  if (d > tolerance) {
    throw new Error(`${message} expected point [${p}] ≈ [${q}] (distance ${d} > ${tolerance})`);
  }
}

export function pointSetContains(points, target, tolerance = 1e-6) {
  return points.some((p) => Math.hypot(p[0] - target[0], p[1] - target[1]) <= tolerance);
}

export function summary() {
  console.log(`\n${total - failures}/${total} passed`);
  if (failures > 0) process.exitCode = 1;
}
