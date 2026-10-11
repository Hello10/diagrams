# @hello10/diagrams — Spec

`@hello10/diagrams` is a plaintext diagram library: parse Mermaid-flavored syntax into a JSON AST, render the AST to SVG, round-trip the AST back to canonical plaintext.

This document is the source of truth for the package as a whole — its public API, extension contract, current diagram types, and the phasing of additional types we plan to support. Six types are implemented. Wireframe and wireflow (§5.4, §5.5) are specified prescriptively: the grammar there is the grammar, and the implementation is held to it.

## 1. Goals

- **Plaintext in, structured out.** A diagram source string parses into a typed JSON AST. Errors surface as data, not exceptions.
- **AST in, SVG out.** Each diagram type owns its own renderer. SVG strings are returned directly — no DOM, no canvas.
- **Round-trippable.** `parse → toPlaintext → parse` is stable. `parse → toJSON → fromJSON → render` is stable. Round-trip stability is the litmus test for AST correctness.
- **Mermaid-aligned.** A developer who knows Mermaid should be able to read our diagrams without translation. Where Mermaid has a convention that fits, we use it. Where Mermaid has nothing, we add new syntax in Mermaid's style. We avoid breaking Mermaid conventions. See §2.
- **Zero runtime dependencies.** No Mermaid, no Langium, no Chevrotain, no D3. The whole library is hand-written TypeScript.
- **Extensible.** New diagram types are added by implementing the `Diagram` contract and calling `registerDiagram()`. The shared tokenizer is open for new lexemes.

## 2. Mermaid alignment

We classify every syntactic decision against Mermaid into one of four buckets: adopted verbatim, additive (no Mermaid analog), deliberate divergence, and coverage gap.

### 2.0 Short-form aliases

Every diagram type accepts a short-form alias that matches its fixture
filename, in addition to the Mermaid-canonical type keyword:

| Diagram | Canonical keyword | Short-form alias |
|---------|-------------------|------------------|
| State | `stateDiagram` (and `stateDiagram-v2`) | `state` |
| Sequence | `sequenceDiagram` | `sequence` |
| Flowchart | `flowchart` (and `graph`) | `flowchart` (same) |
| Wireframe | `wireframe` | `wireframe` (same) |
| Wireflow | `wireflow` | `wireflow` (same) |
| Class | `classDiagram` | `class` |
| ER | `erDiagram` | `entity` (planned) |

Short forms are additive — the canonical Mermaid keyword always works. New
diagrams should adopt this convention so fixture filenames double as the
source's first-line keyword.

### 2.1 Adopted verbatim

- **Arrow vocabulary.** Sequence: `->`, `->>`, `-->`, `-->>`, `-x`, `--x`, `-)`, `--)`. State: `-->`. Labeled arrows: `-->|label|`, `-->|"label"|`.
- **Block keywords closed by `end`.** `loop`/`end`, `alt`/`else`/`end`, `par`/`and`/`end`, `break`/`end`, `rect`/`end`. `subgraph`/`end` planned.
- **Comments.** `%% ...`.
- **Directives.** `%%{...}%%` (tokenized; consumption deferred — see §4.7).
- **Frontmatter.** `---` delimiters skipped during type detection (YAML extraction deferred — see §4.7).
- **Title and accessibility.** `title`, `accTitle`, `accDescr`.
- **Identifier conventions.** PascalCase for types/components, lowercase for keywords, `:` as label separator.

### 2.2 Additive (no Mermaid analog)

These are extensions for diagram families Mermaid doesn't have, all introduced in Mermaid's stylistic mold (lowercase keywords, `end`-closed blocks, JS-style imports for module references):

- `wireframe` / `wireflow` keywords introducing the new diagram families.
- `use @module as Alias` and `use @module Name1, Name2` JS-style imports for component vocabularies.
- `define Name ... end` for reusable component subtrees, with `$param` content slots bound at the use site.
- `viewport name [width=n]` declarations and `viewport name ... end` override blocks.
- `screen Name ... end` with `state name ... end` blocks declaring what differs from the default state.
- `@hello10/diagrams/ui`, the module that ships the canonical vocabulary (`Stack` and the form-and-media set).
- `repeat` and `modal` wrappers, with `repeat Card` shorthand for a single child.
- `-->|goto|`, `-->|state|`, `-->|call|` typed interactions on components, and the matching `-->|kind trigger|` edge labels in wireflow.
- `[*]` entry/exit edges in wireflow, borrowed from the state diagram.

#### Lexical constraint on `@`

Mermaid v11 introduced shape-decorator syntax for flowchart nodes: `A@{ shape: rect, label: "Hello" }`. The tokenizer matches `@` as a `hook` token **only when followed by an identifier-start character**, so `@{...}` stays available for the flowchart parser. Module names (`@acme/ui`) contain a `/` and are emitted as identifiers. No current grammar consumes a bare `@identifier`: the wireframe and wireflow parsers reject it with a pointer to the `-->|call| hook` form it replaced.

### 2.3 Deliberate divergences

None today. The library aims to be Mermaid-compatible everywhere it overlaps with Mermaid grammar.

### 2.4 Coverage gaps

Mermaid features we don't yet implement. These are scope decisions tied to phase ordering, not divergences. They are listed per-diagram-type in §5 under each type's "Mermaid coverage" table.

## 3. Phasing & Status

The library's purpose is to support **living specifications** — documentation that lives alongside code, captures structure / intent / flow, and is consumable by AI agents for code generation. Phasing reflects implementation order and stability, not raw priority, and is scoped to the Mermaid diagram types that actually serve that goal.

### Already implemented

| Phase | Diagram | Type key | Status |
|-------|---------|----------|--------|
| 1 | Wireframe | `wireframe` | Implemented to the §5.4 grammar; layout renderer with states and viewports |
| 1 | Wireflow | `wireflow` | Implemented to the §5.5 grammar; graph renderer with screen thumbnails |
| 2 | Sequence | `sequenceDiagram` | Implemented; basic Mermaid coverage; renderer limits fixed as Jump diagrams hit them |
| 2 | State | `stateDiagram` (alias `stateDiagram-v2`) | Implemented; basic Mermaid coverage; renderer limits fixed as Jump diagrams hit them |
| 3 | Flowchart | `flowchart` (alias `graph`) | Implemented; basic Mermaid coverage; enhancements tracked in §5.3 |
| 3 | Class | `classDiagram` (alias `class`) | Implemented; namespaces, stereotypes, generics, all relationship forms, notes |

