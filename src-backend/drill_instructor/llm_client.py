"""Thin wrapper around OpenAI's chat completions API.

Used to generate the short Drill Instructor message for each workout.
The persona's ``system_prompt`` is sent as the system message; the
workout / competition context is sent as a user message.

Re-uses the existing ``OPENAI_API_KEY`` setting and the same SDK that
already powers the weekly email fitness fact. The active API key, base
URL and model are resolved at call time via
:func:`site_settings.models.resolve_llm_settings`, so admins can change
the provider from the Site Settings page without restarting workers.
"""

import ipaddress
import logging
import re
import socket
from typing import Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


def _safe_base_url(url: Optional[str]) -> Optional[str]:
    """Sanity-check the admin-supplied LLM base URL before handing it to OpenAI.

    Same SSRF guard as the Matrix client: scheme must be https (or
    http for literal loopback hostnames), and the host must not resolve
    into a private / loopback address.
    """
    if not url:
        return None
    parsed = urlparse(url.strip())
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("https", "http"):
        return None
    host = (parsed.hostname or "").lower()
    if not host:
        return None
    # Plain HTTP is allowed only for literal loopback hostnames - skip
    # DNS so a host header pointing at a private IP via DNS rebinding
    # can't bypass the http-only-for-loopback rule.
    is_loopback_host = host in {"localhost", "127.0.0.1", "::1"}
    if scheme == "http" and not is_loopback_host:
        return None
    if is_loopback_host:
        return url.strip()
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return None
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            return None
    return url.strip()


def generate_message(*, system_prompt: str, user_prompt: str, model: Optional[str] = None, max_tokens: int = 120) -> Optional[str]:
    """Return a short persona-voiced message, or ``None`` if unavailable.

    The OpenAI Python SDK is compatible with any provider that exposes an
    OpenAI-shaped chat-completions endpoint - just set ``LLM_BASE_URL`` to
    the provider's URL (OpenRouter, Groq, Together, Mistral, Ollama, ...).
    Failures are swallowed and logged: a missing key, a rate limit or a
    network error must never take the request / Celery task down - the
    Drill Instructor is a nice-to-have on top of the core app.
    """
    from site_settings.models import resolve_llm_settings

    config = resolve_llm_settings()
    api_key = config["api_key"]
    if not api_key:
        return None

    base_url = _safe_base_url(config["base_url"])

    try:
        # Imported lazily so unit tests that mock the OpenAI client don't
        # pay the import cost (and so missing-key paths stay clean).
        from openai import OpenAI
    except ImportError:
        logger.warning("openai package not installed; skipping Drill Instructor message generation.")
        return None

    try:
        client_kwargs = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url
        client = OpenAI(**client_kwargs)
        response = client.chat.completions.create(
            model=model or config["model"],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.9,
            top_p=1.0,
            max_tokens=max_tokens,
        )
        raw = (response.choices[0].message.content or "").strip()
    except Exception as exc:  # noqa: BLE001 - OpenAI raises many subclasses
        logger.warning("Drill Instructor LLM call failed: %s", exc)
        return None

    if not raw:
        return None

    # Normalise whitespace and clamp length so we don't spam the channel
    # with essays. Most Matrix clients render plain text fine.
    raw = re.sub(r"\s+", " ", raw).strip()
    if len(raw) > 600:
        raw = raw[:597].rsplit(" ", 1)[0] + "..."
    return raw


def build_workout_prompt(*, user_first_name: str, username: str, sport_type: str, duration_minutes: int, distance_km, kcal, intensity: int, competition_name: str, points_capped, user_rank: Optional[int], total_participants: Optional[int]) -> str:
    """Compose the user-message the LLM sees.

    Keeps the schema simple and stable so prompt-tuning the persona is
    straightforward.
    """
    parts = [
        f"Competition: {competition_name}",
        f"Athlete: {user_first_name} (username: {username})",
        f"Activity: {sport_type} for {duration_minutes} min" if duration_minutes else f"Activity: {sport_type}",
    ]
    if distance_km:
        parts.append(f"Distance: {distance_km} km")
    if kcal:
        parts.append(f"Calories: {kcal} kcal")
    if intensity:
        parts.append(f"Intensity: {intensity}/4")
    if points_capped is not None:
        parts.append(f"Points earned this activity: {round(points_capped)}")
    if user_rank is not None and total_participants:
        parts.append(f"Current rank: {user_rank} of {total_participants}")
    parts.append("Write your comment now.")
    return "\n".join(parts)
