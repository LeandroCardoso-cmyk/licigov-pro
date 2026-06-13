---
name: doc-generation
description: Use esta skill ao implementar ou modificar qualquer geração de documento licitatório no LiciGov Pro — DFD, ETP, TR ou Edital. Cobre estrutura de prompt, validação de saída, persistência no banco e padrões de qualidade jurídica para Lei 14.133/2021.
---

# Skill: Geração de Documentos — DFD, ETP, TR, Edital

## Fluxo obrigatório: DFD → ETP → TR → Edital

Cada documento depende do anterior. O agente nunca pula etapas.

```
DFD (objeto + justificativa)
  ↓
ETP (viabilidade técnica + mercado)
  ↓
TR (especificações + habilitação + critérios)
  ↓
Edital (consolidação + modalidade + prazos)
```

---

## Arquitetura de geração (sempre via llm.ts)

```typescript
// Em server/routers/documentos.ts
import { invokeLLM } from '../_core/llm';

// NUNCA chamar GoogleGenerativeAI diretamente nos routers
// SEMPRE passar por invokeLLM para manter o provider intercambiável
```

---

## Estrutura de prompt para cada documento

### DFD — Documento de Formalização da Demanda
```typescript
const promptDFD = {
  systemPrompt: `Você é um especialista em licitações públicas com domínio da Lei 14.133/2021.
Gere um Documento de Formalização da Demanda (DFD) completo e juridicamente correto.
Responda APENAS em JSON válido, sem texto fora do JSON.
Schema de saída: ${JSON.stringify(dfdSchema)}`,

  prompt: `Dados do processo:
Órgão: ${processo.orgao}
Objeto: ${processo.objeto}
Justificativa da necessidade: ${processo.justificativa}
Valor estimado: ${processo.valorEstimado}
Exercício orçamentário: ${processo.exercicio}

Gere o DFD completo conforme art. 12, § 1º da Lei 14.133/2021.`
};
```

### ETP — Estudo Técnico Preliminar
```typescript
const promptETP = {
  systemPrompt: `Você é um especialista em licitações públicas com domínio da Lei 14.133/2021.
Gere um Estudo Técnico Preliminar (ETP) completo conforme art. 18 da Lei 14.133/2021.
Responda APENAS em JSON válido.
Schema: ${JSON.stringify(etpSchema)}`,

  prompt: `DFD aprovado:
${JSON.stringify(dfd)}

Dados complementares:
Modalidade pretendida: ${processo.modalidade}
Pesquisa de mercado (se houver): ${processo.pesquisaMercado}

Gere o ETP com todas as seções obrigatórias do art. 18.`
};
```

### TR — Termo de Referência
```typescript
const promptTR = {
  systemPrompt: `Você é um especialista em licitações públicas com domínio da Lei 14.133/2021.
Gere um Termo de Referência (TR) completo conforme art. 6º, XXIII da Lei 14.133/2021.
Responda APENAS em JSON válido.
Schema: ${JSON.stringify(trSchema)}`,

  prompt: `ETP aprovado:
${JSON.stringify(etp)}

Parâmetros do TR:
Critério de julgamento: ${processo.criterioJulgamento}
Regime de execução: ${processo.regimeExecucao}
Itens/serviços (CATMAT/CATSER): ${JSON.stringify(processo.itens)}

Gere o TR completo com: objeto, justificativa, especificações técnicas, 
obrigações das partes, modelo de proposta, habilitação, critério de julgamento,
estimativa de preços e dotação orçamentária.`
};
```

### Edital
```typescript
const promptEdital = {
  systemPrompt: `Você é um especialista em licitações públicas com domínio da Lei 14.133/2021.
Gere um Edital completo para a modalidade especificada.
Responda APENAS em JSON válido.
Schema: ${JSON.stringify(editalSchema)}`,

  prompt: `TR aprovado:
${JSON.stringify(tr)}

Parâmetros do Edital:
Modalidade: ${processo.modalidade}  // Pregão Eletrônico | Concorrência | Dispensa | etc.
Formato: ${processo.formato}        // Eletrônico | Presencial
Critério de julgamento: ${processo.criterioJulgamento}
Regime de contratação: ${processo.regimeContratacao}
Plataforma: ${processo.plataforma}  // BLL Compras | ComprasGov | etc.

Gere o edital completo com todas as cláusulas obrigatórias.`
};
```

---

## Schemas de validação Zod (saída da IA)

```typescript
const dfdSchema = z.object({
  numero: z.string(),
  objeto: z.string().min(50),
  justificativa: z.string().min(100),
  fundamentacaoLegal: z.string(),
  valorEstimado: z.number().positive(),
  dotacaoOrcamentaria: z.string(),
  responsavel: z.string(),
  dataElaboracao: z.string(),
});

const etpSchema = z.object({
  descricaoNecessidade: z.string(),
  descricaoResultadosPretendidos: z.string(),
  requisitosContratacao: z.string(),
  estimativaQuantidades: z.string(),
  levantamentoMercado: z.string(),
  descricaoSolucao: z.string(),
  estimativaPrecos: z.string(),
  justificativaModalidade: z.string(),
  declaracaoViabilidade: z.enum(['viável', 'inviável']),
  responsavelETP: z.string(),
});

const trSchema = z.object({
  objeto: z.string(),
  fundamentacao: z.string(),
  descricaoObjeto: z.string(),
  condicoesFornecimento: z.string(),
  modeloExecucao: z.string(),
  modeloGestao: z.string(),
  criteriosMedicaoPagamento: z.string(),
  formaSelecionarFornecedor: z.string(),
  estimativasPrecos: z.string(),
  adequacaoOrcamentaria: z.string(),
  habilitacaoJuridica: z.string(),
  qualificacaoTecnica: z.string(),
  qualificacaoEconomica: z.string(),
  regularidadeFiscal: z.string(),
});
```

