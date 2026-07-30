/**
 * PR D — Health check HTTP de plataforma (liveness / readiness).
 *
 * Exposto como rota Express CRUA (fora do tRPC) para que o Railway / load balancer possa
 * consultar sem passar pelo `/api/trpc`. Distingue:
 * - liveness (`/livez`): o processo está de pé — nunca checa dependências, sempre 200;
 * - readiness (`/health`, `/healthz`, `/readyz`): pronto para tráfego — checa a dependência
 *   obrigatória (banco) com timeout curto; 200 quando saudável, 503 quando indisponível.
 *
 * Regras de segurança do endpoint: leve, sem auth, sem secrets, sem stack traces, sem dados
 * institucionais, sem detalhes de infraestrutura. A resposta é mínima e estável.
 *
 * Reutiliza `getDb()` (camada de dados) e a observabilidade existente (`serviceLogger`),
 * sem criar cliente de banco nem logger paralelos.
 */
import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { APP_CONFIG } from "../config/app";
import { withTimeout } from "./resilience";
import { serviceLogger } from "../services/observabilityService";

const log = serviceLogger("health");

const SERVICE_NAME = "licigov-pro";
/** Timeout curto — readiness nunca pode pendurar o load balancer. */
const DB_PING_TIMEOUT_MS = 2_000;

/**
 * Ping leve ao banco (`SELECT 1`) com timeout curto. Nunca lança: qualquer falha
 * (sem `DATABASE_URL`, conexão recusada, timeout) resolve como `false` = não pronto.
 */
export async function pingDatabase(): Promise<boolean> {
  try {
    return await withTimeout(async () => {
      const db = await getDb();
      if (!db) return false;
      await db.execute(sql`SELECT 1`);
      return true;
    }, DB_PING_TIMEOUT_MS, "health.pingDatabase");
  } catch {
    return false;
  }
}

/** Payload de liveness — não checa dependências. */
export function livenessPayload() {
  return {
    status: "ok" as const,
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: APP_CONFIG.version,
    node: process.version,
  };
}

export interface ReadinessResult {
  ready: boolean;
  body: {
    status: "ok" | "unavailable";
    service: string;
    timestamp: string;
    checks: { database: "ok" | "unavailable" };
  };
}

/** Avalia readiness (dependências obrigatórias). */
export async function readinessProbe(): Promise<ReadinessResult> {
  const dbOk = await pingDatabase();
  return {
    ready: dbOk,
    body: {
      status: dbOk ? "ok" : "unavailable",
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
      checks: { database: dbOk ? "ok" : "unavailable" },
    },
  };
}

/**
 * Registra as rotas de health no app Express. Deve ser chamado ANTES do mount do tRPC e
 * de qualquer catch-all do `serveStatic`/Vite (senão o SPA capturaria a rota).
 */
export function registerHealthRoutes(app: Express): void {
  // Liveness: o processo respondendo já é suficiente. Sempre 200.
  app.get("/livez", (_req: Request, res: Response) => {
    res.status(200).json(livenessPayload());
  });

  // Readiness: depende do banco. 200 pronto / 503 indisponível.
  const readinessHandler = async (_req: Request, res: Response) => {
    const { ready, body } = await readinessProbe();
    if (!ready) {
      // Evento operacional (OBS): dependência obrigatória indisponível.
      log.warn("readiness_degraded", { detail: "database_unavailable" });
    }
    res.status(ready ? 200 : 503).json(body);
  };

  app.get("/health", readinessHandler);
  app.get("/healthz", readinessHandler);
  app.get("/readyz", readinessHandler);
}
