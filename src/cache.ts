// Generated declarations, cached across compiler runs in `<tsconfig dir>/node_modules/.cache/inspex`.
//
// Entries are keyed by a hash of the file's content, not its size and modification time: the editor sends
// unsaved content, and a same-size edit within the file system's time resolution would otherwise be served
// stale. Hashing is cheap next to parsing. The key also covers the generator's own code and options. An
// entry is used only if it parses, carries its own key and its payload matches its checksum, so a stale,
// foreign or damaged entry is regenerated. The checksum does not protect against someone who can write to
// the cache: they can rewrite it too.
//
// Symbolic links are never followed: if the cache directory or an entry is one, the cache is not used.

import { createHash, randomBytes } from "node:crypto";
import {
	closeSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeSync,
} from "node:fs";
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

function checksum(text: string | null, problems: unknown): string {
	return createHash("sha256")
		.update(JSON.stringify(problems))
		.update(text === null ? "\0" : `\u0001${text}`)
		.digest("hex");
}

/** Whether `path` is a symbolic link (or a junction); false when it does not exist. */
function isLink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

export function readCache(directory: string, key: string): MappedSpec | undefined {
	const file = join(directory, `${key}.json`);
	if (isLink(directory) || isLink(file)) return undefined;
	let entry: unknown;
	try {
		entry = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
	if (
		typeof entry !== "object" ||
		entry === null ||
		!("key" in entry && entry.key === key) ||
		!("text" in entry && (typeof entry.text === "string" || entry.text === null)) ||
		!("problems" in entry && Array.isArray(entry.problems)) ||
		!("checksum" in entry && entry.checksum === checksum(entry.text, entry.problems)) ||
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
	const file = join(directory, `${key}.json`);
	// Written aside and renamed, so a concurrent compiler never reads half an entry. The temporary name is
	// unpredictable and created exclusively, so nothing planted under it is followed or overwritten.
	const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
	let created = false;
	try {
		mkdirSync(directory, { recursive: true });
		if (isLink(directory) || isLink(file)) return;
		const descriptor = openSync(temporary, "wx");
		created = true;
		try {
			const text = spec.text ?? null;
			writeSync(
				descriptor,
				JSON.stringify({
					key,
					checksum: checksum(text, spec.problems),
					text,
					problems: spec.problems,
				}),
			);
		} finally {
			closeSync(descriptor);
		}
		renameSync(temporary, file);
		created = false;
	} catch {
	} finally {
		if (created) rmSync(temporary, { force: true });
	}
}
