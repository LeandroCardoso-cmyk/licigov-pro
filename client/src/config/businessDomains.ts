/**
 * RC-1 — Registro canônico de navegação dos Business Domains.
 *
 * Fonte única da verdade para as rotas dos Business Domains, consumida pela Home
 * (Business Domain Portal), pela Sidebar e pelo App.tsx. Mantém o produto coeso e
 * evita divergência de caminhos. Dados puros (sem React) — testável isoladamente.
 *
 * IMPORTANTE (RC-1): não cria funcionalidade nova; apenas conecta o que já existe.
 * As telas legadas continuam existindo (compatibilidade), mas saem da navegação
 * principal — os caminhos abaixo apontam para os novos Business Domains.
 */

export interface BusinessDomainNav {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** Caminho canônico (novo Business Domain). */
  readonly path: string;
  /** Nome do ícone lucide-react (resolvido nos componentes). */
  readonly icon: string;
  readonly available: boolean;
  /** Caminho legado equivalente (mantido apenas para compatibilidade). */
  readonly legacyPath?: string;
}

/** Os 5 Business Domains principais do LiciGov Pro, na ordem de navegação. */
export const BUSINESS_DOMAIN_NAV: readonly BusinessDomainNav[] = [
  {
    id: "processo_licitatorio",
    title: "Processo Licitatório",
    description: "DFD → ETP → Pesquisa de Preços → TR → Edital, com recomendações e geração documental.",
    path: "/processos",
    icon: "FileText",
    available: true,
  },
  {
    id: "contratacao_direta",
    title: "Contratação Direta",
    description: "Dispensa e Inexigibilidade — eletrônico/presencial, justificativas, ratificação e publicação.",
    path: "/contratacao-direta",
    icon: "FileCheck",
    available: true,
    legacyPath: "/direct-contracts",
  },
  {
    id: "parecer_juridico",
    title: "Parecer Jurídico",
    description: "Caixa institucional do Procurador — receber, analisar, emitir, assinar e devolver pareceres.",
    path: "/parecer",
    icon: "Scale",
    available: true,
    legacyPath: "/parecer-juridico",
  },
  {
    id: "contratos",
    title: "Contratos",
    description: "Contratos, aditivos, apostilamentos e rescisões — nascimento por processo, direta ou externo.",
    path: "/contratos",
    icon: "ScrollText",
    available: true,
    legacyPath: "/contracts",
  },
  {
    id: "centro_operacoes",
    title: "Centro de Operações",
    description: "Consolida todos os domínios: painel, calendário, timeline, caixa de entrada e recomendações.",
    path: "/centro-operacoes",
    icon: "Gauge",
    available: true,
    legacyPath: "/gestao-departamento",
  },
];

/** Mapa id → caminho canônico. */
export const BUSINESS_DOMAIN_PATHS: Record<string, string> = Object.fromEntries(
  BUSINESS_DOMAIN_NAV.map((d) => [d.id, d.path]),
);

/** Caminhos legados que NÃO devem aparecer na navegação principal (só compatibilidade). */
export const LEGACY_PATHS: readonly string[] = BUSINESS_DOMAIN_NAV
  .map((d) => d.legacyPath)
  .filter((p): p is string => Boolean(p));

/** Ferramentas de apoio (não são Business Domains). */
export const TOOL_NAV: ReadonlyArray<{ id: string; title: string; path: string; icon: string }> = [
  { id: "templates", title: "Biblioteca de Templates", path: "/templates", icon: "LibraryBig" },
  { id: "configuracoes", title: "Configurações", path: "/configuracoes", icon: "Settings" },
];