---

## Persistência no banco

```typescript
// Tabela de processos (drizzle/schema.ts)
// Cada documento gerado deve ser salvo com:
// - processoId (FK)
// - tipoDocumento ('DFD' | 'ETP' | 'TR' | 'EDITAL')
// - conteudoJson (TEXT — JSON do documento)
// - conteudoEditado (TEXT — versão editada pelo usuário)
// - status ('rascunho' | 'aprovado' | 'publicado')
// - criadoEm, atualizadoEm

// Numeração de processos — SEMPRE usar transação atômica:
async function gerarNumeroProcesso(ano: number): Promise<string> {
  return await db.transaction(async (tx) => {
    const ultimo = await tx.select()
      .from(processos)
      .where(eq(sql`YEAR(criadoEm)`, ano))
      .orderBy(desc(processos.numero))
      .limit(1)
      .for('update'); // lock para evitar race condition
    
    const seq = ultimo.length > 0
      ? parseInt(ultimo[0].sequencial) + 1
      : 1;
    
    return `${ano}/${seq.toString().padStart(4, '0')}`;
  });
}
```

---

## Integração CATMAT/CATSER para itens do TR

```typescript
// Em server/services/catmat.ts
const BASE_URL = 'https://dadosabertos.compras.gov.br';

export async function buscarMaterial(descricao: string, pagina = 1) {
  const url = new URL(`${BASE_URL}/modulo-material/4_consultarItemMaterial`);
  url.searchParams.set('descricaoItem', descricao);
  url.searchParams.set('pagina', String(pagina));
  url.searchParams.set('tamanhoPagina', '10');
  url.searchParams.set('statusItem', 'true');
  
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`CATMAT API error: ${res.status}`);
  return res.json();
}

export async function buscarServico(descricao: string, pagina = 1) {
  const url = new URL(`${BASE_URL}/modulo-servico/6_consultarItemServico`);
  url.searchParams.set('descricaoItem', descricao);
  url.searchParams.set('pagina', String(pagina));
  url.searchParams.set('tamanhoPagina', '10');
  url.searchParams.set('statusItem', 'true');
  
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`CATSER API error: ${res.status}`);
  return res.json();
}
```

---

## Qualidade dos documentos gerados

### Checklist antes de entregar ao usuário
- [ ] Documento cita o artigo correto da Lei 14.133/2021?
- [ ] Modalidade está correta para o valor (Pregão para bens/serviços comuns; Concorrência para obras)?
- [ ] Critério de julgamento está compatível com o objeto?
- [ ] Habilitação inclui os 4 blocos obrigatórios (jurídica, técnica, econômica, fiscal)?
- [ ] Prazos mínimos legais respeitados?
- [ ] Dotação orçamentária referenciada?

### Avisos obrigatórios ao usuário
Sempre exibir após gerar qualquer documento:
> ⚠️ Documento gerado com auxílio de IA. Revisar antes de publicar. 
> O agente de contratação é responsável pela conformidade legal final.

---

## Documentos adicionais (além do fluxo DFD→ETP→TR→Edital)

### Parecer Jurídico
Tipos: inicial, de adjudicação, favorável, desfavorável.
```typescript
const promptParecer = {
  systemPrompt: `Você é um assessor jurídico especializado em licitações públicas.
Gere um parecer jurídico completo conforme a Lei 14.133/2021.
Responda APENAS em JSON válido. Schema: ${JSON.stringify(parecerSchema)}`,

  prompt: `Processo: ${JSON.stringify(processo)}
Tipo de parecer: ${tipoParecer}  // inicial | adjudicacao | favoravel | desfavoravel
Fundamento da decisão (se desfavorável): ${fundamento}`
};
```

### Contrato
Gerado a partir dos dados do processo licitatório — reaproveitamento de dados do TR/Edital.
```typescript
const promptContrato = {
  systemPrompt: `Você é especialista em contratos administrativos conforme Lei 14.133/2021 (art. 92-100).
Gere a minuta de contrato completa. Responda APENAS em JSON válido.`,

  prompt: `Edital: ${JSON.stringify(edital)}
Vencedor: ${JSON.stringify(dadosVencedor)}   // CNPJ, razão social, representante
Valor: ${valorContrato}
Prazo de execução: ${prazoExecucao}`
};
```

### Aditivo
```typescript
const promptAditivo = {
  systemPrompt: `Você é especialista em aditivos contratuais conforme Lei 14.133/2021.
Gere o termo aditivo. Responda APENAS em JSON válido.`,

  prompt: `Contrato original: ${JSON.stringify(contrato)}
Tipo de aditivo: ${tipoAditivo}  // prorrogacao | acrescimo | reequilibrio | supressao
Justificativa: ${justificativa}
Novo valor/prazo (se aplicável): ${novosDados}`
};
```

## Princípio central — sempre lembrar
Toda saída de IA deve ser **editável, revisável e validada por humano.**
O agente gera a estrutura; o servidor público assina a responsabilidade.
