import { describe, expect, it } from "vitest";
import {
	type RouteEdge,
	type RoutePlacement,
	roundedPath,
	routeEdges,
	translatePath,
} from "./edgeRouter.ts";

function box(id: string, x: number, y: number, w = 80, h = 36): RoutePlacement {
	return { id, x, y, width: w, height: h, cx: x + w / 2, cy: y + h / 2 };
}

function place(...nodes: RoutePlacement[]): Map<string, RoutePlacement> {
	return new Map(nodes.map((n) => [n.id, n]));
}

const edge = (
	key: string,
	from: string,
	to: string,
	extra: Partial<RouteEdge> = {},
): RouteEdge => ({ key, from, to, isBack: false, ...extra });

describe("routeEdges", () => {
	it("draws a straight drop between stacked nodes", () => {
		const r = routeEdges(place(box("a", 0, 0), box("b", 0, 100)), [
			edge("1", "a", "b", { label: "go" }),
		]);
		expect(r.edges[0]?.kind).toBe("straight");
		expect(r.edges[0]?.d).toBe("M 40 36 L 40 100");
		expect(r.edges[0]?.label?.x).toBeGreaterThan(40);
	});

	it("jogs across the gap when the target is in another column", () => {
		const r = routeEdges(place(box("a", 0, 0), box("b", 200, 100)), [
			edge("1", "a", "b"),
		]);
		expect(r.edges[0]?.kind).toBe("jog");
		expect(r.edges[0]?.d).toMatch(/^M 40 36 L 40 .* L 240 100$/);
	});

	it("gives overlapping jogs in one gap different heights", () => {
		const r = routeEdges(
			place(
				box("a", 0, 0),
				box("b", 200, 0),
				box("c", 200, 100),
				box("d", 0, 100),
			),
			[edge("1", "a", "c"), edge("2", "b", "d")],
		);
		const ys = r.edges.map((e) =>
			Number(
				/L 40 ([\d.]+)|L 240 ([\d.]+)/.exec(e.d)?.[1] ??
					/L 240 ([\d.]+)/.exec(e.d)?.[1],
			),
		);
		expect(new Set(ys).size).toBe(2);
	});

	it("routes a back edge up a channel to the right of the graph", () => {
		const r = routeEdges(place(box("a", 0, 0), box("b", 200, 100)), [
			edge("1", "a", "b"),
			edge("2", "b", "a", { isBack: true, label: "again" }),
		]);
		const back = r.edges.find((e) => e.kind === "back");
		expect(back?.d.startsWith("M 280 118")).toBe(true);
		expect(back?.d.endsWith("L 80 18")).toBe(true);
		expect(r.bounds.x2).toBeGreaterThan(280);
		expect(back?.label?.anchor).toBe("start");
	});

	it("takes the left channel when the target's right is blocked", () => {
		const r = routeEdges(
			place(box("a", 0, 0), box("x", 120, 0), box("b", 200, 100)),
			[edge("1", "a", "b"), edge("2", "b", "a", { isBack: true })],
		);
		const back = r.edges.find((e) => e.kind === "back");
		expect(back?.d.startsWith("M 200 118")).toBe(true);
		expect(back?.d.endsWith("L 0 18")).toBe(true);
		expect(r.bounds.x1).toBeLessThan(0);
	});

	it("draws a same-column pair as two arcs bowing apart", () => {
		const r = routeEdges(place(box("a", 0, 0), box("b", 0, 100)), [
			edge("1", "a", "b", { label: "start" }),
			edge("2", "b", "a", { isBack: true, label: "stop" }),
		]);
		expect(r.edges.every((e) => e.kind === "twin")).toBe(true);
		const [down, up] = r.edges;
		expect(down?.label?.anchor).toBe("end");
		expect(up?.label?.anchor).toBe("start");
	});

	it("treats a diagonal pair as a forward edge and a back edge", () => {
		const r = routeEdges(place(box("a", 0, 0), box("b", 200, 100)), [
			edge("1", "a", "b"),
			edge("2", "b", "a", { isBack: true }),
		]);
		expect(r.edges.map((e) => e.kind).sort()).toEqual(["back", "jog"]);
	});

	it("loops a self edge on the node's right", () => {
		const r = routeEdges(place(box("a", 0, 0)), [
			edge("1", "a", "a", { label: "tick" }),
		]);
		expect(r.edges[0]?.kind).toBe("self");
		expect(r.edges[0]?.d).not.toContain("NaN");
		expect(r.edges[0]?.label?.x).toBeGreaterThan(80);
	});

	it("follows a chain through virtual nodes", () => {
		const v: RoutePlacement = {
			...box("v", 40, 100, 0, 0),
			virtual: true,
			cx: 40,
			cy: 100,
		};
		const r = routeEdges(place(box("a", 0, 0), v, box("c", 200, 200)), [
			edge("1", "a", "c", { chain: ["a", "v", "c"] }),
		]);
		expect(r.edges[0]?.kind).toBe("chain");
		expect(r.edges[0]?.d.endsWith("L 240 200")).toBe(true);
	});

	it("moves a label off a node it would cover", () => {
		// A wide node sits right of the drop where the label would go.
		const r = routeEdges(
			place(box("a", 0, 0), box("b", 0, 100), box("n", 86, 0, 200, 136)),
			[edge("1", "a", "b", { label: "a long transition label" })],
		);
		expect(r.edges[0]?.label?.anchor).toBe("end");
	});

	it("ignores edges whose endpoints are not placed", () => {
		const r = routeEdges(place(box("a", 0, 0)), [edge("1", "a", "zz")]);
		expect(r.edges).toEqual([]);
	});
});

describe("path helpers", () => {
	it("rounds the corners of an orthogonal polyline", () => {
		const d = roundedPath(
			[
				{ x: 0, y: 0 },
				{ x: 0, y: 50 },
				{ x: 100, y: 50 },
			],
			6,
		);
		expect(d).toBe("M 0 0 L 0 44 Q 0 50 6 50 L 100 50");
	});

	it("translates every coordinate, commas included", () => {
		expect(translatePath("M 0 0 C 1 2, 3 4, 5 6", 10, 20)).toBe(
			"M 10 20 C 11 22 13 24 15 26",
		);
	});
});

describe("parallel edges", () => {
	it("two edges the same way are not twins; they fan from the node", () => {
		const r = routeEdges(place(box("a", 0, 0), box("b", 0, 100)), [
			edge("1", "a", "b", { label: "yes" }),
			edge("2", "a", "b", { label: "no" }),
		]);
		expect(r.edges.some((e) => e.kind === "twin")).toBe(false);
		const [one, two] = r.edges;
		expect(one?.d).not.toBe(two?.d);
	});
});
