# @hello10/diagrams

Plaintext diagram grammar, parser, and SVG renderer. Parse Mermaid-flavored text into a typed AST, render the AST to SVG, round-trip the AST back to canonical plaintext.

- ESM-only, fully typed (TypeScript)
- Zero runtime dependencies — no DOM, no canvas, runs in Node, Workers, and the browser
- Six diagram types: `sequence`, `state`, `flowchart`, `class`, `wireframe`, `wireflow`
- Errors are data, not exceptions; partial ASTs on failure
- Extensible: register new diagram types against the `Diagram` contract

## Install

```sh
pnpm add @hello10/diagrams
```

## Quick start

```ts
import { parse, render, toPlaintext } from "@hello10/diagrams";

const result = parse(`
sequence
  participant A as Alice
  participant B as Bob
  A->>B: Hello
  B-->>A: Hi
`);

if (result.ok) {
  const svg = render(result.ast);        // SVG string
  const text = toPlaintext(result.ast);  // canonical source
} else {
  for (const e of result.errors) console.error(`L${e.line}:${e.col} ${e.message}`);
}
```

## Diagram types

| Type | Keyword | Aliases |
|------|---------|---------|
| Sequence | `sequenceDiagram` | `sequence` |
| State | `stateDiagram` | `stateDiagram-v2`, `state` |
| Flowchart | `flowchart` | `graph` |
| Class | `classDiagram` | `class` |
| Wireframe | `wireframe` | — |
| Wireflow | `wireflow` | — |

Wireframe and wireflow are additive types with no Mermaid analog. A wireframe describes a screen as a tree of components, with named states, target viewports, and typed interactions; it renders one frame per state per viewport. A wireflow is the navigation graph: screens (optionally in a state) and decisions as nodes, interactions as edges, rendered as screen thumbnails. See [spec/spec.md](spec/spec.md) §5.4–5.5 for the grammar.

```
wireframe
  use @hello10/diagrams/ui Stack, Text, Button, Input
  viewport mobile

  screen Home
    Stack gap=lg
      Text "Shows" size=lg weight=bold
      Input id=search placeholder="Search shows"
      Button "Create" id=create -->|state| creating
    end

    state creating
      create disabled
      modal
        Text "New show"
      end
    end
  end
end
```

To draw a wireflow with real screen thumbnails, attach the parsed wireframes before rendering:

```ts
const flow = parse(wireflowSource);
if (flow.ok) {
  flow.ast.wireframes = { Home: homeWireframe.ast };
  const svg = render(flow.ast);
}
```

`renderWireframeAscii(ast)` gives the same expanded tree as text, for terminals and agents.

## Grammar

The grammar reference is [spec/spec.md](spec/spec.md): goals, Mermaid alignment (what is adopted verbatim, what is additive, where we diverge), architecture, and per-type grammar, AST shape, and coverage.

Example sources for every type are in [examples/diagrams/](examples/diagrams/).

## Examples viewer

```sh
pnpm examples
```

Live editor with the rendered SVG beside it. Pick a diagram type from the dropdown; the URL hash tracks the selection.

## Develop

```sh
pnpm install
pnpm build       # tsup → dist/ (ESM + .d.ts)
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm lint        # biome check
pnpm fix         # biome check --write
pnpm verify      # build + typecheck + test + lint (the release gate)
```

Tests are colocated with source (`src/**/*.test.ts`).

## License

MIT
