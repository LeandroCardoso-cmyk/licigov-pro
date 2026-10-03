import * as db from "../db";
import archiver from "archiver";
import ExcelJS from "exceljs";
import type { DirectContractDocument, DirectContractQuotation } from "../../drizzle/schema";
import {
  DIRECT_CONTRACT_PACKAGE_POLICY, UniqueFileNamer, buildDocumentFiles, exclusionsToOmissions,
  renderManifestListing, sanitizeFileSegment, selectAuthoritativeDocuments, sha256Hex,
  type BuiltPackageFile, type PackageDocumentInput, type PackageManifestEntry, type PackageNaming, type PackageOmission,
} from "./packageAuthority";

/**
 * Serviço de Exportação de Pacote Presencial
 * Gera ZIP com os documentos AUTORITATIVOS + planilha de cotações + README (manifesto)
 */

/** Contratação direta como lida pelo router (com artigo legal e plataforma do join). */
type PackageContract = NonNullable<Awaited<ReturnType<typeof db.getDirectContractById>>>;

interface PackageOptions {
  contractId: number;
  includeDocuments?: boolean;
  includeQuotations?: boolean;
  includeReadme?: boolean;
}

// R9 / SEM-072 — ordem e nome base por tipo (enum de `direct_contract_documents.type`).
const DIRECT_DOC_NAMING: Record<string, { order: string; base: string; label: string }> = {
  termo_dispensa:        { order: "01", base: "TERMO_DISPENSA",                 label: "Termo de Dispensa" },
  termo_inexigibilidade: { order: "02", base: "TERMO_INEXIGIBILIDADE",          label: "Termo de Inexigibilidade" },
  dfd:                   { order: "03", base: "DOCUMENTO_FORMALIZACAO_DEMANDA", label: "Documento de Formalização da Demanda (DFD)" },
  tr:                    { order: "04", base: "TERMO_REFERENCIA",               label: "Termo de Referência (TR)" },
  minuta_contrato:       { order: "05", base: "MINUTA_CONTRATO",                label: "Minuta de Contrato" },
  planilha_cotacao:      { order: "06", base: "PLANILHA_COTACAO",               label: "Planilha de Cotação" },
  mapa_comparativo:      { order: "07", base: "MAPA_COMPARATIVO",               label: "Mapa Comparativo de Preços" },
  ata_ratificacao:       { order: "08", base: "ATA_RATIFICACAO",                label: "Ata de Ratificação" },
};

/** Pasta dos documentos oficiais (status `final`). */
export const DIRECT_PACKAGE_OFFICIAL_FOLDER = "documentos/";
/** Pasta SEPARADA e explicitamente não oficial: último rascunho de tipos sem versão final. */
export const DIRECT_PACKAGE_DRAFT_FOLDER = "rascunhos_NAO_OFICIAIS/";

function directDocLabel(doc: { type: string; title?: string | null }): string {
  const known = DIRECT_DOC_NAMING[doc.type];
  if (known) return known.label;
  return doc.title?.trim() ? `Outro — ${doc.title.trim()}` : "Outro documento";
}

function namingFor(folder: string): PackageNaming {
  return {
    folder,
    baseName(doc: PackageDocumentInput): string {
      const known = DIRECT_DOC_NAMING[doc.type];
      if (known) return `${known.order}_${known.base}`;
      // "outro" (e tipo não mapeado): o título distingue documentos avulsos.
      return `09_OUTRO_${sanitizeFileSegment(doc.title ?? "", 40)}`;
    },
    label: directDocLabel,
  };
}

function toInput(doc: DirectContractDocument): PackageDocumentInput {
  return { id: doc.id, type: doc.type, version: doc.version, status: doc.status, createdAt: doc.createdAt, title: doc.title, content: doc.content };
}

/**
 * R9 / SEM-072 — planeja os arquivos de documento do pacote presencial (sem I/O).
 *
 * Antes: TODAS as linhas de `direct_contract_documents` (rascunhos, finais, arquivados, regerações) entravam como
 * `documentos/TIPO.pdf` — nomes colidentes (só a última sobrevivia no descompactador) e Markdown dentro de `.pdf`.
 * Agora: por tipo, só a versão `final` vigente em `documentos/`; sem final, o ÚLTIMO rascunho vai à pasta separada
 * `rascunhos_NAO_OFICIAIS/` com sufixo `_RASCUNHO`; arquivados/preteridos ficam fora e aparecem no manifesto.
 * O conteúdo é Markdown ⇒ extensão `.md` (este serviço não tem conversor PDF autorizado).
 */
