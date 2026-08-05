/**
 * RC-3.5 — Storage Service (componente PERMANENTE do Cognitive Kernel)
 *
 * ÚNICO ponto de acesso ao Amazon S3 em todo o LiciGov Pro. Nenhum outro módulo
 * (Document Engine, Business Domains, routers, healthcheck) pode falar diretamente
 * com a AWS: todo upload/download/delete/exists/signedUrl passa por aqui.
 *
 * Contrato oficial: upload, download, delete, exists, signedUrl, healthCheck.
 * Chaves organizadas por: {modulo}/{escopo}/{timestamp|id}-{filename}.
 * Nunca armazenar binários no banco — apenas referências (storageKey) + URL assinada.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import type { Readable } from "node:stream";
import { ENV } from "./_core/env";
import { IS_PRODUCTION, IS_STAGING } from "./config/env";

// ─── S3 client (lazy) ─────────────────────────────────────────────────────────

let _s3: S3Client | null = null;

/** Indica se o Storage Service está configurado (credenciais + bucket presentes). */
export function isStorageConfigured(): boolean {
  return Boolean(ENV.awsAccessKeyId && ENV.awsSecretAccessKey && ENV.awsS3Bucket);
}

export interface StorageReadiness {
  readonly configured: boolean;
  readonly fallbackAllowed: boolean;
  readonly bucketConfigured: boolean;
  readonly regionConfigured: boolean;
  readonly credentialsConfigured: boolean;
  readonly publicUrlConfigured: boolean;
}

/** Diagnóstico (somente leitura) da prontidão do Storage Service — não acessa a AWS. */
export function storageReadiness(): StorageReadiness {
  return {
    configured: isStorageConfigured(),
    fallbackAllowed: storageFallbackAllowed(),
    bucketConfigured: Boolean(ENV.awsS3Bucket),
    regionConfigured: Boolean(ENV.awsS3Region),
    credentialsConfigured: Boolean(ENV.awsAccessKeyId && ENV.awsSecretAccessKey),
    publicUrlConfigured: Boolean(ENV.awsS3PublicUrl),
  };
}

// ─── Storage Policy (RC-3.5.1) ────────────────────────────────────────────────
// A decisão sobre armazenamento vive EXCLUSIVAMENTE aqui. Nenhum Business Domain
// conhece esta política.
//
// - Development/Testes: é permitido usar Buffer/Base64 (facilita dev e a suíte).
// - Production/Staging: o Storage Service DEVE estar operacional. Sem storage, a
//   geração do documento oficial FALHA explicitamente — nunca há fallback para Base64.

/** true apenas em desenvolvimento/testes: permite fallback Base64 quando o storage não está configurado. */
export function storageFallbackAllowed(): boolean {
  return !IS_PRODUCTION && !IS_STAGING;
}

/**
 * Garante que o armazenamento é viável no ambiente atual. Em produção/staging sem
 * storage configurado, lança erro explícito (nunca inicia geração com base64).
 */
export function assertStorageUsable(): void {
  if (isStorageConfigured()) return;
  if (!storageFallbackAllowed()) {
    throw new Error(
      "Storage Service indisponível: em produção/staging o armazenamento é obrigatório para gerar documentos oficiais. Configure AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY e AWS_S3_BUCKET."
    );
  }
}

function getS3(): S3Client {
  if (!_s3) {
    if (!isStorageConfigured()) {
      throw new Error(
        "S3 storage is not configured. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET in .env"
      );
    }
    _s3 = new S3Client({
      region: ENV.awsS3Region,
      credentials: {
        accessKeyId: ENV.awsAccessKeyId,
        secretAccessKey: ENV.awsSecretAccessKey,
      },
    });
  }
  return _s3;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function buildPublicUrl(key: string): string {
  if (ENV.awsS3PublicUrl) {
    const base = ENV.awsS3PublicUrl.replace(/\/+$/, "");
    return `${base}/${key}`;
  }
  return `https://${ENV.awsS3Bucket}.s3.${ENV.awsS3Region}.amazonaws.com/${key}`;
}

// ─── Public API (contrato oficial do Storage Service) ─────────────────────────

/**
 * Upload de um arquivo para o S3.
 * Retorna a chave normalizada e a URL pública (ou pré-assinada).
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const s3 = getS3();
  const key = normalizeKey(relKey);
  const body = typeof data === "string" ? Buffer.from(data) : data;

  await s3.send(
    new PutObjectCommand({
      Bucket: ENV.awsS3Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  return { key, url: buildPublicUrl(key) };
}

/**
 * Gera uma URL de download pré-assinada para um objeto privado do S3.
 * Expira em 1 hora por padrão.
 */
export type StorageDisposition = "attachment" | "inline";

export async function storageGet(
  relKey: string,
  expiresInSeconds = 3600,
  /** Nome de download APRESENTADO ao usuário (Content-Disposition) — desacopla o
   * nome legível da chave interna técnica do storage. */
  downloadFileName?: string,
  /** "attachment" (baixar) ou "inline" (visualizar/imprimir no navegador). */
  disposition: StorageDisposition = "attachment"
): Promise<{ key: string; url: string }> {
  const s3 = getS3();
  const key = normalizeKey(relKey);

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: ENV.awsS3Bucket,
      Key: key,
      ...(downloadFileName
        ? { ResponseContentDisposition: `${disposition}; filename="${downloadFileName.replace(/"/g, "")}"` }
        : {}),
    }),
    { expiresIn: expiresInSeconds }
  );

  return { key, url };
}

