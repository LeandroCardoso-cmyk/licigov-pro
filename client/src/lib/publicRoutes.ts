/**
 * Classificação canônica de SUPERFÍCIES PÚBLICAS (pré-autenticação) do LiciGov Pro.
 *
 * Fonte ÚNICA para gatear roteamento e componentes que não devem aparecer fora da área
 * autenticada (ex.: o overlay de "Atalhos de Teclado", que pertence à aplicação operacional).
 * Centralizar aqui evita `pathname !== "..."` espalhados pela base e mantém um só lugar para
 * evoluir a lista de rotas públicas.
 *
 * Uma rota pública é aquela acessível SEM login — a landing institucional, o fluxo de
 * autenticação/convite, a solicitação de proposta comercial e as páginas legais canônicas
 * (`/privacidade`, `/termos`). Qualquer rota fora desta lista é tratada como área autenticada.
 */
export const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/register",
  "/esqueci-senha",
  "/redefinir-senha",
  "/convite",
  "/bem-vindo",
  "/solicitar-proposta",
  "/planos",
  "/privacidade",
  "/termos",
] as const;

export type PublicRoute = (typeof PUBLIC_ROUTES)[number];

/** Normaliza o pathname: descarta query/hash e barras finais, preservando a raiz "/". */
function normalizePathname(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/)[0];
  const trimmed = withoutQuery.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * `true` quando o pathname corresponde a uma superfície pública (pré-autenticação).
 * Comparação exata contra a lista canônica — não usa prefixo para não classificar
 * indevidamente sub-rotas autenticadas como públicas.
 */
export function isPublicRoute(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return (PUBLIC_ROUTES as readonly string[]).includes(path);
}
