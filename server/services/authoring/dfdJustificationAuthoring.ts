/**
 * DFD — RASCUNHO SUPERVISIONADO da "Justificativa da necessidade" (seção 2), único campo narrativo do DFD
 * que exige elaboração textual. Fatos (objeto, unidade, itens, quantidades, valores) NÃO passam por IA:
 * vêm deterministicamente do Contexto Canônico (dfdPrefill.ts).
 *
 * Governança:
 *  - chamada EXCLUSIVAMENTE via AIExecutionEngine (`executeCognitiveTask`) — nunca provider direto;
 *  - contexto GOVERNADO: só fatos canônicos resolvidos (sem preços, sem dados pessoais, sem valores);
 *  - saída é RASCUNHO: nunca decisão, nunca aprovação, nunca documento oficial;
 *  - guarda determinística: número citado pela IA que o processo não confirma vira `[REVISAR: …]`
 *    (a IA não inventa quantidade, prazo, orçamento ou fundamento);
 *  - explicabilidade: executionId, provider/modelo, versão do prompt, digest do contexto e do input.
 */
import { executeCognitiveTask } from "../aiExecutionEngine";
import { canonicalDigest } from "../../domain/canonicalJson";
import type { ProcurementCanonicalContext } from "../../domain/canonicalProcurementContext";
import { formatQuantity } from "../../domain/dfdPrefill";

export const DFD_JUSTIFICATION_PROMPT_VERSION = "dfd-justificativa/1";
const DOMAIN = "processo_licitatorio" as const;

export interface DFDJustificationFacts {
  objeto: string | null;
  orgao: string | null;
  localidade: string | null;
  unidadeDemandante: string | null;
  planejamento: string | null;
  prioridade: string | null;
  itens: Array<{ descricao: string; unidade: string; quantidadePrevista: string | null }>;
}

/** Fatos AUTORIZADOS para a IA (sem preço/orçamento e sem nome de pessoa). */
export function justificationFacts(ctx: ProcurementCanonicalContext): DFDJustificationFacts {
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    objeto: s(ctx.process.object.value),
    orgao: s(ctx.organization.name.value),
    localidade: s(ctx.organization.location.value),
    unidadeDemandante: s(ctx.demand.requestingUnit.value),
    planejamento: s(ctx.planning.pcaAlignment.value),
    prioridade: s(ctx.planning.priority.value),
    itens: ctx.items.filter((i) => i.description.value !== null).map((i) => ({
      descricao: String(i.description.value), unidade: String(i.unit.value ?? "UN"),
      quantidadePrevista: i.plannedQuantity.status === "conflict" || i.plannedQuantity.value === null ? null : formatQuantity(i.plannedQuantity.value),
    })),
  };
}

export function buildJustificationPrompt(facts: DFDJustificationFacts): string {
  const lines = [
    "Tarefa: redigir o RASCUNHO da seção \"Justificativa da necessidade da contratação\" de um DFD",
    "(Documento de Formalização da Demanda, art. 12, §1º, e art. 18, I, da Lei 14.133/2021).",
    "",
    "Regras obrigatórias:",
    "- Use SOMENTE os fatos abaixo. Não invente fatos, quantidades, prazos, valores, orçamento, fundamento legal específico ou decisão administrativa.",
    "- Não escreva números de quantidade, valores monetários ou datas. As quantidades e valores já constam em outras seções do DFD.",
    "- Onde faltar informação necessária, escreva [REVISAR: descrever …] em vez de supor.",
    "- Texto corrido em português formal, 2 a 4 parágrafos, sem títulos, sem listas e sem markdown.",
    "- Este texto é um RASCUNHO que será revisado e aprovado por um servidor público.",
    "",
    "Fatos do processo:",
    `- Objeto: ${facts.objeto ?? "[não informado]"}`,
    `- Órgão: ${facts.orgao ?? "[não informado]"}${facts.localidade ? ` (${facts.localidade})` : ""}`,
    `- Setor/unidade demandante: ${facts.unidadeDemandante ?? "[não informado]"}`,
    `- Previsão no planejamento (PCA): ${facts.planejamento ?? "[não informado]"}`,
    `- Grau de prioridade: ${facts.prioridade ?? "[não informado]"}`,
    `- Itens: ${facts.itens.length ? facts.itens.map((i) => `${i.descricao} (${i.unidade})`).join("; ") : "[não informados]"}`,
  ];
  return lines.join("\n");
}

