# Multi-document `ui`: a document is a module

## What changes

A `ui` document can import screens, layouts, and components declared in another `ui` document. An app is a set of documents rendered together. Today a document is the whole app and `use` imports only element types from adapters.

## Language

No new syntax. The existing import forms gain a second kind of target:

```
use "<module>" Name, Name, …
use "<module>" as Alias
```

A module is either an adapter module (as today: element types) or another `ui` document. The host decides what module strings mean; the library treats the string as opaque. Jump will use `capability::diagram`, for example `use "tickets::tickets_ui" Show, TicketRow`.

An imported name is in scope exactly as if declared in this document:

- an imported **screen** is a valid target for `go Screen(args)` and `to=Screen(args)`; route params are checked against the imported declaration
- an imported **layout** is valid in `layout=Layout(args)`
- an imported **component** is valid in a tree, with the imported parameter list

The alias form addresses names as `Alias.Name`.

A document no longer needs a screen at `/`. That requirement moves to the set: exactly one `/` across the documents rendered together.

A screen names its layout or has none. The rule that a document's only layout wraps every screen that names none is gone: nothing applies implicitly, local or imported.

## Scope rules

- Imports are explicit and not transitive. Importing `Show` does not put `TicketPicker` in the importer's namespace, even though `Show` uses it.
- An imported declaration resolves its own names in its home document: its `use` and `api` lines, its document-level `in`, its components. Nothing from the importer leaks in.
- A name both declared locally and imported is the existing duplicate-declaration error.
- Cycles between documents are allowed and expected: discovery imports `Show` from tickets, tickets imports `Band` from discovery. Each document is parsed once; resolution is memoized.

## API

`parse(source)` is unchanged and takes no resolver. A document parsed alone is checked against what it declares. A `use` whose module is neither a registered adapter nor a document the parser can see gets a **warning** on the `use` line, and its names are accepted without checking: an instance draws as a placeholder box, a `go` to one is allowed with any arguments, a `layout=` naming one leaves the screen unwrapped.

The set is parsed and rendered by two functions, each taking one argument:

```ts
parseUiApp({
  documents: Record<string, string>,          // module string → source
  resolve?: (module: string) => string | undefined,
}): ParseResult<UiAppAST>

renderUiApp(app: UiAppAST): string
```

The keys of `documents` are the module strings the documents use to import each other. `resolve` supplies documents the set refers to but does not render: their declarations are checked against, and their screens draw as stubs. It is called once per module, only for modules no adapter claims and no key supplies.

Resolution order for a `use` module string: a registered adapter claims it → element types; else the set or the resolver supplies a source → document; else warning, as above.

Every error carries the `module` of the document it is in. `parseUiApp` parses every document syntactically first, then checks each against the others' declarations, so a cycle costs nothing and declaration order across documents is free.

The set AST:

```ts
type UiAppAST = {
  type: "ui-app";
  documents: Record<string, UiAST>;   // each with `module` set
  order: string[];                    // the keys of `documents`, in the order given
  entry?: { module: string; screen: string };
}
```

Each document AST records what its imported names resolved to under `imports`, keyed by the name as written (`Show`, `Tickets.Show`): the home module, the declared name, its kind, and its parameters. A component ref to an imported component carries `module`. The AST stays plain data, so `toJSON` / `fromJSON` survive and rendering never needs the resolver.

## Rendering

`renderUiApp` draws the storyboard of the set: the flow across every document, then each document as a group under its module name, with its layouts, screens, and components in its own words and its own theme. Frames are drawn once per screen and component, under the document that declares it. The flow uses the entry document's theme. A `go` to a screen outside the set ends at a stub box labeled with the module and name.

`render(ast)` for a single document keeps working: the flow of what it declares, with an edge to an imported screen ending at a stub box labeled with the module and name; frames for what it declares, with an imported component drawn as a placeholder box and an imported layout left out.

`toPlaintext` and `highlight` are unchanged.

## Errors

New, on the `use` line: a name not declared in a resolved document (error); a module neither an adapter nor a document (warning). At the set level: no screen at `/`, or more than one. Existing errors apply unchanged to imported names (bad `go` params, wrong arity on a component, an unhandled emit).

## Spec and examples

- §5.4.1: `use` target kinds; scope rules; "where the app opens" moves to the set; layouts are always named
- §4.4: `parseUiApp` and `renderUiApp`
- §7: adapters and document modules side by side under one resolution order
- `examples/diagrams/ui.txt` stays the monolithic Gigs app: the viewer's example, the round-trip corpus, and the snapshot fixture. `examples/diagrams/ui/` holds the same app split by capability for tests: shell (AppShell, Bare, Nav, Login), discovery (Search, Band, BandResult, FollowButton, ShowRow, AlbumCard, AlbumPlayer, AlbumHeader, TrackRow), tickets (Show, Ticket, TicketPicker, TicketRow), library, account. Each imports what it navigates to. The viewer stays single-document.
- Fixtures: the split Gigs app (a cycle between shell and every other document, imported layouts, imported components); a set with zero and with two `/` screens; a document parsed alone with an unresolved module.
- A test pins the two forms together: the split set and the monolith declare the same screens and components and draw the same flow edges.

## Why

Jump keeps each capability's `ui` diagram in that capability's spec so capabilities version independently. A screen that navigates to another capability's screen needs that declaration in scope, and the whole-app storyboard is the render of the set.
