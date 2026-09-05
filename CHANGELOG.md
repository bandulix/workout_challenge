# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **Site Settings secrets and the VAPID private key are encrypted at rest.** LLM API key, Strava client secret, SMTP password, and Health developer password are Fernet-encrypted in Postgres (same key material as Garmin/Strava OAuth tokens). Auto-written `data/vapid.json` stores an encrypted private key (`0600`). Prefer pinning `VAPID_*` via env in production. After upgrading from plaintext storage, **rotate** any secrets that lived in old DB dumps or volume backups — see [docs/security-secrets-and-backups.md](docs/security-secrets-and-backups.md). (#29)
- **Default bind is loopback.** `APP_BIND` defaults to `127.0.0.1` — put a TLS-terminating reverse proxy in front. Set `APP_BIND=0.0.0.0` only on a trusted LAN. Garmin/Strava link routes refuse cleartext HTTP unless `DEBUG` is on. (#30)
- **Flower / Open Wearables admin / Health developer passwords must differ from `SECRET_KEY`.** Compose requires `FLOWER_PASSWORD` (and `OW_ADMIN_PASSWORD` with `--profile health`); production Django refuses to boot if they match. (#30)
- **Release APK builds fail without real signing.** No silent debug-keystore fallback for `assembleRelease` — use `~/.gradle/workout-signing.properties` or `ANDROID_KEYSTORE_*` secrets. (#30)

### Changed
- **⚠️ BREAKING — web refresh tokens are httpOnly cookies only.** The browser no longer keeps a refresh JWT in JS storage; JSON login/refresh responses omit `refresh` unless the client sends `X-WC-Client: native` (Android APK). After this deploy, **web users may need to sign in again** once. The service worker never caches `/api/` (network-only), so stale auth responses cannot stick in the SW cache. (#33, supersedes #31)

## Prior releases

Historical Keep-a-Changelog entries live in `docs/changelog-parts/` and are being reassembled onto this file by the rebuild workflow. Do not squash-merge until the full body is restored on tip.
