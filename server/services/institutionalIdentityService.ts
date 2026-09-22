/**
 * InstitutionalIdentityService — FONTE CANÔNICA COMPOSTA da identidade institucional.
 *
 * Elimina a duplicidade de fonte-da-verdade. A identidade que aparece nos documentos oficiais é
 * COMPOSTA por duas camadas, cada uma com um único dono:
 *
 *   1) CANÔNICA (tabela `organizations`) — atributos jurídicos da organização, já modelados e
 *      editáveis pela superfície governada de organização: `nome` (razão institucional), `cnpj`,
 *      `esfera`, `uf`, `municipio`. NUNCA duplicados em `documentSettings`.
 *
 *   2) EXTENSÃO DOCUMENTAL (tabela `documentSettings`, tenant-scoped) — atributos que a organização
 *      não possui e que só fazem sentido para a diagramação do documento: `logoUrl`, `address`
 *      (endereço institucional completo), `phone`, `email`, `website`, `footerText`.
 *
 * Todos os consumidores (geração, exportação DOCX/PDF, pacote de publicação) resolvem a identidade
 * por AQUI — nunca lendo `organizations` e `documentSettings` de forma independente e arbitrária.
 *
 * REPLAY/LINEAGE: `snapshotInstitutionalIdentity` congela a identidade resolvida (com um fingerprint
 * sha256 determinístico) no momento em que o artefato é produzido/emitido, para que a reexportação
 * reproduza EXATAMENTE o cabeçalho/rodapé vigente à época — mesmo que a identidade mude depois.
 */
import { createHash } from "node:crypto";
import { getOrganizationById, updateOrganization } from "../db/organizations";
import { getDocumentSettingsByOrg, upsertDocumentSettings } from "../db/collaboration";

/** Identidade institucional COMPOSTA (canônica + extensão documental). Todos os campos opcionais. */
export interface InstitutionalIdentity {
  organizationId: number;
  // Canônica (organizations)
  organizationName?: string;
  cnpj?: string;
  esfera?: string;
  uf?: string;
  municipio?: string;
  // Extensão documental (documentSettings)
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  footerText?: string;
}

/** Snapshot imutável da identidade + fingerprint determinístico (para replay/lineage). */
export interface InstitutionalIdentitySnapshot {
  snapshot: InstitutionalIdentity;
  fingerprint: string;
}

