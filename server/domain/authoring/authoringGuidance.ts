/**
 * Homologação visual M8 (P1) — orientação OPERACIONAL quando a autoria estruturada é recusada (fail-closed).
 *
 * A validação jurídica NÃO muda: seção de mínimo legal sem conteúdo continua recusando o rascunho. Este módulo só
 * traduz o motivo técnico ("mínimo legal 'fundamentacao' … exige conteúdo") em: o que faltou, por que bloqueia,
 * onde complementar e qual a próxima ação — deixando claro que é um bloqueio de RASCUNHO (nada foi gravado) e que a
 * emissão oficial tem verificações próprias. Puro e determinístico.
 */
import { canonicalSectionsFor, type AuthoringKind } from "./authoringSchema";

const DOC_LABEL: Record<AuthoringKind, string> = { etp: "ETP", tr: "Termo de Referência", edital: "Edital" };

/** Onde o servidor completa a informação de cada seção (fontes que a autoria reaproveita). */
const WHERE: Record<string, string> = {
  fundamentacao: "no ETP do processo (a fundamentação do TR referencia os estudos técnicos preliminares) — gere ou revise o ETP",
  necessidade: "na justificativa da necessidade do DFD",
  objeto: "no objeto do processo e nos Itens da contratação",
  descricao_solucao: "no ETP (descrição da solução como um todo)",
  viabilidade: "nas seções do ETP que sustentam a conclusão (necessidade, solução, mercado, estimativas)",
  requisitos: "no ETP (requisitos da contratação) e nos parâmetros estruturados do TR",
  estimativa_valor: "na Pesquisa de Preços e nos Itens da contratação",
};

export interface AuthoringFailureGuidance {
  readonly sections: ReadonlyArray<{ key: string; title: string; anchor: string; where: string }>;
  readonly message: string;
}

export function authoringFailureGuidance(kind: AuthoringKind, issues: readonly string[]): AuthoringFailureGuidance {
  const canon = canonicalSectionsFor(kind);
  const keys = [...new Set(issues.flatMap((i) => [...i.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])))];
  const sections = keys.map((k) => {
    const c = canon.find((s) => s.key === k);
    return { key: k, title: c?.title ?? k, anchor: c?.legalAnchorLabel ?? "", where: WHERE[k] ?? "no contexto do processo (DFD, ETP, Itens da contratação)" };
  });
  const list = sections.map((s) => `"${s.title}"${s.anchor ? ` (Lei 14.133/2021, ${s.anchor})` : ""}`).join(", ");
  const where = [...new Set(sections.map((s) => s.where))].join("; ");
  const message = sections.length > 0
    ? `Rascunho do ${DOC_LABEL[kind]} não gerado — nada foi gravado. Motivo: a resposta da IA deixou sem conteúdo a(s) seção(ões) de mínimo legal ${list}, que não podem ser omitidas. ` +
      `Onde complementar: ${where}. Próxima ação: complete essas informações e gere novamente. ` +
      `Este bloqueio é da elaboração do rascunho; a emissão da versão oficial tem verificações próprias (inclusive pendências [REVISAR]).`
    : `Rascunho do ${DOC_LABEL[kind]} não gerado — nada foi gravado. A resposta da IA não atendeu à estrutura exigida; gere novamente. Detalhe técnico: ${issues.slice(0, 2).join("; ")}`;
  return { sections, message };
}
