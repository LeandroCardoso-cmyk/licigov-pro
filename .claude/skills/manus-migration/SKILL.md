---
name: manus-migration
description: Use esta skill SEMPRE que qualquer tarefa tocar em autenticação, chamadas de IA/LLM, ou configuração de build (vite.config.ts) no LiciGov Pro. O projeto tem 3 dependências críticas da plataforma Manus que bloqueiam o funcionamento fora dela. Esta skill guia a migração segura de cada uma.
---

# Skill: Migração do Manus — Desacoplamento do LiciGov Pro

## Contexto
O LiciGov Pro foi desenvolvido na plataforma Manus e tem 3 dependências proprietárias que impedem
o funcionamento independente. Esta skill define o plano de migração seguro para cada uma.

---

## CRÍTICO 1 — Remover plugin Manus do Vite

**Arquivo:** `vite.config.ts`
**Impacto:** Build quebrado completamente fora da Manus.

### Diagnóstico
```typescript
// Procurar por estas linhas:
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
// e
vitePluginManusRuntime()  // no array plugins
```

### Fix (único passo)
```typescript
// ANTES
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
const plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime()];

// DEPOIS — remover import e remover da lista de plugins
const plugins = [react(), tailwindcss()];
// jsxLocPlugin() também pode ser removido se for dependência Manus
```

### Verificação pós-fix
```bash
pnpm vite build   # deve completar sem erros
pnpm dev          # deve iniciar Vite + Express sem erros
```

---

## CRÍTICO 2 — Substituir auth OAuth Manus por auth próprio

**Arquivo:** `server/_core/sdk.ts` (e `server/_core/oauth.ts`)
**Impacto:** Nenhum usuário consegue fazer login sem acesso à Manus.

### O que MANTER (já independente)
```typescript
// Em server/_core/sdk.ts — estas funções com jose são independentes:
export async function signSession(payload: SessionPayload): Promise<string>
export async function verifySession(token: string): Promise<SessionPayload>
// → MANTER sem alteração
```

### O que SUBSTITUIR
```typescript
// REMOVER: qualquer chamada a OAUTH_SERVER_URL
// Padrão Manus a remover:
const response = await fetch(`${ENV.oauthServerUrl}/webdev.v1.WebDevAuthPublicService/...`);

// REMOVER: getUserInfoWithJwt que chama endpoint Manus
async function getUserInfoWithJwt(token: string) { ... }
```

### Novo router de auth (criar em `server/routers/auth.ts`)
```typescript
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { router, publicProcedure, protectedProcedure } from '../_core/trpc';
import { signSession, verifySession } from '../_core/sdk';
import { db } from '../db';
import { users } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

export const authRouter = router({
  
  register: publicProcedure
    .input(z.object({
      email: z.string().email(),
      senha: z.string().min(8),
      nome: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const senhaHash = await bcrypt.hash(input.senha, 12);
      const [user] = await db.insert(users).values({
        email: input.email.toLowerCase(),
        senhaHash,
        nome: input.nome,
        role: 'user',
        criadoEm: new Date(),
      }).returning();
      
      const token = await signSession({ userId: user.id, email: user.email, role: user.role });
      ctx.res.cookie('session', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
      return { id: user.id, email: user.email, nome: user.nome };
    }),

  login: publicProcedure
    .input(z.object({
      email: z.string().email(),
      senha: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [user] = await db.select().from(users)
        .where(eq(users.email, input.email.toLowerCase()))
        .limit(1);
      
      if (!user || !await bcrypt.compare(input.senha, user.senhaHash)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Email ou senha incorretos' });
      }
      
      const token = await signSession({ userId: user.id, email: user.email, role: user.role });
      ctx.res.cookie('session', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
      return { id: user.id, email: user.email, nome: user.nome };
    }),

  logout: protectedProcedure
    .mutation(async ({ ctx }) => {
      ctx.res.clearCookie('session');
      return { ok: true };
    }),

  me: protectedProcedure
    .query(async ({ ctx }) => {
      return { id: ctx.user.userId, email: ctx.user.email, role: ctx.user.role };
    }),
});
```

### Simplificar `authenticateRequest` em `server/_core/context.ts`
```typescript
// NOVA versão — apenas JWT local, sem fallback Manus:
async function authenticateRequest(req: Request): Promise<User | null> {
  const token = req.cookies?.session;
  if (!token) return null;
  
  try {
    const payload = await verifySession(token);
    return { userId: payload.userId, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}
```

---

## CRÍTICO 3 — Substituir LLM Forge Manus por Gemini direto

**Arquivo:** `server/_core/llm.ts`
**Impacto:** Todas as gerações de documentos (DFD/ETP/TR/Edital) falham sem acesso à Manus.

### Manter a mesma assinatura pública
```typescript
// NÃO ALTERAR esta interface — os routers dependem dela:
export interface InvokeParams {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
}

export interface InvokeResult {
  text: string;
  tokensUsed?: number;
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult>
```

### Nova implementação interna com Gemini
```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ENV } from './env';

const genAI = new GoogleGenerativeAI(ENV.geminiApiKey);

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: params.systemPrompt,
  });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
    generationConfig: {
      maxOutputTokens: params.maxTokens ?? 8192,
      temperature: 0.2, // baixo para documentos jurídicos
    },
  });

  const text = result.response.text();
  return { text, tokensUsed: result.response.usageMetadata?.totalTokenCount };
}
```

### Adicionar `GEMINI_API_KEY` em `server/_core/env.ts`
```typescript
export const ENV = {
  // ... variáveis existentes ...
  geminiApiKey: process.env.GEMINI_API_KEY ?? (() => { 
    throw new Error('GEMINI_API_KEY não configurada'); 
  })(),
};
```

---

## Ordem de execução recomendada

```
Fase 1 (30min): Fix do Vite → projeto liga localmente
Fase 2 (2h):    Auth próprio → usuários conseguem fazer login
Fase 3 (1h):    LLM → Gemini → gerações de documentos voltam a funcionar
Fase 4 (30min): Criar .env.example documentando todas as variáveis
```

Não pular fases. Cada fase desbloqueia a seguinte.
