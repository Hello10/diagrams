import type { DiagramAST } from "../../types.ts";

export type BaseElementNode = {
	id: string;
	type: string;
	content?: string;
	attributes: Record<string, string>;
	flags: string[];
	children?: string[];
};

export type WireframeUseImport =
	| {
			kind: "namespace";
			module: string;
			alias: string;
	  }
	| {
			kind: "named";
			module: string;
			names: string[];
	  };

export type WireframeComponentRef =
	| {
			kind: "local";
			name: string;
	  }
	| {
			kind: "named-import";
			module: string;
			name: string;
	  }
	| {
			kind: "namespace-import";
			module: string;
			alias: string;
			name: string;
	  };

export type WireframeAST = DiagramAST & {
	type: "wireframe";
	root: string;
	elements: Record<string, WireframeElementNode>;
	defines: Record<string, DefineNode>;
	uses: WireframeUseImport[];
};

export type WireframeInteractionKind = "goto" | "state" | "call";

export type WireframeElementNode = BaseElementNode & {
	nodeKind: "root" | "screen" | "component" | "repeat" | "modal";
	declaredId?: string;
	componentName?: string;
	component?: WireframeComponentRef;
	screenName?: string;
	viewport?: string;
	state?: string;
	targetKind?: WireframeInteractionKind;
	target?: string;
	hooks?: string[];
};

export type DefineNode = {
	name: string;
	params: string[];
	hooks: string[];
	template: string[];
};

export type WireflowAST = DiagramAST & {
	type: "wireflow";
	order: string[];
	screens: Record<string, WireflowScreen>;
	decisions: Record<string, WireflowDecision>;
};

export type WireflowScreen = {
	id: string;
	screenName: string;
	ref: string | null;
	inline: Record<string, WireframeElementNode> | null;
	bindings: Record<string, string>;
};

export type WireflowDecision = {
	id: string;
	question: string;
	branches: { label: string; target: string }[];
};

export type WireframeCanonicalRenderType =
	| "text"
	| "button"
	| "input"
	| "select"
	| "checkbox"
	| "radio"
	| "image"
	| "audio"
	| "video"
	| "table"
	| "dialog";

export type WireframeSvgRenderContext = {
	ast: WireframeAST;
	node: WireframeElementNode;
	label: string;
	x: number;
	y: number;
	width: number;
	height: number;
	childrenSvg?: string;
};

export type WireframeAsciiRenderContext = {
	ast: WireframeAST;
	node: WireframeElementNode;
	label: string;
};

export type WireframeLibraryComponentAdapter = {
	type?: WireframeCanonicalRenderType;
	renderSvg?: (ctx: WireframeSvgRenderContext) => string;
	renderAscii?: (ctx: WireframeAsciiRenderContext) => string;
};

export type WireframeLibraryAdapter = {
	module: string;
	components: Record<string, WireframeLibraryComponentAdapter>;
};
