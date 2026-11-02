# Security Policy

QUON is a privacy product. Security reports are welcome, and this page explains
how to send one. Please read it before reporting.

For an overview of what QUON defends against (and what it deliberately does
not), see the [threat model](docs/threat-model.md).

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately through **GitHub Security Advisories**: on the repository page,
go to **Security > Report a vulnerability** and fill in the private advisory
form. This keeps the report confidential while a fix is developed.

Include what you can:

- A description of the issue and its impact (what an attacker gains).
- Steps to reproduce, proof-of-concept code, or a failing test.
- Affected component (frontend `src/`, backend `quon-scrubber-service/`,
  deployment scripts `deploy/`).
- Any suggested fix.

Please redact real personal data and real API keys from reproduction material.

## What to expect

- You will get a first response within about 7 days, usually faster. This is a
  small project, so please allow reasonable time for triage and a fix before
  any public disclosure, and agree the disclosure timeline in the advisory
  thread.
- You will be credited in the advisory and changelog if you wish.

## Scope

**In scope:**

- Code in this repository: the frontend, the scrubber/relay backend, the
  crypto and sync design, and the reference deployment configuration.
- Anything that breaks the zero-knowledge model (server able to read user
  content), causes PII to reach a model provider unscrubbed, defeats the
  fail-closed behavior, or breaks per-user isolation.

**Out of scope:**

- Third-party model providers and their infrastructure (OpenRouter, upstream
  model hosts). Report those to the vendor.
- Vulnerabilities in third-party dependencies with no demonstrated impact on
  QUON (but do report if QUON uses a dependency unsafely).
- Social engineering, phishing, or physical attacks against operators or users.
- Denial of service / volumetric attacks against a hosted instance.
- Findings already documented as accepted residual risks in the
  [threat model](docs/threat-model.md) (for example metadata visibility,
  semantic leakage, the malicious-code-serving-origin caveat), unless you found
  a way to make them worse than documented.

## Supported versions

Only the latest state of the `main` branch is supported. Self-hosted instances
should track `main`; there are no maintained release branches.

## Safe harbor

Good-faith security research on your **own** self-hosted instance is welcome,
and we will not pursue legal action for it, provided you do not degrade service
for others, do not access or exfiltrate other users' data, and report privately
as described above. When testing against an instance you do not operate (a
hosted instance you were invited to), do not access data that is not yours;
create your own test accounts.
