# SVG Recursive Motif Generator — Development Plan

Reference doc for all sessions/LLMs working on this project. Re-upload this file (and the
current code state) at the start of each new session. **Section 0 is the consolidated,
self-contained spec — read it first; it should be enough on its own, without needing the
original conversation.** Sections 1+ are the implementation plan derived from it.

## 0. Source spec (consolidated)

### 0.1 Concept
A desktop web app for recursively drawing patterns using SVG's native symbol/use
structure. Everything is both live-rendered on screen and exportable as a clean SVG file
using that same symbol structure.

### 0.2 Terminology
- **Motif** (level 0): a user-drawn atomic symbol — one or more layers of stroked/filled
  paths — plus a ruler. The basic building block.
- **Ruler**: a straight, invisible (in final output) reference segment attached to every
  symbol at every level. Two endpoints: **p0** ("local origin") and **p1** ("local unit").
  Used to position copies and to define scale/orientation when assembling higher levels.
- **Rule** (level 1): each motif has exactly one substitution rule — a set of placements
  (copies of any motif, transformed) plus the rule's own ruler. Rules are what get
  iterated to build higher generations.
- **Supertile** (level N ≥ 2): the result of replacing each placement in a rule with the
  level-(N-1) supertile of whatever motif it references, scaled/arranged consistently.
  Also has its own ruler.
- **Generation**: which level (1–10) is currently displayed in the main field, chosen via
  a toolbar stepper.
- **Control vertices**: the vertices of a placed copy that are selectable/snappable while
  editing a rule. Normally all vertices of the copy; restricted by "wrap" (below).

### 0.3 Mobile gate
Below a desktop-minimum width, show a message instead of the app; otherwise proceed
normally. (Exact breakpoint not specified — pick a reasonable default, e.g. ~768px, in
Session 1; message copy is also open, just needs to communicate "use a larger screen.")

### 0.4 UI layout
- **Left toolbar**, top to bottom:
  - Drawing/transform tools (pen, rectangle, ellipse, rotate, scale), Illustrator-style:
    snap-to-point, shift-lock to 45°, option-key opens a precise-parameters panel. The
    precision panel applies to the **transform tools** (move/rotate/scale) — there is no
    typed-coordinate point entry for the pen/rectangle/ellipse tools.
  - Navigation tools (hand, zoom, etc.).
  - Generation-count stepper (1–10).
  - "Show borders" / "don't show borders" toggle.
  - "Combinatorial" / "reptiling" mode toggle.
