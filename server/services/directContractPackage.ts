import * as db from "../db";
import archiver from "archiver";
import { Readable } from "stream";
import ExcelJS from "exceljs";

/**
 * Serviço de Exportação de Pacote Presencial
 * Gera ZIP com todos os documentos + planilha de cotações + README
 */

interface PackageOptions {
  contractId: number;
  includeDocuments?: boolean;
  includeQuotations?: boolean;
  includeReadme?: boolean;
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

  archive.on("data", (chunk) => chunks.push(chunk));

  const zipPromise = new Promise<Buffer>((resolve, reject) => {
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });

  // Adicionar documentos gerados
  if (includeDocuments) {
    const documents = await db.getDirectContractDocuments(contractId);
    
    for (const doc of documents) {
      const fileName = `${doc.type.replace(/_/g, "_").toUpperCase()}.pdf`;
      archive.append(Buffer.from(doc.content), { name: `documentos/${fileName}` });
    }
  }

  // Adicionar planilha de cotações
  if (includeQuotations) {
    const quotations = await db.getDirectContractQuotations(contractId);
    
    if (quotations.length > 0) {
      const spreadsheet = await generateQuotationsSpreadsheet(contract, quotations);
      archive.append(spreadsheet, { name: "PLANILHA_COTACOES.xlsx" });
    }
  }

  // Adicionar README
  if (includeReadme) {
    const readme = generateReadme(contract);
    archive.append(readme, { name: "LEIA-ME.txt" });
  }

  // Finalizar ZIP
  archive.finalize();

  return zipPromise;
}

/**
 * Gera planilha XLSX com cotações comparativas
 */
async function generateQuotationsSpreadsheet(
  contract: any,
  quotations: any[]
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
      new Date(quotation.quotationDate).toLocaleDateString("pt-BR"),
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
function generateReadme(contract: any): string {
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

CONTEÚDO DESTE PACOTE:

📁 documentos/
  • ${contract.type === "dispensa" ? "TERMO_DISPENSA.pdf" : "TERMO_INEXIGIBILIDADE.pdf"} - Termo de contratação direta
  • MINUTA_CONTRATO.pdf - Minuta do contrato a ser assinado
  • PLANILHA_COTACAO.pdf - Planilha para coleta de preços
  • MAPA_COMPARATIVO.pdf - Mapa comparativo de cotações

📊 PLANILHA_COTACOES.xlsx
  • Planilha Excel com cotações registradas
  • Comparativo de preços entre fornecedores
  • Estatísticas (menor, maior e valor médio)

───────────────────────────────────────────────────────────────────────────────

INSTRUÇÕES PARA USO:

1. COLETA DE COTAÇÕES:
   • Imprima a PLANILHA_COTACAO.pdf
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
   • Após aprovação, utilize a MINUTA_CONTRATO.pdf
   • Preencha os dados do fornecedor vencedor
   • Assine o contrato e publique conforme legislação

───────────────────────────────────────────────────────────────────────────────

DOCUMENTOS OBRIGATÓRIOS (conforme Lei 14.133/2021):

${contract.legalArticle?.requiredDocuments || "• Consultar artigo legal aplicável"}

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
export function generateEmailTemplate(contract: any): {
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
