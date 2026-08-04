/**
 * PR B.2.1 — Ingestão canônica: utilidades de upload seguro.
 *
 * Responsabilidades (todas server-side, sem confiar no cliente):
 *  - sniffing de conteúdo por magic bytes (valida o conteúdo real, não só a extensão);
 *  - construção de chave de storage à prova de path traversal (nome NUNCA vem do cliente cru);
 *  - guarda de feature flag tenant-aware (ingestão canônica desabilitada por padrão).
 *
 * Não persiste nada no domínio. Não expõe URLs, credenciais nem conteúdo em logs.
 */
import { createHash, type Hash } from "crypto";
import { nanoid } from "nanoid";
import { Transform, PassThrough, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { TRPCError } from "@trpc/server";
import { isFeatureEnabled } from "./featureFlagService";
import { storagePutStream, storageDelete } from "../storage";
import { serviceLogger } from "./observabilityService";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  detectParserType,
  type ParserType,
} from "../domain/importTypes";

const log = serviceLogger("IngestionUploadService");

/** Flag tenant-aware que habilita a superfície de ingestão canônica. Default: desabilitada. */
export const CANONICAL_INGESTION_FLAG = "FF_CANONICAL_INGESTION";

/**
 * Bloqueia (FORBIDDEN) quando a ingestão canônica não está habilitada para o tenant.
 * `isFeatureEnabled` retorna false na ausência de flag → fail-closed por padrão.
 */
export async function assertCanonicalIngestionEnabled(organizationId: number): Promise<void> {
  const enabled = await isFeatureEnabled(CANONICAL_INGESTION_FLAG, organizationId);
  if (!enabled) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Ingestão canônica não habilitada para esta organização.",
    });
  }
}

// ─── Content sniffing (magic bytes) ─────────────────────────────────────────────

export type ContentCategory = "pdf" | "zip" | "ole" | "text" | "unknown";

/** Categorias de conteúdo compatíveis com cada ParserType detectado por mime/extensão. */
const PARSER_CONTENT_COMPAT: Record<ParserType, ContentCategory[]> = {
  pdf:  ["pdf"],
  docx: ["zip"],            // DOCX é um container ZIP (OOXML)
  xlsx: ["zip"],            // XLSX é um container ZIP (OOXML)
  xls:  ["ole"],            // XLS legado é um container OLE/CFB
  csv:  ["text"],
  auto: ["pdf", "zip", "ole", "text"],
};

/** Detecta a categoria de conteúdo do buffer pelos primeiros bytes (magic numbers). */
export function sniffContent(buffer: Buffer): ContentCategory {
  if (buffer.length < 4) return "unknown";

  // %PDF-
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "pdf";
  }
  // ZIP (PK\x03\x04 / PK\x05\x06 / PK\x07\x08) → OOXML (xlsx/docx)
  if (buffer[0] === 0x50 && buffer[1] === 0x4b &&
      (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)) {
    return "zip";
  }
  // OLE/CFB (D0 CF 11 E0 A1 B1 1A E1) → xls/doc legado
  if (buffer.length >= 8 &&
      buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0 &&
      buffer[4] === 0xa1 && buffer[5] === 0xb1 && buffer[6] === 0x1a && buffer[7] === 0xe1) {
    return "ole";
  }
  // Texto (CSV): sem magic — heurística. Amostra sem bytes NUL e decodificável como UTF-8.
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (!sample.includes(0x00)) {
    try {
      const dec = new TextDecoder("utf-8", { fatal: true });
      dec.decode(sample);
      return "text";
    } catch {
      /* não é UTF-8 limpo */
    }
  }
  return "unknown";
}

// ─── Validação de upload ────────────────────────────────────────────────────────

export interface UploadValidationInput {
  buffer:         Buffer;
  declaredMime:   string;
  fileName:       string;
  /** Checksum sha256 declarado pelo cliente (verificado contra o real). Opcional. */
  declaredChecksum?: string;
  /** Tamanho declarado na criação da sessão (verificado). Opcional. */
  expectedSize?:  number;
}

export interface UploadValidationResult {
  checksum:   string;
  size:       number;
  parserType: ParserType;
  category:   ContentCategory;
}

/**
 * Valida o upload de forma estrita e server-side. Lança TRPCError em qualquer inconformidade.
 * Nunca coloca conteúdo do arquivo na mensagem de erro.
 */
export function validateUploadContent(input: UploadValidationInput): UploadValidationResult {
  const { buffer, declaredMime, fileName } = input;

  if (buffer.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Arquivo vazio." });
  }
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: `Arquivo excede ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`,
    });
  }

  const parserType = detectParserType(declaredMime, fileName);
  if (!parserType) {
    throw new TRPCError({ code: "UNSUPPORTED_MEDIA_TYPE", message: "Formato não suportado." });
  }

  const category = sniffContent(buffer);
  const compat = PARSER_CONTENT_COMPAT[parserType] ?? [];
  if (!compat.includes(category)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Conteúdo do arquivo não corresponde ao tipo declarado.",
    });
  }

  const checksum = createHash("sha256").update(buffer).digest("hex");

  if (input.declaredChecksum && input.declaredChecksum.toLowerCase() !== checksum) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Checksum divergente do arquivo enviado." });
  }
  if (input.expectedSize !== undefined && input.expectedSize !== buffer.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Tamanho divergente do declarado." });
  }

  return { checksum, size: buffer.length, parserType, category };
}

// ─── Chave de storage (anti path traversal) ─────────────────────────────────────

