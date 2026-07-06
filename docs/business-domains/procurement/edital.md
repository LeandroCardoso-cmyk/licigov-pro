# Edital — Modalidade, Forma e Plataforma

> A etapa `NOTICE` só é habilitada **após a aprovação do TR**. O Edital é a
> consequência do processo — modalidade, forma e plataforma definem templates,
> cláusulas e cronograma automaticamente.

## 1. Pré-requisito: TR aprovado

O Edital nunca é elaborado antes do TR estar aprovado. O TR fornece o objeto, os
itens inteligentes aprovados, os CATMAT escolhidos e as especificações que
fundamentam o Edital.

## 2. Escolha da modalidade

Após aprovar o TR, o servidor escolhe a **modalidade**:

- **Pregão**
- **Concorrência**
- **Leilão**
- **Concurso**
- **Chamada Pública**
- **Credenciamento**
- **Registro de Preços**

O sistema **sugere** a modalidade adequada (com reasoning e apoio do Copiloto
Jurídico via `kernelAccessService`), mas a **escolha é do servidor**.

## 3. Escolha da forma

Em seguida, define-se a **forma**:

- **Eletrônico**
- **Presencial**

### 3.1 Forma presencial → justificativa legal automática

Se o servidor optar por **Presencial**, o sistema **gera automaticamente a
justificativa legal** exigida para a excepcionalidade, fundamentada na Lei
14.133/2021. A justificativa é um rascunho **revisável** — o servidor valida.

### 3.2 Forma eletrônica → escolha da plataforma

Se optar por **Eletrônico**, o sistema **pergunta a plataforma**:

- **Compras.gov**
- **BLL**
- **Licitanet**
- **Portal próprio**
- **Outra**

## 4. Aplicação de templates, cláusulas e regras

Definidas modalidade, forma e plataforma, o sistema **aplica automaticamente**:

- **templates** específicos da modalidade/plataforma;
- **cabeçalhos** oficiais da plataforma;
- **cláusulas** padronizadas e adequadas ao objeto;
- **cronograma** com prazos coerentes com a modalidade;
- **regras** da plataforma escolhida.

```
TR aprovado
    │
    ▼
escolher MODALIDADE  (Pregão, Concorrência, Leilão, Concurso,
    │                 Chamada Pública, Credenciamento, Registro de Preços)
    ▼
escolher FORMA
    ├── Presencial ──▶ gera justificativa legal automática (revisável)
    └── Eletrônico ──▶ escolher PLATAFORMA
                        (Compras.gov / BLL / Licitanet / Portal próprio / Outra)
    │
    ▼
aplica templates + cabeçalhos + cláusulas + cronograma + regras
    │
    ▼
Edital (rascunho) ──▶ servidor revisa ──▶ REVIEW ──▶ ISSUED
```

## 5. Papel dos copilotos

O **Copiloto Jurídico** e o **Agente de Contratação**, coordenados pelo
**Multi-Copilot Orchestrator**, participam automaticamente para:

- sugerir a modalidade e a forma adequadas;
- validar cláusulas e cronograma;
- sinalizar riscos (direcionamento, prazos incompatíveis, inconsistências).

Toda sugestão traz **reasoning, explainability, provenance e confidence**. Os
alertas **explicam** e **nunca bloqueiam**.

## 6. Estrutura do Edital

Conforme a Lei 14.133/2021, o Edital define: **modalidade**, **formato**
(Presencial/Eletrônico), **critério de julgamento** e **regime de contratação**.
A geração usa o **Institutional RAG** sobre a Lei 14.133/2021, sempre acessado
**via `kernelAccessService`** e produzido pelo pipeline oficial
`server/_core/llm.ts`. Toda saída inclui o aviso de revisão obrigatória.

## 7. Revisão, emissão e rastreabilidade

- O Edital é **editável, revisável e validado por humano** na etapa `REVIEW`.
- Após validação, o processo passa a `ISSUED` e, depois, `ARCHIVED`.
- Escolha de modalidade, forma, plataforma, geração de justificativa, aplicação
  de templates e aprovações ficam registradas na **Timeline append-only**.

> O sistema conduz e propõe; o servidor decide. Nunca gera o Edital fora do
> fluxo, nunca substitui a decisão humana, nunca oculta justificativas.
