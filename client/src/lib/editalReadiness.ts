/**
 * "Prontidão" da Preparação do Edital institucional (UX): view-model PURO derivado do estado que a API já entrega.
 * NÃO é uma segunda engine de readiness e NÃO cria autoridade: apenas reagrupa, conta e ordena (sem React/rede, sem persistir nada).
 *
 * Ordem de leitura (progressão numa única tela):
 *   1. TR oficial exato  →  2. configuração única do órgão  →  3. dados a corrigir na ORIGEM  →  4. decisões DESTE certame.
 * Enquanto algum pré-requisito (1–3) bloqueia a composição, as decisões (4) ficam RECOLHIDAS por padrão — nunca escondidas:
 * a pessoa pode abrir e ler a qualquer momento (a persistência segue as regras atuais).
 *
 * Vocabulário único da superfície principal (os detalhes técnicos mostram a decomposição):
 *   AUTO_RESOLVED_TOTAL                    campos com valor efetivo JÁ disponível para a composição, qualquer fonte não-humana-do-certame
 *                                          (cadastro/processo/DFD/ETP/itens/pesquisa/TR/perfil do órgão/plataforma/padrões/cronograma derivado).
 *                                          NÃO conta: condicionais ocultos, pós-homologação, campos do sistema atribuídos só na emissão,
 *                                          nem decisões humanas do certame (essas são DECIDED).
 *   ORIGIN_ACTION_REQUIRED_TOTAL           informações que NÃO se digitam no Edital e precisam ser corrigidas na autoridade de origem
 *                                          (+ o TR oficial exato, quando não selecionado; + parâmetros do TR a confirmar, quando o TR é válido).
 *   ONE_TIME_CONFIGURATION_REQUIRED_TOTAL  itens do Perfil institucional NECESSÁRIOS a ESTE Edital (configurar uma única vez).
 *   PROCESS_DECISIONS_TOTAL                campos editáveis cuja autoridade pertence ao certame atual (CertameConfig/Cronograma + condicionais ativos).
 */
import {
  fixAction, livePendingItems, liveStatuses, sourceIssues, trParamsPending,
  type EntryPoint, type FieldStatus, type FixAction, type PendingItem, type PreparationStateView, type PrepField, type SectionEdits,
} from "./editalPreparation";

export type ReadinessCategory =
  | "READY"
  | "ACTION_REQUIRED_AT_ORIGIN"
  | "ONE_TIME_CONFIGURATION_REQUIRED"
  | "PROCESS_DECISIONS_REQUIRED"
  | "BLOCKING_OFFICIAL_SOURCE_REQUIRED";

export type ReadinessStepKey = "TR_OFFICIAL" | "ONE_TIME_CONFIG" | "ORIGIN" | "PROCESS_DECISIONS";

/** Código estável (fail closed) do TR: o Edital institucional exige versão oficial EXATA — nunca latest, rascunho ou heurística. */
export const TR_OFFICIAL_EXACT_REQUIRED = "TR_OFFICIAL_EXACT_REQUIRED";
export const TR_OFFICIAL_EXACT_MESSAGE = "O Edital institucional exige uma versão oficial e exata do TR.";
/** Âncora (navegação interna, sem escrita) da seleção do TR oficial exato. */
export const TR_SELECTION_ANCHOR = "edital-tr-oficial";
export const READINESS_ANCHOR = "edital-prontidao";

/** Origem legível de cada ponto de entrada (onde o dado é resolvido). */
export const ORIGIN_LABEL: Record<EntryPoint, string> = {
  NONE: "Origem do dado",
  TR_SECTION: "Termo de Referência",
  ORG_PROFILE: "Perfil de Licitações",
  PLATFORM_PROFILE: "Perfil da plataforma",
  ITEMS: "Itens da contratação",
  PRICE_RESEARCH: "Pesquisa de Preços",
  ORG_REGISTRY: "Cadastro do órgão",
  REQUESTING_UNIT: "Contexto do processo (unidade requisitante)",
  CERTAME_CONFIG: "Configuração do certame",
};

