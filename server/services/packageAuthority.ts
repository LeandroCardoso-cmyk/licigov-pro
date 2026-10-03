/**
 * R9 / SEM-072 — Autoridade documental dos PACOTES (ZIP) — núcleo PURO (sem DB, sem storage, sem conversor).
 *
 * Antes, os pacotes (publicação legado em `zipService.ts` e contratação direta em `directContractPackage.ts`)
 * empacotavam TODAS as linhas de documento do processo/contratação — rascunhos misturados a aprovados, versões
 * substituídas convivendo com a vigente — sob nomes fixos por tipo (colisão: a última entrada sobrescrevia as
 * demais no descompactador; tipo sem mapeamento virava entrada de nome VAZIO) e com Markdown gravado em arquivos
 * `.pdf`. Um pacote apresentado como "documentos para publicação" precisa conter SÓ o documento autoritativo.
 *
 * Contrato deste módulo:
 *   1. Por GRUPO documental (por padrão, o tipo) entra no máximo UM documento: a versão vigente dentre as
 *      OFICIAIS (maior `version`, desempate determinístico por `createdAt` e depois `id`). A política de cada
 *      fonte decide o que é oficial (ver `LEGACY_PUBLICATION_POLICY` / `DIRECT_CONTRACT_PACKAGE_POLICY`).
 *   2. Rascunhos NUNCA se misturam aos oficiais. Só a política que permite expressamente (contratação direta,
 *      cujo fluxo não tem tela de "finalizar") inclui o ÚLTIMO rascunho de um grupo SEM versão oficial, e ele vai
 *      para uma pasta separada e explicitamente nomeada como não oficial, com sufixo `_RASCUNHO`.
 *   3. Versões substituídas, rascunhos preteridos e status excluídos (arquivado/rejeitado) ficam FORA do pacote e
 *      são listados no manifesto (LEIA-ME) com o motivo — o pacote é auditável sem esconder o que existe.
 *   4. Nomes de arquivo são únicos e determinísticos: `NN_TIPO_vN.ext`; colisão residual ⇒ sufixo `_2`, `_3`…
 *      (comparação sem diferenciar maiúsculas — descompactadores em FS case-insensitive).
 *   5. A extensão reflete o CONTEÚDO real: só bytes com assinatura `%PDF-` são nomeados `.pdf`; Markdown é `.md`.
 */

import { createHash } from "crypto";

// ─── Seleção do documento autoritativo ────────────────────────────────────────

/** Classe de um status de documento perante a política de empacotamento. */
export type PackageStatusClass = "official" | "draft" | "excluded";

/** Campos mínimos de um documento candidato a entrar no pacote. */
export interface PackageCandidate {
  id: number;
  type: string;
  version: number;
  status: string;
  createdAt: Date | string | null;
  title?: string | null;
}

export interface PackageSelectionPolicy {
  /** Rótulo da fonte (aparece no manifesto). */
  readonly source: string;
  /** Classifica o status bruto da fonte. Status desconhecido DEVE ser tratado como não oficial. */
  classify(status: string): PackageStatusClass;
  /**
   * Quando um grupo NÃO tem versão oficial, incluir o último rascunho (em pasta separada e rotulada)?
   * `false` (padrão seguro): o grupo fica fora do pacote e é listado como pendente.
   */
  readonly includeLatestDraftWhenNoOfficial: boolean;
  /** Chave do grupo documental (default: o tipo). Ex.: tipo "outro" agrupa também pelo título. */
  groupKey?(doc: PackageCandidate): string;
}

export type PackageExclusionReason =
  | "versao_substituida"      // oficial mais antiga que a vigente do mesmo grupo
  | "rascunho_nao_oficial"    // rascunho (ou em revisão) — não é a versão oficial
  | "status_excluido";        // arquivado / rejeitado / status desconhecido

export interface PackageExclusion<T> {
  doc: T;
  reason: PackageExclusionReason;
}

