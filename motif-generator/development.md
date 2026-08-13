# SVG Recursive Motif Generator — Specification & Development Plan

Reference document for all sessions and LLMs working on this project. Re-upload at the
start of each new session together with the current code. **§0 is the self-contained spec
— read it first; it should be sufficient on its own.** §1–§5 are derived architecture,
decisions, and implementation notes. §6 is the session plan. §7 is the handoff log.

---

## 0. Specification

### 0.1 Concept

A desktop web app for recursively drawing geometric tiling patterns. The user composes
motifs from bezier paths, writes substitution rules, and the engine renders any generation
of the resulting fractal or combinatorial structure. Everything is live-rendered using
SVG's native `<symbol>`/`<use>` tree and exportable as a clean self-contained SVG using
that same structure.

Technology: Vite, plain JS (no UI framework), direct SVG DOM manipulation.

### 0.2 Terminology

- **Motif** (level 0): one or more bezier path layers plus a ruler layer. The atomic
  building block. Stored as `{ id, name, layers[] }` where `layers[0]` is always the
  ruler layer.
- **Ruler**: a special path layer (`type: 'ruler'`) attached to every motif. It has at
  least two points — **p0** ("local origin") and **p1** ("local unit point") — and
  optionally additional points beyond those two. The ruler defines the motif's local
  coordinate frame: p0 is always `(0,0)`, p1 is always `(1,0)`. Additional ruler points
  ride through transforms unchanged. The ruler is used for positioning, scale/orientation
  propagation, and placement anchoring; it is never included in SVG export.
- **Rule** (level 1): each motif has exactly one substitution rule — a set of placements
  (transformed copies of any motif) plus the rule's own ruler.
- **Supertile** (level N ≥ 2): the result of replacing each placement in a rule with the
  level-(N−1) supertile of whatever motif it references, scaled and arranged consistently.
  Also has its own ruler.
- **Generation**: which level (1–10) is displayed in the main canvas, chosen via a
  toolbar stepper.
- **Control vertices**: the vertices of a placed copy that are selectable and snappable
  while editing a rule. Normally all vertices of the copy; restricted by the "wrap" toggle
  to the topmost path's vertices only (see §0.7).

### 0.3 Mobile gate

Below ~768px viewport width, display a "use a larger screen" message and hide the app.

### 0.4 UI layout

**Left toolbar** (top to bottom):
- Arrow tool (single button; V = select mode / A = direct-select mode).
- Transform tools: Rotate (R), Scale (S), Reflect (O).
- Drawing tools: Pen (P), Rectangle, Ellipse.
- Fill/stroke swatches (Illustrator-style overlapping pair) + stroke width (W) field.
- Generation-count stepper (1–10, labeled "Gen").
- "Outline / Show" view-mode toggle (see below for label convention).
- "Rulers on/off" toggle.
- "Borders on/off" toggle.
- "Reptiling / Combinatorial" mode toggle.

**Panel strip** (horizontal, fixed height, scrolls horizontally): one panel per motif.
Each panel is a live SVG drawing surface. All tools operate directly on panel SVGs.
Panel size is fixed; the main canvas is independent.

**Main canvas**: live render of the current generation/motif, updated in real time during
drag operations. Plain white background.

**View mode toggle** (toolbar button, above "Rulers on/off"): switches between
**Preview** mode (full fill/stroke rendering) and **Outline** mode (all paths as thin
unfilled black lines). The button label shows the *action* the click will take: it reads
**"Outline"** when currently in preview mode (click to go to outline), and **"Show"**
when currently in outline mode (click to return to preview).

General styling and tool behavior imitate Adobe Illustrator where applicable.

No precision panel or floating parameter overlay except for the Opt+click numeric dialogs
on Rotate and Scale.

### 0.4a Editing tools — detailed behavior

#### Arrow tool (one button, two modes)

**V — Select mode (black arrow)**
- Click a path to select it. Hit area is ~3px wide even for thin strokes, via an
  invisible wide-stroke overlay (`stroke-width: 6`, `pointer-events: all`).
- Drag the selected path to translate it. Shift constrains to 45° increments.
- Point-to-point snapping during translate: the moving path's vertices snap to vertices
  of other paths within threshold.
- The selected path's anchor squares are visible in this mode (all white).
- Background click deselects. Escape cancels an in-progress drag or deselects.
- Cmd+C / Cmd+V: copy/paste the selected layer (paste offset +0.05/+0.05 SVG units,
  auto-selected).
