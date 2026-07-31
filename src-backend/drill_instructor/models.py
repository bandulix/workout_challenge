from django.conf import settings
from django.db import models
from django.utils import timezone

from competition.models import Competition
from custom_user.models import CustomUser


class DrillInstructorPersona(models.Model):
    """A reusable persona/style for the AI Drill Instructor.

    Personas are global and can be picked by any competition owner when
    configuring their Drill Instructor.
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
    send_push_on_activity = models.BooleanField(
        default=False,
        help_text="Also send a browser push notification to every subscribed participant.",
    )

    last_error = models.TextField(blank=True, default="")
    last_posted_at = models.DateTimeField(null=True, blank=True)
    messages_posted = models.IntegerField(default=0)

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

    config = models.ForeignKey(
        DrillInstructorConfig,
        on_delete=models.CASCADE,
        related_name="messages",
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

    def __str__(self):
        return f"[{self.posted_at:%Y-%m-%d %H:%M}] {self.config.competition.name}: {self.body[:60]}"
