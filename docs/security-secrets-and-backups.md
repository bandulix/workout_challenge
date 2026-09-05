# Secrets at rest and backups

## Site Settings secrets

These fields are Fernet-encrypted in Postgres (same key material as
Garmin / Strava OAuth tokens — `GARMIN_TOKEN_KEY` when set, otherwise
Django `SECRET_KEY`):

- `llm_api_key`
- `strava_client_secret`
- `email_host_password`
- `health_developer_password`

Runtime callers still see plaintext via `resolve_*_settings`. Legacy
plaintext rows keep working until the next save (or the encrypting data
migration), which re-encrypts them.

## VAPID private key

When the keypair is auto-persisted to `data/vapid.json`, the **private**
key is Fernet-encrypted the same way (file mode `0600`). Prefer pinning
`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` via environment
variables in production so the private key never lives only on the volume.

## After upgrading from plaintext storage

1. Deploy / migrate so Site Settings secrets and `vapid.json` private
   keys are encrypted at rest.
2. **Rotate** any secrets that previously appeared in plaintext DB dumps
   or volume backups (API keys, Strava client secret, SMTP password,
   Health developer password, VAPID private key). Treat older backups as
   compromised for those values.
3. Prefer **encrypted backups**, or at least **restrict who can mount /
   copy** the `django_data` volume and Postgres dumps. Do not sync
   unencrypted dumps to shared drives or chat.

Rotating `SECRET_KEY` or `GARMIN_TOKEN_KEY` without the previous key
material will make existing ciphertext unreadable — set `GARMIN_TOKEN_KEY`
explicitly before rotating `SECRET_KEY` if you need linkages and Site
Settings secrets to survive.
