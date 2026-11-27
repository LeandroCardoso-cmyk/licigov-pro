/**
 * PROMPT 08 / D-3 — referência de armazenamento do anexo de tarefa. O bucket é PRIVADO: nunca se entrega URL pública; o download
 * é por URL ASSINADA de curta duração, emitida após autorização (sessão + tenant + vínculo anexo↔tarefa).
 *
 * Sem migration: `task_attachments.fileUrl` passa a guardar a CHAVE interna (`tasks/{taskId}/…`) nos novos uploads; registros
 * antigos guardam a URL pública — a chave é derivada do caminho, e SÓ é aceita se pertencer ao prefixo da PRÓPRIA tarefa (nunca
 * se assina ou apaga objeto de outro recurso/tenant). Chave não resolvível ⇒ null (sem download/remoção física; registrado).
 */
export const TASK_ATTACHMENT_URL_TTL_SECONDS = 300;

export function taskAttachmentKeyPrefix(taskId: number): string {
  return `tasks/${taskId}/`;
}

export function attachmentStorageKey(fileUrl: string, taskId: number): string | null {
  const prefix = taskAttachmentKeyPrefix(taskId);
  const raw = (fileUrl ?? "").trim();
  if (!raw) return null;
  let candidate: string | null = null;
  if (raw.startsWith(prefix)) candidate = raw;
  else if (/^https?:\/\//i.test(raw)) {
    try {
      const path = decodeURIComponent(new URL(raw).pathname);
      const at = path.indexOf(`/${prefix}`);
      candidate = at >= 0 ? path.slice(at + 1) : null;
    } catch {
      candidate = null;
    }
  }
  if (!candidate || !candidate.startsWith(prefix)) return null;
  const rest = candidate.slice(prefix.length);
  // Um único segmento de arquivo, sem travessia nem subpastas (o upload gera `tasks/{id}/{ts}_{nome}`).
  if (!rest || rest.includes("/") || rest.includes("..") || rest.includes("\\")) return null;
  return candidate;
}
