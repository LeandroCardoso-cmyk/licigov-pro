/**
 * M8 — PROVENIÊNCIA ESTRUTURADA das cotações (política aprovada pelo Owner em 20/10/2026, alternativa D).
 *
 * Coluna `price_research_items.provenance_kind` (migration 0319, aditiva, anulável, SEM backfill):
 *   - `ficticia`   — fonte DECLARADA fictícia/demonstrativa (declaração explícita no dado); nunca fundamenta referência
 *                    institucional nem documento oficial de órgão real;
 *   - `declarada`  — fonte informada/importada, SEM verificação institucional (não é "verificada");
 *   - `verificada` — reservado a procedimento legítimo de verificação; NENHUM caminho atual grava este valor (o parser
 *                    nunca atribui verificação por heurística);
 *   - `NULL`       — legado/desconhecido (linhas anteriores à 0319): nunca presumido fictício nem verificado.
 *
 * Distinção obrigatória: DECLARAÇÃO EXPLÍCITA (ex.: "Fornecedor Fictício A", "dados fictícios") × SUSPEITA heurística
 * (palavras genéricas como "teste", "exemplo", "homologação", "simulado", "sintético" — comuns em razões sociais e
 * objetos reais). A suspeita só gera aviso de revisão; nunca grava `ficticia`.
 */

export const QUOTE_PROVENANCE_KINDS = ["ficticia", "declarada", "verificada"] as const;
export type QuoteProvenanceKind = (typeof QUOTE_PROVENANCE_KINDS)[number];

/** Estado EFETIVO lido (legado incluído). `suspeita`/`desconhecida` só existem na leitura — nunca são gravados. */
export type EffectiveQuoteProvenance = QuoteProvenanceKind | "suspeita" | "desconhecida";

export function isQuoteProvenanceKind(v: unknown): v is QuoteProvenanceKind {
  return typeof v === "string" && (QUOTE_PROVENANCE_KINDS as readonly string[]).includes(v);
}

/** Palavra "fictício/fictícia" — declaração explícita (não aparece em razões sociais reais). */
const FICTITIOUS_WORD = /\bfict[ií]ci[oa]s?\b/gi;
/**
 * Declaração explícita do CONJUNTO de dados: "dados/valores/preços/cotações/fontes/fornecedores … sintéticos|demonstrativos".
 * ("pesquisa sintética" fica de fora: pode significar "pesquisa resumida".)
 */
const DECLARED_DATASET = /\b(?:dados|valores|pre[çc]os|cota[çc](?:[ãa]o|[õo]es)|fontes?|fornecedor(?:es)?)\s+(?:s[ãa]o\s+)?(?:sint[ée]tic|demonstrativ|fict[ií]ci)/gi;
/** Negação próxima ANTES do termo ("não foram aceitas cotações de fornecedores fictícios") ⇒ não é declaração. */
const NEGATION_BEFORE = /\b(?:n[ãa]o|nenhum[a]?|sem|nunca|jamais|exceto|vedad[oa]s?|proibid[oa]s?)\b[^.;:\n]{0,48}$/i;

function declaredMatch(re: RegExp, t: string): boolean {
  re.lastIndex = 0;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    if (!NEGATION_BEFORE.test(t.slice(0, m.index))) return true;
  }
  return false;
}
/** Suspeita heurística (só aviso): termos genéricos que também ocorrem em dados reais. */
const SUSPECT_WORDS = /\bteste\b|dados? de teste|exemplo|homologa[çc][ãa]o|simulad|sint[ée]tic|inexistente/i;

/** O texto DECLARA explicitamente que a fonte/os dados são fictícios ou demonstrativos. */
export function declaresFictitious(text: string | null | undefined): boolean {
  const t = text ?? "";
  return declaredMatch(FICTITIOUS_WORD, t) || declaredMatch(DECLARED_DATASET, t);
}

