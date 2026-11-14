/**
 * SECURITY-02 — fixture de AUTORIDADE INSTITUCIONAL para testes unitários que isolam a persistência.
 *
 * A autoridade é relida da fonte autoritativa (`tenantService.getMembership` fora da transação e
 * `tx.select(...).for("share")` dentro dela). Este fixture simula ESSA fonte: por padrão todo ator é membro REAL
 * ativo com papel `manager` no órgão consultado; `deny(userId)` remove a membership (ex.: admin de plataforma sem
 * vínculo, membro removido), e `setRole(userId, role)` altera o papel persistido. Nunca simula o papel do contexto.
 */
export interface AuthorityFixtureState {
  defaultRole: string | null;
  roles: Map<number, string | null>;
  lastLookup: { userId: number; organizationId: number } | null;
  /** Simula falha da fonte autoritativa (banco indisponível/erro de consulta). */
  failLookup: boolean;
}

export function createAuthorityFixture() {
  const state: AuthorityFixtureState = { defaultRole: "manager", roles: new Map(), lastLookup: null, failLookup: false };
  const membershipFor = (userId: number, organizationId: number) => {
    state.lastLookup = { userId, organizationId };
    if (state.failLookup) throw new Error("authority lookup failed (fixture)");
    const role = state.roles.has(userId) ? state.roles.get(userId)! : state.defaultRole;
    return role ? { id: 1000 + userId, organizationId, userId, role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() } : null;
  };
  /** Cadeia `select().from().where().limit().for()` usada pela releitura transacional. */
  const txSelect = () => ({
    from: () => ({ where: () => ({ limit: () => ({ for: async () => {
      const l = state.lastLookup;
      const m = l ? membershipFor(l.userId, l.organizationId) : null;
      return m ? [m] : [];
    } }) }) }),
  });
  return {
    state,
    getMembership: async (userId: number, organizationId: number) => membershipFor(userId, organizationId),
    txSelect,
    reset() { state.defaultRole = "manager"; state.roles.clear(); state.lastLookup = null; state.failLookup = false; },
    deny(userId: number) { state.roles.set(userId, null); },
    setRole(userId: number, role: string) { state.roles.set(userId, role); },
  };
}
