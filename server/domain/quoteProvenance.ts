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
