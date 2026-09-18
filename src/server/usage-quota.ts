import { sql } from "drizzle-orm";

import { db } from "~/server/db";
import { dailyUsage } from "~/server/db/schema";

export const DAILY_LIMITS = {
  chat: 100,
  import: 3,
} as const;

export type MeteredAction = keyof typeof DAILY_LIMITS;

/** Atomically consume one daily allowance, including under concurrent requests. */
export async function consumeDailyQuota(
  userId: string,
  action: MeteredAction,
): Promise<boolean> {
  const limit = DAILY_LIMITS[action];
  const rows = await db.execute<{ count: number }>(sql`
    INSERT INTO ${dailyUsage} (user_id, day, action, count)
    VALUES (${userId}, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, ${action}, 1)
    ON CONFLICT (user_id, day, action)
    DO UPDATE SET count = ${dailyUsage.count} + 1
    WHERE ${dailyUsage.count} < ${limit}
    RETURNING count
  `);

  return rows.length > 0;
}
