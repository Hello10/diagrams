# @hello10/diagrams — Spec

`@hello10/diagrams` is a plaintext diagram library: parse Mermaid-flavored syntax into a JSON AST, render the AST to SVG, round-trip the AST back to canonical plaintext.

This document is the source of truth for the package as a whole — its public API, extension contract, current diagram types, and the phasing of additional types we plan to support. Wireframe and wireflow have known issues that are tracked here as the next major work; they are documented at the level the current implementation supports, not the level we want them to reach.

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
| Class | `classDiagram` | `class` (planned) |
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
- `define Name ... end` for reusable component subtrees.
- `use @module as Alias` and `use @module Name1, Name2` JS-style imports for component vocabularies.
- `screen Name viewport [stateName]` declaration with optional viewport and state-variant brackets.
- `repeat Component`, `modal Component` single-line constructs.
- `@hookName` references in wireflow for binding declared hook callbacks to outcomes.

#### Lexical constraint on `@`

Mermaid v11 introduced shape-decorator syntax for flowchart nodes: `A@{ shape: rect, label: "Hello" }`. To prevent collision when phase 3 lands flowchart support, the tokenizer matches `@` as a `hook` token **only when followed by an identifier-start character**. Sequences like `@{...}` fall through and remain available for the flowchart parser to interpret as shape decorators. The `@` prefix therefore carries one meaning per diagram-type context:

- `@identifier` → wireflow hook reference.
- `@{...}` → flowchart shape decorator (planned).

### 2.3 Deliberate divergences

None today. The library aims to be Mermaid-compatible everywhere it overlaps with Mermaid grammar.

### 2.4 Coverage gaps

Mermaid features we don't yet implement. These are scope decisions tied to phase ordering, not divergences. They are listed per-diagram-type in §5 under each type's "Mermaid coverage" table.

## 3. Phasing & Status

The library's purpose is to support **living specifications** — documentation that lives alongside code, captures structure / intent / flow, and is consumable by AI agents for code generation. Phasing reflects implementation order and stability, not raw priority, and is scoped to the Mermaid diagram types that actually serve that goal.

### Already implemented

| Phase | Diagram | Type key | Status |
|-------|---------|----------|--------|
| 1 | Wireframe | `wireframe` | Implemented; **major rework pending** (syntax + renderer) |
| 1 | Wireflow | `wireflow` | Partially implemented; **deferred** until wireframe stabilizes |
| 2 | Sequence | `sequenceDiagram` | Implemented; basic Mermaid coverage; rendering bugs |
| 2 | State | `stateDiagram` (alias `stateDiagram-v2`) | Implemented; basic Mermaid coverage; rendering bugs |
| 3 | Flowchart | `flowchart` (alias `graph`) | Implemented; basic Mermaid coverage; enhancements tracked in §5.3 |

### Tier A — core spec coverage (Phase 3 priorities)

The remaining diagrams to implement. Each maps to a different layer of a living spec — domain model, data model — and together with flowchart they cover the most universal spec surfaces.

| Diagram | Type key | Spec role |
|---------|----------|-----------|
| Class diagram | `classDiagram` | Domain types, UML class relationships |
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

1. Solidify wireframe syntax (per §5.4) and overhaul its renderer for legibility.
2. Fix known bugs and expand example coverage in `state` and `sequence`.
3. Realign wireflow against the new wireframe syntax (`-->|kind|` typed targets, `@hook` references).
4. Continue Phase 3 — Tier A. Flowchart is implemented (see §5.3). Remaining order: **class → ER**. Architecture and user journey follow as the first Tier B work but aren't scheduled into Phase 3.

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
| `hook` | `@onSignIn` (an `@`-prefixed identifier; the `@` must be followed by an identifier-start char per §2.2; identifiers containing `/` are emitted as `identifier`, not `hook`) |
| `string` | `"double-quoted text"` (unclosed strings consume to end of line) |
| `attribute` | `key=value` or `key="value with spaces"` |
| `arrow` | `-->`, `->>`, `-->>`, `--x`, `-x`, `--)`, `-)`, `->` (longest-match) |
| `labeled-arrow` | `-->\|label\|`, `-->\|"label"\|` |
| `bracket` | `[loading]`, `[*]` (literal text including the brackets) |
| `comment` | `%% comment text` |
| `directive` | `%%{...}%%` (single-line directive block) |
| `indent`, `dedent` | Synthetic tokens emitted when indent level changes |
| `newline` | Line boundary |

Indentation is two spaces or one tab per level. Mixed indentation rounds down. Blank lines do not change indent. Indentation is presentational for `screen` / `define` blocks (which close on `end`); component subtrees use indent presence as a soft signal for "do you have a body."

