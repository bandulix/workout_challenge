import time, secrets
from decimal import Decimal

from django.db import models
from django.core.validators import MinLengthValidator, RegexValidator, MinValueValidator
from django.core.exceptions import ValidationError
from django.utils import timezone

from workouts.models import Workout, SPORT_TYPE_GROUPS, SPORT_TYPES
from custom_user.models import CustomUser
from .scorer import trigger_goal_change, trigger_competition_change

# Create your models here.
COMPETITION_METRCIS = [
    ('min', 'Time (Minutes)'),
    ('num', 'Number of times (x)'),
    ('kcal', 'Calories (Kcal)'),
    ('km', 'Distance (Km)'),
    ('kj', 'Effort (Kilojoules)'),
]

POINT_REF_PERIODS = [
    ('day', 'daily'),
    ('week', 'weekly'),
    ('month', 'monthly'),
    ('year', 'yearly'),
    ('competition', 'competition end'),
]


def generate_join_code():
    """Unguessable invite code: 16 chars, ~80 bits, no name/owner prefix."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(16))


class Competition(models.Model):
    """Competition users can compete in"""

    owner = models.ForeignKey(CustomUser, on_delete=models.CASCADE, null=False, blank=False)

    name = models.CharField(null=False, max_length=60)
    start_date = models.DateField(null=False)
    end_date = models.DateField(null=False)
    has_teams = models.BooleanField(default=False)
    organizer_assigns_teams = models.BooleanField(default=False)

    join_code = models.CharField(
        blank=False,
        null=False,
        max_length=20,
        validators=[
            MinLengthValidator(10),
            RegexValidator(r'^[a-zA-Z0-9]+$', message="Only letters and numbers allowed"),
        ],
        unique=True,
    )

    @property
    def start_date_fmt(self):
        return self.start_date.strftime("%a, %b %-d")

    @property
    def start_date_epoch(self):
        return int(time.mktime(self.start_date.timetuple()))

    @property
    def end_date_fmt(self):
        return self.end_date.strftime("%a, %b %-d")

    @property
    def end_date_epoch(self):
        return int(time.mktime(self.end_date.timetuple()))

    def __str__(self):
        """str print-out of model entry"""
        return f"{self.name} ({self.start_date} - {self.end_date})"

    def __init__(self, *args, **kwargs):
        """ save initial field values to be able to detect changes """
        super().__init__(*args, **kwargs)
        self._original = self._dict()

    #@property
    def _dict(self):
        """ dict of current fields and values - to detect changes """
        return {f.name: round(float(self.__dict__[f.attname]), 2) if isinstance(self.__dict__.get(f.attname), (Decimal, float)) else self.__dict__.get(f.attname) for f in self._meta.fields}

    def get_changed_fields(self):
        """ check which fields have changed """
        current = self._dict()
        return {
            k: (v, current.get(k))
            for k, v in self._original.items()
            if v != current.get(k)
        }

    def save(self, *args, **kwargs):
        """ trigger recalculation of points_capped if competition changes """
        is_create = self.pk is None
        if self.join_code == '':
            for _ in range(8):
                candidate = generate_join_code()
                if not Competition.objects.filter(join_code=candidate).exists():
                    self.join_code = candidate
                    break
            else:
                self.join_code = generate_join_code()
        self.join_code = self.join_code.upper()
        super().save(*args, **kwargs)
        changed = self.get_changed_fields()
        trigger_competition_change(
            instance=self,
            new=is_create,
            changes=changed
        )
        date_fields = {"start_date", "end_date"}
        requested_fields = kwargs.get("update_fields")
        dates_were_saved = requested_fields is None or bool(date_fields.intersection(requested_fields))
        if not is_create and date_fields.intersection(changed) and dates_were_saved:
            saved_dates = type(self).objects.only("start_date", "end_date").get(pk=self.pk)
            campaign = ExpeditionCampaign.objects.filter(
                competition_id=self.pk,
                locked_at__isnull=True,
            ).first()
            if campaign and timezone.localdate() < campaign.start_date:
                campaign.start_date = saved_dates.start_date
                campaign.end_date = saved_dates.end_date
                campaign.save(update_fields=["start_date", "end_date", "updated_at"])
        self._original = self._dict()  # reset

        # add default activity goals if new competition
        if is_create:
            ActivityGoal(name ='Exercise', competition = self, metric = 'min', goal = 150, period = 'week', max_per_day = 60, max_per_week = 240).save()  # WHO recommends at least 75-150 min vigorous activity per week (capped at 4h)
            ActivityGoal(name='Move', competition=self, metric='kcal', goal=1_800, period='week', max_per_day=1_000, max_per_week=3_000).save()  # 12kcal per minute
            self.owner.my_competitions.add(self) # add owner as participant


class Team(models.Model):
    """Competition teams users can join"""

    competition = models.ForeignKey(Competition, on_delete=models.CASCADE, null=False, blank=False)

    name = models.CharField(null=False, max_length=60)


    # ToDo: Check if user is participant in competition he/she whats to join the team of
    #def validate_members(self):
    #    if self.competition.pk not in [member.competition.pk for member in self.members]:
    #        raise ValidationError({'member': 'User must have joined competition to be a team member of team.'})

    def __str__(self):
        """str print-out of model entry"""
        return f"{self.competition} - Team: {self.name}"


class ActivityGoal(models.Model):
    """Activity goals in Competition - user will earn points for each rule/category"""

    competition = models.ForeignKey(Competition, on_delete=models.CASCADE, null=False, blank=False)

    name = models.CharField(null=False, max_length=60)

    metric = models.CharField(null=False, max_length=4, choices=COMPETITION_METRCIS)
    # goal must be > 0: the scorer divides by it for every workout; a 0
    # goal poisons scoring for the whole competition (ZeroDivisionError).
    goal = models.DecimalField(null=False, max_digits=10, decimal_places=2,
                               validators=[MinValueValidator(Decimal("0.01"))])
    period = models.CharField(null=False, max_length=12, default='day', choices=POINT_REF_PERIODS)

    count_steps_as_walks = models.BooleanField(default=True)

    min_per_workout = models.DecimalField(null=True, blank=True, max_digits=10, decimal_places=2)
    max_per_workout = models.DecimalField(null=True, blank=True, max_digits=10, decimal_places=2)
    min_per_day = models.DecimalField(null=True, blank=True, max_digits=10, decimal_places=2)
    max_per_day = models.DecimalField(null=True, blank=True, max_digits=10, decimal_places=2)
    min_per_week = models.DecimalField(null=True, blank=True, max_digits=10, decimal_places=2)
    max_per_week = models.DecimalField(null=True, blank=True, max_digits=10, decimal_places=2)

    def clean(self):
        super().clean()
        # A min above its max would make the floor/cap math self-
        # contradictory (and the recalc quietly wrong).
        for lo, hi in (
            ("min_per_workout", "max_per_workout"),
            ("min_per_day", "max_per_day"),
            ("min_per_week", "max_per_week"),
        ):
            lo_v = getattr(self, lo)
            hi_v = getattr(self, hi)
            if lo_v is not None and hi_v is not None and lo_v > hi_v:
                raise ValidationError({hi: "Must not be below the matching minimum."})

    class Meta:
        constraints = [
            # DB backstop: scoring divides by goal; a zero/negative goal
            # poisons the whole competition's points.
            models.CheckConstraint(condition=models.Q(goal__gt=0), name="activitygoal_goal_positive"),
        ]

    def __str__(self):
        """str print-out of model entry"""
        return f"{self.competition}: {self.name} ({self.goal} {self.metric})"

    def __init__(self, *args, **kwargs):
        """ save initial field values to be able to detect changes """
        super().__init__(*args, **kwargs)
        self._original = self._dict()

    #@property
    def _dict(self):
        """ dict of current fields and values - to detect changes """
        return {f.name: round(float(self.__dict__[f.attname]), 2) if isinstance(self.__dict__.get(f.attname), (Decimal, float)) else self.__dict__.get(f.attname) for f in self._meta.fields}

    def get_changed_fields(self):
        """ check which fields have changed """
        current = self._dict()
        return {
            k: (v, current.get(k))
            for k, v in self._original.items()
            if v != current.get(k)
        }

    def save(self, *args, **kwargs):
        """ trigger recalculation of points_capped if goal changes """
        is_create = self.pk is None
        super().save(*args, **kwargs)
        changed = self.get_changed_fields()
        trigger_goal_change(
            instance=self,
            new=is_create,
            changes=changed
        )
        self._original = self._dict()  # reset




class Award(models.Model):
    """Awards in Competition - user can earn points for comppleting awards"""

    competition = models.ForeignKey(Competition, on_delete=models.CASCADE, null=False, blank=False)

    name = models.CharField(null=False, max_length=60)
    sport = models.CharField(null=False, default='GROUP_ANY', max_length=40, choices=SPORT_TYPE_GROUPS + SPORT_TYPES)
    threshold = models.DecimalField(null=False, max_digits=10, decimal_places=2)
    period = models.CharField(null=False, max_length=12, default='day', choices=POINT_REF_PERIODS)
    reward_points = models.IntegerField(null=False)

    class Meta:
        constraints = [
            # Bonus awards are get_or_create'd by (competition, name) on
            # the hot photo/order path - without this, concurrent first
            # posts could double-create and every later get_or_create
            # would raise MultipleObjectsReturned.
            models.UniqueConstraint(fields=["competition", "name"], name="unique_award_per_competition"),
        ]

    def __str__(self):
        """str print-out of model entry"""
        return f"{self.competition}: {self.name} ({self.reward_points} {self.period})"



class Points(models.Model):
    """Points earned for User's Workout for this category or award"""

    goal = models.ForeignKey(ActivityGoal, on_delete=models.CASCADE, null=True, blank=True)
    award = models.ForeignKey(Award, on_delete=models.CASCADE, null=True, blank=True)
    workout = models.ForeignKey(Workout, on_delete=models.CASCADE, null=False, blank=False)

    points_raw = models.DecimalField(null=False, max_digits=10, decimal_places=2)
    points_capped = models.DecimalField(null=True, max_digits=10, decimal_places=2)

    class Meta:
        verbose_name = "Points"
        verbose_name_plural = "Points"
        constraints = [
            models.UniqueConstraint(
                fields=["goal", "workout"],
                condition=models.Q(award__isnull=True, goal__isnull=False),
                name="unique_goal_workout",
            ),
            models.UniqueConstraint(
                fields=["award", "workout"],
                condition=models.Q(goal__isnull=True, award__isnull=False),
                name="unique_award_workout",
            ),
        ]

    def __str__(self):
        """str print-out of model entry"""
        return f"{self.award if self.goal is None else self.goal} - {self.points_raw}"


