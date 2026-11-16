/**
 * @module-tag windows
 * @module-tag macos
 */
import { createHash } from "node:crypto";
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

import { afterAll, describe, expect, it } from "vite-plus/test";

import { cacheDirectory, cacheKey, readCache, writeCache } from "./cache.ts";

const directory = mkdtempSync(join(tmpdir(), "inspex-cache-unit-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

it("keys by code, settings and content", () => {
	const key = cacheKey("code", "settings", "content");
	expect(key).toMatch(/^[0-9a-f]{64}$/);
	expect(cacheKey("code", "settings", "content")).toBe(key);
	expect(cacheKey("code2", "settings", "content")).not.toBe(key);
	expect(cacheKey("code", "settings2", "content")).not.toBe(key);
	expect(cacheKey("code", "settings", "content2")).not.toBe(key);
	// The separator keeps the parts apart.
	expect(cacheKey("code", "settingsc", "ontent")).not.toBe(key);
});

it("lives in node_modules/.cache/inspex beside tsconfig.json, and nowhere without one", () => {
	expect(cacheDirectory(join("/p", "tsconfig.json"))).toBe(
		join("/p", "node_modules", ".cache", "inspex"),
	);
	expect(cacheDirectory("")).toBeUndefined();
});

it("reads back what it wrote, leaving no temporary file", () => {
	const spec = {
		text: "export interface paths {}\n",
		problems: [{ start: 1, length: 2, message: "m", code: 4 as const }],
	};
	writeCache(directory, "a", spec);
	expect(readCache(directory, "a")).toEqual(spec);
	writeCache(directory, "b", { text: undefined, problems: [] });
	expect(readCache(directory, "b")).toEqual({ text: undefined, problems: [] });
	expect(readdirSync(directory).toSorted()).toEqual(["a.json", "b.json"]);
});

it("ignores an entry whose declarations were altered but still parse", () => {
	const spec = { text: "export interface paths {}\n", problems: [] };
	writeCache(directory, "altered", spec);
	const file = join(directory, "altered.json");
	writeFileSync(
		file,
		readFileSync(file, "utf8").replace("export interface paths {}", "export type planted = 1;"),
	);
	expect(readCache(directory, "altered")).toBeUndefined();
});

it("checks the stored text itself, so even an equivalent re-serialization is a miss", () => {
	writeCache(directory, "spaced", { text: "export {};\n", problems: [] });
	const file = join(directory, "spaced.json");
	const stored = readFileSync(file, "utf8");
	const end = stored.lastIndexOf("}");
	writeFileSync(file, `${stored.slice(0, end)} ${stored.slice(end)}`);
	expect(readCache(directory, "spaced")).toBeUndefined();
});

/** An entry in the stored format: a header line with the key and the payload's checksum, then the payload. */
function entryText(key: string, payload: string): string {
	const checksum = createHash("sha256").update(payload).digest("hex");
	return `${JSON.stringify({ key, checksum })}\n${payload}`;
}

it("treats a deeply nested payload as a miss, whatever its checksum", () => {
	const payload = `{"text":null,"problems":${"[".repeat(20_000)}${"]".repeat(20_000)}}`;
	writeFileSync(join(directory, "deep.json"), `{"key":"deep","checksum":"wrong"}\n${payload}`);
	expect(readCache(directory, "deep")).toBeUndefined();
	writeFileSync(join(directory, "deep.json"), entryText("deep", payload));
	expect(readCache(directory, "deep")).toBeUndefined();
});

it.each([
	["missing", undefined],
	["corrupt", "{ not json"],
	// Each of these is a valid entry but for one thing, so only that check turns it away.
	["another key", entryText("other", '{"text":"","problems":[]}')],
	["a wrong shape", entryText("a wrong shape", '{"text":1,"problems":[]}')],
	["a wrong problem", entryText("a wrong problem", '{"text":"","problems":[{"start":"0"}]}')],
])("ignores an entry that is %s", (name, content) => {
	if (content !== undefined) writeFileSync(join(directory, `${name}.json`), content);
	expect(readCache(directory, name)).toBeUndefined();
});

it("reads an entry written in the stored format", () => {
	writeFileSync(join(directory, "valid.json"), entryText("valid", '{"text":"","problems":[]}'));
	expect(readCache(directory, "valid")).toEqual({ text: "", problems: [] });
});

/** Creates a symbolic link, or reports that this host does not allow it (Windows without the privilege). */
function link(target: string, path: string, type: "file" | "junction"): boolean {
	try {
		symlinkSync(target, path, type);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
		throw error;
	}
}

describe("symbolic links", () => {
	const spec = { text: "export interface paths {}\n", problems: [] };

	it("never writes through a link at the temporary file name", ({ skip }) => {
		const victim = join(directory, "victim.txt");
		writeFileSync(victim, "untouched");
		// The name the temporary file had when it was derived from the process id alone.
		if (!link(victim, join(directory, `pid.json.${process.pid}.tmp`), "file")) skip();
		writeCache(directory, "pid", spec);
		expect(readFileSync(victim, "utf8")).toBe("untouched");
		expect(readCache(directory, "pid")).toEqual(spec);
	});

	it("does not use an entry that is a link", ({ skip }) => {
		const elsewhere = mkdtempSync(join(tmpdir(), "inspex-cache-elsewhere-"));
		writeCache(elsewhere, "linked", spec);
		const target = join(elsewhere, "linked.json");
		const before = readFileSync(target, "utf8");
		if (!link(target, join(directory, "linked.json"), "file")) skip();
		expect(readCache(directory, "linked")).toBeUndefined();
		writeCache(directory, "linked", { text: "export type changed = 1;\n", problems: [] });
		expect(readFileSync(target, "utf8")).toBe(before);
		rmSync(elsewhere, { recursive: true, force: true });
	});

	it("does not use a cache directory that is a link", ({ skip }) => {
		const elsewhere = mkdtempSync(join(tmpdir(), "inspex-cache-elsewhere-"));
		writeCache(elsewhere, "inside", spec);
		const linked = join(directory, "linked-dir");
		mkdirSync(directory, { recursive: true });
		if (!link(elsewhere, linked, "junction")) skip();
		expect(readCache(linked, "inside")).toBeUndefined();
		writeCache(linked, "new", spec);
		expect(readdirSync(elsewhere)).toEqual(["inside.json"]);
		rmSync(elsewhere, { recursive: true, force: true });
	});
});
