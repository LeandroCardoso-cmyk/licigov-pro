import { z } from "zod";
import { sql } from "drizzle-orm";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getDb } from "../db/connection";
import { ENV } from "./env";

const REQUIRED_ENV_KEYS = ["DATABASE_URL", "JWT_SECRET", "GEMINI_API_KEY"] as const;

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative").optional(),
      })
    )
    .query(async () => {
      let db_ok = false;
      try {
        const db = await getDb();
        if (db) {
          await db.execute(sql`SELECT 1`);
          db_ok = true;
        }
      } catch {}

      const env_ok = REQUIRED_ENV_KEYS.every((key) => !!process.env[key]);

      return {
        ok: db_ok && env_ok,
        db: db_ok,
        env: env_ok,
        uptime: Math.floor(process.uptime()),
        version: process.env.npm_package_version ?? "unknown",
        node: process.version,
      };
    }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