The tokenizer is **shared but not neutral.** Some lexemes are biased toward existing diagram types (`@hook` originates with wireflow; `[*]` brackets come from state; flowchart shape openers `((...))`, `(((...)))`, `{{...}}`, `[/.../\\]`, `[\\...\\]`, `>...]`, etc. landed with phase 3). As phase 3 continues, more will be added: the `@{...}` shape-decorator form for flowchart; relationship arrows `<|--`, `*--`, `o--` for class; cardinality lexemes `||--o{`, `}o--||` for ER. Extending the longest-match lists is the standard way to grow the tokenizer.

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

For diagram types that render in terms of an external component vocabulary (currently only wireframe), adapters map `{ module, componentName }` pairs to canonical render types and/or custom SVG/ASCII renderers. See §7.5.

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

> **Status: significant rework pending.** The current implementation captures the design we converged on for namespaced imports, typed interactions, and the local-define / repeat / modal model. It also has known bugs, syntax decisions slated for change, and renderer-quality issues that the next major work item will address. This section documents what currently works and flags what is changing; consider it descriptive of the implementation rather than prescriptive of the target.

#### Grammar (current)

```
wireframe
  use @jump/ui as UI
  use @jump/ui Button, Table
  use @app/components as App

  define ShowCard
    UI.Card
      UI.Image
      Button "Open" => call onOpen
    end
  end

  define PaymentDialog
    UI.Dialog
      UI.Text "Confirm purchase"
      Button "Pay" => call onPay
    end
  end

  screen HomeScreen mobile
    App.Chrome id
      App.Nav id
        Button "Create" id=createButton => state paymentDialogOpen
      end
      App.ShowFeed id=showFeed => call onShowFeedVisible
        repeat ShowCard id=shows => call onOpenShow
      end
      Table id=showsTable
    end
  end

  screen HomeScreen mobile [paymentDialogOpen]
    App.Chrome id
      App.Nav id
        Button "Create" id=createButton => state paymentDialogOpen
      end
      App.ShowFeed id=showFeed => call onShowFeedVisible
        repeat ShowCard id=shows => call onOpenShow
      end
      Table id=showsTable
    end

    modal PaymentDialog id=paymentDialog
  end
end
```

Reserved keywords (lowercase): `wireframe`, `use`, `define`, `screen`, `modal`, `repeat`, `end`. PascalCase identifiers refer to components — local `define`s, named imports, or namespace-qualified imports.

#### Constructs

- **`use`** — namespace (`use @jump/ui as UI`) or named (`use @jump/ui Button, Table`) imports. Only valid at the top level.
- **`define Name ... end`** — declares a reusable local component. Top-level only. The body is structural and is expanded at render time.
- **`screen Name [viewport] [[state]] ... end`** — declares a UI surface. Optional viewport identifier, optional `[stateName]` variant.
- **`repeat Component`** — single-line; declares a repeated region backed by a concrete component symbol. May carry `id=` / bare `id`, attributes, and a typed interaction target.
- **`modal Component`** — single-line; declares a nested overlay surface. Valid only inside a `screen`. Same modifiers as `repeat`.
- **Typed interactions.** Current syntax is `=> goto|state|call <Target>`. **This is changing** — see §2.3. Target syntax post-rework: `-->|goto| ScreenName`, `-->|state| stateName`, `-->|call| onCallback`.
- **`id` shorthand** — bare `id` derives an ID from the unqualified component name (`App.Chrome id` → `id=chrome`). `id=value` is the explicit form.

#### AST

```ts
type WireframeAST = DiagramAST & {
  type: 'wireframe';
  root: string;                                  // synthetic root element id
  elements: Record<string, WireframeElementNode>;
  defines: Record<string, DefineNode>;
  uses: WireframeUseImport[];
};

type WireframeElementNode = BaseElementNode & {
  nodeKind: 'root' | 'screen' | 'component' | 'repeat' | 'modal';
  declaredId?: string;
  componentName?: string;
  component?: WireframeComponentRef;             // resolved import / local define
  screenName?: string;
  viewport?: string;
  state?: string;
  targetKind?: 'goto' | 'state' | 'call';
  target?: string;
  hooks?: string[];                              // collected on screen nodes
};
```

#### Validation

- Duplicate namespace aliases / named imports
- Duplicate `define`s
- Unresolved component references
- `repeat` / `modal` referencing a non-component
- Duplicate IDs within a screen/state scope
- Wireflow-only constructs (`ref`, `decision`) used inside `wireframe`
- Plain `-->` without a `|kind|` label
- Bare `@hook` references (use `-->|call| HookName` instead)
- Legacy keywords (`list`, `grid`, `table`, `external`)

#### Open questions

The current implementation works but the syntax surface needs a second pass. The rework must resolve:

