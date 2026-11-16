import type { components as V30 } from "./v30.openapi.jsonc";
import type { components as V31 } from "./v31.openapi.jsonc";

export const a: V30["schemas"]["Item"] = { name: null, price: 1 };
export const b: V31["schemas"]["Item"] = { name: null, tags: ["first", 2] };

// Errors the test expects, one per line:
export const c: V30["schemas"]["Item"] = { name: "x", price: "1" };
export const d: V31["schemas"]["Item"] = { name: "x", tags: ["second", 2] };
