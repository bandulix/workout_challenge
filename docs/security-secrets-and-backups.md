# Secrets at rest and backups

## Integration credentials live in the environment only

LLM/AI keys and models, Strava OAuth credentials, the Health developer
login and the SMTP password are read straight from the environment
(`OPENAI_API_KEY`, `LLM_*`, `STRAVA_*`, `HEALTH_*`, `EMAIL_*`) — the app
has no DB override and no in-app editor for them, so the `.env` values
are always the ones in effect. The only Site Settings row left in
Postgres holds the point factors, which are not secret.

## VAPID private key

When the keypair is auto-persisted to `data/vapid.json`, the **private**
key is Fernet-encrypted the same way (file mode `0600`). Prefer pinning
`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` via environment
variables in production so the private key never lives only on the volume.

## Taking backups

`scripts/backup.sh` dumps Postgres (`pg_dump --clean`) and tars the
`django_data` volume (uploads, `vapid.json`) into timestamped folders
under `backups/`, pruning anything older than `RETENTION_DAYS` (28 by
default). Run it from cron on the Docker host, and **always before an
upgrade** - the entrypoint migrates on boot, so a rollback without a
pre-upgrade dump is not possible. Restore instructions are in the
script's header.

## After upgrading from plaintext storage

1. Deploy / migrate so `vapid.json` private keys are encrypted at rest.
2. **Rotate** any secrets that previously appeared in plaintext DB dumps
   or volume backups (API keys, Strava client secret, SMTP password,
   Health developer password, VAPID private key). Treat older backups as
   compromised for those values. Note: upgrades that removed the Site
   Settings override columns dropped those stored secrets entirely — the
   environment is now the only place they exist.
3. Prefer **encrypted backups**, or at least **restrict who can mount /
   copy** the `django_data` volume and Postgres dumps. Do not sync
   unencrypted dumps to shared drives or chat.

Rotating `SECRET_KEY` or `GARMIN_TOKEN_KEY` without the previous key
material will make existing ciphertext unreadable — set `GARMIN_TOKEN_KEY`
explicitly before rotating `SECRET_KEY` if you need linkages (Garmin /
Strava OAuth tokens, the VAPID private key) to survive.
