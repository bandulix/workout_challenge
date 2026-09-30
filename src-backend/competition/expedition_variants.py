"""Expedition content that rotates: route themes, objectives, weekly twists.

Everything here is code-defined and deterministic. The route *engine*
(``expedition.py``) stays the same; this module only decides what the
engine is dressed as (theme), what the crew is trying to do (objective)
and which one-week rule bends the game mid-challenge (twist). No runtime
AI generates any of it - the coach only narrates the lines written here.
"""

import random
from datetime import timedelta
from decimal import Decimal


# --- Route themes -----------------------------------------------------------
# Landmark slot ids (trailhead / river-crossing / high-pass / finale) are the
# engine's stable identity. Themes only change the words and the artwork key
# the client picks. Order matters: it is the rotation order for new
# campaigns of the same organizer.
ROUTE_THEMES = {
    "summit": {
        "title": "Summit",
        "landmarks": {
            "trailhead": "Trailhead",
            "river-crossing": "River crossing",
            "high-pass": "High pass",
            "finale": "Summit",
        },
        "story": {
            "trailhead": "Boots on. The crew leaves the last village behind.",
            "river-crossing": "Cold water, linked arms - everyone across.",
            "high-pass": "Thin air up here. The valley is a map below you.",
            "finale": "Summit. Flag planted. Look how far the crew came.",
        },
    },
    "ocean": {
        "title": "Ocean crossing",
        "landmarks": {
            "trailhead": "Harbour",
            "river-crossing": "Open water",
            "high-pass": "Storm belt",
            "finale": "Far shore",
        },
        "story": {
            "trailhead": "Lines cast off. The harbour shrinks behind the crew.",
            "river-crossing": "No land in any direction - only the crew and the swell.",
            "high-pass": "The storm belt throws everything it has. The crew rows through.",
            "finale": "Land! The far shore, reached together.",
        },
    },
    "desert": {
        "title": "Desert caravan",
        "landmarks": {
            "trailhead": "Oasis",
            "river-crossing": "Dunes",
            "high-pass": "Canyon",
            "finale": "The City",
        },
        "story": {
            "trailhead": "Water skins full. The caravan leaves the oasis at dawn.",
            "river-crossing": "Dune after dune. The crew walks in each other's footprints.",
            "high-pass": "The canyon walls close in - and open onto the plain.",
            "finale": "Gates of the City. The caravan made it.",
        },
    },
    "space": {
        "title": "Space flight",
        "landmarks": {
            "trailhead": "Launch",
            "river-crossing": "Orbit",
            "high-pass": "Deep space",
            "finale": "Landing",
        },
        "story": {
            "trailhead": "Ignition. The crew leaves the pad in one piece.",
            "river-crossing": "Orbit reached - Earth turns slowly under the crew.",
            "high-pass": "Deep space. Silence, stars, and a crew that keeps burning.",
            "finale": "Touchdown. Mission complete.",
        },
    },
    "relay": {
        "title": "Marathon relay",
        "landmarks": {
            "trailhead": "Start",
            "river-crossing": "Halfway",
            "high-pass": "The Wall",
            "finale": "Finish tape",
        },
        "story": {
            "trailhead": "Gun goes. First baton is off.",
            "river-crossing": "Halfway. Legs heavy, spirits not.",
            "high-pass": "The Wall - the crew runs straight through it.",
            "finale": "Finish tape. Every leg counted.",
        },
    },
}
ROUTE_THEME_ORDER = tuple(ROUTE_THEMES)
DEFAULT_ROUTE_THEME = "summit"


def pick_route_theme(competition, previous_themes=None):
    """The next unseen theme for this organizer, else the least recently used.

    ``previous_themes`` is the organizer's earlier campaigns' themes, newest
    first. Rotating per organizer (not per challenge) means a group that
    rematches sees a fresh route every time.
    """
    if previous_themes is None:
        from .models import ExpeditionCampaign
        previous_themes = list(
            ExpeditionCampaign.objects.filter(competition__owner_id=competition.owner_id)
            .exclude(competition_id=competition.pk)
            .order_by("-created_at")
            .values_list("route_theme", flat=True)
        )
    seen = [theme for theme in previous_themes if theme in ROUTE_THEMES]
    for theme in ROUTE_THEME_ORDER:
        if theme not in seen:
            return theme
    # Every theme used at least once: take the one used longest ago.
    last_use = {theme: seen.index(theme) for theme in ROUTE_THEME_ORDER}
    return max(ROUTE_THEME_ORDER, key=lambda theme: last_use[theme])


def route_theme(key):
    return ROUTE_THEMES.get(key) or ROUTE_THEMES[DEFAULT_ROUTE_THEME]


# --- Objectives -------------------------------------------------------------
OBJECTIVE_EXPEDITION = "expedition"   # reach the far end together
OBJECTIVE_RESCUE = "rescue"           # a storm front chases the crew
OBJECTIVE_BASECAMP = "basecamp"       # hold the camp week after week
OBJECTIVE_TREASURE = "treasure"       # landmarks are hidden until reached
OBJECTIVES = {
    OBJECTIVE_EXPEDITION: {
        "title": "Expedition",
        "tagline": "Reach the far end together.",
        "help": [
            "Everyone's workouts move one shared marker along the route.",
            "Each person adds at most 100 points per week - a full stamina ring.",
            "Landmarks also have opening dates: this is a season, not a sprint.",
        ],
    },
    OBJECTIVE_RESCUE: {
        "title": "Rescue run",
        "tagline": "Stay ahead of the storm.",
        "help": [
            "A storm front follows the crew along the route, a little behind today's flag.",
            "Reach each landmark by its date to keep its stamp - the storm takes late stamps.",
            "Nobody loses: the route still completes, only the stamps show who beat the weather.",
        ],
    },
    OBJECTIVE_BASECAMP: {
        "title": "Base camp",
        "tagline": "Hold the camp, week after week.",
        "help": [
            "No distance to cover: the crew holds a camp.",
            "A week where the crew fills 60% of its stamina rings raises a tent; a missed week and the wind takes one.",
            "Camp levels unlock as tents stand - the finale counts what is still standing.",
        ],
    },
    OBJECTIVE_TREASURE: {
        "title": "Treasure hunt",
        "tagline": "Find out what's out there.",
        "help": [
            "The landmarks are hidden. The crew only learns what it found on arrival.",
            "Points move the marker exactly like an Expedition; each find unlocks a chapter from the coach.",
            "The last chest opens on the final day, whatever the crew reached.",
        ],
    },
}
DEFAULT_OBJECTIVE = OBJECTIVE_EXPEDITION