/** Fornecedor cujo NOME declara a fonte fictícia ("Fornecedor Fictício A") — prevalece sobre qualquer valor gravado. */
export function supplierNameDeclaresFictitious(name: string | null | undefined): boolean {
  return declaredMatch(FICTITIOUS_WORD, name ?? "");
}

/** Termos genéricos que sugerem dado de teste sem declarar — nunca bastam para classificar como fictícia. */
export function suggestsDemonstrative(text: string | null | undefined): boolean {
  const t = text ?? "";
  return !declaresFictitious(t) && (SUSPECT_WORDS.test(t) || /\bfict[ií]ci[oa]s?\b/i.test(t));
}

/**
 * Proveniência a GRAVAR numa cotação recém-lida (parser / promoção / importação da Contratação Direta): `ficticia` só
 * com declaração explícita (no fornecedor, nas notas da cotação ou no documento inteiro); caso contrário `declarada`.
 * Nunca `verificada`.
 */
export function classifyIncomingQuote(q: { supplier?: string | null; notes?: string | null; documentDeclaresFictitious?: boolean }): QuoteProvenanceKind {
  if (q.documentDeclaresFictitious === true) return "ficticia";
  return declaresFictitious(q.supplier) || declaresFictitious(q.notes) ? "ficticia" : "declarada";
}

/**
 * REIMPORTAÇÃO da mesma linha (mesmo id de cotação): regra determinística e conservadora.
 *   - o novo conteúdo declara `ficticia` ⇒ `ficticia` (declaração explícita prevalece);
 *   - mesmo conteúdo econômico (fornecedor + valor) já `ficticia`/`verificada` ⇒ mantém (remover a nota do texto NÃO
 *     converte uma fictícia em real; reimportar não apaga uma verificação);
 *   - conteúdo diferente (outro fornecedor ou valor) ⇒ é outra cotação: vale a proveniência nova (a mudança de
 *     conteúdo muda o hash da cotação e passa pela revisão governada da fonte no Item Inteligente).
 * Espelhada em SQL no upsert de `price_research_items` (ver `insertResearchItem`).
 */
export function mergeReimportedProvenance(p: {
  existing: QuoteProvenanceKind | null; incoming: QuoteProvenanceKind; sameEconomicContent: boolean;
}): QuoteProvenanceKind {
  if (p.incoming === "ficticia") return "ficticia";
  if (p.sameEconomicContent && (p.existing === "ficticia" || p.existing === "verificada")) return p.existing;
  return p.incoming;
}

/**
 * Proveniência EFETIVA na leitura (inclui linhas legadas sem a coluna):
 *   - fornecedor que DECLARA "fictício" no próprio nome ⇒ `ficticia` (a declaração no dado usado prevalece sobre
 *     qualquer valor gravado — inclusive no retrato preservado de um item já decidido);
 *   - coluna preenchida ⇒ ela;
 *   - legado (NULL) com o marcador textual antigo: observações que DECLARAM fictício (fora o próprio marcador) ⇒
 *     `ficticia`; senão ⇒ `suspeita` (o documento marca [REVISAR] para revisão humana; sem bloqueio estrutural);
 *   - demais ⇒ `desconhecida`.
 */
export function effectiveQuoteProvenance(q: {
  stored: string | null | undefined; supplierName?: string | null; legacyMarker?: boolean; legacyNotes?: string | null;
}): EffectiveQuoteProvenance {
  if (supplierNameDeclaresFictitious(q.supplierName)) return "ficticia";
  if (isQuoteProvenanceKind(q.stored)) return q.stored;
  if (q.legacyMarker === true) return declaresFictitious(q.legacyNotes) ? "ficticia" : "suspeita";
  return "desconhecida";
}

/** Contagem das cotações COM PREÇO por proveniência efetiva. */
export interface QuoteProvenanceCounts {
  readonly priced: number;
  readonly ficticia: number;
  readonly declarada: number;
  readonly verificada: number;
  readonly suspeita: number;
  readonly desconhecida: number;
}

