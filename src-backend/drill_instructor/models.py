from django.db import models
from django.utils import timezone

from competition.models import Competition
from custom_user.models import CustomUser


class DrillInstructorPersona(models.Model):
    """A reusable persona/style for the AI Drill Instructor.

    Built-ins are a shared library any competition owner can pick.
    Anyone can also create their own roaster; only they (or staff) can
    edit it or assign it to a challenge they own.
    """

    name = models.CharField(max_length=60, unique=True)
    description = models.CharField(max_length=200, blank=True, default="")
    tagline = models.CharField(
        max_length=80,
        blank=True,
        default="",
        help_text="Short one-liner shown under the persona's name in the Coach UI.",
    )
    avatar = models.CharField(
        max_length=40,
        blank=True,
        default="",
        help_text=(
            "Avatar artwork key. Either one of the built-in keys shipped in "
            "the frontend (/personas/<key>.svg) or a custom emoji character."
        ),
    )
    profile_picture = models.ImageField(
        upload_to="persona_pics/",
        null=True,
        blank=True,
        help_text="Custom uploaded profile picture. Takes precedence over the avatar artwork/emoji when set.",
    )
    theme_color = models.CharField(
        max_length=7,
        blank=True,
        default="",
        help_text="Hex accent colour (e.g. #d7ff3e) used for the persona's avatar ring and chat bubbles.",
    )
    system_prompt = models.TextField()
    is_builtin = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        CustomUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_personas",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ["name"]


