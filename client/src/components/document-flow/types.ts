export type DocType = "dfd" | "etp" | "tr" | "edital";
export type StepStatus = "done-ai" | "done-upload" | "generating" | "uploading" | "pending" | "locked";

export const DOC_LABELS: Record<DocType, { short: string; long: string; description: string }> = {
  dfd: {
    short: "DFD",
    long: "Documento Formalizador de Demanda",
    description: "Formaliza a necessidade da contratação e dá início ao processo (art. 12, VII — Lei 14.133/21)",
  },
  etp: {
    short: "ETP",
    long: "Estudo Técnico Preliminar",
    description: "Análise técnica e econômica que fundamenta a decisão de contratar (art. 18 — Lei 14.133/21)",
  },
  tr: {
    short: "TR",
    long: "Termo de Referência",
    description: "Define o objeto da contratação, especificações técnicas e condições de execução (art. 6º, XXIII — Lei 14.133/21)",
  },
  edital: {
    short: "Edital",
    long: "Edital de Licitação",
    description: "Instrumento convocatório com todas as regras do certame licitatório (art. 25 — Lei 14.133/21)",
  },
};

export const STATUS_LABELS: Record<string, string> = {
  em_dfd: "Em DFD",
  em_etp: "Em ETP",
  em_tr: "Em TR",
  em_edital: "Em Edital",
  concluido: "Concluído",
};

export const DOC_ORDER: DocType[] = ["dfd", "etp", "tr", "edital"];

export const PREREQUISITES: Record<DocType, DocType | null> = {
  dfd: null,
  etp: "dfd",
  tr: "etp",
  edital: "tr",
};
