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

import type { MappedSpec } from "../formats.ts";

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

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Whether `path` is a symbolic link (or a junction); false when it does not exist. */
function isLink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

// An entry is a header line, `{"key":…,"checksum":…}`, then the payload `{"text":…,"problems":[…]}`. The
// checksum is over the payload exactly as stored, so checking it walks no parsed (possibly damaged) value.

/**
 * The cache can never fail or change a transform: anything that goes wrong while reading, checking or
 * parsing an entry is a miss, and the next write replaces the entry.
 */
export function readCache(directory: string, key: string): MappedSpec | undefined {
	try {
		return readEntry(directory, key);
	} catch {
		return undefined;
	}
}

function readEntry(directory: string, key: string): MappedSpec | undefined {
	const file = join(directory, `${key}.json`);
	if (isLink(directory) || isLink(file)) return undefined;
	const stored = readFileSync(file, "utf8");
	const newline = stored.indexOf("\n");
	if (newline < 0) return undefined;
	const header: unknown = JSON.parse(stored.slice(0, newline));
	const payload = stored.slice(newline + 1);
	if (
		!isRecord(header) ||
		header.key !== key ||
		typeof header.checksum !== "string" ||
		header.checksum !== sha256(payload)
	) {
		return undefined;
	}
	const entry: unknown = JSON.parse(payload);
	if (
		!isRecord(entry) ||
		!(typeof entry.text === "string" || entry.text === null) ||
		!Array.isArray(entry.problems) ||
		!entry.problems.every(
			(p: unknown) =>
				isRecord(p) &&
				typeof p.start === "number" &&
				typeof p.length === "number" &&
				typeof p.message === "string" &&
				typeof p.code === "number",
		)
	) {
		return undefined;
	}
	return { text: entry.text ?? undefined, problems: entry.problems as MappedSpec["problems"] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The cache can never fail a transform: anything that goes wrong while writing or cleaning up is ignored. */
export function writeCache(directory: string, key: string, spec: MappedSpec): void {
	try {
		writeEntry(directory, key, spec);
	} catch {}
}

function writeEntry(directory: string, key: string, spec: MappedSpec): void {
	const file = join(directory, `${key}.json`);
	mkdirSync(directory, { recursive: true });
	if (isLink(directory) || isLink(file)) return;
	const payload = JSON.stringify({ text: spec.text ?? null, problems: spec.problems });
	// Written aside and renamed, so a concurrent compiler never reads half an entry. The temporary name is
	// unpredictable and created exclusively, so nothing planted under it is followed or overwritten.
	const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
	const descriptor = openSync(temporary, "wx");
	try {
		try {
			writeSync(descriptor, `${JSON.stringify({ key, checksum: sha256(payload) })}\n${payload}`);
		} finally {
			closeSync(descriptor);
		}
		renameSync(temporary, file);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
}
