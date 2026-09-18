type Chat = { id: string; title: string };

/** Immutable cache updates shared by the optimistic chat mutations. */
export function removeChat<T extends Chat>(chats: T[], id: string): T[] {
  return chats.filter((chat) => chat.id !== id);
}

export function renameChat<T extends Chat>(
  chats: T[],
  id: string,
  title: string,
): T[] {
  return chats.map((chat) =>
    chat.id === id ? { ...chat, title } : chat,
  );
}
