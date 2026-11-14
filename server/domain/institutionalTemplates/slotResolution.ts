/**
 * E2 — RESOLUÇÃO HUMANA de trecho pendente (slot de IA sem narrativa) de documento composto por modelo. Pura e determinística.
 *
 * Sem narrativa supervisionada, o composer deixa no texto o marcador `PENDING_AI_SLOT_MARK(slotKey)`. Apagar o marcador NÃO é revisão:
 * a emissão exige, para cada slot pendente do texto composto (M1), uma RESOLUÇÃO HUMANA registrada no ledger existente
 * (`institutional_decisions`, assunto do M1) e coerente com o conteúdo emitido:
 *  - `HUMAN_TEXT`    — a pessoa redigiu o trecho; o ledger guarda o hash do texto e âncoras (prefixo/sufixo) que o localizam;
 *  - `DECLARED_NONE` — a pessoa declarou que não há conteúdo adicional; só em slots ELEGÍVEIS (política versionada abaixo), só quando o
 *    slot é um parágrafo próprio, e o texto do documento é a frase FIXA da política (nunca texto livre nem conteúdo jurídico obrigatório).
 * Qualquer alteração posterior do trecho (ou das âncoras) torna a resolução DESATUALIZADA (`STALE`) — a emissão bloqueia até nova resolução.
 * Nada aqui grava, lê banco ou relógio; quem registra é o serviço (`slotResolutionService`), quem confere é a revalidação.
 */
import { sha256Hex } from "../canonicalJson";
import { isSha256, type OrgId, type Sha256 } from "./types";

/** Formato do registro de resoluções no M2 (campo opcional versionado; M2 anteriores não o têm e continuam válidos). */
export const SLOT_RESOLUTION_FORMAT_VERSION = "tpl-slot-resolution/1" as const;
/** Versão da política de elegibilidade/frases de `DECLARED_NONE` (registrada na evidência e no M2). */
export const SLOT_RESOLUTION_POLICY_VERSION = "tpl-slot-policy/1" as const;

export const SLOT_RESOLUTION_TYPES = ["HUMAN_TEXT", "DECLARED_NONE"] as const;
export type SlotResolutionType = (typeof SLOT_RESOLUTION_TYPES)[number];

export const SLOT_KEY_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
/** Limites do texto redigido (bytes de documento, não de prompt): mínimo útil e teto defensivo. */
export const SLOT_TEXT_MIN = 3;
export const SLOT_TEXT_MAX = 8000;
/** Tamanho máximo de cada âncora (prefixo/sufixo) capturada em volta do trecho. */
export const SLOT_ANCHOR_MAX = 96;

interface SlotPolicy {
  readonly label: string;
  /** Frase fixa de `DECLARED_NONE`; `null` ⇒ o slot exige redação (justificativa/conteúdo obrigatório). */
  readonly declaredNoneText: string | null;
}

/**
 * Política versionada por slot (governança da PLATAFORMA, não ato do órgão). Só as obrigações ESPECÍFICAS adicionais admitem
 * "não há conteúdo adicional": as cláusulas gerais já existem no modelo. Justificativas (vedações, art. 49 da LC 123/2006) e finalidades do
 * tratamento de dados são conteúdo exigido pelo próprio texto do modelo ("pelas razões…", "para as seguintes finalidades:") — nunca dispensáveis.
 * Slot fora da lista: rótulo = chave e `DECLARED_NONE` indisponível (fail-closed).
 */
const SLOT_POLICIES: Readonly<Record<string, SlotPolicy>> = {
  "obrigacoes-especificas-contratado": {
    label: "Obrigações específicas do contratado",
    declaredNoneText: "Não há obrigações específicas adicionais do CONTRATADO além das previstas nesta cláusula.",
  },
  "obrigacoes-especificas-contratante": {
    label: "Obrigações específicas do contratante",
    declaredNoneText: "Não há obrigações específicas adicionais do CONTRATANTE além das previstas nesta cláusula.",
  },
  "justificativa-vedacao-subcontratacao": { label: "Razões da vedação à subcontratação", declaredNoneText: null },
  "justificativa-vedacao-consorcio": { label: "Razões da vedação à participação em consórcio", declaredNoneText: null },
  "justificativa-art49-lc123": { label: "Razões da não aplicação dos benefícios da LC 123/2006 (art. 49)", declaredNoneText: null },
  "finalidades-tratamento-dados": { label: "Finalidades do tratamento de dados pessoais", declaredNoneText: null },
};

