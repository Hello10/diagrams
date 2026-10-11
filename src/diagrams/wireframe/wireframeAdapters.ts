import {
	WIREFRAME_UI_COMPONENTS,
	WIREFRAME_UI_MODULE,
	type WireframeLibraryAdapter,
} from "./wireframeTypes.ts";

/** Adapters map a module's component names onto canonical render types or
 * custom renderers. The canonical vocabulary is itself an adapter, under
 * this package's own module name; projects register their own beside it. */
const adapters = new Map<string, WireframeLibraryAdapter>();

function registerCanonicalModule(): void {
	adapters.set(WIREFRAME_UI_MODULE, {
		module: WIREFRAME_UI_MODULE,
		components: Object.fromEntries(
			Object.entries(WIREFRAME_UI_COMPONENTS).map(([name, type]) => [
				name,
				{ type },
			]),
		),
	});
}

export function registerWireframeLibraryAdapter(
	adapter: WireframeLibraryAdapter,
): void {
	if (adapter.module === WIREFRAME_UI_MODULE) {
		throw new Error(
			`${WIREFRAME_UI_MODULE} is the canonical module and cannot be replaced`,
		);
	}
	adapters.set(adapter.module, adapter);
}

export function getWireframeLibraryAdapter(
	moduleName: string,
): WireframeLibraryAdapter | undefined {
	return adapters.get(moduleName);
}

/** Remove every project adapter. The canonical module stays. */
export function clearWireframeLibraryAdapters(): void {
	adapters.clear();
	registerCanonicalModule();
}

registerCanonicalModule();