class ExpeditionCampaign(models.Model):
    """Opt-in, challenge-scoped Expedition route and date lock."""

    competition = models.OneToOneField(
        Competition,
        on_delete=models.CASCADE,
        related_name="expedition",
    )
    enabled = models.BooleanField(
        default=False,
        help_text="Pilot flag: expose the Expedition to challenge participants.",
    )
    route_template = models.CharField(max_length=40, default="trail-v1", editable=False)
    # What the route is dressed as and what the crew is trying to do. The
    # theme rotates per organizer when left blank; the objective is picked
    # per challenge. Both are frozen once the campaign is locked.
    route_theme = models.CharField(
        max_length=20, blank=True, default="",
        help_text="Blank = rotate automatically (summit, ocean, desert, space, relay).",
    )
    objective = models.CharField(
        max_length=20, default="expedition",
        choices=(
            ("expedition", "Expedition - reach the far end together"),
            ("rescue", "Rescue run - stay ahead of the storm"),
            ("basecamp", "Base camp - hold the camp week after week"),
            ("treasure", "Treasure hunt - hidden landmarks"),
        ),
    )
    # One-week rule changes, planned at launch: [{"week_start", "kind"}].
    twist_plan = models.JSONField(default=list, blank=True, editable=False)
    # Mutable twist bookkeeping (shortcut votes and result).
    twist_state = models.JSONField(default=dict, blank=True, editable=False)
    # Snapshot from Competition, refreshed before launch, then locked. These
    # fields are not organizer-editable and never define a second duration.
    start_date = models.DateField(editable=False)
    end_date = models.DateField(editable=False)
    participant_ids_snapshot = models.JSONField(default=list, blank=True, editable=False)
    locked_at = models.DateTimeField(null=True, blank=True, editable=False)
    finale_snapshot = models.JSONField(default=dict, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if self._state.adding:
            self.start_date = self.competition.start_date
            self.end_date = self.competition.end_date
            if not self.route_theme:
                from .expedition_variants import pick_route_theme
                self.route_theme = pick_route_theme(self.competition)
        elif self.pk:
            previous = type(self).objects.only(
                "start_date", "end_date", "participant_ids_snapshot", "locked_at", "finale_snapshot",
                "route_theme", "objective",
            ).get(pk=self.pk)
            if previous.locked_at:
                self.start_date = previous.start_date
                self.end_date = previous.end_date
                self.participant_ids_snapshot = previous.participant_ids_snapshot
                self.route_theme = previous.route_theme
                self.objective = previous.objective
            elif not self.route_theme:
                from .expedition_variants import pick_route_theme
                self.route_theme = pick_route_theme(self.competition)
            if previous.finale_snapshot:
                self.finale_snapshot = previous.finale_snapshot
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Expedition for {self.competition}"

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_date__gte=models.F("start_date")),
                name="expedition_dates_are_ordered",
            ),
        ]


