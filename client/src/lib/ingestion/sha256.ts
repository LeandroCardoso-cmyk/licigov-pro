/**
 * PR B.2.2 — SHA-256 no cliente (Web Crypto).
 *
 * O checksum do cliente é apenas EXPECTATIVA declarada; a autoridade é o servidor, que
 * recalcula o SHA-256 durante o streaming e valida contra o declarado. Aqui só produzimos
 * o hash para o `createSession` e para dedup/idempotência.
 */

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

/** SHA-256 hex de um Blob/File (lê o conteúdo uma vez; adequado até o limite de 50 MB). */
export async function sha256HexOfBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return toHex(digest);
}

/** SHA-256 hex de texto (UTF-8) — usado no fluxo "colar conteúdo". */
export async function sha256HexOfText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

/** Chave idempotente estável por tentativa (8–64 chars). */
export function newIdempotencyKey(): string {
  const uuid = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join("");
  return `ing_${uuid}`.slice(0, 64);
}
