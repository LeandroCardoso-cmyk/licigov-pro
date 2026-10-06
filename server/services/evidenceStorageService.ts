/**
 * Kernel — Evidence Storage Service (R7 / PR-16, SEM-020).
 *
 * Fronteira do Kernel para guardar a EVIDÊNCIA documental dos Business Domains (ex.: documento obrigatório da
 * Contratação Direta). Os domínios nunca importam o Storage Service diretamente (RC-3.5.2): chamam este serviço,
 * que valida a disponibilidade do storage e devolve só a referência (chave) — nunca binário em banco.
 */
import { assertStorageUsable, storageDelete, storagePut } from "../storage";

export async function storeEvidenceFile(params: { key: string; content: Buffer; mimeType: string }): Promise<{ key: string }> {
  assertStorageUsable();
  const stored = await storagePut(params.key, params.content, params.mimeType);
  return { key: stored.key };
}

/** Compensação: remove um objeto de evidência cuja persistência falhou (best-effort, nunca lança). */
export async function discardEvidenceFile(key: string): Promise<void> {
  await storageDelete(key).catch(() => undefined);
}
