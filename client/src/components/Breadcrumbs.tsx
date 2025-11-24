import { ChevronRight, Home } from "lucide-react";
import { Link } from "wouter";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

/**
 * Componente de Breadcrumbs para navegação hierárquica
 * 
 * Exemplo de uso:
 * <Breadcrumbs items={[
 *   { label: "Dashboard", href: "/dashboard" },
 *   { label: "Processos Licitatórios", href: "/processes" },
 *   { label: "Novo Processo" }
 * ]} />
 */
export function Breadcrumbs({ items, className = "" }: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center space-x-1 text-sm text-muted-foreground ${className}`}
    >
      {/* Home icon sempre presente */}
      <Link href="/dashboard" className="hover:text-foreground transition-colors">
        <Home className="h-4 w-4" />
        <span className="sr-only">Dashboard</span>
      </Link>

      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <div key={index} className="flex items-center space-x-1">
            <ChevronRight className="h-4 w-4" />
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="hover:text-foreground transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "text-foreground font-medium" : ""}>
                {item.label}
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );
}
