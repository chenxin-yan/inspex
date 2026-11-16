// openapi-typescript is a test oracle only. It prints with the TypeScript 5 JavaScript API, which
// TypeScript 7 does not have, so it gets its own TypeScript 5 instead of the repository's (a peer wins over
// `packageExtensions` and `overrides`).
module.exports = {
	hooks: {
		readPackage(manifest) {
			if (manifest.name === "openapi-typescript") {
				delete manifest.peerDependencies?.typescript;
				manifest.dependencies = { ...manifest.dependencies, typescript: "5.9.3" };
			}
			return manifest;
		},
	},
};
