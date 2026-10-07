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

Wireframe and wireflow are additive types with no Mermaid analog: a wireframe describes a single screen's layout; a wireflow links wireframes into a navigation graph. Both are under active rework — see [spec/spec.md](spec/spec.md) §5.4–5.5 for current syntax and known issues.

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
