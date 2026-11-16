#!/usr/bin/env node
// @ts-check

// Packs and publishes this package for .github/workflows/release.yml. Packing runs in a job
// without publishing credentials; publishing runs in a job that installs and builds nothing.

import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const ROOT_DIR = resolve(import.meta.dirname, "..");
const REGISTRY = "https://registry.npmjs.org";
const TARBALL = "package.tgz";

/** @typedef {{ name: string; version: string; file: string }} PackageEntry */

/**
 * @param {string[]} args
 * @param {boolean} [allowFailure]
 */
function runCommand(args, allowFailure = false) {
	const [command = "", ...rest] = args;
	// shell: npm and pnpm are .cmd shims on Windows.
	const { status, stdout, stderr } = spawnSync(command, rest, {
		cwd: ROOT_DIR,
		encoding: "utf8",
		shell: process.platform === "win32",
	});
	if (status !== 0 && !allowFailure) {
		throw new Error(`${args.join(" ")} failed (${status}): ${stderr || stdout}`);
	}
	return { exitCode: status, stdout, stderr };
}

/** @param {string} directory */
async function pack(directory) {
	await mkdir(directory, { recursive: true });
	if ((await readdir(directory)).length > 0) {
		throw new Error(`Pack directory must be empty: ${directory}`);
	}
	const { name, version } = JSON.parse(await readFile(join(ROOT_DIR, "package.json"), "utf8"));
	console.log(`Packing ${name}@${version}`);
	runCommand(["pnpm", "pack", "--out", join(directory, TARBALL)]);
	// An incomplete pack must never leave an uploadable inventory.
	await writeFile(
		join(directory, "package.json"),
		`${JSON.stringify({ name, version, file: TARBALL }, null, 2)}\n`,
	);
}

/**
 * @param {string} directory
 * @returns {Promise<PackageEntry>}
 */
async function readInventory(directory) {
	const entry = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
	if (
		entry === null ||
		typeof entry !== "object" ||
		typeof entry.name !== "string" ||
		!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(entry.name) ||
		typeof entry.version !== "string" ||
		!/^\d+\.\d+\.\d+$/.test(entry.version) ||
		entry.file !== TARBALL
	) {
		throw new Error(
			"Invalid release inventory: expected a name, a stable version and the tarball.",
		);
	}
	// A fixed basename plus lstat reject traversal, directories and symlinks.
	if (!(await lstat(join(directory, TARBALL))).isFile()) {
		throw new Error(`Release artifact must be a regular file: ${TARBALL}`);
	}
	return entry;
}

/**
 * @param {string} directory
 * @param {boolean} dryRun
 */
async function publish(directory, dryRun) {
	const { name, version } = await readInventory(directory);
	const spec = `${name}@${version}`;
	// Releases target public npm, regardless of ambient npmrc settings.
	const registryArgs = [`--registry=${REGISTRY}`, "--scope="];
	const lookup = runCommand(["npm", "view", spec, "version", "--json", ...registryArgs], true);
	let body;
	try {
		body = JSON.parse(lookup.stdout);
	} catch {
		throw new Error(`Inconclusive npm lookup for ${spec}: ${lookup.stderr || lookup.stdout}`);
	}
	if (lookup.exitCode === 0 && body === version) {
		console.log(`Already published: ${spec}`);
		return;
	}
	if (lookup.exitCode === 0 || body?.error?.code !== "E404") {
		throw new Error(`Could not check ${spec}: ${lookup.stderr || lookup.stdout}`);
	}
	if (dryRun) {
		console.log(`Dry run: ${spec} would be published.`);
		return;
	}
	console.log(`Publishing ${spec}`);
	runCommand([
		"npm",
		"publish",
		join(directory, TARBALL),
		"--ignore-scripts",
		"--access",
		"public",
		...registryArgs,
	]);
	console.log(`Published ${spec}.`);
}

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		"pack-dir": { type: "string" },
		"publish-dir": { type: "string" },
		"dry-run": { type: "boolean", default: false },
	},
});
const { "pack-dir": packDir, "publish-dir": publishDir, "dry-run": dryRun } = values;
if (packDir && !publishDir && !dryRun) {
	await pack(resolve(packDir));
} else if (publishDir && !packDir) {
	await publish(resolve(publishDir), dryRun);
} else {
	throw new Error("Choose --pack-dir <empty directory> or --publish-dir <directory> [--dry-run].");
}
