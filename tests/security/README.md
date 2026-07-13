# OWASP ZAP Security Scanning

This directory contains the OWASP ZAP security scan runner for MonsterOps.

## Prerequisites

- Docker installed and running
- MonsterOps server running at `http://localhost:8000` (or specify `--target`)
- The test database populated with `testadmin` / `Test1234!` credentials (for authenticated scan)

## Quick start

```bash
# Baseline scan (unauthenticated)
python tests/security/zap_scan.py

# Specify a different target
python tests/security/zap_scan.py --target http://192.168.1.100:8000

# Baseline + authenticated scan (requires running server with testadmin account)
python tests/security/zap_scan.py --auth-login

# Custom report path
python tests/security/zap_scan.py --report /tmp/myreport.html
```

Or via Make:

```bash
make test-security
```

## What the scan does

1. **Baseline scan** (`zap-baseline.py`): passive scan — crawls the app, looks for common
   misconfigurations (missing security headers, information disclosure, etc.).  
   Exit code 0 = clean, 1 = warnings, 2 = high-severity alerts.

2. **Authenticated scan** (`zap-api-scan.py`, with `--auth-login`): fetches a JWT token from
   `/api/auth/login`, injects it as `Authorization: Bearer <token>`, then runs the OpenAPI-based
   active scanner against the app.  Requires `debug=true` in the running app so that
   `/api/openapi.json` is exposed.

## Reports

After the scan, two files are generated in the directory specified by `--report`:

| File | Description |
|------|-------------|
| `zap_report.html` | Human-readable HTML report |
| `zap_report.json` | Machine-readable JSON for CI integration |

## Running ZAP manually

```bash
# Pull the latest ZAP image
docker pull ghcr.io/zaproxy/zaproxy:stable

# Baseline scan
docker run --rm \
  --network host \
  -v $(pwd):/zap/wrk/:rw \
  -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
  -t http://localhost:8000 \
  -r /zap/wrk/tests/security/zap_report.html \
  -J /zap/wrk/tests/security/zap_report.json
```

## CI Integration

Add the following to your CI pipeline (GitHub Actions example):

```yaml
- name: Security scan
  run: |
    python tests/security/zap_scan.py --target http://localhost:8000
  continue-on-error: true  # do not block merges on warnings
```
