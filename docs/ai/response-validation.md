# Response Validation — Validação de Respostas

## Visão Geral

O serviço de validação de respostas verifica a qualidade e confiabilidade de cada resposta gerada pelo RAG institucional. Detecta alucinações, contradições e afirmações sem suporte.

## Detecção de Alucinações

O sistema divide a resposta em sentenças e verifica a sobreposição de palavras significativas com as evidências fornecidas.

| Cobertura | Risco | Ação |
|-----------|-------|------|
| > 80% | none | Aprovação automática |
| 60-80% | low | Aprovação com alerta |
| 40-60% | medium | Revisão recomendada |
| 20-40% | high | Revisão obrigatória |
| < 20% | critical | Rejeição automática |

## Detecção de Contradições

Identifica sentenças na resposta que contêm padrões de negação ("não", "nunca", "nenhum", "jamais") enquanto as evidências afirmam o contrário. Sobreposição > 40% das palavras-chave indica contradição.

## Cobertura de Grounding

`groundingCoverage` mede a proporção de sentenças da resposta que possuem suporte em evidências (0-1). Valores baixos indicam resposta com pouca fundamentação.

## Utilização de Evidências

`evidenceUtilization` mede a proporção de evidências fornecidas que foram efetivamente referenciadas na resposta (0-1). Valores baixos indicam evidências descartadas.

## Determinação de Aprovação

Aprovação humana é **obrigatória** quando:
- Risco de alucinação é `high` ou `critical`
- Cobertura de grounding < 50%
- Score de confiança < 50%

## Resultado da Validação

| Resultado | Condição |
|-----------|---------|
| approved | Risco baixo, cobertura alta |
| needs_review | Aprovação humana necessária |
| rejected | Risco high/critical |
| insufficient_evidence | Nenhuma evidência fornecida |