### Tier A — core spec coverage (Phase 3 priorities)

The remaining diagram to implement. It maps to the persistence layer of a living spec; with class and flowchart it completes the most universal spec surfaces.

| Diagram | Type key | Spec role |
|---------|----------|-----------|
| ER diagram | `erDiagram` | Persistence layer, entity relationships |

### Tier B — secondary spec coverage

Defensible spec material for specific domains, planning workflows, or software-development conventions. Split into two groups: ones we've already committed to (just not yet scheduled), and ones we'll pick up as demand surfaces.

**Implementation planned: to be prioritized.** These will land after Tier A; the exact order is open.

| Diagram | Type key | Spec role |
|---------|----------|-----------|
| Architecture | `architecture-beta` | Service / infrastructure topology |
| User Journey | `journey` | Product flows and UX intent |

**On-demand, no committed phase.** Order below is rough relevance, not a queue.

| Diagram | Type key | Spec role |
|---------|----------|-----------|
| Gantt | `gantt` | Release / project schedule |
| Timeline | `timeline` | Version and milestone progression |
| Requirement | `requirementDiagram` | Formal requirements tracking, SysML-flavored; useful in regulated domains |
| GitGraph | `gitGraph` | Branching strategy and release-flow documentation |
| Packet | `packet-beta` | Wire-protocol / binary-format documentation: byte layouts, field offsets |
| Event Modeling | `eventmodeling` | Event-sourced system structure (commands → events → projections); CQRS / event-driven architectures |
| Ishikawa | `ishikawa` | Cause-and-effect / fishbone — failure-mode documentation, threat modeling, design-decision rationale |
| Wardley | `wardley` | Strategic value-chain mapping — build-vs-buy decisions, capability evolution, tech-strategy layer |
| Mindmap | `mindmap` | Feature decomposition / taxonomy |
| Block | `block-beta` | Lightweight architectural sketches; overlaps with Architecture |

### Not planned

These Mermaid types exist but don't serve the living-spec goal. Documenting them as out of scope makes future "should we add X?" conversations short.

