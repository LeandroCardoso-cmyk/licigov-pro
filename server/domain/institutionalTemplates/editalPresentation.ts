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
  // P3.4 (M8): o TR traz a "Adequação orçamentária" como TEXTO (art. 6º, XXIII, j); aqui é o valor ESTRUTURADO consumido pelo Edital.
  // Não há fonte estruturada anterior para reaproveitar: a pergunta orienta a conferir com o TR em vez de pedir um dado "novo".
  "julgamento.dotacaoOrcamentaria": Object.freeze({
    label: "Dotação orçamentária",
    question: "Informe a dotação orçamentária que custeará a contratação — a mesma indicada na seção \"Adequação orçamentária\" do TR. Registrada aqui uma única vez, ela passa a ser o valor estruturado usado pelo Edital.",
  }),
});

export const presentationOf = (variable: string): VariablePresentation | undefined => VARIABLE_PRESENTATION[variable];
