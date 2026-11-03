import { highlight } from "../src/api.ts";

/** The editor is a plain-text `contenteditable`, so the browser owns typing,
 * the caret, and undo. Colors are CSS Custom Highlights over ranges of its
 * text: nothing here changes the DOM, so nothing can disturb any of those. */

type Piece = { node?: Node; start: number; text: string };

/** The editor's text, each piece with its offset. Browsers split text into
 * several nodes, and write a line break as a newline, a `<br>`, or by wrapping
 * the line in a `<div>`. A break from a `<div>` has no node of its own. */
function pieces(editor: HTMLElement): Piece[] {
	const out: Piece[] = [];
	let start = 0;
	let pendingBreak = false;
	const push = (text: string, node?: Node) => {
		out.push({ node, start, text });
		start += text.length;
	};
	const flushBreak = () => {
		if (pendingBreak && out.length > 0) push("\n");
		pendingBreak = false;
	};
	const visit = (parent: Node) => {
		for (const child of parent.childNodes) {
			if (child.nodeType === Node.TEXT_NODE) {
				flushBreak();
				push(child.nodeValue ?? "", child);
			} else if (child.nodeName === "BR") {
				flushBreak();
				// The `<br>` that holds an empty `<div>` open is not a line of
				// its own: the `<div>` already is.
				if (parent === editor || child.nextSibling) push("\n", child);
			} else {
				pendingBreak = true;
				visit(child);
				pendingBreak = true;
			}
		}
	};
	visit(editor);
	return out;
}

export function editorText(editor: HTMLElement): string {
	return pieces(editor)
		.map((piece) => piece.text)
		.join("");
}

export function paintHighlights(editor: HTMLElement): void {
	const all = pieces(editor);
	const source = all.map((piece) => piece.text).join("");
	// Chrome leaves a stray newline after everything is deleted, so `:empty`
	// cannot drive the placeholder.
	editor.classList.toggle("is-empty", source.trim() === "");
	if (!("highlights" in CSS)) return;
	const byKind = new Map<string, Range[]>();
	let at = 0;
	for (const span of highlight(source)) {
		// Spans come in order, so the walk through the pieces only moves forward.
		while (at < all.length - 1) {
			const piece = all[at] as Piece;
			if (piece.start + piece.text.length > span.from) break;
			at++;
		}
		const range = rangeFor(all, at, span.from, span.to);
		if (!range) continue;
		const ranges = byKind.get(span.kind);
		if (ranges) ranges.push(range);
		else byKind.set(span.kind, [range]);
	}
	CSS.highlights.clear();
	for (const [kind, ranges] of byKind) {
		CSS.highlights.set(`hl-${kind}`, new Highlight(...ranges));
	}
}

function rangeFor(
	all: Piece[],
	first: number,
	from: number,
	to: number,
): Range | undefined {
	const startPiece = all[first];
	if (!startPiece?.node) return;
	let last = first;
	while (last < all.length - 1) {
		const piece = all[last] as Piece;
		if (piece.start + piece.text.length >= to) break;
		last++;
	}
	const endPiece = all[last] as Piece;
	if (!endPiece.node) return;
	const range = document.createRange();
	range.setStart(startPiece.node, from - startPiece.start);
	range.setEnd(endPiece.node, to - endPiece.start);
	return range;
}
