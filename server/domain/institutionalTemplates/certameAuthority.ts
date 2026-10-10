/**
 * AUTORIDADES DO CERTAME (PR #288 — CERTAME CONFIG AUTHORITY CLOSURE). Módulo puro (sem I/O, sem relógio) que fecha, por variável do
 * Edital institucional, QUEM é a autoridade e COMO o valor é obtido sem reentrada:
 *
 *  PLATFORM_PROFILE   master data estável da plataforma (endereço oficial, versão do regulamento, regras de cronograma): informada UMA vez
 *                     por órgão no registro do ÓRGÃO (ledger existente, versionado/auditável). Nada é presumido da BLL sem declaração.
 *  CERTAME_SCHEDULE   cronograma: só as datas/horas independentes são informadas; o equivalente técnico (limite das propostas = sessão,
 *                     início do recebimento = publicação) só é derivado quando o Perfil da plataforma DECLARA a regra. Sem prazo legal inventado.
 *  UPSTREAM_ITEMS     forma de julgamento (item × lote) e regime de participação: derivados da estrutura canônica dos Itens; ambiguidade ⇒ fail closed.
 *  UPSTREAM_PRICE_RESEARCH / LIFECYCLE_SYSTEM  data-base do orçamento e data de emissão: nunca digitadas no Edital.
 *  CERTAME_CONFIG     decisões do certame registradas UMA vez por processo; o Edital as consome.
 */
import { isRealCalendarDate } from "./valueTypes2";

// ─── Perfil da PLATAFORMA ───────────────────────────────────────────────────────────────────────────────────────────

/** Chave da plataforma do modelo Edital Pregão Eletrônico BLL (slug do escopo do modelo). */
export const BLL_PLATFORM = "bll";

/** Regras de cronograma que a plataforma DECLARA (ausente ⇒ nenhuma derivação: as datas são informadas como independentes). */
export interface PlatformSchedule {
  /** `ABERTURA_DA_SESSAO`: o limite de recebimento das propostas coincide com a data/horário da sessão. */
  readonly limitePropostas?: "ABERTURA_DA_SESSAO";
  /** `PUBLICACAO`: o recebimento começa na data prevista de divulgação, no horário `horarioInicioPropostas`. */
  readonly inicioPropostas?: "PUBLICACAO";
  /** Horário (HH:MM) em que o recebimento começa — exigido para derivar o início (nunca presumido). */
  readonly horarioInicioPropostas?: string;
}

export interface PlatformProfile {
  /** URL oficial da plataforma (→ `processo.enderecoEletronicoBll`). */
  readonly enderecoEletronico?: string;
  /** Versão/data do regulamento vigente da plataforma (→ `processo.regulamentoBllVersao`). */
  readonly regulamentoVersao?: string;
  readonly cronograma?: PlatformSchedule;
}
export type PlatformProfiles = Readonly<Record<string, PlatformProfile>>;

export const PLATFORM_FIELD_LABEL: Readonly<Record<"enderecoEletronico" | "regulamentoVersao", string>> = {
  enderecoEletronico: "Endereço eletrônico oficial da plataforma", regulamentoVersao: "Versão/data do regulamento da plataforma",
};