/**
 * PR B.2.1 — Upload em STREAMING para o S3 (multipart via @aws-sdk/lib-storage).
 *
 * Consome um Readable e envia em partes (sem materializar o arquivo inteiro em memória) —
 * usado pela ingestão canônica para transmitir o binário direto do request para o storage.
 * Se o `body` for destruído com erro (limite excedido, interrupção do cliente), `done()`
 * rejeita e o multipart é abortado pela lib; o caller faz o cleanup do objeto parcial.
 */
export async function storagePutStream(
  relKey: string,
  body: Readable,
  contentType = "application/octet-stream",
): Promise<{ key: string }> {
  const s3 = getS3();
  const key = normalizeKey(relKey);
  const upload = new Upload({
    client: s3,
    params: { Bucket: ENV.awsS3Bucket, Key: key, Body: body, ContentType: contentType },
    queueSize: 4,
    partSize: 5 * 1024 * 1024, // 5 MB por parte (mínimo do S3)
    leavePartsOnError: false,   // aborta o multipart em erro (não deixa partes órfãs)
  });
  await upload.done();
  return { key };
}

/**
 * PR B.2.1 — Download server-side do objeto como Buffer (contrato oficial: "download").
 * Diferente de `storageGet` (que devolve URL assinada para o cliente), esta variante lê os
 * bytes no servidor — necessária para realimentar a fila de ingestão in-memory a partir do
 * storage durável (enqueueProcessing/retry replay-safe), sem trafegar binário pelo cliente.
 */
export async function storageGetBytes(relKey: string): Promise<Buffer> {
  const s3 = getS3();
  const key = normalizeKey(relKey);
  const out = await s3.send(
    new GetObjectCommand({ Bucket: ENV.awsS3Bucket, Key: key })
  );
  if (!out.Body) {
    throw new Error(`Objeto ausente ou vazio no storage: ${key}`);
  }
  const bytes = await (out.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
  return Buffer.from(bytes);
}

/**
 * Alias semântico de `storageGet` — URL assinada de download (contrato oficial).
 * `downloadFileName` (opcional) define o nome apresentado ao usuário, separado da
 * chave interna do storage; `disposition` alterna entre baixar e visualizar (impressão).
 */
export async function storageSignedUrl(
  relKey: string,
  expiresInSeconds = 3600,
  downloadFileName?: string,
  disposition: StorageDisposition = "attachment"
): Promise<{ key: string; url: string }> {
  return storageGet(relKey, expiresInSeconds, downloadFileName, disposition);
}

/**
 * Remove um objeto do S3. Idempotente (não falha se a chave não existir).
 */
export async function storageDelete(relKey: string): Promise<{ key: string; deleted: boolean }> {
  const s3 = getS3();
  const key = normalizeKey(relKey);
  await s3.send(new DeleteObjectCommand({ Bucket: ENV.awsS3Bucket, Key: key }));
  return { key, deleted: true };
}

/**
 * Verifica se um objeto existe no S3 (HEAD). Retorna false em qualquer erro
 * (objeto ausente ou acesso negado), nunca lança.
 */
export async function storageExists(relKey: string): Promise<boolean> {
  const key = normalizeKey(relKey);
  try {
    const s3 = getS3();
    await s3.send(new HeadObjectCommand({ Bucket: ENV.awsS3Bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Healthcheck do Storage Service (HEAD bucket). Retorna false se não configurado
 * ou se o bucket estiver inacessível. Usado pelo systemRouter — nunca acessar
 * o S3 diretamente fora deste módulo.
 */
export async function storageHealthCheck(): Promise<boolean> {
  if (!isStorageConfigured()) return false;
  try {
    const s3 = getS3();
    await s3.send(new HeadBucketCommand({ Bucket: ENV.awsS3Bucket }));
    return true;
  } catch {
    return false;
  }
}
