/**
 * The cache can never fail or change a transform: a write that fails at the rename, with a cleanup that
 * fails too, is ignored. The cache directory turns read-only just before the rename (POSIX permissions;
 * skipped on Windows, whose permissions cannot express it, and as root, who ignores them).
 *
 * @module-tag macos
 */
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, expect, it, vi } from "vite-plus/test";

import { writeCache } from "./cache.ts";
import { Mapper } from "./mapper.ts";

vi.mock("node:fs", async (importOriginal) => {
	const original = await importOriginal<typeof fs>();
	return {
		...original,
		renameSync: (from: string, to: string) => {
			original.chmodSync(dirname(to), 0o500);
			original.renameSync(from, to);
		},
	};
});

const work = mkdtempSync(join(tmpdir(), "inspex-cache-failure-"));
afterAll(() => {
	for (const directory of readdirSync(work, { recursive: true, withFileTypes: true })) {
		if (directory.isDirectory()) chmodSync(join(directory.parentPath, directory.name), 0o700);
	}
	chmodSync(work, 0o700);
	rmSync(work, { recursive: true, force: true });
});

const unsupported = process.platform === "win32" || process.getuid?.() === 0;

it.skipIf(unsupported)("ignores a write whose rename and cleanup both fail", () => {
	const directory = join(work, "cache");
	expect(() => writeCache(directory, "k", { text: "export {};\n", problems: [] })).not.toThrow();
	// The temporary file could not be removed either; the next successful write replaces the entry.
	expect(readdirSync(directory).filter((f) => f.endsWith(".tmp"))).toHaveLength(1);
});

it.skipIf(unsupported)("returns the right declarations when the cache cannot be written", () => {
	const project = join(work, "project");
	fs.mkdirSync(project);
	writeFileSync(join(project, "tsconfig.json"), "{}");
	const mapper = new Mapper("test");
	mapper.openProject({
		configFileName: join(project, "tsconfig.json"),
		projectHandle: "p",
		compilerOptions: {},
	});
	const content = JSON.stringify({
		openapi: "3.1.0",
		info: { title: "t", version: "1" },
		paths: {},
	});
	const result = mapper.transform({
		fileName: join(project, "a.openapi.jsonc"),
		content,
		projectHandle: "p",
	});
	expect(result.text).toContain("export type paths = Record<string, never>;");
});