# Rescue: how far behind today's flag the storm front sits (route %).
STORM_GRACE_PERCENT = Decimal("12.0")
# Base camp: share of the crew's weekly ceiling that keeps the camp.
BASECAMP_HOLD_RATIO = Decimal("0.60")


def objective(key):
    return OBJECTIVES.get(key) or OBJECTIVES[DEFAULT_OBJECTIVE]


# --- Twists -----------------------------------------------------------------
TWIST_STORM = "storm"          # weather: bigger ring (cap x1.5), more to earn
TWIST_REST = "rest"            # weather: half ring (cap x0.5), easy to fill
TWIST_ROPE = "rope"            # points count only on days a crew-mate moved too
TWIST_SHORTCUT = "shortcut"    # crew vote: ridge (earlier, steeper) or valley
TWISTS = {
    TWIST_STORM: {
        "title": "Storm week",
        "coach_line": "Storm week. Bigger ring - fill it and we gain ground.",
        "help": "This week every ring holds 150 points instead of 100. Extra effort counts extra.",
        "cap_multiplier": Decimal("1.5"),
    },
    TWIST_REST: {
        "title": "Rest week",
        "coach_line": "Rest week. Half ring. Fill it and stop - recovery is training.",
        "help": "This week every ring holds 50 points. A short week for everyone.",
        "cap_multiplier": Decimal("0.5"),
    },
    TWIST_ROPE: {
        "title": "Rope week",
        "coach_line": "Rope week. Your day only counts if a crew-mate moved that day too.",
        "help": "This week a workout counts only on days when at least two crew members train. Bring someone with you.",
        "cap_multiplier": Decimal("1"),
    },
    TWIST_SHORTCUT: {
        "title": "Shortcut vote",
        "coach_line": "Crew decision: the ridge is steeper but faster. Ridge or valley?",
        "help": "Vote this week. Ridge: the next landmark opens 3 days earlier but needs 5% more route. Valley: the planned route.",
        "cap_multiplier": Decimal("1"),
    },
}
SHORTCUT_RIDGE = "ridge"
SHORTCUT_VALLEY = "valley"
SHORTCUT_CHOICES = (SHORTCUT_RIDGE, SHORTCUT_VALLEY)
RIDGE_EXTRA_FRACTION = Decimal("0.05")
RIDGE_DAYS_EARLIER = 3


def twist(kind):
    return TWISTS.get(kind)


def cap_multiplier(kind):
    entry = TWISTS.get(kind)
    return entry["cap_multiplier"] if entry else Decimal("1")


def build_twist_plan(periods, participant_count, seed):
    """Assign at most one twist per eligible week, deterministically.

    ``periods`` are the ``_score_periods`` tuples. Eligible weeks are the
    full weeks strictly inside the challenge (never the opening or closing
    week - those are for arriving and finishing). Order of preference when
    weeks are scarce: weather, rope, shortcut. Rope needs a crew of two.
    Returns ``[{"week_start", "kind"}]`` sorted by week.
    """
    full_inner = [
        period for period in periods[1:-1]
        if (period[2] - period[1]).days == 7
    ]
    if not full_inner:
        return []
    rng = random.Random(f"expedition-twists:{seed}")
    kinds = [rng.choice([TWIST_STORM, TWIST_REST])]
    if participant_count >= 2:
        kinds.append(TWIST_ROPE)
    kinds.append(TWIST_SHORTCUT)
    kinds = kinds[:len(full_inner)]
    weeks = rng.sample(full_inner, len(kinds))
    plan = [
        {"week_start": week[0].isoformat(), "kind": kind}
        for week, kind in zip(weeks, kinds, strict=False)
    ]
    plan.sort(key=lambda item: item["week_start"])
    return plan


def twist_for_week(plan, week_start):
    key = week_start.isoformat() if hasattr(week_start, "isoformat") else str(week_start)
    for item in plan or []:
        if item.get("week_start") == key:
            return item.get("kind")
    return None


def shortcut_adjustment(twist_state):
    """(milestone_id, extra_fraction, days_earlier) when the crew took the ridge."""
    shortcut = (twist_state or {}).get("shortcut") or {}
    if shortcut.get("result") != SHORTCUT_RIDGE or not shortcut.get("milestone_id"):
        return None
    return shortcut["milestone_id"], RIDGE_EXTRA_FRACTION, timedelta(days=RIDGE_DAYS_EARLIER)


def decide_shortcut(votes, participant_count):
    """Majority of cast votes; ties and no votes keep the valley."""
    ridge = sum(1 for choice in votes.values() if choice == SHORTCUT_RIDGE)
    valley = sum(1 for choice in votes.values() if choice == SHORTCUT_VALLEY)
    if ridge > valley:
        return SHORTCUT_RIDGE
    return SHORTCUT_VALLEY
