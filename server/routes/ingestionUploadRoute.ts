/**
 * PR B.2.1 — Rota de byte-upload da ingestão canônica (server-side, Express).
 *
 * Por que fora do tRPC: base64 no tRPC é proibido e o storage não expõe presigned PUT.
 * Esta rota recebe o binário CRU (application/octet-stream) via `express.raw`, valida
 * server-side (magic bytes, checksum, tamanho, tenant, status), grava no S3 pelo Storage
 * Service (chave gerada pelo servidor, anti path traversal) e anexa à sessão.
 *
 * Segurança: mesma autenticação do tRPC (JWT cookie → user → tenant), feature flag
 * tenant-aware (fail-closed), nenhuma URL/credencial/conteúdo em logs, nome de objeto nunca
 * controlado pelo cliente. NÃO promove ao domínio e NÃO dispara parsing (isso é enqueueProcessing).
 */
import type { Express, Request, Response } from "express";
import express from "express";
import { sdk } from "../_core/sdk";
import { resolveTenantForUser } from "../services/tenantService";
import { serviceLogger } from "../services/observabilityService";
import { storagePut } from "../storage";
import {
  getImportSession,
  attachStoredFile,
} from "../services/fileIngestionService";
import {
  assertCanonicalIngestionEnabled,
  validateUploadContent,
} from "../services/ingestionUploadService";
import { MAX_FILE_SIZE_BYTES } from "../domain/importTypes";
import { TRPCError } from "@trpc/server";

const log = serviceLogger("IngestionUploadRoute");

/** Mapeia códigos TRPC → HTTP para respostas coerentes fora do tRPC. */
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
    case "FAILED_DEPENDENCY":      return 424;
    default:                       return 500;
  }
}

export function registerIngestionUploadRoute(app: Express): void {
  app.post(
    "/api/ingestion/upload/:sessionId",
    // Buffer o corpo binário cru, independentemente do Content-Type declarado; o formato real
    // é validado por magic bytes contra o mime declarado na sessão. Limite = teto de ingestão.
    express.raw({ type: () => true, limit: MAX_FILE_SIZE_BYTES }),
    async (req: Request, res: Response) => {
      try {
        // ── AuthN/AuthZ: idêntica ao tRPC (cookie JWT → user → tenant) ──
        const user = await sdk.authenticateRequest(req).catch(() => null);
        if (!user) {
          return res.status(401).json({ error: "Não autenticado." });
        }
        const { organizationId, membership } = await resolveTenantForUser(user.id, req);
        if (!membership || !membership.ativo || !organizationId) {
          return res.status(403).json({ error: "Sem acesso à organização." });
        }

        await assertCanonicalIngestionEnabled(organizationId);

        const sessionId = Number.parseInt(req.params.sessionId, 10);
        if (!Number.isInteger(sessionId) || sessionId <= 0) {
          return res.status(400).json({ error: "sessionId inválido." });
        }

        const session = await getImportSession(sessionId, organizationId);
        if (!session) {
          return res.status(404).json({ error: "Sessão não encontrada." });
        }

        const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

        // Validação estrita server-side (tamanho, sniff, checksum, mime declarado).
        const v = validateUploadContent({
          buffer,
          declaredMime:     session.sourceMimeType,
          fileName:         session.sourceFileName,
          declaredChecksum: session.checksum ?? undefined,
          expectedSize:     session.sourceSize > 0 ? session.sourceSize : undefined,
        });

        // Idempotência do upload: já armazenado com mesmo checksum → no-op de sucesso.
        if (session.stage === "file_stored" && session.checksum === v.checksum) {
          return res.status(200).json({ ok: true, sessionId, size: v.size, checksum: v.checksum, idempotent: true });
        }
        // Só aceita upload em sessão recém-criada (uploaded). Estados posteriores são conflito.
        if (session.status !== "uploaded") {
          return res.status(409).json({ error: `Sessão não aceita upload no estado '${session.status}'.` });
        }

        // Persiste no S3 pela chave gerada no createSession (server-controlled).
        await storagePut(session.sourceFileId, buffer, session.sourceMimeType);
        await attachStoredFile(sessionId, organizationId, { sourceSize: v.size, checksum: v.checksum, stage: "file_stored" });

        log.info("ingestion_upload_stored", { sessionId, organizationId, size: v.size });
        return res.status(200).json({ ok: true, sessionId, size: v.size, checksum: v.checksum, idempotent: false });
      } catch (err) {
        if (err instanceof TRPCError) {
          return res.status(trpcCodeToHttp(err.code)).json({ error: err.message });
        }
        // Erro de tamanho do express.raw (PayloadTooLargeError) ou outro inesperado.
        const anyErr = err as { type?: string; status?: number; message?: string };
        if (anyErr?.type === "entity.too.large" || anyErr?.status === 413) {
          return res.status(413).json({ error: `Arquivo excede ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.` });
        }
        log.error("ingestion_upload_failed", { message: anyErr?.message ?? "erro desconhecido" });
        return res.status(500).json({ error: "Falha ao processar o upload." });
      }
    },
  );
}