class ExpeditionMilestone(models.Model):
    """Stable route-stage/milestone identity and immutable completion snapshot."""

    campaign = models.ForeignKey(
        ExpeditionCampaign,
        on_delete=models.CASCADE,
        related_name="milestones",
    )
    stage_id = models.SlugField(max_length=40)
    milestone_id = models.SlugField(max_length=40)
    sequence = models.PositiveSmallIntegerField()
    opens_on = models.DateField()
    target_on = models.DateField()
    progress_fraction = models.DecimalField(max_digits=5, decimal_places=4, default=1)
    completed_at = models.DateTimeField(null=True, blank=True)
    coach_snapshot = models.JSONField(default=dict, blank=True)
    # Rescue objective: the stamp survives only when the landmark was reached
    # by its date. Always true for the other objectives.
    stamped = models.BooleanField(default=True)
    approved_asset_key = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["sequence"]
        constraints = [
            models.UniqueConstraint(
                fields=["campaign", "milestone_id"],
                name="unique_expedition_milestone_key",
            ),
            models.UniqueConstraint(
                fields=["campaign", "sequence"],
                name="unique_expedition_milestone_sequence",
            ),
        ]

    def __str__(self):
        return f"{self.campaign}: {self.milestone_id}"


class ExpeditionContribution(models.Model):
    """Idempotent per-participant ISO-week normalized score rollup."""

    campaign = models.ForeignKey(
        ExpeditionCampaign,
        on_delete=models.CASCADE,
        related_name="contributions",
    )
    participant = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="expedition_contributions",
    )
    week_start = models.DateField()
    normalized_points = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["week_start", "participant_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["campaign", "participant", "week_start"],
                name="unique_expedition_participant_week",
            ),
        ]
        indexes = [
            models.Index(fields=["campaign", "week_start"], name="expedition_week_lookup"),
        ]

    def __str__(self):
        return f"{self.campaign}: {self.participant_id} at {self.week_start}"