export function countProvenance(states: readonly EffectiveQuoteProvenance[]): QuoteProvenanceCounts {
  const c = { priced: states.length, ficticia: 0, declarada: 0, verificada: 0, suspeita: 0, desconhecida: 0 };
  for (const s of states) c[s] += 1;
  return c;
}

/**
 * Texto honesto do conjunto de cotações (UI e risco derivado). Nunca chama de "válida" uma cotação: preço positivo não
 * torna a fonte institucionalmente utilizável.
 */
export function describeQuoteSet(c: QuoteProvenanceCounts): string {
  if (c.priced === 0) return "Nenhuma cotação com preço.";
  const parts: string[] = [`${c.priced} cotação(ões) importada(s) com preço`];
  if (c.ficticia > 0) parts.push(`${c.ficticia} identificada(s) como fictícia(s) — não utilizável(is) como pesquisa de preços oficial`);
  if (c.suspeita > 0) parts.push(`${c.suspeita} possivelmente demonstrativa(s) — confira a fonte`);
  const pending = c.declarada + c.desconhecida;
  if (pending > 0 && (c.ficticia > 0 || c.suspeita > 0 || c.verificada > 0)) parts.push(`${pending} declarada(s), sem verificação`);
  if (c.verificada > 0) parts.push(`${c.verificada} verificada(s)`);
  return `${parts.join("; ")}.`;
}

/** Cotações que podem compor uma referência institucional (fictícias nunca). */
export function institutionallyUsableCount(c: QuoteProvenanceCounts): number {
  return c.priced - c.ficticia;
}

/**
 * Texto do risco de amostra pequena. Preço positivo NÃO torna a cotação "válida" (a fonte pode ser fictícia ou não
 * verificada): o risco descreve só o FATO — quantas cotações importadas têm preço.
 */
export const LOW_QUOTE_COUNT_RISK_TEXT = "Menos de 3 cotações importadas com preço.";
/** Texto legado gravado antes da política (normalizado na LEITURA; as linhas do banco não são reescritas). */
export const LEGACY_LOW_QUOTE_COUNT_RISK_TEXT = "Menos de 3 cotações válidas na pesquisa.";

export interface ItemRiskView { id: string; type: string; severity: string; description: string; explanation: string }

/**
 * Riscos EXIBIDOS do Item Inteligente (derivados na leitura, sem reescrever o banco): normaliza o texto legado de
 * "cotações válidas" e acrescenta o risco de fonte fictícia quando houver — nunca chama de válida uma fonte fictícia.
 */
export function deriveItemRisks(itemId: string, stored: readonly ItemRiskView[], c: QuoteProvenanceCounts | null): ItemRiskView[] {
  const out = stored.map((r) => r.type === "baixa_competitividade" && r.description === LEGACY_LOW_QUOTE_COUNT_RISK_TEXT
    ? { ...r, description: LOW_QUOTE_COUNT_RISK_TEXT } : r);
  if (c && c.ficticia > 0) {
    out.push({
      id: `derived:fonte_ficticia:${itemId}`, type: "fonte_ficticia", severity: "alto",
      description: describeQuoteSet(c),
      explanation: "Cotação fictícia não fundamenta preço de referência nem documento oficial: o preço fica suspenso até a referência ser fundamentada em cotações reais.",
    });
  }
  return out;
}

// ─── Declaração do DOCUMENTO (cabeçalho/título/notas de arquivo importado) ───────────────────────────────────────────

/** Escopo PARCIAL ("os itens 3 e 4…", "algumas cotações…", "exceto…"): a declaração não vale para o conjunto inteiro. */
const PARTIAL_SCOPE = /\b(?:ite(?:m|ns)|linhas?|lotes?|cota[çc](?:[ãa]o|[õo]es))\s+(?:n[ºo°.]?\s*)?\d|\b(?:alguns|algumas|parte d[oa]s?|parcialmente|exceto|salvo)\b/i;

