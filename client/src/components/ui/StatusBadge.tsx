import React from "react";
import { statusTone, type StatusTone } from "./statusStyles";

/**
 * StatusBadge — chip de status institucional CANÔNICO. Recebe o rótulo e o TOM
 * semântico; a cor (light/dark) vem da linguagem única em statusStyles. Mantém a
 * mesma representação para a mesma semântica em todos os módulos.
 */
export interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
  className?: string;
}

export function StatusBadge({ label, tone = "neutral", className = "" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone(tone)} ${className}`}
    >
      {label}
    </span>
  );
}
