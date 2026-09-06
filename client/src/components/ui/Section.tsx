import React from "react";

/**
 * Section — agrupador institucional de NÍVEL 1 (V1 Visual Refinement).
 *
 * Reduz o efeito "caixas dentro de caixas": em vez de mais um Card com borda ao
 * redor de vários cards, o agrupamento vem de um CABEÇALHO de seção + espaçamento,
 * dando hierarquia sem adicionar outra superfície pesada. Os cards operacionais
 * (Nível 2) continuam existindo dentro da seção.
 *
 * Micro-Polish: o título recebe reforço moderado (peso/contraste/tracking + divisor
 * mais firme) para que o NÍVEL 1 seja percebido imediatamente — sem virar card, sem
 * fundo forte/gradiente e sem competir com o PageHeader (2xl). Hierarquia:
 * Page title → Section → Card/subsection → Label/metadado.
 */
export interface SectionProps {
  title: string;
  description?: string;
  /** Ação à direita do título da seção (opcional). */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Section({ title, description, action, children, className = "" }: SectionProps) {
  return (
    <section className={className}>
      <div className="mb-4 flex items-end justify-between gap-3 border-b border-border pb-2">
        <div className="min-w-0">
          <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">{title}</h2>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
