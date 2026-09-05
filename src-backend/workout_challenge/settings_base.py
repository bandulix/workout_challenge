"""Assemble Django settings body from split base64 parts (MCP size limits)."""
from workout_challenge.settings_base_a import SRC as _A
from workout_challenge.settings_base_b import SRC as _B
from workout_challenge.settings_base_c import SRC as _C

exec(_A + _B + _C, globals())
