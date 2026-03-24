# Camada de Inteligência Artificial — LiciGov Pro

## 📌 Situação atual
O sistema utilizava integração com IA através do Manus para geração de documentos.

## ⚠️ Problema identificado
Dependência de fornecedor único (Manus), gerando risco operacional, como bloqueio de conta e indisponibilidade.

## 🎯 Objetivo
Criar uma camada de abstração de IA (LLM Provider), permitindo flexibilidade e independência.

## 🔄 Nova abordagem
Implementar um padrão de provider para IA, permitindo múltiplos provedores:

- Claude (principal)
- OpenAI (fallback)
- Outros no futuro

## 🧠 Estratégia técnica

Criar uma interface padrão para chamadas de IA, como:

- generateText()
- generateDocument()

Separando a lógica de negócio da implementação do provedor.

## 🧱 Benefícios

- Independência de fornecedor
- Redução de risco
- Facilidade de troca de IA
- Melhor controle de custos
- Maior estabilidade do sistema

## 🚀 Próximos passos

- Criar camada de provider no backend
- Migrar chamadas atuais de IA para essa camada
- Integrar Claude como principal provedor