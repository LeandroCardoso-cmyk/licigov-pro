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

  app.use(helmet({
    contentSecurityPolicy: false, // gerenciado pelo Vite em dev
    crossOriginEmbedderPolicy: false,
  }));

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
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
}

async function main() {
  await bootstrap();
  await startServer();
}

main().catch((err) => {
  console.error("[bootstrap] Fatal error during startup:", err);
  process.exit(1);
});