class DrillInstructorConfig(models.Model):
    """Per-competition Drill Instructor configuration.

    Holds the chosen persona and a small set of feature toggles. The
    instructor writes its generated messages to ``DrillInstructorMessage``
    so the competition owner can read them back; push notifications and
    "test message" previews go through the in-app channels.
    """

    competition = models.OneToOneField(
        Competition,
        on_delete=models.CASCADE,
        related_name="drill_instructor",
    )

    enabled = models.BooleanField(default=False)

    persona = models.ForeignKey(
        DrillInstructorPersona,
        on_delete=models.PROTECT,
        related_name="competitions",
    )

    comment_on_activity = models.BooleanField(default=True)
    nudge_on_inactivity = models.BooleanField(
        default=True,
        help_text=(
            "If a whole day passes without any workout in a running "
            "competition, the instructor posts one motivational nudge "
            "to keep the group active."
        ),
    )
    send_push_on_activity = models.BooleanField(
        default=False,
        help_text="Also send a browser push notification to every subscribed participant.",
    )
    random_push = models.BooleanField(
        default=True,
        help_text=(
            "The instructor pushes the group once per day at a random "
            "time (waking hours, 07:00-22:00) with a persona-voiced pep "
            "talk - independent of whether anyone trained."
        ),
    )
    # Bookkeeping for the random daily push: the day's random slot(s) are
    # drawn once (list of "HH:MM" strings) and reused for the rest of the
    # day, so re-running the beat task never re-rolls the dice.
    push_plan_date = models.DateField(null=True, blank=True)
    push_plan = models.JSONField(default=list, blank=True)

    last_error = models.TextField(blank=True, default="")
    last_posted_at = models.DateTimeField(null=True, blank=True)
    messages_posted = models.IntegerField(default=0)

    # Last place on the board at the nightly sweep wears the megaphone
    # until they log a workout. Null = nobody currently crowned.
    dunce = models.ForeignKey(
        CustomUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="drill_dunce_crowns",
    )
    dunce_since = models.DateTimeField(null=True, blank=True)

    # Weekly group vote: the winner takes the megaphone each Monday.
    # persona_changed_at is when the last automatic (or first) handover
    # happened, so the challenge page can show a countdown for the term.
    previous_persona = models.ForeignKey(
        DrillInstructorPersona,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    persona_changed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        state = "enabled" if self.enabled else "disabled"
        return f"Drill Instructor ({state}) for {self.competition}"

    class Meta:
        ordering = ["competition__name"]


class DrillInstructorMessage(models.Model):
    """Audit log of every Drill Instructor message generated.

    When the instructor is enabled, generated workout comments and any
    "test message" preview are stored here so the competition owner can
    read them back from the webapp.
    """

    KIND_ACTIVITY = "activity"
    KIND_TEST = "test"
    KIND_NUDGE = "nudge"
    KIND_PUSH = "push"
    KIND_REPLY = "reply"
    KIND_REACTION = "reaction"
    KIND_PHOTO = "photo"
    KIND_ORDER = "order"
    KIND_SIGH = "sigh"
    KIND_DUNCE = "dunce"
    KIND_HANDOVER = "handover"
    KIND_ECHO = "echo"
    KIND_CLAIM = "claim"
    KIND_WAR = "war"
    KIND_CHOICES = [
        (KIND_ACTIVITY, "Workout comment"),
        (KIND_TEST, "Test message"),
        (KIND_NUDGE, "Inactivity nudge"),
        (KIND_PUSH, "Random group push"),
        (KIND_REPLY, "Participant reply"),
        (KIND_REACTION, "Coach reaction"),
        (KIND_PHOTO, "Participant photo post"),
        (KIND_ORDER, "Daily order"),
        (KIND_SIGH, "Order failure"),
        (KIND_DUNCE, "Dunce crowning"),
        (KIND_HANDOVER, "Weekly coach handover"),
        (KIND_ECHO, "Legend Echo minted"),
        (KIND_CLAIM, "Legend Echo claimed"),
        (KIND_WAR, "Legend Echo war"),
    ]

    config = models.ForeignKey(
        DrillInstructorConfig,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    # Snapshotted at write time so switching the competition's coach
    # later does not rewrite historical avatars / names in the feed.
    persona = models.ForeignKey(
        DrillInstructorPersona,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="messages",
        help_text="Persona that was on duty when this message was written.",
    )
    kind = models.CharField(
        max_length=12,
        choices=KIND_CHOICES,
        default=KIND_ACTIVITY,
        help_text="What triggered this message (a workout, a test, a quiet-day nudge, a random group push, a participant reply, or the coach's reaction to one).",
    )
    # Threading: replies (and the coach's reactions to them) hang under a
    # top-level coach message. One level deep on purpose - sub-threads
    # would only confuse the chat UI.
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="replies",
    )
    # Who wrote this message. NULL = the coach (persona); set for
    # participant replies and photo posts.
    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="drill_instructor_replies",
    )
    # Photo posts (kind=photo): the uploaded picture. Compressed
    # client-side before upload; served only through the authenticated
    # picture endpoint, never via public /media/.
    image = models.ImageField(
        upload_to="message_pics/",
        null=True,
        blank=True,
    )
    workout = models.ForeignKey(
        "workouts.Workout",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="drill_instructor_messages",
    )
    body = models.TextField()
    posted_at = models.DateTimeField(default=timezone.now)
    success = models.BooleanField(default=True)
    error = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-posted_at"]
        indexes = [
            # The coach feed filters by config and orders by recency.
            models.Index(fields=["config", "-posted_at"], name="drill_msg_config_time"),
        ]

    def save(self, *args, **kwargs):
        if not self.persona_id and self.config_id:
            self.persona_id = self.config.persona_id
        super().save(*args, **kwargs)

    def __str__(self):
        return f"[{self.posted_at:%Y-%m-%d %H:%M}] {self.config.competition.name}: {self.body[:60]}"


class DrillInstructorPhotoVote(models.Model):
    """One user's hot-or-not verdict on a roasted photo.

    Feeds the swipe box on the Coach page: every participant of the
    competition gets one vote per roast image. A second vote is refused.
    """

    message = models.ForeignKey(
        DrillInstructorMessage,
        on_delete=models.CASCADE,
        related_name="photo_votes",
    )
    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="drill_photo_votes",
    )
    hot = models.BooleanField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["message", "user"], name="one_vote_per_roast"),
        ]
        indexes = [
            models.Index(fields=["message", "hot"], name="roast_vote_tally"),
        ]

    def __str__(self):
        return f"{'hot' if self.hot else 'not'} by {self.user_id} on roast {self.message_id}"


