/**
 * V1 PRE-PILOT CLOSURE — Fase A2 — Canonical Locator (domínio PURO, sem I/O).
 *
 * Locator ESTÁVEL e DETERMINÍSTICO por fonte normativa, independente de ranking/posição — apto a
 * lineage e ao evidence fingerprint (A1). Para lei/decreto/IN: artigo/§/inciso/alínea/item; para
 * manual/acórdão/prejulgado: trecho/seção. NÃO usa `blockId` como autoridade normativa.
 *
 * Também extrai referências jurídicas ESTRUTURADAS de texto livre (rede de segurança para validar
 * conteúdo autorado contra o corpus — a autoria estruturada A2 devolve refs estruturadas, esta função
 * apenas complementa a verificação anti-alucinação).
 */

// ─── Slug determinístico de um identificador estrutural ───────────────────────

/** Converte um identificador estrutural ("Art. 18º", "§ 1º", "Inciso IX", "Alínea a") em slug estável. */
export function slugLocatorSegment(identifier: string): string {
  const raw = (identifier ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase().replace(/[º°]/g, "").replace(/\s+/g, " ").trim();
  let m: RegExpMatchArray | null;
  if ((m = lower.match(/^art\.?\s*(\d+)\s*(-?[a-z])?/))) return `art-${m[1]}${m[2] ? m[2].replace("-", "-") : ""}`;
  if (/^par[áa]grafo\s+[úu]nico/.test(lower)) return "par-unico";
  if ((m = lower.match(/^§\s*(\d+)/)) || (m = lower.match(/^par[áa]grafo\s*(\d+)/))) return `par-${m[1]}`;
  if ((m = lower.match(/^inciso\s+([ivxlcdm]+)/))) return `inc-${m[1]}`;
  if ((m = lower.match(/^al[íi]nea\s+([a-z])/))) return `al-${m[1]}`;
  if ((m = lower.match(/^item\s+(\d+)/))) return `item-${m[1]}`;
  if ((m = lower.match(/^(?:trecho|chunk)\s+(\d+)/))) return `trecho-${m[1]}`;
  if ((m = lower.match(/^(?:se[çc][ãa]o|section)\s+([ivxlcdm]+|\d+)/))) return `sec-${m[1]}`;
  if ((m = lower.match(/^(?:cap[íi]tulo|chapter)\s+([ivxlcdm]+|\d+)/))) return `cap-${m[1]}`;
  if ((m = lower.match(/^(?:p[áa]gina|page|p)\.?\s*(\d+)/))) return `pag-${m[1]}`;
  // fallback determinístico: normaliza para slug estável (sem depender de posição).
  return lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "trecho";
}

/**
 * Locator canônico ESTÁVEL: `${sourceId}:${segmento[:sub-segmento...]}`. Determinístico e legível por
 * máquina; independe de ranking/blockId. Ex.: `lei-14133-2021:art-18:par-1:inc-ix`.
 */
export function canonicalLocatorId(sourceId: string, identifier: string, ...subIdentifiers: string[]): string {
  const src = (sourceId ?? "").trim();
  const segs = [identifier, ...subIdentifiers].map(slugLocatorSegment).filter((s) => s.length > 0);
  return segs.length > 0 ? `${src}:${segs.join(":")}` : src;
}

// ─── Nome de exibição de diploma (legível para o servidor) ────────────────────

/** Formata um locator legível a partir do nome do diploma + identificador. Ex.: "Lei nº 14.133/2021 — Art. 18". */
export function displayLocator(diplomaName: string, identifier: string): string {
  const d = (diplomaName ?? "").trim();
  const id = (identifier ?? "").trim();
  if (d && id) return `${d} — ${id}`;
  return d || id || "";
}

// ─── Extração ESTRUTURADA de referências jurídicas de texto livre ─────────────

/** Referência jurídica estruturada (para validação contra o corpus). */
export interface ParsedLegalReference {
  /** Pista de diploma normalizada (ex.: "lei-14133-2021", "lei-8666-1993") quando citada; senão null. */
  readonly diplomaHint: string | null;
  /** Número do artigo (ex.: "18", "6-A"). */
  readonly article: string;
  /** Identificador estrutural legível reconstruído (ex.: "Art. 18, §1º, IX"). */
  readonly identifier: string;
  /**
   * Segmentos de locator canônico APÓS o sourceId (ex.: ["art-18","par-1","inc-ix"]). Representa a
   * referência estrutural COMPLETA citada — artigo + §/inciso/alínea/item quando presentes. Usado para
   * validar a granularidade real contra o corpus (não basta o artigo existir).
   */
  readonly segments: readonly string[];
  /** Sub-caminho de locator após o artigo (ex.: "par-1:inc-ix"); vazio quando só o artigo é citado. */
  readonly subLocatorPath: string;
  /** Trecho bruto capturado (para diagnóstico/sanitização). */
  readonly raw: string;
}

/** Converte números romanos (i..m) em label maiúsculo canônico (ex.: "ix" → "IX"). */
function romanUpper(r: string): string {
  return r.toUpperCase();
}

/**
 * Extrai segmentos estruturais (§/inciso/alínea/item) do trecho que segue "Art. N", em ORDEM. Só o
 * material ANTES de uma citação de diploma é considerado. Determinístico e conservador (evita capturar
 * romanos/letras que não sejam referência estrutural). Retorna slugs canônicos (par-1, inc-ix, al-a…).
 */
export function parseStructuralSegments(tailBeforeDiploma: string): { segments: string[]; labels: string[] } {
  const segments: string[] = [];
  const labels: string[] = [];
  const s = tailBeforeDiploma ?? "";
  // Parágrafo: "§ 1º" | "§1" | "parágrafo único".
  let m: RegExpMatchArray | null;
  if ((m = s.match(/§\s*(\d+)/))) { segments.push(`par-${m[1]}`); labels.push(`§ ${m[1]}º`); }
  else if (/par[áa]grafo\s+[úu]nico/i.test(s)) { segments.push("par-unico"); labels.push("parágrafo único"); }
  // Inciso: "inciso IX" | ", IX" | "§1º, IX" (romano MAIÚSCULO após vírgula/§/'inciso').
  if ((m = s.match(/inciso\s+([IVXLCDM]+)\b/))) { segments.push(`inc-${m[1].toLowerCase()}`); labels.push(`inciso ${romanUpper(m[1])}`); }
  else if ((m = s.match(/[,§][^,]*?,\s*([IVXLCDM]+)\b/)) || (m = s.match(/[,§]\s*([IVXLCDM]+)\b/))) { segments.push(`inc-${m[1].toLowerCase()}`); labels.push(`inciso ${romanUpper(m[1])}`); }
  // Alínea: "alínea a" | ", a)" | ", a" (após inciso) | 'a)'.
  if ((m = s.match(/al[íi]nea\s+["“']?([a-z])["”']?/i))) { segments.push(`al-${m[1].toLowerCase()}`); labels.push(`alínea ${m[1].toLowerCase()}`); }
  else if ((m = s.match(/["“']?([a-z])["”']?\s*\)/))) { segments.push(`al-${m[1].toLowerCase()}`); labels.push(`alínea ${m[1].toLowerCase()}`); }
  else if (segments.some((x) => x.startsWith("inc-")) && (m = s.match(/,\s*([a-z])\b/))) { segments.push(`al-${m[1].toLowerCase()}`); labels.push(`alínea ${m[1].toLowerCase()}`); }
  // Item: "item 3".
  if ((m = s.match(/item\s+(\d+)/i))) { segments.push(`item-${m[1]}`); labels.push(`item ${m[1]}`); }
  return { segments, labels };
}

/** Normaliza uma citação de diploma no texto ("Lei 14.133/2021", "Lei nº 8.666/93") → normId-hint. */
export function normalizeDiplomaHint(rawDiploma: string | undefined | null): string | null {
  if (!rawDiploma) return null;
  const s = rawDiploma.toLowerCase().replace(/n[º°.]?\s*/g, "").replace(/\s+/g, " ").trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/lei\s+complementar\s+([\d.]+)\s*\/?\s*(\d{2,4})?/))) return `lc-${m[1].replace(/\./g, "")}-${expandYear(m[2])}`;
  if ((m = s.match(/(?:lei|l)\s+([\d.]+)\s*\/?\s*(\d{2,4})?/))) return `lei-${m[1].replace(/\./g, "")}-${expandYear(m[2])}`;
  if ((m = s.match(/decreto\s+([\d.]+)\s*\/?\s*(\d{2,4})?/))) return `decreto-${m[1].replace(/\./g, "")}-${expandYear(m[2])}`;
  if ((m = s.match(/(?:in|instru[çc][ãa]o normativa)\s+(?:seges\/?me\s+)?([\d.]+)\s*\/?\s*(\d{2,4})?/))) return `in-seges-${m[1].replace(/\./g, "")}-${expandYear(m[2])}`;
  return null;
}

function expandYear(y: string | undefined): string {
  if (!y) return "";
  if (y.length === 4) return y;
  const n = parseInt(y, 10);
  return n <= 40 ? `20${y.padStart(2, "0")}` : `19${y.padStart(2, "0")}`;
}

/**
 * Extrai referências de artigo estruturadas de texto livre. Determinístico. NÃO decide mérito jurídico —
 * apenas identifica "Art. N (da Lei X)" para posterior verificação de EXISTÊNCIA no corpus. A pista de
 * diploma vem da mesma sentença/parênteses quando presente.
 */
const DIPLOMA_RE = /\b(?:da\s+|do\s+)?(lei\s+complementar\s+n?[º°.]?\s*[\d.]+(?:\/\d{2,4})?|lei\s+n?[º°.]?\s*[\d.]+(?:\/\d{2,4})?|decreto\s+n?[º°.]?\s*[\d.]+(?:\/\d{2,4})?|in\s+(?:seges\/?me\s+)?[\d.]+(?:\/\d{2,4})?)/i;

export function parseLegalReferences(text: string): ParsedLegalReference[] {
  const out: ParsedLegalReference[] = [];
  const seen = new Set<string>();
  // Captura "Art. N" + a cauda da citação (até ~80 chars; permite "." de "14.133") — o diploma e a
  // estrutura (§/inciso/alínea) são pós-parseados dessa cauda, em ordem, ANTES da menção do diploma.
  const re = /\b(?:art\.?|artigo)\s*(\d+(?:-[A-Za-z])?)\s*[º°]?([^;\n]{0,80})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? "")) !== null) {
    const article = m[1].replace(/[º°]/g, "");
    const tail = m[2] ?? "";
    const diplomaMatch = tail.match(DIPLOMA_RE);
    const diplomaHint = normalizeDiplomaHint(diplomaMatch?.[1] ?? null);
    // Estrutura só do material ANTES do diploma (evita capturar números do diploma como inciso/item).
    const structPart = diplomaMatch ? tail.slice(0, diplomaMatch.index) : tail.split(/[.]\s|\s{2,}/)[0];
    const { segments: subSegs, labels } = parseStructuralSegments(structPart);
    const segments = [`art-${article.toLowerCase()}`, ...subSegs];
    const subLocatorPath = subSegs.join(":");
    const identifier = [`Art. ${article}`, ...labels].join(", ");
    // `raw` = a citação COMPLETA e EXATA (substring original: artigo + estrutura + diploma) — usada para
    // REMOVER a citação falsa da prosa (a remoção depende de casar o texto verbatim).
    const rawTail = diplomaMatch ? tail.slice(0, (diplomaMatch.index ?? 0) + diplomaMatch[0].length) : structPart;
    const prefix = m[0].slice(0, m[0].length - tail.length); // "Art. 999 " exatamente como no texto
    const raw = (prefix + rawTail).trim();
    const key = `${diplomaHint ?? ""}|${segments.join(":")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ diplomaHint, article, identifier, segments, subLocatorPath, raw });
  }
  // ── 2ª passagem — forma DIPLOMA-FIRST: "Lei nº 14.133/2021, art. 18" | "Lei X, art. 999" ──────────
  // Não deixa uma citação falsa escapar apenas pela ordem sintática (diploma antes do artigo).
  const reDip = /(lei\s+complementar\s+n?[º°.]?\s*[\d.]+(?:\/\d{2,4})?|lei\s+n?[º°.]?\s*[\d.]+(?:\/\d{2,4})?|decreto\s+n?[º°.]?\s*[\d.]+(?:\/\d{2,4})?|in\s+(?:seges\/?me\s+)?[\d.]+(?:\/\d{2,4})?)\s*,?\s*(?:art\.?|artigo)\s*(\d+(?:-[A-Za-z])?)\s*[º°]?([^;\n]{0,60})/gi;
  let d: RegExpExecArray | null;
  while ((d = reDip.exec(text ?? "")) !== null) {
    const diplomaHint = normalizeDiplomaHint(d[1]);
    if (!diplomaHint) continue;
    const article = d[2].replace(/[º°]/g, "");
    const structPart = (d[3] ?? "").split(/[.]\s|\s{2,}|\sda\s|\sdo\s/)[0];
    const { segments: subSegs, labels } = parseStructuralSegments(structPart);
    const segments = [`art-${article.toLowerCase()}`, ...subSegs];
    const identifier = [`Art. ${article}`, ...labels].join(", ");
    const key = `${diplomaHint}|${segments.join(":")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ diplomaHint, article, identifier, segments, subLocatorPath: subSegs.join(":"), raw: d[0].trim() });
  }
  return out;
}