/**
 * Classifica uma linha NÃO-cotação do documento (título, cabeçalho, nota): `global` = declaração explícita, sem negação, de
 * que o CONJUNTO de valores é fictício/demonstrativo; `partial` = declaração explícita restrita a parte do documento
 * (só revisão — nunca marca o conjunto); `null` = nada declarado (termos genéricos não bastam).
 */
/**
 * Declaração do CONJUNTO: o sujeito coletivo GOVERNA o predicado (não basta co-ocorrer na linha):
 *   "dados/valores/preços/cotações/fontes/fornecedores/itens/empresas/exemplo [são] fictícios|demonstrativos|sintéticos";
 *   "todos/todas/tudo … fictício"; "planilha/documento/tabela/mapa/conteúdo/material … com|é|são|contém … fictício|demonstrativo".
 * Singular "cotação/proposta fictícia" (uma fonte desconsiderada) e rótulo "Fornecedor Fictício A" NÃO são do conjunto.
 */
const COLLECTIVE_DECLARATIONS: readonly RegExp[] = [
  /\b(?:dados|valores|pre[çc]os|cota[çc][õo]es|fontes|fornecedores|itens|empresas|exemplos?)\s+(?:s[ãa]o\s+|foram\s+)?(?:todos\s+|todas\s+)?(?:fict[ií]ci|demonstrativ|sint[ée]tic)/gi,
  /\b(?:todos|todas|tudo)\b[^.;:\n]{0,60}?\b(?:fict[ií]ci|demonstrativ)/gi,
  /\b(?:planilha|documento|tabela|mapa|conte[uú]do|material)\b[^.;:\n]{0,40}?\b(?:com|[ée]|s[ãa]o|cont[ée]m)\b[^.;:\n]{0,24}?\b(?:fict[ií]ci|demonstrativ)/gi,
];

/**
 * Classifica uma linha NÃO-cotação de ARQUIVO (título, cabeçalho, nota): `global` = declaração explícita, sem negação, de
 * que o CONJUNTO é fictício/demonstrativo; `partial` = declara fictício mas restrito a parte (itens N, algumas…) ou sem
 * sujeito coletivo (rótulo, cotação singular): só revisão; `null` = nada declarado (termos genéricos não bastam).
 */
export function classifyDocumentDeclaration(text: string | null | undefined): "global" | "partial" | null {
  const t = text ?? "";
  if (!declaresFictitious(t)) return null;
  if (PARTIAL_SCOPE.test(t)) return "partial";
  return COLLECTIVE_DECLARATIONS.some((re) => declaredMatch(re, t)) ? "global" : "partial";
}

/** Escopo restrito a parte das cotações (itens N, linhas N, algumas, exceto…). */
export function isPartialDeclarationScope(text: string | null | undefined): boolean {
  return PARTIAL_SCOPE.test(text ?? "");
}

/** Aviso estruturado gravado pela extração (import_sessions.warnings): o documento declara o conjunto fictício. */
export const DOCUMENT_DECLARES_FICTITIOUS = "DOCUMENT_DECLARES_FICTITIOUS";
/** Declaração restrita a parte do documento: revisão supervisionada, sem classificar o conjunto. */
export const DOCUMENT_PARTIAL_FICTITIOUS_DECLARATION = "DOCUMENT_PARTIAL_FICTITIOUS_DECLARATION";
/** Aviso de OCR de baixa confiança (extração existente): a declaração lida por OCR incerto não é confirmada. */
const OCR_LOW_CONFIDENCE = "OCR_LOW_CONFIDENCE";