export async function planDirectContractPackageFiles(
  documents: readonly DirectContractDocument[],
): Promise<{ files: BuiltPackageFile[]; omissions: PackageOmission[] }> {
  const selection = selectAuthoritativeDocuments(documents.map(toInput), DIRECT_CONTRACT_PACKAGE_POLICY);
  const namer = new UniqueFileNamer();
  const official = await buildDocumentFiles(selection.official, namingFor(DIRECT_PACKAGE_OFFICIAL_FOLDER), namer, { unofficial: false });
  const drafts = await buildDocumentFiles(selection.draftsWithoutOfficial, namingFor(DIRECT_PACKAGE_DRAFT_FOLDER), namer, {
    unofficial: true, nameSuffix: "_RASCUNHO",
  });
  return {
    files: [...official.files, ...drafts.files],
    omissions: [...official.omissions, ...drafts.omissions, ...exclusionsToOmissions(selection.excluded, directDocLabel)],
  };
}

/**
 * Gera pacote completo para modo presencial
 */
export async function generatePresentialPackage(
  options: PackageOptions
): Promise<Buffer> {
  const { contractId, includeDocuments = true, includeQuotations = true, includeReadme = true } = options;

  // Buscar contratação
  const contract = await db.getDirectContractById(contractId);
  if (!contract) {
    throw new Error("Contratação não encontrada");
  }

  // Criar ZIP
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];

  archive.on("data", (chunk: Buffer) => chunks.push(chunk));

  const zipPromise = new Promise<Buffer>((resolve, reject) => {
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });

  // R9 / SEM-072 — manifesto do conteúdo REAL do pacote (vai no LEIA-ME).
  const manifest: PackageManifestEntry[] = [];
  const omissions: PackageOmission[] = [];

  // Adicionar documentos autoritativos (um por tipo; rascunhos só em pasta separada não oficial)
  if (includeDocuments) {
    const documents = await db.getDirectContractDocuments(contractId);
    const planned = await planDirectContractPackageFiles(documents);
    for (const f of planned.files) {
      archive.append(f.data, { name: f.path });
      manifest.push(f.entry);
    }
    omissions.push(...planned.omissions);
  }

  // Adicionar planilha de cotações
  if (includeQuotations) {
    const quotations = await db.listQuotations(contractId);

    if (quotations.length > 0) {
      const spreadsheet = await generateQuotationsSpreadsheet(contract, quotations);
      archive.append(spreadsheet, { name: "PLANILHA_COTACOES.xlsx" });
      manifest.push({
        path: "PLANILHA_COTACOES.xlsx", label: "Mapa comparativo de cotações registradas", format: "xlsx",
        status: "", version: null, sha256: sha256Hex(spreadsheet), bytes: spreadsheet.length, unofficial: false,
      });
    }
  }

  // Adicionar README
  if (includeReadme) {
    const readme = generateReadme(contract, renderManifestListing(manifest, omissions));
    archive.append(readme, { name: "LEIA-ME.txt" });
  }

  // Finalizar ZIP
  void archive.finalize();

  return zipPromise;
}

/**
 * Gera planilha XLSX com cotações comparativas
 */