- Delete or Backspace: remove the selected layer (undoable).

**A — Direct-select mode (white arrow)**
- Click an anchor square → it turns blue (selected); others remain white.
- Drag the selected vertex: the vertex and both its control points translate together.
- The selected vertex's two bezier handle arms (dashed lines + hollow circles) are shown.
- Opt held in V mode = temporary direct mode, reverts on release.

Both modes share one toolbar button; the button highlights for both V and A.

#### Bezier control points

Every path node stores `cpOut` (outgoing, first CP of the cubic to the next node) and
`cpIn` (incoming, second CP from the previous node). For straight segments, `cpIn =
cpOut = anchor position` (degenerate bezier = line segment).

**Symmetric by default**: dragging a handle in direct mode mirrors the opposite handle
through the anchor (Illustrator "smooth" node). **Opt+drag** on a handle breaks symmetry:
only the dragged handle moves (Illustrator "corner/cusp" node).

#### Pen tool

**Drawing a new path:**
- Click to place a straight vertex; click-drag to set symmetric bezier handles (the drag
  vector sets `cpOut`; `cpIn` = `2·anchor − cpOut`). A live handle preview shows while
  dragging.
- Each vertex snaps to nearby existing path vertices.
- **Live preview**: as each vertex is placed and the cursor moves, the entire in-progress
  path renders with the current fill and stroke (or as a thin outline in outline mode).
  The preview includes all committed segments plus a rubber-band bezier from the last
  vertex to the cursor. Style updates in real time as fill/stroke/mode change.
- **Enter** closes/commits the path (closed bezier, uses handle at last node for the
  closing segment). Clicking near the first vertex (≥3 placed) also closes.
- **Escape / Double-click**: if 2 or more vertices have been placed, commits the open
  path as-is (no closing segment). If fewer than 2 vertices, discards. Clears the session.
- **Click near the last node of an existing path (pen idle)**: shows pen+ cursor; clicking
  loads that path and continues drawing from its end. On commit the original layer is
  updated in place (no new layer created).
- **Click at the start of another path while drawing**: snaps the final vertex to that
  path's start and merges — the drawn path is prepended to the target layer.
- **Click at the end of another path while drawing**: snaps the final vertex to that
  path's end and merges — the drawn path (reversed) is appended to the target layer.

**Editing an existing selected path (no path in progress):**
The pen tool detects proximity to the selected path and changes mode:

- **Pen+ (add vertex)**: hovering near any segment of the selected path (within ~0.025
  SVG units of the curve itself, but not within ~0.04 units of any vertex) shows a
  pen cursor with a `+` subscript. Clicking inserts a new vertex on the curve at that
  exact point, using de Casteljau splitting to preserve the path shape perfectly. The
  adjacent segments' control points are updated accordingly.

- **Pen− (delete vertex)**: holding Alt while hovering within ~0.04 SVG units of any
  vertex of the selected path shows a pen cursor with a `−` subscript. Clicking removes
  that vertex. Blocked if fewer than 4 vertices remain (minimum 3 kept). The path is
  reconnected across the removed vertex.

Both cursors are custom SVG data-URI cursors with a hotspot at the pen nib tip. The
cursor updates immediately when Alt is pressed or released mid-hover (no need to move the
mouse). Add/delete mode is suppressed while a new path is in progress.

#### Anchor point display

- **Anchor squares**: half-size `AH = 0.018` SVG units, `vector-effect: non-scaling-stroke`.
- Unselected: white fill, accent-color stroke. Selected (direct mode): accent-color fill.
- Bezier handle circles: `r = 0.022`, hollow with accent border.
- Handle arms: dashed accent-color line from anchor to each handle.
- **Persistent anchors**: the selected layer's anchor squares are always visible regardless
  of which tool is active. During a live drag, the tool's own live-position anchors
  replace the persistent layer temporarily.
- **Anchors track live drag position**: during any drag operation in rotate, scale, reflect,
  or translate, anchor squares are redrawn at the current (live) node positions each frame,
  not at their pre-drag positions. During opt+drag (duplicate), anchors track the original
  path (not the ghost copy).

#### Rotate tool (R)

- First click-drag: click sets the rotation center (snaps to nearby vertices); drag
  immediately begins rotation. Center shown as a crosshair.
- Subsequent click-drags: rotate from the same center. Escape clears.
- Shift during drag: constrains to 45° increments.
- **Vertex snap during drag**: each rotated vertex is tested against all other layers'
  vertices. If any lands within ~0.045 SVG units of a target, the angle snaps exactly.
  Overridden by Shift.
