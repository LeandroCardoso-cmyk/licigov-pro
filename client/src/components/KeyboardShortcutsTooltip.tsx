import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Keyboard, X } from "lucide-react";

/**
 * Tooltip informativo sobre atalhos de teclado
 * Exibe apenas no primeiro acesso (localStorage)
 */
export function KeyboardShortcutsTooltip() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Verificar se já viu o tooltip
    const hasSeenTooltip = localStorage.getItem("hasSeenKeyboardShortcuts");
    
    if (!hasSeenTooltip) {
      // Mostrar após 2 segundos
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, []);

  const handleClose = () => {
    setIsVisible(false);
    localStorage.setItem("hasSeenKeyboardShortcuts", "true");
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 duration-500">
      <Card className="w-80 shadow-2xl border-2 border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Keyboard className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Atalhos de Teclado</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 -mt-1 -mr-1"
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <CardDescription>
            Navegue mais rápido com estes atalhos
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between py-1.5 border-b">
            <span className="text-muted-foreground">Voltar</span>
            <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">ESC</kbd>
          </div>
          <div className="flex items-center justify-between py-1.5 border-b">
            <span className="text-muted-foreground">Ir para Dashboard</span>
            <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">Ctrl+Home</kbd>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-muted-foreground">Alternar Tema</span>
            <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">Ctrl+Shift+D</kbd>
          </div>
          <Button
            onClick={handleClose}
            className="w-full mt-4"
            size="sm"
          >
            Entendi!
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
