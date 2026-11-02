# @hello10/diagrams

Plaintext diagram grammar, parser, and SVG renderer. Parse Mermaid-flavored text into a typed AST, render the AST to SVG, round-trip the AST back to canonical plaintext.

- ESM-only, fully typed (TypeScript)
- Zero runtime dependencies — no DOM, no canvas, runs in Node, Workers, and the browser
- Five diagram types: `sequence`, `state`, `flowchart`, `class`, `ui`
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
| UI | `ui` | — |

The UI diagram has no Mermaid analog. It describes an app's interface as components: what each is made of, what it shows, what data it reads and writes, what a person can do in it, and how it looks in each of its modes. One document renders two ways: frames (every screen and component in each view) and flow (screens joined by the moves between them). See [spec/spec.md](spec/spec.md) §5.4 for the language and the standard library, and [examples/diagrams/ui.txt](examples/diagrams/ui.txt) for a worked example. A `%%{theme ink=… accent=…}%%` directive sets the interface color and the callout color; the defaults are neutral.

```
ui
  use "@hello10/diagrams/ui" Stack, Heading, Text, Input, Button
  api "@gigs/api" results, band

  screen Search route=/
    in ~results(query=#query.value)

    Stack
      Input #query placeholder="Search bands"
      list results as band
        BandResult(band) $open(picked) => go Band(id=picked.id)
      end
      when
        ~results.empty => Text "No bands match."
      end
    end
  end

  screen Band route=/bands/:id
    in ~band(id)

    Stack
      when
        ~band.loading => Text "Loading…"
        ~band.error   => Text "Could not load this band."
      end
      Heading "{band.name}"
    end
  end

  component BandResult(band)
    Stack direction=row
      Heading "{band.name}"
      Button "View" $click => $open(band)
    end
  end
end
```

```ts
import { parse, render, renderUiFlow, renderUiAscii } from "@hello10/diagrams";

const result = parse(source);
if (result.ok) {
  const frames = render(result.ast);       // frames view
  const flow = renderUiFlow(result.ast);   // flow view
  const text = renderUiAscii(result.ast);  // the same expanded tree as text
}
```

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
