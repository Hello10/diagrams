export { parseUiApp } from "./uiApp.ts";
export { UiAppRenderer } from "./UiAppRenderer.ts";
export { UiDiagram } from "./UiDiagram.ts";
export { UiFlowRenderer } from "./UiFlowRenderer.ts";
export { UiParser } from "./UiParser.ts";
export { UiStoryboardRenderer } from "./UiStoryboardRenderer.ts";
export {
	clearUiLibraryAdapters,
	getUiLibraryAdapter,
	registerUiLibraryAdapter,
} from "./uiAdapters.ts";
export { UiFrameEngine } from "./uiFrame.ts";
export { uiToPlaintext } from "./uiToPlaintext.ts";
export * from "./uiTypes.ts";

import { UiAppRenderer } from "./UiAppRenderer.ts";
import { UiFlowRenderer } from "./UiFlowRenderer.ts";
import { UiStoryboardRenderer } from "./UiStoryboardRenderer.ts";
import type { UiAppAST, UiAST } from "./uiTypes.ts";

/** The storyboard: flow overview, then every screen and stateful
 * component in each of its states. The same as `render()`. */
export function renderUiStoryboard(ast: UiAST): string {
	return new UiStoryboardRenderer({ ast }).render();
}

/** The flow view: screens joined by the transitions between them. */
export function renderUiFlow(ast: UiAST): string {
	return new UiFlowRenderer({ ast }).render();
}

/** Text rendering of the same expanded tree the frames view draws. */
export function renderUiAscii(ast: UiAST): string {
	return new UiStoryboardRenderer({ ast }).renderAscii();
}

/** The storyboard of a set of documents: the flow across all of them,
 * then each document's frames under its module name. */
export function renderUiApp(app: UiAppAST): string {
	return new UiAppRenderer(app).render();
}
