import * as db from "../db";
import { documentConverter } from "./_core/documentConverter";

/**
 * Gerar relatório completo do processo em PDF
 */
export async function generateProcessReport(processId: number): Promise<Buffer> {
  // Buscar dados do processo
  const process = await db.getProcessById(processId);
  if (!process) {
    throw new Error("Processo não encontrado");
  }

  // Buscar documentos gerados
  const documents = await db.getDocumentsByProcessId(processId);

  // Buscar checklist da plataforma (se houver)
  let checklist: any[] = [];
  if (process.platformId) {
    checklist = await db.getPlatformChecklist(process.platformId);
  }

  // Montar conteúdo do relatório em Markdown
  const markdown = `
# Relatório do Processo

**Gerado em:** ${new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}

---

## 📋 Dados do Processo

| Campo | Valor |
|-------|-------|
| **Nome** | ${process.name} |
| **Número** | ${process.number || "Não informado"} |
| **Modalidade** | ${process.modality} |
| **Categoria** | ${process.category} |
| **Valor Estimado** | ${process.estimatedValue ? `R$ ${process.estimatedValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "Não informado"} |
| **Status** | ${process.status} |
| **Plataforma** | ${process.platform?.name || "Nenhuma selecionada"} |
| **Criado em** | ${new Date(process.createdAt).toLocaleDateString("pt-BR")} |

---

## 📄 Objeto da Contratação

${process.object || "Não informado"}

---

## 📝 Justificativa

${process.justification || "Não informada"}

---

## 📑 Documentos Gerados

${
  documents.length === 0
    ? "_Nenhum documento gerado ainda._"
    : documents
        .map(
          (doc, index) => `
### ${index + 1}. ${doc.type.toUpperCase()}

- **Versão:** ${doc.version}
- **Gerado em:** ${new Date(doc.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
- **Status:** ${doc.status}
`
        )
        .join("\n")
}

---

## 🏢 Dados da Organização

| Campo | Valor |
|-------|-------|
| **CNPJ** | ${process.organization?.cnpj || "Não informado"} |
| **Nome** | ${process.organization?.name || "Não informado"} |
| **Endereço** | ${process.organization?.address || "Não informado"} |
| **Cidade/UF** | ${process.organization?.city || ""}${process.organization?.state ? `/${process.organization.state}` : ""} |
| **Telefone** | ${process.organization?.phone || "Não informado"} |
| **Email** | ${process.organization?.email || "Não informado"} |

---

${
  checklist.length > 0
    ? `
## ✅ Checklist de Publicação

**Plataforma:** ${process.platform?.name}

${checklist
  .map(
    (step) => `
### Passo ${step.stepNumber}: ${step.title}

${step.description || ""}

${step.isOptional ? "_(Opcional)_" : ""}
`
  )
  .join("\n")}

---
`
    : ""
}

## 📊 Resumo

- **Total de documentos gerados:** ${documents.length}
- **Plataforma selecionada:** ${process.platform?.name || "Nenhuma"}
- **Checklist disponível:** ${checklist.length > 0 ? "Sim" : "Não"}

---

_Relatório gerado automaticamente pelo LiciGov Pro._
  `.trim();

  // Converter Markdown para PDF
  const pdfBuffer = await documentConverter.convertMarkdownToPDF(markdown);

  return pdfBuffer;
}
