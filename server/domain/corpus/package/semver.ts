/**
 * RC-4.6 — Federal Procurement Corpus Package · Semver mínimo (determinístico).
 *
 * Comparação de versões e verificação de faixas simples (">=x.y.z", "x.y.z"). Puro, sem
 * dependências externas. Usado para compatibilidade e versionamento de pacotes/coleções.
 */

export interface ParsedVersion { readonly major: number; readonly minor: number; readonly patch: number; }

export function parseVersion(v: string): ParsedVersion | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function isValidVersion(v: string): boolean {
  return parseVersion(v) !== null;
}

/** -1 se a<b, 0 se igual, 1 se a>b. Lança se alguma versão é inválida. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a); const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`versão inválida: ${a} / ${b}`);
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return 0;
}

/**
 * Satisfação de faixa simples: "x.y.z" (igualdade exata) ou ">=x.y.z" (mínimo).
 * Determinística; retorna false para faixa/versão inválida.
 */
export function satisfies(version: string, range: string): boolean {
  if (!isValidVersion(version)) return false;
  const r = range.trim();
  if (r.startsWith(">=")) {
    const min = r.slice(2).trim();
    if (!isValidVersion(min)) return false;
    return compareVersions(version, min) >= 0;
  }
  if (!isValidVersion(r)) return false;
  return compareVersions(version, r) === 0;
}
