.PHONY: test test-e2e test-security test-all lint typecheck

test:
	.venv/bin/pytest tests/ -v --ignore=tests/e2e --ignore=tests/security

test-e2e:
	.venv/bin/pytest tests/e2e/ -v -m e2e

test-security:
	python tests/security/zap_scan.py

test-all: test test-e2e test-security

lint:
	.venv/bin/ruff check monsterops/ tests/

typecheck:
	.venv/bin/mypy monsterops/