/**
 * Decisão da PROMOÇÃO a partir dos avisos estruturados da sessão de importação (determinística, sem IA):
 *   `global`    ⇒ todas as cotações da sessão são gravadas `ficticia` (a declaração do arquivo não se perde);
 *   `suspected` ⇒ declaração parcial ou lida por OCR de baixa confiança: só revisão (cotações seguem `declarada`);
 *   `null`      ⇒ nada declarado.
 */
export function documentFictitiousDeclaration(warnings: unknown): "global" | "suspected" | null {
  const list = (Array.isArray(warnings) ? warnings : []).filter((w): w is { code: string; field?: unknown } =>
    !!w && typeof w === "object" && typeof (w as { code?: unknown }).code === "string");
  const lowOcr = list.some((w) => w.code === OCR_LOW_CONFIDENCE);
  const globals = list.filter((w) => w.code === DOCUMENT_DECLARES_FICTITIOUS);
  // Só a declaração lida POR OCR é rebaixada quando o OCR foi de baixa confiança; texto nativo/planilha vale sempre.
  if (globals.some((w) => w.field !== DECLARATION_FROM_OCR)) return "global";
  if (globals.length > 0) return lowOcr ? "suspected" : "global";
  return list.some((w) => w.code === DOCUMENT_PARTIAL_FICTITIOUS_DECLARATION) ? "suspected" : null;
}

/** Marca (campo `field` do aviso) da declaração lida no texto do OCR. */
export const DECLARATION_FROM_OCR = "ocr";

