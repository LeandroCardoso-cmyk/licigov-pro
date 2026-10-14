/**
 * Adapter do `TemplateOriginalStorePort` sobre o Storage Service EXISTENTE (único ponto de acesso ao S3). Chave: `institutional-templates/{org}/originals/{sha256}-{arquivo}`
 * (endereçada por conteúdo ⇒ idempotente; escopada por órgão ⇒ sem acesso cruzado). O nome do arquivo é sanitizado (nunca confiável).
 * Preservação VERIFICADA: após gravar, o objeto é lido de volta e seu tamanho e SHA-256 conferem com o calculado no servidor; qualquer divergência rejeita.
 */
import { createHash } from "node:crypto";
import { storageExists, storageGetBytes, storagePut } from "../../../storage";
import type { OriginalVerification, TemplateOriginalStorePort } from "../ports";

export function safeOriginalFilename(name: string | null): string {
  const base = (name ?? "modelo").split(/[\\/]/).pop() ?? "modelo";
  const cleaned = base.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(0, 80);
  return cleaned || "modelo";
}

export function originalStorageKey(organizationId: number, sha256: string, filename: string | null): string {
  return `institutional-templates/${organizationId}/originals/${sha256}-${safeOriginalFilename(filename)}`;
}

/** A chave pertence ao PRÓPRIO órgão e à área de originais (defesa em profundidade contra registro adulterado/cruzado). */
export const isOwnOriginalKey = (organizationId: number, key: string): boolean => key.startsWith(`institutional-templates/${organizationId}/originals/`) && !key.includes("..");

const sha256Hex = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

export function createTemplateOriginalStoreAdapter(): TemplateOriginalStorePort {
  return {
    async put(i) {
      const { key } = await storagePut(originalStorageKey(i.organizationId, i.sha256, i.filename), i.bytes, i.contentType);
      const back = await storageGetBytes(key);
      const computed = sha256Hex(back);
      if (back.length !== i.bytes.length || computed !== i.sha256) throw new Error("original_readback_mismatch");
      return { storageKey: key, verifiedSha256: computed, verifiedSizeBytes: back.length };
    },
    async verify(i): Promise<OriginalVerification> {
      if (!isOwnOriginalKey(i.organizationId, i.storageKey)) return { status: "FORBIDDEN_KEY" };
      try {
        if (!(await storageExists(i.storageKey))) return { status: "MISSING" };
        const computed = sha256Hex(await storageGetBytes(i.storageKey));
        return computed === i.sha256 ? { status: "VERIFIED" } : { status: "MISMATCH", computedSha256: computed };
      } catch (err) {
        return { status: "UNAVAILABLE", message: err instanceof Error ? err.message : "falha desconhecida" };
      }
    },
  };
}
