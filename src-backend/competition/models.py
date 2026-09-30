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