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
import { ENV } from "./_core/env";

// ─── S3 client (lazy) ─────────────────────────────────────────────────────────

let _s3: S3Client | null = null;

/** Indica se o Storage Service está configurado (credenciais + bucket presentes). */
export function isStorageConfigured(): boolean {
  return Boolean(ENV.awsAccessKeyId && ENV.awsSecretAccessKey && ENV.awsS3Bucket);
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
export async function storageGet(
  relKey: string,
  expiresInSeconds = 3600
): Promise<{ key: string; url: string }> {
  const s3 = getS3();
  const key = normalizeKey(relKey);

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: ENV.awsS3Bucket, Key: key }),
    { expiresIn: expiresInSeconds }
  );

  return { key, url };
}

/**
 * Alias semântico de `storageGet` — URL assinada de download (contrato oficial).
 */
export async function storageSignedUrl(
  relKey: string,
  expiresInSeconds = 3600
): Promise<{ key: string; url: string }> {
  return storageGet(relKey, expiresInSeconds);
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
