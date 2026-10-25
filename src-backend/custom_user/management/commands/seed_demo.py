"""One coherent demo dataset for screenshots and local clicking.

Idempotent. Marks the demo user email-verified, then fills the WHO
challenge with a few athletes, two weeks of mixed workouts, feed cards
(including a photo and a remix from bundled Unsplash fixtures, a roast, stamps, and orders), a live ride duel
with a dead-heat day, a W-L-T record, expedition progress, and readiness
in all three bands.
"""

from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.utils import timezone

from competition.models import Competition, Duel, DuelNote, Team
from custom_user.models import CustomUser
from workouts.models import Workout

MARK = "\u200b"
DEMO_GARMIN = "seed-demo-"


class Command(BaseCommand):
    help = "Seed one coherent demo dataset for the WHO challenge."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_demo refuses to run with DEBUG=false.")
        call_command("migrate", interactive=False, verbosity=1)
        tables = set(connection.introspection.table_names())
        if "competition_duel" not in tables:
            raise CommandError(
                "competition_duel is missing after migrate. "
                "The duel migration has to be applied before the demo can seed."
            )

        users = self._users()
        competition = Competition.objects.filter(join_code__iexact="WHOCOMP").first()
        if competition is None:
            raise CommandError("WHO challenge is missing. Run add_dummy_data first.")
        team = Team.objects.filter(competition=competition).order_by("id").first()
        for user in users.values():
            user.my_competitions.add(competition)
            if team is not None:
                user.my_teams.add(team)
            competition.user.add(user)

        self._clear_demo(competition)
        workouts = self._workouts(users)
        config = self._coach(competition)
        messages = self._feed(config, users, workouts)
        self._duels(competition, users)
        self._stamps(users)
        progress = self._expedition(competition)
        from custom_user.management.commands.add_dummy_data import _seed_readiness
        _seed_readiness(self.stdout)
        cache.clear()
        self.stdout.write(self.style.SUCCESS(
            f"Demo ready. {len(workouts)} new workouts, {len(messages)} feed posts, "
            f"expedition {progress}% . Sign in as user1@admin.local / password."
        ))

    def _users(self):
        specs = [
            ("user1@admin.local", "Charlotte", "Doe", "Charlotte D.", True),
            ("user2@admin.local", "Tom", "Smith-Bloggs", "Tom S.B.", True),
            ("user3@admin.local", "Ursula", "von der Leyen", "Ursula V.", False),
            ("user4@admin.local", "Mina", "Okonkwo", "Mina O.", False),
        ]
        found = {}
        for email, first, last, username, staff in specs:
            user = CustomUser.objects.filter(email=email).first()
            if user is None:
                user = CustomUser.objects.create_user(
                    email=email, password="password", first_name=first, last_name=last,
                    is_staff=staff, is_superuser=staff,
                )
            user.is_verified = True
            user.first_name = first
            user.last_name = last
            # username is sticky: save() only invents one when the field is
            # empty, which left the podium on "User v.d.L." after a rename.
            user.username = username
            user.save()
            found[email] = user
            self.stdout.write(f"Verified {email}")
        return found

    def _clear_demo(self, competition):
        from drill_instructor.models import DrillInstructorMessage
        DrillInstructorMessage.objects.filter(body__startswith=MARK, config__competition=competition).delete()
        Workout.objects.filter(garmin_id__startswith=DEMO_GARMIN).delete()

    def _at(self, days_ago, hour):
        local = timezone.localtime() - timedelta(days=days_ago)
        return local.replace(hour=hour, minute=15, second=0, microsecond=0)

    def _log(self, user, sport, days_ago, hour, minutes, key, intensity=2):
        # garmin_id marks the row as an import, which skips distance
        # estimation. Set kilometres here so run and ride cards have a distance.
        speed = {"Run": 10, "Ride": 24, "Walk": 5}.get(sport)
        workout = Workout(
            user=user,
            sport_type=sport,
            start_datetime=self._at(days_ago, hour),
            duration=timedelta(minutes=minutes),
            intensity_category=intensity,
            distance=round(speed * minutes / 60, 2) if speed else None,
            garmin_id=f"{DEMO_GARMIN}{user.id}-{days_ago}-{hour}-{key}"[:40],
        )
        workout.save()
        return workout

    def _workouts(self, users):
        c, t, u, m = (users[f"user{i}@admin.local"] for i in (1, 2, 3, 4))
        plan = [
            (c, "Run", 1, 7, 52, "run"),
            (t, "Ride", 1, 18, 70, "ride"),
            (u, "WeightTraining", 2, 12, 40, "lift"),
            (m, "Run", 3, 8, 35, "minarun"),
            (c, "Ride", 4, 7, 45, "heat"),
            (t, "Ride", 4, 17, 45, "heattom"),
            (c, "Ride", 5, 7, 80, "long"),
            (t, "Ride", 6, 18, 30, "short"),
            (u, "Workout", 8, 9, 25, "mob"),
            (m, "WeightTraining", 10, 19, 50, "press"),
            (c, "Ride", 2, 7, 55, "gap"),
            (t, "Run", 9, 8, 28, "easy"),
        ]
        workouts = [self._log(*row) for row in plan]
        self.stdout.write(f"Logged {len(workouts)} demo workouts")
        return workouts

    def _coach(self, competition):
        from drill_instructor.models import DrillInstructorConfig, DrillInstructorPersona
        persona = DrillInstructorPersona.objects.filter(name="Drill Sergeant").first()
        if persona is None:
            persona = DrillInstructorPersona.objects.order_by("id").first()
        if persona is None:
            raise CommandError("No coach persona is installed.")
        config = DrillInstructorConfig.objects.filter(competition=competition).first()
        if config is None:
            config = DrillInstructorConfig.objects.create(
                competition=competition, persona=persona, enabled=True,
            )
        elif not config.enabled or config.persona_id != persona.id or not config.comment_on_activity:
            config.enabled = True
            config.persona = persona
            config.comment_on_activity = True
            config.save()
        return config

    def _feed(self, config, users, workouts):
        from drill_instructor.models import DrillInstructorActivityReact, DrillInstructorMessage
        c, t, u, m = (users[f"user{i}@admin.local"] for i in (1, 2, 3, 4))
        by_key = {w.garmin_id.rsplit("-", 1)[-1]: w for w in workouts}
        posts = []

        def activity(workout, body, when):
            msg = DrillInstructorMessage.objects.create(
                config=config,
                persona=config.persona,
                kind=DrillInstructorMessage.KIND_ACTIVITY,
                workout=workout,
                body=MARK + body,
                posted_at=when,
                success=True,
            )
            posts.append(msg)
            return msg

        roast = activity(
            by_key["long"],
            "Eighty minutes and you still had a gear left. Enjoy it. Tomorrow is not a parade.",
            timezone.now() - timedelta(minutes=30),
        )
        DrillInstructorMessage.objects.create(
            config=config,
            persona=config.persona,
            kind=DrillInstructorMessage.KIND_REPLY,
            parent=roast,
            user=c,
            body=MARK + "Roast me",
            posted_at=roast.posted_at + timedelta(minutes=2),
            success=True,
        )
        DrillInstructorMessage.objects.create(
            config=config,
            persona=config.persona,
            kind=DrillInstructorMessage.KIND_REPLY,
            parent=roast,
            body=MARK + "Tomorrow\n- Easy 30 minutes\n- Keep the ride in zone 2\n- Stop while you still want one more hill",
            posted_at=roast.posted_at + timedelta(minutes=3),
            success=True,
        )

        remix_parent = activity(
            by_key["run"],
            "That run looked honest. The hill did not clap.",
            timezone.now() - timedelta(minutes=12),
        )
        upload = DrillInstructorMessage(
            config=config,
            persona=config.persona,
            kind=DrillInstructorMessage.KIND_PHOTO,
            parent=remix_parent,
            user=c,
            body=MARK + "The hill, before the coach got to it.",
            posted_at=remix_parent.posted_at + timedelta(minutes=2),
            success=True,
        )
        upload.image.save("demo-photo.jpg", ContentFile(_scene("trail")), save=True)
        remix = DrillInstructorMessage(
            config=config,
            persona=config.persona,
            kind=DrillInstructorMessage.KIND_REACTION,
            parent=remix_parent,
            body=MARK + "Posted it. The coach redrew the hill steeper.",
            posted_at=remix_parent.posted_at + timedelta(minutes=4),
            success=True,
        )
        remix.image.save("demo-remix.jpg", ContentFile(_scene("dusk")), save=True)

        activity(by_key["lift"], "Forty minutes under the bar. Leave the ego on the rack.", by_key["lift"].start_datetime)
        activity(by_key["press"], "Fifty minutes. The bar moved. You moved with it.", by_key["press"].start_datetime)
        activity(by_key["ride"], "Seventy minutes and the city was still there when you got back.", by_key["ride"].start_datetime)
        activity(by_key["heat"], "Same ride as Tom, same clock. Dead heat. Do not get comfortable.", by_key["heat"].start_datetime)
        activity(by_key["heattom"], "Charlotte matched your clock. That is not a gift. Answer it.", by_key["heattom"].start_datetime)
        activity(by_key["minarun"], "Thirty-five minutes, held together. Do it again before it gets comfortable.", by_key["minarun"].start_datetime)
        activity(by_key["gap"], "You opened a gap. It only counts if you are there tomorrow.", by_key["gap"].start_datetime)
        activity(by_key["mob"], "Mobility counts. So does showing up.", by_key["mob"].start_datetime)
        activity(by_key["short"], "Thirty minutes, easy gear. That is how tomorrow stays possible.", by_key["short"].start_datetime)
        activity(by_key["easy"], "Twenty-eight easy minutes. Leave the heroics for the day that asks.", by_key["easy"].start_datetime)

        for text, days in (
            ("Order of the day: 40 steady minutes. Technique over heroics.", 1),
            ("Order of the day: an easy spin, or a real rest. Both are allowed.", 2),
        ):
            DrillInstructorMessage.objects.create(
                config=config,
                persona=config.persona,
                kind=DrillInstructorMessage.KIND_ORDER,
                body=MARK + text,
                posted_at=self._at(days, 6),
                success=True,
            )

        stamped = remix_parent
        for user, emoji in ((t, "how"), (u, "goat"), (m, "heavy"), (c, "goat")):
            DrillInstructorActivityReact.objects.update_or_create(
                message=stamped, user=user, defaults={"emoji": emoji},
            )
        return posts

    def _duels(self, competition, users):
        c, t, u, m = (users[f"user{i}@admin.local"] for i in (1, 2, 3, 4))
        now = timezone.now()
        live = self._upsert_duel(
            competition, c, t, "Demo ride duel",
            status=Duel.STATUS_ACTIVE,
            metric=Duel.METRIC_SPORT,
            sport_type="Ride",
            duration_days=7,
            respond_by=now - timedelta(days=6),
            starts_at=self._at(6, 0),
            ends_at=now + timedelta(days=1),
            grace_until=now + timedelta(days=1, hours=6),
            challenger_score=0,
            opponent_score=0,
            result="",
            finalized_at=None,
        )
        DuelNote.objects.get_or_create(
            duel=live, kind=DuelNote.KIND_ACCEPTED,
            defaults={"body": f"@{c.first_name} versus @{t.first_name}. Rides only. One of those days was level."},
        )
        self._upsert_duel(
            competition, t, c, "Demo finished duel",
            status=Duel.STATUS_COMPLETED,
            metric=Duel.METRIC_POINTS,
            duration_days=7,
            respond_by=now - timedelta(days=20),
            starts_at=now - timedelta(days=18),
            ends_at=now - timedelta(days=11),
            grace_until=now - timedelta(days=10),
            finalized_at=now - timedelta(days=10),
            challenger_score=90,
            opponent_score=140,
            result=Duel.RESULT_OPPONENT,
        )
        self._upsert_duel(
            competition, c, m, "Demo dead-heat duel",
            status=Duel.STATUS_COMPLETED,
            metric=Duel.METRIC_POINTS,
            duration_days=3,
            respond_by=now - timedelta(days=12),
            starts_at=now - timedelta(days=11),
            ends_at=now - timedelta(days=8),
            grace_until=now - timedelta(days=7),
            finalized_at=now - timedelta(days=7),
            challenger_score=60,
            opponent_score=60,
            result=Duel.RESULT_TIE,
        )
        self._upsert_duel(
            competition, c, u, "Demo loss duel",
            status=Duel.STATUS_COMPLETED,
            metric=Duel.METRIC_POINTS,
            duration_days=3,
            respond_by=now - timedelta(days=30),
            starts_at=now - timedelta(days=28),
            ends_at=now - timedelta(days=25),
            grace_until=now - timedelta(days=24),
            finalized_at=now - timedelta(days=24),
            challenger_score=40,
            opponent_score=75,
            result=Duel.RESULT_OPPONENT,
        )
        Duel.objects.filter(competition=competition, status=Duel.STATUS_ACTIVE).exclude(pk=live.pk).delete()
        self.stdout.write(f"Live duel {live.pk} is the ride window")

    def _upsert_duel(self, competition, challenger, opponent, forfeit, **fields):
        duel = Duel.objects.filter(competition=competition, forfeit=forfeit).first()
        defaults = dict(
            challenger=challenger,
            opponent=opponent,
            proposed_by=challenger,
            awaiting=opponent,
            pinged_accepted=True,
            **fields,
        )
        if duel is None:
            duel = Duel.objects.create(competition=competition, forfeit=forfeit, **defaults)
        else:
            for key, value in defaults.items():
                setattr(duel, key, value)
            duel.save()
        return duel

    def _stamps(self, users):
        from drill_instructor.game import award_tag
        charlotte = users["user1@admin.local"]
        for slug in ("first_blood", "photogenic", "first_duel", "ghost_killer"):
            award_tag(charlotte, slug)
        award_tag(users["user2@admin.local"], "first_duel")
        self.stdout.write("Stamps: earned, in-progress relics, and locked outlines")

    def _expedition(self, competition):
        from competition.expedition import recompute_expedition_progress
        from competition.models import ExpeditionCampaign
        from custom_user.models import RecalcRequest
        # Workout saves queue cap recalcs. Expedition recompute refuses to
        # roll up points while those rows are open, which left the route at 0%.
        RecalcRequest.objects.filter(done=False, goal__competition=competition).update(done=True)
        campaign = ExpeditionCampaign.objects.filter(competition=competition).first()
        if campaign is None:
            campaign = ExpeditionCampaign(competition=competition, enabled=True, objective="rescue", route_theme="summit")
            campaign.save()
        else:
            ExpeditionCampaign.objects.filter(pk=campaign.pk).update(enabled=True, objective="rescue")
            campaign.refresh_from_db()
        progress = recompute_expedition_progress(campaign)
        percent = progress.get("progress_percent")
        self.stdout.write(f"Expedition progress {percent}")
        try:
            return int(percent)
        except (TypeError, ValueError):
            return 0


# Unsplash Licence (https://unsplash.com/license). Attribution is not
# required; the photo ids are recorded so the source stays findable.
# fixtures/demo-photo.jpg  photo-1441974231531-c6227db76b6e  forest path
# fixtures/demo-remix.jpg  photo-1464822759023-fed622ff2c3b  alpine ridge
_FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _scene(kind="trail"):
    name = "demo-photo.jpg" if kind == "trail" else "demo-remix.jpg"
    return (_FIXTURES / name).read_bytes()