/** Sanitiza o nome de arquivo: descarta qualquer caminho e restringe o charset. */
export function sanitizeFileName(name: string): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/_{2,}/g, "_");
  const trimmed = cleaned.replace(/^[._]+/, "").slice(0, 120);
  return trimmed.length > 0 ? trimmed : "arquivo";
}

/**
 * Constrói a chave de storage da ingestão. O nome do objeto é SEMPRE gerado pelo servidor
 * (uuid + nome sanitizado) — o cliente nunca controla o caminho. Layout:
 *   imports/{orgId}/{yyyymmdd}/{uuid}-{safeName}
 */
export function buildIngestionStorageKey(
  organizationId: number,
  fileName:       string,
  now:            Date,
): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const safe = sanitizeFileName(fileName);
  return `imports/${organizationId}/${y}${m}${d}/${nanoid()}-${safe}`;
}

/** Reexport util: mimes aceitos (para validação de entrada no createSession). */
export function isAllowedMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_MIME_TYPES, mime);
}

// ─── Streaming: validação incremental + upload direto ao storage ────────────────

const SNIFF_BYTES = 16;

/**
 * Transform que valida o arquivo À MEDIDA que ele flui (streaming), sem nunca reter o
 * conteúdo completo em memória:
 *  - impõe o teto de tamanho DURANTE o streaming e aborta imediatamente ao exceder;
 *  - calcula o SHA-256 incrementalmente (autoridade do servidor);
 *  - valida magic bytes × MIME declarado assim que os primeiros bytes chegam;
 *  - repassa os chunks adiante (backpressure preservado pelo pipeline).
 */
class ValidationTransform extends Transform {
  private readonly hash: Hash = createHash("sha256");
  private bytes = 0;
  private head = Buffer.alloc(0);
  private validated = false;
  private _checksum = "";

  constructor(private readonly opts: { maxBytes: number; declaredMime: string; fileName: string }) {
    super();
  }

  private validateHead(): TRPCError | null {
    const parserType = detectParserType(this.opts.declaredMime, this.opts.fileName);
    if (!parserType) return new TRPCError({ code: "UNSUPPORTED_MEDIA_TYPE", message: "Formato não suportado." });
    const category = sniffContent(this.head);
    const compat = PARSER_CONTENT_COMPAT[parserType] ?? [];
    if (!compat.includes(category)) {
      return new TRPCError({ code: "BAD_REQUEST", message: "Conteúdo do arquivo não corresponde ao tipo declarado." });
    }
    return null;
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null, data?: Buffer) => void): void {
    this.bytes += chunk.length;
    if (this.bytes > this.opts.maxBytes) {
      // Aborta imediatamente ao exceder o limite (não drena o resto do corpo).
      cb(new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: `Arquivo excede ${this.opts.maxBytes / 1024 / 1024}MB.` }));
      return;
    }
    this.hash.update(chunk);
    if (!this.validated) {
      if (this.head.length < SNIFF_BYTES) {
        this.head = Buffer.concat([this.head, chunk.subarray(0, SNIFF_BYTES - this.head.length)]);
      }
      if (this.head.length >= 8) {
        const err = this.validateHead();
        if (err) { cb(err); return; }
        this.validated = true;
      }
    }
    cb(null, chunk);
  }

  override _flush(cb: (err?: Error | null) => void): void {
    if (this.bytes === 0) { cb(new TRPCError({ code: "BAD_REQUEST", message: "Arquivo vazio." })); return; }
    if (!this.validated) {
      // Arquivo menor que 8 bytes: valida com o que há.
      const err = this.validateHead();
      if (err) { cb(err); return; }
    }
    this._checksum = this.hash.digest("hex");
    cb();
  }

  getChecksum(): string { return this._checksum; }
  getSize(): number { return this.bytes; }
}

export interface StreamUploadInput {
  source:            Readable;
  storageKey:        string;
  declaredMime:      string;
  fileName:          string;
  maxBytes?:         number;
  /** Checksum esperado (informado pelo cliente); apenas validado contra o SHA-256 do servidor. */
  declaredChecksum?: string;
}

export interface StreamUploadResult {
  checksum: string;
  size:     number;
}

/**
 * Faz o upload em STREAMING do `source` para o storage, validando durante o fluxo.
 * Nunca materializa o arquivo inteiro em memória (nem em base64). Em qualquer falha
 * (limite excedido, conteúdo inválido, interrupção do cliente, erro do storage), faz o
 * cleanup do objeto parcial em `finally`.
 */
export async function streamFileToStorage(input: StreamUploadInput): Promise<StreamUploadResult> {
  const maxBytes = input.maxBytes ?? MAX_FILE_SIZE_BYTES;
  const transform = new ValidationTransform({ maxBytes, declaredMime: input.declaredMime, fileName: input.fileName });
  const sink = new PassThrough();

  // Upload consome o `sink`; o pipeline empurra source → validação → sink com backpressure.
  const uploadPromise = storagePutStream(input.storageKey, sink, input.declaredMime);
  let ok = false;
  try {
    const results = await Promise.allSettled([
      pipeline(input.source, transform, sink),
      uploadPromise,
    ]);
    const failed = results.find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed) throw failed.reason;

    const checksum = transform.getChecksum();
    const size = transform.getSize();
    if (input.declaredChecksum && input.declaredChecksum.toLowerCase() !== checksum) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Checksum divergente do arquivo enviado." });
    }
    ok = true;
    return { checksum, size };
  } finally {
    if (!ok) {
      // Garante que uma eventual promise de upload não vire unhandled rejection.
      await uploadPromise.catch(() => {});
      await storageDelete(input.storageKey).catch(() => {});
      log.warn("ingestion_upload_partial_cleanup", { storageKey: input.storageKey });
    }
  }
}
