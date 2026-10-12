import { afterAll, beforeAll } from "vitest";
import mysql from "mysql2/promise";

/**
 * Exclusão mútua ENTRE ARQUIVOS de teste que mutam estado GLOBAL (sem `organization_id`) no MySQL compartilhado.
 *
 * Alguns smokes manipulam tabelas de referência globais (ex.: `legal_reference_*`: instalam o reference set da
 * Lei 14.133 se ausente e o removem no fim; outros apagam a tabela inteira para provar a instalação a partir do zero).
 * Isso é arquiteturalmente STATEFUL: dois desses arquivos rodando ao mesmo tempo no mesmo banco colidem
 * (insert duplicado do set, set removido sob os pés do outro arquivo). Em vez de serializar a suíte inteira
 * (`--no-file-parallelism`), só os arquivos que declaram o mesmo recurso global se serializam entre si — os demais
 * continuam em paralelo.
 *
 * Mecanismo: `GET_LOCK` do MySQL numa conexão DEDICADA, mantida aberta durante o arquivo inteiro (o lock é da conexão:
 * se o processo morrer, o servidor libera). Sem `DATABASE_URL` não faz nada (os smokes já são `skipIf(!DATABASE_URL)`).
 *
 * Uso (no topo do arquivo, antes do `describe`):  `useGlobalFixtureLock("legal_reference");`
 */
export function useGlobalFixtureLock(resource: string, waitSeconds = 1500): void {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const lockName = `licigov_test_fixture:${resource}`;
  let lockConn: mysql.Connection | null = null;

  beforeAll(async () => {
    const conn = await mysql.createConnection(url);
    try {
      const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, ?) AS got", [lockName, waitSeconds]);
      if (Number(rows[0].got) !== 1) throw new Error(`Não obteve o lock de fixture global "${resource}" em ${waitSeconds}s (outro arquivo de teste o mantém).`);
    } catch (err) {
      await conn.end().catch(() => {});
      throw err;
    }
    lockConn = conn;
  }, (waitSeconds + 30) * 1000);

  afterAll(async () => {
    if (!lockConn) return;
    await lockConn.query("DO RELEASE_LOCK(?)", [lockName]).catch(() => {});
    await lockConn.end().catch(() => {});
    lockConn = null;
  });
}
