/**
 * File extensions for diagram sources. `.dgrm` is the canonical one.
 * `.dgrm.txt` is the same format, for places that only accept `.txt`.
 * The extension never decides the diagram type; the first line does.
 */
export const diagramExtensions = [".dgrm", ".dgrm.txt"] as const;

/**
 * Whether a path or file name names a diagram source, by its extension.
 * Case-insensitive. A bare extension with no name before it does not count.
 */
export function isDiagramPath(path: string): boolean {
	const name = path.slice(path.search(/[^/\\]*$/)).toLowerCase();
	return diagramExtensions.some(
		(ext) => name.endsWith(ext) && name.length > ext.length,
	);
}
