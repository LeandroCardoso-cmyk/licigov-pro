/**
 * Codec `chave=valor` das EVIDÊNCIAS de governança no ledger de decisões (`institutional_decisions.evidence`, lista de textos).
 * Sem esquema novo: o ledger existente já guarda uma lista de textos por decisão; aqui só se padroniza a forma de ler/escrever.
 * Chaves fora da allowlist são ignoradas na leitura (nunca interpretadas); valores sem quebra de linha, até 480 caracteres.
 */
export const KV_MAX_VALUE = 480;

export function encodeKv(key: string, value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_.]{0,39}$/.test(key)) throw new Error(`chave de evidência inválida: ${key}`);
  const v = value.trim();
  if (v === "" || /[\r\n]/.test(v) || v.length > KV_MAX_VALUE) throw new Error(`valor de evidência inválido para ${key}`);
  return `${key}=${v}`;
}

/** Lê as linhas `chave=valor` cuja chave está na allowlist; a 1ª ocorrência vence; as demais linhas são devolvidas em `others`. */
export function decodeKv(lines: readonly string[], allowed: readonly string[]): { readonly values: Readonly<Record<string, string>>; readonly others: readonly string[] } {
  const values: Record<string, string> = {};
  const others: string[] = [];
  for (const line of lines) {
    const i = line.indexOf("=");
    const key = i > 0 ? line.slice(0, i) : "";
    if (key && allowed.includes(key) && !(key in values)) values[key] = line.slice(i + 1);
    else others.push(line);
  }
  return { values, others };
}
