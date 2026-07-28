/**
 * SEC-037 (PR B) — Política de upload seguro de anexo de TAREFA.
 *
 * Domínio puro (sem I/O): allowlist de tipos, validação de conteúdo por
 * magic-bytes, limite de tamanho e sanitização de nome com prevenção de path
 * traversal. Reutilizado pelo `departmentTasksRouter.addAttachment`, que faz a
 * autorização (tenant + tarefa) e a gravação no Storage Service (S3).
 *
 * Princípio: NÃO confiar no MIME declarado pelo cliente — confirmar o conteúdo
 * real pela assinatura de bytes. `text/plain` não tem assinatura estável, então
 * é validado por heurística (ausência de bytes NUL na amostra inicial).
 */

/** Limite de tamanho por anexo de tarefa (10 MB — alinhado ao módulo Gestão). */
export const MAX_TASK_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Limite de segurança do payload base64 no input (10 MB ≈ 13,4 MB em base64). */
export const MAX_TASK_ATTACHMENT_BASE64_CHARS = 14_000_000;

type ByteSignature = { readonly bytes: readonly number[]; readonly offset?: number };

/**
 * MIME permitido → assinaturas aceitas (qualquer match aprova). Lista vazia =
 * tipo textual sem assinatura estável, validado por heurística.
 */
const MIME_SIGNATURES: Record<string, readonly ByteSignature[]> = {
  // PDF: "%PDF"
  "application/pdf": [{ bytes: [0x25, 0x50, 0x44, 0x46] }],
  // OOXML (docx/xlsx) são contêineres ZIP: "PK\x03\x04" (+ variantes vazias/spanned)
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    { bytes: [0x50, 0x4b, 0x03, 0x04] },
    { bytes: [0x50, 0x4b, 0x05, 0x06] },
    { bytes: [0x50, 0x4b, 0x07, 0x08] },
  ],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    { bytes: [0x50, 0x4b, 0x03, 0x04] },
    { bytes: [0x50, 0x4b, 0x05, 0x06] },
    { bytes: [0x50, 0x4b, 0x07, 0x08] },
  ],
  // Formatos OLE2 legados (doc/xls): D0 CF 11 E0 A1 B1 1A E1
  "application/msword": [{ bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }],
  "application/vnd.ms-excel": [{ bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }],
  // Imagens comuns de evidência
  "image/png": [{ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  "image/jpeg": [{ bytes: [0xff, 0xd8, 0xff] }],
  // Texto simples: sem assinatura estável → heurística (ver validate*)
  "text/plain": [],
};

/** MIMEs permitidos para anexo de tarefa (allowlist fechada). */
export const ALLOWED_TASK_ATTACHMENT_MIME_TYPES = Object.keys(MIME_SIGNATURES) as readonly string[];

export function isAllowedTaskAttachmentMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(MIME_SIGNATURES, mime);
}

/**
 * Sanitiza o nome do arquivo para uso interno seguro:
 * - descarta qualquer componente de caminho (previne path traversal);
 * - remove caracteres não seguros e sequências de ponto ("..");
 * - limita o comprimento; garante um fallback não vazio.
 */
export function sanitizeAttachmentFileName(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = baseName
    .replace(/[^a-zA-Z0-9_\-. ]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^\.+/, "")
    .trim();
  const safe = cleaned.slice(0, 200).trim();
  return safe.length > 0 ? safe : "arquivo";
}

function matchesSignature(buffer: Buffer, sig: ByteSignature): boolean {
  const offset = sig.offset ?? 0;
  if (buffer.length < offset + sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    if (buffer[offset + i] !== sig.bytes[i]) return false;
  }
  return true;
}

export interface TaskAttachmentValidation {
  readonly valid: boolean;
  readonly reason?: string;
}

/**
 * Valida um anexo de tarefa: tamanho, allowlist de MIME e correspondência real
 * do conteúdo (magic-bytes). Mensagens em pt-BR.
 */
export function validateTaskAttachment(
  buffer: Buffer,
  declaredMime: string,
): TaskAttachmentValidation {
  if (buffer.length === 0) {
    return { valid: false, reason: "Arquivo vazio." };
  }
  if (buffer.length > MAX_TASK_ATTACHMENT_BYTES) {
    return { valid: false, reason: `Arquivo excede o limite de ${MAX_TASK_ATTACHMENT_BYTES / 1024 / 1024}MB.` };
  }
  const signatures = MIME_SIGNATURES[declaredMime];
  if (!signatures) {
    return { valid: false, reason: `Tipo de arquivo não permitido: ${declaredMime}.` };
  }
  // text/plain: sem assinatura estável → rejeita se houver byte NUL (binário).
  if (signatures.length === 0) {
    const sample = buffer.subarray(0, 8192);
    if (sample.includes(0x00)) {
      return { valid: false, reason: "O conteúdo binário é incompatível com um arquivo de texto." };
    }
    return { valid: true };
  }
  const ok = signatures.some((sig) => matchesSignature(buffer, sig));
  if (!ok) {
    return { valid: false, reason: "O conteúdo do arquivo não corresponde ao tipo declarado." };
  }
  return { valid: true };
}
