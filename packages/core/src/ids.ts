import { randomUUID } from "node:crypto";

/**
 * Random, unguessable ids. The optional prefix ("task_", "sub_", ...) makes an
 * id's kind obvious in logs and URLs without costing anything.
 */
export function newId(prefix = ""): string {
  return prefix + randomUUID();
}
