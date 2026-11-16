import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

export const repoRoot: string = resolve(import.meta.dirname, "..");
export const fixturesDir: string = join(repoRoot, "tests", "fixtures");

const require = createRequire(import.meta.url);
/** `typescript` is the 7.1 compiler the mapper needs; `typescript-7.0` shows what happens without it. */
export type Compiler = "typescript" | "typescript-7.0";

// Spawning tsc and its mapper process takes a few hundred ms locally; a loaded CI host can be 20x slower.
export const tscTimeout = 60_000;

/**
 * Runs tsc and returns its output lines, with paths relative to `cwd` as tsc prints them. Throws, with
 * the whole output, unless tsc ran to completion with an expected `status` and wrote nothing to stderr:
 * a compiler that does not start also prints no diagnostics, and must not pass for a clean run.
 */
export function tsc(
	cwd: string,
	args: string[],
	status: number | number[],
	compiler: Compiler = "typescript",
): string[] {
	const bin = join(dirname(require.resolve(`${compiler}/package.json`)), "bin", "tsc");
	const result = spawnSync(process.execPath, [bin, ...args, "--pretty", "false"], {
		cwd,
		encoding: "utf8",
		timeout: tscTimeout,
	});
	if (result.error) throw result.error;
	const expected = typeof status === "number" ? [status] : status;
	if (result.signal !== null || !expected.includes(result.status as number) || result.stderr) {
		throw new Error(
			`tsc ${args.join(" ")} in ${cwd} ended with status ${result.status} and signal ${result.signal}, expected status ${expected.join(" or ")} and no stderr.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
		);
	}
	return result.stdout.split(/\r?\n/).filter(Boolean);
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
