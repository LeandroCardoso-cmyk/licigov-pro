/**
 * RC-3.5.2 — Classificação: **LEGACY** (compatibilidade apenas).
 *
 * Gera artefatos (ZIP/PDF) chamando o DocumentConverter diretamente, sem passar pelo
 * OfficialDocumentLifecycleService. Registrado na allowlist central
 * (`DOCUMENT_CONVERTER_ALLOWLIST` / `LEGACY_EXPORTERS`). Não remover, não reescrever,
 * não migrar. Novos fluxos DEVEM usar o Document Engine oficial.
 *
 * Serviço de geração de arquivos ZIP
 * Cria pacote de publicação com o documento AUTORITATIVO (aprovado vigente) de cada tipo.
 *
 * R9 / SEM-072 — correção semântica autorizada (não é migração): seleção, nomes e formato passam pelo núcleo
 * puro `packageAuthority.ts`; o uso do DocumentConverter permanece o mesmo (allowlist inalterada).
 */

import archiver from "archiver";
import * as db from "../db";
import type { Document, Platform } from "../../drizzle/schema";
import { convertToPDF } from "./documentConverter";
import { generateItemsSpreadsheet, getSpreadsheetFileName } from "./excelService";
import {
  LEGACY_PUBLICATION_POLICY, UniqueFileNamer, buildDocumentFiles, exclusionsToOmissions, renderManifestListing,
  selectAuthoritativeDocuments, sha256Hex,
  type BuiltPackageFile, type PackageDocumentInput, type PackageManifestEntry, type PackageOmission,
} from "./packageAuthority";

interface ZipGenerationResult {
  buffer: Buffer;
  filename: string;
}

// R9 / SEM-072 — ordem segue o fluxo oficial DFD → ETP → TR → Edital; todo tipo do enum legado tem nome (antes,
// tipos fora de etp/tr/dfd/edital viravam entrada de nome VAZIO). `05_` é reservado à planilha de itens.
const LEGACY_DOC_NAMING: Record<Document["type"], { order: string; base: string; label: string }> = {
  dfd:      { order: "01", base: "DOCUMENTO_FORMALIZACAO_DEMANDA", label: "Documento de Formalização da Demanda (DFD)" },
  etp:      { order: "02", base: "ESTUDO_TECNICO_PRELIMINAR",      label: "Estudo Técnico Preliminar (ETP)" },
  tr:       { order: "03", base: "TERMO_REFERENCIA",               label: "Termo de Referência (TR)" },
  edital:   { order: "04", base: "EDITAL",                         label: "Edital de Licitação" },
  minuta:   { order: "06", base: "MINUTA",                         label: "Minuta" },
  contrato: { order: "07", base: "CONTRATO",                       label: "Contrato" },
  ata:      { order: "08", base: "ATA",                            label: "Ata" },
  parecer:  { order: "09", base: "PARECER",                        label: "Parecer" },
  aditivo:  { order: "10", base: "ADITIVO",                        label: "Aditivo" },
};

function namingOf(type: string): { order: string; base: string; label: string } {
  return LEGACY_DOC_NAMING[type as Document["type"]] ?? { order: "99", base: "DOCUMENTO", label: type };
}

function toInput(doc: Document): PackageDocumentInput {
  return {
    id: doc.id, type: doc.type, version: doc.version, status: doc.documentStatus, createdAt: doc.createdAt,
    title: doc.title, content: doc.content, isUpload: doc.sourceType === "upload",
  };
}

/**
 * R9 / SEM-072 — planeja os arquivos de documento do pacote de publicação (sem acesso a banco).
 *
 * Antes: TODAS as linhas de `documents` do processo (cada save cria uma linha `version + 1`; rascunhos e aprovados
 * juntos) eram convertidas sob um nome FIXO por tipo — N versões de ETP viravam N entradas
 * `01_ESTUDO_TECNICO_PRELIMINAR.pdf` (colisão) e tipos sem mapeamento viravam entrada sem nome.
 * Agora: por tipo, só a versão APROVADA vigente (aprovação governada pelo documentReviewService); rascunho/em revisão
 * nunca entra (publicação ≠ rascunho); substituídas/arquivadas/rejeitadas ficam fora e aparecem no manifesto.
 * Nome único `NN_TIPO_vN.pdf`; a extensão só é `.pdf` se o conversor produzir bytes PDF reais — senão `.md`.
 */
export async function planPublicationPackageFiles(
  documents: readonly Document[],
  toPdf: (markdown: string, doc: PackageDocumentInput) => Promise<Buffer>,
): Promise<{ files: BuiltPackageFile[]; omissions: PackageOmission[] }> {
  const selection = selectAuthoritativeDocuments(documents.map(toInput), LEGACY_PUBLICATION_POLICY);
  const ordered = [...selection.official].sort((a, b) => namingOf(a.type).order.localeCompare(namingOf(b.type).order));
  const built = await buildDocumentFiles(
    ordered,
    {
      folder: "",
      baseName: (doc) => { const n = namingOf(doc.type); return `${n.order}_${n.base}`; },
      label: (doc) => namingOf(doc.type).label,
    },
    new UniqueFileNamer(),
    { unofficial: false, toPdf },
  );
  return {
    files: built.files,
    omissions: [...built.omissions, ...exclusionsToOmissions(selection.excluded, (doc) => namingOf(doc.type).label)],
  };
}

/**
 * Gerar arquivo ZIP com os documentos AUTORITATIVOS (aprovados vigentes) do processo
 */
