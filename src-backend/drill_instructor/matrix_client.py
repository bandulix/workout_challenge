"""Minimal Matrix Client-Server API wrapper.

Only the calls we need are implemented:

* resolve the current user id of the access token (for diagnostics / a
  test-message ping);
* send a single text message to a room.

Matrix client-server API reference:
https://spec.matrix.org/v1.10/client-server-api/

We deliberately keep this dependency-free (uses ``requests`` already in
the requirements) so we don't have to ship an async client in a
Celery worker.

SSRF protection
----------------
``homeserver`` is competition-owner input, so every outbound request
goes through :func:`_safe_homeserver` which:
  * requires an explicit ``https://`` (or loopback ``http://``) scheme,
  * rejects hostnames that resolve to link-local / loopback / private
    RFC-1918 ranges,
so the bot can't be pointed at internal services by a malicious
competition owner.
"""

import ipaddress
import logging
import socket
import uuid
from typing import Optional
from urllib.parse import urlparse

import requests
from django.core.cache import cache

logger = logging.getLogger(__name__)

_ME_CACHE_PREFIX = "drill_instructor:matrix_me:"
_ME_CACHE_TTL = 60 * 60 * 6  # 6 hours


class MatrixError(RuntimeError):
    """Raised when the Matrix homeserver returns an error or is unreachable."""


def _normalize_homeserver(url: str) -> str:
    """Strip trailing slashes so we can safely concatenate endpoint paths."""
    return url.rstrip("/")


def _is_private_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _safe_homeserver(url: str) -> str:
    """Validate a user-supplied Matrix homeserver URL.

    Allows public HTTPS endpoints plus ``http://localhost`` /
    ``http://127.0.0.1`` for self-hosted setups behind a reverse proxy
    in dev. Blocks anything that resolves into a private / link-local
    address; blocks ``http://`` for any non-loopback host.
    """
    if not url:
        raise MatrixError("Matrix homeserver URL is required.")

    parsed = urlparse(_normalize_homeserver(url))
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("https", "http"):
        raise MatrixError("Matrix homeserver URL must use https:// (or http://localhost).")

    host = (parsed.hostname or "").lower()
    if not host:
        raise MatrixError("Matrix homeserver URL is missing a host.")

    # Plain HTTP is only allowed when the host is the literal loopback
    # hostname. This skips DNS entirely for the common dev case so a
    # host header pointing at a private IP via DNS rebinding can't
    # bypass the http-only-for-loopback rule.
    is_loopback_host = host in {"localhost", "127.0.0.1", "::1"}
    if scheme == "http" and not is_loopback_host:
        raise MatrixError("Matrix homeserver URL must use https:// (http only allowed for localhost).")

    if is_loopback_host:
        return url

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise MatrixError(f"Could not resolve Matrix homeserver host '{host}': {exc}") from exc

    for info in infos:
        sockaddr_ip = info[4][0]
        try:
            ip = ipaddress.ip_address(sockaddr_ip)
        except ValueError:
            continue
        if _is_private_ip(ip):
            raise MatrixError(
                f"Matrix homeserver host '{host}' resolves to a private/loopback address; not allowed."
            )

    return url


def send_text_message(*, homeserver: str, access_token: str, room_id: str, body: str, txn_id: Optional[str] = None) -> str:
    """Send a plain-text ``m.room.message`` to a Matrix room.

    Returns the event id of the posted message.
    """
    if not homeserver or not access_token or not room_id:
        raise MatrixError("Matrix homeserver, access token and room id are all required.")

    if not body:
        raise MatrixError("Refusing to send an empty Matrix message.")

    base = _safe_homeserver(homeserver)
    txn_id = txn_id or str(uuid.uuid4())
    url = f"{_normalize_homeserver(base)}/_matrix/client/v3/rooms/{requests.utils.quote(room_id, safe='')}/send/m.room.message/{txn_id}"

    try:
        response = requests.put(
            url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json={"msgtype": "m.text", "body": body},
            timeout=15,
        )
    except requests.RequestException as exc:
        raise MatrixError(f"Network error talking to Matrix homeserver: {exc}") from exc

    if response.status_code >= 400:
        snippet = response.text[:300] if response.text else "<no body>"
        raise MatrixError(f"Matrix rejected message ({response.status_code}): {snippet}")

    try:
        return response.json().get("event_id", "")
    except ValueError as exc:
        raise MatrixError(f"Matrix returned non-JSON response: {exc}") from exc


def whoami(*, homeserver: str, access_token: str) -> dict:
    """Return ``/_matrix/client/v3/account/whoami`` for the given access token.

    Result is cached briefly per access-token-hash to avoid hammering the
    homeserver for each test ping.
    """
    cache_key = f"{_ME_CACHE_PREFIX}{hash(access_token)}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    base = _safe_homeserver(homeserver)
    url = f"{_normalize_homeserver(base)}/_matrix/client/v3/account/whoami"
    try:
        response = requests.get(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
    except requests.RequestException as exc:
        raise MatrixError(f"Network error talking to Matrix homeserver: {exc}") from exc

    if response.status_code >= 400:
        snippet = response.text[:300] if response.text else "<no body>"
        raise MatrixError(f"Matrix whoami failed ({response.status_code}): {snippet}")

    try:
        payload = response.json()
    except ValueError as exc:
        raise MatrixError(f"Matrix whoami returned non-JSON: {exc}") from exc

    cache.set(cache_key, payload, _ME_CACHE_TTL)
    return payload
