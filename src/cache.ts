// Generated declarations, cached across compiler runs in `<tsconfig dir>/node_modules/.cache/inspex`.
//
// Entries are keyed by a hash of the file's content, not its size and modification time: the editor sends
// unsaved content, and a same-size edit within the file system's time resolution would otherwise be served
// stale. Hashing is cheap next to parsing. The key also covers the generator's own code and options, and an
// entry is used only if it parses and carries its own key, so a stale, foreign or corrupt entry is regenerated.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { MappedSpec } from "./formats.ts";

export function cacheDirectory(configFileName: string): string | undefined {
	return configFileName
		? join(dirname(configFileName), "node_modules", ".cache", "inspex")
		: undefined;
}

/** `codeIdentity` identifies the generator (a hash of the running mapper's code). */
export function cacheKey(codeIdentity: string, settings: string, content: string): string {
	return createHash("sha256")
		.update(`${codeIdentity}\0${settings}\0`)
		.update(content)
		.digest("hex");
}

export function readCache(directory: string, key: string): MappedSpec | undefined {
	let entry: unknown;
	try {
		entry = JSON.parse(readFileSync(join(directory, `${key}.json`), "utf8"));
	} catch {
		return undefined;
	}
	if (
		typeof entry !== "object" ||
		entry === null ||
		!("key" in entry && entry.key === key) ||
		!("text" in entry && (typeof entry.text === "string" || entry.text === null)) ||
		!("problems" in entry && Array.isArray(entry.problems)) ||
		!entry.problems.every(
			(p: unknown) =>
				typeof p === "object" &&
				p !== null &&
				"start" in p &&
				typeof p.start === "number" &&
				"length" in p &&
				typeof p.length === "number" &&
				"message" in p &&
				typeof p.message === "string" &&
				"code" in p &&
				typeof p.code === "number",
		)
	) {
		return undefined;
	}
	return { text: entry.text ?? undefined, problems: entry.problems };
}

/** Best effort: a cache that cannot be written (read-only file system, permissions) is skipped. */
export function writeCache(directory: string, key: string, spec: MappedSpec): void {
	try {
		mkdirSync(directory, { recursive: true });
		const file = join(directory, `${key}.json`);
		// Written aside and renamed, so a concurrent compiler never reads half an entry.
		const temporary = `${file}.${process.pid}.tmp`;
		writeFileSync(
			temporary,
			JSON.stringify({ key, text: spec.text ?? null, problems: spec.problems }),
		);
		renameSync(temporary, file);
	} catch {}
}
