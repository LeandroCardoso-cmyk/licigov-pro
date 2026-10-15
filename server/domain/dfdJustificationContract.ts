/**
 * M8-AI-DFD-001 — CONTRATO DE SAÍDA da IA para a "Justificativa da necessidade" do DFD.
 *
 * Defeito de homologação: a saída livre da IA chegava ao documento com comentários de geração
 * ("Pontuação de confiança: 0.85", "Fatos utilizados: 1, 3", explicações sobre a tarefa), e os números
 * desses comentários ainda viravam "[REVISAR: …]" dentro do texto oficial.
 *
 * Correção ESTRUTURAL (não "cortar depois de um separador"): a IA responde num contrato que SEPARA
 *  - `paragrafos` → conteúdo documental (o único que pode ir para o DFD);
 *  - `lacunas`    → informações factuais ausentes (apresentadas ao servidor, fora do texto);
 *  - `avisos`     → ressalvas para o revisor (fora do texto);
 * e o SERVIDOR valida cada parágrafo antes de apresentá-lo: metadado de geração, autoavaliação, lista de
 * fatos, instrução de prompt, título de seção, item de lista, fragmento ou duplicata NUNCA viram texto
 * documental — são descartados com motivo registrado (observabilidade), sem cortar frases ao meio.
 * Saída fora do contrato (texto livre, JSON inválido) passa pela MESMA validação por parágrafo; se nada
 * documental sobrar, NÃO há sugestão (fallback seguro: o servidor redige manualmente).
 *
 * Puro e determinístico (mesma entrada ⇒ mesmo resultado ⇒ replay seguro).
 */
import { z } from "zod";

export const DFD_JUSTIFICATION_CONTRACT_VERSION = "dfd-justificativa-contrato/1";
export const MAX_PARAGRAPHS = 4;
const MAX_NOTES = 10;
const MIN_PARAGRAPH = 40;

/** JSON Schema que o provider DEVE preencher (structured output); o servidor revalida tudo. */
export const DFD_JUSTIFICATION_RESPONSE_SCHEMA = {
  name: "dfd_justificativa",
  schema: {
    type: "object",
    properties: {
      paragrafos: {
        type: "array", items: { type: "string" },
        description: "2 a 4 parágrafos do texto documental, prontos para o DFD. Sem títulos, listas, comentários, notas sobre a geração ou autoavaliação.",
      },
      lacunas: {
        type: "array", items: { type: "string" },
        description: "Informações factuais ausentes que o servidor precisa completar (no texto, indicadas por [REVISAR: …]).",
      },
      avisos: {
        type: "array", items: { type: "string" },
        description: "Ressalvas ao revisor humano. Nunca entram no documento.",
      },
    },
    required: ["paragrafos", "lacunas", "avisos"],
    additionalProperties: false,
  },
} as const;

const structuredSchema = z.object({
  paragrafos: z.array(z.string()).max(20),
  lacunas: z.array(z.string()).max(50).default([]),
  avisos: z.array(z.string()).max(50).default([]),
}).passthrough();

export type DiscardReason =
  | "metadado_de_geracao" | "autoavaliacao" | "lista_de_fatos" | "instrucao_ou_prompt" | "titulo_de_secao"
  | "item_de_lista" | "fragmento" | "duplicado" | "excede_limite" | "campo_fora_do_contrato";

export interface DiscardedSegment {
  readonly reason: DiscardReason;
  /** Trecho curto, só para auditoria técnica (nunca vai ao documento). */
  readonly excerpt: string;
}

export interface JustificationContractResult {
  readonly contractVersion: typeof DFD_JUSTIFICATION_CONTRACT_VERSION;
  /** Como a saída foi interpretada: no contrato estruturado ou por validação de texto livre (saída fora do contrato). */
  readonly contract: "structured" | "text-fallback";
  readonly paragraphs: readonly string[];
  readonly gaps: readonly string[];
  readonly warnings: readonly string[];
  readonly discarded: readonly DiscardedSegment[];
  /** Nenhum parágrafo documental válido ⇒ não há sugestão a apresentar. */
  readonly accepted: boolean;
}

// ─── Reconhecedores de conteúdo NÃO documental ───────────────────────────────