- **Top panel strip**: one panel per motif, added/removed as motifs are added/deleted.
  Wraps to multiple rows rather than scrolling (projects typically have only a handful of
  motifs). Each panel contains the motif itself (paths/layers, fill/stroke/opacity, ruler
  show/hide) and its rule editor (placements + the rule's own ruler).
- **Main field**: live render of the current generation. Preview/Outline mode toggle.
- General styling and tool behavior should imitate Adobe Illustrator wherever applicable.

### 0.5 Motifs (level 0) — editing rules
- Created/edited/deleted via pen, rectangle, ellipse tools; one or more path layers.
- Fill and stroke are independently controllable: color + opacity, or disabled entirely
  (no fill / no stroke is valid).
- No layers panel. Z-order is creation order (last drawn = topmost). "Topmost" in this
  sense (not geometric outer boundary) is what "wrap" (0.7) restricts to.

### 0.6 Rulers — display
- When "show rulers" is on: a thick gray line, filled/black dot at p0, white dot with
  black stroke at p1. Otherwise invisible.
- Never included in SVG export, at any level.

### 0.7 Rules (level 1) and control vertices
- Build a rule by dragging a copy of any motif onto another motif's panel. Once placed, a
  copy can be dragged/transformed; its vertices snap to other placements' control
  vertices.
- Control vertices = all vertices of a placed copy, unless that copy has "wrap" toggled on
  (per-placement toggle) — then only the vertices of its topmost path (0.5) are
  selectable/snappable.
- The rule's own ruler must have **both** endpoints snapped exactly onto a ruler-vertex
  (p0 or p1) of one of its placements — enforced, not optional. (Needed to propagate
  rulers through combinatorial-mode generations, 0.10.)

### 0.8 Generations / supertiles (level N ≥ 2)
- Level N+1 supertiles are built from level N supertiles, arranged the same way the
  level-0 motifs are arranged in the rule.
- Total defined symbols across the project = (#motifs) × (#generation levels) —
  implemented as nested `<symbol>`/`<use>` (§1) to keep this cheap even at generation 10.
- Higher-level supertiles have no inherent coordinate system. Display convention: place
  the supertile's ruler with p0 at the global origin and p1 on the positive x-axis, using
  whatever scale the construction produces (no artificial rescaling).
- Any motif's rule may reference any other motif, including mutual references (A's rule
  contains B and B's rule contains A) — well-defined, since level N of anything only ever
  depends on level N-1 of something, never level N of itself. The generation engine
  computes one global pass per level across all motifs together, not motif-by-motif.

### 0.9 Reptiling mode (math)
Let `a` be a motif, `M(a)` its level-1 supertile (the rule) with ruler `r(a)`. `M(a)` is
assembled from copies `g_1(b_1), ..., g_k(b_k)`: placements of motifs `b_1..b_k` via
transforms `g_1..g_k`; each `b_i` has ruler `r_i`, and `g_i(r_i)` is where that ruler ends
up inside `M(a)`. For any ruler `r`, let `h_r` be the transform mapping `r` onto the
standard segment `I = (0,0)-(1,0)`.

The construction rule, applied at every level: normalize both the container and each piece
to the standard segment using *that level's own* rulers, and the resulting relative
transform is identical at every generation. Concretely, if `Mk(a)` is the level-k supertile
of `a` (ruler `rk(a)`), built from copies of `M_{k-1}(b_i)` via transforms `gk_i`, arranged
the same way the `b_i` are arranged in `M(a)`, then:

```
h_{r(a)} ∘ g_i ∘ h_{r_i}^{-1}  =  h_{rk(a)} ∘ gk_i ∘ h_{r_{k-1}(b_i)}^{-1}
```

This recursively defines `gk_i` and `rk(a)` level by level. Transforms are always rigid +
uniform scale (homothety) — no shear.

### 0.10 Combinatorial mode (math + resolved algorithm)
Original rule: if the rulers of two motif copies meet at a vertex in the substitution
rule, then at every higher level, the corresponding supertiles' rulers meet at their
vertices the same way.

Resolved into a concrete algorithm (full version in §3a):
- Build an adjacency graph over the rule's placements: an edge exists wherever a ruler
  vertex of one coincides with a ruler vertex of another, within the UI's snap tolerance.
- Flood-fill outward from a seed placement (default: the first placement listed, ruler
  mapped to the standard segment). For each newly reached placement: if a **full ruler
  segment** matches an already-placed one (both endpoints), use the full two-point
  (translation + rotation + scale) transform, same math as reptiling; if **only one
  vertex** matches, use translation only, keeping the piece's original orientation/scale.
- Anything never reached by the flood-fill is dropped — not drawn at any generation level.
- Conflicts (a placement reachable two different ways with different results) resolve by
  keeping whichever was placed first.
- The rule's own ruler (0.7) is re-derived at every generation level from whichever
  placement + endpoint it was anchored to at level 1 — using that placement's
  level-(N-1) supertile's corresponding ruler-vertex position, after it's been placed by
  the flood-fill.

### 0.11 Persistence & editing infrastructure
- Undo/redo is required, designed into the data model from the start (command-based
  mutations), not added later.
- Save/load as JSON, current state only — no undo history persisted.
- SVG export uses the same symbol tree as the live render, with rulers and any UI-only
  attributes stripped.

### 0.12 Default project (on first load)
- One motif: a unit square, vertices `(0,0), (1,0), (1,1), (0,1)`, ruler along its base —
  p0 = `(0,0)`, p1 = `(1,0)`.
- Its rule: four copies of the square arranged in a 2×2 grid, ruler along the base of the
  overall 2×2 block.

## 1. Core concept → architecture mapping

The spec's "internal structure mirroring svg symbols" should be taken literally: implement
each level as a real `<symbol>`, instanced with `<use>`.

- `motif-{id}` → `<symbol>` containing the user's paths (level 0).
- `rule-{id}` → `<symbol>` containing `<use>` refs to motif symbols with transforms (level 1).
- `gen-{id}-{N}` → `<symbol>` containing `<use>` refs to `gen-{id}-{N-1}` symbols, same
  placement pattern as the rule, just rescaled (level N).

This means total defined symbols = (#motifs) × (#generations), exactly as in §0.8, and
node count per level stays O(k) (k = placements in the rule) rather than exploding —
nesting via `<use>` is what keeps generation 10 tractable. Live canvas and exported SVG can
use the *same* symbol tree; export just strips ruler elements and any UI-only attributes
(see §0.6, §0.11).

Flag: some renderers/viewers cap `<use>` nesting depth. Plan to test up to depth 10 early
(Session 2) rather than discovering a ceiling late. Export should also be flattenable to plain
paths as a fallback option.

## 2. Data model (sketch)

```js
Project = {
  motifs: { [id]: Motif },
  rules:  { [motifId]: Rule },     // one rule per motif, 1:1
  mode: 'reptiling' | 'combinatorial',
  generationCount: 1..10,
  showRulers: bool,
  showBorders: bool,
  viewMode: 'preview' | 'outline',
}

Motif = {
  id, name,
  layers: [ { pathData, fill, stroke, fillOpacity, strokeOpacity, fillEnabled, strokeEnabled } ],
  ruler: { p0: [x,y], p1: [x,y] },   // p0 = origin (black dot), p1 = unit (white dot)
}

Rule = {
  motifId,                          // which motif this is a rule FOR
  placements: [ { refMotifId, transform, wrapped: bool } ],
  ruler: { p0, p1 },                // the rule's own ruler
  rulerAnchors: {                   // which placement+endpoint each ruler point sits on
    p0: { placementIndex, endpoint: 'p0' | 'p1' },
    p1: { placementIndex, endpoint: 'p0' | 'p1' },
  },
}

// transform = 2x3 affine (a,b,c,d,e,f) — homothety + rotation only (no shear), per spec
```

Geometry module (pure, unit-testable, no DOM):
- `h(ruler)` → matrix mapping ruler to unit segment (0,0)-(1,0), and its inverse.
- `composeReptile(rule, motifSymbols, level)` → builds `gen-N` per the recursive
  homothety rule in §0.9.
- `composeCombinatorial(rule, motifSymbols, level)` → flood-fill assembly per §0.10 / §3a.
- Keep these two functions independent and both covered by tests using the default square
  (results should coincide for the square case, since it's a pure homothety arrangement —
  good regression check between modes).

## 2a. Cross-cutting architecture notes

- **Undo/redo**: model mutations go through a command layer (`{do(state), undo(state)}`,
  or before/after snapshots) starting in Session 2 — not bolted on at the end. Every
  mutating tool built in later sessions wires into this layer as it's built.
- **Generation engine scope**: computed as one global pass per level across *all* motifs
  together (level N for every motif from level N-1 for every motif), not per-motif in
  isolation — needed because any motif's rule can reference any other motif, including
  mutual references. This is still well-founded (level N never depends on level N of
  anything, only level N-1), just not independent per motif.
- **Z-order**: paths within a motif default to creation order (last drawn = topmost, used
  for the "wrap" toggle). No layers panel; revisit only if bring-to-front/send-to-back
  commands turn out to be needed.
- **Color picker**: off-the-shelf vanilla JS library (e.g. Pickr) for fill/stroke — full
  swatch + opacity controls, no framework dependency.
- **Persistence**: JSON export/import of project state (motifs, rules, settings) —
  separate from SVG export, which is the rendered output format.
- **Build tooling**: Vite, plain JS (no UI framework) + direct SVG DOM manipulation.

## 3. Decisions confirmed / implementation defaults

**Confirmed:** standalone app (local or hosted); plain JS + Vite; undo/redo in scope from
the start; no layers panel; off-the-shelf color picker w/ full opacity controls; no
typed-coordinate point entry (precision panel covers move/rotate/scale only); JSON
save/load, current state only, no undo history persisted; "wrap" = topmost path by
z-order, not geometric outer boundary; both generation modes live-comparable; default
square = unit square, ruler along base edge, origin at (0,0); panel strip wraps to
multiple rows; reptiling transforms always use full two-point (segment) correspondence;
flood-fill conflicts (a placement reached two different ways) resolve by keeping whichever
was placed first.

**One implementation default, flag if wrong:** the flood-fill needs a starting piece.
Since the whole assembled shape can be freely translated/rotated without changing its
structure, the choice shouldn't matter visually — default is: take the first placement
listed in the rule, map its ruler onto the standard origin→unit-x segment (same convention
used to normalize individual motifs), then flood-fill everything else from there.

### 3a. Combinatorial placement algorithm (current version)

Built once per rule from its adjacency graph; reused at every generation level.

**Adjacency / transform rule for each placement, once something it touches is already placed:**
- **Two ruler-vertex pairs match** (the full ruler segment coincides with an already-placed
  ruler) → full two-point correspondence transform (translation + rotation + scale), same
  math as reptiling.
- **Only one vertex pair matches** → translation only; the piece keeps its original
  orientation/scale from the rule, just shifted so the matching vertex lines up.

**Steps:**
1. Build the adjacency graph: an edge exists between two placements wherever a ruler
   vertex of one coincides with a ruler vertex of the other, within the UI's snap
   tolerance.
2. Place the seed (see default above).
3. Flood-fill: repeatedly place any unplaced placement adjacent to something already
   placed, using the one-vertex/two-vertex rule above. Repeat until nothing more can be
   added. Anything never reached is dropped — not drawn at any generation level.
4. At generation N, "placements" means the level-(N-1) supertiles for each motif in the
   rule, assembled the same way.

**Ruler propagation (combinatorial mode):** a rule's own ruler must have both of its
endpoints sitting exactly on top of a ruler-vertex belonging to one of its placements (this
is enforced at rule-editing time, the same way other snapping is enforced — not just a
convention). For each ruler endpoint, record which placement and which of that placement's
two ruler-vertices (origin or unit point) it coincides with. At every generation level k,
the level-k ruler's endpoints are simply the corresponding ruler-vertex positions of the
relevant level-(k-1) supertile, after that piece has been positioned by the flood-fill in
step 3 above. So the anchor (which placement, which endpoint) is fixed once, and reused
recursively at every level — directly mirroring how reptiling's `rk(a)` is defined.

## 4. Session plan

Each session should end by updating a short **handoff note** (current file list + any schema
or decision changes) at the bottom of this doc, so the next session/LLM has full context
without re-reading all code.

| # | Goal | Deliverable | Test checkpoint |
|---|------|-------------|------------------|
| 1 | Shell & responsive gate | Vite project scaffold. Layout: left toolbar, top panel strip, main field. Mobile-width message. No logic. | Resize window across breakpoint; mobile message appears/disappears correctly. |
| 2 | Geometry core + command/undo scaffolding | `geometry.js`: ruler math, `h(r)`, reptile + combinatorial composition (pure functions). `model.js`: command-based mutation layer with undo/redo stack (no UI yet). | Unit tests (no browser): hand-computed square-rule cases for gen 1–3, both modes match. Scripted mutations round-trip correctly through undo/redo. |
| 3 | Symbol-based renderer | `render.js`: given a static default project (hardcoded square + 2x2 rule), build `<symbol>`/`<use>` tree and draw it. Ruler show/hide, preview/outline toggle. | Visual check at generations 1, 2, 5, 10 against hand-sketch; confirm `<use>` depth 10 renders in target browser. |
| 4 | Motif editing: drawing | Pen/rect/ellipse tools create real motifs through the command layer (undoable); new motif → new panel; fill/stroke/opacity via color-picker library. | Draw 2–3 motifs, edit fill/stroke, delete one, undo/redo each step, panels stay in sync. |
| 5 | Selection & transform tools | Vertex selection, drag, point-snap, shift-lock 45°, rotate/scale, option-key precision panel — all through the command layer. | Checklist comparing each tool's feel against Illustrator behavior; undo/redo each tool action. |
| 6 | Rule editing | Drag-copy motif into a rule, place/move/transform copies, snap to control vertices, "wrap" toggle — undoable. The rule's own ruler must snap onto a placement's ruler-vertex at both endpoints (recorded as `rulerAnchors`). | Rebuild the default 2x2 square rule entirely via UI; confirm matches hardcoded version from Session 3; confirm the rule's ruler refuses to land anywhere except a placement's ruler-vertex. |
| 7 | Generation engine: reptiling | Wire `geometry.js` reptiling into live UI as one global per-level pass across all motifs; generation-count control (1–10). | Compare engine output to Session 3 hand-checked cases; confirm a cross-referencing rule (motif A's rule contains B) computes correctly. |
| 8 | Generation engine: combinatorial | Wire the flood-fill algorithm (§0.10 / §3a); mode toggle, both modes cached and live-comparable. | A rule with an intentionally disconnected placement — confirm it's dropped at every generation level. Confirm matches reptiling where the rule is a pure homothety pattern (e.g. the default square). |
| 9 | Export & persistence | SVG export: strip rulers/UI-only attrs, emit clean nested symbol/use SVG (+ optional flatten-to-paths fallback). JSON project save/load. | Diff exported SVG visually against live canvas at several generation counts; save → reload → confirm identical state. |
| 10 | Integration & polish | Multi-motif workflows end-to-end, performance pass at gen 10 with several motifs, Illustrator-behavior polish pass, undo/redo coverage audit. | Full manual run-through: create motifs → build rules → switch modes → save/reload → export. |

## 5. File organization (for clean per-session diffs)

Keep one concern per file so later sessions touch only what changed:
`geometry.js`, `model.js`, `render.js`, `tools/pen.js`, `tools/transform.js`,
`tools/select.js`, `ui/toolbar.js`, `ui/panels.js`, `ui/canvas.js`, `export.js`, `app.js`.

## 6. Handoff log
*(append a few lines here at the end of each session: what changed, what's next)*