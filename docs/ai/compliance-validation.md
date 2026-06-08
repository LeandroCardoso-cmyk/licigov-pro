# Compliance Validation

## Overview
Applies a configurable rule set to procurement documents and surfaces violations, warnings, and compliance scores aligned with Lei 14.133/2021.

## Core Concepts
- **ValidationRule**: a named predicate with severity (error | warning | info) and a legal basis citation
- **ValidationReport**: aggregated result of applying one or more rules to a document
- **ComplianceCheck**: per-document record of which rules passed/failed

## Key Functions
| Function | Purpose |
|---|---|
| `createExtendedValidationRule` | Defines a new validation predicate |
| `applyExtendedValidationRules` | Runs all applicable rules against a document |
| `createExtendedValidationReport` | Packages rule results into a report object |
| `mergeExtendedValidationReports` | Combines reports from multiple rule sets |
| `getExtendedValidationSummary` | Returns pass/fail counts and overall score |

## Scoring
Compliance score = passed rules / total applicable rules, weighted by severity.

## Storage
Tables: `compliance_checks`, `legal_risks` — see drizzle/0148 and 0149.