const SELF_ASSESSMENT = /(pontua[çc][ãa]o|n[íi]vel|grau|[íi]ndice|score)\s+de\s+confian[çc]a|\bconfian[çc]a\s*[:=]|\bconfidence\b|\bscore\s*[:=]|\bcerteza\s*[:=]/i;
const FACTS_LIST = /\bfatos?\s+(utilizad|usad|considerad|empregad|referenciad)|\bfontes?\s+(utilizad|consultad)|\bitens?\s+de\s+contexto\s+utilizad/i;
const GENERATION_META = /\b(este|o\s+presente)\s+(texto|rascunho|par[áa]grafo)\s+(foi|[ée])\s+(gerad|elaborad|redigid|produzid)|\bcomo\s+(um\s+)?(modelo|assistente|ia|intelig[êe]ncia artificial)\b|\b(gerad[oa]|elaborad[oa])\s+(pela|por)\s+(ia|intelig[êe]ncia artificial|modelo)\b|^(aqui est[áa]|segue(m)?(\s+abaixo)?|abaixo\s+(est[áa]|segue))\b|\bvers[ãa]o\s+do\s+prompt\b|\bexecution\s*id\b/i;
const PROMPT_ECHO = /\b(prompt|instru[çc][õo]es\s+(recebidas|fornecidas)|regras\s+obrigat[óo]rias|conforme\s+solicitado|tarefa\s*:)/i;
const NOTES_LABEL = /^(lacunas?|pend[êe]ncias|informa[çc][õo]es\s+(faltantes|ausentes|pendentes)|dados\s+faltantes)\s*:?\s*(.*)$/i;
const WARNINGS_LABEL = /^(avisos?|observa[çc][õo]es|ressalvas?|notas?(\s+ao\s+revisor)?)\s*:?\s*(.*)$/i;
const META_LABEL = /^(pontua[çc][ãa]o|confian[çc]a|fatos\s+utilizados|fontes|metadados|explica[çc][ãa]o)\b[^:]*:\s*(.*)$/i;
const SECTION_TITLE = /^(?:\d+(?:\.\d+)*\s*[-.)–—]?\s*)?(justificativa(\s+da\s+(necessidade|contrata[çc][ãa]o|demanda))?|necessidade\s+da\s+contrata[çc][ãa]o|documento\s+de\s+formaliza[çc][ãa]o\s+da\s+demanda|dfd)\s*:?\s*$/i;
const LIST_ITEM = /^\s*(?:[-*•▪·]|\d{1,2}[.)]|[a-z][.)])\s+/i;

const tidy = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/^#+\s*/, "").replace(/[ \t]+/g, " ").trim();
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const excerpt = (s: string) => s.slice(0, 120);

function classify(p: string): DiscardReason | null {
  if (SECTION_TITLE.test(p) || (p.length < 80 && !/[.!?…]$/.test(p) && /^[\p{Lu}\d\s.,–—\-:()]+$/u.test(p))) return "titulo_de_secao";
  if (SELF_ASSESSMENT.test(p)) return "autoavaliacao";
  if (FACTS_LIST.test(p)) return "lista_de_fatos";
  if (GENERATION_META.test(p)) return "metadado_de_geracao";
  if (PROMPT_ECHO.test(p)) return "instrucao_ou_prompt";
  if (LIST_ITEM.test(p)) return "item_de_lista";
  if (p.length < MIN_PARAGRAPH || !/\p{L}{3,}/u.test(p) || !/[.!?…]$/.test(p.replace(/\s*\[REVISAR:[^\]]*\]\s*$/, "."))) return "fragmento";
  return null;
}

const cleanNote = (s: string) => tidy(s).replace(LIST_ITEM, "").replace(/^\[REVISAR:\s*|\]$/g, "").trim().slice(0, 300);

function pushNotes(target: string[], items: readonly string[]) {
  for (const raw of items) {
    const n = cleanNote(raw);
    if (n && !target.some((t) => norm(t) === norm(n)) && target.length < MAX_NOTES) target.push(n);
  }
}