export interface ReadinessStep {
  key: ReadinessStepKey;
  category: ReadinessCategory;
  title: string;
  /** Texto de uma linha (o que fazer / o que está pronto). */
  summary: string;
  /** Pendências deste passo (0 ⇒ pronto). */
  count: number;
  done: boolean;
}

export interface OriginIssueRow { key: string; label: string; reason: string }
export interface OriginGroup { entry: EntryPoint; origin: string; items: OriginIssueRow[]; action: FixAction | null }

export interface ReadinessCounters {
  AUTO_RESOLVED_TOTAL: number;
  ORIGIN_ACTION_REQUIRED_TOTAL: number;
  ONE_TIME_CONFIGURATION_REQUIRED_TOTAL: number;
  PROCESS_DECISIONS_TOTAL: number;
  /** Dados de PUBLICAÇÃO (número do pregão, cronograma) ainda vazios: podem ser preenchidos depois; NÃO contam em nenhum dos outros e NUNCA bloqueiam. */
  DEFERRED_PUBLICATION_TOTAL: number;
}

/** Decomposição (detalhes técnicos): explica de onde vêm os totais, sem dupla contagem. */
export interface ReadinessDetails {
  autoFromFields: number;
  autoFromCanonicalAuthorities: number;
  conditionalHidden: number;
  postAwardHidden: number;
  /** Campos de SISTEMA atribuídos só no ato da emissão oficial (não são "valor disponível" ainda). */
  systemAtIssuance: number;
  /** Decisões deste certame já registradas (têm valor; não são pendência). */
  decisionsRegistered: number;
  sourceIssues: number;
  trParametersToConfirm: number;
  trOfficialRequired: boolean;
  /** Itens do Perfil necessários a ESTE Edital × itens adicionais do Perfil (não necessários agora). */
  requiredForCurrentDocument: number;
  profileGlobalIncomplete: number;
  profileRoles: number;
  profilePolicies: number;
  scheduleIndependent: number;
  scheduleDerived: number;
  /** PublicationReadiness (informativa): todos os dados de publicação presentes? Nunca bloqueia a geração. */
  publicationComplete: boolean;
  publicationMissing: readonly string[];
}

export type GenerationPrimary = "RESOLVE_PENDING" | "GENERATE";

export interface EditalPreparationReadinessView {
  counters: ReadinessCounters;
  details: ReadinessDetails;
  steps: readonly ReadinessStep[];
  tr: { status: "OK" | typeof TR_OFFICIAL_EXACT_REQUIRED; message?: string };
  originGroups: readonly OriginGroup[];
  /** Perfil necessário a este Edital × adicional (a MESMA fonte do contador). */
  profile: ProfileReadiness;
  /** Existe pré-requisito (TR exato, configuração do órgão ou dado na origem) que bloqueia a composição. */
  blockingPrerequisites: boolean;
  /** Primeiro passo ainda pendente (a progressão). `null` ⇒ tudo pronto, inclusive as decisões. */
  nextStep: ReadinessStepKey | null;
  decisionsDefaultOpen: boolean;
  /** Fontes e configurações prontas (decisões do certame podem ou não restar). */
  sourcesReady: boolean;
}

const AUTO_STATUSES: readonly FieldStatus[] = ["AUTO", "ORG_REUSED", "UPSTREAM", "ORG_DEFAULT"];
const CERTAME_DECISION_AUTHORITIES = new Set(["CERTAME_CONFIG", "CERTAME_SCHEDULE", "CONDITIONAL"]);
/**
 * Decisão DO certame atual: editável, escopo do processo e autoridade CertameConfig/Cronograma/condicional ativo.
 * Campo editável sem autoridade informada continua contando (nunca esconder uma pendência editável); autoridade de OUTRA origem
 * (institucional, derivada, origem, ciclo de vida, pós-homologação) nunca é decisão do certame.
 */
export const isCertameDecision = (i: PendingItem): boolean =>
  i.section.scope === "PROCESS" && i.field.editable && (i.field.authority === undefined || CERTAME_DECISION_AUTHORITIES.has(i.field.authority));
