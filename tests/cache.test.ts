/**
 * The declarations cache across compiler runs, observed through its directory and a planted entry:
 * no timing involved.
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
	symlinkSync,
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
	// Compiles only if the declarations come from the planted cache entry.
	writeFileSync(
		join(project, "probe.ts"),
		`import type { cacheHit } from "./acme.openapi.jsonc";\nexport const hit: cacheHit = true;\n`,
	);
});
afterAll(() => rmSync(project, { recursive: true, force: true }));

it(
	"reuses an entry on the next run, regenerates after an edit, and ignores a corrupt entry",
	() => {
		const first = tsc(project, ["-p", ".", "--runExternalCode"]);
		expect(first.lines).toEqual([]);
		const [entry] = entries();
		expect(entries()).toHaveLength(1);

		// A second run that reads the entry sees the planted export.
		const file = join(cache, entry as string);
		const cached = JSON.parse(readFileSync(file, "utf8"));
		writeFileSync(
			file,
			JSON.stringify({ ...cached, text: `${cached.text}export type cacheHit = true;\n` }),
		);
		expect(tsc(project, ["-p", "tsconfig.probe.json", "--runExternalCode"]).lines).toEqual([]);

		// Edited content has another key: generated again, without the planted export.
		writeFileSync(
			join(project, "acme.openapi.jsonc"),
			spec(`"Id": { "type": "string" }, "Other": {}`),
		);
		expect(tsc(project, ["-p", "tsconfig.probe.json", "--runExternalCode"]).lines).toEqual([
			`probe.ts(1,15): error TS2305: Module '"./acme.openapi.jsonc"' has no exported member 'cacheHit'.`,
		]);
		const edited = entries().find((f) => f !== entry) as string;
		expect(entries()).toHaveLength(2);

		// A corrupt entry is ignored and replaced.
		writeFileSync(join(cache, edited), "{ not json");
		expect(tsc(project, ["-p", ".", "--runExternalCode"]).lines).toEqual([]);
		expect(JSON.parse(readFileSync(join(cache, edited), "utf8")).text).toContain("Other: unknown;");
	},
	tscTimeout * 4,
);
