export { WireflowDiagram } from "./WireflowDiagram.ts";
export { WireflowParser } from "./WireflowParser.ts";
export { WireflowRenderer } from "./WireflowRenderer.ts";
export { WireframeDiagram } from "./WireframeDiagram.ts";
export { WireframeParser } from "./WireframeParser.ts";
export { WireframeRenderer } from "./WireframeRenderer.ts";
export {
	clearWireframeLibraryAdapters,
	getWireframeLibraryAdapter,
	registerWireframeLibraryAdapter,
} from "./wireframeAdapters.ts";
export {
	wireflowToPlaintext,
	wireframeToPlaintext,
} from "./wireframeToPlaintext.ts";
export * from "./wireframeTypes.ts";

import { WireframeRenderer } from "./WireframeRenderer.ts";
import type { WireframeAST } from "./wireframeTypes.ts";

/** Text rendering of a wireframe: the same expanded tree the SVG draws. */
export function renderWireframeAscii(ast: WireframeAST): string {
	return new WireframeRenderer(ast).renderAscii();
}
