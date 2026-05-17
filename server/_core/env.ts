/**
 * Compatibilidade retroativa — re-exporta config centralizada.
 * Importadores existentes continuam funcionando sem alteração.
 * Novos módulos devem importar diretamente de "../config".
 */
import { APP_CONFIG } from "../config/app";
import { AWS_CONFIG } from "../config/aws";
import { AUTH_CONFIG } from "../config/auth";
import { AI_CONFIG } from "../config/ai";
import { IS_PRODUCTION } from "../config/env";

/** @deprecated Importe de "../config" diretamente */
export const ENV = {
  cookieSecret:        AUTH_CONFIG.cookieSecret,
  databaseUrl:         process.env.DATABASE_URL ?? "",
  ownerOpenId:         APP_CONFIG.ownerOpenId,
  isProduction:        IS_PRODUCTION,
  geminiApiKey:        AI_CONFIG.geminiApiKey,
  awsAccessKeyId:      AWS_CONFIG.accessKeyId,
  awsSecretAccessKey:  AWS_CONFIG.secretAccessKey,
  awsS3Bucket:         AWS_CONFIG.bucket,
  awsS3Region:         AWS_CONFIG.region,
  awsS3PublicUrl:      AWS_CONFIG.publicUrl,
};
