import type { Diagram } from "./Diagram.ts";

const registry = new Map<string, Diagram>();

/**
 * Register a Diagram implementation.
 * Overwrites any existing registration for `diagram.type`.
 */
export function registerDiagram(diagram: Diagram): void {
	registry.set(diagram.type, diagram);
}

/**
 * Look up a registered Diagram by its type key.
 * Returns undefined if not found.
 */
export function getDiagram(type: string): Diagram | undefined {
	return registry.get(type);
}

/**
 * Find the registered Diagram whose detect() returns true for the given first line.
 * Returns undefined if no registered type matches.
 */
export function detectDiagram(firstLine: string): Diagram | undefined {
	for (const diagram of registry.values()) {
		if (diagram.detect(firstLine)) {
			return diagram;
		}
	}
	return undefined;
}

/**
 * Return a copy of all registered diagram types (for inspection/testing).
 */
export function getRegisteredDiagrams(): Diagram[] {
	return Array.from(registry.values());
}

/**
 * Clear all registered diagrams. Intended for testing only.
 */
export function clearRegistry(): void {
	registry.clear();
}
