import { describe, expect, it } from "vitest";

import { removeChat, renameChat } from "~/app/_components/chat-list";

const chats = [
  { id: "chat-1", title: "First", updatedAt: 3 },
  { id: "chat-2", title: "Second", updatedAt: 2 },
  { id: "chat-3", title: "Third", updatedAt: 1 },
];

describe("optimistic chat list updates", () => {
  it("removes a chat immediately without mutating the cached list", () => {
    const next = removeChat(chats, "chat-2");

    expect(next.map((chat) => chat.id)).toEqual(["chat-1", "chat-3"]);
    expect(chats.map((chat) => chat.id)).toEqual([
      "chat-1",
      "chat-2",
      "chat-3",
    ]);
  });

  it("renames a chat immediately while preserving its position and metadata", () => {
    const next = renameChat(chats, "chat-2", "Updated title");

    expect(next).toEqual([
      chats[0],
      { id: "chat-2", title: "Updated title", updatedAt: 2 },
      chats[2],
    ]);
    expect(chats[1]?.title).toBe("Second");
  });

  it("leaves the cached list unchanged when the chat is unknown", () => {
    expect(removeChat(chats, "chat-9")).toEqual(chats);
    expect(renameChat(chats, "chat-9", "Updated title")).toEqual(chats);
  });

  it("handles an empty cached list", () => {
    expect(removeChat([], "chat-1")).toEqual([]);
    expect(renameChat([], "chat-1", "Updated title")).toEqual([]);
  });
});