async function generateQuotationsSpreadsheet(
  contract: PackageContract,
  quotations: DirectContractQuotation[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Cotações");

  // Configurar largura das colunas
  worksheet.columns = [
    { width: 5 },   // #
    { width: 35 },  // Fornecedor
    { width: 20 },  // CNPJ
    { width: 18 },  // Valor
    { width: 15 },  // Data
  ];

  // Cabeçalho do documento
  worksheet.mergeCells("A1:E1");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = "MAPA COMPARATIVO DE COTAÇÕES";
  titleCell.font = { size: 16, bold: true };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4F46E5" },
  };
  titleCell.font = { ...titleCell.font, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).height = 30;

  // Informações da contratação
  worksheet.mergeCells("A3:B3");
  worksheet.getCell("A3").value = "Contratação Direta:";
  worksheet.getCell("A3").font = { bold: true };
  worksheet.mergeCells("C3:E3");
  worksheet.getCell("C3").value = `${contract.number}/${contract.year}`;

  worksheet.mergeCells("A4:B4");
  worksheet.getCell("A4").value = "Tipo:";
  worksheet.getCell("A4").font = { bold: true };
  worksheet.mergeCells("C4:E4");
  worksheet.getCell("C4").value = contract.type === "dispensa" ? "Dispensa de Licitação" : "Inexigibilidade de Licitação";

  worksheet.mergeCells("A5:B5");
  worksheet.getCell("A5").value = "Objeto:";
  worksheet.getCell("A5").font = { bold: true };
  worksheet.mergeCells("C5:E5");
  worksheet.getCell("C5").value = contract.object;

  // Linha em branco
  worksheet.addRow([]);

  // Cabeçalho da tabela
  const headerRow = worksheet.addRow(["#", "Fornecedor", "CNPJ", "Valor (R$)", "Data da Cotação"]);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF6366F1" },
  };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  headerRow.height = 25;

  // Ordenar cotações por valor (menor para maior)
  const sortedQuotations = [...quotations].sort((a, b) => a.value - b.value);

  // Adicionar cotações
  sortedQuotations.forEach((quotation, index) => {
    const row = worksheet.addRow([
      index + 1,
      quotation.supplierName,
      quotation.supplierCNPJ || "Não informado",
      (quotation.value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
      // R9 / SEM-072 (tipagem) — `quotationDate` não existe no schema (gerava "Invalid Date"); usa a data de registro.
      new Date(quotation.createdAt).toLocaleDateString("pt-BR"),
    ]);

    // Destacar menor valor
    if (index === 0) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD1FAE5" },
      };
      row.font = { bold: true };
    }

    // Alinhar células
    row.getCell(1).alignment = { horizontal: "center" };
    row.getCell(4).alignment = { horizontal: "right" };
    row.getCell(5).alignment = { horizontal: "center" };
  });

  // Linha de total/média
  worksheet.addRow([]);
  const statsRow = worksheet.addRow([
    "",
    "ESTATÍSTICAS:",
    "",
    "",
    "",
  ]);
  statsRow.font = { bold: true };

  const avgValue = sortedQuotations.reduce((sum, q) => sum + q.value, 0) / sortedQuotations.length;
  const minValue = sortedQuotations[0]?.value || 0;
  const maxValue = sortedQuotations[sortedQuotations.length - 1]?.value || 0;

  worksheet.addRow(["", "Menor Valor:", "", (minValue / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }), ""]);
  worksheet.addRow(["", "Maior Valor:", "", (maxValue / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }), ""]);
  worksheet.addRow(["", "Valor Médio:", "", (avgValue / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }), ""]);

  // Aplicar bordas
  const lastRow = worksheet.lastRow?.number || 0;
  for (let i = 7; i <= lastRow; i++) {
    for (let j = 1; j <= 5; j++) {
      const cell = worksheet.getCell(i, j);
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    }
  }

  // Gerar buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Gera arquivo README.txt com instruções
 */
/** Documentos obrigatórios do artigo legal (JSON array no legado) em lista legível. */
function formatRequiredDocuments(raw: unknown): string {
  if (Array.isArray(raw) && raw.length > 0) return raw.map(item => `  • ${String(item)}`).join("\n");
  if (typeof raw === "string" && raw.trim()) return raw;
  return "• Consultar artigo legal aplicável";
}

