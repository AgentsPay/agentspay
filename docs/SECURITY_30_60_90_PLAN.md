# AgentPay Security 30/60/90 Plan

## Objective
Reach production-grade security and operational maturity for a payment platform while preserving product velocity.

## Success Criteria (90 days)
- All admin and settlement actions are fully audited and queryable.
- Secrets are managed via managed KMS/HSM, not static `.env` only.
- CI blocks critical vulnerabilities and enforces security checks.
- Incident response, backup/restore, and key rotation are tested via drills.
- Core APIs are monitored with SLOs, alerting, and on-call runbooks.

## Day 0-30 (Foundation)

### 1. Identity and Admin Security
- Keep `X-Admin-Key` with timing-safe comparison and dual-key rotation.
- Add optional wallet-signature admin auth as step-up for critical actions.
- Add admin audit log endpoint and retention policy.

Done when:
- Admin auth supports key rotation (`CURRENT` + `PREVIOUS`).
- Every admin action has an audit record with status and metadata.

### 2. API Hardening
- Security headers on API responses.
- Request ID propagation (`X-Request-Id`) for traceability.
- Strict rate limits for admin routes.

Done when:
- All `/api/*` responses include baseline hardening headers and request ID.
- Admin routes are separately rate-limited.

### 3. CI Security Baseline
- Add security workflow: install, build, dependency audit.
- Fail CI on high/critical dependency issues.

Done when:
- Security workflow runs on every push/PR to main branches.

## Day 31-60 (Operational Security)

### 4. Secret Management and Key Lifecycle
- Move master secrets to cloud secret manager/KMS.
- Implement key rotation runbook (monthly) and emergency revocation path.
- Remove direct secret usage from local files in production deployments.

Done when:
- Production reads secrets from managed secret store.
- Rotation executed in staging with no downtime.

### 5. Observability and Detection
- Structured logs for API and settlement outcomes.
- Metrics: dispute resolution latency, settlement failure rates, auth failures.
- Alerts for suspicious admin failures and payment anomalies.

Done when:
- Dashboards and alert rules are active and tested.

### 6. Data Protection
- Encrypt backups at rest.
- Define retention for audit and operational logs.
- Add restore verification job (weekly).

Done when:
- Restore drill passes within agreed RTO/RPO.

## Day 61-90 (Assurance and Compliance Readiness)

### 7. Secure SDLC and Verification
- Add SAST/secret scanning/dependency scanning gates.
- Threat model update for dispute and settlement paths.
- External pentest on admin and payment surfaces.

Done when:
- Critical findings from pentest are fixed or formally accepted with mitigation.

### 8. Reliability and Resilience
- Chaos test for settlement dependency outages.
- Runbook-based incident simulations (auth breach, settlement failure, DB lock).
- Post-incident template and blameless review process.

Done when:
- Two tabletop exercises completed with action items tracked.

### 9. Compliance Track (if required by GTM)
- SOC 2 Type I prep (policies + controls mapping).
- Evidence automation for access reviews, key rotations, incident drills.

Done when:
- Control inventory and evidence pipeline are in place.

## Execution Cadence
- Weekly security triage: findings, vulnerabilities, audit anomalies.
- Biweekly architecture review for payment/dispute/auth flows.
- Monthly key rotation and backup restore drill.

## Ownership
- Platform Engineering: API security, auth, logging.
- DevOps/SRE: CI/CD controls, secrets, monitoring, incident readiness.
- Security Lead: threat model, pentest coordination, policy/governance.
