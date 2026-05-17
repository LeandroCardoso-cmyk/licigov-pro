import { APP_ENV } from "./env";

/**
 * Configuração S3 por ambiente.
 *
 * Em staging: usa AWS_S3_BUCKET_STAGING se definido, senão o bucket padrão
 * com prefixo de chave "staging/" para isolamento lógico.
 * Em produção: usa AWS_S3_BUCKET sem prefixo.
 */
const bucketStaging = process.env.AWS_S3_BUCKET_STAGING ?? process.env.AWS_S3_BUCKET ?? "";
const bucketProduction = process.env.AWS_S3_BUCKET ?? "";

function resolveS3Bucket(): string {
  return APP_ENV === "staging" ? bucketStaging : bucketProduction;
}

export const AWS_CONFIG = {
  accessKeyId:     process.env.AWS_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  bucket:          resolveS3Bucket(),
  region:          process.env.AWS_S3_REGION ?? "us-east-1",
  publicUrl:       process.env.AWS_S3_PUBLIC_URL ?? "",

  /** True quando as credenciais mínimas para S3 estão presentes */
  isConfigured: !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    (process.env.AWS_S3_BUCKET ?? process.env.AWS_S3_BUCKET_STAGING)
  ),
};
