import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export interface NavigationHistoryItem {
  path: string;
  label: string;
  timestamp: number;
}

const MAX_HISTORY_ITEMS = 5;
const STORAGE_KEY = "navigationHistory";

// Mapeamento de rotas para labels legíveis
const routeLabels: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/processos": "Processos Licitatórios",
  "/novo-processo": "Novo Processo",
  "/contracts": "Gestão de Contratos",
  "/contracts/new": "Novo Contrato",
  "/contracts/alerts": "Alertas de Contratos",
  "/direct-contracts": "Contratação Direta",
  "/direct-contracts/new": "Nova Contratação",
  "/direct-contracts/analytics": "Analytics",
  "/gestao-departamento": "Gestão do Departamento",
  "/admin": "Painel Admin",
  "/configuracoes": "Configurações",
  "/analytics": "Analytics",
};

function getRouteLabel(path: string): string {
  // Tentar match exato primeiro
  if (routeLabels[path]) {
    return routeLabels[path];
  }
  
  // Tentar match parcial (para rotas dinâmicas como /processo/123)
  if (path.startsWith("/processo/")) return "Detalhes do Processo";
  if (path.startsWith("/contracts/") && path !== "/contracts/new" && path !== "/contracts/alerts") {
    return "Detalhes do Contrato";
  }
  if (path.startsWith("/direct-contracts/") && path !== "/direct-contracts/new" && path !== "/direct-contracts/analytics") {
    return "Detalhes da Contratação";
  }
  
  // Fallback: capitalizar e remover barras
  return path
    .split("/")
    .filter(Boolean)
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" > ");
}

/**
 * Hook para rastrear histórico de navegação
 * Mantém as últimas 5 páginas visitadas em localStorage
 */
export function useNavigationHistory() {
  const [location] = useLocation();
  const [history, setHistory] = useState<NavigationHistoryItem[]>([]);

  // Carregar histórico do localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch (error) {
      console.error("Failed to load navigation history:", error);
    }
  }, []);

  // Atualizar histórico quando a rota mudar
  useEffect(() => {
    // Ignorar rotas de autenticação e landing page
    if (location === "/" || location === "/login") {
      return;
    }

    const newItem: NavigationHistoryItem = {
      path: location,
      label: getRouteLabel(location),
      timestamp: Date.now(),
    };

    setHistory(prev => {
      // Remover duplicatas (mesma rota)
      const filtered = prev.filter(item => item.path !== location);
      
      // Adicionar novo item no início
      const updated = [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);
      
      // Salvar no localStorage
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error("Failed to save navigation history:", error);
      }
      
      return updated;
    });
  }, [location]);

  return history;
}
