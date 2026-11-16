/**
 * The declarations cache across compiler runs, observed through its directory, an entry's timestamp and
 * an altered entry: no timing involved.
 *
 * @module-tag windows
 * @module-tag macos
 */
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, expect, it } from "vite-plus/test";

import { repoRoot, tsc, tscTimeout } from "./helpers.ts";

const project = mkdtempSync(join(tmpdir(), "inspex-cache-"));
const cache = join(project, "node_modules", ".cache", "inspex");
const spec = (schemas: string): string => `{
	"openapi": "3.1.0",
	"info": { "title": "cache", "version": "1" },
	"paths": {},
	"components": { "schemas": { ${schemas} } }
}
`;
const entries = (): string[] => readdirSync(cache).filter((f) => f.endsWith(".json"));

beforeAll(() => {
	mkdirSync(join(project, "node_modules"));
	symlinkSync(repoRoot, join(project, "node_modules", "inspex"), "junction");
	const config = (files: string[]) =>
		JSON.stringify({
			compilerOptions: {
				strict: true,
				noEmit: true,
				module: "preserve",
				moduleResolution: "bundler",
				types: [],
			},
			files,
			contentMappers: [{ package: "inspex", extensions: [".openapi.jsonc"] }],
		});
	writeFileSync(join(project, "tsconfig.json"), config(["app.ts"]));
	writeFileSync(join(project, "tsconfig.probe.json"), config(["probe.ts"]));
	writeFileSync(join(project, "acme.openapi.jsonc"), spec(`"Id": { "type": "string" }`));
	writeFileSync(
		join(project, "app.ts"),
		`import type { components } from "./acme.openapi.jsonc";\nexport const id: components["schemas"]["Id"] = "1";\n`,
	);
	// Compiles only if the declarations came from an altered cache entry.
	writeFileSync(
		join(project, "probe.ts"),
		`import type { cacheHit } from "./acme.openapi.jsonc";\nexport const hit: cacheHit = true;\n`,
	);
});
afterAll(() => rmSync(project, { recursive: true, force: true }));

it(
	"reuses an entry on the next run, regenerates after an edit, and ignores an altered or corrupt entry",
	() => {
		const first = tsc(project, ["-p", ".", "--runExternalCode"]);
		expect(first.lines).toEqual([]);
		const [entry] = entries();
		expect(entries()).toHaveLength(1);

		// A second run reuses the entry: it does not rewrite it, so its old timestamp stays.
		const file = join(cache, entry as string);
		const longAgo = new Date("2000-01-01T00:00:00Z");
		utimesSync(file, longAgo, longAgo);
		expect(tsc(project, ["-p", ".", "--runExternalCode"]).lines).toEqual([]);
		expect(statSync(file).mtime).toEqual(longAgo);

		// An entry whose declarations were altered, though it still parses, is regenerated.
		// The declarations are stored as a JSON string, where a line break is a backslash and an "n".
		writeFileSync(
			file,
			readFileSync(file, "utf8").replace(
				"export interface operations",
				"export type cacheHit = true;\\nexport interface operations",
			),
		);
		expect(tsc(project, ["-p", "tsconfig.probe.json", "--runExternalCode"]).lines).toEqual([
			`probe.ts(1,15): error TS2305: Module '"./acme.openapi.jsonc"' has no exported member 'cacheHit'.`,
		]);
		expect(readFileSync(file, "utf8")).not.toContain("cacheHit");

		// Edited content has another key: generated again.
		writeFileSync(
			join(project, "acme.openapi.jsonc"),
			spec(`"Id": { "type": "string" }, "Other": {}`),
		);
		expect(tsc(project, ["-p", ".", "--runExternalCode"]).lines).toEqual([]);
		const edited = entries().find((f) => f !== entry) as string;
		expect(entries()).toHaveLength(2);

		// A corrupt entry is ignored and replaced.
		writeFileSync(join(cache, edited), "{ not json");
		expect(tsc(project, ["-p", ".", "--runExternalCode"]).lines).toEqual([]);
		expect(readFileSync(join(cache, edited), "utf8")).toContain("Other: unknown;");
	},
	tscTimeout * 4,
);
