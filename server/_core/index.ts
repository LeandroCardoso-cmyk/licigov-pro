import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import helmet from "helmet";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { bootstrap } from "../bootstrap";
import { APP_CONFIG } from "../config/app";
import { IS_DEVELOPMENT } from "../config/env";
import { correlationMiddleware } from "../middleware/correlationMiddleware";
import { EMAIL_CONFIG } from "../config/email";
import { start as startEmailDispatcher } from "../services/email/emailDispatcher";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // PR A.1 — Railway roda a aplicação atrás de um proxy reverso; sem isto, `req.ip` é sempre o IP
  // do proxy (não o do cliente), o que quebraria o rate limiting por IP (ex.: passwordReset) e a
  // auditoria de `ipAddress`. `1` = confia em um único hop de proxy (o do Railway).
  app.set("trust proxy", 1);

  app.use(helmet({
    contentSecurityPolicy: false, // gerenciado pelo Vite em dev
    crossOriginEmbedderPolicy: false,
  }));

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  app.use(correlationMiddleware);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (IS_DEVELOPMENT) {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = APP_CONFIG.port;
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.info(`[BOOT] Porta ${preferredPort} ocupada, usando porta ${port}`);
  }

  server.listen(port, () => {
    console.info(`[BOOT][${APP_CONFIG.env}] ${APP_CONFIG.name} rodando em http://localhost:${port}/`);
  });

  // PR A.1 — o dispatcher NUNCA roda automaticamente ao importar o módulo (ver comentário em
  // emailDispatcher.ts); precisa deste start() explícito, e só quando há algo para enviar
  // (EMAIL_ENABLED) e fora da suíte de testes (VITEST nunca inicia timers de produção).
  if (EMAIL_CONFIG.enabled && process.env.VITEST !== "true") {
    startEmailDispatcher();
  }
}

async function main() {
  await bootstrap();
  await startServer();
}

main().catch((err) => {
  console.error("[bootstrap] Fatal error during startup:", err);
  process.exit(1);
});
