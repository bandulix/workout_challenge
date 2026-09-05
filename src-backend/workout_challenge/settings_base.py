"""Assemble Django settings body from split base64 parts (MCP size limits)."""
from workout_challenge.settings_base_a import SRC as _A
from workout_challenge.settings_base_b import SRC as _B

exec(_A + _B, globals())
