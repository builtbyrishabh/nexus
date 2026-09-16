import { describe, expect, it } from "vitest";

import { resolveScope, unknownHandles } from "~/server/domain/scope";

const collection = ["hormozi", "naval", "codie"];

describe("resolveScope precedence", () => {
  it("user selection wins and ignores the agent's conflicting narrowing", () => {
    const scope = resolveScope({
      collection,
      selected: ["hormozi"],
      agentChoice: ["naval"],
    });
    expect(scope).toEqual({ kind: "ok", handles: ["hormozi"] });
  });

  it("honors the agent's choice when the user made no selection", () => {
    const scope = resolveScope({ collection, agentChoice: ["naval"] });
    expect(scope).toEqual({ kind: "ok", handles: ["naval"] });
  });

  it("searches the whole collection when neither selects", () => {
    const scope = resolveScope({ collection });
    expect(scope).toEqual({ kind: "ok", handles: collection });
  });

  it("rejects an agent choice outside the collection instead of broadening or dropping it", () => {
    const scope = resolveScope({ collection, agentChoice: ["elon"] });
    expect(scope).toEqual({ kind: "invalid_scope", bad: ["elon"] });
  });

  it("rejects a selection that isn't in the collection", () => {
    const scope = resolveScope({ collection, selected: ["elon"] });
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

describe("unknownHandles", () => {
  it("returns only the handles outside the collection", () => {
    expect(unknownHandles(["hormozi", "elon"], collection)).toEqual(["elon"]);
    expect(unknownHandles(["hormozi"], collection)).toEqual([]);
  });
});
