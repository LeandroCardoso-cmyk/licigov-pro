/**
 * SW-C1 / SEM-083 — chave HMAC da assinatura digital via `server/config/signature` (sem `process.env` no serviço).
 *
 *  - ASSINAR: chave dedicada quando configurada; senão derivação LEGADA (JWT_SECRET) + aviso estruturado ÚNICO
 *    `signature_hmac_key_not_configured` (nunca falha — inclusive em produção, onde sobe para nível error);
 *  - VERIFICAR: chave dedicada PRIMEIRO, derivação legada como fallback TRANSITÓRIO (assinaturas já emitidas seguem
 *    verificáveis; nenhuma rotação é feita aqui); assinatura malformada/de outro usuário/de outro hash ⇒ falso, sem lançar;
 *  - chave configurada curta ⇒ erro de config (boot).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import { resolveSignatureKeyConfig, type SignatureKeyConfig } from "../../config/signature";
import {
  generateSignature, validateSignature, verifySignatureWithKeyInfo, generateContentHash, __resetSignatureKeyWarningForTests,
} from "../../services/digitalSignatureService";

const LEGACY_SECRET = "jwt-secret-legado-de-teste-com-mais-de-32-caracteres";
const DEDICATED = "chave-hmac-dedicada-de-teste-com-mais-de-32-caracteres";
const legacyOnly: SignatureKeyConfig = { dedicatedKey: null, legacySecret: LEGACY_SECRET };
const withDedicated: SignatureKeyConfig = { dedicatedKey: DEDICATED, legacySecret: LEGACY_SECRET };
/** Fórmula ANTERIOR (bit a bit): era o que assinava antes da SEM-083. */
const oldFormula = (hash: string, userId: number, secret: string) =>
  crypto.createHmac("sha256", `PRIVATE_KEY_USER_${userId}_${secret}`).update(hash).digest("hex");
const HASH = generateContentHash("conteúdo do parecer");

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  __resetSignatureKeyWarningForTests();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { warn.mockRestore(); error.mockRestore(); });
const logged = (spy: typeof warn) => spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("signature_hmac_key_not_configured"));

describe("SEM-083 — config/signature (resolução pura)", () => {
  it("chave dedicada válida é usada; ausente ⇒ null; segredo legado é o JWT_SECRET CRU (como antes)", () => {
    expect(resolveSignatureKeyConfig({ SIGNATURE_HMAC_KEY: ` ${DEDICATED} `, JWT_SECRET: " cru " })).toEqual({ dedicatedKey: DEDICATED, legacySecret: " cru " });
    expect(resolveSignatureKeyConfig({ JWT_SECRET: "x" }).dedicatedKey).toBeNull();
    expect(resolveSignatureKeyConfig({ SIGNATURE_HMAC_KEY: "   ", JWT_SECRET: "x" }).dedicatedKey).toBeNull();
    expect(resolveSignatureKeyConfig({}).legacySecret).toBe("undefined"); // idêntico ao template literal anterior
  });
  it("chave configurada porém curta (< 32) ⇒ erro de config", () => {
    expect(() => resolveSignatureKeyConfig({ SIGNATURE_HMAC_KEY: "curta", JWT_SECRET: "x" })).toThrow(/SIGNATURE_HMAC_KEY inválida/);
  });
});

describe("SEM-083 — assinar", () => {
  it("com chave dedicada: assina com ela (≠ derivação legada) e NÃO emite o aviso", () => {
    const sig = generateSignature(HASH, 7, withDedicated);
    expect(sig).not.toBe(oldFormula(HASH, 7, LEGACY_SECRET));
    expect(logged(warn) .length + logged(error).length).toBe(0);
  });
  it("sem chave dedicada: mantém a derivação legada bit a bit e emite UM aviso estruturado (uma vez)", () => {
    expect(generateSignature(HASH, 7, legacyOnly)).toBe(oldFormula(HASH, 7, LEGACY_SECRET));
    generateSignature(HASH, 8, legacyOnly);
    validateSignature(HASH, "00", 7, legacyOnly);
    const lines = logged(warn);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ level: "warn", service: "digitalSignatureService", operation: "signature_hmac_key_not_configured" });
  });
  it("determinístico por (hash, usuário, chave) e separado por usuário", () => {
    expect(generateSignature(HASH, 1, withDedicated)).toBe(generateSignature(HASH, 1, withDedicated));
    expect(generateSignature(HASH, 1, withDedicated)).not.toBe(generateSignature(HASH, 2, withDedicated));
  });
});

describe("SEM-083 — verificar (dedicada primeiro; legado como fallback transitório)", () => {
  it("assinatura nova (dedicada) valida com a chave dedicada", () => {
    const sig = generateSignature(HASH, 7, withDedicated);
    expect(verifySignatureWithKeyInfo(HASH, sig, 7, withDedicated)).toEqual({ valid: true, keyUsed: "dedicated" });
    expect(validateSignature(HASH, sig, 7, withDedicated)).toBe(true);
  });
  it("assinatura JÁ EMITIDA (derivação legada) continua verificável após configurar a chave dedicada", () => {
    const old = oldFormula(HASH, 7, LEGACY_SECRET);
    expect(verifySignatureWithKeyInfo(HASH, old, 7, withDedicated)).toEqual({ valid: true, keyUsed: "legacy_jwt_secret" });
    expect(validateSignature(HASH, old, 7, withDedicated)).toBe(true);
    expect(validateSignature(HASH, old, 7, legacyOnly)).toBe(true);
  });
  it("sem a chave dedicada, assinatura dedicada NÃO valida (a chave é necessária) — e vice-versa não há confusão de domínios", () => {
    const sig = generateSignature(HASH, 7, withDedicated);
    expect(validateSignature(HASH, sig, 7, legacyOnly)).toBe(false);
    expect(validateSignature(HASH, sig, 7, { dedicatedKey: "outra-chave-dedicada-com-mais-de-32-caracteres!", legacySecret: LEGACY_SECRET })).toBe(false);
  });
  it("outro usuário, outro hash, malformada ou de tamanho errado ⇒ falso, sem lançar", () => {
    const sig = generateSignature(HASH, 7, withDedicated);
    expect(validateSignature(HASH, sig, 8, withDedicated)).toBe(false);
    expect(validateSignature(generateContentHash("outro"), sig, 7, withDedicated)).toBe(false);
    for (const bad of ["", "zz", "abc", sig.slice(0, 10), `${sig}00`, "x".repeat(64)]) expect(validateSignature(HASH, bad, 7, withDedicated)).toBe(false);
  });
  it("produção sem chave dedicada: o comportamento segue funcionando (nunca falha) e o aviso é registrado", () => {
    expect(validateSignature(HASH, oldFormula(HASH, 3, LEGACY_SECRET), 3, legacyOnly)).toBe(true);
    expect(logged(warn).length + logged(error).length).toBe(1);
  });
});

describe("SEM-083 — guarda estática", () => {
  it("o serviço de assinatura NÃO lê process.env (config só via server/config/*) e documenta a chave no .env.example", () => {
    const src = fs.readFileSync("server/services/digitalSignatureService.ts", "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/process\.env/);
    expect(fs.readFileSync(".env.example", "utf-8")).toMatch(/SIGNATURE_HMAC_KEY/);
  });
});
