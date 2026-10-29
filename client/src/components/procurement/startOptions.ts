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
  { value: "importar_dfd", title: "Importar DFD", description: "A Secretaria já tem o DFD: envie o PDF (com texto) ou DOCX, o texto é extraído sem IA e você revisa." },
  { value: "iniciar_etp", title: "Iniciar ETP", description: "Comece pelo Estudo Técnico Preliminar (o DFD não é obrigatório)." },
  { value: "importar_etp", title: "Importar ETP", description: "Traga um ETP já elaborado (PDF com texto ou DOCX) para revisar no processo." },
  { value: "iniciar_pesquisa", title: "Iniciar Pesquisa de Preços", description: "Importe cotações/mapa comparativo e gere os Itens Inteligentes." },
  { value: "importar_tr", title: "Importar TR", description: "O TR já veio pronto: importe, revise e siga para o Edital." },
  { value: "iniciar_tr", title: "Iniciar TR", description: "Gere o Termo de Referência com base no processo." },
  // LICIGOV-FAST PR-1 — ofício/memorando só ficam registrados como origem do processo: nada é lido nem extraído.
  { value: "importar_oficio", title: "A partir de ofício", description: "Registra o ofício como origem da demanda e abre o DFD para elaboração. O conteúdo do ofício não é lido automaticamente." },
  { value: "importar_memorando", title: "A partir de memorando", description: "Registra o memorando como origem da demanda e abre o DFD para elaboração. O conteúdo não é lido automaticamente." },
  { value: "importar_pdf", title: "Importar PDF", description: "Abre a importação do DFD: envie o PDF (com texto), o texto é extraído sem IA e você revisa." },
];

/** Formas que dependem da importação documental (texto extraído do arquivo). */
const FILE_IMPORT_OPTIONS: ReadonlySet<StartOption> = new Set(["importar_dfd", "importar_etp", "importar_tr", "importar_pdf"]);

/**
 * Descrição exibida no wizard. Com a importação documental desligada na organização, as formas de importação
 * não prometem ler o arquivo: abrem a etapa para elaboração (o DFD oferece só o registro da origem).
 */
export function startOptionDescription(option: { value: StartOption; description: string }, fileImportEnabled: boolean): string {
  if (fileImportEnabled || !FILE_IMPORT_OPTIONS.has(option.value)) return option.description;
  return "Importação de arquivos indisponível nesta organização: abre a etapa para elaboração, sem ler o arquivo.";
}

/** Aba inicial e se a importação documental abre expandida. */
export function startTargetFor(startOption: string): { tab: StartTab; importOpen: boolean } {
  switch (startOption) {
    case "importar_dfd":
    case "importar_pdf": return { tab: "dfd", importOpen: true };
    case "iniciar_etp": return { tab: "etp", importOpen: false };
    case "importar_etp": return { tab: "etp", importOpen: true };
    case "iniciar_pesquisa": return { tab: "price", importOpen: false };
    case "importar_tr": return { tab: "tr", importOpen: true };
    case "iniciar_tr": return { tab: "tr", importOpen: false };
    default: return { tab: "dfd", importOpen: false };
  }
}