# Emoji reactions on activity cards. Slugs are stable; glyphs live in the
# frontend so we can restyle without a migration.
ACTIVITY_REACT_EMOJIS = (
    "fire",
    "beast",
    "volt",
    "goat",
    "podium",
    "rocket",
    "ice",
    "how",
    "menace",
    "dead",
    "melted",
    "heavy",
    "salute",
    "love",
)


class DrillInstructorActivityReact(models.Model):
    """One emoji reaction from one user on an activity card.

    One stamp per person: posting a different slug replaces the old one;
    posting the same slug again removes it. Only activity roots are valid.
    """

    message = models.ForeignKey(
        DrillInstructorMessage,
        on_delete=models.CASCADE,
        related_name="activity_reacts",
    )
    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="drill_activity_reacts",
    )
    emoji = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["message", "user"],
                name="one_react_per_user",
            ),
        ]
        indexes = [
            models.Index(fields=["message", "emoji"], name="activity_react_tally"),
        ]
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.emoji} by {self.user_id} on activity {self.message_id}"


class DrillInstructorPersonaVote(models.Model):
    """One participant's vote for next week's coach in a challenge.

    Unique per (config, user): changing your mind overwrites the row.
    Tallied Monday morning; the winner takes over and votes reset.
    """

    config = models.ForeignKey(
        DrillInstructorConfig,
        on_delete=models.CASCADE,
        related_name="persona_votes",
    )
    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="drill_persona_votes",
    )
    persona = models.ForeignKey(
        DrillInstructorPersona,
        on_delete=models.CASCADE,
        related_name="challenge_votes",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["config", "user"], name="one_persona_vote_per_user"),
        ]
        indexes = [
            models.Index(fields=["config", "persona"], name="persona_vote_tally"),
        ]

    def __str__(self):
        return f"user {self.user_id} -> persona {self.persona_id} on config {self.config_id}"


class DailyOrder(models.Model):
    """The coach's sealed order for one competition-day.

    Issued each morning. Completing it pins a ribbon on the athlete's
    feed; a quiet field at close-of-day gets a public sigh.
    """

    KIND_LOG = "log_one"
    KIND_MINUTES = "min_minutes"
    KIND_RIVAL = "beat_rival"
    KIND_PHOTO = "photo_proof"
    KIND_CHOICES = [
        (KIND_LOG, "Log any workout"),
        (KIND_MINUTES, "Hit a minutes target"),
        (KIND_RIVAL, "Beat a rival's minutes"),
        (KIND_PHOTO, "Post photo proof"),
    ]

    config = models.ForeignKey(
        DrillInstructorConfig,
        on_delete=models.CASCADE,
        related_name="daily_orders",
    )
    date = models.DateField()
    kind = models.CharField(max_length=16, choices=KIND_CHOICES)
    spec = models.JSONField(default=dict, blank=True)
    brief = models.CharField(max_length=280)
    failed_announced = models.BooleanField(default=False)
    completed_by = models.ManyToManyField(
        CustomUser,
        blank=True,
        related_name="completed_daily_orders",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["config", "date"], name="one_order_per_config_day"),
        ]
        ordering = ["-date"]
        indexes = [
            models.Index(fields=["config", "date"], name="daily_order_config_day"),
        ]

    def __str__(self):
        return f"{self.date} {self.kind} for {self.config_id}"


class DogTag(models.Model):
    """A permanent collector's tag. Earned once, never taken away."""

    SLUG_FIRST_BLOOD = "first_blood"
    SLUG_GHOST_KILLER = "ghost_killer"
    SLUG_PHOTOGENIC = "photogenic"
    SLUG_MONDAY = "never_missed_monday"
    SLUG_SURVIVED = "survived_the_dunce"
    SLUG_ECHO_IMMORTAL = "echo_immortal"
    SLUG_ECHO_SLAYER = "echo_slayer"
    SLUG_CHOICES = [
        (SLUG_FIRST_BLOOD, "First Blood"),
        (SLUG_GHOST_KILLER, "Ghost Killer"),
        (SLUG_PHOTOGENIC, "Photogenic"),
        (SLUG_MONDAY, "Never Missed Monday"),
        (SLUG_SURVIVED, "Survived the Dunce"),
        (SLUG_ECHO_IMMORTAL, "Echo Immortal"),
        (SLUG_ECHO_SLAYER, "Echo Slayer"),
    ]

    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="dog_tags",
    )
    slug = models.CharField(max_length=32, choices=SLUG_CHOICES)
    earned_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "slug"], name="one_dog_tag_per_user"),
        ]
        ordering = ["earned_at"]

    def __str__(self):
        return f"{self.user_id}:{self.slug}"


