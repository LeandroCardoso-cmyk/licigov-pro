/**
 * SECURITY-02 — smokes MySQL: atos institucionais (emitir, aprovar/rejeitar revisão) exigem membership REAL e ativa em
 * `organization_members`. Os fixtures que exercitam esses atos registram o vínculo verdadeiro do ator (idempotente) e o
 * removem no fim — o guard nunca é afrouxado para o teste passar.
 */
type Exec = { execute: (sql: string, params?: unknown[]) => Promise<unknown> };

export async function seedRealMembership(conn: Exec, organizationId: number, userId: number, role = "manager"): Promise<void> {
  await conn.execute(
    "INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE role = VALUES(role), ativo = 1",
    [organizationId, userId, role],
  );
}

export async function removeRealMemberships(conn: Exec, organizationId: number, userIds: readonly number[]): Promise<void> {
  for (const userId of userIds) {
    await conn.execute("DELETE FROM organization_members WHERE organizationId = ? AND userId = ?", [organizationId, userId]);
  }
}
