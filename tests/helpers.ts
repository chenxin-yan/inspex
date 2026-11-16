import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

export const repoRoot: string = resolve(import.meta.dirname, "..");
export const fixturesDir: string = join(repoRoot, "tests", "fixtures");

const require = createRequire(import.meta.url);
/** `typescript` is the 7.1 compiler the mapper needs; `typescript-7.0` shows what happens without it. */
export type Compiler = "typescript" | "typescript-7.0";

export interface TscResult {
	status: number | null;
	/** Output lines, with paths relative to the working directory as tsc prints them. */
	lines: string[];
	stderr: string;
}

// Spawning tsc and its mapper process takes a few hundred ms locally; a loaded CI host can be 20x slower.
export const tscTimeout = 60_000;

export function tsc(cwd: string, args: string[], compiler: Compiler = "typescript"): TscResult {
	const bin = join(dirname(require.resolve(`${compiler}/package.json`)), "bin", "tsc");
	const result = spawnSync(process.execPath, [bin, ...args, "--pretty", "false"], {
		cwd,
		encoding: "utf8",
		timeout: tscTimeout,
	});
	if (result.error) throw result.error;
	return {
		status: result.status,
		lines: result.stdout.split(/\r?\n/).filter(Boolean),
		stderr: result.stderr,
	};
}

/**
 * Lets fixture projects resolve `"package": "inspex"` to this repository (which runs dist/server.js,
 * so tests need `pnpm run build` first; `pnpm run test` does it).
 */
export function linkInspex(): void {
	const link = join(fixturesDir, "node_modules", "inspex");
	if (existsSync(link)) return;
	mkdirSync(dirname(link), { recursive: true });
	try {
		// A junction needs no privileges on Windows; elsewhere the type is ignored.
		symlinkSync(repoRoot, link, "junction");
	} catch (error) {
		// Another test file linked it first.
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
}
