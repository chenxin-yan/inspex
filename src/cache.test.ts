/**
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
	const entry = JSON.parse(readFileSync(file, "utf8"));
	writeFileSync(file, JSON.stringify({ ...entry, text: `${spec.text}export type planted = 1;\n` }));
	expect(readCache(directory, "altered")).toBeUndefined();
});

it.each([
	["missing", undefined],
	["corrupt", "{ not json"],
	["another key", JSON.stringify({ key: "other", text: "", problems: [] })],
	["a wrong shape", JSON.stringify({ key: "a wrong shape", text: 1, problems: [] })],
	[
		"a wrong problem",
		JSON.stringify({ key: "a wrong problem", text: "", problems: [{ start: "0" }] }),
	],
])("ignores an entry that is %s", (name, content) => {
	if (content !== undefined) writeFileSync(join(directory, `${name}.json`), content);
	expect(readCache(directory, name)).toBeUndefined();
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
