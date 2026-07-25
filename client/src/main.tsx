import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";
import { SELECTED_ORGANIZATION_ID_STORAGE_KEY } from "./const";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  // PR A.1 — preserva a página atual (ex.: /convite?token=... com a sessão expirada no meio do
  // aceite) como returnTo, para Login.tsx voltar o usuário para lá após reautenticar. Sem isto, a
  // navegação forçada para /login apagaria o token do convite da URL.
  const current = window.location.pathname + window.location.search;
  const returnTo = current === "/login" ? "" : `?returnTo=${encodeURIComponent(current)}`;
  window.location.href = `/login${returnTo}`;
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      // PR A.1 — lido quando o admin de plataforma escolhe "gerenciar" uma organização
      // específica (AdminOrganizacoes.tsx); sem isto, tenantProcedure sempre resolveria a
      // organização sintética padrão (id 1) para admins de plataforma.
      headers() {
        const selected = localStorage.getItem(SELECTED_ORGANIZATION_ID_STORAGE_KEY);
        return selected ? { "x-organization-id": selected } : {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
