import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

interface BackToDashboardProps {
  className?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}

/**
 * Componente reutilizável para botão "Voltar ao Dashboard"
 * Mantém consistência visual em todas as páginas
 */
export function BackToDashboard({ 
  className = "", 
  variant = "ghost",
  size = "default"
}: BackToDashboardProps) {
  const [, navigate] = useLocation();

  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => navigate("/dashboard")}
      className={className}
    >
      <ArrowLeft className="h-4 w-4 mr-2" />
      Voltar ao Dashboard
    </Button>
  );
}