function generateReadme(contract: PackageContract, contentListing: string): string {
  const valueInReais = (contract.value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

  return `
═══════════════════════════════════════════════════════════════════════════════
  PACOTE DE CONTRATAÇÃO DIRETA - MODO PRESENCIAL
═══════════════════════════════════════════════════════════════════════════════

DADOS DA CONTRATAÇÃO:
  • Número/Ano: ${contract.number}/${contract.year}
  • Tipo: ${contract.type === "dispensa" ? "Dispensa de Licitação" : "Inexigibilidade de Licitação"}
  • Objeto: ${contract.object}
  • Valor Estimado: R$ ${valueInReais}
  ${contract.executionDeadline ? `• Prazo de Execução: ${contract.executionDeadline} dias` : ""}

ARTIGO LEGAL APLICÁVEL:
  • ${contract.legalArticle?.article} ${contract.legalArticle?.inciso || ""}
  • ${contract.legalArticle?.summary}

───────────────────────────────────────────────────────────────────────────────

CONTEÚDO DESTE PACOTE (R9 / SEM-072 — listagem do conteúdo REAL, gerada a partir dos arquivos):

📁 documentos/ — somente a versão FINAL vigente de cada documento (Markdown, .md)
📁 rascunhos_NAO_OFICIAIS/ — último rascunho de documentos AINDA SEM versão final (não oficial; revisar e
   finalizar no sistema antes de qualquer uso formal)
📊 PLANILHA_COTACOES.xlsx — cotações registradas, comparativo e estatísticas (quando houver cotações)

${contentListing}

───────────────────────────────────────────────────────────────────────────────

INSTRUÇÕES PARA USO:

1. COLETA DE COTAÇÕES:
   • Imprima a Planilha de Cotação (arquivo PLANILHA_COTACAO, listado acima)
   • Envie para no mínimo 3 fornecedores
   • Solicite proposta formal com CNPJ e validade

2. ANÁLISE DE PROPOSTAS:
   • Registre as cotações no sistema
   • Verifique a documentação de cada fornecedor
   • Compare os valores na planilha Excel

3. FORMALIZAÇÃO:
   • Elabore o ${contract.type === "dispensa" ? "Termo de Dispensa" : "Termo de Inexigibilidade"}
   • Anexe as cotações e documentos comprobatórios
   • Submeta para aprovação da autoridade competente

4. CONTRATAÇÃO:
   • Após aprovação, utilize a Minuta de Contrato (arquivo MINUTA_CONTRATO, listado acima)
   • Preencha os dados do fornecedor vencedor
   • Assine o contrato e publique conforme legislação

───────────────────────────────────────────────────────────────────────────────

DOCUMENTOS OBRIGATÓRIOS (conforme Lei 14.133/2021):

${formatRequiredDocuments(contract.legalArticle?.requiredDocuments)}

───────────────────────────────────────────────────────────────────────────────

OBSERVAÇÕES IMPORTANTES:

⚠️  Verifique os limites de valor para dispensa (Art. 75, I):
    • Obras: até R$ 100.000,00
    • Serviços e Compras: até R$ 50.000,00

⚠️  Mantenha todos os documentos arquivados para prestação de contas

⚠️  Publique a contratação no Portal Nacional de Contratações Públicas (PNCP)

───────────────────────────────────────────────────────────────────────────────

Gerado em: ${new Date().toLocaleString("pt-BR")}
Sistema: LiciGov Pro - Gestão de Licitações e Contratos

═══════════════════════════════════════════════════════════════════════════════
`.trim();
}

/**
 * Gera template de email para envio ao fornecedor
 */
export function generateEmailTemplate(contract: PackageContract): {
  subject: string;
  body: string;
} {
  const valueInReais = (contract.value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

  const subject = `Solicitação de Cotação - ${contract.type === "dispensa" ? "Dispensa" : "Inexigibilidade"} ${contract.number}/${contract.year}`;

  const body = `
Prezado(a) Fornecedor(a),

Solicitamos cotação de preços para a seguinte contratação:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DADOS DA CONTRATAÇÃO

Processo: ${contract.number}/${contract.year}
Tipo: ${contract.type === "dispensa" ? "Dispensa de Licitação" : "Inexigibilidade de Licitação"}
Fundamento Legal: ${contract.legalArticle?.article} ${contract.legalArticle?.inciso || ""} da Lei 14.133/2021

Objeto:
${contract.object}

Valor Estimado: R$ ${valueInReais}
${contract.executionDeadline ? `Prazo de Execução: ${contract.executionDeadline} dias` : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DOCUMENTOS ANEXOS

• Planilha de Cotação (preencher e devolver)
• Termo de Referência (especificações técnicas)
• Minuta de Contrato (condições contratuais)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSTRUÇÕES PARA ENVIO DA PROPOSTA

1. Preencha a planilha de cotação anexa
2. Anexe os seguintes documentos:
   • Cópia do CNPJ
   • Certidões negativas (Federal, Estadual, Municipal, FGTS, Trabalhista)
   • Declaração de que não emprega menor de idade
   • Atestado de capacidade técnica (se aplicável)

3. Envie a proposta até: [INSERIR PRAZO]
   • Por e-mail: [INSERIR EMAIL]
   • Ou presencialmente: [INSERIR ENDEREÇO]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OBSERVAÇÕES IMPORTANTES

⚠️  A proposta deve ter validade mínima de 60 (sessenta) dias
⚠️  O preço deve ser fixo e irreajustável
⚠️  Incluir todos os custos (impostos, fretes, seguros, etc.)
⚠️  A proposta deve ser apresentada em papel timbrado da empresa

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Dúvidas podem ser esclarecidas através dos contatos abaixo.

Atenciosamente,

[INSERIR NOME DO ÓRGÃO]
[INSERIR SETOR RESPONSÁVEL]
[INSERIR TELEFONE]
[INSERIR EMAIL]
`.trim();

  return { subject, body };
}
