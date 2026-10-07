import type { WireframeLibraryAdapter } from "./wireframeTypes.ts";

const adapters = new Map<string, WireframeLibraryAdapter>();

export function registerWireframeLibraryAdapter(
	adapter: WireframeLibraryAdapter,
): void {
	adapters.set(adapter.module, adapter);
}

export function getWireframeLibraryAdapter(
	moduleName: string,
): WireframeLibraryAdapter | undefined {
	return adapters.get(moduleName);
}

export function clearWireframeLibraryAdapters(): void {
	adapters.clear();
	registerDefaultWireframeLibraryAdapters();
}

export function registerDefaultWireframeLibraryAdapters(): void {
	registerWireframeLibraryAdapter({
		module: "@jump/ui",
		components: {
			Button: { type: "button" },
			Text: { type: "text" },
			Input: { type: "input" },
			Select: { type: "select" },
			Checkbox: { type: "checkbox" },
			Radio: { type: "radio" },
			Image: { type: "image" },
			Audio: { type: "audio" },
			Video: { type: "video" },
			Table: { type: "table" },
			Dialog: { type: "dialog" },
			Modal: { type: "dialog" },
		},
	});
}

registerDefaultWireframeLibraryAdapters();
