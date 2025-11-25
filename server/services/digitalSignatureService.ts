import crypto from "crypto";

/**
 * Serviço de Assinatura Digital
 * Sistema simplificado de assinatura digital para validação jurídica de documentos
 */

/**
 * Gera hash SHA-256 do conteúdo do documento
 */
export function generateContentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Gera assinatura digital simulada (hash + chave privada simulada)
 * Em produção, usar certificado digital ICP-Brasil ou similar
 */
export function generateSignature(contentHash: string, userId: number): string {
  // Simula chave privada (em produção, usar certificado digital real)
  const privateKey = `PRIVATE_KEY_USER_${userId}_${process.env.JWT_SECRET}`;
  
  // Gera assinatura combinando hash do conteúdo com chave privada
  const signature = crypto
    .createHmac("sha256", privateKey)
    .update(contentHash)
    .digest("hex");
  
  return signature;
}

/**
 * Valida assinatura digital
 */
export function validateSignature(
  contentHash: string,
  signature: string,
  userId: number
): boolean {
  // Regenera assinatura esperada
  const expectedSignature = generateSignature(contentHash, userId);
  
  // Compara assinaturas (timing-safe comparison)
  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expectedSignature, "hex")
  );
}

/**
 * Gera informações de certificado simulado
 */
export function generateCertificateInfo(userName: string, userEmail: string | null) {
  const now = new Date();
  const validFrom = now.toISOString();
  const validUntil = new Date(now.getFullYear() + 3, now.getMonth(), now.getDate()).toISOString();
  
  return {
    issuer: "LiciGov Pro - Sistema de Assinatura Digital",
    subject: userName,
    subjectEmail: userEmail || "não informado",
    serialNumber: crypto.randomBytes(16).toString("hex"),
    validFrom,
    validUntil,
    algorithm: "SHA-256 with HMAC",
    keySize: 256,
  };
}

/**
 * Formata assinatura para exibição em documentos
 */
export function formatSignatureBlock(signature: {
  signedByName: string;
  signedByEmail: string | null;
  signedAt: Date;
  signature: string;
  contentHash: string;
}): string {
  const date = new Date(signature.signedAt).toLocaleString("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
  });
  
  return `
---

## 🔐 Assinatura Digital

**Assinado por:** ${signature.signedByName}  
**E-mail:** ${signature.signedByEmail || "Não informado"}  
**Data/Hora:** ${date}

**Hash do Documento (SHA-256):**  
\`${signature.contentHash}\`

**Assinatura Digital:**  
\`${signature.signature.substring(0, 64)}...\`

---

*Este documento foi assinado digitalmente. A assinatura garante a autenticidade e integridade do conteúdo.*
*Qualquer alteração no documento invalidará a assinatura.*
`;
}
