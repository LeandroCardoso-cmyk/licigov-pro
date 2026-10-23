/**
 * DFD — RASCUNHO SUPERVISIONADO da "Justificativa da necessidade" (seção 2), único campo narrativo do DFD
 * que exige elaboração textual. Fatos (objeto, unidade, itens, quantidades, valores) NÃO passam por IA:
 * vêm deterministicamente do Contexto Canônico (dfdPrefill.ts).
 *
 * Governança:
 *  - chamada EXCLUSIVAMENTE via AIExecutionEngine (`executeCognitiveTask`) — nunca provider direto;
 *  - contexto GOVERNADO: só fatos canônicos resolvidos (sem preços, sem dados pessoais, sem valores);
 *  - saída é RASCUNHO: nunca decisão, nunca aprovação, nunca documento oficial;
 *  - guarda determinística: número citado pela IA que o processo não confirma vira lacuna — a frase sai do texto
 *    e a lacuna é listada ao servidor (homologação visual M8; nunca escondida)
 *    (a IA não inventa quantidade, prazo, orçamento ou fundamento);
 *  - explicabilidade: executionId, provider/modelo, versão do prompt, digest do contexto e do input.
 *  - M8-AI-DFD-001: CONTRATO DE SAÍDA estruturado (`dfdJustificationContract.ts`) — conteúdo documental, lacunas e
 *    avisos SEPARADOS; metadado de geração/autoavaliação/lista de fatos nunca chega ao documento; saída fora do
 *    contrato é validada parágrafo a parágrafo; nada documental ⇒ sem sugestão (fallback seguro).
 */
import { createHash } from "crypto";
import { executeCognitiveTask } from "../aiExecutionEngine";
import { canonicalDigest } from "../../domain/canonicalJson";
import type { ProcurementCanonicalContext } from "../../domain/canonicalProcurementContext";
import { formatQuantity } from "../../domain/dfdPrefill";
import {
  DFD_JUSTIFICATION_RESPONSE_SCHEMA, interpretJustificationOutput, moveInlineGapsOutOfText, type JustificationContractResult,
} from "../../domain/dfdJustificationContract";

export const DFD_JUSTIFICATION_PROMPT_VERSION = "dfd-justificativa/3";
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
    "- Onde faltar informação necessária, NÃO a suponha: registre-a em \"lacunas\" e escreva os parágrafos só com o que os fatos sustentam (sem marcadores no texto).",
    "- Não presuma motivação, problemas atuais (ex.: equipamentos obsoletos, falhas, demanda reprimida), impactos ou benefícios que não constem dos fatos; se a motivação específica não estiver nos fatos, ela é uma lacuna.",
    "- Texto corrido em português formal, 2 a 4 parágrafos, sem títulos, sem listas e sem markdown.",
    "- Este texto é um RASCUNHO que será revisado e aprovado por um servidor público.",
    "",
    "Formato da resposta (obrigatório): um objeto JSON com exatamente três campos:",
    "- \"paragrafos\": lista com os parágrafos do texto que irá para o documento — SOMENTE o conteúdo documental;",
    "- \"lacunas\": lista das informações factuais ausentes que o servidor precisa completar;",
    "- \"avisos\": lista de ressalvas ao revisor humano.",
    "Nunca coloque nos parágrafos: pontuação ou grau de confiança, lista dos fatos utilizados, comentários sobre a tarefa,",
    "explicações sobre como o texto foi gerado, títulos de seção ou numeração.",
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
  /** Somente o conteúdo DOCUMENTAL validado (parágrafos), já com a guarda de números. */
  text: string;
  /** Lacunas factuais e avisos ao revisor — apresentados FORA do documento. */
  gaps: string[];
  warnings: string[];
  /** Interpretação da saída: contrato estruturado ou validação de texto fora do contrato. */
  outputContract: JustificationContractResult["contract"];
  contractVersion: string;
  /** Motivos (sem conteúdo) dos trechos descartados por não serem documentais — observabilidade. */
  discardedReasons: string[];
  /** Frases retiradas do texto por dependerem de lacuna (listadas em `gaps`). */
  movedToGaps: number;
  executionId: string;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  contextDigest: string;
  inputDigest: string;
  unverifiedNumbers: string[];
  replayed: boolean;
}

/** Limite da coluna de lineage da chave de idempotência cognitiva (`ai_executions.idempotencyKey`). */
const AI_EXECUTION_KEY_MAX = 64;
const HASHED_KEY_PREFIX = "dfdj:h1:";

/**
 * R10 / SEM-089 — chave de idempotência da execução cognitiva da justificativa do DFD, COLISION-RESISTANT.
 * Antes: `dfdj:${key}`.slice(0, 64) — chaves longas com o mesmo prefixo colidiam (duas operações distintas viravam a mesma
 * execução/replay). Agora:
 *  - chave que CABE (`dfdj:` + chave ≤ 64) e não imita o formato hasheado ⇒ inalterada (compatível: as execuções já gravadas com
 *    chaves curtas continuam encontráveis, nenhuma linha é reescrita);
 *  - caso contrário ⇒ `dfdj:h1:` + SHA-256 COMPLETO (base64url, 43 chars) da chave inteira — sem truncar o conteúdo semântico.
 */
export function dfdJustificationExecutionKey(clientKey: string): string {
  const plain = `dfdj:${clientKey}`;
  if (plain.length <= AI_EXECUTION_KEY_MAX && !plain.startsWith(HASHED_KEY_PREFIX)) return plain;
  return `${HASHED_KEY_PREFIX}${createHash("sha256").update(clientKey, "utf8").digest("base64url")}`;
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
      query: prompt, responseType: "text", maxOutputTokens: 2048, responseSchema: DFD_JUSTIFICATION_RESPONSE_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
      idempotencyKey: dfdJustificationExecutionKey(p.idempotencyKey), actorUserId: p.actorUserId,
    });
    raw = execution.response.content ?? "";
    executionId = execution.context.id;
    provider = execution.response.provider ?? null;
    model = execution.response.model ?? null;
    replayed = execution.replayed === true;
  }
  // Validação ANTES da apresentação: só parágrafos documentais seguem; a guarda de números roda apenas neles
  // (números de metadados — "confiança 0.85", "fatos 1, 3" — nunca chegam ao documento).
  const out = interpretJustificationOutput(raw);
  const guarded = out.paragraphs.map((para) => guardJustificationOutput(para, facts));
  // Frases que dependem de lacuna (marcador da IA ou número não confirmado) saem do texto e viram lacunas listadas.
  const moved = moveInlineGapsOutOfText(guarded.map((g) => g.text));
  const gaps = [...out.gaps];
  for (const g of moved.gaps) if (!gaps.includes(g)) gaps.push(g);
  return {
    text: moved.paragraphs.join("\n\n"),
    gaps, warnings: [...out.warnings], outputContract: out.contract, contractVersion: out.contractVersion,
    discardedReasons: out.discarded.map((d) => d.reason), movedToGaps: moved.movedSentences,
    executionId, provider, model, promptVersion: DFD_JUSTIFICATION_PROMPT_VERSION,
    contextDigest: p.ctx.digest, inputDigest, unverifiedNumbers: [...new Set(guarded.flatMap((g) => g.unverifiedNumbers))], replayed,
  };
}