const isRequiredForDocument = (f: PrepField): boolean => f.required || !!f.requiredWhen;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Agrupa as pendências NA ORIGEM por ponto de entrada: label simples, origem e ação direta (navegação, nunca escrita). */
export function originGroups(state: PreparationStateView): OriginGroup[] {
  const groups = new Map<EntryPoint, OriginGroup>();
  for (const i of sourceIssues(state)) {
    const g = groups.get(i.entry) ?? { entry: i.entry, origin: ORIGIN_LABEL[i.entry] ?? ORIGIN_LABEL.NONE, items: [], action: fixAction(i.entry) };
    g.items.push({ key: i.key, label: i.label, reason: i.reason });
    groups.set(i.entry, g);
  }
  // Parâmetros estruturados do TR: só são acionáveis com o TR exato selecionado (antes disso o TR é o bloqueio).
  if (state.trPin.state === "VALID") {
    const params = trParamsPending(state);
    if (params.length > 0) {
      const g = groups.get("TR_SECTION") ?? { entry: "TR_SECTION" as const, origin: ORIGIN_LABEL.TR_SECTION, items: [], action: fixAction("TR_SECTION") };
      for (const p of params) if (!g.items.some((x) => x.key === p.name)) g.items.push({ key: p.name, label: p.description || p.name, reason: p.reason ?? "confirme em Parâmetros estruturados do TR" });
      groups.set("TR_SECTION", g);
    }
  }
  return [...groups.values()];
}

export interface ProfileItem { name: string; description: string; reason: string; role?: string }
export interface ProfileReadiness {
  /** Necessários a ESTE Edital (REQUIRED_FOR_CURRENT_DOCUMENT): alimentam o contador, "O que falta" e o grupo de papéis/políticas. */
  required: readonly ProfileItem[];
  /** Perfil global incompleto, NÃO necessário a este Edital (PROFILE_GLOBAL_INCOMPLETE): nunca entram no contador nem em "O que falta". */
  additional: readonly ProfileItem[];
  /** Quantos dos `required` são papéis institucionais (o resto são políticas do órgão). */
  requiredRoles: number;
}

/**
 * UMA regra para "o que o perfil exige deste Edital" (contador, detalhes e lista visual usam o MESMO resultado — nada de divergência):
 *  - necessário = pendência do perfil cujo campo do modelo é obrigatório/condicional ativo (sem o campo no estado: necessário, conservador);
 *  - adicional  = pendência do perfil NÃO necessária + campos de perfil opcionais ainda sem valor.
 */
export function profileReadiness(state: PreparationStateView, edits: Readonly<Record<string, SectionEdits>> = {}): ProfileReadiness {
  const fields = state.sections.flatMap((s) => s.fields);
  const live = liveStatuses(state, edits);
  const statusOf = (f: PrepField): FieldStatus => live.get(f.name)?.status ?? f.status;
  const incompleteByName = new Map(fields.filter((f) => statusOf(f) === "PROFILE_INCOMPLETE").map((f) => [f.name, f] as const));
  const pending = state.upstream?.profilePending ?? [];
  const required: ProfileItem[] = []; const additional: ProfileItem[] = [];
  for (const e of pending) {
    const f = incompleteByName.get(e.name);
    (!f || isRequiredForDocument(f) ? required : additional).push({ name: e.name, description: e.description || e.name, reason: e.reason, ...(e.role ? { role: e.role } : {}) });
  }
  for (const f of fields) {
    if ((f.authority === "ORG_ROLE_PROFILE" || f.authority === "ORG_POLICY_PROFILE") && statusOf(f) === "OPTIONAL" && !f.hasValue && !additional.some((a) => a.name === f.name)) {
      additional.push({ name: f.name, description: f.description || f.name, reason: "campo opcional do perfil, não necessário para este Edital" });
    }
  }
  const requiredRoles = required.filter((e) => incompleteByName.get(e.name)?.authority === "ORG_ROLE_PROFILE" || !!e.role).length;
  return { required, additional, requiredRoles };
}

/** Grupo de origem GRANDE (mais que N itens) começa recolhido: a contagem e a ação continuam visíveis; só a lista é progressiva. */
export const LARGE_ORIGIN_GROUP_THRESHOLD = 5;
export const isLargeOriginGroup = (g: Pick<OriginGroup, "items">): boolean => g.items.length > LARGE_ORIGIN_GROUP_THRESHOLD;

