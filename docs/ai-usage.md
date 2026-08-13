# AI-Assisted Development Log

This document records how AI tools support CertGate and how their output is verified.

## Principles

- AI may propose code, tests, documentation, and design alternatives.
- The developer remains responsible for architecture, security decisions, and final code.
- Generated cryptographic logic is not accepted without checking official library documentation and tests.
- Code that cannot be explained is not merged.
- Secrets, private keys, production data, and personal information are not supplied to AI tools.

## Entry template

### YYYY-MM-DD - Task

- **Goal**:
- **AI assistance**:
- **Developer decision**:
- **Verification**:
- **Incorrect or rejected suggestions**:
- **Related commit/PR**:

## Initial use

AI was used to structure the project requirements and expose design trade-offs around certificate enrollment, revocation, authorization, and submission scope. Decisions remain drafts until verified during implementation.