const NUMBER_RE = /(?<![\p{L}\d])(\d[\d.,]*\d|\d)(?![\p{L}\d])/gu;

/**
 * Guarda determinística: todo número na saída que não aparece nos fatos autorizados (nem nas referências
 * normativas do próprio prompt) é marcado para revisão — nunca aceito como fato.
 */
export function guardJustificationOutput(text: string, facts: DFDJustificationFacts): { text: string; unverifiedNumbers: string[] } {
  const allowedSource = [
    buildJustificationPrompt(facts),
    ...facts.itens.map((i) => i.quantidadePrevista ?? ""),
  ].join(" ");
  const allowed = new Set((allowedSource.match(NUMBER_RE) ?? []).map(normNum));
  const unverified: string[] = [];
  // Trechos já marcados como [REVISAR: …] ficam intactos; o resto é verificado número a número.
  const guarded = text.split(/(\[REVISAR:[^\]]*\])/).map((seg) => (seg.startsWith("[REVISAR:") ? seg
    : seg.replace(NUMBER_RE, (tok: string) => {
      if (allowed.has(normNum(tok))) return tok;
      unverified.push(tok);
      return `[REVISAR: ${tok}]`;
    }))).join("");
  return { text: guarded, unverifiedNumbers: [...new Set(unverified)] };
}

function normNum(s: string): string {
  return s.replace(/[.,]$/, "");
}

export interface DFDJustificationDraft {
  text: string;
  executionId: string;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  contextDigest: string;
  inputDigest: string;
  unverifiedNumbers: string[];
  replayed: boolean;
}

export async function generateDFDJustificationText(p: {
  organizationId: number; processId: string; ctx: ProcurementCanonicalContext;
  correlationId: string; actorUserId: number; idempotencyKey: string;
  /** Seam de teste (mesmo padrão do structuredAuthoringService): substitui a chamada ao engine. */
  invoke?: (prompt: string) => Promise<string>;
}): Promise<DFDJustificationDraft> {
  const facts = justificationFacts(p.ctx);
  const prompt = buildJustificationPrompt(facts);
  const inputDigest = canonicalDigest({ v: DFD_JUSTIFICATION_PROMPT_VERSION, ctx: p.ctx.digest, prompt });
  let raw = "";
  let executionId = `seam-${inputDigest.slice(0, 16)}`;
  let provider: string | null = null;
  let model: string | null = null;
  let replayed = false;
  if (p.invoke) {
    raw = await p.invoke(prompt);
  } else {
    const execution = await executeCognitiveTask({
      task: "GENERATE_DOCUMENT", tenantId: p.organizationId, userId: String(p.actorUserId),
      correlationId: p.correlationId, businessDomain: DOMAIN, processId: p.processId, stage: "DFD",
      query: prompt, responseType: "text", maxOutputTokens: 2048,
      idempotencyKey: `dfdj:${p.idempotencyKey}`.slice(0, 64), actorUserId: p.actorUserId,
    });
    raw = execution.response.content ?? "";
    executionId = execution.context.id;
    provider = execution.response.provider ?? null;
    model = execution.response.model ?? null;
    replayed = execution.replayed === true;
  }
  const cleaned = raw.replace(/^#+\s.*$/gm, "").replace(/\*\*/g, "").trim();
  const { text, unverifiedNumbers } = guardJustificationOutput(cleaned, facts);
  return {
    text, executionId, provider, model, promptVersion: DFD_JUSTIFICATION_PROMPT_VERSION,
    contextDigest: p.ctx.digest, inputDigest, unverifiedNumbers, replayed,
  };
}
