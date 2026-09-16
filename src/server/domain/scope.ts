/**
 * Effective creator scope — the one place the issue #20 precedence rule lives, as a pure function
 * so it is trivially unit-tested and cannot drift between the tool and the request boundary.
 *
 * Two inputs, in priority order:
 *   1. `agentChoice` — creators the model chose from the collection. Honored only if every handle is
 *      in the collection (else it's an invalid scope, not a silent broaden or drop).
 *   2. none — the whole collection.
 *
 * An empty collection is a distinct outcome: no searchable scope at all, never an unrestricted query.
 */
export type Scope =
  | { kind: "ok"; handles: string[] }
  | { kind: "empty_collection" }
  | { kind: "invalid_scope"; bad: string[] };

function dedupe(handles: readonly string[]): string[] {
  return [...new Set(handles.filter((h) => h.length > 0))];
}

export function resolveScope(input: {
  collection: readonly string[];
  agentChoice?: readonly string[];
}): Scope {
  const inCollection = new Set(input.collection);
  if (inCollection.size === 0) return { kind: "empty_collection" };

  // The agent may narrow within the collection, but only to creators that are in it.
  const agent = dedupe(input.agentChoice ?? []);
  if (agent.length > 0) {
    const bad = agent.filter((h) => !inCollection.has(h));
    return bad.length > 0 ? { kind: "invalid_scope", bad } : { kind: "ok", handles: agent };
  }

  // No narrowing: search the entire collection.
  return { kind: "ok", handles: [...inCollection] };
}