- **Opt+drag = duplicate**: original stays in place; a ghost shows the copy position.
  Releasing with Opt commits a new copy layer. The ghost appears in both the motif panel
  and the main canvas simultaneously.
- **Opt+click = numeric dialog**: floating panel near cursor, angle (°) field, Copy /
  Cancel / OK buttons.
- Anchor squares of the selected path remain visible while the tool is active.

#### Scale tool (S)

- Same click-to-set-origin model as Rotate. Shift = uniform scale.
- **Vertex snap during drag**: same logic as Rotate but applied to scale factor(s). For
  uniform scale (Shift), uses projection along the vertex-origin direction.
- **Opt+drag = duplicate**: same as Rotate; ghost in both windows.
- **Opt+click = numeric dialog**: % field (100 = no change, 150 = 1.5×).
- Anchor squares remain visible while active.

#### Reflect tool (O)

- First click sets the axis origin (snaps to vertices).
- Drag defines the axis direction through that point; axis line shown while dragging.
- Shift: constrains axis to 0°/45°/90° increments.
- **Opt+drag = duplicate**: original stays; ghost shows reflected copy in both windows.
- **Opt+click = numeric dialog**: axis angle (°) field.
- Anchor squares remain visible while active.

#### Z-order commands

- **Up arrow / Left arrow** (no modifier): move selected layer one step forward (toward top).
- **Down arrow / Right arrow** (no modifier): move selected layer one step backward (toward bottom).
- **Cmd+]**: move selected layer one step forward.
- **Cmd+[**: move selected layer one step backward.
- **Cmd+Shift+]**: bring selected layer all the way to the top.
- **Cmd+Shift+[**: send selected layer all the way to the bottom.

All z-order commands are blocked from displacing the ruler layer (which is always at
index 0). No layer can be moved below index 1.

#### Snapping

All drawing tools, the select tool, and transform tool origin/center placement snap to
existing path vertices (including ruler layer points) within ~0.05 SVG units. Snapping is
silent (no indicator). Rotate, scale, and reflect drag operations also snap (vertex-to-
vertex correction, threshold ~0.045 SVG units).

**Snap target sources**: all layers of the current motif — including the ruler layer.
Because the ruler is a separate layer, its points are never excluded from snap targets
even when the ruler-bearing motif's shape layer is selected.

#### Opt+drag duplicate — both windows

During any opt+drag in Select (translate), Rotate, Scale, or Reflect:
- In the **motif panel**: the original path stays at its position; a semi-transparent
  ghost (`opacity: 0.45`) shows the destination.
- In the **main canvas**: same — original path stays visible; a styled ghost of the
  transformed copy overlays on top.

The main canvas ghost is managed via a `liveGhost` uiState channel (distinct from
`livePatch`). The ghost element is created with the same fill/stroke as the layer and
removed when the drag ends or on deactivation.

On release with Opt held: a new duplicate layer is committed at the transformed position.
Original is unchanged.

### 0.4b Live preview in main canvas

All drag operations update the corresponding path in the main canvas in real time, without
committing to the store until mouseup. Implemented via a `livePatch` uiState channel that
patches the path directly inside the renderer's `<defs>` symbol. During opt+drag, a
separate `liveGhost` channel carries the ghost path so both original and copy are
simultaneously visible.

### 0.5 Motifs — editing

- Created/edited via pen, rectangle, and ellipse tools; each motif has one or more path
  layers plus its ruler layer.
- `layers[0]` is always the ruler layer (type `'ruler'`). Path layers follow.
- Fill and stroke are independently controllable per layer: color + opacity, or disabled
  (no fill / no stroke is valid). The color picker uses a **no-color swatch** (white box
  with red diagonal, Illustrator-style) to set enabled=false; choosing any color
  automatically sets enabled=true. No separate "Enabled" checkbox.
- No layers panel. Z-order is creation order (last drawn = topmost). Reorder with
  Cmd+Shift+]/[.
- Every path layer stores a `nodes` array alongside `pathData`:
  `{ x, y, cpIn: [x,y], cpOut: [x,y] }`. The default square is stored this way too.
  All drawing tools produce this representation; `pathData` is derived from `nodes` via
  `nodesToPathData()` and kept in sync on every edit.

### 0.6 Rulers — architecture, display, editability

#### Architecture

The ruler is stored as the first entry in every motif's `layers` array, with
`type: 'ruler'`. Its structure matches a path layer: it has `points`, `nodes`, and
`pathData`. This means:

- Ruler points participate automatically in all snap-target lists (no special-casing).
- The pen tool's add/delete vertex behavior applies to ruler layers under the same
  constraints as path layers, with additional constraints (below).
- Ruler layers are skipped in the layer-list UI and excluded from SVG export.
- `cmdDeleteLayer` guards against deleting the ruler layer.

The ruler's `nodes` and `pathData` form an **open path** (no closing `Z`). The bezier
path goes through all ruler points in order.

#### Coordinate constraints

The ruler's first two points are always **p0 = (0,0)** and **p1 = (1,0)** — these define
the motif's local origin and unit. They may never be repositioned, deleted, or have
vertices inserted before them. Additional ruler points (index ≥ 2) are unconstrained.

#### Display

When "show rulers" is on: a blue open-path line connecting all ruler points in order.
p0 shown as a filled black dot; p1 as a hollow circle (white fill, black stroke). Points
at index ≥ 2 are shown as small dark gray dots. When "show rulers" is off: ruler is
invisible in the panel SVG but its snap points remain active.

Never shown in the main canvas; never included in SVG export.

#### Editability

The ruler layer is selectable by clicking it in the panel SVG. When selected, its anchor
squares are displayed and the pen tool's add/delete modes apply:

- **Pen+**: can only insert vertices on segments at index ≥ 1 (between point 1 and
  point 2, or later). Inserting on the segment between p0 and p1 is blocked.
- **Pen−**: can only delete vertices at index ≥ 2. Deleting p0 or p1 is blocked.
- **Extending from p1**: when the ruler has exactly 2 points, clicking with the pen tool
  near p1 starts a drawing session that appends a new third point. Subsequent clicks add
  further points. This is the only way to add the first non-constrained ruler point.

The ruler's pathData is regenerated as an open path whenever its nodes change.

### 0.7 Rules (level 1) and control vertices

- Build a rule by dragging a copy of any motif onto another motif's panel. Once placed,
  a copy can be dragged/transformed; its vertices snap to other placements' control
  vertices.
- Control vertices = all vertices of a placed copy, unless that copy has "wrap" toggled
  on — then only the vertices of its topmost path are selectable/snappable.
- The rule's own ruler must have **both** endpoints snapped exactly onto a ruler-vertex
  (p0 or p1) of one of its placements — enforced, not optional. Needed to propagate
  rulers through combinatorial-mode generations (§0.10).

### 0.8 Generations / supertiles (level N ≥ 2)

- Level N+1 supertiles are built from level N supertiles, arranged the same way the
  level-0 motifs are arranged in the rule.
- Total symbols = (#motifs) × (#generation levels) — implemented as nested
  `<symbol>`/`<use>` to keep this tractable at generation 10.
- Display convention: place the supertile's ruler with p0 at the global origin and p1 on
  the positive x-axis, using the scale the construction produces (no artificial rescaling).
- Any motif's rule may reference any other motif, including mutual references. The engine
  computes one global pass per level across all motifs together.

### 0.9 Reptiling mode

Let `a` be a motif, `M(a)` its level-1 supertile with ruler `r(a)`, assembled from
copies `g_i(b_i)` with rulers `r_i`. Let `h_r` = transform mapping ruler `r` onto the
standard segment `I = (0,0)-(1,0)`.

The invariant applied at every level:

```
h_{r(a)} ∘ g_i ∘ h_{r_i}^{-1}  =  h_{rk(a)} ∘ gk_i ∘ h_{r_{k-1}(b_i)}^{-1}
```

This recursively defines the level-k placement transforms `gk_i` and the level-k ruler
`rk(a)`. Transforms are full 3×3 homogeneous matrices (affine special case used
throughout; the representation accommodates projective transforms if added later).

### 0.10 Combinatorial mode

Placements whose ruler-vertices coincide are considered adjacent. A flood-fill from a
seed placement assembles the generation:

- **Two ruler-vertex pairs match** (full ruler overlap): use the two-point correspondence
  transform (translation + rotation + scale), same math as reptiling.
- **One vertex matches**: translation only; placement keeps its original orientation/scale.
- Placements unreachable by flood-fill are dropped at every generation level.
- Conflicts (reachable two ways) resolve by keeping whichever was placed first.
- The rule's own ruler is re-derived at every level from its anchored placement's
  ruler-vertex position (see §3a for full algorithm).

### 0.11 Persistence & editing infrastructure

- Undo/redo from day one: all mutations go through a command layer (`do(state)` →
  `newState`), with before/after snapshots on the stack.
- Save/load as JSON (current state; no undo history persisted).
- SVG export: same symbol tree as the live render, with ruler layers and UI-only
  attributes stripped. Optional flatten-to-paths fallback.

### 0.12 Default project

One motif: unit square with vertices `(0,0), (1,0), (1,1), (0,1)` and ruler along
its base (p0 = `(0,0)`, p1 = `(1,0)`). Rule: four copies arranged in a 2×2 grid,
rule ruler along the base of the 2×2 block.

---

## 1. Architecture — SVG symbol/use mapping

Each level is a real `<symbol>`, instanced with `<use>`:

- `motif-{id}` → `<symbol>` containing the user's path elements (level 0).
- `rule-{id}` → `<symbol>` containing `<use>` refs to motif symbols with transforms
  (level 1).
- `gen-{id}-{N}` → `<symbol>` containing `<use>` refs to `gen-{id}-{N-1}` symbols,
  same placement pattern as the rule (level N).

Symbols are built **lazily** (only up to the currently displayed generation) to avoid
Chrome freezing on eager resolution of deeply nested `<use>` chains.

Live canvas and exported SVG share the same symbol tree; export strips rulers and
UI-only attributes.

---

## 2. Data model

```js
Project = {
  motifs: { [id]: Motif },
  rules:  { [motifId]: Rule },
  mode: 'reptiling' | 'combinatorial',
  generationCount: 1..10,
  showRulers: bool,
  showBorders: bool,
  viewMode: 'preview' | 'outline',
}

Motif = {
  id, name,
  layers: [
    // layers[0] is always the ruler layer:
    { type: 'ruler', points: [[0,0],[1,0],...], nodes: [...], pathData: '...' },
    // followed by path layers:
    { pathData, nodes, points, fill, stroke, fillOpacity, strokeOpacity,
      fillEnabled, strokeEnabled, strokeWidth, strokeMiterLimit },
    ...
  ],
  points,   // flat list for legacy snap lookups; derived from layers
}

Rule = {
  motifId,
  placements: [ { refMotifId, transform, wrapped: bool } ],
  ruler: { p0, p1 },
  rulerAnchors: {
    p0: { placementIndex, endpoint: 'p0' | 'p1' },
    p1: { placementIndex, endpoint: 'p0' | 'p1' },
  },
}

// transform: full 3×3 homogeneous matrix {m00..m22}.
// affine(a,b,c,d,e,f) builds the affine special case (SVG matrix() convention).
// similarityFromTwoPoints supports mirrored placements.
```

Geometry module (pure, no DOM): `h(ruler)`, `composeReptile`, `composeCombinatorial`,
`buildAdjacency`, and supporting matrix ops (`invert`, `compose`, `applyToPoint`, etc.).

---

## 2a. Cross-cutting architecture notes

- **Undo/redo**: `createStore(initialState)` → `{ apply(cmd), undo(), redo(), subscribe() }`.
  Commands are `{ do(state) → newState }`. State is treated immutably; snapshots are
  before/after pairs on the undo stack.

- **uiState**: an observable (`makeObservable`) holding `selectedMotifId`, `selectedLayer`,
  `fill`, `stroke`, `livePatch`, `liveGhost`. Not part of the undo stack. The split:
  project mutations → store; drawing-mode and drag-preview state → uiState.

- **livePatch channel**: during any drag, `uiState.set('livePatch', { motifId, index,
  pathData })` patches the `<path>` inside the motif's `<symbol>` in `<defs>` directly,
  without a store commit. Cleared on pointerUp; store commit then triggers a rebuild.

- **liveGhost channel**: during opt+drag, `uiState.set('liveGhost', { pathData })` adds a
  ghost path element to the main canvas SVG (fill/stroke from current uiState). The ghost
  overlays on the original (which livePatch holds at its original position). Cleared on
  release or deactivation.

- **Shared tool utilities** (`src/tools/shared.js`): `svgCoords`, `getPathEl`,
  `buildCrosshair`, `makeGhost`, and `AnchorLayer`. All transform tools and panels.js
  import from here rather than duplicating. `AnchorLayer(svg)` creates a `<g>` and
  returns `{ draw(nodes, selIdx?), clear(), remove() }`.

- **Persistent anchor layer** (`panels.js`): one `AnchorLayer` per panel SVG, subscribed
  to `selectedLayer`, `livePatch`, and store changes. Shows anchor squares for the
  selected layer regardless of which tool is active. Clears during live drags (sets
  `livePatch`) so tool-managed live-position anchors take over. When a transform tool
  (scale/rotate/reflect) is active, its own `AnchorLayer` overlaps the panel's persistent
  one — both draw in the same positions; the overlap is harmless.

- **Generation engine scope**: one global pass per level across all motifs together
  (not per-motif), because any motif's rule can reference any other motif.

- **Build tooling**: Vite, plain JS.

---

## 3. Confirmed decisions

Standalone app (local or hosted); plain JS + Vite; undo/redo in scope from the start; no
layers panel; off-the-shelf color picker with full opacity controls; no typed-coordinate
point entry beyond Opt+click dialogs; JSON save/load, current state only; "wrap" = topmost
path by z-order; both generation modes live-comparable; default square is unit square,
ruler along base edge; panel strip wraps to multiple rows; reptiling transforms always use
full two-point (segment) correspondence; flood-fill conflicts resolve by keeping whichever
was placed first.

**Seed placement**: the flood-fill seed is placed via **identity** (natural frame,
untouched), not by normalizing to the standard segment. Normalizing the seed distorts
scale once children are supertiles rather than raw motifs.

**Combinatorial ≠ reptiling for the default square**: the default square's ruler is each
square's own base edge, so only same-row placements share a ruler-vertex; the two rows are
separate components, and combinatorial mode only keeps the one containing the seed. This
is correct behavior, not a bug.

---

## 3a. Combinatorial placement algorithm

Built once per rule from its adjacency graph; reused at every generation level.

**Steps:**
1. Build adjacency graph: edge between two placements wherever a ruler-vertex of one
   coincides with a ruler-vertex of another, within snap tolerance.
2. Place the seed (first placement listed) via identity.
3. Flood-fill: for each unplaced placement adjacent to an already-placed one, apply the
   one-vertex (translation) or two-vertex (similarity) transform. Repeat until no more
   placements can be added. Unreachable placements are dropped permanently.
4. At generation N, "placements" = level-(N−1) supertiles, assembled the same way.

**Ruler propagation**: a rule's ruler endpoints must each sit on a ruler-vertex of a
placement (`rulerAnchors`). At each generation level, those endpoints are simply the
corresponding ruler-vertex positions of the relevant supertile after flood-fill placement.
The anchor (which placement, which endpoint) is fixed at level 1 and reused recursively.

---

## 4. File organization

```
src/
  geometry.js          pure transform and generation math
  model.js             command store, project mutations, createDefaultProject
  pathTransform.js     node/path helpers: nodesToPathData, transformNodes, snapPt, etc.
  render.js            symbol/use renderer, patchLayer
  tools/
    shared.js          svgCoords, getPathEl, buildCrosshair, makeGhost, AnchorLayer
    select.js          arrow (V/A), translate, copy/paste, z-order
    rotate.js          rotate tool
    scale.js           scale tool
    reflect.js         reflect tool
    pen.js             pen tool (draw + add/delete vertex)
    rect.js            rectangle tool
    ellipse.js         ellipse tool
  ui/
    activeTool.js      observable singleton for active tool name
    canvas.js          main canvas, livePatch/liveGhost listeners
    panels.js          panel strip, per-panel SVG, tool wiring, persistent AnchorLayer
    toolbar.js         toolbar DOM, fill/stroke section, toggle buttons
    uiState.js         makeObservable, shared UI state (not in undo stack)
    colorPicker.js     floating color + opacity popup
    transformDialog.js promise-based numeric input dialog
    mobileGate.js      mobile-width message
  app.js               root: creates store, mounts layout, global undo/redo
  styles.css
tests/
  assert.js            tiny no-dependency assertion helper
  geometry.test.js
  model.test.js
```

---

## 5. Session plan

| # | Status | Goal | Key deliverable |
|---|--------|------|-----------------|
| 1 | ✅ | Shell & mobile gate | Vite scaffold, layout, mobile message |
| 2 | ✅ | Geometry core + undo | `geometry.js`, `model.js`, 23 passing tests |
| 3 | ✅ | Symbol renderer | `render.js`, lazy gen-symbol build, ruler/outline toggles |
| 4 | ✅ | Drawing tools | Pen/rect/ellipse → command layer; panel strip; fill/stroke; color picker |
| 5 | ✅ | Selection & transforms | V/A arrow, R rotate, S scale, bezier editing, snapping, live canvas, opt+drag duplicate, copy/paste |
| 5+ | ✅ | Reflect; pen+/pen−; ruler-as-layer; anchor tracking; liveGhost; toolbar polish | See §6 |
| 5++ | ✅ | Shared tool utilities; persistent anchors; pen preview; pen Esc commit | See §6 |
| 6 |  | Rule editing | Drag-place copies in a rule, snap to control vertices, wrap toggle, rulerAnchors |
| 7 |  | Generation engine: reptiling | Wire geometry.js reptiling to live UI; gen-count control |
| 8 |  | Generation engine: combinatorial | Flood-fill, mode toggle, both modes cached and live-comparable |
| 9 |  | Export & persistence | SVG export (strip rulers), JSON save/load |
| 10 |  | Integration & polish | Multi-motif workflows end-to-end, gen-10 performance, undo audit |

---

## 6. Handoff log

### Session 1 — scaffold

Vite scaffold + layout shell: `index.html`, `src/app.js`, `src/styles.css`,
`src/ui/{toolbar,panels,canvas,mobileGate}.js`. Mobile gate at 640px. One CSS fix: bare
`.mobile-gate { display:flex }` overrode `[hidden]` — fixed with
`.mobile-gate[hidden] { display:none }`.

### Session 2 — geometry + model

`src/geometry.js` (transforms + both generation algorithms) and `src/model.js`
(command/undo store + `createDefaultProject()`), with `tests/` (23/23 passing).

Notable findings/changes folded into §0/§2/§3:
- Transforms generalized to full 3×3 homogeneous matrices.
- Ruler may have additional points beyond p0/p1.
- Combinatorial mode does not match reptiling for the default square — documented as
  correct behavior, not a bug.
- Seed-placement bug fixed: identity placement instead of ruler normalization.

### Session 3 — renderer

`src/render.js` (symbol/use renderer), store wiring, ruler/outline toggles.

- **Lazy gen-symbol build**: pre-building all 10 gen symbols at startup froze Chrome (eager
  `<use>` resolution, ~4^10 implicit renders at gen 10). Fixed with `ensureGenSymbols(level)`.
- `subscribe()` added to `createStore`.
- `layers[]` added to default square motif in `createDefaultProject()`.
- Combinatorial rendering deferred to Session 8.

### Session 4 — drawing tools

`src/ui/activeTool.js`, `src/tools/{pen,rect,ellipse}.js`, `src/ui/{panels,toolbar,
canvas}.js`, `src/ui/{uiState,colorPicker}.js`, `src/model.js` additions.

- Drawing tools commit through `cmdAddLayer`; panel SVGs are independent drawing surfaces.
- `uiState` (not-in-store) vs store: clean separation established.
- `subscribe` returning an unsubscribe function prevents zombie listeners on deleted panels.

### Session 5 — selection & transforms

Full editing tool redesign per §0.4a (commit 5304053 + continued work):

- **Node model**: `nodes: [{x, y, cpIn, cpOut}]` on every layer. `pathTransform.js`
  exports `rectNodes`, `ellipseNodes`, `nodesToPathData`, `transformNodes`, `snapPt`, etc.
- **livePatch channel**: real-time main canvas updates during drag.
- **Hit-area overlay**: invisible `stroke-width:6` twin path for 3px hit area.
- **Symmetric bezier handles**: alt held = one-sided only.
- **Rotate/scale state machine**: first click-drag sets origin and starts transform in one
  gesture; Esc clears.
- **Transform dialog** (`src/ui/transformDialog.js`): promise-based floating panel for
  Opt+click on rotate/scale.
- **Vertex snap during drag**: `findRotateSnap` / `findScaleSnap` — back-solves exact
  angle/scale to land a vertex on a target.
- **Opt+drag duplicate**: ghost at destination, original in place, commit on release.
- **Copy/paste**: module-level clipboard in `select.js`, Cmd+C/V.

### Session 5+ — ruler, pen+/pen−, anchor tracking, liveGhost, toolbar polish

**Ruler-as-layer** (`src/model.js`, `src/geometry.js`, `src/render.js`,
`src/ui/panels.js`):
- Ruler is now `layers[0]` with `type: 'ruler'`. `makeRulerLayer()` produces it.
- `getMotifRuler(motif)` extracts `{p0, p1}` from the ruler layer.
- Ruler points are snap targets automatically — they live in a separate layer and are
  never excluded by the `selPts` filter applied to the selected layer.
- `cmdDeleteLayer` guards against deleting the ruler.

**Reflect tool** (`src/tools/reflect.js`): axis defined by click-point + drag-direction.
Shift constrains to 45° increments. Full opt+drag duplicate and opt+click numeric dialog.

**Pen+ / Pen−** (`src/tools/pen.js`):
- `detectHoverMode(cursor, altKey)` returns `{type:'add',...}` or `{type:'delete',...}`
  by testing cursor proximity to the selected layer's vertices/segments.
- `commitAddVertex`: de Casteljau split (`splitBezier`) preserves path shape; adjacent
  control points updated.
- `commitDeleteVertex`: filters node array; blocked if ≤3 nodes remain.

**Anchor tracking during drag** (all transform tools):
- `refreshAnchors(liveNodes?)` — if `liveNodes` supplied, draws squares there; otherwise
  reads from store. Called from `onPointerMove` with freshly computed node positions.

**liveGhost channel** (`src/ui/canvas.js`, all transform tools):
- During opt+drag: `livePatch` carries the **original** pathData; `liveGhost` carries
  the **transformed** pathData. Both cleared on pointerUp or deactivation.

**Toolbar / color picker polish**:
- View toggle ("Outline"/"Show") moved to toolbar above Rulers; miter limit field removed.
- Color picker: "Enabled" checkbox replaced by no-color swatch (white + red diagonal).
  Clicking swatch disables color; picking any color enables it.
- Outline mode fix: inline `<style>` element inside panel SVG bypasses `<use>` shadow DOM
  so outline-mode CSS reaches paths inside symbol instances.

### Session 5++ — shared tool utilities, persistent anchors, pen improvements

**`src/tools/shared.js`** (new): centralizes `svgCoords`, `getPathEl`, `buildCrosshair`,
`makeGhost`, and `AnchorLayer`. All transform tools and `panels.js` import from here.
`AnchorLayer` replaces the inline `anchorsG`+`refreshAnchors` pattern in scale, rotate,
and reflect, and the `selAnchorsG` in panels.js. Fixed a latent bug in scale/rotate/reflect
where `refreshAnchors` was called as a `selectedLayer` listener and received `{motifId,
index}` instead of a node array — now uses `Array.isArray` guard.

**Persistent anchor layer** (`src/ui/panels.js`): one `AnchorLayer` per panel, subscribed
to `selectedLayer`, `livePatch`, and store. Shows anchor squares for the selected shape
regardless of active tool. Clears itself (via `livePatch` check) when a live drag is in
progress so tool-managed anchors take over.

**Pen tool preview** (`src/tools/pen.js`): replaced separate `previewPath` (committed
nodes) + `previewSeg` (straight rubber band) with a single `previewPath` that includes
the cursor position as the next uncommitted node. `applyStyle` is called on every pointer
move so preview responds immediately to fill/stroke/mode changes.

**Pen tool Esc / double-click**: both commit open path if ≥2 nodes placed, else discard.
Double-click no longer closes/snaps to start — that is Enter's job only.

**Pen tool path continuation and merge** (`src/tools/pen.js`):
- Hovering the pen over the **last node** of any path layer (idle, not drawing) shows pen+
  cursor. Clicking loads that path's nodes into the drawing session (`continuingLayerIdx`
  tracks which layer). New nodes append normally; on commit (`cmdUpdateLayer`) the original
  layer is updated in place — no new layer created.
- While drawing, clicking near the **start node (b0)** of another path merges: our drawn
  nodes are prepended to that path (`[...ourNodes, ...B.slice(1)]`), updating layer B.
- While drawing, clicking near the **end node (bM)** of another path merges: our drawn
  nodes are reversed and appended to that path (`[...B.slice(0,-1), ...reversed(ourNodes)]`),
  updating layer B. `reverseNodes` swaps each node's cpIn/cpOut so bezier handles remain
  geometrically correct after reversal.

**Session 6 should start from:**

All motif-editing tools are complete and working. Session 6 is rule editing: the user
drags copies of motifs into a motif's rule, positions/transforms them, snaps placement
ruler-vertices to each other, records `rulerAnchors`, and the "wrap" toggle. Read §0.7
and §3a carefully before starting — the ruler constraint is load-bearing for combinatorial
mode. The `rulerAnchors` data structure (which placement + which endpoint each rule-ruler
point sits on) must be enforced at editing time, not just stored.
