import type { Express, Request, Response } from "express";

// OAuth Manus removido na Fase 2 do plano de recuperação.
// Autenticação agora é feita via email + senha (tRPC auth.login / auth.register).
export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", (_req: Request, res: Response) => {
    res.status(410).json({ error: "OAuth Manus não está mais disponível. Use login por e-mail." });
  });
}