class LegendEcho(models.Model):
    """A claimable, living trophy minted from a standout workout."""

    STATUS_UNDEFEATED = "undefeated"
    STATUS_CONTESTED = "contested"
    STATUS_IMMORTAL = "immortal"
    STATUS_RETIRED = "retired"
    STATUS_CHOICES = [
        (STATUS_UNDEFEATED, "Undefeated"),
        (STATUS_CONTESTED, "Contested"),
        (STATUS_IMMORTAL, "Immortal"),
        (STATUS_RETIRED, "Retired"),
    ]
    METRIC_DURATION = "duration"
    METRIC_DISTANCE = "distance"
    METRIC_CHOICES = [
        (METRIC_DURATION, "Minutes"),
        (METRIC_DISTANCE, "Kilometres"),
    ]

    config = models.ForeignKey(
        DrillInstructorConfig,
        on_delete=models.CASCADE,
        related_name="echoes",
    )
    origin_user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="echoes_originated",
    )
    origin_workout = models.ForeignKey(
        "workouts.Workout",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="echoes_originated",
    )
    holder = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="echoes_held",
    )
    holder_workout = models.ForeignKey(
        "workouts.Workout",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="echoes_held",
    )
    title = models.CharField(max_length=80)
    narrative = models.TextField()
    power = models.PositiveSmallIntegerField(default=1)
    metric = models.CharField(max_length=12, choices=METRIC_CHOICES, default=METRIC_DURATION)
    metric_value = models.FloatField()
    sport_type = models.CharField(max_length=40)
    image = models.ImageField(upload_to="echo_pics/", null=True, blank=True)
    chain_length = models.PositiveIntegerField(default=1)
    defenses = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_UNDEFEATED)
    created_at = models.DateTimeField(auto_now_add=True)
    last_claimed_at = models.DateTimeField(null=True, blank=True)
    immortalized_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-power", "-created_at"]
        indexes = [
            models.Index(fields=["config", "status"], name="echo_config_status"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["config", "origin_workout"],
                condition=models.Q(origin_workout__isnull=False),
                name="one_echo_per_origin_workout",
            ),
        ]

    def __str__(self):
        return f"{self.title} ({self.status}) in config {self.config_id}"


class EchoChallenge(models.Model):
    """One attempt to claim a Legend Echo inside a time window."""

    STATUS_ACTIVE = "active"
    STATUS_WON = "won"
    STATUS_LOST = "lost"
    STATUS_EXPIRED = "expired"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_WON, "Won"),
        (STATUS_LOST, "Lost"),
        (STATUS_EXPIRED, "Expired"),
    ]

    echo = models.ForeignKey(
        LegendEcho,
        on_delete=models.CASCADE,
        related_name="challenges",
    )
    challenger = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="echo_challenges",
    )
    committed_at = models.DateTimeField(auto_now_add=True)
    window_end = models.DateTimeField()
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    resolving_workout = models.ForeignKey(
        "workouts.Workout",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="echo_resolves",
    )

    class Meta:
        ordering = ["-committed_at"]
        indexes = [
            models.Index(fields=["status", "window_end"], name="echo_chal_status_end"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["echo"],
                condition=models.Q(status="active"),
                name="one_active_challenge_per_echo",
            ),
            models.UniqueConstraint(
                fields=["challenger"],
                condition=models.Q(status="active"),
                name="one_active_echo_war_per_user",
            ),
        ]

    def __str__(self):
        return f"challenge {self.pk} on echo {self.echo_id} ({self.status})"
