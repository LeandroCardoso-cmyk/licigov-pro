/**
 * PR B.2.1 — Rota de byte-upload da ingestão canônica (server-side, Express + multipart streaming).
 *
 * multipart/form-data real, orientado a streaming (busboy):
 *  - autenticação, tenant, autorização e feature flag resolvidos ANTES de consumir o corpo;
 *  - limite de tamanho aplicado DURANTE o streaming, com abort imediato ao exceder;
 *  - SHA-256 calculado incrementalmente (autoridade do servidor);
 *  - validação de magic bytes/conteúdo × MIME declarado;
 *  - storageKey gerada exclusivamente no servidor (no createSession); nome nunca vem do cliente;
 *  - streaming direto para o storage (S3 multipart) — nenhum Buffer com o arquivo completo, nenhum base64;
 *  - backpressure preservado (pipeline);
 *  - cleanup de upload parcial em finally (dentro de streamFileToStorage).
 *
 * NÃO promove ao domínio e NÃO dispara parsing (isso é enqueueProcessing). Nunca loga
 * URL/credencial/conteúdo.
 */
import type { Express, Request, Response } from "express";
import busboy from "busboy";
import { TRPCError } from "@trpc/server";
import { sdk } from "../_core/sdk";
import { resolveTenantForUser } from "../services/tenantService";
import { serviceLogger } from "../services/observabilityService";
import { getImportSession, attachStoredFile } from "../services/fileIngestionService";
import { assertCanonicalIngestionEnabled, streamFileToStorage } from "../services/ingestionUploadService";
import { MAX_FILE_SIZE_BYTES } from "../domain/importTypes";

const log = serviceLogger("IngestionUploadRoute");

function trpcCodeToHttp(code: string): number {
  switch (code) {
    case "BAD_REQUEST":            return 400;
    case "UNAUTHORIZED":           return 401;
    case "FORBIDDEN":              return 403;
    case "NOT_FOUND":              return 404;
    case "CONFLICT":               return 409;
    case "PRECONDITION_FAILED":    return 412;
    case "PAYLOAD_TOO_LARGE":      return 413;
    case "UNSUPPORTED_MEDIA_TYPE": return 415;
    default:                       return 500;
  }
}

function fail(res: Response, err: unknown): void {
  if (res.headersSent) return;
  if (err instanceof TRPCError) {
    res.status(trpcCodeToHttp(err.code)).json({ error: err.message });
    return;
  }
  log.error("ingestion_upload_failed", { message: err instanceof Error ? err.message : "erro desconhecido" });
  res.status(500).json({ error: "Falha ao processar o upload." });
}

export function registerIngestionUploadRoute(app: Express): void {
  app.post("/api/ingestion/upload/:sessionId", async (req: Request, res: Response) => {
    // ── AuthN/AuthZ resolvidos ANTES de consumir o corpo (só lê headers/cookies) ──
    let organizationId: number;
    let sessionId: number;
    let sourceFileId: string;
    let declaredMime: string;
    let fileName: string;
    let declaredChecksum: string | undefined;
    try {
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!user) return void res.status(401).json({ error: "Não autenticado." });

      const { organizationId: orgId, membership } = await resolveTenantForUser(user.id, req);
      if (!membership || !membership.ativo || !orgId) {
        return void res.status(403).json({ error: "Sem acesso à organização." });
      }
      organizationId = orgId;

      await assertCanonicalIngestionEnabled(organizationId);

      sessionId = Number.parseInt(req.params.sessionId, 10);
      if (!Number.isInteger(sessionId) || sessionId <= 0) {
        return void res.status(400).json({ error: "sessionId inválido." });
      }

      const session = await getImportSession(sessionId, organizationId);
      if (!session) return void res.status(404).json({ error: "Sessão não encontrada." });

      // Idempotência: sessão que já recebeu arquivo não aceita novo upload por aqui.
      if (session.status !== "uploaded") {
        return void res.status(409).json({ error: `Sessão não aceita upload no estado '${session.status}'.` });
      }
      sourceFileId    = session.sourceFileId;   // chave S3 gerada no servidor (createSession)
      declaredMime    = session.sourceMimeType;
      fileName        = session.sourceFileName;
      declaredChecksum = session.checksum ?? undefined;
    } catch (err) {
      return void fail(res, err);
    }

    // ── Streaming multipart (auth já validada; agora sim consumimos o corpo) ──
    let bb: busboy.Busboy;
    try {
      bb = busboy({
        headers: req.headers,
        limits: { files: 1, fields: 0, fileSize: MAX_FILE_SIZE_BYTES },
      });
    } catch {
      return void res.status(400).json({ error: "multipart/form-data inválido." });
    }

    let sawFile = false;

    bb.on("file", (_name, file, _info) => {
      sawFile = true;
      // Limite atingido no nível do parser → erro (nunca aceitar arquivo truncado).
      file.on("limit", () => {
        file.destroy(new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: `Arquivo excede ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.` }));
      });

      streamFileToStorage({
        source:           file,
        storageKey:       sourceFileId,
        declaredMime,
        fileName,
        declaredChecksum,
      })
        .then(async ({ checksum, size }) => {
          // Checksum aqui é o SHA-256 calculado pelo servidor (autoritativo).
          await attachStoredFile(sessionId, organizationId, { sourceSize: size, checksum, stage: "file_stored" });
          log.info("ingestion_upload_stored", { sessionId, organizationId, size });
          if (!res.headersSent) res.status(200).json({ ok: true, sessionId, size, checksum });
        })
        .catch(err => {
          req.unpipe(bb);
          fail(res, err);
        });
    });

    bb.on("close", () => {
      if (!sawFile && !res.headersSent) {
        res.status(400).json({ error: "Nenhum arquivo enviado (campo multipart ausente)." });
      }
    });

    bb.on("error", err => fail(res, err));

    req.pipe(bb);
  });
}
