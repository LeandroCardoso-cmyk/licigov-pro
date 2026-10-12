/**
 * DADOS DE PUBLICAÇÃO do Edital (DEFERRED_PUBLICATION) — projeção estável e prontidão. PURO (sem I/O, sem relógio).
 *
 * Número do pregão e cronograma (divulgação, sessão, propostas) pertencem à preparação OPERACIONAL da publicação: podem não existir
 * quando o Edital é elaborado. A AUTORIDADE continua a mesma (CertameConfig/Cronograma — a Authority Matrix não muda); aqui só se
 * nomeia o conjunto, se projeta o que já foi decidido e se diz o que ainda falta. Isto NUNCA bloqueia a composição (a política
 * `DEFERRED_PUBLICATION` do catálogo é quem a libera); serve a avisos e consumidores operacionais (calendário, centro de operações).
 *
 * Nada é inventado: valor ausente é `null` — sem data corrente, sem "último número + 1", sem sequência inferida.
 */

export type PublicationRole =
  | "numeroPregao" | "dataDivulgacaoPrevista" | "dataSessao" | "horarioSessao"
  | "inicioRecebimentoPropostas" | "dataLimitePropostas" | "horarioLimitePropostas";

export interface PublicationFieldSpec { readonly role: PublicationRole; readonly variable: string; readonly label: string }

/** Ordem FIXA e determinística (a de apresentação e a de `missing`). Nomes = variáveis do catálogo do Edital. */
export const PUBLICATION_FIELDS: readonly PublicationFieldSpec[] = Object.freeze([
  { role: "numeroPregao", variable: "processo.numeroPregao", label: "Número do pregão" },
  { role: "dataDivulgacaoPrevista", variable: "controle.dataDivulgacaoPrevista", label: "Data prevista de divulgação" },
  { role: "dataSessao", variable: "processo.dataAbertura", label: "Data da sessão" },
  { role: "horarioSessao", variable: "processo.horarioAbertura", label: "Horário da sessão" },
  { role: "inicioRecebimentoPropostas", variable: "processo.dataInicioRecebimentoPropostas", label: "Início do recebimento das propostas" },
  { role: "dataLimitePropostas", variable: "processo.dataFimRecebimentoPropostas", label: "Data-limite das propostas" },
  { role: "horarioLimitePropostas", variable: "processo.horarioFimRecebimentoPropostas", label: "Horário-limite das propostas" },
].map((f) => Object.freeze(f as PublicationFieldSpec)));

export const PUBLICATION_VARIABLES: readonly string[] = Object.freeze(PUBLICATION_FIELDS.map((f) => f.variable));
export const isPublicationVariable = (name: string): boolean => PUBLICATION_VARIABLES.includes(name);

/** Projeção ESTÁVEL consumível por calendário/centro de operações/alertas. `null` = ainda não definido. */
export type PublicationScheduleProjection = Readonly<Record<PublicationRole, string | null>>;

export interface PublicationReadiness {
  /** Todos os dados necessários à publicação presentes. NÃO bloqueia a geração do Edital. */
  readonly complete: boolean;
  readonly total: number;
  /** Papéis ainda ausentes, em ordem fixa (determinístico). */
  readonly missing: readonly PublicationRole[];
  readonly missingVariables: readonly string[];
}

const present = (v: unknown): v is string | number => (typeof v === "string" && v.trim() !== "") || typeof v === "number";

/** `values`: valor efetivo por NOME de variável (decidido, derivado por regra da plataforma ou padrão institucional). */
export function projectPublicationSchedule(values: Readonly<Record<string, unknown>>): { schedule: PublicationScheduleProjection; readiness: PublicationReadiness } {
  const schedule = Object.fromEntries(PUBLICATION_FIELDS.map((f) => [f.role, present(values[f.variable]) ? String(values[f.variable]) : null])) as Record<PublicationRole, string | null>;
  const missing = PUBLICATION_FIELDS.filter((f) => schedule[f.role] === null);
  return {
    schedule: Object.freeze(schedule),
    readiness: Object.freeze({
      complete: missing.length === 0, total: PUBLICATION_FIELDS.length,
      missing: Object.freeze(missing.map((f) => f.role)), missingVariables: Object.freeze(missing.map((f) => f.variable)),
    }),
  };
}