/** Variável do catálogo → (plataforma, campo do Perfil da plataforma). Projeção determinística; nada é inferido. */
export const PLATFORM_VARIABLES: Readonly<Record<string, { readonly platform: string; readonly field: "enderecoEletronico" | "regulamentoVersao" }>> = Object.freeze({
  "processo.enderecoEletronicoBll": { platform: BLL_PLATFORM, field: "enderecoEletronico" },
  "processo.regulamentoBllVersao": { platform: BLL_PLATFORM, field: "regulamentoVersao" },
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Valida a FORMA dos perfis de plataforma (a normalização por tipo do catálogo é feita no registro/leitura contra o catálogo). */
export function validatePlatformProfiles(raw: unknown): { ok: true; value: PlatformProfiles } | { ok: false; issues: string[] } {
  if (!isObj(raw)) return { ok: false, issues: ["platforms deve ser um objeto { plataforma → perfil }"] };
  const issues: string[] = [];
  const out: Record<string, PlatformProfile> = {};
  for (const [slug, p] of Object.entries(raw)) {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) { issues.push(`plataforma inválida: ${slug}`); continue; }
    if (!isObj(p)) { issues.push(`${slug}: perfil deve ser um objeto`); continue; }
    const extra = Object.keys(p).filter((k) => !["enderecoEletronico", "regulamentoVersao", "cronograma"].includes(k));
    if (extra.length) { issues.push(`${slug}: campos desconhecidos (${extra.join(", ")})`); continue; }
    const prof: { enderecoEletronico?: string; regulamentoVersao?: string; cronograma?: PlatformSchedule } = {};
    for (const k of ["enderecoEletronico", "regulamentoVersao"] as const) {
      const v = p[k];
      if (v === undefined || v === null || v === "") continue;
      if (typeof v !== "string" || v.trim() === "" || v.length > 500) { issues.push(`${slug}.${k}: texto inválido (até 500)`); continue; }
      prof[k] = v.replace(/\s+/g, " ").trim();
    }
    if (p.cronograma !== undefined && p.cronograma !== null) {
      const c = p.cronograma;
      if (!isObj(c) || Object.keys(c).some((k) => !["limitePropostas", "inicioPropostas", "horarioInicioPropostas"].includes(k))) {
        issues.push(`${slug}.cronograma: apenas limitePropostas, inicioPropostas e horarioInicioPropostas`);
      } else {
        const sched: { limitePropostas?: "ABERTURA_DA_SESSAO"; inicioPropostas?: "PUBLICACAO"; horarioInicioPropostas?: string } = {};
        if (c.limitePropostas !== undefined) { if (c.limitePropostas === "ABERTURA_DA_SESSAO") sched.limitePropostas = "ABERTURA_DA_SESSAO"; else issues.push(`${slug}.cronograma.limitePropostas: valor desconhecido`); }
        if (c.inicioPropostas !== undefined) { if (c.inicioPropostas === "PUBLICACAO") sched.inicioPropostas = "PUBLICACAO"; else issues.push(`${slug}.cronograma.inicioPropostas: valor desconhecido`); }
        if (c.horarioInicioPropostas !== undefined) { if (typeof c.horarioInicioPropostas === "string" && HHMM.test(c.horarioInicioPropostas)) sched.horarioInicioPropostas = c.horarioInicioPropostas; else issues.push(`${slug}.cronograma.horarioInicioPropostas: informe HH:MM`); }
        if (sched.inicioPropostas === "PUBLICACAO" && !sched.horarioInicioPropostas) issues.push(`${slug}.cronograma: início do recebimento na publicação exige o horário (nunca presumido)`);
        if (Object.keys(sched).length) prof.cronograma = sched;
      }
    }
    if (Object.keys(prof).length) out[slug] = prof;
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: out };
}

export type PlatformResolution =
  | { readonly state: "OK"; readonly value: string; readonly platform: string; readonly field: "enderecoEletronico" | "regulamentoVersao" }
  | { readonly state: "MISSING"; readonly platform: string; readonly field: "enderecoEletronico" | "regulamentoVersao"; readonly reason: string };

/** Valor da variável a partir do Perfil da plataforma; ausente ⇒ MISSING (a entrada é o Perfil da plataforma, não o Edital). */
export function resolvePlatformVariable(variableName: string, platforms: PlatformProfiles | null | undefined): PlatformResolution | null {
  const pv = PLATFORM_VARIABLES[variableName];
  if (!pv) return null;
  const value = platforms?.[pv.platform]?.[pv.field];
  if (!value) return { state: "MISSING", ...pv, reason: `${PLATFORM_FIELD_LABEL[pv.field]} não configurado no Perfil da plataforma` };
  return { state: "OK", value, ...pv };
}

// ─── Cronograma do certame ──────────────────────────────────────────────────────────────────────────────────────────

export const SCHEDULE = Object.freeze({
  divulgacao: "controle.dataDivulgacaoPrevista",
  abertura: "processo.dataAbertura",
  horarioAbertura: "processo.horarioAbertura",
  fim: "processo.dataFimRecebimentoPropostas",
  horarioFim: "processo.horarioFimRecebimentoPropostas",
  inicio: "processo.dataInicioRecebimentoPropostas",
} as const);

/** Cronograma: variáveis que a regra da plataforma PODE derivar (as demais são sempre independentes). */
export const SCHEDULE_DERIVABLE: readonly string[] = [SCHEDULE.fim, SCHEDULE.horarioFim, SCHEDULE.inicio];

export interface DerivedScheduleValue { readonly value: string; readonly rule: string; readonly basis: readonly string[] }
export type ScheduleDerivation = ReadonlyMap<string, DerivedScheduleValue>;

/**
 * Deriva o equivalente técnico do cronograma SOMENTE pelas regras declaradas no Perfil da plataforma. `known` = valores já definidos
 * (nome da variável → valor tipado). Base ausente ⇒ nada derivado (a base é a pendência). Nunca escolhe data nem prazo legal.
 */
export function deriveSchedule(rule: PlatformSchedule | undefined, known: Readonly<Record<string, unknown>>): ScheduleDerivation {
  const out = new Map<string, DerivedScheduleValue>();
  if (!rule) return out;
  const str = (n: string): string | null => (typeof known[n] === "string" && (known[n] as string) !== "" ? (known[n] as string) : null);
  if (rule.limitePropostas === "ABERTURA_DA_SESSAO") {
    const d = str(SCHEDULE.abertura), h = str(SCHEDULE.horarioAbertura);
    if (d) out.set(SCHEDULE.fim, { value: d, rule: "limite das propostas = data da sessão (regra declarada no Perfil da plataforma)", basis: [SCHEDULE.abertura] });
    if (h) out.set(SCHEDULE.horarioFim, { value: h, rule: "limite das propostas = horário da sessão (regra declarada no Perfil da plataforma)", basis: [SCHEDULE.horarioAbertura] });
  }
  if (rule.inicioPropostas === "PUBLICACAO" && rule.horarioInicioPropostas) {
    const d = str(SCHEDULE.divulgacao);
    if (d) out.set(SCHEDULE.inicio, { value: `${d}T${rule.horarioInicioPropostas}`, rule: "início do recebimento = data prevista de divulgação, no horário declarado no Perfil da plataforma", basis: [SCHEDULE.divulgacao] });
  }
  return out;
}

// ─── Itens: forma de julgamento e regime de participação ──────────────────────────────────────────────────────────

export interface ItemStructure { readonly key: string; readonly lotId: string | null; readonly lotCode: string | null }

export type FormaJulgamentoResult =
  | { readonly state: "OK"; readonly value: "item" | "lote" }
  | { readonly state: "EMPTY" }
  | { readonly state: "AMBIGUOUS"; readonly reason: string };

/** item × lote da ESTRUTURA canônica: todos os itens em lotes ⇒ lote; nenhum ⇒ item; misto ⇒ ambíguo (fail closed, decide-se em Itens). */
export function deriveFormaJulgamento(items: readonly ItemStructure[]): FormaJulgamentoResult {
  if (items.length === 0) return { state: "EMPTY" };
  const inLot = items.filter((i) => i.lotId !== null).length;
  if (inLot === 0) return { state: "OK", value: "item" };
  if (inLot === items.length) return { state: "OK", value: "lote" };
  return { state: "AMBIGUOUS", reason: `${inLot} de ${items.length} itens estão em lotes e os demais não: agrupe todos em lotes ou nenhum, em Itens da contratação` };
}

export interface ParticipationConfig {
  readonly default?: string;
  readonly byLot?: Readonly<Record<string, string>>;
  readonly byItem?: Readonly<Record<string, string>>;
}

export const COMBINATION_PREFIX = "Combinação por item";

export type RegimeResult =
  | { readonly state: "OK"; readonly value: string; readonly combined: boolean }
  | { readonly state: "MISSING"; readonly reason: string; readonly missingItems: number }
  | { readonly state: "INVALID"; readonly reason: string };

/** Regime EFETIVO de cada item: item > lote > padrão (a mesma precedência do quadro de itens). */
export function effectiveRegime(p: ParticipationConfig | null | undefined, it: ItemStructure): string | null {
  if (!p) return null;
  return p.byItem?.[it.key] ?? (it.lotCode ? p.byLot?.[it.lotCode] : undefined) ?? p.default ?? null;
}

/**
 * Regime de participação GLOBAL do Edital, derivado da configuração dos Itens (nunca uma segunda decisão):
 * todos os itens com o mesmo regime ⇒ esse regime; regimes diferentes ⇒ o literal de combinação do modelo; algum item sem regime ⇒ MISSING.
 */
export function deriveRegimeParticipacao(p: ParticipationConfig | null | undefined, items: readonly ItemStructure[], enumValues: readonly string[]): RegimeResult {
  if (items.length === 0) return { state: "MISSING", reason: "o processo não possui Itens da contratação", missingItems: 0 };
  const regimes = items.map((i) => effectiveRegime(p, i));
  const missing = regimes.filter((r) => r === null).length;
  if (missing > 0) return { state: "MISSING", reason: `${missing} item(ns) sem regime de participação definido em Itens da contratação`, missingItems: missing };
  const distinct = [...new Set(regimes as string[])];
  const combination = enumValues.find((v) => v.startsWith(COMBINATION_PREFIX));
  const bad = distinct.find((r) => !enumValues.includes(r) || r.startsWith(COMBINATION_PREFIX));
  if (bad) return { state: "INVALID", reason: `regime de participação fora das opções do modelo: ${bad}` };
  if (distinct.length === 1) return { state: "OK", value: distinct[0], combined: false };
  if (!combination) return { state: "INVALID", reason: "o modelo não prevê regime combinado e os itens têm regimes diferentes" };
  return { state: "OK", value: combination, combined: true };
}

// ─── Derivações (tipo) por variável ──────────────────────────────────────────────────────────────────────────────────

export type DerivationKind = "PLATFORM" | "FORMA_JULGAMENTO" | "REGIME_PARTICIPACAO" | "BUDGET_DATE" | "EMISSION_DATE" | "SCHEDULE";

/** Variáveis cujo valor NUNCA é digitado no Edital (autoridade é derivada). `SCHEDULE` só quando a regra da plataforma o declara. */
export const DERIVED_VARIABLES: Readonly<Record<string, DerivationKind>> = Object.freeze({
  "processo.enderecoEletronicoBll": "PLATFORM",
  "processo.regulamentoBllVersao": "PLATFORM",
  "decisao.formaJulgamento": "FORMA_JULGAMENTO",
  "julgamento.regimeParticipacao": "REGIME_PARTICIPACAO",
  "julgamento.dataOrcamentoEstimado": "BUDGET_DATE",
  "processo.dataEmissaoEdital": "EMISSION_DATE",
  [SCHEDULE.fim]: "SCHEDULE",
  [SCHEDULE.horarioFim]: "SCHEDULE",
  [SCHEDULE.inicio]: "SCHEDULE",
});

/** Derivadas SEMPRE (qualquer escrita humana é recusada e o valor legado no ledger é ignorado): tudo, menos o cronograma condicionado à regra. */
export const ALWAYS_DERIVED = (name: string): boolean => {
  const k = DERIVED_VARIABLES[name];
  return k !== undefined && k !== "SCHEDULE";
};

/** Data-base do orçamento (AAAA-MM-DD) em formato de calendário real. */
export const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && isRealCalendarDate(Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10)));