class Duel(models.Model):
    """Opt-in head-to-head between two athletes in one challenge.

    The app records an agreed forfeit as text. It never moves money.
    Scores are a window over the same Points rows as the leaderboard.
    """

    STATUS_PENDING = "pending"
    STATUS_COUNTERED = "countered"
    STATUS_ACTIVE = "active"
    STATUS_DECLINED = "declined"
    STATUS_EXPIRED = "expired"
    STATUS_CANCELLED = "cancelled"
    STATUS_COMPLETED = "completed"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_COUNTERED, "Countered"),
        (STATUS_ACTIVE, "Active"),
        (STATUS_DECLINED, "Declined"),
        (STATUS_EXPIRED, "Expired"),
        (STATUS_CANCELLED, "Cancelled"),
        (STATUS_COMPLETED, "Completed"),
    ]
    OPEN_STATUSES = (STATUS_PENDING, STATUS_COUNTERED, STATUS_ACTIVE)

    METRIC_POINTS = "points"
    METRIC_MINUTES = "minutes"
    METRIC_SPORT = "sport"
    METRIC_CHOICES = [
        (METRIC_POINTS, "Challenge points"),
        (METRIC_MINUTES, "Minutes goals"),
        (METRIC_SPORT, "One workout type"),
    ]

    RESULT_CHALLENGER = "challenger"
    RESULT_OPPONENT = "opponent"
    RESULT_TIE = "tie"
    RESULT_CHOICES = [
        ("", "Undecided"),
        (RESULT_CHALLENGER, "Challenger"),
        (RESULT_OPPONENT, "Opponent"),
        (RESULT_TIE, "Tie"),
    ]

    competition = models.ForeignKey(Competition, on_delete=models.CASCADE, related_name="duels")
    challenger = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="duels_started")
    opponent = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="duels_received")
    proposed_by = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="+")
    awaiting = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="+")
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_PENDING)
    duration_days = models.PositiveSmallIntegerField(default=7)
    metric = models.CharField(max_length=12, choices=METRIC_CHOICES, default=METRIC_POINTS)
    sport_type = models.CharField(max_length=40, blank=True, default="")
    forfeit = models.CharField(max_length=200, blank=True, default="")
    challenger_forfeit_public = models.BooleanField(default=False)
    opponent_forfeit_public = models.BooleanField(default=False)
    challenger_feed_opt_in = models.BooleanField(default=False)
    opponent_feed_opt_in = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    respond_by = models.DateTimeField()
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    grace_until = models.DateTimeField(null=True, blank=True)
    finalized_at = models.DateTimeField(null=True, blank=True)
    challenger_score = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    opponent_score = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    result = models.CharField(max_length=12, blank=True, default="", choices=RESULT_CHOICES)
    # Last leader we successfully told them about. Null means level or not yet pinged.
    leader_id = models.IntegerField(null=True, blank=True)
    pinged_accepted = models.BooleanField(default=False)
    pinged_24h = models.BooleanField(default=False)
    pinged_result = models.BooleanField(default=False)
    forfeit_marked_at = models.DateTimeField(null=True, blank=True)
    forfeit_confirmed_at = models.DateTimeField(null=True, blank=True)
    feed_posted = models.BooleanField(default=False)
    daily_snapshot = models.JSONField(default=dict, blank=True)
    rematch_of = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="rematches",
    )

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(challenger=models.F("opponent")),
                name="duel_two_athletes",
            ),
            models.CheckConstraint(
                condition=models.Q(duration_days__in=[3, 7, 14]),
                name="duel_duration_allowed",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "respond_by"], name="duel_status_respond"),
            models.Index(fields=["status", "grace_until"], name="duel_status_grace"),
            models.Index(fields=["challenger", "status"], name="duel_challenger_status"),
            models.Index(fields=["opponent", "status"], name="duel_opponent_status"),
        ]

    def __str__(self):
        return f"Duel {self.pk} {self.challenger_id} vs {self.opponent_id} ({self.status})"


