// The direction of imports between the modules in src/ (see AGENTS.md): read from their import lines.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { expect, it } from "vite-plus/test";

const root = import.meta.dirname;
const modules = readdirSync(root, { recursive: true, encoding: "utf8" })
	.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
	.map((f) => f.replaceAll("\\", "/"));

/** Module -> the modules in src/ it imports, as paths relative to src/. */
const imports = new Map(
	modules.map((module) => {
		const text = readFileSync(join(root, module), "utf8");
		const targets = [...text.matchAll(/^(?:import|export)\s[^;]*?from\s+"(\.{1,2}\/[^"]+)"/gm)].map(
			(m) => relative(root, resolve(root, dirname(module), m[1] as string)).replaceAll("\\", "/"),
		);
		return [module, targets];
	}),
);

const openapi = "formats/openapi/";
/** Within the OpenAPI format: entry -> operations -> schema -> refs / type-text; analysis uses context and refs. */
const openapiAllowed: Record<string, string[]> = {
	"context.ts": [],
	"type-text.ts": ["context.ts"],
	"refs.ts": ["context.ts"],
	"analysis.ts": ["context.ts", "refs.ts"],
	"schema.ts": ["context.ts", "type-text.ts", "refs.ts"],
	"operations.ts": ["context.ts", "type-text.ts", "refs.ts", "schema.ts"],
	"index.ts": [
		"context.ts",
		"type-text.ts",
		"refs.ts",
		"schema.ts",
		"operations.ts",
		"analysis.ts",
	],
};

function wrongDirection(from: string, to: string): boolean {
	if (from.startsWith("formats/") && (to.startsWith("mapper/") || to === "server.ts")) return true;
	if (from.startsWith("mapper/") && to.startsWith("formats/") && to !== "formats/index.ts")
		return true;
	if ((from === "problems.ts" || from === "jsonc.ts") && to !== from) return true;
	if (from.startsWith(openapi) && to.startsWith(openapi)) {
		const allowed = openapiAllowed[from.slice(openapi.length)];
		return !allowed?.includes(to.slice(openapi.length));
	}
	return false;
}

it("imports only in the allowed directions, without cycles", () => {
	const wrong = [...imports].flatMap(([from, targets]) =>
		targets.filter((to) => wrongDirection(from, to)).map((to) => `${from} -> ${to}`),
	);
	const cycles: string[] = [];
	const state = new Map<string, "visiting" | "done">();
	const visit = (module: string, path: string[]): void => {
		if (state.get(module) === "done") return;
		if (state.get(module) === "visiting") {
			cycles.push([...path.slice(path.indexOf(module)), module].join(" -> "));
			return;
		}
		state.set(module, "visiting");
		for (const to of imports.get(module) ?? []) visit(to, [...path, module]);
		state.set(module, "done");
	};
	for (const module of modules) visit(module, []);
	expect(modules).toContain("formats/openapi/schema.ts");
	expect({ wrong, cycles }).toEqual({ wrong: [], cycles: [] });
});
