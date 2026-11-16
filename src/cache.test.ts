/**
 * @module-tag windows
 * @module-tag macos
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, expect, it } from "vite-plus/test";

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