class DuelBlock(models.Model):
    """One athlete blocking further duel invites from another."""

    blocker = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="duel_blocks_made")
    blocked = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="duel_blocks_received")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["blocker", "blocked"], name="one_duel_block"),
            models.CheckConstraint(
                condition=~models.Q(blocker=models.F("blocked")),
                name="duel_block_not_self",
            ),
        ]

    def __str__(self):
        return f"{self.blocker_id} blocks {self.blocked_id}"


class DuelNote(models.Model):
    """Coach line visible only to the two duelists."""

    KIND_ACCEPTED = "accepted"
    KIND_LEAD = "lead"
    KIND_DAY_LEFT = "day_left"
    KIND_RESULT = "result"

    duel = models.ForeignKey(Duel, on_delete=models.CASCADE, related_name="notes")
    kind = models.CharField(max_length=12)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"Duel {self.duel_id} {self.kind}"


class DuelPing(models.Model):
    """Private lock-screen ping for one duelist. Android polls these."""

    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="duel_pings")
    duel = models.ForeignKey(Duel, on_delete=models.CASCADE, related_name="pings")
    kind = models.CharField(max_length=12, default="lead")
    title = models.CharField(max_length=120)
    body = models.CharField(max_length=240)
    url = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    seen_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "duel", "kind"],
                condition=~models.Q(kind="lead"),
                name="one_duel_ping_event",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "seen_at"], name="duel_ping_unseen"),
        ]

    def __str__(self):
        return f"Ping {self.pk} for {self.user_id}"