/**
 * View-model de prontidão. `edits` (opcional) aplica as condicionais AO VIVO (o que a pessoa digitou ainda não salvo), exatamente como
 * as pendências da tela; sem `edits` usa o estado do servidor.
 */
export function buildEditalReadiness(state: PreparationStateView, edits: Readonly<Record<string, SectionEdits>> = {}): EditalPreparationReadinessView {
  const fields = state.sections.flatMap((s) => s.fields);
  const live = liveStatuses(state, edits);
  const statusOf = (f: PrepField): FieldStatus => live.get(f.name)?.status ?? f.status;

  // ── AUTO_RESOLVED_TOTAL ───────────────────────────────────────────────────────────────────────
  const autoFromFields = fields.filter((f) => AUTO_STATUSES.includes(statusOf(f))).length;
  const autoCanonical = state.canonicalFields.filter((c) => c.status === "AUTO" && c.authority !== "LIFECYCLE_SYSTEM").length;
  const systemAtIssuance = state.canonicalFields.filter((c) => c.status === "AUTO" && c.authority === "LIFECYCLE_SYSTEM").length;
  const AUTO_RESOLVED_TOTAL = autoFromFields + autoCanonical;

  // ── PROCESS_DECISIONS_TOTAL: só o que é DO certame atual (nunca institucional/derivado/origem/late-bound/pós-homologação) ──────────
  const decisions = livePendingItems(state, edits).filter(isCertameDecision);
  const PROCESS_DECISIONS_TOTAL = decisions.length;
  const scheduleIndependent = decisions.filter((i) => i.field.authority === "CERTAME_SCHEDULE").length;
  const scheduleDerived = fields.filter((f) => f.authority === "CERTAME_SCHEDULE" && statusOf(f) === "AUTO" && !f.completionPolicy).length;
  const DEFERRED_PUBLICATION_TOTAL = fields.filter((f) => statusOf(f) === "DEFERRED").length;

  // ── configuração única: necessário a ESTE Edital × perfil global incompleto ───────────────────────────────────
  const profile = profileReadiness(state, edits);
  const ONE_TIME_CONFIGURATION_REQUIRED_TOTAL = profile.required.length;
  const profileRoles = profile.requiredRoles;

  // ── origem ─────────────────────────────────────────────────────────────────────────────────────
  const groups = originGroups(state);
  // `originGroups` só inclui os parâmetros do TR quando o TR exato é válido (sem ele, o bloqueio é o próprio TR).
  const trParams = state.trPin.state === "VALID" ? trParamsPending(state).length : 0;
  const originIssues = groups.reduce((n, g) => n + g.items.length, 0);
  const trRequired = state.trPin.state !== "VALID";
  const ORIGIN_ACTION_REQUIRED_TOTAL = originIssues + (trRequired ? 1 : 0);

  const steps: ReadinessStep[] = [
    {
      key: "TR_OFFICIAL", category: trRequired ? "BLOCKING_OFFICIAL_SOURCE_REQUIRED" : "READY", count: trRequired ? 1 : 0, done: !trRequired,
      title: "TR oficial exato",
      summary: trRequired
        ? (state.trPin.state === "INVALID" ? "O TR selecionado não é mais válido: selecione novamente a versão oficial exata do TR." : "Selecione a versão oficial do TR.")
        : "TR oficial exato confirmado.",
    },
    {
      key: "ONE_TIME_CONFIG", category: ONE_TIME_CONFIGURATION_REQUIRED_TOTAL > 0 ? "ONE_TIME_CONFIGURATION_REQUIRED" : "READY", count: ONE_TIME_CONFIGURATION_REQUIRED_TOTAL, done: ONE_TIME_CONFIGURATION_REQUIRED_TOTAL === 0,
      title: "Configuração institucional",
      summary: ONE_TIME_CONFIGURATION_REQUIRED_TOTAL > 0
        ? `${plural(ONE_TIME_CONFIGURATION_REQUIRED_TOTAL, "informação necessária para este Edital ainda não está configurada", "informações necessárias para este Edital ainda não estão configuradas")}. Complete os dados do órgão uma única vez.`
        : "Configuração do órgão completa para este Edital.",
    },
    {
      key: "ORIGIN", category: originIssues > 0 ? "ACTION_REQUIRED_AT_ORIGIN" : "READY", count: originIssues, done: originIssues === 0,
      title: "Dados na origem",
      summary: originIssues > 0 ? `${plural(originIssues, "informação precisa ser corrigida", "informações precisam ser corrigidas")} nas fontes (não se digitam no Edital).` : "Nenhum dado a corrigir nas fontes.",
    },
    {
      key: "PROCESS_DECISIONS", category: PROCESS_DECISIONS_TOTAL > 0 ? "PROCESS_DECISIONS_REQUIRED" : "READY", count: PROCESS_DECISIONS_TOTAL, done: PROCESS_DECISIONS_TOTAL === 0,
      title: "Decisões deste certame",
      summary: PROCESS_DECISIONS_TOTAL > 0 ? `${plural(PROCESS_DECISIONS_TOTAL, "decisão ainda precisa ser definida", "decisões ainda precisam ser definidas")}.` : "Nenhuma decisão pendente.",
    },
  ];

  const blockingPrerequisites = steps.some((s) => s.key !== "PROCESS_DECISIONS" && !s.done);
  const nextStep = steps.find((s) => !s.done)?.key ?? null;

  return {
    counters: { AUTO_RESOLVED_TOTAL, ORIGIN_ACTION_REQUIRED_TOTAL, ONE_TIME_CONFIGURATION_REQUIRED_TOTAL, PROCESS_DECISIONS_TOTAL, DEFERRED_PUBLICATION_TOTAL },
    details: {
      autoFromFields, autoFromCanonicalAuthorities: autoCanonical,
      conditionalHidden: fields.filter((f) => statusOf(f) === "HIDDEN_CONDITIONAL").length,
      postAwardHidden: state.metrics.POST_AWARD_HIDDEN,
      systemAtIssuance, decisionsRegistered: fields.filter((f) => statusOf(f) === "DECIDED").length,
      sourceIssues: originIssues - trParams, trParametersToConfirm: trParams, trOfficialRequired: trRequired,
      requiredForCurrentDocument: ONE_TIME_CONFIGURATION_REQUIRED_TOTAL, profileGlobalIncomplete: profile.additional.length,
      profileRoles, profilePolicies: ONE_TIME_CONFIGURATION_REQUIRED_TOTAL - profileRoles, scheduleIndependent, scheduleDerived,
      publicationComplete: state.publication?.readiness.complete ?? false, publicationMissing: state.publication?.readiness.missing ?? [],
    },
    steps,
    tr: trRequired ? { status: TR_OFFICIAL_EXACT_REQUIRED, message: TR_OFFICIAL_EXACT_MESSAGE } : { status: "OK" },
    originGroups: groups,
    profile,
    blockingPrerequisites,
    nextStep,
    decisionsDefaultOpen: !blockingPrerequisites,
    sourcesReady: !blockingPrerequisites,
  };
}