export async function generatePublicationZip(
  processId: number,
  platformId: number | null
): Promise<ZipGenerationResult> {
  // Buscar processo
  const process = await db.getProcessById(processId);
  if (!process) {
    throw new Error("Processo não encontrado");
  }

  // Buscar plataforma
  const platform = platformId ? await db.getPlatformById(platformId) : null;

  // R9 / SEM-072 — documentos do processo escopados pela organização do PRÓPRIO processo (defesa em profundidade;
  // linhas legadas sem organização caem no lookup por processo, como antes).
  const organizationId = await db.getProcessOrganizationId(processId);
  const documents = organizationId !== null
    ? await db.getDocumentsByProcessForOrganization(processId, organizationId)
    : await db.getDocumentsByProcess(processId);

  // Criar archive
  const archive = archiver("zip", {
    zlib: { level: 9 }, // Máxima compressão
  });

  // Array para coletar chunks do ZIP
  const chunks: Buffer[] = [];

  // Criar promise para aguardar finalização
  const zipPromise = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });

  // R9 / SEM-072 — só o documento autoritativo por tipo, nome único, extensão = formato real.
  const manifest: PackageManifestEntry[] = [];
  const planned = await planPublicationPackageFiles(documents, (markdown, doc) => convertToPDF(markdown, `${doc.type}.pdf`));
  for (const f of planned.files) {
    archive.append(f.data, { name: f.path });
    manifest.push(f.entry);
  }

  // Adicionar planilha de itens (se houver itens)
  const items = await db.getProcessItems(processId);
  if (items.length > 0) {
    try {
      const spreadsheetBuffer = await generateItemsSpreadsheet(processId, platformId);
      const spreadsheetFilename = `05_${getSpreadsheetFileName(process.name, platform?.slug || null)}`;

      archive.append(spreadsheetBuffer, { name: spreadsheetFilename });
      manifest.push({
        path: spreadsheetFilename, label: "Planilha de Itens CATMAT/CATSER", format: "xlsx", status: "",
        version: null, sha256: sha256Hex(spreadsheetBuffer), bytes: spreadsheetBuffer.length, unofficial: false,
      });
    } catch (error) {
      console.error("Erro ao adicionar planilha ao ZIP:", error);
    }
  }

  // Adicionar arquivo README com instruções + manifesto do conteúdo real
  const readmeContent = generateReadmeContent(process, platform, renderManifestListing(manifest, planned.omissions));
  archive.append(readmeContent, { name: "00_LEIA_ME.txt" });

  // Finalizar archive
  void archive.finalize();

  // Aguardar conclusão
  const zipBuffer = await zipPromise;

  // Gerar nome do arquivo ZIP
  const sanitizedName = process.name
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 50);

  const zipFilename = platform
    ? `PACOTE_PUBLICACAO_${platform.slug.toUpperCase()}_${sanitizedName}.zip`
    : `PACOTE_PUBLICACAO_${sanitizedName}.zip`;

  return {
    buffer: zipBuffer,
    filename: zipFilename,
  };
}

/**
 * Gerar conteúdo do arquivo README
 */
/** Processo legado como lido por `getProcessById` (projeção com join de plataforma). */
type PackageProcess = NonNullable<Awaited<ReturnType<typeof db.getProcessById>>>;

function generateReadmeContent(
  process: PackageProcess,
  platform: Platform | null | undefined,
  contentListing: string
): string {
  const date = new Date().toLocaleDateString("pt-BR");

  let content = `═══════════════════════════════════════════════════════════════
  PACOTE DE PUBLICAÇÃO - LICITAÇÃO
═══════════════════════════════════════════════════════════════

Processo: ${process.name}
Data de Geração: ${date}
`;

  if (platform) {
    content += `Plataforma: ${platform.name}
Website: ${platform.websiteUrl || "N/A"}

`;
  }

  content += `
═══════════════════════════════════════════════════════════════
  CONTEÚDO DO PACOTE
═══════════════════════════════════════════════════════════════

Este pacote contém SOMENTE a versão APROVADA vigente de cada documento
do processo (R9 / SEM-072). Rascunhos, documentos em revisão e versões
substituídas NÃO são incluídos — aparecem abaixo como "não incluídos".
Documento sem versão aprovada deve ser aprovado no sistema antes da
publicação.

${contentListing}

═══════════════════════════════════════════════════════════════
  INSTRUÇÕES DE PUBLICAÇÃO
═══════════════════════════════════════════════════════════════
`;

  if (platform) {
    content += `
Este pacote foi preparado especificamente para a plataforma:
${platform.name}

Os documentos foram adaptados automaticamente para atender aos
requisitos específicos desta plataforma.

Para publicar:
1. Acesse ${platform.websiteUrl || "a plataforma"}
2. Faça login com suas credenciais
3. Siga o checklist disponível no sistema LiciGov Pro
4. Anexe os documentos deste pacote conforme solicitado
`;
  } else {
    content += `
Este pacote foi gerado em formato padrão.

Para publicar:
1. Acesse a plataforma de licitação escolhida
2. Siga as instruções específicas da plataforma
3. Anexe os documentos conforme necessário
`;
  }

  content += `
═══════════════════════════════════════════════════════════════
  OBSERVAÇÕES IMPORTANTES
═══════════════════════════════════════════════════════════════

- Os documentos estão em PDF; se a conversão falhar, o conteúdo segue em
  Markdown (.md) — a extensão sempre corresponde ao formato real
- A planilha de itens está em formato XLSX (Excel)
- Confira o sha256 de cada arquivo listado acima para garantir integridade
- Revise todos os documentos antes de publicar
- Verifique se os valores e quantidades estão corretos
- Consulte o checklist no sistema para não esquecer nenhum passo

═══════════════════════════════════════════════════════════════
  SUPORTE
═══════════════════════════════════════════════════════════════

Em caso de dúvidas, consulte o sistema LiciGov Pro ou entre em
contato com o suporte técnico.

Gerado automaticamente por LiciGov Pro
`;

  return content;
}
