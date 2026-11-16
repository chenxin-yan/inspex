// TypeScript type expressions as text: primitives, unions, intersections, literals, property keys, JSDoc.

import { isObject } from "./context.ts";

/** A type expression. `kind` decides parentheses and mirrors upstream's checks on AST node kinds. */
export interface Type {
	text: string;
	kind: "atom" | "array" | "tuple" | "union" | "intersection" | "negative";
}

export const atom = (text: string): Type => ({ text, kind: "atom" });
export const UNKNOWN: Type = atom("unknown");
export const NEVER: Type = atom("never");
export const NULL: Type = atom("null");
export const STRING: Type = atom("string");
export const NUMBER: Type = atom("number");
export const BOOLEAN: Type = atom("boolean");
export const primitiveTexts: Set<string> = new Set([
	"boolean",
	"never",
	"null",
	"number",
	"string",
	"undefined",
]);

export function union(types: Type[]): Type {
	const unique = dedupe(types);
	if (unique.length === 0) return NEVER;
	if (unique.length === 1) return unique[0] as Type;
	return { text: unique.map((t) => t.text).join(" | "), kind: "union" };
}

export function intersection(types: Type[]): Type {
	const unique = dedupe(types);
	if (unique.length === 0) return NEVER;
	if (unique.length === 1) return unique[0] as Type;
	return {
		text: unique.map((t) => (t.kind === "union" ? `(${t.text})` : t.text)).join(" & "),
		kind: "intersection",
	};
}

function dedupe(types: Type[]): Type[] {
	const seen = new Set<string>();
	return types.filter((t) => !seen.has(t.text) && seen.add(t.text));
}

export function arrayOf(type: Type): Type {
	const element = type.kind === "atom" || type.kind === "array" || type.kind === "tuple";
	return { text: element ? `${type.text}[]` : `(${type.text})[]`, kind: "array" };
}

export function objectType(members: string[]): Type {
	return atom(`{\n${members.join("\n")}\n}`);
}

const identifier = /^[A-Za-z_$][\w$]*$/;
export function propertyKey(name: string): string {
	// Numeric keys stay numeric, as upstream prints them: `keyof { 200: X }` is `200`, not `"200"`, and
	// openapi-fetch finds success responses by numeric status.
	const numeric = String(Number(name)) === name && !name.startsWith("-");
	return numeric || identifier.test(name) ? name : JSON.stringify(name);
}

export function literal(value: unknown): Type {
	if (typeof value === "string") return atom(JSON.stringify(value));
	if (typeof value === "number")
		return { text: String(value), kind: value < 0 ? "negative" : "atom" };
	if (typeof value === "boolean") return atom(String(value));
	if (value === null) return NULL;
	if (Array.isArray(value)) {
		return value.length
			? { text: `[${value.map((v) => literal(v).text).join(", ")}]`, kind: "tuple" }
			: arrayOf(NEVER);
	}
	if (typeof value === "object") {
		const entries = Object.entries(value);
		return entries.length
			? objectType(entries.map(([k, v]) => `${propertyKey(k)}: ${literal(v).text};`))
			: atom("Record<string, never>");
	}
	return UNKNOWN;
}

export function jsDoc(value: unknown): string {
	if (!isObject(value)) return "";
	const lines: string[] = [];
	for (const field of ["title", "summary"]) {
		if (typeof value[field] === "string" && value[field]) lines.push(value[field].trim());
	}
	if (typeof value.format === "string") lines.push(`Format: ${value.format}`);
	if (value.deprecated === true) lines.push("@deprecated");
	if (typeof value.description === "string" && value.description) {
		lines.push(`@description ${value.description.trim()}`);
	}
	if (value.default !== undefined) lines.push(`@default ${JSON.stringify(value.default)}`);
	if (!lines.length) return "";
	const text = lines.join("\n").replaceAll("*/", "*\\/").replaceAll(/\r?\n/g, "\n * ");
	return `/**\n * ${text}\n */\n`;
}
