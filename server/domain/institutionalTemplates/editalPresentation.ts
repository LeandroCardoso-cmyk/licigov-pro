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
});

export const presentationOf = (variable: string): VariablePresentation | undefined => VARIABLE_PRESENTATION[variable];
