/**
 * Política ÚNICA das projeções canônicas do Edital (ZERO_REENTRY). Módulo-folha (sem dependências de domínio) para que o guard de
 * escrita (`governedSources`), a classificação (`editalPreparationModel`), a composição e a tela derivem da MESMA tabela.
 *
 *  - projeção CANONICAL (objeto do processo, unidade requisitante, localidade e UF do cadastro): a autoridade é o domínio. Nunca é
 *    input, nunca é decisão humana, não pode ser gravada de novo e nenhum valor governado (inclusive legado) a sobrepõe;
 *  - projeção TR_OBJECT: vem EXCLUSIVAMENTE do documento oficial do TR EXATO pinado (id + versão + hash), nunca de "o último".
 *    Se o TR exato traz o dado, ele vence qualquer decisão humana anterior; se não traz, a pessoa pode supri-lo (pendência explícita).
 */
export type ProjectionKey = "PROCESS_OBJECT" | "REQUESTING_UNIT" | "ORG_LOCATION" | "ORG_UF_EXTENSO" | "TR_OBJECT";
export type ProjectionOrigin = "Processo" | "Contexto canônico" | "Cadastro do órgão" | "TR oficial";

export const PROJECTION_BY_VARIABLE: Readonly<Record<string, { readonly key: ProjectionKey; readonly origin: ProjectionOrigin }>> = {
  "processo.objetoResumido": { key: "PROCESS_OBJECT", origin: "Processo" },
  "processo.secretariaRequisitante": { key: "REQUESTING_UNIT", origin: "Contexto canônico" },
  "instituicao.municipioSede": { key: "ORG_LOCATION", origin: "Cadastro do órgão" },
  "instituicao.municipioUfExtenso": { key: "ORG_UF_EXTENSO", origin: "Cadastro do órgão" },
  "processo.objetoCompleto": { key: "TR_OBJECT", origin: "TR oficial" },
};

/** A projeção é uma autoridade CANONICAL (não editável, não sobreposta)? Só `TR_OBJECT` admite suprimento humano. */
export const isCanonicalProjection = (variableName: string): boolean => {
  const p = PROJECTION_BY_VARIABLE[variableName];
  return !!p && p.key !== "TR_OBJECT";
};

/** Caminhos (de uma fonte) cujas variáveis são projeções CANONICAL — derivados do catálogo, sem lista duplicada. */
export function canonicalProjectedPaths(vars: readonly { readonly name: string; readonly source: string; readonly path: string }[], source: string): ReadonlySet<string> {
  return new Set(vars.filter((v) => v.source === source && isCanonicalProjection(v.name)).map((v) => v.path));
}

/** Caminhos (de uma fonte) cuja projeção vem do TR exato (vence a decisão humana quando o dado existe). */
export function trProjectedPaths(vars: readonly { readonly name: string; readonly source: string; readonly path: string }[], source: string): ReadonlySet<string> {
  return new Set(vars.filter((v) => v.source === source && PROJECTION_BY_VARIABLE[v.name]?.key === "TR_OBJECT").map((v) => v.path));
}
