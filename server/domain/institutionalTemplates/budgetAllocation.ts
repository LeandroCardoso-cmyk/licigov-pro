/**
 * DADOS ORÇAMENTÁRIOS DO PROCESSO (LICIGOV-FAST PR-2) — visão PURA e determinística (sem I/O, sem relógio) da dotação orçamentária e da
 * fonte de recursos, lida do registro governado do processo (o MESMO caminho que o Edital consome). Usada pela tela (status por campo) e
 * pelo bloco determinístico do TR (o mesmo texto governado do Edital quando o dado falta).
 *
 * Status (nunca "verificado": o sistema não confere a contabilidade):
 *  - DECLARED        informado por pessoa autorizada no processo;
 *  - PENDING         ainda não informado — pendência INFORMATIVA (não bloqueia gerar/emitir; o documento traz o marcador governado);
 *  - NOT_APPLICABLE  registro de preços declarado no processo: indicado na formalização de cada contratação, conforme o regulamento de SRP
 *                    aplicável ao órgão (o regulamento federal não é presumido para o município).
 */
import { sha256Hex } from "../canonicalJson";
import { CONTENT_PENDING_VARIABLES } from "./contentPending";
import type { VariableCatalog2 } from "./variableCatalog2";

export const BUDGET_ALLOCATION_VARIABLES = Object.freeze({ dotacao: "julgamento.dotacaoOrcamentaria", fonte: "julgamento.fonteRecursos" } as const);
const SRP_VARIABLE = "controle.utilizaSrp";

export type BudgetFieldStatus = "DECLARED" | "PENDING" | "NOT_APPLICABLE";
export interface BudgetFieldView { readonly value: string | null; readonly status: BudgetFieldStatus }
export interface BudgetAllocationView {
  readonly dotacao: BudgetFieldView;
  readonly fonte: BudgetFieldView;
  /** Registro de preços declarado no processo (CertameConfig); `null` = ainda não decidido. */
  readonly srp: boolean | null;
}

export const NOT_APPLICABLE_SRP_TEXT = {
  dotacao: "em registro de preços, indicada na formalização de cada contratação, conforme o regulamento aplicável",
  fonte: "indicada com a dotação, na formalização de cada contratação",
} as const;

type Sections = Readonly<Record<string, unknown>> | undefined;
const read = (catalog: VariableCatalog2, sections: Sections, name: string): unknown => {
  const def = catalog.vars.find((v) => v.name === name);
  if (!def) return undefined;
  const sec = sections?.[def.source] as Record<string, unknown> | undefined;
  return sec && Object.prototype.hasOwnProperty.call(sec, def.path) ? sec[def.path] : undefined;
};

/** `null` quando o catálogo não declara os dados orçamentários (outro modelo): nada é exibido nem anexado. */
export function budgetAllocationView(catalog: VariableCatalog2, sections: Sections): BudgetAllocationView | null {
  const declares = (n: string) => catalog.vars.some((v) => v.name === n);
  if (!declares(BUDGET_ALLOCATION_VARIABLES.dotacao) && !declares(BUDGET_ALLOCATION_VARIABLES.fonte)) return null;
  const srpRaw = read(catalog, sections, SRP_VARIABLE);
  const srp = typeof srpRaw === "boolean" ? srpRaw : null;
  const field = (name: string): BudgetFieldView => {
    const raw = read(catalog, sections, name);
    if (typeof raw === "string" && raw.trim() !== "") return { value: raw, status: "DECLARED" };
    return { value: null, status: srp === true ? "NOT_APPLICABLE" : "PENDING" };
  };
  return { dotacao: field(BUDGET_ALLOCATION_VARIABLES.dotacao), fonte: field(BUDGET_ALLOCATION_VARIABLES.fonte), srp };
}

export interface BudgetAllocationBlock {
  /** Texto determinístico anexado ao TR (é conteúdo do documento; editável no rascunho). */
  readonly block: string;
  /** SHA-256 do snapshot lógico (valores + status): entra no hash do pedido de geração e na linhagem do rascunho. */
  readonly digest: string;
  /** Rótulos das pendências informativas (nunca bloqueiam). */
  readonly pending: readonly string[];
  /** Fatos declarados (rótulo → valor) para a autoria usar literalmente. */
  readonly declared: readonly (readonly [string, string])[];
}

export function renderBudgetAllocationBlock(view: BudgetAllocationView): BudgetAllocationBlock {
  const rows: Array<[keyof typeof BUDGET_ALLOCATION_VARIABLES, BudgetFieldView]> = [["dotacao", view.dotacao], ["fonte", view.fonte]];
  const lines: string[] = [];
  const pending: string[] = [];
  const declared: Array<[string, string]> = [];
  for (const [key, f] of rows) {
    const spec = CONTENT_PENDING_VARIABLES[BUDGET_ALLOCATION_VARIABLES[key]]!;
    if (f.status === "DECLARED") { lines.push(`- ${spec.label}: ${f.value}`); declared.push([spec.label, f.value!]); }
    else if (f.status === "NOT_APPLICABLE") lines.push(`- ${spec.label}: ${NOT_APPLICABLE_SRP_TEXT[key]}.`);
    else { lines.push(`- ${spec.label}: ${spec.absentText}`); pending.push(spec.label); }
  }
  const digest = sha256Hex(JSON.stringify({ v: 1, dotacao: view.dotacao, fonte: view.fonte, srp: view.srp }));
  return {
    block: `DADOS ORÇAMENTÁRIOS DO PROCESSO (o Edital usa os mesmos dados)\n\n${lines.join("\n")}`,
    digest, pending, declared,
  };
}
