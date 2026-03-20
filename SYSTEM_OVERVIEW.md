# LiciGov Pro — Visão Geral do Sistema

## 📌 Objetivo
O LiciGov Pro é um sistema SaaS para geração automática de documentos de licitação pública conforme a Lei 14.133/2021.

## ⚙️ Funcionalidade Principal
Gerar documentos essenciais de processos licitatórios com apoio de inteligência artificial.

## 📄 Fluxo de Documentos
1. DFD (Documento de Formalização da Demanda)
2. ETP (Estudo Técnico Preliminar)
3. TR (Termo de Referência)
4. Edital

## 🧠 Diferencial
O sistema gera documentos com alto nível técnico e jurídico, especialmente o TR, que permite:
- Uso de descrições baseadas em CATMAT/CATSER
- Padronização de itens
- Ajustes antes da finalização

## 🏗️ Arquitetura
- Frontend: React + Vite
- Backend: Express + tRPC
- Banco: MySQL/TiDB com Drizzle ORM
- API: /api/trpc

## ⚠️ Problemas conhecidos
- Erro na API (Failed to fetch)
- Dependência anterior do Manus

## 🎯 Objetivo atual
- Migrar para IA independente (Claude)
- Organizar arquitetura
- Escalar o sistema