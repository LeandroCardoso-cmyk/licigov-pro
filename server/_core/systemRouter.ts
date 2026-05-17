import { z } from "zod";
import { sql } from "drizzle-orm";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getDb } from "../db/connection";
import { APP_CONFIG } from "../config/app";
import { AWS_CONFIG } from "../config/aws";
import { AI_CONFIG } from "../config/ai";

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
  if (!AWS_CONFIG.isConfigured) return false;
  try {
    const client = new S3Client({
      region: AWS_CONFIG.region,
      credentials: {
        accessKeyId: AWS_CONFIG.accessKeyId,
        secretAccessKey: AWS_CONFIG.secretAccessKey,
      },
    });
    await client.send(new HeadBucketCommand({ Bucket: AWS_CONFIG.bucket }));
    return true;
  } catch {
    return false;
  }
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
