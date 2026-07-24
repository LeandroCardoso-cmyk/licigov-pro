/**
 * PR A.1 — Valida um `returnTo` antes de navegar para ele após o login. Sem isto, um `returnTo`
 * controlado por query string poderia apontar para um domínio externo (open redirect) — só um
 * caminho relativo começando com uma única barra é aceito.
 */
export function isSafeReturnTo(value: string | null | undefined): value is string {
  if (!value) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false; // protocol-relative — escaparia do domínio atual
  if (value.startsWith("/\\")) return false;
  return true;
}
