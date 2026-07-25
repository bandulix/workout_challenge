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

    Holds the Matrix destination, the chosen persona, and a small set of
    feature toggles. Access tokens are write-only on the API: only a
    short masked preview is ever returned to the client.
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

    matrix_homeserver = models.CharField(max_length=200)
    matrix_access_token = models.CharField(max_length=512)
    matrix_room_id = models.CharField(max_length=120)
    matrix_bot_display_name = models.CharField(max_length=60, blank=True, default="")

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

    @property
    def access_token_masked(self):
        token = self.matrix_access_token or ""
        if len(token) <= 6:
            return "*" * len(token)
        return f"{'*' * (len(token) - 4)}{token[-4:]}"


class DrillInstructorMessage(models.Model):
    """Audit log of every message the Drill Instructor has posted.

    Useful for debugging, for the owner to see what's been said, and as
    a safety trail so the same workout is never commented on twice.
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
    matrix_event_id = models.CharField(max_length=120, blank=True, default="")
    body = models.TextField()
    posted_at = models.DateTimeField(default=timezone.now)
    success = models.BooleanField(default=True)
    error = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-posted_at"]

    def __str__(self):
        return f"[{self.posted_at:%Y-%m-%d %H:%M}] {self.config.competition.name}: {self.body[:60]}"