class SkiWeekCampaign(models.Model):
    """Opt-in ski week on a challenge. One row, like Expedition.

    Resort-day boundaries use ``timezone`` and ``day_cutoff_hour`` so a
    2am après still belongs to the evening that just ended. Sambuca
    points are ``amount * points_per_sambuca`` and stay out of the
    workout Points rows so the breakdown can name them.
    """

    competition = models.OneToOneField(
        Competition,
        on_delete=models.CASCADE,
        related_name="skiweek",
    )
    enabled = models.BooleanField(default=False)
    resort_slug = models.CharField(max_length=40, blank=True, default="")
    resort_name = models.CharField(max_length=80, blank=True, default="")
    latitude = models.DecimalField(max_digits=8, decimal_places=5, null=True, blank=True)
    longitude = models.DecimalField(max_digits=8, decimal_places=5, null=True, blank=True)
    summit_elevation_m = models.PositiveIntegerField(null=True, blank=True)
    valley_elevation_m = models.PositiveIntegerField(null=True, blank=True)
    timezone = models.CharField(max_length=64, default="Europe/Zurich")
    day_cutoff_hour = models.PositiveSmallIntegerField(default=5)
    water_enabled = models.BooleanField(default=False)
    # 5 points is one twentieth of a 100-point goal. A few Sambucas
    # register on the board; they do not replace a ski day.
    points_per_sambuca = models.DecimalField(
        max_digits=6, decimal_places=2, default=Decimal("5.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    # Last good snow report. Served only when the live fetch fails.
    weather_snapshot = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(day_cutoff_hour__gte=0, day_cutoff_hour__lte=23),
                name="skiweek_cutoff_hour_in_day",
            ),
            models.CheckConstraint(
                condition=models.Q(points_per_sambuca__gte=0),
                name="skiweek_sambuca_points_nonnegative",
            ),
        ]

    def __str__(self):
        return f"Skiwoche {self.resort_name or self.competition}"


class SambucaEntry(models.Model):
    """One Sambuca or water log. The drink name is fixed as Sambuca."""

    KIND_SAMBUCA = "sambuca"
    KIND_WATER = "water"
    KIND_CHOICES = (
        (KIND_SAMBUCA, "Sambuca"),
        (KIND_WATER, "Water"),
    )

    campaign = models.ForeignKey(SkiWeekCampaign, on_delete=models.CASCADE, related_name="sips")
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="sambuca_sips")
    kind = models.CharField(max_length=12, choices=KIND_CHOICES, default=KIND_SAMBUCA)
    amount = models.PositiveSmallIntegerField(default=1)
    logged_at = models.DateTimeField(default=timezone.now)
    resort_day = models.DateField()
    photo = models.ImageField(upload_to="skiweek/sambuca/", blank=True)

    class Meta:
        ordering = ["-logged_at", "-id"]
        indexes = [
            models.Index(fields=["campaign", "resort_day", "kind"], name="skiweek_sip_day"),
            models.Index(fields=["campaign", "user", "logged_at"], name="skiweek_sip_user"),
        ]

    def __str__(self):
        return f"{self.kind} x{self.amount} {self.user_id} {self.resort_day}"


