"""Validate uploaded Standard MIDI files."""

import struct

from rest_framework import serializers

MAX_MIDI_BYTES = 512 * 1024
_MTHD = b"MThd"


def validate_midi_upload(uploaded):
    """Return the file if it is a Standard MIDI File, else raise."""
    if uploaded is None:
        return None
    size = getattr(uploaded, "size", None)
    if size is not None and size > MAX_MIDI_BYTES:
        raise serializers.ValidationError("MIDI file too large (max 512 KB).")
    name = (getattr(uploaded, "name", "") or "").lower()
    if name and not (name.endswith(".mid") or name.endswith(".midi")):
        raise serializers.ValidationError("Upload a .mid or .midi file.")
    try:
        uploaded.seek(0)
        header = uploaded.read(14)
        uploaded.seek(0)
    except Exception as exc:
        raise serializers.ValidationError("Could not read that MIDI file.") from exc
    if len(header) < 14 or header[:4] != _MTHD:
        raise serializers.ValidationError("Upload a Standard MIDI file (.mid).")
    length = struct.unpack(">I", header[4:8])[0]
    if length < 6:
        raise serializers.ValidationError("Upload a Standard MIDI file (.mid).")
    return uploaded