// ─── AUDITORIA: CURRENT → CORRECT authority das 26 variáveis do "Decisões deste certame" ─────────────────────────────

export interface CertameAuditRow {
  readonly variable: string;
  readonly currentAuthority: "TRUE_PROCESS_DECISION";
  readonly correctAuthority: string;
  readonly entryPoint: string;
  readonly reusable: boolean;
  readonly derivable: boolean;
  readonly processSpecific: boolean;
  readonly reason: string;
}

const row = (variable: string, correctAuthority: string, entryPoint: string, flags: { reusable: boolean; derivable: boolean; processSpecific: boolean }, reason: string): CertameAuditRow =>
  ({ variable, currentAuthority: "TRUE_PROCESS_DECISION", correctAuthority, entryPoint, ...flags, reason });
const PS = { reusable: false, derivable: false, processSpecific: true } as const;
const RU = { reusable: true, derivable: false, processSpecific: true } as const;
const DV = { reusable: false, derivable: true, processSpecific: false } as const;
const PF = { reusable: true, derivable: false, processSpecific: false } as const;

/** Auditoria literal dos campos que o piloto real exibia como "Decisões deste certame" (cobertura 1:1 verificada em teste). */
export const CERTAME_AUDIT: readonly CertameAuditRow[] = Object.freeze([
  row("processo.enderecoEletronicoBll", "PLATFORM_PROFILE", "Perfil da plataforma", PF, "Fato estável da plataforma BLL; igual para todo pregão do órgão na plataforma."),
  row("processo.regulamentoBllVersao", "PLATFORM_PROFILE", "Perfil da plataforma", PF, "Versão/data do regulamento vigente da plataforma; muda raramente e com revisão auditável, não por processo."),
  row("julgamento.dataOrcamentoEstimado", "UPSTREAM_PRICE_RESEARCH", "Pesquisa de Preços", DV, "Data-base do orçamento pertence à Pesquisa de Preços que originou os Itens aprovados."),
  row("decisao.formaJulgamento", "UPSTREAM_ITEMS", "Itens da contratação", DV, "Item × lote decorre da estrutura canônica dos Itens (lotes); misto ⇒ ambiguidade, decide-se em Itens."),
  row("julgamento.regimeParticipacao", "UPSTREAM_ITEMS", "Itens da contratação", DV, "Regime efetivo decorre da configuração de participação por item/lote; era duplicado pelo 'padrão dos itens' do Edital."),
  row("processo.dataEmissaoEdital", "LIFECYCLE_SYSTEM", "Sistema", DV, "Evento do ciclo de vida documental, atribuído pelo sistema; nunca decisão humana."),
  row("processo.dataFimRecebimentoPropostas", "CERTAME_SCHEDULE", "Configuração do certame (cronograma)", DV, "Equivalente técnico da sessão SE o Perfil da plataforma declarar a regra; senão data independente."),
  row("processo.horarioFimRecebimentoPropostas", "CERTAME_SCHEDULE", "Configuração do certame (cronograma)", DV, "Idem: limite das propostas na sessão, somente por regra declarada."),
  row("processo.dataInicioRecebimentoPropostas", "CERTAME_SCHEDULE", "Configuração do certame (cronograma)", DV, "Início = publicação SE o Perfil da plataforma declarar a regra e o horário; senão data independente."),
  row("controle.dataDivulgacaoPrevista", "CERTAME_SCHEDULE", "Configuração do certame (cronograma)", PS, "Data de calendário do processo: decisão independente, sem padrão."),
  row("processo.dataAbertura", "CERTAME_SCHEDULE", "Configuração do certame (cronograma)", PS, "Data da sessão: decisão independente do processo, sem padrão."),
  row("processo.horarioAbertura", "CERTAME_SCHEDULE", "Configuração do certame (cronograma)", RU, "Horário da sessão: independente; padrão institucional explícito permitido (expediente recorrente)."),
  row("processo.numeroPregao", "CERTAME_CONFIG", "Configuração do certame", PS, "Identificador do pregão: persistido UMA vez no certame e consumido por todos os documentos; sem geração automática sem regra governada."),
  row("controle.utilizaSrp", "CERTAME_CONFIG", "Configuração do certame", PS, "Decisão do processo (Registro de Preços); sem padrão."),
  row("decisao.inversaoFases", "CERTAME_CONFIG", "Configuração do certame", PS, "Decisão jurídica casuística do processo; sem padrão."),
  row("julgamento.criterioJulgamento", "CERTAME_CONFIG", "Configuração do certame", PS, "Decisão do processo; o campo legado do cabeçalho do Edital deixa de ser segunda autoridade quando há modelo vinculado."),
  row("julgamento.modoDisputa", "CERTAME_CONFIG", "Configuração do certame", RU, "Decisão do processo com padrão institucional explícito permitido."),
  row("julgamento.prazoValidadeProposta", "CERTAME_CONFIG", "Configuração do certame", RU, "Prazo recorrente com padrão institucional explícito permitido."),
  row("julgamento.parametroExequibilidade", "CERTAME_CONFIG", "Configuração do certame", RU, "Regra recorrente com padrão institucional explícito permitido."),
  row("decisao.intervaloMinimoLances", "CERTAME_CONFIG", "Configuração do certame", RU, "Opção do certame com padrão institucional explícito permitido."),
  row("decisao.propostaSemIdentificacao", "CERTAME_CONFIG", "Configuração do certame", RU, "Opção do certame com padrão institucional explícito permitido."),
  row("decisao.anexosAdicionais", "CERTAME_CONFIG", "Configuração do certame", PS, "Decisão do processo; sem padrão."),
  row("decisao.tratamentoRegional", "CERTAME_CONFIG", "Configuração do certame", PS, "Decisão jurídica do processo; sem padrão."),
  row("decisao.exclusivoMeEpp", "CERTAME_CONFIG", "Configuração do certame", PS, "Enquadramento jurídico (LC 123) por processo: não é derivado de valor (regra legal não presumida)."),
  row("decisao.cotaReservada", "CERTAME_CONFIG", "Configuração do certame", PS, "Enquadramento jurídico (LC 123) por processo; sem padrão."),
  row("decisao.beneficioAfastado", "CERTAME_CONFIG", "Configuração do certame", PS, "Afastamento motivado (art. 49 LC 123): decisão casuística; sem padrão."),
  row("decisao.regulamentoMunicipalVerificado", "CERTAME_CONFIG", "Configuração do certame", PS, "Atestado humano de conferência do regulamento municipal por processo; sem padrão."),
]);