- **Analytics / data viz** (don't describe the system itself): Pie chart, Quadrant chart, Sankey, XY chart, Radar, Treemap, Venn
- **Task tracking** (dynamic operational state, not spec material): Kanban
- **Display-only viewer:** TreeView
- **Redundant with what we already cover:** ZenUML (alternative sequence-diagram syntax — `sequenceDiagram` covers it)
- **Redundant with Tier A:** C4 (Architecture covers the same need with a lighter, more recent Mermaid surface)

### Active priorities

1. Wireframe and wireflow in use by Jump specs; renderer gaps fixed as real screens expose them.
2. Fix known renderer bugs in `state` and `sequence` when a Jump diagram hits them.
3. Phase 3 — Tier A: **ER**. Architecture and user journey follow as the first Tier B work but aren't scheduled into Phase 3.

## 4. Architecture

### 4.1 Pipeline

```
plaintext source
   │
   │  tokenize()         shared tokenizer (src/tokenizer.ts)
   ▼
Token[]
   │
   │  detectDiagram()    matches first non-trivial line against registered Diagram.detect()
   ▼
Diagram (registry hit)
   │
   │  diagram.parse()    type-specific parser, extends DiagramParser base
   ▼
ParseResult<AST>
   │
   ├─ diagram.render()      → SVG string
   ├─ diagram.toPlaintext() → canonical plaintext
   └─ JSON.stringify()      → JSON
```

### 4.2 Tokenizer

The tokenizer (`src/tokenizer.ts`) operates at the lexical level only. It does not know which diagram type it is tokenizing. Keyword classification, statement structure, and semantics are the parser's job.

Token types:

| Type | Examples |
|------|----------|
| `identifier` | `Alice`, `loginScreen`, `$param`, `UI.Button`, `:`, `{`, `}`, `-` (single-char punctuation is emitted as identifiers for parser convenience) |
| `hook` | `@onSignIn` (an `@`-prefixed identifier; the `@` must be followed by an identifier-start char per §2.2; identifiers containing `/` are emitted as `identifier`, not `hook`; no current grammar accepts a hook token) |
| `string` | `"double-quoted text"` (unclosed strings consume to end of line) |
| `attribute` | `key=value` or `key="value with spaces"` |
| `arrow` | `-->`, `->>`, `-->>`, `--x`, `-x`, `--)`, `-)`, `->` (longest-match) |
| `labeled-arrow` | `-->\|label\|`, `-->\|"label"\|` |
| `bracket` | `[loading]`, `[*]` (literal text including the brackets) |
| `comment` | `%% comment text` |
| `directive` | `%%{...}%%` (single-line directive block) |
| `indent`, `dedent` | Synthetic tokens emitted when indent level changes |
| `newline` | Line boundary |

Indentation is two spaces or one tab per level. Mixed indentation rounds down. Blank lines do not change indent. Indentation is presentational for every wireframe block (all close on `end`); a component line uses indent presence as the signal for "do you have a body."

The tokenizer is **shared but not neutral.** Some lexemes are biased toward existing diagram types (`[*]` brackets come from state and are reused by wireflow; flowchart shape openers `((...))`, `(((...)))`, `{{...}}`, `[/.../\\]`, `[\\...\\]`, `>...]`, etc. landed with phase 3; relationship arrows `<|--`, `*--`, `o--` with class). Still to come: the `@{...}` shape-decorator form for flowchart; cardinality lexemes `||--o{`, `}o--||` for ER. Extending the longest-match lists is the standard way to grow the tokenizer. One consequence for wireframe: a `-flag` override whose flag starts with `x` or `)` would lex as the `-x` / `-)` sequence arrow, so such flags cannot be cleared with the shorthand.

If lexical pressure ever makes the shared tokenizer ugly, the escape hatch is letting `Diagram` provide an optional `tokenize()` override. We do not do that today.

### 4.3 Diagram extension contract

```ts
interface Diagram<AST extends DiagramAST = DiagramAST> {
  type: string;                                            // registry key
  name: string;                                            // human-readable label
  detect(firstLine: string): boolean;                      // grammar dispatch
  parse(tokens: Token[], source?: string): ParseResult<AST>;
  render(ast: AST): string;                                // SVG string
  toPlaintext(ast: AST): string;                           // canonical plaintext
}
```

A new diagram type is added by:

1. Implementing the contract.
2. Calling `registerDiagram(myDiagram)` once at module load.

The registry is a single global `Map<string, Diagram>`. `detectDiagram(firstLine)` walks all registered types and returns the first whose `detect()` returns true; `getDiagram(type)` looks up by type key. There is no priority ordering — `detect()` predicates must be unambiguous.

The `source` argument to `parse()` is optional and is used by parsers that need to recover faithful punctuation from the original lines (currently sequence and state).

### 4.4 Top-level API (src/api.ts)

```ts
parse(source: string): ParseResult<AST>
render(ast: DiagramAST): string
toJSON(ast: DiagramAST): string
fromJSON(json: string): DiagramAST
toPlaintext(ast: DiagramAST): string
```

- `parse()` finds the first non-trivial line (skipping blank, `%%`, and `---` frontmatter delimiters), routes through `detectDiagram()`, and runs the matched parser. It never throws.
- `render()` and `toPlaintext()` look up the diagram by `ast.type` and dispatch. They throw if the type is unregistered, since the AST should not exist without a corresponding registration.
- `toJSON` / `fromJSON` are thin `JSON.stringify` / `JSON.parse` wrappers. The AST is plain data and survives serialization without ceremony.

### 4.5 AST shape

```ts
type DiagramAST = {
  type: string;          // matches Diagram.type
  title?: string;
  accTitle?: string;
  accDescr?: string;
};

type BaseElementNode = {
  id: string;
  type: string;
  content?: string;
  attributes: Record<string, string>;
  flags: string[];
  children?: string[];
};
```

Diagram types extend `DiagramAST` with their own fields. `BaseElementNode` is the recommended shape for contained nodes that flow through component-like grammars (currently used by wireframe). Diagram-type-specific fields are declared on the concrete subtype, never added to `BaseElementNode`.

Every parser accepts `title`, `accTitle`, and `accDescr` lines (with or without a `:`); wireframe and wireflow included.

### 4.6 Error model

```ts
type ParseError = {
  message: string;
  line: number;     // 1-indexed
  col: number;      // 1-indexed
  severity: 'error' | 'warning';
};

type ParseResult<T> =
  | { ok: true;  ast: T }
  | { ok: false; errors: ParseError[]; partialAst?: T };
```

- Hard errors fail the parse but a `partialAst` is still returned so consumers can render what was understood (the examples viewer renders partials at 50% opacity).
- Warnings keep `ok: true`.
- The base `DiagramParser` class (`src/parser.ts`) provides `error()`, `warn()`, token navigation (`peek`/`consume`/`consumeIf`), and trivia handling (`skipTrivia`, `skipToEndOfLine`). All registered parsers extend it.

### 4.7 Frontmatter & directives

`---` frontmatter delimiters and `%%{...}%%` directives are tokenized but no diagram type currently consumes them. They round-trip transparently. Future use: theme selection, render hints, accessibility metadata.

### 4.8 Library adapters (extension point)

For diagram types that render in terms of an external component vocabulary (currently only wireframe), adapters map `{ module, componentName }` pairs to canonical render types and/or custom SVG/ASCII renderers. See §7.

### 4.9 Attached data

A wireflow is rendered from its own AST, but its screen nodes are more useful as thumbnails of the real screens. The caller may set `ast.wireframes` (a map from screen name to a parsed `WireframeAST`) before calling `render()`; the renderer then draws each screen node from that wireframe, in the addressed state, at its first declared viewport. The field is never produced by the parser and does not survive `toPlaintext`. This is the one place a diagram's render depends on data outside its own source.

## 5. Diagram Types

### 5.1 State diagram

**Type key:** `stateDiagram` (also detects `stateDiagram-v2`)
**Detection:** first line is `stateDiagram` or `stateDiagram-v2` (case-insensitive)

#### Grammar

```
stateDiagram-v2
  title An optional title

  [*] --> Pending
  Pending --> Active: start
  Pending --> Cancelled: cancel
  Active --> Done
  Done --> [*]

  state "Pending Approval" as Pending
  state Active {
    Idle --> Working
    Working --> Idle
  }

  note right of Pending: Initial state for all jobs
  note left of Done
    Multi-line note bodies are
    closed by `end note`.
  end note
```

Constructs:

- **States** — bare identifiers, or `state "Label" as Id` for labels with spaces, or compound `state Id { ... }` with nested transitions.
- **Transitions** — `from --> to` or `from --> to: label`. `[*]` represents start/end (kind `start`).
- **Notes** — `note left of S: text`, `note right of S: text`, or multi-line `note left of S` / `end note`.
- **Title** — `title <text>`.

#### AST

```ts
type StateDiagramAST = DiagramAST & {
  type: 'stateDiagram';
  states: StateNode[];
  transitions: Transition[];
  notes: StateNote[];
};

type StateNode = {
  id: string;
  label?: string;
  kind: 'state' | 'choice' | 'fork' | 'join' | 'start' | 'end';
  children?: StateNode[];
  concurrency?: boolean;
};

type Transition = { from: string; to: string; label?: string; };
type StateNote = { position: 'left of' | 'right of'; state: string; text: string; };
```

#### Mermaid coverage

| Feature | Status |
|---------|--------|
| States, `[*]` start/end | Supported |
| `state "Label" as Id` | Supported |
| Compound states `state Id { ... }` | Supported (parsed; rendering is flat) |
| Transitions w/ labels | Supported |
| Notes (single-line + multi-line) | Supported |
| Title / accTitle / accDescr | Title only |
| Choice / fork / join (`<<choice>>`, `<<fork>>`, `<<join>>`) | Not yet (kind type exists) |
| Concurrent regions (`--` separator) | Not yet (field exists) |
| State description `S: description` shorthand | Not yet |
| Direction (`direction LR`) | Not yet |

#### Known issues

- Compound state children parse but the renderer lays them out flat — children are not visually nested.
- The renderer assumes one column of vertically stacked states with curved backward arrows; complex graphs become unreadable quickly.
- Self-loop and overlapping-edge stagger logic exists but breaks when more than two transitions share a node pair.
- Examples (`examples/diagrams/state.txt`) cover only `[*] --> State1 --> [*]`. Phase-2 work needs richer fixtures driving compound states, notes, and multi-edge layouts.

### 5.2 Sequence diagram

**Type key:** `sequenceDiagram`
**Detection:** first line is exactly `sequenceDiagram` (case-insensitive)

#### Grammar

```
sequenceDiagram
  title Sign-in flow

  participant Alice
  actor Bob as "Bob the user"

  autonumber

  Alice ->> Bob: Hello
  Bob -->> Alice: Hi there
  Alice ->>+ Bob: Are you free?
  Bob -->>- Alice: Yes

  note over Alice, Bob: They greet
  note left of Alice: Internal monologue

  loop Every minute
    Alice ->> Bob: Ping
  end

  alt Bob is online
    Bob -->> Alice: Pong
  else Bob is offline
    Alice ->> Alice: Retry later
  end

  par Tasks
    Alice ->> Bob: Task A
  and
    Alice ->> Bob: Task B
  end

  rect rgb(240, 240, 240)
    Bob ->> Alice: Wrap-up
  end

  break Connection lost
    Alice ->> Alice: Abort
  end
```

Constructs:

- **Participants** — `participant Id` or `actor Id`, with optional `as Alias` (string or identifier).
- **Messages** — `From <arrow> To: label` for all arrow variants. `+`/`-` suffixes on arrows (`->>+`, `-->>-`) emit implicit `activate`/`deactivate` statements on the receiving side.
- **Notes** — `note over A`, `note over A, B`, `note left of A`, `note right of A`, all followed by `: text`.
- **Activations** — explicit `activate Actor` / `deactivate Actor`.
- **Groups** — `loop`, `alt` / `else`, `par` / `and`, `break`, `rect <color>`, all closed by `end`.
- **`autonumber`** — emits an autonumber statement; renderer is a no-op today.
- **Title / accTitle / accDescr** — supported.

Arrow variants:

| Form | Meaning |
|------|---------|
| `->` | Solid line, open arrow |
| `->>` | Solid line, filled arrow |
| `-->` | Dashed line, open arrow |
| `-->>` | Dashed line, filled arrow |
| `-x`, `--x` | Cross-head (lost message) |
| `-)`, `--)` | Async arrow |

#### AST

```ts
type SequenceDiagramAST = DiagramAST & {
  type: 'sequenceDiagram';
  participants: Participant[];
  statements: SequenceStatement[];
};

type Participant = { actor: string; alias?: string; kind: 'participant' | 'actor'; };

type SequenceStatement =
  | { kind: 'message'; from: string; to: string; label: string; arrow: ArrowType; }
  | { kind: 'note'; position: 'over' | 'left of' | 'right of'; actors: string[]; text: string; }
  | { kind: 'activation'; actor: string; active: boolean; }
  | { kind: 'loop'; label: string; statements: SequenceStatement[]; }
  | { kind: 'alt'; branches: { condition: string; statements: SequenceStatement[] }[]; }
  | { kind: 'par'; branches: { label: string; statements: SequenceStatement[] }[]; }
  | { kind: 'break'; label: string; statements: SequenceStatement[]; }
  | { kind: 'rect'; color: string; statements: SequenceStatement[]; }
  | { kind: 'autonumber'; };
```

#### Mermaid coverage

| Feature | Status |
|---------|--------|
| `participant` / `actor` w/ alias | Supported |
| All standard arrow forms | Supported |
| `+`/`-` activation suffix | Supported |
| Explicit `activate` / `deactivate` | Supported |
| Notes (`over`, `left of`, `right of`, multi-actor) | Supported |
| `loop`, `alt`/`else`, `par`/`and`, `break`, `rect` | Supported |
| `autonumber` | Parsed only — not rendered |
| Title / accTitle / accDescr | Supported |
| `box` (participant grouping) | Not yet |
| Links / properties (`link`, `properties`) | Not yet |
| Critical / optional regions | Not yet |
| Background highlighting beyond `rect` | Not yet |

#### Known issues

- Group rendering is a single horizontal band with the kind label, regardless of nesting. Nested groups overlap visually.
- `note over A, B` parsing depends on the comma being glued to the second identifier (`,B`) — leading whitespace before the comma can drop the second actor.
- The renderer reserves a fixed `STMT_HEIGHT` per statement; activations contribute zero height, which leaves visual gaps and can crop labels in dense diagrams.
- `autonumber` is a placeholder — numbering is not actually drawn on messages.
- Examples (`examples/diagrams/sequence.txt`) cover only two participants and two messages. Phase-2 work needs fixtures exercising every group construct, note variant, and arrow form.

### 5.3 Flowchart

**Type key:** `flowchart` (also detects `graph`)
**Detection:** first line starts with `flowchart` or `graph` (case-insensitive)

#### Grammar

```
flowchart TD
  %% HTTP request handler pipeline

  Start([Incoming request]) --> Auth{Has auth header?}
  Auth -->|no| Reject[/Return 401 Unauthorized/]
  Auth -->|yes| Validate

  subgraph Validate[Validation]
    direction TB
    V1[Parse JSON body] --> V2{Schema valid?}
    V2 -->|no| ValidErr[/Return 400 Bad Request/]
    V2 -->|yes| V3[Resolve referenced entities]
  end

  Validate --> Cache[(Cache lookup)]
  Cache -->|hit| Cached([Return cached response])
  Cache -->|miss| DB[(Query database)]
  DB --> Process[[Process result]]
  Process --> Store[(Write cache)]
  Store --> Respond([Return response])

  Reject --> Done([End])
  ValidErr --> Done
  Cached --> Done
  Respond --> Done
```

Constructs:

- **Header.** `flowchart <direction>` or `graph <direction>` (alias). Direction is one of `TB`, `BT`, `LR`, `RL`. `TD` is accepted as an alias for `TB`.
- **Nodes.** A bare identifier creates a `rect`. Shape literals decorate the identifier: `Id[label]`, `Id(label)`, `Id([label])`, etc. First declaration wins for shape and label.
- **Edges.** `From <arrow> To` where arrow is one of `-->`, `---`, `==>`, `-.->`. Labeled arrows place the label between the arrow and the target: `From -->|label| To`.
- **Subgraphs.** `subgraph Id` ... `end` blocks group nodes into a compound container. `subgraph Id[Label]` for a custom display label. Optional `direction TB/LR` inside (parsed; renderer ignores — see Known issues).
- **Title.** `title <text>`.

Shape literals:

| Literal | Shape kind |
|---------|------------|
| `Id[text]` | `rect` |
| `Id(text)` | `round` |
| `Id([text])` | `stadium` |
| `Id[[text]]` | `subroutine` |
| `Id[(text)]` | `cylinder` (database) |
| `Id((text))` | `circle` |
| `Id(((text)))` | `double-circle` |
| `Id{text}` | `diamond` (decision) |
| `Id{{text}}` | `hexagon` |
| `Id[/text/]` | `parallelogram` |
| `Id[\\text\\]` | `parallelogram-alt` |
| `Id[/text\\]` | `trapezoid` (narrow top) |
| `Id[\\text/]` | `trapezoid-alt` (narrow bottom) |
| `Id>text]` | `asymmetric` (flag) |

Arrow variants:

| Form | Edge kind | Visual |
|------|-----------|--------|
| `-->` | `arrow` | Solid line with arrowhead |
| `---` | `line` | Solid line, no arrowhead |
| `==>` | `thick` | Thick solid line with arrowhead |
| `-.->` | `dotted` | Dotted line with arrowhead |

#### AST

```ts
type FlowchartAST = DiagramAST & {
  type: 'flowchart';
  direction: 'TB' | 'BT' | 'LR' | 'RL';
  nodes: FlowNode[];
  edges: FlowEdge[];
  subgraphs: FlowSubgraph[];
};

type FlowNode = { id: string; label?: string; shape: FlowShape; };
type FlowEdge = { from: string; to: string; label?: string; kind: FlowEdgeKind; };
type FlowSubgraph = {
  id: string;
  label?: string;
  direction?: FlowDirection;
  children: string[];  // IDs of nodes and nested subgraphs
};
```

#### Rendering

Renderer-side concepts that aren't AST-level:

- **Recursive scope layout.** Each subgraph is laid out in its own scope; its compound container becomes a single sized box in the parent layout, sized from the inner layout's dimensions plus header/padding.
- **Cross-scope edges.** Edges whose endpoints span scopes (e.g. an inner subgraph node → a root node) project a phantom edge into the LCA scope's ranking pass so the compound's column lines up correctly with its downstream partners. The real path is rendered separately, clamped to jog Y values that clear the source compound's bottom and the target compound's top.
- **Per-shape edge anchors.** Diamonds and cylinders project source/target arrow endpoints onto their actual outline (diamond edges, cylinder ellipses) instead of the bounding-rect midpoint, so arrows attach to the visible shape.
- **Compound frame styling.** Subgraphs are drawn via the shared `renderCompoundFrame` helper (also used by the state diagram's compound substates) — a rounded white body with a dark header strip and white label.

#### Mermaid coverage

| Feature | Status |
|---------|--------|
| `flowchart` / `graph` (alias) | Supported |
| Direction `TB` / `BT` / `LR` / `RL` (and `TD` alias) | Supported (top-level only; see Future enhancements) |
| All shape literals in the table above | Supported |
| All four arrow kinds, with labels | Supported |
| Subgraphs (compound containers) | Supported |
| Cross-scope edges | Supported |
| Title / accTitle / accDescr | Title only |
| Mermaid v11 `@{shape: name}` decorator | Not yet |
| Per-subgraph `direction` (parsed but not honored at render time) | Not yet |
| Multi-target arrows (`A & B --> C`) | Not yet |
| Class definitions / styling (`classDef`, `class A foo`) | Not yet |
| Click handlers (`click A "url"`) | Not yet |

#### Future enhancements

Tracked here rather than in §9 because none of them block the next Tier A diagrams.

- **Mermaid v11 `@{shape: name}` decorator.** Reserved per §2.2 — tokenizer is ready, parser hookup remains.
- **Per-subgraph direction.** `FlowSubgraph.direction` is captured in the AST but the renderer always inherits the outer direction. Honoring it would unlock horizontal-row subgraphs inside vertical diagrams.
- **Per-shape edge anchors for circles / double-circles.** Diamonds and cylinders already project source/target arrow endpoints onto the actual outline. Circles and double-circles still attach at the bbox edge — which happens to coincide with the circle's edge at center, but not for offset fan-out arrows.

### 5.4 Wireframe

**Type key:** `wireframe`
**Detection:** first line starts with `wireframe` (case-insensitive)

A wireframe describes a screen as a tree of components, with enough fidelity that an agent builds the right screen from it and a person can review the screen before it is built. Scenarios say what the screen does; the wireframe says what it is. The rendered wireframe is the design.

#### Grammar

```
wireframe
  use @hello10/diagrams/ui Stack, Text, Button, Input, Image, Table, Checkbox, Dialog
  use @app/components as App

  viewport mobile
  viewport desktop width=1024

  define ShowCard
    Stack gap=sm
      Image aspect=16:9
      Text $title weight=bold
      Text $venue size=sm muted
      Button "Open" -->|call| onOpen
    end
  end

  define PaymentDialog
    Dialog "Confirm purchase"
      Text "Two tickets for Hamilton, Saturday 8pm."
      Checkbox "Email me the receipt" checked
      Stack direction=row gap=sm justify=end
        Button "Cancel" -->|state| default
        Button "Pay $84" primary -->|call| onPay
      end
    end
  end

  screen Home
    Stack id=layout gap=lg
      App.Nav id=nav
        Stack direction=row align=center justify=between
          Text "Shows" size=lg weight=bold
          Button "Create" id=create -->|state| paying
        end
      end
      Stack id=content gap=lg
        Input id=search placeholder="Search shows"
        repeat ShowCard id=shows data=Show count=2 -->|call| onOpenShow
        Table id=showsTable data=Show columns="Title, Venue, Date" rows=3
      end
    end

    state paying
      create disabled
      modal PaymentDialog id=payment
    end

    viewport desktop
      layout direction=row gap=xl
      nav width=240
      shows direction=row gap=lg
    end
  end
end
```

Keywords (lowercase): `wireframe`, `use`, `viewport`, `define`, `screen`, `state`, `repeat`, `modal`, `end`, plus `title` / `accTitle` / `accDescr`. PascalCase identifiers are component references, and every one resolves to a `define` or an import; nothing is ambient. Lowercase identifiers inside a `state` or `viewport` block are component ids. Every block closes on `end`; indentation is presentational.

#### Core

```
structure     screen · state · viewport · repeat · modal · define · use
vocabulary    use @hello10/diagrams/ui Stack, Text, Button, Input, Select, Checkbox, Radio, Image, Audio, Video, Table, Dialog
layout        Stack — direction, gap, align, justify, padding; width / height on any node
canonical     text  button  input  select  checkbox  radio  image  audio  video  table  dialog
interaction   -->|goto| Screen · -->|state| name · -->|call| hook
data          data=Ref on any node
```

The canonical set is the HTML form-and-media set: types with distinct semantics, not distinct looks. Variants are props or adapters, not new types — a toggle is a checkbox, a heading is text, a link is a button that navigates, a toast is a dialog. Everything above the core is composition: `define` builds a Card, a Nav, a Tabs from the core and reuses it. A component with no mapping and no definition renders as a labeled box; that is a component that has not been mapped yet, not a gap in the language.

#### Constructs

- **`use`** — `use @module as Alias` (namespace) or `use @module A, B` (named). Top level only. The canonical set lives in `@hello10/diagrams/ui` and is imported like anything else: `use @hello10/diagrams/ui Stack, Text, Button`. A project's own vocabulary is another module (`use @acme/ui as App`). Resolution is `define`, then named import, then namespace; to use a different `Button`, import it from somewhere else. A canonical name used without its import gets an error that quotes the `use` line to add.
- **`viewport name [width=n]`** — top level. Declares a viewport the wireframe targets. `mobile` (390), `tablet` (768), and `desktop` (1280) have default widths; any other name needs `width=`. With no declaration the wireframe renders at one unnamed 390px viewport.
- **`define Name … end`** — top level. A reusable subtree. `$param` as a component's content declares a slot; a use site binds it with an attribute of the same name (`ShowCard title="Hamilton"`). Unbound slots render as italic placeholders. Hooks (`-->|call|`) inside a define surface on every screen that uses it. Use-site attributes that are not params, plus flags, `data=`, and an interaction, apply to the expanded root.
- **`screen Name … end`** — top level. The default state's component tree, followed by any `state` and `viewport` blocks.
- **Component line** — `Ref ["content" | $param] [id=name] [data=Ref] [key=value …] [flag …] [-->|kind| target]`, with an optional indented body closed by `end`. `id` values are camelCase and unique within their screen (states included); the same id may appear in different screens. Content must come directly after the reference.
- **`Stack`** — the one layout primitive, from `@hello10/diagrams/ui`. `direction=column|row` (column default), `gap` and `padding` (`none xs sm md lg xl xxl` or a pixel number), `align=start|center|end|stretch` (stretch default), `justify=start|center|end|between`. Any component with children lays them out as a column; `Stack` is how you say otherwise.
- **Sizing** — `width` and `height` on any node: `fill`, `hug`, or a pixel number. Unset width is `fill` in a column (unless the column's `align` is not `stretch`) and, in a row, `fill` for containers and fields (`Stack`, boxes, `table`, `dialog`, `input`, `select`) but `hug` for controls and media. Unset height is `hug`; a row with `align=stretch` stretches its children.
- **`repeat`** — a repeated region. `repeat Card [props]` is shorthand for `repeat [props]` with a body of one bare `Card`; both normalize to the same AST (a `repeat` node with children). `count=n` is the number of copies drawn (default 3); `direction=row` lays them side by side. `data=` names the collection.
- **`modal`** — an overlay. Same two forms as `repeat`. Valid anywhere inside a screen, almost always inside a `state`. Drawn over a dimmed frame with a shadow; never part of the flow.
- **`state name … end`** — inside a screen. Declares what differs from `default`. Two kinds of line: an **override** (`id [content] [data=] [key=value …] [flag …] [-flag …] [-->|kind| target]`) changes an existing component's props, flags, content, data, or interaction, with `-flag` clearing a flag; an **addition** (a component, `repeat`, or `modal`) is appended after the default tree. `default` is the implicit base state and cannot be declared; `-->|state| default` returns to it. Overrides must match an id in the default tree or in the same state's additions.
- **`viewport name … end`** — inside a screen. Overrides only, for a declared viewport. Layout props may vary per viewport; the tree does not, so components, content, and interactions are rejected here. A `hidden` flag is a prop and is allowed.
- **Interactions** — one per component. `goto` targets a screen (`Detail`) or a screen state (`Detail.open`); `state` targets a state of the enclosing screen and is validated (except inside a `define`); `call` names a hook the screen raises. Plain `-->` and bare `@hook` are rejected with a pointer to the typed form.
- **`data=Ref`** — a spec reference for the collection or entity a component shows. Promoted to `node.data`; the value is opaque to the library.
- **Flags the renderer honors** — `primary` and `selected`/`active` on buttons; `checked`/`selected` on checkbox and radio; `disabled` on anything (dimmed); `hidden` (not drawn); `muted` and `bold` on text.
- **Attributes the renderer honors** — `size` (`xs sm md lg xl xxl` or px) and `weight` (`bold medium semibold` or a number) and `align` on text; `placeholder` and `label` on input and select; `aspect` (`16:9`, `1:1`, …) on image and video; `columns="A, B"` and `rows=n` on table. All other attributes pass through to adapters and the AST untouched.

#### AST

```ts
type WireframeAST = DiagramAST & {
  type: 'wireframe';
  root: string;
  elements: Record<string, WireframeElementNode>;   // keyed by element id
  defines: Record<string, DefineNode>;
  uses: WireframeUseImport[];
  viewports: WireframeViewport[];                   // { name, width }
};

type WireframeElementNode = BaseElementNode & {
  nodeKind: 'root' | 'screen' | 'component' | 'repeat' | 'modal';
  declaredId?: string;              // the id= the author wrote
  componentName?: string;           // as written: Button, UI.Card, Stack
  component?: WireframeComponentRef;// local | named-import | namespace-import
  data?: string;
  targetKind?: 'goto' | 'state' | 'call';
  target?: string;
  // screen only
  screenName?: string;
  states?: { name: string; overrides: WireframeOverride[]; children: string[] }[];
  viewportOverrides?: { viewport: string; overrides: WireframeOverride[] }[];
  hooks?: string[];
};

type WireframeOverride = {
  id: string; content?: string; data?: string;
  attributes: Record<string, string>; flags: string[]; clearFlags: string[];
  targetKind?: 'goto' | 'state' | 'call'; target?: string;
};
```

Element keys are the declared id when one was given (suffixed `~2`, `~3`, … when another screen already used it) and a generated `kind-stem-n` otherwise. Generated ids are not serialized. A state's additions are in `elements` and listed in `states[].children`, not in the screen's `children`.

#### Validation

Errors, all with a pointer to the right form: unknown keyword; bare `id`; `[state]` or a viewport on the screen line; duplicate imports, defines, viewports, states, or viewport blocks; undeclared viewport; `default` declared as a state; unresolved component (with the `use` line to add when it is a canonical name) or unknown namespace; duplicate id within a screen; override matching no id; component or interaction inside a viewport block; unknown `state` target; plain `-->`; bare `@hook`; `repeat Card` combined with a body; `repeat`/`modal` with neither; invalid `Stack` direction/align/justify/gap/padding; invalid `width`/`height`; two interactions on one line; legacy keywords (`list`, `grid`, `table`, `external`, `ref`).

#### Rendering

The renderer expands the tree once per screen × state × viewport (defines expanded with bindings, overrides applied — state first, then viewport — repeats unrolled, modals lifted) into a layout tree, then runs a measure pass and a draw pass with Stack semantics. Both the SVG and the ASCII rendering (`renderWireframeAscii`) walk that same tree, so they stay in step by construction.

- One frame per state per viewport, at the viewport's width; frames for a screen share a row per state. A caption carries screen, state, and viewport.
- A spacing scale (`4 8 12 16 24 32`) and a type scale (`11 12 14 18 24 32`) applied consistently; grayscale palette; controls 36px tall.
- Each canonical type is recognizable as itself: filled primary buttons, chevron on select, checked marks, image/video/audio placeholders, table header plus placeholder rows (or children as rows), dialog with title.
- Modals drawn over a dimmed frame with a drop shadow; the frame grows to fit them.
- Unmapped components: dashed box labeled `Name #id`. Adapter `renderSvg` receives the measured box and its children's SVG.
- Each drawn component is wrapped in `<g data-id data-component data-ref data-goto|data-state|data-call>` so tooling can locate it; each frame in `<g data-screen data-state data-viewport>`.
- A **Components** section renders every `define` on its own at 320px with its params.

### 5.5 Wireflow

**Type key:** `wireflow`
**Detection:** first line starts with `wireflow` (case-insensitive)

The navigation graph: wireframes as nodes, interactions as edges. An interaction declared on a wireframe component and an edge in a wireflow are one fact stated from two sides.

#### Grammar

```
wireflow
  title Ticketing flow

  decision paymentOk "Payment accepted?"

  [*] --> Login
  Login -->|call onSignIn| Home
  Login -->|goto signupLink| Signup
  Signup -->|call onSignUp| Home
  Home -->|state create| Home.paying
  Home -->|call onOpenShow| ShowDetail
  Home.paying -->|state cancel| Home
  Home.paying -->|call onPay| paymentOk
  paymentOk -->|yes| ShowDetail
  paymentOk -->|no| Home.paying
  ShowDetail -->|goto back| Home
  Home -->|call onLogout| [*]
end
```

- **Nodes** — a screen is named by its wireframe screen name (`Home`); a screen state by `Screen.state` (`Home.paying`). Both are nodes and need no declaration; `screen Name` declares one that no edge mentions. `decision id "Question?"` declares a decision (lowercase id). Node order is first mention.
- **Edges** — `From -->|label| To`, one per line, `-->` only. Leaving a screen, the label is `kind [trigger]`: the same `goto` / `state` / `call` vocabulary as wireframe, and the component id (for `goto` and `state`) or hook name (for `call`) that fires it. The trigger is optional; the kind is not. Leaving a decision, the label is the branch and is required.
- **Entry and exit** — `[*] --> Screen` (no label) and `Screen --> [*]` or `Screen -->|call hook| [*]`, as in a state diagram.
- **Validation** — untyped screen edges; unknown kind; decision edge without a branch; entry into a decision or with a label; `[*] --> [*]`; a `state` edge whose target is not a state of the same screen; `goto` into a decision; invalid node names; legacy `ref … end` blocks and wireframe keywords, each with a pointer to the current form.

#### AST

```ts
type WireflowAST = DiagramAST & {
  type: 'wireflow';
  order: string[];
  nodes: Record<string, { kind: 'screen'; id; ref: { screen; state? } } | { kind: 'decision'; id; question }>;
  edges: { from; to; interaction?: 'goto' | 'state' | 'call'; trigger?; branch? }[];   // [*] appears as an endpoint
  entries: string[];
  exits: string[];
  wireframes?: Record<string, WireframeAST>;   // attached by the caller, see §4.9
};
```

#### Rendering

A top-down layered graph using the shared layout pipeline (§4 of `src/layout.ts`): screens as 140px thumbnails (the real frame when a wireframe is attached, in the addressed state; a placeholder frame otherwise), decisions as diamonds, `[*]` as the state diagram's markers. Forward edges leave the bottom of their source and enter the top of their target, fanned across the thumbnail edge; every edge segment in a rank gap gets its own jog line so horizontals never overlap. Back edges run dashed up a channel to the right, with labels spread apart. Labels are `kind trigger` or the branch, on white pills. Sized to stay readable at twenty screens.

### 5.6 Class diagram

**Type key:** `classDiagram` (alias `class`)
**Detection:** first line is `classDiagram` or `class` (case-insensitive)

Mermaid class-diagram coverage: `class Name { … }` bodies and `Name : member` shorthand, visibility markers (`+ - # ~`), `<<stereotype>>`, generics (`List~Product~`, `class Repository~T~`), `namespace Name { … }` clusters, every relationship form in both arrow directions (`<|--`, `*--`, `o--`, `-->`, `--`, `..>`, `<|..`, `..`) with cardinalities and labels, `note for Class "…"` and standalone `note "…"`, `direction`, and `accTitle`. The fixture `examples/diagrams/class.txt` exercises each construct and is part of the round-trip corpus. The AST is in `src/diagrams/class/classTypes.ts`.

## 6. Examples viewer

`examples/` contains a Vite-based live preview app:

```
npm run dev:viewer
```

Split-pane editor with type-to-render. The example sources in `examples/diagrams/*.txt` are deliberately minimal today; expanding them is part of the phase-2 cleanup. Treat the viewer as a development tool, not a public API.

## 7. Library adapters

> Wireframe-specific today; documented here because adapters are an extension point that may apply to future component-rendering diagram types.

### 7.1 Adapter shape

```ts
type WireframeLibraryAdapter = {
  module: string;
  components: Record<string, WireframeLibraryComponentAdapter>;
};

type WireframeLibraryComponentAdapter = {
  type?: WireframeCanonicalRenderType;
  renderSvg?: (ctx: WireframeSvgRenderContext) => string;
  renderAscii?: (ctx: WireframeAsciiRenderContext) => string;
};
```

### 7.2 Canonical render types

`stack`, `text`, `button`, `input`, `select`, `checkbox`, `radio`, `image`, `audio`, `video`, `table`, `dialog`.

These are **renderer-layer vocabulary**: what an adapter maps a component name onto. `@hello10/diagrams/ui` is the adapter that maps the canonical PascalCase names (`Stack`, `Text`, `Button`, …) one to one; a project adapter may map its own `HStack` to `stack` or `PrimaryButton` to `button` the same way.

### 7.3 Registration

```ts
import { registerWireframeLibraryAdapter } from '@hello10/diagrams';

registerWireframeLibraryAdapter({
  module: '@my-org/ui',
  components: {
    PrimaryButton: { type: 'button' },
    Hero:          { renderSvg: ctx => `...` },
  },
});
```

### 7.4 The canonical module

`@hello10/diagrams/ui` is always registered and cannot be replaced (`registerWireframeLibraryAdapter` throws). It is the only registration this library makes; it has no knowledge of any particular UI package. `clearWireframeLibraryAdapters()` removes every project adapter and keeps the canonical module. `WIREFRAME_UI_MODULE` and `WIREFRAME_UI_COMPONENTS` export the name and the mapping.

### 7.5 Resolution rules

- Imported components without an adapter mapping fall back to a dashed labeled box.
- Local `define` components render by expanding their declared subtree with the use site's bindings.
- A component-level `renderSvg` overrides canonical-type rendering. It receives the measured box (`x`, `y`, `width`, `height`) and `childrenSvg`; height is the children's column height plus padding, at least 48px.
- `renderAscii` mirrors `renderSvg` for the ASCII renderer.

## 8. Public API surface

Exported from `@hello10/diagrams`:

```ts
// Core
parse, render, toJSON, fromJSON, toPlaintext
registerDiagram

// Diagram classes (for custom registries)
Diagram, DiagramParser, DiagramRenderer
FlowchartDiagram, SequenceDiagram, StateDiagram, ClassDiagram, WireframeDiagram, WireflowDiagram

// Wireframe extension points
registerWireframeLibraryAdapter
clearWireframeLibraryAdapters
getWireframeLibraryAdapter
renderWireframeAscii

// Types
BaseElementNode, DiagramAST, ParseError, ParseResult, Token, TokenType
```

Diagram-type-specific AST types (`WireframeAST`, `SequenceDiagramAST`, `StateDiagramAST`, etc.) are accessible through the corresponding subpath modules.

## 9. Next major work

Tracked at the spec level so the gap between current implementation and target is explicit.

1. **Wireframe in use.** The renderer's remaining limits surface only against real Jump screens: text metrics are estimated, not measured; `hug` width inside a hugging column is approximate; a row that overflows shrinks its hugging children rather than wrapping. Fix each as a Jump diagram hits it.
2. **Wireflow at scale.** Twenty screens render; beyond that, edge crossings and back-edge channels will need a second pass (lane assignment per back edge, label placement away from crossings).
3. **State / sequence cleanup.** Fix the rendering bugs called out in §5.1 / §5.2 when a Jump diagram hits them.
4. **Phase 3 — ER.** Parser, AST, renderer, and structural-assertion fixture, plus cardinality lexemes (`||--o{`, `}o--||`, `||..||`, …) in the tokenizer.

   Tier B's Architecture (`architecture-beta`) and User Journey (`journey`) are the next planned additions after Tier A; tokenizer hooks for them will land when prioritized.

Items beyond the diagram engine (skill integration, ARCH.md authoring, AI-consumable spec format) are deliberately out of scope for this document; they are the layer above and will be re-engaged after the engine is solid.