/**
 * Disclosure das decisões: sem escolha explícita da pessoa, segue o padrão da prontidão (recolhida com bloqueios; aberta quando as
 * fontes estão prontas — inclusive abre SOZINHA quando os bloqueios somem). A escolha manual (abrir/fechar) sempre vence.
 */
export function isDecisionsOpen(readiness: Pick<EditalPreparationReadinessView, "decisionsDefaultOpen">, userChoice: boolean | null): boolean {
  return userChoice ?? readiness.decisionsDefaultOpen;
}

export interface GenerationCta {
  /** Quem tem o protagonismo: enquanto houver pendência, "Resolver pendências"; com prontidão completa, a geração. */
  primary: GenerationPrimary;
  primaryLabel: string;
  /** Motivo claro do botão de geração desabilitado (ausente quando a geração está operacional). */
  generateDisabledReason?: string;
}

/**
 * CTA ciente de prontidão. NÃO substitui `generateReady` (preflight/TR/BOUND) nem o backend (fail closed): combina com ele.
 * `generate` é o resultado atual de `generateReady(...)`.
 */
export function generationCta(readiness: EditalPreparationReadinessView, generate: { ready: boolean; reason?: string } = { ready: true }): GenerationCta {
  const next = readiness.steps.find((s) => !s.done);
  if (readiness.blockingPrerequisites || readiness.counters.PROCESS_DECISIONS_TOTAL > 0) {
    const reason = !next ? generate.reason
      : next.key === "TR_OFFICIAL" ? TR_OFFICIAL_EXACT_MESSAGE
        : next.key === "ONE_TIME_CONFIG" ? `Complete a configuração institucional (${plural(next.count, "informação pendente", "informações pendentes")}).`
          : next.key === "ORIGIN" ? `Corrija ${plural(next.count, "dado", "dados")} na origem.`
            : `Defina ${plural(next.count, "decisão", "decisões")} deste certame.`;
    return { primary: "RESOLVE_PENDING", primaryLabel: "Resolver pendências", generateDisabledReason: reason ?? "Há pendências na preparação do Edital." };
  }
  if (!generate.ready) return { primary: "GENERATE", primaryLabel: "Gerar edital com modelo institucional", generateDisabledReason: generate.reason ?? "Aguardando a verificação das fontes." };
  return { primary: "GENERATE", primaryLabel: "Gerar edital com modelo institucional" };
}

