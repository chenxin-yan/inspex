import { operationId } from "fake-client";

// No import of the specs: `include` puts them in the program, and each registers itself under its name.
operationId("billing", "getInvoice");
operationId("users", "getUser");

// Errors the test expects, one per line:
operationId("users", "getInvoice");
operationId("orders", "getOrder");
