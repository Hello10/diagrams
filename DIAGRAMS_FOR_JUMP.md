# Diagrams for Jump

What `@hello10/diagrams` needs so that a Jump spec can describe UI with enough fidelity that an agent builds the right screen from it and a person can review the screen before it is built.

`state`, `sequence`, `flowchart`, `class` are usable now. Renderer limits in state and sequence are fixed when a Jump diagram hits them.

## Wireframe

A wireframe describes one screen as a tree of components. Scenarios say what the screen does; the wireframe says what it is. The agent reads it to build the screen; the renderer draws it for review.

### Core

What exists, kept:

```
structure     screen · component · repeat · modal · define · use
canonical     text  button  input  select  checkbox  radio  image  audio  video  table  dialog
interaction   goto · state · call
mapping       adapter per module: component → canonical type, or custom renderSvg / renderAscii
```

Added:

```
layout        Stack — direction as a prop (column default, row); the one layout primitive
```

The canonical set is the HTML form-and-media set: types with distinct semantics, not distinct looks. Variants are props or adapters, not new types — a toggle is a checkbox, a heading is text, a link is a button that navigates, a toast is a dialog. Nothing is added to the canonical set because it is common; it is added only if it has semantics no existing type can carry.

Everything above the core is composition: `define` builds a Card, a Nav, a Tabs from the core and reuses it. A standard set of definitions can ship with the library; they are not primitives.

A component with no mapping and no definition renders as a labeled box. That is not a gap in the language; it is a component that has not been mapped yet. Its reference — a sketch, a prototype, a spec feature — is a prop on it, not a type.

### Language work

- Settle the `id` shorthand, `[state]` placement, and the screen-state model. One meaning per construct.
- Resolve how `repeat` and `modal` interact with `use` imports.
- Add `Stack` with direction, alignment, gap, sizing (fill, hug, fixed).
- Screen states: named; a state declares what differs from default.
- Viewports: a wireframe declares the viewports it targets; layout props may vary per viewport, the tree does not.
- Data: a component that shows a collection or entity names it by spec reference.

### Renderer

High fidelity. The rendered wireframe is the design:

- Layout honored: direction, alignment, gap, sizing; nested stacks composed correctly.
- A spacing scale and typography hierarchy applied consistently.
- Each canonical type recognizable as itself; component state (disabled, selected) visible.
- Modal drawn over the screen with stacking and dimming.
- Each declared viewport rendered at its size; each screen state renderable on its own.
- Text rendering (`toPlaintext`) and SVG rendering stay in step: the same tree, the same mapping.

## Wireflow

The navigation graph: wireframes as nodes, interactions as edges. Currently deferred and partially implemented.

- Nodes reference wireframes by name; a node may reference a screen state.
- Edges are typed by the interaction that causes them — the same `goto` / `state` / `call` vocabulary as wireframe — and name the triggering component. An interaction declared on a wireframe and an edge in a wireflow are one fact stated from two sides.
- Decisions, entry, and exit are declared.
- Rendered as a graph of screen thumbnails with labeled edges; readable at twenty screens.

## Fixtures and spec

- Every type ships with fixtures covering its full construct set: the round-trip corpus and the docs-site examples.
- Spec §3 updated to six implemented types; §5.4 and §5.5 rewritten from descriptive-of-current to prescriptive-of-target.

## Order

Wireframe language → wireframe renderer → wireflow language → wireflow renderer → fixtures and spec.