/** Frase única do topo (vocabulário unificado). Os números vêm do estado; nada é fixo. */
export function readinessHeadline(c: ReadinessCounters): string {
  const parts = [
    `${c.AUTO_RESOLVED_TOTAL} ${c.AUTO_RESOLVED_TOTAL === 1 ? "informação obtida" : "informações obtidas"} automaticamente`,
    `${c.ORIGIN_ACTION_REQUIRED_TOTAL} ${c.ORIGIN_ACTION_REQUIRED_TOTAL === 1 ? "pendência" : "pendências"} fora do Edital`,
  ];
  if (c.ONE_TIME_CONFIGURATION_REQUIRED_TOTAL > 0) parts.push(`${c.ONE_TIME_CONFIGURATION_REQUIRED_TOTAL} a configurar uma única vez`);
  parts.push(`${c.PROCESS_DECISIONS_TOTAL} ${c.PROCESS_DECISIONS_TOTAL === 1 ? "decisão" : "decisões"} deste certame`);
  const line = parts.join(" · ");
  // Dados de publicação NÃO se misturam aos demais conceitos: frase própria (podem ser preenchidos depois).
  return c.DEFERRED_PUBLICATION_TOTAL > 0
    ? `${line} · ${c.DEFERRED_PUBLICATION_TOTAL} ${c.DEFERRED_PUBLICATION_TOTAL === 1 ? "dado para publicação pode" : "dados para publicação podem"} ser preenchido${c.DEFERRED_PUBLICATION_TOTAL === 1 ? "" : "s"} depois`
    : line;
}

// ─── dados de PUBLICAÇÃO ainda não definidos (informativo; nunca bloqueia a elaboração) ───────────────────────────────────

export interface PublicationPendingView {
  /** O modelo vinculado declara dados de publicação diferidos (`DEFERRED_PUBLICATION`); senão o aviso não existe (a Revisão 1 exige os dados na preparação). */
  readonly applicable: boolean;
  readonly complete: boolean;
  /** Dados ainda sem valor (ordem do servidor — determinística), com o rótulo operacional já usado na preparação. */
  readonly items: readonly { readonly name: string; readonly label: string }[];
}

/** Deriva do ESTADO do servidor (autoridade); o texto da minuta nunca é a fonte. Sem regra nova no cliente: só apresenta `publication.readiness`. */
export function publicationPending(state: PreparationStateView | null | undefined): PublicationPendingView {
  const pub = state?.publication;
  if (!state || !pub?.deferredPolicy) return { applicable: false, complete: true, items: [] };
  const byName = new Map(state.sections.flatMap((s) => s.fields).map((f) => [f.name, f.question ?? f.description] as const));
  const items = pub.readiness.missingVariables.map((name) => ({ name, label: byName.get(name) ?? name }));
  return { applicable: true, complete: pub.readiness.complete && items.length === 0, items };
}
