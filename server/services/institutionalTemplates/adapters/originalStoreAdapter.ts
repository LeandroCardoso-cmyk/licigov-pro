/**
 * Adapter do `TemplateOriginalStorePort` sobre o Storage Service EXISTENTE (único ponto de acesso ao S3). Chave: `institutional-templates/{org}/originals/{sha256}-{arquivo}`
 * (endereçada por conteúdo ⇒ idempotente; escopada por órgão ⇒ sem acesso cruzado). O nome do arquivo é sanitizado (nunca confiável).
 */
import { storagePut } from "../../../storage";
import type { TemplateOriginalStorePort } from "../ports";

export function safeOriginalFilename(name: string | null): string {
  const base = (name ?? "modelo").split(/[\\/]/).pop() ?? "modelo";
  const cleaned = base.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(0, 80);
  return cleaned || "modelo";
}

export function originalStorageKey(organizationId: number, sha256: string, filename: string | null): string {
  return `institutional-templates/${organizationId}/originals/${sha256}-${safeOriginalFilename(filename)}`;
}

export function createTemplateOriginalStoreAdapter(): TemplateOriginalStorePort {
  return {
    async put(i) {
      const { key } = await storagePut(originalStorageKey(i.organizationId, i.sha256, i.filename), i.bytes, i.contentType);
      return { storageKey: key };
    },
  };
}
