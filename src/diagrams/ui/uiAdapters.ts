import {
	UI_STANDARD_ELEMENTS,
	UI_STANDARD_MODULE,
	type UiLibraryAdapter,
} from "./uiTypes.ts";

/** Adapters map a module's element names onto render types or custom
 * renderers. The standard library is itself an adapter, under this package's
 * own module name; projects register their own beside it. */
const adapters = new Map<string, UiLibraryAdapter>();

function registerStandardModule(): void {
	adapters.set(UI_STANDARD_MODULE, {
		module: UI_STANDARD_MODULE,
		elements: Object.fromEntries(
			Object.entries(UI_STANDARD_ELEMENTS).map(([name, contract]) => [
				name,
				{ type: contract.type },
			]),
		),
	});
}

export function registerUiLibraryAdapter(adapter: UiLibraryAdapter): void {
	if (adapter.module === UI_STANDARD_MODULE) {
		throw new Error(
			`${UI_STANDARD_MODULE} is the standard library and cannot be replaced`,
		);
	}
	adapters.set(adapter.module, adapter);
}

export function getUiLibraryAdapter(
	moduleName: string,
): UiLibraryAdapter | undefined {
	return adapters.get(moduleName);
}

/** Remove every project adapter. The standard library stays. */
export function clearUiLibraryAdapters(): void {
	adapters.clear();
	registerStandardModule();
}

registerStandardModule();
