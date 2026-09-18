import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { source } from "~/server/db/schema";

export const allowedCreatorSchema = z.object({
  handle: z.string().min(1),
  displayName: z.string().min(1),
});

export type AllowedCreator = z.infer<typeof allowedCreatorSchema>;

export const nexusRequestContextSchema = z.object({
  userId: z.string().min(1),
  hasSources: z.boolean(),
  allowedCreators: z.array(allowedCreatorSchema),
});

export type NexusRequestContext = z.infer<typeof nexusRequestContextSchema>;

type CreatorSource = {
  handle: string | null;
  displayName: string | null;
};

/** Collapse a user's sources into a stable, unique creator roster. */
export function deriveAllowedCreators(rows: CreatorSource[]): AllowedCreator[] {
  const creators = new Map<string, Set<string>>();

  for (const row of rows) {
    const handle = row.handle;
    if (!handle?.trim()) continue;

    const displayName = row.displayName?.trim();
    const names = creators.get(handle) ?? new Set<string>();
    if (displayName) names.add(displayName);
    creators.set(handle, names);
  }

  return [...creators]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([handle, names]) => ({
      handle,
      displayName:
        [...names].sort(
          (left, right) =>
            right.length - left.length || left.localeCompare(right),
        )[0] ?? handle,
    }));
}

/** Load the searchable-library facts derived from this user's owned sources. */
export async function loadSourceLibrary(
  userId: string,
): Promise<Pick<NexusRequestContext, "hasSources" | "allowedCreators">> {
  const rows = await db
    .select({
      handle: source.creatorHandle,
      displayName: source.author,
    })
    .from(source)
    .where(eq(source.userId, userId));

  return {
    hasSources: rows.length > 0,
    allowedCreators: deriveAllowedCreators(rows),
  };
}
