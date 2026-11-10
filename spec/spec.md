# @hello10/diagrams — Spec

`@hello10/diagrams` is a plaintext diagram library: parse Mermaid-flavored syntax into a JSON AST, render the AST to SVG, round-trip the AST back to canonical plaintext.

This document is the source of truth for the package as a whole — its public API, extension contract, current diagram types, and the phasing of additional types we plan to support. Five Mermaid-aligned types are implemented. The UI diagram (§5.4) is specified prescriptively: the grammar there is the grammar, and the implementation is held to it.

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
| UI | `ui` | `ui` (same) |
| Class | `classDiagram` | `class` |
| ER | `erDiagram` | `entity` (planned) |

Short forms are additive — the canonical Mermaid keyword always works. New
diagrams should adopt this convention so fixture filenames double as the
source's first-line keyword.

### 2.1 Adopted verbatim

- **Arrow vocabulary.** Sequence: `->`, `->>`, `-->`, `-->>`, `-x`, `--x`, `-)`, `--)`. State: `-->`. Labeled arrows: `-->|label|`, `-->|"label"|`.
- **Block keywords closed by `end`.** `loop`/`end`, `alt`/`else`/`end`, `par`/`and`/`end`, `break`/`end`, `rect`/`end`, `subgraph`/`end`.
- **Comments.** `%% ...`.
- **Directives.** `%%{...}%%` (tokenized; the UI diagram consumes `theme`, the rest ignore them — see §4.7).
- **Frontmatter.** `---` delimiters skipped during type detection (YAML extraction deferred — see §4.7).
- **Title and accessibility.** `title`, `accTitle`, `accDescr`.
- **Identifier conventions.** PascalCase for types/components, lowercase for keywords, `:` as label separator.

### 2.2 Additive (no Mermaid analog)

These are extensions for diagram families Mermaid doesn't have, all introduced in Mermaid's stylistic mold (lowercase keywords, `end`-closed blocks, JS-style imports for module references):

- `ui`, the keyword introducing the UI diagram (§5.4).
- `use "@module" as Alias` and `use "@module" Name1, Name2` JS-style imports, including the standard library `@hello10/diagrams/ui`; `api "@module" name, …` for operations.
- `screen Name route=… layout=… end`, `layout Name(params) … end` with an `Outlet`, and `component Name(params) … end`, each with modes on its header (`@shows @albums`).
- `in ~name(args)` and `out ~name(args)` operations with outcome blocks; `list data as item … end`; `modal … end`; `when … end` cases.
- Sigils: `#id` handles, `@mode`, `$event`, `~operation`; handlers `$event => action` with the actions `@mode`, `$event(value)`, `~op`, and `go Screen(args)`.
- `=>` as the ui arrow, distinct from the flowchart's `-->`.
- Override blocks `{ #handle … ; #other … }` on one line, after Ruby's convention; `end` otherwise.

#### Lexical constraint on `@`

Mermaid v11 introduced shape-decorator syntax for flowchart nodes: `A@{ shape: rect, label: "Hello" }`. The tokenizer matches `@` as a `hook` token **only when followed by an identifier-start character**, so `@{...}` stays available for the flowchart parser. Module names (`@acme/ui`) contain a `/` and are emitted as identifiers. The UI diagram consumes a bare `@identifier` as a mode, and `~identifier` as an io operation.

### 2.3 Deliberate divergences

None today. The library aims to be Mermaid-compatible everywhere it overlaps with Mermaid grammar.

### 2.4 Coverage gaps

Mermaid features we don't yet implement. These are scope decisions tied to phase ordering, not divergences. They are listed per-diagram-type in §5 under each type's "Mermaid coverage" table.

## 3. Phasing & Status

The library's purpose is to support **living specifications** — documentation that lives alongside code, captures structure / intent / flow, and is consumable by AI agents for code generation. Phasing reflects implementation order and stability, not raw priority, and is scoped to the Mermaid diagram types that actually serve that goal.

### Already implemented

| Phase | Diagram | Type key | Status |
|-------|---------|----------|--------|
| 1 | UI | `ui` | Implemented to §5.4: parser with structural checks, frames and flow renderers, text rendering |
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

