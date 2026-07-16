import { z } from "zod";
import { sql } from "drizzle-orm";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getDb } from "../db/connection";
import { APP_CONFIG } from "../config/app";
import { AI_CONFIG } from "../config/ai";
// RC-3.5 — o healthcheck do S3 passa pelo Storage Service (nunca acessa a AWS direto).
import { storageHealthCheck } from "../storage";

const REQUIRED_ENV_KEYS = ["DATABASE_URL", "JWT_SECRET", "GEMINI_API_KEY"] as const;

async function checkDb(): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

async function checkS3(): Promise<boolean> {
  // RC-3.5 — delega ao Storage Service (único ponto de acesso ao Amazon S3).
  return storageHealthCheck();
}

function checkAi(): boolean {
  return AI_CONFIG.isConfigured;
}

function checkEnv(): boolean {
  return REQUIRED_ENV_KEYS.every((key) => !!process.env[key]);
}

export const systemRouter = router({
  health: publicProcedure
    .input(z.object({ timestamp: z.number().min(0).optional() }))
    .query(async () => {
      const [db, s3] = await Promise.all([checkDb(), checkS3()]);
      const ai  = checkAi();
      const env = checkEnv();
      const ok  = db && env;

      return {
        ok,
        env:     APP_CONFIG.env,
        db,
        s3,
        ai,
        uptime:  Math.floor(process.uptime()),
        version: APP_CONFIG.version,
        node:    process.version,
      };
    }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title:   z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return { success: delivered } as const;
    }),
});