/** Interpreta a saída BRUTA do provider no contrato documental (estruturado ou texto livre fora do contrato). */
export function interpretJustificationOutput(raw: string): JustificationContractResult {
  const discarded: DiscardedSegment[] = [];
  const gaps: string[] = [];
  const warnings: string[] = [];
  let candidates: string[] = [];
  let contract: JustificationContractResult["contract"] = "text-fallback";

  const body = (raw ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let structured: z.infer<typeof structuredSchema> | null = null;
  if (body.startsWith("{")) {
    try { structured = structuredSchema.parse(JSON.parse(body)); } catch { structured = null; }
  }
  if (structured) {
    contract = "structured";
    for (const k of Object.keys(structured)) {
      if (!["paragrafos", "lacunas", "avisos"].includes(k)) discarded.push({ reason: "campo_fora_do_contrato", excerpt: excerpt(k) });
    }
    // Um "parágrafo" com quebras internas é tratado bloco a bloco (a IA pode embutir comentário em linha própria).
    candidates = structured.paragrafos.flatMap((p) => p.split(/\n+/));
    pushNotes(gaps, structured.lacunas);
    pushNotes(warnings, structured.avisos);
  } else {
    // Fora do contrato: texto livre. Blocos separados por linha em branco; rótulos de lacunas/avisos/metadados
    // abrem uma seção cujos itens vão para o lugar certo (nunca para o documento).
    let bucket: "doc" | "gaps" | "warnings" | "meta" = "doc";
    for (const block of body.split(/\n\s*\n/)) {
      bucket = "doc";
      for (const line0 of block.split(/\n/)) {
        const line = tidy(line0);
        if (!line) continue;
        const g = line.match(NOTES_LABEL);
        const w = line.match(WARNINGS_LABEL);
        const m = line.match(META_LABEL);
        if (g) { bucket = "gaps"; if (g[3]) pushNotes(gaps, g[3].split(/;\s*/)); continue; }
        if (w) { bucket = "warnings"; if (w[3]) pushNotes(warnings, [w[3]]); continue; }
        if (m) { bucket = "meta"; discarded.push({ reason: SELF_ASSESSMENT.test(line) ? "autoavaliacao" : FACTS_LIST.test(line) ? "lista_de_fatos" : "metadado_de_geracao", excerpt: excerpt(line) }); continue; }
        if (bucket === "gaps" && LIST_ITEM.test(line)) { pushNotes(gaps, [line]); continue; }
        if (bucket === "warnings" && LIST_ITEM.test(line)) { pushNotes(warnings, [line]); continue; }
        if (bucket === "meta" && LIST_ITEM.test(line)) { discarded.push({ reason: "metadado_de_geracao", excerpt: excerpt(line) }); continue; }
        bucket = "doc";
        candidates.push(line);
      }
    }
    // Linhas consecutivas de um mesmo parágrafo de prosa (quebra simples) são reunidas.
    candidates = mergeWrappedLines(candidates);
  }

  const paragraphs: string[] = [];
  for (const c of candidates) {
    const p = tidy(c);
    if (!p) continue;
    const reason = classify(p);
    if (reason) { discarded.push({ reason, excerpt: excerpt(p) }); continue; }
    if (paragraphs.some((q) => norm(q) === norm(p))) { discarded.push({ reason: "duplicado", excerpt: excerpt(p) }); continue; }
    if (paragraphs.length >= MAX_PARAGRAPHS) { discarded.push({ reason: "excede_limite", excerpt: excerpt(p) }); continue; }
    paragraphs.push(p);
  }
  // Lacunas citadas no próprio texto ([REVISAR: …]) também aparecem na lista de lacunas, fora do documento.
  pushNotes(gaps, paragraphs.flatMap((p) => [...p.matchAll(/\[REVISAR:\s*([^\]]+)\]/g)].map((m) => m[1])));

  return {
    contractVersion: DFD_JUSTIFICATION_CONTRACT_VERSION, contract, paragraphs, gaps, warnings, discarded,
    accepted: paragraphs.length > 0,
  };
}

function mergeWrappedLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    const prose = (s: string) => !LIST_ITEM.test(s) && !SECTION_TITLE.test(s) && classify(s) !== "autoavaliacao" && classify(s) !== "lista_de_fatos" && classify(s) !== "metadado_de_geracao";
    if (prev !== undefined && !/[.!?…:]$/.test(prev) && prose(prev) && prose(l) && /^[\p{Ll}(]/u.test(l)) out[out.length - 1] = `${prev} ${l}`;
    else out.push(l);
  }
  return out;
}
