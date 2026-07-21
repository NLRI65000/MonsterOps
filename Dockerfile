FROM python:3.11-slim

WORKDIR /app

# postgresql-client is a Debian metapackage pinned to the base image's distro
# release; hard-pinning its version would break on every base-image bump.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml LICENSE README.md ./
COPY monsterops/ monsterops/
COPY alembic/ alembic/
COPY alembic.ini .

RUN pip install --no-cache-dir -e .

EXPOSE 8000

CMD ["monsterops", "serve", "--host", "0.0.0.0", "--port", "8000"]