function clean(v: string | null | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Resolve a identidade institucional COMPOSTA de um tenant. Fonte única para geração/exportação.
 * Tolerante a falhas: campos ausentes viram `undefined` (o chamador degrada), nunca lança — preserva
 * o comportamento não-bloqueante das superfícies de documento.
 */
export async function resolveInstitutionalIdentity(organizationId: number): Promise<InstitutionalIdentity> {
  const [org, ext] = await Promise.all([
    getOrganizationById(organizationId),
    getDocumentSettingsByOrg(organizationId),
  ]);
  return {
    organizationId,
    // Canônica — organizations é a ÚNICA fonte de nome/cnpj/esfera/uf/municipio
    organizationName: clean(org?.nome),
    cnpj: clean(org?.cnpj),
    esfera: clean(org?.esfera),
    uf: clean(org?.uf),
    municipio: clean(org?.municipio),
    // Extensão documental — documentSettings
    logoUrl: clean(ext?.logoUrl),
    address: clean(ext?.address),
    phone: clean(ext?.phone),
    email: clean(ext?.email),
    website: clean(ext?.website),
    footerText: clean(ext?.footerText),
  };
}

/**
 * Fingerprint determinístico (sha256) da identidade — chaves ordenadas, valores normalizados.
 * Não inclui `organizationId` (é o eixo do tenant, não conteúdo da identidade). Igual identidade →
 * igual fingerprint, independentemente de ordem de inserção.
 */
export function institutionalIdentityFingerprint(identity: InstitutionalIdentity): string {
  const fields: Array<keyof InstitutionalIdentity> = [
    "organizationName", "cnpj", "esfera", "uf", "municipio",
    "logoUrl", "address", "phone", "email", "website", "footerText",
  ];
  const canonical: Record<string, string> = {};
  for (const f of fields) {
    const v = identity[f];
    canonical[f] = typeof v === "string" ? v : "";
  }
  return createHash("sha256").update(`iid:${JSON.stringify(canonical)}`).digest("hex");
}

/**
 * Congela a identidade resolvida + fingerprint. Usado no momento da produção/emissão do artefato
 * para gravar o snapshot em `documents.metadata` / `official_documents.metadata` (colunas JSON já
 * existentes — sem pipeline paralelo, sem tabela nova).
 */
export async function snapshotInstitutionalIdentity(organizationId: number): Promise<InstitutionalIdentitySnapshot> {
  const snapshot = await resolveInstitutionalIdentity(organizationId);
  return { snapshot, fingerprint: institutionalIdentityFingerprint(snapshot) };
}

/**
 * Reidrata a identidade a partir de um snapshot gravado no `metadata` de um documento; se ausente
 * (documento legado, anterior ao snapshot), cai para a resolução AO VIVO por organização. É a leitura
 * REPLAY-SAFE que a exportação usa: prefere o histórico congelado, degrada para o vigente.
 */
export async function institutionalIdentityFromMetadataOrLive(
  metadata: Record<string, unknown> | null | undefined,
  organizationId: number,
): Promise<InstitutionalIdentity> {
  const snap = metadata?.["institutionalIdentitySnapshot"];
  if (snap && typeof snap === "object") {
    const s = snap as Record<string, unknown>;
    return {
      organizationId,
      organizationName: clean(s["organizationName"] as string | undefined),
      cnpj: clean(s["cnpj"] as string | undefined),
      esfera: clean(s["esfera"] as string | undefined),
      uf: clean(s["uf"] as string | undefined),
      municipio: clean(s["municipio"] as string | undefined),
      logoUrl: clean(s["logoUrl"] as string | undefined),
      address: clean(s["address"] as string | undefined),
      phone: clean(s["phone"] as string | undefined),
      email: clean(s["email"] as string | undefined),
      website: clean(s["website"] as string | undefined),
      footerText: clean(s["footerText"] as string | undefined),
    };
  }
  return resolveInstitutionalIdentity(organizationId);
}

/** Entrada da gravação governada da identidade (canônica + extensão), toda opcional. */
export interface SaveInstitutionalIdentityInput {
  organizationName?: string;
  cnpj?: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  footerText?: string;
}

/**
 * Grava a identidade institucional de forma GOVERNADA e SEM DUPLICIDADE:
 *  - `organizationName` (→ `organizations.nome`) e `cnpj` (→ `organizations.cnpj`) vão para a fonte
 *    CANÔNICA (`organizations`). Nunca para `documentSettings`.
 *  - `logoUrl`/`address`/`phone`/`email`/`website`/`footerText` vão para a EXTENSÃO documental
 *    (`documentSettings`, tenant-scoped).
 *
 * O RBAC (admin/owner), a auditoria e a validação ficam no router chamador. Aqui só a persistência,
 * separada por dono de campo — o que torna a divergência estruturalmente impossível (cada campo tem
 * uma única tabela). `organizations.nome` é NOT NULL: só é atualizado quando um nome não-vazio é
 * fornecido (nunca apagado por um formulário parcial).
 */
export async function saveInstitutionalIdentity(
  organizationId: number,
  input: SaveInstitutionalIdentityInput,
): Promise<void> {
  // 1) Canônica — organizations (só os campos fornecidos e não-vazios)
  const canonical: { nome?: string; cnpj?: string } = {};
  const nome = clean(input.organizationName);
  const cnpj = clean(input.cnpj);
  if (nome !== undefined) canonical.nome = nome;
  if (cnpj !== undefined) canonical.cnpj = cnpj;
  if (Object.keys(canonical).length > 0) {
    await updateOrganization(organizationId, canonical);
  }

  // 2) Extensão documental — documentSettings (tenant-scoped, upsert idempotente)
  await upsertDocumentSettings({
    organizationId,
    logoUrl: input.logoUrl,
    address: input.address,
    phone: input.phone,
    email: input.email,
    website: input.website,
    footerText: input.footerText,
  });
}
