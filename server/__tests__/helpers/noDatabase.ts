import { afterAll, beforeAll, vi } from "vitest";

/**
 * Contrato "SEM BANCO" de um arquivo de teste.
 *
 * Os testes de degradação graciosa (persistência que devolve null/[], serviços fail-closed, etc.) afirmam o
 * comportamento de `getDb() === null`. Esse comportamento NÃO pode depender do ambiente em que a suíte roda:
 * com `DATABASE_URL` definida (MySQL local/CI), `getDb()` conecta de verdade e o teste passaria a (a) afirmar
 * "sem banco" contra um banco real e (b) ESCREVER nele, com identificadores fixos, poluindo execuções futuras.
 *
 * Chamar `useNoDatabase()` no topo do arquivo garante, deterministicamente e só para ESTE arquivo, que
 * `DATABASE_URL` está vazia durante os testes — e a restaura no fim (nenhum vazamento para outros arquivos).
 * Arquivos que exercitam o MySQL real NÃO usam este helper (usam `describe.skipIf(!DATABASE_URL)`).
 */
export function useNoDatabase(): void {
  beforeAll(() => {
    vi.stubEnv("DATABASE_URL", "");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
}
