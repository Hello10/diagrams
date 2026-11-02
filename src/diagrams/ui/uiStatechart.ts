import { StateRenderer } from "../state/StateRenderer.ts";
import type { StateDiagramAST } from "../state/stateTypes.ts";
import { allHandlers, handlerLabel } from "./uiCallouts.ts";
import type { UiComponent } from "./uiTypes.ts";

/**
 * A component's modes as a state diagram: the modes declared on its header
 * are the states; every action that enters a mode is a transition from the
 * mode it is written in (or from every mode, when it is written in none).
 * Drawn by the state diagram renderer.
 */

export type ModeTransition = { from: string; to: string; label: string };

export function modeTransitions(component: UiComponent): ModeTransition[] {
	const modes = component.modes.map((m) => m.name);
	const out: ModeTransition[] = [];
	const add = (from: string | undefined, to: string, label: string) => {
		for (const f of from === undefined ? modes : [from]) {
			if (f === to) continue;
			out.push({ from: f, to, label });
		}
	};
	for (const { handler, node, mode } of allHandlers(component)) {
		if (handler.action.kind !== "mode") continue;
		add(mode, handler.action.mode, handlerLabel(node, handler.event));
	}
	for (const io of component.io) {
		for (const outcome of io.outcomes) {
			if (outcome.action.kind !== "mode") continue;
			add(undefined, outcome.action.mode, `~${io.name}.${outcome.mode}`);
		}
	}
	return out;
}

export function statechartAst(
	component: UiComponent,
	transitions: ModeTransition[],
): StateDiagramAST {
	return {
		type: "stateDiagram",
		states: component.modes.map((m) => ({ id: m.name, kind: "state" })),
		// Transitions between the same pair, in the same direction, draw as
		// one edge with the labels joined.
		transitions: mergeParallel(transitions),
		notes: [],
	};
}

/** The chart as a positioned group, for embedding in the storyboard. */
export function renderStatechart(chart: StateDiagramAST): {
	svg: string;
	width: number;
	height: number;
} {
	return new InlineStateRenderer(chart).inline();
}

class InlineStateRenderer extends StateRenderer {
	inline(): { svg: string; width: number; height: number } {
		return { svg: this.renderBody(), width: this.width, height: this.height };
	}
}

function mergeParallel(transitions: ModeTransition[]): ModeTransition[] {
	const out: ModeTransition[] = [];
	for (const t of transitions) {
		const same = out.find((o) => o.from === t.from && o.to === t.to);
		if (same) {
			if (!same.label.split(", ").includes(t.label))
				same.label = `${same.label}, ${t.label}`;
		} else out.push({ ...t });
	}
	return out;
}
