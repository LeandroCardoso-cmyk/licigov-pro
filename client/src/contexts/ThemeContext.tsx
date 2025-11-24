import React, { createContext, useContext, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme?: () => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: ThemeProviderProps) {
  const { user } = useAuth();
  const updateThemeMutation = trpc.auth.updateTheme.useMutation();
  
  const [theme, setTheme] = useState<Theme>(() => {
    if (switchable) {
      // Prioridade: 1. User DB, 2. localStorage, 3. defaultTheme
      if (user?.theme && user.theme !== "system") {
        return user.theme as Theme;
      }
      const stored = localStorage.getItem("theme");
      return (stored as Theme) || defaultTheme;
    }
    return defaultTheme;
  });

  // Sincronizar com preferência do usuário no banco
  useEffect(() => {
    if (switchable && user?.theme && user.theme !== "system") {
      setTheme(user.theme as Theme);
    }
  }, [user?.theme, switchable]);

  useEffect(() => {
    const root = document.documentElement;
    
    // Adicionar transição suave
    root.style.setProperty('transition', 'background-color 300ms ease-in-out, color 300ms ease-in-out');
    
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    if (switchable) {
      localStorage.setItem("theme", theme);
    }
  }, [theme, switchable]);

  const toggleTheme = switchable
    ? () => {
        const newTheme = theme === "light" ? "dark" : "light";
        setTheme(newTheme);
        
        // Salvar no banco de dados se usuário estiver logado
        if (user) {
          updateThemeMutation.mutate({ theme: newTheme });
        }
      }
    : undefined;

  // Atalho de teclado: Ctrl/Cmd + Shift + D
  useEffect(() => {
    if (!switchable || !toggleTheme) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        toggleTheme();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [switchable, toggleTheme, theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, switchable }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
