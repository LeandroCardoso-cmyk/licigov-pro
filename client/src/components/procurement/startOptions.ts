/**
 * P0 piloto — Formas de início do processo (fonte única do wizard e do roteamento de abas).
 *
 * "O LiciGov entra no processo no ponto em que a Prefeitura já está": o servidor pode começar criando o
 * DFD, importando DFD/ETP/TR já elaborados ou pela Pesquisa de Preços. Nenhuma forma exige etapa anterior;
 * todas levam às MESMAS abas canônicas do processo. Espelha START_OPTIONS do procurementProcessRouter.
 */

export type StartOption =
  | "criar_dfd"
  | "importar_dfd"
  | "iniciar_etp"
  | "importar_etp"
  | "iniciar_pesquisa"
  | "importar_tr"
  | "iniciar_tr"
  | "importar_oficio"
  | "importar_memorando"
  | "importar_pdf";

export type StartTab = "dfd" | "etp" | "price" | "tr";

export const START_OPTIONS: { value: StartOption; title: string; description: string }[] = [
  { value: "criar_dfd", title: "Criar DFD", description: "Documento de Formalização da Demanda estruturado para revisão." },
  { value: "importar_dfd", title: "Importar DFD", description: "A Secretaria já tem o DFD: importe o PDF/DOCX e revise." },
  { value: "iniciar_etp", title: "Iniciar ETP", description: "Comece pelo Estudo Técnico Preliminar (o DFD não é obrigatório)." },
  { value: "importar_etp", title: "Importar ETP", description: "Traga um ETP já elaborado (PDF/DOCX) para o processo." },
  { value: "iniciar_pesquisa", title: "Iniciar Pesquisa de Preços", description: "Importe cotações/mapa comparativo e gere os Itens Inteligentes." },
  { value: "importar_tr", title: "Importar TR", description: "O TR já veio pronto: importe, revise e siga para o Edital." },
  { value: "iniciar_tr", title: "Iniciar TR", description: "Gere o Termo de Referência com base no processo." },
  { value: "importar_oficio", title: "Importar de ofício", description: "Extraímos a demanda a partir de um ofício." },
  { value: "importar_memorando", title: "Importar de memorando", description: "Extraímos a demanda a partir de um memorando." },
  { value: "importar_pdf", title: "Importar PDF", description: "Envie um PDF e o sistema estrutura a demanda." },
];

/** Aba inicial e se a importação documental abre expandida. */
export function startTargetFor(startOption: string): { tab: StartTab; importOpen: boolean } {
  switch (startOption) {
    case "importar_dfd": return { tab: "dfd", importOpen: true };
    case "iniciar_etp": return { tab: "etp", importOpen: false };
    case "importar_etp": return { tab: "etp", importOpen: true };
    case "iniciar_pesquisa": return { tab: "price", importOpen: false };
    case "importar_tr": return { tab: "tr", importOpen: true };
    case "iniciar_tr": return { tab: "tr", importOpen: false };
    default: return { tab: "dfd", importOpen: false };
  }
}
