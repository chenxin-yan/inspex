// JSON with comments and trailing commas (the `.jsonc` dialect editors use for tsconfig.json).

export type JsoncResult =
	| { ok: true; value: unknown }
	| { ok: false; error: { message: string; start: number; length: number } };

/** Parses JSONC text. Offsets in errors are UTF-16 indices into `text`. */
export function parseJsonc(text: string): JsoncResult {
	const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
	const body = bom ? text.slice(1) : text;
	// Most specs are plain JSON; the native parser is much faster than stripping first.
	try {
		return { ok: true, value: JSON.parse(body) };
	} catch {}
	const stripped = stripJsonc(body);
	if (stripped !== undefined) {
		try {
			return { ok: true, value: JSON.parse(stripped) };
		} catch {}
	}
	const error = findSyntaxError(body);
	return { ok: false, error: { ...error, start: error.start + bom } };
}

/**
 * Replaces comments and trailing commas with spaces, keeping every offset and line break,
 * or returns undefined for an unterminated string or block comment.
 */
export function stripJsonc(text: string): string | undefined {
	let out = "";
	let copied = 0;
	let pendingComma = -1;
	const blank = (start: number, end: number): void => {
		out += text.slice(copied, start) + text.slice(start, end).replace(/[^\r\n]/g, " ");
		copied = end;
	};
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c === 0x22 /* " */) {
			pendingComma = -1;
			i = skipString(text, i);
			if (i < 0) return undefined;
		} else if (c === 0x2f /* / */ && text.charCodeAt(i + 1) === 0x2f) {
			const end = lineEnd(text, i);
			blank(i, end);
			i = end - 1;
		} else if (c === 0x2f && text.charCodeAt(i + 1) === 0x2a /* * */) {
			const close = text.indexOf("*/", i + 2);
			if (close < 0) return undefined;
			blank(i, close + 2);
			i = close + 1;
		} else if (c === 0x2c /* , */) {
			pendingComma = i;
		} else if (c === 0x7d /* } */ || c === 0x5d /* ] */) {
			if (pendingComma >= 0) blank(pendingComma, pendingComma + 1);
			pendingComma = -1;
		} else if (!isWhitespace(c)) {
			pendingComma = -1;
		}
	}
	return out + text.slice(copied);
}

/** Index of the closing quote of the string starting at `start`, or -1. */
function skipString(text: string, start: number): number {
	for (let i = start + 1; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c === 0x5c /* \ */) i++;
		else if (c === 0x22) return i;
		else if (c === 0x0a || c === 0x0d) return -1;
	}
	return -1;
}

function lineEnd(text: string, start: number): number {
	for (let i = start; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c === 0x0a || c === 0x0d) return i;
	}
	return text.length;
}