export interface PackageSelection<T> {
  /** Um por grupo: a versão oficial vigente. Ordem determinística (grupo, depois id). */
  official: T[];
  /** Último rascunho de grupos SEM oficial — só quando a política permite. Nunca misturar com `official`. */
  draftsWithoutOfficial: T[];
  /** Tudo o que ficou fora, com o motivo (para o manifesto). */
  excluded: PackageExclusion<T>[];
}

function timeOf(v: Date | string | null): number {
  if (v === null) return 0;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Ordem "mais recente primeiro": maior versão, depois mais recente, depois maior id (determinístico). */
export function compareLatestFirst(a: PackageCandidate, b: PackageCandidate): number {
  if (a.version !== b.version) return b.version - a.version;
  const dt = timeOf(b.createdAt) - timeOf(a.createdAt);
  if (dt !== 0) return dt;
  return b.id - a.id;
}

function defaultGroupKey(doc: PackageCandidate): string {
  return doc.type;
}

/**
 * Seleciona, por grupo documental, o documento autoritativo segundo a política. Pura e determinística: a mesma
 * entrada (em qualquer ordem) produz a mesma seleção.
 */
export function selectAuthoritativeDocuments<T extends PackageCandidate>(
  docs: readonly T[],
  policy: PackageSelectionPolicy,
): PackageSelection<T> {
  const keyOf = policy.groupKey ?? defaultGroupKey;
  const groups = new Map<string, T[]>();
  for (const d of docs) {
    const k = keyOf(d);
    const g = groups.get(k);
    if (g) g.push(d);
    else groups.set(k, [d]);
  }

  const official: T[] = [];
  const draftsWithoutOfficial: T[] = [];
  const excluded: PackageExclusion<T>[] = [];

  for (const key of Array.from(groups.keys()).sort()) {
    const group = [...(groups.get(key) ?? [])].sort(compareLatestFirst);
    const officials = group.filter(d => policy.classify(d.status) === "official");
    const drafts = group.filter(d => policy.classify(d.status) === "draft");
    const dropped = group.filter(d => policy.classify(d.status) === "excluded");

    for (const d of dropped) excluded.push({ doc: d, reason: "status_excluido" });

    if (officials.length > 0) {
      official.push(officials[0]);
      for (const d of officials.slice(1)) excluded.push({ doc: d, reason: "versao_substituida" });
      for (const d of drafts) excluded.push({ doc: d, reason: "rascunho_nao_oficial" });
      continue;
    }
    if (policy.includeLatestDraftWhenNoOfficial && drafts.length > 0) {
      draftsWithoutOfficial.push(drafts[0]);
      for (const d of drafts.slice(1)) excluded.push({ doc: d, reason: "rascunho_nao_oficial" });
      continue;
    }
    for (const d of drafts) excluded.push({ doc: d, reason: "rascunho_nao_oficial" });
  }

  return { official, draftsWithoutOfficial, excluded };
}

/**
 * Pacote de PUBLICAÇÃO legado (`documents`). Versionamento por linha (cada save insere `version + 1`); a única
 * transição para oficial é a aprovação governada (`documentReviewService` → `documentStatus = "approved"`).
 * Publicação exige o aprovado: rascunho/em revisão NUNCA entra; arquivado/rejeitado são excluídos.
 */
export const LEGACY_PUBLICATION_POLICY: PackageSelectionPolicy = {
  source: "documents (legado)",
  classify(status: string): PackageStatusClass {
    if (status === "approved") return "official";
    if (status === "draft" || status === "in_review") return "draft";
    return "excluded"; // rejected / archived / desconhecido
  },
  includeLatestDraftWhenNoOfficial: false,
};

/**
 * Pacote PRESENCIAL de contratação direta (`direct_contract_documents`). Oficial = `final`. Cada geração insere
 * uma linha nova (versão quase sempre 1 — o desempate por `createdAt`/`id` decide a vigente). O fluxo não tem
 * tela de finalização, então o último rascunho de um tipo SEM final entra — separado em pasta não oficial e
 * rotulado. Tipo "outro" agrupa também pelo título (documentos avulsos distintos não se substituem).
 */
export const DIRECT_CONTRACT_PACKAGE_POLICY: PackageSelectionPolicy = {
  source: "direct_contract_documents",
  classify(status: string): PackageStatusClass {
    if (status === "final") return "official";
    if (status === "draft") return "draft";
    return "excluded"; // archived / desconhecido
  },
  includeLatestDraftWhenNoOfficial: true,
  groupKey(doc: PackageCandidate): string {
    return doc.type === "outro" ? `outro:${(doc.title ?? "").trim().toLowerCase()}` : doc.type;
  },
};

// ─── Nomes de arquivo ─────────────────────────────────────────────────────────

/** Segmento seguro para nome de arquivo: sem acento, só [A-Z0-9_], sem `_` nas pontas, tamanho limitado. */
export function sanitizeFileSegment(raw: string, maxLength = 60): string {
  const s = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase()
    .slice(0, maxLength)
    .replace(/_$/g, "");
  return s || "DOCUMENTO";
}

/**
 * Reserva nomes únicos dentro do pacote. Determinístico: dada a mesma sequência de pedidos, os mesmos nomes.
 * Colisão (sem diferenciar maiúsculas) ⇒ `BASE_2.ext`, `BASE_3.ext`…
 */
export class UniqueFileNamer {
  private readonly used = new Set<string>();

  claim(path: string): string {
    const slash = path.lastIndexOf("/");
    const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
    const file = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = file.lastIndexOf(".");
    const base = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : "";
    let candidate = `${dir}${base}${ext}`;
    for (let n = 2; this.used.has(candidate.toLowerCase()); n++) candidate = `${dir}${base}_${n}${ext}`;
    this.used.add(candidate.toLowerCase());
    return candidate;
  }
}

// ─── Formato real do conteúdo ─────────────────────────────────────────────────

/** Verdadeiro só para bytes com a assinatura de PDF (`%PDF-`). */
export function isPdfBytes(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ─── Manifesto ────────────────────────────────────────────────────────────────

export type PackageFileFormat = "pdf" | "md" | "xlsx" | "txt";

export interface PackageManifestEntry {
  path: string;
  label: string;
  format: PackageFileFormat;
  /** Status de origem (ex.: approved, final, draft). Vazio para anexos gerados (planilha). */
  status: string;
  version: number | null;
  sha256: string;
  bytes: number;
  /** `true` ⇒ não é versão oficial (só rascunhos explicitamente separados). */
  unofficial: boolean;
  note?: string;
}

export interface PackageOmission {
  label: string;
  version: number | null;
  status: string;
  reason: PackageExclusionReason | "sem_conteudo" | "arquivo_enviado_nao_incluido";
}

const OMISSION_TEXT: Record<PackageOmission["reason"], string> = {
  versao_substituida: "versão substituída pela vigente",
  rascunho_nao_oficial: "rascunho / não oficial",
  status_excluido: "status excluído (arquivado/rejeitado)",
  sem_conteudo: "sem conteúdo textual",
  arquivo_enviado_nao_incluido: "arquivo enviado (upload) — obtenha o original no sistema",
};

/** Listagem textual do conteúdo REAL do pacote (para o LEIA-ME). Determinística. */
export function renderManifestListing(entries: readonly PackageManifestEntry[], omissions: readonly PackageOmission[]): string {
  const lines: string[] = [];
  lines.push("ARQUIVOS INCLUÍDOS:");
  if (entries.length === 0) lines.push("  (nenhum documento incluído)");
  for (const e of entries) {
    const ver = e.version !== null ? ` · versão ${e.version}` : "";
    const st = e.status ? ` · status ${e.status}` : "";
    const flag = e.unofficial ? " · NÃO OFICIAL" : "";
    lines.push(`  • ${e.path} — ${e.label}${ver}${st}${flag} · ${e.format.toUpperCase()} · ${e.bytes} bytes`);
    lines.push(`      sha256: ${e.sha256}`);
    if (e.note) lines.push(`      obs.: ${e.note}`);
  }
  if (omissions.length > 0) {
    lines.push("");
    lines.push("NÃO INCLUÍDOS (existem no sistema, mas não são a versão autoritativa):");
    for (const o of omissions) {
      const ver = o.version !== null ? ` v${o.version}` : "";
      lines.push(`  • ${o.label}${ver} (${o.status}) — ${OMISSION_TEXT[o.reason]}`);
    }
  }
  return lines.join("\n");
}

// ─── Montagem das entradas de documento ───────────────────────────────────────

/** Documento já selecionado, com o conteúdo textual (Markdown) que o pacote deve materializar. */
export interface PackageDocumentInput extends PackageCandidate {
  content: string | null;
  /** Documento enviado como arquivo (sem conteúdo textual) — não é materializado aqui. */
  isUpload?: boolean;
}

export interface PackageNaming {
  /** Pasta (com `/` final) ou "" para a raiz. */
  folder: string;
  /** Prefixo de ordem + nome base do tipo, ex.: `02_ESTUDO_TECNICO_PRELIMINAR`. */
  baseName(doc: PackageDocumentInput): string;
  label(doc: PackageDocumentInput): string;
}

export interface BuiltPackageFile {
  path: string;
  data: Buffer;
  entry: PackageManifestEntry;
}

/**
 * Materializa os documentos selecionados em arquivos do pacote. `toPdf` (opcional) converte Markdown em PDF; o
 * resultado só é nomeado `.pdf` se os bytes forem PDF de fato — falha ou bytes não-PDF ⇒ o Markdown original
 * entra como `.md` (conteúdo preservado, extensão honesta). Sem `toPdf`, o Markdown entra como `.md`.
 */
export async function buildDocumentFiles(
  docs: readonly PackageDocumentInput[],
  naming: PackageNaming,
  namer: UniqueFileNamer,
  opts: { unofficial: boolean; nameSuffix?: string; toPdf?: (markdown: string, doc: PackageDocumentInput) => Promise<Buffer> },
): Promise<{ files: BuiltPackageFile[]; omissions: PackageOmission[] }> {
  const files: BuiltPackageFile[] = [];
  const omissions: PackageOmission[] = [];
  for (const doc of docs) {
    const label = naming.label(doc);
    const content = doc.content ?? "";
    if (content.trim() === "") {
      omissions.push({ label, version: doc.version, status: doc.status, reason: doc.isUpload ? "arquivo_enviado_nao_incluido" : "sem_conteudo" });
      continue;
    }
    const stem = `${naming.folder}${naming.baseName(doc)}_v${doc.version}${opts.nameSuffix ?? ""}`;
    let data: Buffer = Buffer.from(content, "utf-8");
    let format: PackageFileFormat = "md";
    let note: string | undefined;
    if (opts.toPdf) {
      try {
        const pdf = await opts.toPdf(content, doc);
        if (isPdfBytes(pdf)) { data = pdf; format = "pdf"; }
        else note = "conversão para PDF não produziu PDF válido — conteúdo original em Markdown";
      } catch {
        note = "conversão para PDF falhou — conteúdo original em Markdown";
      }
    }
    const path = namer.claim(`${stem}.${format}`);
    files.push({
      path,
      data,
      entry: { path, label, format, status: doc.status, version: doc.version, sha256: sha256Hex(data), bytes: data.length, unofficial: opts.unofficial, note },
    });
  }
  return { files, omissions };
}

/** Converte as exclusões da seleção em omissões do manifesto. */
export function exclusionsToOmissions<T extends PackageCandidate>(
  excluded: readonly PackageExclusion<T>[],
  label: (doc: T) => string,
): PackageOmission[] {
  return excluded.map(x => ({ label: label(x.doc), version: x.doc.version, status: x.doc.status, reason: x.reason }));
}
