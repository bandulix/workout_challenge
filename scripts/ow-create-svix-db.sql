-- Open Wearables expects a `svix` database next to its own (used by the
-- optional Svix webhook gateway). Runs via /docker-entrypoint-initdb.d on
-- first cluster init of the openwearables-db service. Idempotent.
SELECT 'CREATE DATABASE svix'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'svix')\gexec