export function slotPolicy(slotKey: string): { readonly label: string; readonly declaredNoneText: string | null } {
  return SLOT_POLICIES[slotKey] ?? { label: slotKey, declaredNoneText: null };
}

/**
 * Marcador do slot pendente — MESMO texto de `PENDING_AI_SLOT_MARK` (composerShared; igualdade coberta por teste). Definido aqui para não
 * criar ciclo de import manifest → slotResolution → composerShared → manifest.
 */
export const pendingSlotMark = (slotKey: string): string => `[REVISAR: narrativa "${slotKey}" pendente de redação supervisionada]`;

/** Slots pendentes no texto COMPOSTO, na ordem de aparição e sem repetição (o marcador é o contrato do composer). */
const PENDING_SLOT_RE = /\[REVISAR: narrativa "([a-z0-9][a-z0-9-]{0,79})" pendente de redação supervisionada\]/g;
export function pendingSlotKeys(composedText: string): string[] {
  const out: string[] = [];
  for (const m of composedText.matchAll(PENDING_SLOT_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Ocorrências não sobrepostas (0 para agulha vazia). */
function occurrences(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

/** O trecho [start, end) é um parágrafo próprio (bloco entre linhas em branco ou nas bordas do texto)? */
export function isStandaloneSegment(text: string, start: number, end: number): boolean {
  const before = start === 0 || text.slice(Math.max(0, start - 2), start) === "\n\n";
  const after = end === text.length || text.slice(end, end + 2) === "\n\n";
  return before && after;
}

/**
 * Âncoras do trecho [start, end): até `SLOT_ANCHOR_MAX` caracteres antes/depois, cortadas em qualquer OUTRO marcador `[REVISAR` (a resolução
 * de um slot vizinho não pode desatualizar esta).
 */
export function captureAnchors(text: string, start: number, end: number): { prefix: string; suffix: string } {
  let prefix = text.slice(Math.max(0, start - SLOT_ANCHOR_MAX), start);
  const lastMarker = prefix.lastIndexOf("[REVISAR");
  if (lastMarker !== -1) {
    const close = prefix.indexOf("]", lastMarker);
    prefix = close === -1 ? "" : prefix.slice(close + 1);
  }
  let suffix = text.slice(end, end + SLOT_ANCHOR_MAX);
  const nextMarker = suffix.indexOf("[REVISAR");
  if (nextMarker !== -1) suffix = suffix.slice(0, nextMarker);
  return { prefix, suffix };
}

/**
 * Localiza o trecho entre as âncoras. Prefixo precisa ocorrer UMA vez (ambiguidade ⇒ não localizado); o sufixo é a primeira ocorrência após
 * o prefixo. Âncora vazia = borda do texto. `null` ⇒ não localizado (falha fechada).
 */
export function locateSegment(text: string, prefix: string, suffix: string): { start: number; end: number; text: string } | null {
  let start = 0;
  if (prefix) {
    const hits = occurrences(text, prefix);
    if (hits.length !== 1) return null;
    start = hits[0] + prefix.length;
  }
  let end = text.length;
  if (suffix) {
    end = text.indexOf(suffix, start);
    if (end === -1) return null;
  }
  return { start, end, text: text.slice(start, end) };
}

/** Tamanho máximo do entorno exibido ao servidor (antes/depois do trecho). */
export const SLOT_CONTEXT_BEFORE_MAX = 240;
export const SLOT_CONTEXT_AFTER_MAX = 160;

/**
 * Entorno do trecho [start, end) no documento, para a pessoa ver ONDE e COMO o texto entra (só apresentação; não participa de nenhuma regra):
 *  - antes: do início do parágrafo até o trecho; trecho que é parágrafo próprio mostra o parágrafo anterior;
 *  - depois: do fim do trecho até o fim do parágrafo; trecho que é parágrafo próprio mostra o parágrafo seguinte.
 * Recortes limitados (com "…" quando truncados). Marcadores de OUTROS trechos permanecem visíveis como estão no texto.
 */
export function slotContext(text: string, start: number, end: number): { before: string; after: string } {
  const paraStart = text.lastIndexOf("\n\n", start - 1);
  let before = text.slice(paraStart === -1 ? 0 : paraStart + 2, start);
  if (!before.trim()) {
    const prevEnd = paraStart === -1 ? 0 : paraStart;
    const prevStart = text.lastIndexOf("\n\n", prevEnd - 1);
    before = prevEnd > 0 ? text.slice(prevStart === -1 ? 0 : prevStart + 2, prevEnd) : "";
  }
  const paraEnd = text.indexOf("\n\n", end);
  let after = text.slice(end, paraEnd === -1 ? text.length : paraEnd);
  if (!after.trim() && paraEnd !== -1) {
    const nextEnd = text.indexOf("\n\n", paraEnd + 2);
    after = text.slice(paraEnd + 2, nextEnd === -1 ? text.length : nextEnd);
  }
  const cutBefore = before.length > SLOT_CONTEXT_BEFORE_MAX ? `…${before.slice(-SLOT_CONTEXT_BEFORE_MAX).trimStart()}` : before.trimStart();
  const cutAfter = after.length > SLOT_CONTEXT_AFTER_MAX ? `${after.slice(0, SLOT_CONTEXT_AFTER_MAX).trimEnd()}…` : after.trimEnd();
  return { before: cutBefore, after: cutAfter };
}

/** Normalização do texto redigido (quebras de linha LF, bordas sem espaço). */
export const normalizeSlotText = (text: string): string => text.replace(/\r\n?/g, "\n").trim();

export type SlotTextIssue = "TEXT_TOO_SHORT" | "TEXT_TOO_LONG" | "TEXT_HAS_MARKER" | "TEXT_INLINE_MULTILINE";

/** Regras do texto `HUMAN_TEXT` (sobre o texto já normalizado). Trecho em linha não admite quebra de linha (quebraria a frase do modelo). */
export function slotTextIssue(normalized: string, standalone: boolean): SlotTextIssue | null {
  if (normalized.replace(/\s/g, "").length < SLOT_TEXT_MIN) return "TEXT_TOO_SHORT";
  if (normalized.length > SLOT_TEXT_MAX) return "TEXT_TOO_LONG";
  if (/\[REVISAR/i.test(normalized)) return "TEXT_HAS_MARKER";
  if (!standalone && normalized.includes("\n")) return "TEXT_INLINE_MULTILINE";
  return null;
}

export type SlotResolutionPlan =
  | { readonly ok: true; readonly content: string; readonly text: string; readonly textHash: Sha256; readonly prefix: string; readonly suffix: string; readonly changed: boolean }
  | { readonly ok: false; readonly field: "slotKey" | "resolution" | "text" | "slot"; readonly reason: string };

const TEXT_MESSAGES: Readonly<Record<SlotTextIssue, string>> = {
  TEXT_TOO_SHORT: "redija o conteúdo do trecho (texto vazio não resolve a pendência)",
  TEXT_TOO_LONG: "texto acima do limite do trecho",
  TEXT_HAS_MARKER: "o texto não pode conter marcador [REVISAR]",
  TEXT_INLINE_MULTILINE: "este trecho completa uma frase do modelo: redija em um único parágrafo, sem quebra de linha",
};

/**
 * Calcula a resolução sobre o rascunho ATUAL (o servidor localiza o trecho; nunca posição enviada pelo cliente):
 *  - primeira resolução: o marcador do slot (exatamente uma ocorrência);
 *  - nova resolução: o trecho da última resolução, pelas âncoras dela (`previous`).
 * Devolve o conteúdo resultante, o texto exato do trecho, o hash e as âncoras — que precisam localizar o trecho de volta no resultado.
 */
/**
 * Qualidade documental F1 — pontuação do trecho EM LINHA. O modelo publicado já traz a pontuação da frase logo após o trecho
 * (ex.: "…pelas razões constantes do processo: ▢."). Se a redação termina com ponto, o ponto da pessoa e o do modelo se
 * UNIFICAM (um único ponto), em vez de produzir "..". Vale também para abreviação ("etc.") e reticências ("..."), que mantêm
 * a grafia correta. "?" e "!" nunca são removidos. Trecho em parágrafo próprio não é tocado. Pura; determinística.
 */
export function mergeInlineTerminalPeriod(text: string, standalone: boolean, followingChar: string | undefined): string {
  if (standalone || followingChar !== "." || !text.endsWith(".")) return text;
  return text.slice(0, -1).trimEnd();
}

/** Hashes aceitos para a MESMA redação informada (com e sem a unificação do ponto) — replay idempotente da resolução. */
export function slotTextHashCandidates(text: string): string[] {
  const n = normalizeSlotText(text);
  return n.endsWith(".") ? [sha256Hex(n), sha256Hex(n.slice(0, -1).trimEnd())] : [sha256Hex(n)];
}

export function planSlotResolution(input: {
  readonly content: string;
  readonly slotKey: string;
  readonly resolution: SlotResolutionType;
  readonly text?: string;
  readonly previous: SlotResolutionRecord | null;
}): SlotResolutionPlan {
  if (!SLOT_KEY_RE.test(input.slotKey)) return { ok: false, field: "slotKey", reason: "trecho inválido" };
  if (!(SLOT_RESOLUTION_TYPES as readonly string[]).includes(input.resolution)) return { ok: false, field: "resolution", reason: "tipo de resolução inválido" };
  const current = input.content;
  const mark = pendingSlotMark(input.slotKey);
  const hits = occurrences(current, mark);
  let start: number, end: number;
  if (hits.length === 1) {
    start = hits[0]; end = start + mark.length;
  } else if (hits.length > 1) {
    return { ok: false, field: "slot", reason: "o marcador deste trecho aparece mais de uma vez no texto — mantenha apenas um no editor e tente novamente" };
  } else {
    const seg = input.previous ? locateSegment(current, input.previous.prefix, input.previous.suffix) : null;
    if (!seg) return { ok: false, field: "slot", reason: `trecho não localizado no texto atual: reinsira o marcador ${mark} no ponto do trecho, salve e registre novamente` };
    ({ start, end } = seg);
  }
  const policy = slotPolicy(input.slotKey);
  const standalone = isStandaloneSegment(current, start, end);
  let text: string;
  if (input.resolution === "DECLARED_NONE") {
    if ((input.text ?? "").trim()) return { ok: false, field: "text", reason: "a declaração de ausência de conteúdo não leva texto livre" };
    if (!policy.declaredNoneText || !standalone) return { ok: false, field: "resolution", reason: `o trecho "${policy.label}" exige redação: não admite declarar ausência de conteúdo` };
    text = policy.declaredNoneText;
  } else {
    text = normalizeSlotText(input.text ?? "");
    const why = slotTextIssue(text, standalone);
    if (why) return { ok: false, field: "text", reason: TEXT_MESSAGES[why] };
    text = mergeInlineTerminalPeriod(text, standalone, current[end]);
    const whyAfter = slotTextIssue(text, standalone);   // o mínimo vale para o texto efetivamente inserido
    if (whyAfter) return { ok: false, field: "text", reason: TEXT_MESSAGES[whyAfter] };
  }
  const next = current.slice(0, start) + text + current.slice(end);
  const anchors = captureAnchors(next, start, start + text.length);
  const back = locateSegment(next, anchors.prefix, anchors.suffix);
  if (!back || back.start !== start || back.text !== text) {
    return { ok: false, field: "slot", reason: "não foi possível ancorar o trecho no texto (entorno repetido) — ajuste o texto ao redor do trecho no editor e tente novamente" };
  }
  return { ok: true, content: next, text, textHash: sha256Hex(text), prefix: anchors.prefix, suffix: anchors.suffix, changed: next !== current };
}

/** Resolução humana registrada (projeção do ledger; ver `reviewAdapter.listSlotResolutions`). */
export interface SlotResolutionRecord {
  readonly organizationId: OrgId;
  readonly manifestId: string;
  readonly slotKey: string;
  readonly resolution: SlotResolutionType;
  /** sha256 do trecho resolvido (texto exato do documento). */
  readonly textHash: Sha256;
  readonly prefix: string;
  readonly suffix: string;
  readonly policyVersion: string;
  /** Id da decisão no ledger (`institutional_decisions.id`) e a revisão dela no assunto. */
  readonly decisionRef: string;
  readonly revision: number;
  /** Usuário autenticado que registrou (`recordedByUserId`). */
  readonly resolvedByUserId: number;
  readonly resolvedByName?: string;
  readonly decidedAt?: string;
}

export type SlotState = "PENDING" | "RESOLVED" | "STALE";

export interface SlotResolutionCheck {
  readonly slotKey: string;
  readonly label: string;
  readonly state: SlotState;
  /** Motivo legível quando PENDING/STALE. */
  readonly reason: string | null;
  /** O slot admite "não há conteúdo adicional" (política + parágrafo próprio no texto composto). */
  readonly declaredNoneAllowed: boolean;
  readonly record: SlotResolutionRecord | null;
  /** Trecho atual localizado pelas âncoras da última resolução (para reapresentar ao servidor), quando houver. */
  readonly currentText: string | null;
}

/** Última resolução válida em forma (maior revisão) por slot do M1 exato. Registros de outro órgão/M1 ou sem autor humano são ignorados. */
export function latestSlotResolutions(organizationId: OrgId, manifestId: string, records: readonly SlotResolutionRecord[]): Map<string, SlotResolutionRecord> {
  const out = new Map<string, SlotResolutionRecord>();
  for (const r of records) {
    if (r.organizationId !== organizationId || r.manifestId !== manifestId) continue;
    if (!SLOT_KEY_RE.test(r.slotKey) || !(SLOT_RESOLUTION_TYPES as readonly string[]).includes(r.resolution) || !isSha256(r.textHash)) continue;
    if (!Number.isSafeInteger(r.resolvedByUserId) || r.resolvedByUserId <= 0 || !r.decisionRef || !Number.isSafeInteger(r.revision) || r.revision < 1) continue;
    const prev = out.get(r.slotKey);
    if (!prev || r.revision > prev.revision) out.set(r.slotKey, r);
  }
  return out;
}

/**
 * Estado de cada slot pendente do texto COMPOSTO frente ao conteúdo atual/a emitir. Fonte ÚNICA da regra: a emissão (revalidação) e a
 * inspeção da UI usam esta função.
 */
export function evaluateSlotResolutions(input: {
  readonly organizationId: OrgId;
  readonly manifestId: string;
  readonly composedText: string;
  readonly issuedContent: string;
  readonly resolutions: readonly SlotResolutionRecord[];
}): SlotResolutionCheck[] {
  const latest = latestSlotResolutions(input.organizationId, input.manifestId, input.resolutions);
  return pendingSlotKeys(input.composedText).map((slotKey): SlotResolutionCheck => {
    const policy = slotPolicy(slotKey);
    const mark = pendingSlotMark(slotKey);
    const at = input.composedText.indexOf(mark);
    const declaredNoneAllowed = policy.declaredNoneText !== null && at !== -1 && isStandaloneSegment(input.composedText, at, at + mark.length);
    const record = latest.get(slotKey) ?? null;
    const base = { slotKey, label: policy.label, declaredNoneAllowed, record };
    // Marcador presente ⇒ PENDENTE, haja ou não resolução anterior (ex.: a minuta voltou a um M1 já resolvido): o registro só informa a revisão (CAS).
    if (input.issuedContent.includes(mark)) return { ...base, state: "PENDING", reason: "trecho pendente de redação ou declaração humana", currentText: null };
    if (!record) {
      return { ...base, state: "PENDING", reason: "o marcador foi removido do texto sem resolução registrada — registre a redação do trecho pelo painel de revisão", currentText: null };
    }
    const seg = locateSegment(input.issuedContent, record.prefix, record.suffix);
    if (!seg) return { ...base, state: "STALE", reason: "o trecho resolvido não foi localizado no texto atual (o entorno foi alterado) — registre novamente", currentText: null };
    if (record.resolution === "DECLARED_NONE") {
      const ok = declaredNoneAllowed && seg.text === policy.declaredNoneText && record.textHash === sha256Hex(seg.text);
      return ok
        ? { ...base, state: "RESOLVED", reason: null, currentText: seg.text }
        : { ...base, state: "STALE", reason: "a declaração de ausência de conteúdo não corresponde mais ao texto — registre novamente", currentText: seg.text };
    }
    return sha256Hex(seg.text) === record.textHash && seg.text.trim().length > 0 && !seg.text.includes("[REVISAR")
      ? { ...base, state: "RESOLVED", reason: null, currentText: seg.text }
      : { ...base, state: "STALE", reason: "o texto do trecho foi alterado após a resolução — registre a redação atual", currentText: seg.text };
  });
}

/** Referência gravada no M2 por slot resolvido (forma estável, em ordem determinística por `slotKey`). */
export interface SlotResolutionRef {
  readonly slotKey: string;
  readonly resolution: SlotResolutionType;
  readonly decisionRef: string;
  readonly revision: number;
  readonly textHash: Sha256;
  readonly resolvedByUserId: number;
  readonly policyVersion: string;
}

export interface SlotResolutionsRecord {
  readonly formatVersion: typeof SLOT_RESOLUTION_FORMAT_VERSION;
  readonly items: readonly SlotResolutionRef[];
}

export function slotResolutionRefs(checks: readonly SlotResolutionCheck[]): SlotResolutionRef[] {
  return checks
    .filter((c) => c.state === "RESOLVED" && c.record)
    .map((c) => ({
      slotKey: c.slotKey, resolution: c.record!.resolution, decisionRef: c.record!.decisionRef, revision: c.record!.revision,
      textHash: c.record!.textHash, resolvedByUserId: c.record!.resolvedByUserId, policyVersion: c.record!.policyVersion,
    }))
    .sort((a, b) => (a.slotKey < b.slotKey ? -1 : a.slotKey > b.slotKey ? 1 : 0));
}

/** Problemas estruturais do registro versionado do M2 (vazio = válido). */
export function slotResolutionsRecordIssues(r: SlotResolutionsRecord): string[] {
  const out: string[] = [];
  if (r.formatVersion !== SLOT_RESOLUTION_FORMAT_VERSION) out.push(`formato desconhecido: ${String(r.formatVersion)}`);
  if (!Array.isArray(r.items) || r.items.length === 0) out.push("registro de resoluções sem itens (omitir quando vazio)");
  (r.items ?? []).forEach((it, i) => {
    if (!SLOT_KEY_RE.test(it.slotKey) || !(SLOT_RESOLUTION_TYPES as readonly string[]).includes(it.resolution) || !it.decisionRef || !isSha256(it.textHash)
      || !Number.isSafeInteger(it.revision) || it.revision < 1 || !Number.isSafeInteger(it.resolvedByUserId) || it.resolvedByUserId <= 0 || !it.policyVersion) {
      out.push(`items[${i}] incompleto`);
    }
    if (i > 0 && r.items[i - 1].slotKey >= it.slotKey) out.push(`items[${i}] fora da ordem determinística por slotKey`);
  });
  return out;
}
