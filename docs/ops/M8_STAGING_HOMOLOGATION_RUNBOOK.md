# Runbook — Homologação E2E da rodada M8 em STAGING

Executor oficial: `pnpm homolog:e2e` (`server/__tests__/homologation/staging-homologation-e2e.test.ts` +
`scripts/homologation-e2e.ts`). Ele usa somente as APIs oficiais (login real, cookie de sessão, tRPC, RBAC do servidor).

## O que o executor faz (e o que não faz)
- Cria um processo sintético **NOVO** (`NNNN/AAAA`, NNNN de 1000 a 9999). O processo 2026/0001 nunca é reutilizado
  nem alterado: ele fica preservado como evidência histórica, junto com os 36 itens do leitor antigo.
- Na pesquisa de preços (M8-PRICE-IMPORT-001), faz a prévia do texto documental do caso real e espera 1 item,
  3 cotações, média R$ 4.000,00 e total R$ 40.000,00. Também envia um texto ambíguo e espera `PRECONDITION_FAILED`,
  sem nada gravado.
- No DFD (M8-AI-DFD-001), pede a sugestão de IA com o provider REAL do staging e espera texto sem "Pontuação de
  confiança", sem "Fatos utilizados" e sem `[REVISAR: 0.xx]`. Se a IA não produzir texto válido, espera recusa
  explícita com o DFD intacto. Nada é aceito no DFD.
- Jornada A: DFD → ETP → TR, com o TR emitido pelo **segundo** usuário (segregação de funções) → Edital BLL
  Revisão 2 → DOCX/PDF + replay.
- Jornadas B e C, mais o teste de isolamento entre órgãos.
- Guardas aplicadas ANTES de qualquer escrita:
  - destino só `https://licigov-pro-staging.up.railway.app`;
  - tenant só `homologacao-sintetica` (a organização 1 é recusada);
  - nenhum admin de plataforma e nenhum membro da organização 1.
- Senhas, cookies e tokens nunca são impressos nem gravados no relatório.

## Pré-requisitos (Owner)
1. Ter dois usuários **distintos**, membros ativos do tenant `homologacao-sintetica` (org 2), com papel operator ou
   superior. O usuário 2 emite o TR e, por isso, precisa de papel de emissão (manager ou superior).
2. A Revisão 2 BLL deve estar vinculada ao tenant sintético (binding `tb4240c06340d9182eb981`), sem alteração.
3. A máquina de execução precisa alcançar `licigov-pro-staging.up.railway.app` via HTTPS. A sessão da nuvem do Claude
   NÃO alcança o staging hoje: o egress é bloqueado.

## Execução numa máquina autorizada
```bash
git clone https://github.com/LeandroCardoso-cmyk/licigov-pro.git && cd licigov-pro
git checkout staging && git pull
corepack enable && pnpm install --frozen-lockfile

# Credenciais digitadas no terminal (não ficam no histórico do shell nem em arquivo):
read -r  -p "E-mail usuário 1 (elabora): " HOMOLOG_EMAIL;     export HOMOLOG_EMAIL
read -rs -p "Senha usuário 1: "            HOMOLOG_PASSWORD;  echo; export HOMOLOG_PASSWORD
read -r  -p "E-mail usuário 2 (emite): "   HOMOLOG_EMAIL_2;   export HOMOLOG_EMAIL_2
read -rs -p "Senha usuário 2: "            HOMOLOG_PASSWORD_2; echo; export HOMOLOG_PASSWORD_2

HOMOLOG_BASE_URL=https://licigov-pro-staging.up.railway.app \
HOMOLOG_EXERCICIO=2026 \
HOMOLOG_REPORT=homologacao-m8.json \
pnpm homolog:e2e

unset HOMOLOG_PASSWORD HOMOLOG_PASSWORD_2
```
Resultado esperado: todas as jornadas verdes. O arquivo `homologacao-m8.json` traz as métricas `PRICE_RESEARCH_M8`,
`DFD_AI`, `DFD`, `ETP`, `TR` (incluindo `structuredProposed`), as métricas do Edital e o modo "HTTP real (APIs
oficiais); não é homologação visual". Ele não contém credenciais.

## Depois da execução
- Envie o `homologacao-m8.json` (ou a saída `[HOMOLOGACAO]` do console) para registrar a evidência no Roadmap Mestre.
- Se houver falha, a saída do Vitest indica a etapa e o motivo. Nenhuma etapa grava dados fora do tenant sintético.
- A homologação **visual** (telas) continua sendo uma etapa separada. O executor não a substitui.
