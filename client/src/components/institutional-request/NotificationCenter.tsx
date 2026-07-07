import React from "react";

/**
 * NotificationCenter — PRESENTATIONAL.
 *
 * Central de notificações institucionais. Apenas o canal "sistema" está
 * implementado; e-mail e WhatsApp são placeholders (infraestrutura preparada,
 * não ativa). Cada notificação nasce de um evento do Request Engine.
 */

export interface NotificationData {
  id: string;
  requestId: string;
  channel: "sistema" | "email" | "whatsapp";
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationCenterProps {
  notifications?: NotificationData[];
  onOpenRequest?: (requestId: string) => void;
  onMarkRead?: (id: string) => void;
}

const CHANNEL_META: Record<string, { label: string; implemented: boolean; className: string }> = {
  sistema: { label: "Sistema", implemented: true, className: "bg-indigo-100 text-indigo-800 ring-indigo-500/20" },
  email: { label: "E-mail", implemented: false, className: "bg-gray-100 text-gray-500 ring-gray-500/20" },
  whatsapp: { label: "WhatsApp", implemented: false, className: "bg-gray-100 text-gray-500 ring-gray-500/20" },
};

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const MOCK_NOTIFICATIONS: NotificationData[] = [
  {
    id: "ntf-1",
    requestId: "req-0001",
    channel: "sistema",
    title: "Resposta disponível: Parecer inicial — Pregão 014/2026",
    message: "O domínio Parecer Jurídico respondeu.",
    read: false,
    createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  },
  {
    id: "ntf-2",
    requestId: "req-0002",
    channel: "sistema",
    title: "Nova solicitação: Revisão de controle interno",
    message: "De Contratação Direta para Controle Interno.",
    read: true,
    createdAt: new Date(Date.now() - 4 * 3600_000).toISOString(),
  },
];

export default function NotificationCenter({
  notifications = MOCK_NOTIFICATIONS,
  onOpenRequest,
  onMarkRead,
}: NotificationCenterProps) {
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Notificações</h3>
          <p className="text-xs text-gray-500">Somente o canal “sistema” está ativo; demais são placeholders.</p>
        </div>
        {unread > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-500/20">
            {unread} não lida(s)
          </span>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="p-6 text-center text-xs text-gray-400">Nenhuma notificação.</p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {notifications.map((n) => {
            const channel = CHANNEL_META[n.channel] ?? CHANNEL_META.sistema;
            return (
              <li
                key={n.id}
                className={`flex gap-3 px-4 py-3 ${n.read ? "" : "bg-indigo-50/40"}`}
              >
                <span
                  aria-hidden
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-gray-200" : "bg-indigo-500"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${channel.className}`}>
                      {channel.label}
                      {!channel.implemented ? " (placeholder)" : ""}
                    </span>
                    <span className="ml-auto text-[11px] text-gray-400">{formatDateTime(n.createdAt)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenRequest?.(n.requestId)}
                    className="block text-left text-sm font-medium text-gray-900 hover:text-indigo-700"
                  >
                    {n.title}
                  </button>
                  <p className="text-xs text-gray-500">{n.message}</p>
                  {!n.read && onMarkRead && (
                    <button
                      type="button"
                      onClick={() => onMarkRead(n.id)}
                      className="mt-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      Marcar como lida
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