function isWhitespace(c: number): boolean {
	return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

class JsoncSyntaxError extends Error {
	readonly start: number;
	readonly length: number;
	constructor(message: string, start: number, length: number) {
		super(message);
		this.start = start;
		this.length = length;
	}
}

/**
 * Walks JSONC text. With `visit`, it calls `visit(pointer, start, length)` for every value, and descends
 * only into values for which `descend(pointer)` is true. Throws JsoncSyntaxError on invalid text.
 */
class Scanner {
	pos = 0;
	readonly text: string;
	readonly descend: (pointer: string[]) => boolean;
	readonly visit: ((pointer: string[], start: number, length: number) => void) | undefined;
	constructor(
		text: string,
		descend: (pointer: string[]) => boolean,
		visit?: (pointer: string[], start: number, length: number) => void,
	) {
		this.text = text;
		this.descend = descend;
		this.visit = visit;
	}

	fail(message: string, start = this.pos, length = 1): never {
		throw new JsoncSyntaxError(
			message,
			start,
			Math.max(0, Math.min(length, this.text.length - start)),
		);
	}

	skipTrivia(): void {
		const { text } = this;
		while (this.pos < text.length) {
			const c = text.charCodeAt(this.pos);
			if (isWhitespace(c)) this.pos++;
			else if (c === 0x2f && text.charCodeAt(this.pos + 1) === 0x2f)
				this.pos = lineEnd(text, this.pos);
			else if (c === 0x2f && text.charCodeAt(this.pos + 1) === 0x2a) {
				const close = text.indexOf("*/", this.pos + 2);
				if (close < 0) this.fail("Unterminated block comment.", this.pos, 2);
				this.pos = close + 2;
			} else return;
		}
	}

	string(): string {
		const start = this.pos;
		const end = skipString(this.text, start);
		if (end < 0) this.fail("Unterminated string.", start);
		this.pos = end + 1;
		try {
			return JSON.parse(this.text.slice(start, end + 1)) as string;
		} catch {
			return this.fail("Invalid string.", start, end + 1 - start);
		}
	}

	/** `pointer` is undefined while skipping a value nobody asked for. */
	value(pointer: string[] | undefined): void {
		this.skipTrivia();
		const start = this.pos;
		const c = this.text.charCodeAt(start);
		const wanted = pointer !== undefined && this.descend(pointer);
		if (c === 0x7b /* { */) this.members(pointer, wanted, 0x7d, true);
		else if (c === 0x5b /* [ */) this.members(pointer, wanted, 0x5d, false);
		else if (c === 0x22) this.string();
		else {
			const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
				this.text.slice(start, start + 400),
			);
			if (!literal) {
				if (start >= this.text.length)
					this.fail("Unexpected end of file: a value is missing.", start, 0);
				this.fail(`Unexpected character '${this.text[start]}': expected a value.`);
			}
			this.pos += literal[0].length;
		}
		if (wanted) this.visit?.(pointer, start, this.pos - start);
	}

	members(pointer: string[] | undefined, wanted: boolean, close: number, isObject: boolean): void {
		const open = this.pos;
		this.pos++;
		let index = 0;
		for (;;) {
			this.skipTrivia();
			if (this.text.charCodeAt(this.pos) === close) {
				this.pos++;
				return;
			}
			if (this.pos >= this.text.length) {
				this.fail(`Unexpected end of file: '${String.fromCharCode(close)}' is missing.`, open);
			}
			let key = String(index++);
			if (isObject) {
				if (this.text.charCodeAt(this.pos) !== 0x22)
					this.fail("Expected a property name in double quotes.");
				key = this.string();
				this.skipTrivia();
				if (this.text.charCodeAt(this.pos) !== 0x3a /* : */)
					this.fail("Expected ':' after a property name.");
				this.pos++;
			}
			this.value(wanted && pointer ? [...pointer, key] : undefined);
			this.skipTrivia();
			const next = this.text.charCodeAt(this.pos);
			if (next === 0x2c) this.pos++;
			else if (next !== close) {
				if (this.pos >= this.text.length) {
					this.fail(`Unexpected end of file: '${String.fromCharCode(close)}' is missing.`, open);
				}
				this.fail(`Expected ',' or '${String.fromCharCode(close)}'.`);
			}
		}
	}

	document(): void {
		this.value([]);
		this.skipTrivia();
		if (this.pos < this.text.length) this.fail("Unexpected text after the end of the document.");
	}
}

function findSyntaxError(text: string): { message: string; start: number; length: number } {
	try {
		new Scanner(text, () => false).document();
	} catch (error) {
		if (error instanceof JsoncSyntaxError) {
			return { message: error.message, start: error.start, length: error.length };
		}
		throw error;
	}
	// Valid for the scanner but not for JSON.parse: not expected, but never report nothing.
	return { message: "Invalid JSON.", start: 0, length: 0 };
}

/**
 * Finds the ranges of the values at the given JSON pointers (as segment arrays) in one pass.
 * Pointers that do not exist in the text are missing from the result.
 */
export function locateJsonPointers(
	text: string,
	pointers: readonly (readonly string[])[],
): Map<string, { start: number; length: number }> {
	const wanted = new Set<string>();
	const prefixes = new Set<string>();
	for (const pointer of pointers) {
		wanted.add(pointerKey(pointer));
		for (let i = 0; i <= pointer.length; i++) prefixes.add(pointerKey(pointer.slice(0, i)));
	}
	const found = new Map<string, { start: number; length: number }>();
	const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
	const scanner = new Scanner(
		text,
		(pointer) => prefixes.has(pointerKey(pointer)),
		(pointer, start, length) => {
			const key = pointerKey(pointer);
			if (wanted.has(key)) found.set(key, { start, length });
		},
	);
	scanner.pos = bom;
	try {
		scanner.document();
	} catch {}
	return found;
}

export function pointerKey(pointer: readonly string[]): string {
	return pointer.join("\0");
}
