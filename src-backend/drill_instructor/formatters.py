"""Shared one-liners for a workout (feed payload and LLM prompts)."""


def format_workout_summary(workout):
    """Return ``(summary, duration_min)``. ``duration_min`` is None when
    the workout has no duration. Empty workout → ``("", None)``."""
    if workout is None:
        return "", None
    parts = []
    duration_min = None
    if workout.duration is not None:
        duration_min = round(workout.duration.total_seconds() / 60)
        parts.append(f"{duration_min} min {workout.sport_type}")
    else:
        parts.append(workout.sport_type)
    if workout.distance is not None and workout.sport_type != "Steps":
        parts.append(f"{float(workout.distance):.2f} km")
    if workout.kcal is not None:
        parts.append(f"{round(float(workout.kcal))} kcal")
    return " · ".join(parts), duration_min
