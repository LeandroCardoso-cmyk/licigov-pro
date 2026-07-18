# Configuração de IA — provider e modelo (multi-provider)

O LiciGov Pro escolhe o **provider** e o **modelo** de IA por **variáveis de ambiente**, sem mudança
de código. Hoje o provider **Gemini** está implementado; **Claude** e **OpenAI** têm o contrato
preparado (Provider Adapter) e passam a funcionar quando seus adaptadores forem ativados.

## Variáveis de ambiente

| Variável | Valores | Default | Papel |
|---|---|---|---|
| `AI_PROVIDER` | `gemini` \| `claude` \| `openai` | `gemini` | Provider primário |
| `AI_MODEL` | id do modelo | modelo padrão do provider | Modelo do provider primário |
| `GEMINI_API_KEY` | chave | — | Credencial Gemini (implementado) |
| `ANTHROPIC_API_KEY` | chave | — | Credencial Claude (contrato preparado) |
| `OPENAI_API_KEY` | chave | — | Credencial OpenAI (contrato preparado) |

Modelos padrão por provider (em `server/config/ai.ts`):

- **gemini** → `gemini-flash-latest` (alias auto-atualizável — aponta sempre para o Flash estável atual)
- **claude** → `claude-sonnet-4-5`
- **openai** → `gpt-4o-mini`

> **Descobrir quais modelos a sua conta suporta:** `GEMINI_API_KEY="..." pnpm ai:models` (ou pelo
> GitHub: Actions → "Listar modelos de IA (manual)"). Modelos específicos podem ser descontinuados
> (ex.: `gemini-2.5-pro` sem free tier; `gemini-2.5-flash` saiu para contas novas) — por isso o padrão
> é um **alias** e o modelo é sobrescrevível por `AI_MODEL`.

## Exemplos

```bash
# Padrão (Gemini 2.5 Flash — free tier)
# (nada a configurar além de GEMINI_API_KEY)

# Escolher um Gemini melhor (requer billing/cota para o modelo):
AI_MODEL=gemini-2.5-pro

# Trocar de provider no futuro (quando o adaptador estiver ativo):
AI_PROVIDER=claude   ANTHROPIC_API_KEY=...
AI_PROVIDER=openai   OPENAI_API_KEY=...
```

## Como funciona (arquitetura)

- `server/config/ai.ts` — `resolveAiRuntime()` resolve `{ provider, model }` a partir do ambiente
  (puro e testável). `AI_CONFIG` expõe provider/modelo/credenciais.
- `server/_core/ai/providerAdapter.ts` — `getActiveProvider()` constrói o **provider primário**
  conforme `AI_CONFIG` (Gemini com o modelo configurado; Claude/OpenAI plugáveis). É o **único** ponto
  que instancia providers. Os Business Domains nunca escolhem provider.
- `server/_core/ai/gemini.ts` — recebe o `modelId` do adaptador (default `gemini-2.5-flash`).
- As políticas cognitivas (`server/domain/cognitiveTask.ts`) referenciam `AI_CONFIG.model` para o
  modelo primário — sem strings de modelo espalhadas pelo código.

## Ativar Claude/OpenAI no futuro

1. Implementar o adaptador correspondente em `server/_core/ai/` (hoje `placeholderProviders.ts`
   lança `ProviderNotImplemented`), seguindo o contrato `AIProvider`.
2. Registrar como `implemented: true` em `PROVIDER_ADAPTERS`.
3. Definir `AI_PROVIDER` + a chave do provider. Pronto — sem tocar nos Business Domains.

## Nota sobre cota (Gemini)

O `gemini-2.5-pro` **não** tem cota no free tier (`limit: 0` → erro `429`). Por isso o padrão é
`gemini-2.5-flash`. Para usar o `-pro`, habilite billing no projeto Google e defina
`AI_MODEL=gemini-2.5-pro`.
