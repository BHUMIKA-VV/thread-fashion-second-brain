#!/bin/sh
# Runs once, when the Docker volume is first created.
# Creates a separate database for the automated test suite so tests never touch dev data.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE ${POSTGRES_DB}_test OWNER "$POSTGRES_USER";
EOSQL
