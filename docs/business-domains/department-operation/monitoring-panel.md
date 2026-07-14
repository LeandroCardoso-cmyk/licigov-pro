# Área 2 — Painel de Acompanhamento

> A **planilha inteligente** que substitui o controle manual dos departamentos.
> **1 linha = 1 contratação. Cada coluna = um marco operacional.**

## Propósito

Reproduzir, em versão viva e integrada, a planilha de acompanhamento que os departamentos
de licitações mantêm hoje. A informação vem **automaticamente** dos Business Domains sempre
que possível; a **edição manual existe apenas** onde o dado é externo ao sistema.

## Colunas (marcos operacionais)

| Coluna | Origem | Edição manual? |
|---|---|---|
| **Processo** | Processo Licitatório / Contratação Direta | Não |
| **Objeto** | Domínio de origem | Não |
| **Modalidade** | Domínio de origem | Não |
| **Etapa Atual** | Domínio de origem | Não |
| **DFD** | Processo Licitatório | Não |
| **ETP** | Processo Licitatório | Não |
| **Pesquisa de Preços** | Processo Licitatório | Não |
| **TR** | Processo Licitatório | Não |
| **Parecer Inicial** | Parecer Jurídico — enviado / data / recebido / retorno | Parcial |
| **Publicações** | Canais configuráveis — status + data (ver abaixo) | Parcial |
| **Sessão Pública** | data / hora / resultado | Sim (externo) |
| **Parecer Final** | Parecer Jurídico | Parcial |
| **Homologação** | data / observação | Sim (externo) |
| **Contrato** | Contratos — status / número / assinado | Parcial |
| **Aditivos** | Contratos — quantidade / último | Não |
| **Situação Geral** | Derivada (agregação de cores) | Não |

> **Regra de ouro:** o preenchimento manual serve **apenas** para informações **externas ao
> sistema** (data do certame, hora, resultado da sessão, homologação, assinatura).
> **Nunca duplicar** dado que já existe em um Business Domain.

## Código de cores

| Cor | Significado |
|---|---|
| 🟢 **Verde** | Concluído |
| 🟡 **Amarelo** | Em andamento |
| 🔵 **Azul** | Evento futuro |
| 🔴 **Vermelho** | Atrasado |
| ⚪ **Cinza** | Não iniciado |

A coluna **Situação Geral** deriva da agregação das cores dos marcos, dando o "pulso" da
contratação em um único olhar.

## Canais de publicação configuráveis

A coluna **Publicações** agrupa múltiplos canais, cada um com **status + data** (nunca mais
que isso — publicações **não** viram eventos de calendário):

- **PNCP** — Portal Nacional de Contratações Públicas → **padrão, sempre presente**.
- **Órgão Oficial do Município** → nome **configurável** por município.
- **Diário Oficial** → configurável.
- **Portal Eletrônico** → nome configurável por município.
- **Jornal de Grande Circulação** → nome configurável por município.

> Os **nomes dos órgãos não são fixos**. Cada município configura o seu Órgão Oficial, o seu
> Jornal e o seu Portal. Apenas o **PNCP é padrão** em todos os tenants.

Configuração é **multi-tenant**: os canais de um município nunca vazam para outro.

## Preenchimento automático vs. manual

1. **Automático (preferencial):** todo marco cujo dado exista em um Business Domain é
   resolvido por referência via Kernel Access Service. A célula reflete a fonte em tempo real.
2. **Manual (exceção):** apenas para marcos externos (sessão, homologação, assinatura, datas
   de publicação). Registrado com autoria e horário na **Timeline Operacional** (Área 4).

## Processos legados no painel

Contratações legadas e externas aparecem no painel como qualquer outra linha, alimentadas
por **OperationRecord** (ver `legacy-records.md`). Um município pode cadastrar a contratação
completa ou **apenas partes** (só o contrato, só o aditivo) — o painel exibe o que houver e
marca o restante como **Cinza (não iniciado)**.

## Garantias

- **Multi-tenant** e **replay-safe** (IDs `sha256`): reprocessar fontes não altera cores nem
  duplica marcos.
- Toda edição manual é rastreável (autoria + horário) na Timeline.