- **Other syntax cleanup.** The bare `id` shorthand, the placement of the `[state]` bracket, the implicit screen-state variant model, and the interaction between `repeat`/`modal` and component imports all need a second pass. There is too much surface area for what each construct should mean.
- **Renderer quality and legibility.** The current SVG output is functional but visually crude — fixed grid layout, weak typography hierarchy, no consistent spacing system, modals overlay screens with little visual treatment, generic-component fallback boxes look the same as adapter-rendered components.
- **Layout primitives.** No horizontal layout primitives — children of a screen or component stack vertically only. Real wireframes need at least one horizontal stacking model.
- **Adapter coverage.** Canonical render types cover form controls and media but not common containers (header, footer, sidebar, card body).
- **Wireflow alignment.** After the wireframe rework lands, wireflow will be re-specified to use `-->|kind|` typed targets and the `@hook` reference syntax (kept per §2.2). The two diagram types share a consistent interaction vocabulary.

### 5.5 Wireflow (deferred)

**Type key:** `wireflow`
**Detection:** first line starts with `wireflow` (case-insensitive)
**Status:** Parser exists; renderer is a placeholder. Spec deferred until wireframe stabilizes.

The current parser accepts:

```
wireflow
  ref HomeScreen
    @onSignIn --> CreateShowScreen
  end

  screen CreateShowScreen mobile
  end
end
```

The `@onSignIn` reference syntax is **kept** (per §2.2) with the lexical constraint that `@` must be followed by an identifier-start character to avoid colliding with Mermaid v11 flowchart shape decorators. The arrow form `@onSignIn --> CreateShowScreen` will be re-specified against the wireframe rework's `-->|kind|` vocabulary. **Do not treat the current parser as authoritative** for any other construct; it predates the wireframe decisions in §5.4.

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

`text`, `button`, `input`, `select`, `checkbox`, `radio`, `image`, `audio`, `video`, `table`, `dialog`.

These are **renderer-layer vocabulary**, not syntax keywords. They control how a mapped component is drawn, not what can appear in a wireframe source.

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

### 7.4 Default adapter

`@jump/ui` is registered by default with mappings for `Button`, `Text`, `Input`, `Select`, `Checkbox`, `Radio`, `Image`, `Audio`, `Video`, `Table`, `Dialog`, `Modal`. Call `clearWireframeLibraryAdapters()` to reset (re-registers the defaults) or `registerDefaultWireframeLibraryAdapters()` to restore them after replacement.

### 7.5 Resolution rules

- Imported components without an adapter mapping fall back to a generic boxed renderer.
- Local `define` components render by expanding their declared subtree.
- A component-level `renderSvg` overrides canonical-type rendering.
- `renderAscii` mirrors `renderSvg` for the ASCII renderer.

## 8. Public API surface

Exported from `@hello10/diagrams`:

```ts
// Core
parse, render, toJSON, fromJSON, toPlaintext
registerDiagram

// Wireframe extension points
registerWireframeLibraryAdapter
clearWireframeLibraryAdapters
registerDefaultWireframeLibraryAdapters
getWireframeLibraryAdapter
renderWireframe
renderWireframeAscii

// Types
BaseElementNode, Diagram, DiagramAST, ParseError, ParseResult, Token, TokenType
```

Diagram-type-specific AST types (`WireframeAST`, `SequenceDiagramAST`, `StateDiagramAST`, etc.) are accessible through the corresponding subpath modules.

## 9. Next major work

Tracked at the spec level so the gap between current implementation and target is explicit.

1. **Wireframe syntax rework.** Resolve the open questions (id shorthand, state-variant model, modal/repeat positioning, layout primitives). Re-specify in this document.
2. **Wireframe renderer overhaul.** Visual hierarchy, typography, layout system, container vocabulary, modal treatment.
3. **State / sequence cleanup.** Fix the rendering bugs called out in §5.1 / §5.2. Expand example fixtures to cover every supported construct.
4. **Wireflow alignment.** Re-specify wireflow grammar against the post-rework wireframe vocabulary (`-->|kind|` targets, `@hook` references, screen-state addressing).
5. **Phase 3 — remaining Tier A diagrams.** Flowchart is implemented (see §5.3); future enhancements are tracked there. Remaining order: **class → ER**. Each will need its own parser, AST, renderer, and structural-assertion fixture, plus tokenizer additions for that type's specific lexemes:
   - **Class**: visibility markers (`+`/`-`/`#`/`~`), relationship arrows (`<|--`, `*--`, `o--`, `..>`), generic-type brackets (`~T~`).
   - **ER**: cardinality lexemes (`||--o{`, `}o--||`, `||..||`, etc.).

   Tier B's Architecture (`architecture-beta`) and User Journey (`journey`) are the next planned additions after Tier A; tokenizer hooks for them will land when prioritized.

Items beyond the diagram engine (skill integration, ARCH.md authoring, AI-consumable spec format) are deliberately out of scope for this document; they are the layer above and will be re-engaged after the engine is solid.
