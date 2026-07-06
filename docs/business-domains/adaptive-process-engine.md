# Adaptive Process Engine

**Sprint 5.0.1 — Business Domain Architecture & Modular Licensing Foundation**

O **Adaptive Process Engine** é um componente **oficial do Kernel Cognitivo
Compartilhado**. Ele monta dinamicamente os fluxos de cada Domínio de Negócio: o
domínio **define** o processo; o Kernel **executa**.

## 1. Princípio

> Cada Business Domain **define** etapas, documentos, exceções, obrigatoriedades,
> aprovações e copilotos predominantes. O **Kernel executa** esse fluxo.
> O domínio descreve o **QUÊ**; o Adaptive Process Engine implementa o **COMO**.

Isso evita que cada domínio reimplemente sua própria máquina de estados: existe
**um** motor de processos, no Kernel, parametrizado por definições declarativas
de domínio.

## 2. Por que pertence ao Kernel

- É infraestrutura de execução de fluxo — não regra de negócio específica.
- É compartilhado por todos os domínios (Licitação, Contratos, Parecer, etc.).
- Adicionar um novo domínio **não** exige um novo motor: basta uma nova
  **definição** de processo.
- Garante **determinismo** e **replay safety** uniformes em toda a plataforma.

## 3. O que o domínio define

Cada domínio fornece uma **definição de processo** declarativa:

| Elemento | Descrição | Exemplo (Processo Licitatório) |
|----------|-----------|--------------------------------|
| **Etapas** | Passos ordenados do fluxo. | DFD → ETP → Pesquisa de Preços → TR → Edital |
| **Documentos** | Artefatos gerados por etapa. | DFD (art. 12 §1º), ETP (art. 18), TR (art. 6º XXIII) |
| **Exceções** | Desvios possíveis do fluxo. | Retorno para ajuste do ETP |
| **Obrigatoriedades** | Campos/documentos exigidos. | Justificativa da demanda no DFD |
| **Aprovações** | Pontos de aprovação/assinatura. | Aprovação da autoridade competente |
| **Copilotos predominantes** | Copilotos ativos por etapa. | Copiloto de pesquisa de preços na etapa de Pesquisa |

Essa definição vive na entidade `adaptiveProcessEngine` (por domínio +
organização) e referencia serviços do Kernel (Document Engine, Approval Engine,
Copilot Infrastructure, etc.) — sempre via `kernelAccessService`.

## 4. Entidade `adaptiveProcessEngine`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | `char(64)` | ID SHA-256 determinístico. |
| `organizationId` | `char(64)` | Tenant. |
| `domainSlug` | `varchar` | Domínio dono da definição. |
| `definition` | `json` | Etapas, documentos, exceções, obrigatoriedades, aprovações, copilotos. |
| `version` | `int` | Versão da definição (versionamento). |
| `status` | `enum` | `draft` / `active` / `deprecated`. |
| `createdAt` / `updatedAt` | `timestamp` | Auditoria. |

## 5. Como o Kernel executa

```
Definição do Domínio (declarativa)
        │
        ▼
Adaptive Process Engine (Kernel)
        │  resolve etapa atual, valida obrigatoriedades,
        │  aciona documentos, aprovações e copilotos
        ▼
kernelAccessService ──► Workflow · Document · Approval ·
                        Copilot · Timeline · Audit Engines
        ▼
Estado do processo avançado (auditado, versionado, explicável)
```

O motor:

1. Lê a etapa atual do processo.
2. Valida obrigatoriedades declaradas.
3. Aciona os serviços do Kernel necessários (gerar documento, solicitar
   aprovação, ativar copiloto).
4. Registra tudo no Timeline e no Audit Engine.
5. Avança/retorna conforme etapas e exceções definidas.

## 6. Determinismo e replay safety

O Adaptive Process Engine é **determinístico**:

- Mesma definição + mesma entrada → mesma transição de estado.
- Transições e artefatos usam **IDs SHA-256 determinísticos** — reexecutar
  (replay) um processo produz os mesmos identificadores.
- O Replay Engine do Kernel pode reexecutar o histórico sem efeitos colaterais
  duplicados.
- Em falha de banco, `getDb()` garante **degradação graciosa** — o motor não
  corrompe estado; opera em modo restrito ou aborta com segurança.

## 7. Importante nesta sprint

A Sprint 5.0.1 **não** implementa fluxos de negócio. Ela estabelece o motor e a
entidade `adaptiveProcessEngine`. As **definições reais** de cada domínio
(DFD→ETP→TR→Edital, aditivos contratuais, pareceres, etc.) chegam nas Sprints
5.1–5.5 — sempre como **definições declarativas**, sem alterar o motor no Kernel.

## 8. Documentos relacionados

- [`kernel.md`](./kernel.md) · [`domains.md`](./domains.md) ·
  [`roadmap.md`](./roadmap.md) · [`architecture.md`](./architecture.md)
