import type { components, operations, paths } from "./broken.openapi.jsonc";
import type { operations as NoIds, paths as NoIdsPaths } from "./noids.openapi.jsonc";

// The valid parts of a broken spec keep their types.
export const good: components["schemas"]["Good"] = { id: "1" };
export const first: operations["same"]["responses"][200]["content"] = undefined;
export const health: NoIdsPaths["/health"]["get"]["responses"][200]["content"]["application/json"] = true;

// Errors the test expects, one per line:
export const unrelated: number = "not a number";
export const missingId: components["schemas"]["Good"] = {};
export const noOperation: NoIds["anything"] = 1;
declare const unresolved: paths["/c"]["get"]["responses"][200]["content"]["application/json"];
export const unresolvedIsUnknown: string = unresolved;