class SambucaSettlement(models.Model):
    """A resort day whose crown is frozen. winning_count 0 means nobody logged."""

    campaign = models.ForeignKey(SkiWeekCampaign, on_delete=models.CASCADE, related_name="settlements")
    resort_day = models.DateField()
    winning_count = models.PositiveIntegerField(default=0)
    settled_at = models.DateTimeField(auto_now_add=True)
    announced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["campaign", "resort_day"], name="one_skiweek_settlement_per_day"),
        ]
        ordering = ["-resort_day"]

    def __str__(self):
        return f"Crown {self.campaign_id} {self.resort_day} ({self.winning_count})"


class SambucaCrown(models.Model):
    """One wearer of a settled crown. Ties create one row per tied user."""

    settlement = models.ForeignKey(SambucaSettlement, on_delete=models.CASCADE, related_name="crowns")
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="sambuca_crowns")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["settlement", "user"], name="one_crown_per_user_per_day"),
        ]

    def __str__(self):
        return f"Crown {self.settlement_id} user {self.user_id}"


class SkiWeekTeaser(models.Model):
    """One coach countdown line per milestone. The unique key is the dedupe."""

    campaign = models.ForeignKey(SkiWeekCampaign, on_delete=models.CASCADE, related_name="teasers")
    milestone = models.CharField(max_length=12)
    body = models.TextField()
    source = models.CharField(max_length=12, default="fallback")
    message_id = models.PositiveIntegerField(null=True, blank=True)
    posted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["campaign", "milestone"], name="one_skiweek_teaser_per_milestone"),
        ]
        ordering = ["posted_at"]

    def __str__(self):
        return f"{self.milestone} for {self.campaign_id}"


class SkiWeekAward(models.Model):
    """One end-of-week award. Ties are several rows with the same kind."""

    campaign = models.ForeignKey(SkiWeekCampaign, on_delete=models.CASCADE, related_name="awards")
    kind = models.CharField(max_length=32)
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="skiweek_awards")
    value = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    detail = models.CharField(max_length=80, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["campaign", "kind", "user"], name="one_skiweek_award_per_user"),
        ]
        ordering = ["kind", "-value"]

    def __str__(self):
        return f"{self.kind} {self.user_id}"


class SkiPhotoCard(models.Model):
    """A coach-edited ski-week picture: coronation, hut postcard, or split.

    Hut and split cards are one per person per resort day. The coronation
    is one card for the day, shared when the crown is shared.
    """

    KIND_CORONATION = "coronation"
    KIND_HUT = "hut"
    KIND_SPLIT = "split"
    KINDS = (KIND_CORONATION, KIND_HUT, KIND_SPLIT)

    campaign = models.ForeignKey(SkiWeekCampaign, on_delete=models.CASCADE, related_name="photo_cards")
    user = models.ForeignKey(
        CustomUser, null=True, blank=True, on_delete=models.CASCADE, related_name="ski_photo_cards",
    )
    kind = models.CharField(max_length=16)
    resort_day = models.DateField()
    source = models.ImageField(upload_to="skiweek/cards/", blank=True)
    source_b = models.ImageField(upload_to="skiweek/cards/", blank=True)
    result = models.ImageField(upload_to="skiweek/cards/", blank=True)
    body = models.TextField(blank=True, default="")
    fallback = models.BooleanField(default=False)
    refreshed = models.BooleanField(default=False)
    message_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    subjects = models.ManyToManyField(CustomUser, blank=True, related_name="ski_photo_subjects")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["campaign", "user", "kind", "resort_day"],
                condition=models.Q(kind__in=["hut", "split"]),
                name="one_ski_photo_per_user_day",
            ),
            models.UniqueConstraint(
                fields=["campaign", "kind", "resort_day"],
                condition=models.Q(kind="coronation"),
                name="one_coronation_per_resort_day",
            ),
        ]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.kind} {self.campaign_id} {self.resort_day}"