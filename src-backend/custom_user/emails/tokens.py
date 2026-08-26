"""One-time tokens for confirming an email address.

Separate salt and hash from Django's password-reset generator so a
reset link cannot be reused as a verify link (and vice versa). The
hash includes ``is_verified`` so a used link dies as soon as the flag
flips.
"""
from django.contrib.auth.tokens import PasswordResetTokenGenerator


class EmailVerifyTokenGenerator(PasswordResetTokenGenerator):
    key_salt = "custom_user.emails.tokens.EmailVerifyTokenGenerator"

    def _make_hash_value(self, user, timestamp):
        # Email is in the hash so a changed address kills outstanding
        # links. ``is_verified`` is NOT: a used link must still confirm
        # as "already done" (double-click / React StrictMode) without
        # queueing a second welcome.
        login = "" if user.last_login is None else user.last_login.replace(microsecond=0).isoformat()
        return f"{user.pk}{user.email}{login}{timestamp}"


email_verify_token = EmailVerifyTokenGenerator()
