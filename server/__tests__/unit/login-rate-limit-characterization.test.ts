/**
 * M8 pós-homologação — CARACTERIZAÇÃO do limitador de login (comportamento VIGENTE, mantido). Não é correção: mudar a contagem
 * (só falhas, chave IP+e-mail, bucket próprio do cadastro) é decisão de POLÍTICA de segurança do Owner — ver relatório.
 *
 * Demonstra o efeito observado em staging (27/10): o contador é por IP de origem, conta TODA tentativa (inclusive login correto)
 * e é compartilhado com o cadastro; atrás de um NAT (prefeitura com um IP público), o 6º login legítimo em 15 min é recusado.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { checkRateLimit, resetRateLimit, RATE_LIMITS } from "../../services/rateLimiter";

const NAT_IP = "ip:203.0.113.10";

beforeEach(() => { resetRateLimit(NAT_IP, "login"); resetRateLimit("ip:203.0.113.11", "login"); });

describe("limitador de login — comportamento vigente (caracterização)", () => {
  it("política vigente: 5 tentativas por 15 minutos", () => {
    expect(RATE_LIMITS.login).toMatchObject({ max: 5, windowMs: 15 * 60 * 1000 });
  });

  it("NAT: cinco servidores DIFERENTES entrando com sucesso pelo mesmo IP esgotam a cota; o sexto é recusado", () => {
    const results = Array.from({ length: 6 }, () => checkRateLimit(NAT_IP, "login").allowed);
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it("outro IP não é afetado (a chave é o IP de origem, não a conta)", () => {
    for (let i = 0; i < 6; i++) checkRateLimit(NAT_IP, "login");
    expect(checkRateLimit("ip:203.0.113.11", "login").allowed).toBe(true);
  });

  it("o middleware conta ANTES do handler (sucesso e falha contam igual) e o cadastro usa o MESMO bucket do login", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../routers/authRouter.ts"), "utf8");
    expect(src.match(/\.use\(rateLimitMiddleware\("login"\)\)/g)?.length).toBe(2);
    const mw = fs.readFileSync(path.join(__dirname, "../../services/rateLimiter.ts"), "utf8");
    expect(mw).toMatch(/const result = checkRateLimit\(identifier, limitType\);[\s\S]*return next\(\);/);
  });
});
