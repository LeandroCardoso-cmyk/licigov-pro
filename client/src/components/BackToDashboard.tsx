import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

interface BackToDashboardProps {
  className?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}

/**
 * Componente reutilizável para botão "Voltar"
 * Usa navegação inteligente:
 * - Se houver histórico, volta para a página anterior (navigate(-1))
 * - Se não houver histórico, vai para o dashboard
 * 
 * Isso permite fluxos como: Dashboard → Módulo → Funcionalidade
 * Ao clicar voltar em Funcionalidade, volta para Módulo (não para Dashboard)
 */
export function BackToDashboard({ 
  className = "", 
  variant = "ghost",
  size = "default"
}: BackToDashboardProps) {
  const [, navigate] = useLocation();

  const handleBack = () => {
    // Verifica se há histórico de navegação
    if (window.history.length > 1) {
      // Volta para a página anterior
      window.history.back();
    } else {
      // Se não há histórico, vai para o dashboard
      navigate("/dashboard");
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleBack}
      className={className}
    >
      <ArrowLeft className="h-4 w-4 mr-2" />
      Voltar
    </Button>
  );
}