/** Mantém no máximo UM aviso de declaração do documento por tipo (várias fontes do mesmo arquivo: tabela + texto). */
export function dedupeDocumentDeclarations<T extends { code: string; field?: string }>(warnings: readonly T[]): T[] {
  // Um aviso por (tipo, origem): a declaração do texto nativo e a do OCR são evidências distintas (rebaixamento por OCR).
  const seen = new Set<string>();
  return warnings.filter((w) => {
    if (w.code !== DOCUMENT_DECLARES_FICTITIOUS && w.code !== DOCUMENT_PARTIAL_FICTITIOUS_DECLARATION) return true;
    const k = `${w.code}|${w.field === DECLARATION_FROM_OCR ? "ocr" : "text"}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ─── P1-C — evidência versionada da ANÁLISE de declaração do documento ──────────────────────────────────────────────
//
// A AUSÊNCIA de `DOCUMENT_DECLARES_FICTITIOUS` só significa "nada declarado" quando a extração EXECUTOU a análise. Sessões
// extraídas antes dela não têm o aviso por não terem sido examinadas — não por serem regulares. A evidência abaixo é gravada
// SÓ pelo backend (worker de extração/reextração/revalidação, junto ao resultado da extração em
// `import_sessions.extractionSummary`), também quando nada é encontrado, vinculada ao checksum do arquivo analisado. A
// promoção a exige (fail-closed); nenhum parâmetro do cliente participa.

/** Versão do contrato da análise de declaração do documento. Mudou o que a análise examina ⇒ INCREMENTAR (sessões antigas
 *  passam a exigir revalidação). 1 = emenda P1-B (título/notas/parágrafos/demais abas/OCR). */
export const PROVENANCE_SCAN_VERSION = 1;

/** Código acionável da promoção recusada por falta de análise compatível. */
export const PROVENANCE_SCAN_REQUIRED = "PROVENANCE_SCAN_REQUIRED";
export const PROVENANCE_SCAN_REQUIRED_MESSAGE =
  "Esta pesquisa foi extraída por uma versão anterior da análise de proveniência. Revalide o arquivo original antes de promover as cotações — as revisões já feitas são preservadas.";

/** Marca que o PARSER devolve quando a análise da declaração do documento rodou no caminho de extração usado. */
export interface DeclarationScanPerformed { version: number }
export const DECLARATION_SCAN_PERFORMED: DeclarationScanPerformed = Object.freeze({ version: PROVENANCE_SCAN_VERSION });

export type ProvenanceScanOrigin = "extraction" | "reextraction" | "revalidation";

/** Evidência persistida em `extractionSummary.provenanceScan` (sem conteúdo do documento). */
export interface ProvenanceScanEvidence {
  version:        number;
  /** sha256 do arquivo efetivamente analisado (= `import_sessions.checksum`). */
  sourceChecksum: string;
  parserType:     string;
  parserVersion:  string;
  /** Veredito da análise (`documentFictitiousDeclaration` dos avisos produzidos por ela). */
  declaration:    "global" | "suspected" | null;
  origin:         ProvenanceScanOrigin;
  scannedAt:      string;
}

/**
 * Lacunas de COBERTURA da análise: página não lida — digitalizada sem OCR (indisponível/falho/limite do OCR) ou além do
 * limite de páginas do parser (`PAGE_LIMIT`). O texto dessas páginas não foi examinado — uma declaração ali não seria
 * vista — então não há evidência de análise concluída (a extração parcial continua disponível para revisão).
 */
export const DECLARATION_SCAN_COVERAGE_GAPS: ReadonlySet<string> = new Set([
  "OCR_REQUIRED", "OCR_REQUIRED_PARTIAL", "OCR_FAILED", "OCR_PAGE_LIMIT", "OCR_PAGES_INCOMPLETE", "PAGE_LIMIT",
]);
/** Lacuna do próprio ARQUIVO (não do ambiente): reanalisar o mesmo arquivo nunca a remove — revalidar é inútil. */
const FILE_COVERAGE_GAPS: ReadonlySet<string> = new Set(["PAGE_LIMIT"]);

const codesOf = (warnings: unknown): string[] => (Array.isArray(warnings) ? warnings : [])
  .map((w) => (w as { code?: unknown } | null)?.code).filter((c): c is string => typeof c === "string");

/** Lacunas de cobertura registradas nos avisos da extração. */
export function declarationScanCoverageGaps(warnings: unknown): string[] {
  return [...new Set(codesOf(warnings).filter((c) => DECLARATION_SCAN_COVERAGE_GAPS.has(c)))];
}
/** O arquivo excede o que a análise examina (revalidar o MESMO arquivo não conclui a análise). */
export function hasFileCoverageGap(warnings: unknown): boolean {
  return codesOf(warnings).some((c) => FILE_COVERAGE_GAPS.has(c));
}

export const PROVENANCE_SCAN_INCOMPLETE_MESSAGE =
  "A análise de proveniência não cobriu todo o arquivo (páginas além do limite de processamento ou digitalizadas não lidas). As cotações extraídas podem ser revisadas, mas não promovidas como pesquisa de preços utilizável: envie o arquivo dividido em partes menores ou em versão com texto legível.";

/** Orientação da recusa: cobertura incompleta registrada na extração × análise anterior/ausente. */
export function provenanceScanRequiredMessage(warnings: unknown): string {
  return declarationScanCoverageGaps(warnings).length > 0 ? PROVENANCE_SCAN_INCOMPLETE_MESSAGE : PROVENANCE_SCAN_REQUIRED_MESSAGE;
}

/** Veredito mais restritivo (global > suspected > nada). */
export function mostRestrictiveDeclaration(...vs: Array<"global" | "suspected" | null | undefined>): "global" | "suspected" | null {
  if (vs.includes("global")) return "global";
  return vs.includes("suspected") ? "suspected" : null;
}

/**
 * Evidência a partir do resultado do parser — ou null quando a análise não rodou nesse caminho, não cobriu todas as
 * páginas, a versão é outra ou o checksum do arquivo lido não corresponde ao da sessão (nunca se fabrica evidência).
 */
export function buildProvenanceScanEvidence(p: {
  performed: DeclarationScanPerformed | null | undefined;
  sessionChecksum: string | null | undefined;
  analyzedChecksum: string;
  parserType: string;
  parserVersion: string;
  warnings: unknown;
  origin: ProvenanceScanOrigin;
  now?: Date;
}): ProvenanceScanEvidence | null {
  if (p.performed?.version !== PROVENANCE_SCAN_VERSION) return null;
  if (declarationScanCoverageGaps(p.warnings).length > 0) return null;
  const session = (p.sessionChecksum ?? "").toLowerCase();
  if (!session || session !== p.analyzedChecksum.toLowerCase()) return null;
  return {
    version: PROVENANCE_SCAN_VERSION, sourceChecksum: session, parserType: p.parserType, parserVersion: p.parserVersion,
    declaration: documentFictitiousDeclaration(p.warnings), origin: p.origin, scannedAt: (p.now ?? new Date()).toISOString(),
  };
}

/** Registro append-only de uma revalidação (em `extractionSummary.provenanceRevalidations`) — sem conteúdo do documento. */
export interface ProvenanceRevalidationRecord {
  at:                  string;
  actorUserId:         number;
  correlationId:       string | null;
  sourceChecksum:      string;
  previousScanVersion: number | null;
  declaration:         "global" | "suspected" | null;
  /** A declaração era nova para a revisão ⇒ a aprovação da sessão foi devolvida à revisão humana. */
  approvalReopened:    boolean;
}

export type ProvenanceScanAssessment =
  | { ok: true; declaration: "global" | "suspected" | null }
  | { ok: false; reason: "MISSING" | "OUTDATED" | "CHECKSUM_MISMATCH" | "COVERAGE_INCOMPLETE" };

/**
 * Confere a evidência gravada na sessão (versão vigente + mesmo arquivo). Qualquer dúvida ⇒ não ok (fail-closed). Com os
 * avisos da sessão, lacuna do próprio ARQUIVO (ex.: PAGE_LIMIT) invalida até evidência gravada antes de ela ser lacuna.
 */
export function assessProvenanceScan(extractionSummary: unknown, sessionChecksum: string | null | undefined, sessionWarnings?: unknown): ProvenanceScanAssessment {
  if (hasFileCoverageGap(sessionWarnings)) return { ok: false, reason: "COVERAGE_INCOMPLETE" };
  const summary = typeof extractionSummary === "string"
    ? (() => { try { return JSON.parse(extractionSummary) as unknown; } catch { return null; } })()
    : extractionSummary;
  const ev = (summary as { provenanceScan?: Partial<ProvenanceScanEvidence> } | null)?.provenanceScan;
  if (!ev || typeof ev !== "object") return { ok: false, reason: "MISSING" };
  if (ev.version !== PROVENANCE_SCAN_VERSION) return { ok: false, reason: "OUTDATED" };
  const checksum = (sessionChecksum ?? "").toLowerCase();
  if (!checksum || typeof ev.sourceChecksum !== "string" || ev.sourceChecksum.toLowerCase() !== checksum) return { ok: false, reason: "CHECKSUM_MISMATCH" };
  const d = ev.declaration;
  return { ok: true, declaration: d === "global" || d === "suspected" ? d : null };
}

/**
 * Avisos da sessão após uma REVALIDAÇÃO: UNIÃO — preserva TODOS os avisos da extração vigente (inclusive declarações já
 * registradas: a revalidação nunca remove uma declaração) e acrescenta as declarações do documento da nova análise.
 */
export function mergeRevalidatedDeclarationWarnings<T extends { code: string; field?: string }>(current: unknown, revalidated: readonly T[]): T[] {
  const SCAN_CODES = new Set([DOCUMENT_DECLARES_FICTITIOUS, DOCUMENT_PARTIAL_FICTITIOUS_DECLARATION]);
  const keep = (Array.isArray(current) ? current : []).filter((w): w is T =>
    !!w && typeof w === "object" && typeof (w as { code?: unknown }).code === "string");
  return dedupeDocumentDeclarations([...keep, ...revalidated.filter((w) => SCAN_CODES.has(w.code))]);
}
