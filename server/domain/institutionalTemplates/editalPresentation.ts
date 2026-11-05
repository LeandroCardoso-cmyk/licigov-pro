/**
 * APRESENTAÇÃO operacional de variáveis do Edital (rótulo/pergunta para o servidor público).
 *
 * A semântica do catálogo publicado NÃO muda (a descrição técnica do catálogo — "Controle do módulo SRP (não exibido)" — é terminologia
 * interna). Este mapa por variável é uma camada de APRESENTAÇÃO versionada em código, aplicada a qualquer versão de catálogo: o texto
 * técnico, os nomes de condição (SE_SRP_ATA…) e o nome da variável continuam só em detalhes técnicos/explainability/manifest.
 */
export interface VariablePresentation {
  /** Rótulo operacional (substitui a descrição técnica na tela). */
  readonly label: string;
  /** Pergunta ao operador (campos de decisão). */
  readonly question?: string;
}

export const VARIABLE_PRESENTATION: Readonly<Record<string, VariablePresentation>> = Object.freeze({
  "controle.utilizaSrp": Object.freeze({
    label: "Sistema de Registro de Preços (SRP)",
    question: "Esta contratação utilizará Sistema de Registro de Preços?",
  }),
  // LICIGOV-FAST PR-2 (substitui a orientação P3.4 da M8): dotação e fonte são informação orçamentária do PROCESSO, declaradas uma única vez
  // nos "Dados orçamentários do processo" e consumidas pelo TR e pelo Edital (o Edital não pergunta de novo). Ausentes não bloqueiam.
  "julgamento.dotacaoOrcamentaria": Object.freeze({
    label: "Dotação orçamentária",
    question: "Informe a dotação orçamentária uma única vez, nos Dados orçamentários do processo: o TR e o Edital usam o mesmo registro. Enquanto não for informada, os documentos podem ser gerados e emitidos com a pendência indicada.",
  }),
  "julgamento.fonteRecursos": Object.freeze({
    label: "Fonte de recursos",
    question: "Informe a fonte de recursos junto da dotação, nos Dados orçamentários do processo (registro único para o TR e o Edital).",
  }),
});

export const presentationOf = (variable: string): VariablePresentation | undefined => VARIABLE_PRESENTATION[variable];
