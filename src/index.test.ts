/**
 * @module-tag windows
 * @module-tag macos
 */
import { expect, it } from "vite-plus/test";

import packageJson from "../package.json" with { type: "json" };
import { packageName } from "./index.ts";

it("exports the name the package is published under", () => {
	expect(packageName).toBe(packageJson.name);
});
