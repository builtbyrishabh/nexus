import { describe, expect, it } from "vitest";

import { resolveScope } from "~/server/domain/scope";

const collection = ["hormozi", "naval", "codie"];

describe("resolveScope precedence", () => {
  it("honors the agent's narrowing within the collection", () => {
    const scope = resolveScope({ collection, agentChoice: ["naval"] });
    expect(scope).toEqual({ kind: "ok", handles: ["naval"] });
  });

  it("searches the whole collection when the agent doesn't narrow", () => {
    const scope = resolveScope({ collection });
    expect(scope).toEqual({ kind: "ok", handles: collection });
  });

  it("rejects an agent choice outside the collection instead of broadening or dropping it", () => {
    const scope = resolveScope({ collection, agentChoice: ["elon"] });
    expect(scope).toEqual({ kind: "invalid_scope", bad: ["elon"] });
  });

  it("an empty collection is no searchable scope, never an unrestricted query", () => {
    expect(resolveScope({ collection: [], agentChoice: ["hormozi"] })).toEqual({
      kind: "empty_collection",
    });
  });

  it("dedupes and drops empty handles", () => {
    const scope = resolveScope({
      collection,
      agentChoice: ["naval", "naval", ""],
    });
    expect(scope).toEqual({ kind: "ok", handles: ["naval"] });
  });
});