1. The `ui` type in use by Jump specs; renderer gaps fixed as real screens expose them.
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
| `identifier` | `Alice`, `loginScreen`, `UI.Button`, `:`, `{`, `}`, `;`, `-` (single-char punctuation is emitted as identifiers for parser convenience; `DiagramParser` drops `;` for every grammar but ui, where it separates overrides) |
| `hash` | `#query` (a handle; the ui diagram's element ids) |
| `hook` | `@shows` (an `@`-prefixed identifier; the `@` must be followed by an identifier-start char per §2.2; identifiers containing `/` are emitted as `identifier`, not `hook`; the ui diagram reads a hook as a mode) |
| `tilde` | `~signIn`, `~band.loading` (an operation, with an optional mode path; ui only) |
| `string` | `"double-quoted text"` (unclosed strings consume to end of line) |
| `attribute` | `key=value`, `key="value with spaces"`, or `key=Call(a=b, c)` (an unquoted value may carry one parenthesised call, spaces included) |
| `arrow` | `-->`, `->>`, `-->>`, `--x`, `-x`, `--)`, `-)`, `->`, `=>` (longest-match) |
| `labeled-arrow` | `-->\|label\|`, `-->\|"label"\|` |
| `bracket` | `[loading]`, `[*]` (literal text including the brackets) |
| `comment` | `%% comment text` |
| `directive` | `%%{...}%%` (single-line directive block) |
| `indent`, `dedent` | Synthetic tokens emitted when indent level changes |
| `newline` | Line boundary |

Indentation is two spaces or one tab per level. Mixed indentation rounds down. Blank lines do not change indent. Indentation is presentational for every UI-diagram block (all close on `end` or are brace blocks); a tree line uses indent presence as the signal for "do you have a body."

The tokenizer is **shared but not neutral.** Some lexemes are biased toward existing diagram types (`[*]` brackets come from state; flowchart shape openers `((...))`, `(((...)))`, `{{...}}`, `[/.../\\]`, `[\\...\\]`, `>...]`, etc. landed with phase 3; relationship arrows `<|--`, `*--`, `o--` with class). Still to come: the `@{...}` shape-decorator form for flowchart; cardinality lexemes `||--o{`, `}o--||` for ER. Extending the longest-match lists is the standard way to grow the tokenizer. The UI diagram adds `=>` to the arrow list, `~name` as a `tilde` token, and lets an unquoted attribute value carry a parenthesised call with spaces (`layout=AppShell(current=Search)`).

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
  highlight?(tokens: Token[], lines: string[]): HighlightRange[]; // optional, see §4.9
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
highlight(source: string): HighlightSpan[]
```

- `parse()` finds the first non-trivial line (skipping blank, `%%`, and `---` frontmatter delimiters), routes through `detectDiagram()`, and runs the matched parser. It never throws.
- `render()` and `toPlaintext()` look up the diagram by `ast.type` and dispatch. They throw if the type is unregistered, since the AST should not exist without a corresponding registration.
- `toJSON` / `fromJSON` are thin `JSON.stringify` / `JSON.parse` wrappers. The AST is plain data and survives serialization without ceremony.

The UI diagram adds a set form, for an app kept as several documents that import each other (§5.4.1, "Modules"). Each takes one argument:

```ts
parseUiApp({ documents: Record<string, string>, resolve?: (module: string) => string | undefined }): ParseResult<UiAppAST>
renderUiApp(app: UiAppAST): string
```

- `parseUiApp` parses every document syntactically first, then checks each against the others' declarations, so documents may import each other in cycles. The keys of `documents` are the module strings the documents name each other by. `resolve` supplies documents the set refers to but does not draw: their declarations are checked against, and their screens draw as stubs. Every error carries the `module` it is in. The set must have exactly one screen at `/`.
- `renderUiApp` draws the storyboard of the set: the flow across every document, then each document's layouts, screens, and components under its module name, in its own theme.
- A `ParseResult` that is `ok` may carry `warnings`: a `use` of a module that is neither an adapter nor a document in reach is one.

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

Diagram types extend `DiagramAST` with their own fields; each type's AST is in its `*Types.ts` and exported from the package (`UiAST`, `FlowchartAST`, `StateDiagramAST`, `SequenceDiagramAST`, `ClassDiagramAST`). `BaseElementNode` is the recommended shape for contained nodes in a new component-like grammar; no current type uses it (the UI diagram's `UiNode` carries structured handlers, cases, and children instead). Diagram-type-specific fields are declared on the concrete subtype, never added to `BaseElementNode`.

Every parser accepts `title`, `accTitle`, and `accDescr` lines (with or without a `:`).

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
- The base `DiagramParser` class (`src/DiagramParser.ts`) provides `error()`, `warn()`, token navigation (`peek`/`consume`/`consumeIf`), and trivia handling (`skipTrivia`, `skipToEndOfLine`). All registered parsers extend it.

### 4.7 Frontmatter & directives

`---` frontmatter delimiters and `%%{...}%%` directives are tokenized. The UI diagram consumes one directive, `%%{theme ink=… accent=…}%%` (§5.4.1), and rejects any other; the remaining types ignore them, and they round-trip transparently. Future use: render hints, accessibility metadata.

### 4.8 Library adapters (extension point)

For diagram types that render in terms of an imported element vocabulary (the UI diagram), adapters map `{ module, name }` pairs to standard elements and/or custom SVG/ASCII renderers. See §7.

### 4.9 Highlighting

`highlight(source)` classifies source text for syntax highlighting. It returns spans in order, never overlapping, each with `line`, `col`, and `endCol` (1-indexed, `endCol` exclusive), `from` and `to` (UTF-16 offsets), and a `kind`: `comment`, `directive`, `keyword`, `type`, `string`, `label`, `operator`, `property`, `data`, `handle`, `mode`, `event`, or `operation`. Text with no span, such as `,` or `{`, is plain.

It is editor-neutral: the library ships no colors and no editor code, and an editor maps kinds to its own styles. It works from tokens rather than a parse, so half-typed source highlights too, and it never throws.

There are two layers. A lexical layer covers everything the token type settles for every diagram: comments, directives, strings, arrows, bracket labels, and attributes. A diagram's optional `highlight()` then classifies what needs its own knowledge, such as keywords, names, and free text, and its ranges win where they overlap. The UI classifier uses the parser's own reserved words. A source of no known type, or a registered diagram without a classifier, gets the lexical layer alone.

`Token.endCol` is what makes this exact: a token's `value` can be shorter than its source text, since strings lose their quotes, comments their `%%`, and handles and operations their sigil.

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

- Edges go through the shared router (`src/edgeRouter.ts`): twin arcs for a pair with both directions, fan lanes where several edges share a node, back edges up a channel beside the graph. Three or more transitions between one pair of states still overlap.
- Choice, fork, join, and concurrent regions are parsed into the AST but not drawn.

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

### 5.4 UI diagram

**Type key:** `ui`
**Detection:** first line is `ui` (case-insensitive)
**Status:** implemented.

A `ui` document describes an app's user interface as components: what each is made of, what it shows, what data it reads and writes, what a person can do in it, and how it looks in each of its modes. The same document renders two ways: **frames** (each screen and component drawn in each of its views) and **flow** (screens as thumbnails, joined by the moves between them). It records composition, data dependencies, and interaction surfaces. It does not define execution: nothing in it says when, in what order, or how often anything happens.

This section has three parts that are kept strictly apart. §5.4.1 is the language. §5.4.2 is the standard library the language imports. §5.4.3 is one worked example; every noun in it (`band`, `album`, `track`) belongs to the example and to nothing else.

#### 5.4.1 Language

**Document.** A `ui` document is a list of declarations. References resolve after the whole document is read, so declaration order is free except inside a component body.

```
ui
  use "<module>" <Name>, <Name>, …     % element types, or another document's declarations, by name
  use "<module>" as <Alias>            % the same, namespaced
  api "<module>" <name>, <name>, …     % operations, by name
  api "<source>"                       % operations from a formal source
  in ~<name>                           % app data, in scope everywhere
  layout <Name>[(<param>, …)] … end
  screen <Name> route=<path> [layout=<Layout>[(<args>)]] [@<mode> …] … end
  component <Name>[(<param>, …)] [@<mode> …] … end
end
```

Nothing resolves without a declaration. Element types come from `use`; operations come from `api`. With names listed, every `in` and `out` must name one of them. With no names, the module is a formal source (an OpenAPI or GraphQL document) and any operation is accepted; checking those names against the source is a step outside this library.

**Modules.** A `use` module is either an adapter module (element types, §7) or another `ui` document. The host decides what a module string means; the library treats it as opaque. An imported name is in scope as if declared here: an imported screen is a target for `go` and `to=`, with its route params checked; an imported layout is valid in `layout=`; an imported component is valid in a tree, with its parameter list. The alias form addresses them as `Alias.Name`. Imports are explicit and not transitive, and an imported declaration resolves its own names in its home document; nothing from the importer leaks in. A name both declared and imported is a duplicate. Documents may import each other in cycles. A document parsed alone (`parse`) accepts a `use` of a module it cannot see with a warning: those names are unchecked, an instance draws as a placeholder box, a `go` to one takes any arguments and ends at a stub in the flow, and a `layout=` naming one leaves the screen bare. The set form (`parseUiApp`, §4.4) resolves them.

**Sigils.** Three, each marking one kind of thing. Position tells a declaration from a reference.

| Sigil | Thing | Declared | Referenced |
|---|---|---|---|
| `#` | an instance in a tree | on its tree line: `Input #query` | anywhere in the component: `#query.value`, `#query selected` |
| `@` | a mode of a component | on the header: `component Nav @none @search` | in actions, conditions, overrides: `=> @search`, `when @search`, `#nav @search` |
| `$` | an event | where emitted: `=> $open(band)` | where handled: `$open(picked) => …` |
| `~` | an io operation | by `in` or `out`: `in ~band(id)` | in actions and conditions: `=> ~signIn`, `when ~band.loading` |

The data an `in` returns is addressed by the operation's name without the sigil: `~band` is the request, `band` is what came back.

**Reserved words.** `ui use api in out screen layout component list as modal when else end go`, the io modes `loading error ready empty`, and the flag `hidden`. Attribute keys the language owns: `route`, `layout`, `direction`. Everything else lowercase on an element line comes from that element's contract (§5.4.2).

**Component body, in this order:** io declarations, the tree, then component-level `when` blocks. The order is enforced so a reader meets every name before it is used.

```
component TicketPicker(show)
  in  ~quote(show=show.id, qty=#qty.value)
  out ~order(show=show.id, qty=#qty.value)
    ready => go Ticket(id=order.id)
  end

  <tree>

  when
    @mode => { <override>; … }
  end
end
```

**Io.** `in ~name(args)` declares a read; `out ~name(args)` declares a write. An `in` runs on entry and again whenever an argument changes. An `out` runs when an action names it. Arguments are named (`name=value`), with `name` short for `name=name`. An operation's modes are `loading`, `error`, `ready`, and, for an `in` whose data is a list, `empty`; they are addressed as a path on the operation, `~signIn.error`. An io block holds outcome lines only, `<mode> => <action>`: what happens on entering that mode. What the component looks like in a mode is in the tree, under `when`. An `in` is `ready` at rest; an `out` is idle until named. A write's result is in hand in its `ready` outcome: `go Ticket(id=order.id)`.

**Tree.** A sequence of lines; a line with children has a block closed by `end` (or a `{ a; b }` brace block, the same thing on one line).

```
<Type> ["content"] [#handle] [key=value …] [flag …] [$event[(param)] => <action> …]   element
<Type>(<args>) [#handle] [$event[(param)] => <action> …]                               component use
list <data> as <item> [direction=row] … end
when [<subject>] … end
modal … end
```

- Content is a quoted string; `{path}` inside it interpolates data: `Heading "{band.name}"`, `Text "Hi, {session.user.name}"`.
- An attribute is `key=value`. The value is a string, a number, a data path (`src=band.image`, `options=genres`, `value=profile.name`), or, for a link's `to=`, a screen call (`to=Band(id=show.band.id)`).
- A component takes arguments in parens, named, with the shorthand: `FollowButton(band)` is `FollowButton(band=band)`. A value is a data path, a Name, or quoted text; quoted text is literal, so `Card(title="Hello")` shows Hello where the component writes `{title}`.
- `#handle` makes the instance addressable; unique within the component. A handle is needed only where something refers to it.
- Flags are bare words the element's contract defines (`primary`, `disabled`, `controls`), plus `hidden`.
- A **handler** is `$event[(param)] => action`, on the line of the element or instance that fires the event. `click` is an event of every element; other events come from the contract, and a component's events are what it emits. A component event carries at most one value; the handler binds it to a name that is in scope on that line: `BandResult(band) $open(picked) => go Band(id=picked.id)`. A line may carry several handlers.
- `list <data> as <item>` draws its body once per item; the item name is in scope inside the body.
- `modal … end` draws its body over the component, dimming it.

**Actions.** What follows `=>`, after an event or an io mode. Every action starts with a sigil or a verb:

```
@mode[(value)]        enter a mode; the value fills the mode's parameter
$event[(value)]       emit an event to the parent
~op                   run a write, or re-run a read
go Screen[(args)]     navigate; args are the screen's route params
```

**Modes.** A mode is one discrete appearance of a component, declared on its header: `screen Band … @shows @albums @about`. The first declared is the start. A mode may take one parameter, `@playing(current)`, which is in scope inside `when @playing` and in that mode's overrides; entering it supplies the value, `=> @playing(picked)`. Modes are flat: a component with two independent axes of state is two components. Io modes are the reserved four and are never declared.

**`when`.** The one conditional. In the tree it decides what is drawn; at component level it decides overrides.

```
when                         % each case is a condition
  ~signIn.error   => Text "Wrong email or password."
  ~signIn.loading => Button "Signing in…" busy disabled
  else            => Button "Sign in" primary $click => ~signIn
end

when current                 % each case is a value the subject is matched against
  Search  => { #search selected }
  Library => { #library selected }
end

when                         % a case's result is one statement, with its own block
  @shows => Stack
    list shows as show
      ShowRow(show) $open(picked) => go Show(id=picked.id)
    end
  end
  @about => Text "{band.bio}"
end
```

A condition is a data path (true when it holds a value), a mode `@name`, or an io mode `~op.mode`. With a subject, cases are values: a string, a number, or a Name. The first matching case wins; `else` is the last. No match draws nothing. A case's result is exactly one statement: in the tree, one tree line with its own block when it has one (several lines group in a `Stack`); at component level, an override block. One `when` is one or the other. `when` is a block like every other, `when … end` or `when { … }`, and an override block is likewise `{ … }` or newline-to-`end`.

**Overrides.** `#handle ["content"] [key=value …] [flag …] [@mode[(value)]] [$event => action …]`: a change to an instance the tree declares, in a component-level `when` case. `#search selected` marks a link; `#nav @search` sets a component instance's mode; `#audio $pause => @paused` adds a handler in that mode only. Overrides never add nodes: everything drawable is in the tree.

**Layouts.** `layout Name(params) … end` is a component that wraps screens: its tree holds exactly one `Outlet`, where the screen goes, and whatever every wrapped screen shares. A screen names its layout with `layout=Name`, passing arguments like any component use, `layout=AppShell(current=Search)`; a parameter not passed is not in hand, so a `when` on it matches nothing. A screen that names no layout has none; nothing applies implicitly. Navigation declared in a layout, or in a component it embeds, is available from every screen it wraps.

**Where the app opens.** The screen whose `route=/`. A document on its own need not have one; a set rendered together must have exactly one across its documents.

**Theme.** `%%{theme ink=#002676 accent=#FDB515}%%` anywhere at document level sets the rendering colors, in the language's own `key=value` form. `ink` is the interface's own color: frame borders, buttons, headings, text, the flow's screen outlines. `accent` is the callout badges, which draw as an accent disc with a numeral in white or in the ink, whichever contrasts with the accent, so a badge is distinct from any control it sits on. Both are hex colors; either may be left out. The defaults are `ink=#1f2937 accent=#3299f6`. Grays for secondary text, lines, and surfaces are the renderer's and are not themed.

**Data and scope.** One namespace per component, every name declared once: parameters, route parameters, the names of its `in` and `out` operations, and document-level `in`. List items are in scope in the list body, a mode's parameter inside that mode, a handler's parameter on its line. A bare lowercase name is always data; an instance's one readable property is `#handle.value`. A node bound to data that is not in hand is not drawn, so a frame in `~band.loading` shows what does not depend on `band`.

**Checks.** All structural. The parser reports an error for each:

- an element or component name that is neither imported nor declared; a namespace alias that is not imported
- an operation no `api` declares; an `~op` used in a component that neither declares it with `in`/`out` nor has it as document-level `in`
- a handler for an event the element or component does not fire; a parameter bound on an event that carries no value; an event a child emits that the parent never handles
- a data path whose head nothing supplies; an instance's value addressed bare (`q.value` for `#q.value`); a name declared twice
- a mode that is not on the header; a value on a mode without a parameter, or none on a mode with one; `else` not last; a value case without a subject; a path case under a subject
- `go` to something that is not a screen; route params missing or unknown, on `go` and on `to=`
- an argument to a parameter the component does not declare; arguments on an element; attributes or children on a component
- a layout without exactly one `Outlet`; an `Outlet` outside a layout; `layout=` naming something that is not a layout, or a parameter it does not declare
- a `use` naming a document that does not declare the name; a screen or layout used in a tree
- an override on a handle the tree does not declare; `@mode` on a handle that is not a component instance, or a mode that component does not declare
- io declared after the tree; a tree line after a component-level `when`; `empty` on an `out`; anything but outcomes in an io block
- duplicate handles, modes, or declarations; no screen at `/`
- retired words from earlier drafts (`state`, `entry`, `repeat`, `reads`, `writes`, `emits`, `on`, `if`, `data=`, `-->`), each with what replaced it

**Recovery.** One mistake is one error. A line that fails is given up at the point of failure and the next line parses on its own; a check that would only follow from the dropped part (an emit the lost handler would have handled) is not made. Blocks recover by indentation: an `end` sits at the indent of the line that opened its block, so in an indented body a line that comes back to the opener's indent, or an `end` shallower than it, reports the opener as missing its `end` and leaves the line for the enclosing block; an `end` deeper than the opener is reported as extra and skipped. A standard leaf element (`Text`, `Button`, `Input`, …) has no body, so a line indented under one is the next line of the enclosing block. A second line under a `when` case is one error naming the rule. Editors can rely on each error pointing at the line to change.

**Rendering.** One drawing, the storyboard, from `render()`:

- *Flow overview* first: screens as thumbnails, joined by every move to a screen: `go` actions on handlers and io outcomes, and links' `to=`, labeled by the event and the element or instance as the screen wrote it (`click Shows`, `open BandResult`) or by the io outcome (`~signIn.ready`), including those declared inside a component the screen embeds. A layout in use is a node too, drawn with the Outlet as an empty slot and captioned `layout`; its navigation is drawn once, from it. Self-loops are not drawn. The screen at `/` has a heavier border. Also available alone as `renderUiFlow()`.
- *Four tiers*, headed Flow, Layouts, Screens, Components. A layout's section comes first: its tree with the Outlet as an empty slot, and its actions listed once, there. A screen's frame draws the screen inside its layout, with the layout dimmed so the screen reads as the subject and a faint dashed outline around the content where the Outlet is, the same dash the layout's empty Outlet has, and lists only the screen's own actions; nothing from the layout is repeated across the screens it wraps. Every screen section precedes every component section; a component section is labeled with where it is first embedded: the component whose tree holds it, the mode, and `modal` (`in AppShell`, `in AlbumCard @listening, modal`).
- *One section per screen*: a mode chart when the component declares more than one mode, drawn by the state diagram renderer (§5.1) with the modes as its states and every action that enters a mode as a labeled transition from the mode it is written in; then its **views** as frames in a row. A view is a mode, or an io condition the tree names drawn in the mode it sits in; captioned `@shows`, `~band.loading`, `@bands ~favorites.empty`. A component with neither modes nor io conditions is one frame. In each frame, `when` cases are decided by the view (a data-path condition cannot be known from a diagram and is false, so `else` branches show), lists are unrolled three deep, a modal dims the frame, and data not in hand is left out. A row whose items do not fit wraps them onto further lines at their natural widths; nothing is squeezed. Only a placeholder wider than the whole frame is shortened, and it keeps its tail, the part that names the value. Literal text is what it says and is never shortened. Under each frame, a numbered callout for everything a person can do: a badge on the element, and a legend line `event → action` (`click → go Band(id=picked.id)`). Hidden, `disabled`, and `selected` elements get none. While a modal is up only the modal's elements count. A handler on a component instance is badged on the element inside that emits the event, through any forwarding, and its legend is the line as the parent wrote it: `TrackRow(track) $select(picked) => @playing(picked)` lists `select(picked) → @playing(picked)` on the row, and TrackRow's own frame explains `click → $select(track)`. Each frame speaks its own component's words. A view that shows an io condition is its mode's view with that condition applied, so it calls out only what the condition adds (a retry button, a modal's choices); the tabs and links the mode's own view already lists are not repeated under every variant.
- *One section per component*, drawn once, in the components tier, the same way at component width.
- `toPlaintext()` is the canonical form of the document and re-parses to the same AST; it is what an agent reads, along with the AST itself. `renderUiAscii()` prints the same expanded trees the frames draw (elements, bindings, flags, list items) as indented text, for checking what a frame will contain; it carries no handlers and is a debugging view, not a second source.

**Nesting.** How a component draws inside another:

1. An instance draws as its tree in its start mode, unless an override sets another (`#nav @search`), with its arguments bound. Its io is at rest: reads ready, writes idle.
2. Arguments substitute into placeholders and callouts: `Card(show=featured)` draws `{featured.title}` and `click → go Detail(id=featured.id)`. The component's own section uses its own names; inside a `list`, items keep the item name.
3. A `when <subject>` inside the instance matches against what the parent bound: `Nav(current)` with `current=Search` selects the Search link.
4. A parent's overrides reach the instance by its handle, never its insides.
5. A `modal` draws over the dimmed parent; a `list` draws three copies.
6. Recursion draws as a labeled box at the point of recursion.

**AST sketch.**

```ts
type UiAST = DiagramAST & {
  type: 'ui';
  uses: UiImport[]; apis: UiApi[]; io: UiIo[];
  entry?: string;                               // the screen at /
  components: Record<string, UiComponent>; order: string[];
};
type UiComponent = {
  name: string; route?: string; routeParams: string[]; isLayout?: boolean;
  layoutName?: string; layoutArgs: Record<string, string>; usesLayout?: string;
  params: string[]; modes: { name: string; param?: string }[];
  io: UiIo[]; tree: UiNode[]; whens: UiNode[];
  emits: Record<string, boolean>; scope: string[];
};
type UiIo = { kind: 'in' | 'out'; name: string; args: Record<string, string>; outcomes: { mode: UiIoMode; action: UiAction }[] };
type UiNode = { kind: 'instance' | 'list' | 'modal' | 'when'; name?: string; ref?: UiRef; content?: string; id?: string;
  args; attributes; flags; handlers: UiHandler[]; data?: string; item?: string; subject?: string; cases?: UiCase[]; children: UiNode[] };
type UiHandler = { event: string; param?: string; action: UiAction };
type UiAction = { kind: 'mode'; mode; value? } | { kind: 'emit'; event; value? } | { kind: 'io'; name } | { kind: 'go'; screen; args };
type UiCase = { condition: UiCondition; nodes: UiNode[]; overrides: UiOverride[] };
```

#### 5.4.2 Standard library

`@hello10/diagrams/ui` ships the elements. It is imported like any module; nothing is ambient. Each element follows its HTML5 counterpart: the attributes it takes, the events it fires, and the flags it owns are those of the HTML element, reduced to what a storyboard frame needs. `click` is an event of every element and is not listed.

| Element | HTML5 | Attributes | Events | Flags |
|---|---|---|---|---|
| `Stack` | `div` | `direction=row\|column` | | |
| `Heading` | `h1`–`h6` | content, `level` | | |
| `Text` | `p` / `span` | content | | |
| `Link` | `a` | content, `to` | | `selected` |
| `Button` | `button` | content | | `disabled`, `primary`, `busy` |
| `Input` | `input` | `placeholder`, `value`, `label` | `change`, `submit`, `focus`, `blur` | `disabled`, `invalid` |
| `Select` | `select` | `options`, `value`, `placeholder`, `label` | `change` | `disabled` |
| `Checkbox` | `input[type=checkbox]` | content | `change` | `checked`, `disabled` |
| `Radio` | `input[type=radio]` | content | `change` | `checked`, `disabled` |
| `Image` | `img` | `src`, `alt`, `aspect` | | |
| `Audio` | `audio` | `src` | `play`, `pause`, `ended` | `controls` |
| `Video` | `video` | `src`, `aspect` | `play`, `pause`, `ended` | `controls` |
| `Table` | `table` | `columns`, `rows` | | |
| `Dialog` | `dialog` | content | `close` | `open` |
| `Outlet` | `slot` | | | |

`Outlet` is valid only inside a `layout`, exactly once: it is where the wrapped screen renders. `to=` on a `Link` is a screen call and draws as navigation. `src=` and `options=` take data paths; `value=` is a literal prefill or a data path.

`busy` is a button with work in flight: it draws a spinner at its right edge, and the case that uses it usually gives a progressive label and `disabled` as well (`~signIn.loading => Button "Signing in…" busy disabled`). `selected` is the link to where you already are. A `disabled` element and a `selected` link are inert: they fire nothing, and a frame draws no callout on them. `hidden` is a flag every element and component accepts. `Stack` is layout: `direction` is the only layout word in the language; sizes, spacing, and alignment are the renderer's.

Other modules are a project's own elements and components, mapped onto this set through adapters (§7).

#### 5.4.3 Worked example

`examples/diagrams/ui.txt`: seven screens of a gig-finding app (sign in, band search, a band page with shows, albums, and an album player, a show page with a ticket purchase, a ticket, a library of followed bands and tickets, and a profile), two layouts, and the components they use. It is the fixture for the type and the document the language was derived from. Read it against §5.4.1; a few places to look:

- `api "@gigs/api" …` lists every operation the document uses; `in ~session` at document level is the signed-in user, read by `Nav` without being passed in.
- `AppShell(current)` is the layout the signed-in screens name, passing what the nav needs: `layout=AppShell(current=Search)`. `Nav(current)` marks the matching link with a `when current` block; `Band` passes nothing, so there nothing is marked. `Login` uses `Bare`.
- `Login` is an `out` and a form: the write takes `#email.value` and `#password.value`, its `ready` outcome goes to Search, and the tree says what the screen looks like while it is loading and when it fails, with two `when` blocks.
- `Search` has two reads; `~results` takes the input and the select by handle and re-runs when either changes. Nothing in the tree triggers it.
- `Band` declares three modes on its header, one per tab, and three reads. The tab links enter modes; the tab content sits under `when @shows` and the rest; the selected link is an override in a component-level `when`. Its frames are the three modes, then `~band.loading`, `~band.error`, and `~shows.empty`, each in the mode its condition sits in.
- `Show` uses `when show.soldOut … else …` for a data condition; the frames show the `else` branch, since a diagram cannot know the data.
- `FollowButton` and `TicketPicker` own their writes, so `Band` and `Show` have no mode for them. `FollowButton`'s whole tree is one `when` with three cases.
- `AlbumCard` owns the player modal: `@closed` and `@listening`, with the modal under `when @listening`. `AlbumPlayer` has a mode with a parameter, `@playing(current)`, entered from a track row with `=> @playing(picked)`, and draws the audio only under `when @playing`. Its header's `$close` is forwarded with `$close => $close`.
- `TicketRow` is a confirmation flow: `@holding` and `@confirming`, the modal under `when @confirming`, and the write's outcomes returning to `@holding`.

#### 5.4.4 Limits and boundaries

**Data is names only.** `api "@gigs/api" band, shows` declares operations by name, and `band.image` is a path the document uses. Nothing in the language says what `band` contains, what an operation takes beyond the arguments a document passes, or a field's type. The checks cover what they can: every path's head is supplied. An agent building from a document takes its paths as the contract and fills in the shapes. A later step could bind `api` to a schema (OpenAPI, GraphQL, or a typed module) and check paths against it; the `api` declaration is the hook for that.

**Language limits a spec author meets first.** Tabs are links with handlers and no `to=`. There is no `else if`; cases are flat. A `when` on a data path is drawn as false, so its `else` branch shows. The loading state of several reads is written against one of them.

**Rendering limits.** Text widths are estimated per character class, not measured. The storyboard is a scroll, not a page: the example app's seven screens render about 10,000px tall, since each io condition a screen names is its own frame; if grouping is ever needed, the split is already there in the tiers (flow, N screens, M components). The flow is clean for a chain or a tree of twenty screens; a hub whose sections all link back to it stacks those back edges into one channel, which reads but is dense.

### 5.5 Class diagram

**Type key:** `classDiagram` (alias `class`)
**Detection:** first line is `classDiagram` or `class` (case-insensitive)

Mermaid class-diagram coverage: `class Name { … }` bodies and `Name : member` shorthand, visibility markers (`+ - # ~`), `<<stereotype>>`, generics (`List~Product~`, `class Repository~T~`), `namespace Name { … }` clusters, every relationship form in both arrow directions (`<|--`, `*--`, `o--`, `-->`, `--`, `..>`, `<|..`, `..`) with cardinalities and labels, `note for Class "…"` and standalone `note "…"`, `direction`, and `accTitle`. The fixture `examples/diagrams/class.txt` exercises each construct and is part of the round-trip corpus. The AST is in `src/diagrams/class/classTypes.ts`.

## 6. Examples viewer

`examples/` contains a Vite-based live preview app:

```
vp run examples
```

A split-pane editor that renders as you type, highlighted by `highlight()` through CSS Custom Highlights over a plain-text `contenteditable` (`examples/editorHighlight.ts`), with the example for each type in a dropdown, the selection tracked in the URL hash, zoom controls, and a draggable divider. A source with hard errors renders its partial AST at half opacity. The sources in `examples/diagrams/*.txt` double as the round-trip corpus and the snapshot fixtures (`src/__snapshots__/*.svg`, approved with `vp test -u src/snapshots.test.ts`). The viewer is single-document; `examples/diagrams/ui/` holds the Gigs app split by capability for the set tests and the `ui-app.svg` snapshot, and a test pins it to the monolithic `ui.txt`. Treat the viewer as a development tool, not a public API.

## 7. Library adapters

> Used by the UI diagram.

### 7.1 Adapter shape

```ts
type UiLibraryAdapter = {
  module: string;
  elements: Record<string, UiElementAdapter>;
};

type UiElementAdapter = {
  type?: UiRenderType;
  renderSvg?: (ctx: UiSvgRenderContext) => string;
  renderAscii?: (ctx: UiAsciiRenderContext) => string;
};
```

### 7.2 Render types

One per standard element (§5.4.2): `stack`, `heading`, `text`, `link`, `button`, `input`, `select`, `checkbox`, `radio`, `image`, `audio`, `video`, `table`, `dialog`, `outlet`.

These are **renderer-layer vocabulary**: what an adapter maps a project's element name onto. `@hello10/diagrams/ui` is the adapter that maps the standard names one to one; a project adapter may map its own `PrimaryButton` to `button` the same way.

### 7.3 Registration

```ts
import { registerUiLibraryAdapter } from '@hello10/diagrams';

registerUiLibraryAdapter({
  module: '@my-org/ui',
  elements: {
    PrimaryButton: { type: 'button' },
    Hero:          { renderSvg: ctx => `...` },
  },
});
```

### 7.4 The standard library

`@hello10/diagrams/ui` is always registered and cannot be replaced (`registerUiLibraryAdapter` throws). It is the only registration this library makes; it has no knowledge of any particular UI package. `clearUiLibraryAdapters()` removes every project adapter and keeps the standard library. `UI_STANDARD_MODULE` and `UI_STANDARD_ELEMENTS` export the name and the contracts.

### 7.5 Resolution rules

A `use` module string resolves in this order: a registered adapter (the standard library among them) claims it → element types; else a document in the set, or one the resolver supplies → that document's declarations (§5.4.1, "Modules"); else the names are accepted unchecked, with a warning.

- Imported names without an adapter mapping fall back to a dashed labeled box.
- Components declared in the document render by expanding their tree with the use site's bindings.
- A component-level `renderSvg` overrides canonical-type rendering. It receives the measured box (`x`, `y`, `width`, `height`) and `childrenSvg`; height is the children's column height plus padding, at least 48px.
- `renderAscii` mirrors `renderSvg` for the ASCII renderer.

## 8. Public API surface

Exported from `@hello10/diagrams`:

```ts
// Core
parse, render, toJSON, fromJSON, toPlaintext, highlight
registerDiagram

// Diagram classes (for custom registries)
Diagram, DiagramParser, DiagramRenderer
FlowchartDiagram, SequenceDiagram, StateDiagram, ClassDiagram, UiDiagram

// UI diagram
renderUiStoryboard, renderUiFlow, renderUiAscii
parseUiApp, renderUiApp
registerUiLibraryAdapter
clearUiLibraryAdapters
getUiLibraryAdapter

// Types
BaseElementNode, DiagramAST, ParseError, ParseResult, Token, TokenType
HighlightKind, HighlightRange, HighlightSpan
UiAST, UiAppAST, UiComponent, UiImportedDecl, UiNode, UiTheme
FlowchartAST, StateDiagramAST, SequenceDiagramAST, ClassDiagramAST
```

The package has one entry point; there are no subpath exports.

## 9. Next major work

Tracked at the spec level so the gap between current implementation and target is explicit.

1. **UI limits.** The language and rendering limits in §5.4.4, and binding `api` to a schema so data paths can be checked. Fix each as a Jump diagram hits it.
2. **State / sequence cleanup.** Fix the rendering limits called out in §5.1 / §5.2 when a Jump diagram hits them.
3. **Phase 3 — ER.** Parser, AST, renderer, and structural-assertion fixture, plus cardinality lexemes (`||--o{`, `}o--||`, `||..||`, …) in the tokenizer.

   Tier B's Architecture (`architecture-beta`) and User Journey (`journey`) are the next planned additions after Tier A; tokenizer hooks for them will land when prioritized.

Items beyond the diagram engine (skill integration, ARCH.md authoring, AI-consumable spec format) are deliberately out of scope for this document; they are the layer above and will be re-engaged after the engine is solid.
