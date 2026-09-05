import React from "react";
import type { LucideIcon } from "lucide-react";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/Breadcrumbs";
import { BackToDashboard } from "@/components/BackToDashboard";

/**
 * PageHeader — cabeçalho institucional CANÔNICO das páginas do LiciGov Pro
 * (V1 Visual Refinement).
 *
 * Unifica a faixa de topo que antes cada página montava à mão (breadcrumb + título
 * + descrição + voltar + ações). Garante mesma hierarquia tipográfica, respiro e
 * identidade em todo o produto — sem alterar rota, permissão ou fluxo.
 *
 * Identidade sutil do módulo via `icon` (accent institucional único, nunca paleta
 * própria por módulo). `status` recebe um Badge/estado ao lado do título; `actions`
 * recebe os controles principais da página.
 */

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  /** Ícone do módulo (identidade sutil) — accent institucional único. */
  icon?: LucideIcon;
  /** Mostra "Voltar" (histórico → fallback /dashboard) para detalhe/workspace/subfluxo. */
  showBack?: boolean;
  /** Ações principais da página (botões), alinhadas à direita. */
  actions?: React.ReactNode;
  /** Estado institucional ao lado do título (ex.: Badge de status). */
  status?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title, description, breadcrumbs, icon: Icon, showBack = false, actions, status, className = "",
}: PageHeaderProps) {
  return (
    <header className={`border-b border-border bg-card ${className}`}>
      <div className="container py-5">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <Breadcrumbs items={breadcrumbs} className="mb-2.5" />
        )}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-start gap-3">
            {showBack && <BackToDashboard variant="ghost" size="sm" className="-ml-2 mt-0.5 shrink-0" />}
            {Icon && (
              <span className="mt-0.5 hidden shrink-0 rounded-lg bg-primary/10 p-2 text-primary sm:inline-flex">
                <Icon className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
                {status}
              </div>
              {description && (
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
              )}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </header>
  );
}

/**
 * PageShell — casca de página institucional: fundo + PageHeader + área de conteúdo
 * com respiro consistente. Uso opcional (páginas podem compor PageHeader diretamente).
 */
export function PageShell({
  children, ...header
}: PageHeaderProps & { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <PageHeader {...header} />
      <div className="container py-6">{children}</div>
    </div>
  );
}
