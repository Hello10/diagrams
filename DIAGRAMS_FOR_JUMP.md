# Diagrams for Jump

What `@hello10/diagrams` gives a Jump spec, and what is left. A Jump spec describes an app in plaintext; the agent builds from it and a person reviews the rendering before anything is built. This package is the diagram engine under that. It has no dependency on Jump and knows nothing about any particular UI package.

`state`, `sequence`, `flowchart`, and `class` are usable now for the parts of a spec they fit. Renderer limits in them are fixed when a Jump diagram hits them.

## The `ui` diagram

One `ui` document describes the interface: screens with routes, the layouts that wrap them, and the components they are made of, each with the data it reads and writes, the modes it can be in, what a person can do in it, and where that leads. The grammar is in `spec/spec.md` §5.4 and is prescriptive: the implementation is held to it. `examples/diagrams/ui.txt` is a complete app and the reference for how a spec reads.

What a Jump spec gets from it:

- **One source, three renderings.** `render()` draws the storyboard: the flow of screens, each layout once with its actions, each screen inside its layout, and each component in every view with numbered callouts. `renderUiFlow()` is the flow alone. `renderUiAscii()` is the same expanded tree as text, for an agent or a diff.
- **Structural checks at parse time.** Every name is declared once and resolves; every handle, mode, event, operation, and data path is accounted for; a layout has exactly one `Outlet`; a screen says which layout wraps it when there is more than one. Errors are data with a line and column, and come with a hint when an old or wrong word is used.
- **Labels in the document's own words.** A callout or an edge label is always a line from the source of the component it sits in, so a reader can find it.
- **A project's own elements.** `registerUiLibraryAdapter()` maps a project's component names onto the standard render types, or supplies custom SVG and text renderers (spec §7). Nothing resolves without a `use` import.
- **Theming.** `%%{theme ink=… accent=…}%%` sets the interface and callout colors.

## Known limits

Listed at the end of spec §5.4.1 and tracked in §9. The ones a spec author meets first: tabs are links with handlers and no `to=`; there is no `else if`; a `when` on a data path is drawn as false, so the `else` branch shows; the loading state of several reads is written against one of them; text widths are estimated, not measured.

## Beyond the engine

Skill integration, the authoring workflow, and the AI-consumable spec format are the layer above this package and are not described here.
