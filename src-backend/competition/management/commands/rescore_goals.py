from django.core.management.base import BaseCommand, CommandError

from competition.models import ActivityGoal
from competition.scorer import rescore_activity_goal


class Command(BaseCommand):
    help = (
        "Recompute raw points from each workout and reapply caps. "
        "Use after a goal edit that flattened every activity to the same score."
    )

    def add_arguments(self, parser):
        parser.add_argument("--competition", type=int, help="Limit to one competition id")
        parser.add_argument("--goal", type=int, help="Limit to one activity-goal id")

    def handle(self, *args, **options):
        qs = ActivityGoal.objects.select_related("competition").order_by("pk")
        if options.get("competition"):
            qs = qs.filter(competition_id=options["competition"])
        if options.get("goal"):
            qs = qs.filter(pk=options["goal"])
        if not qs.exists():
            raise CommandError("No activity goals matched.")
        n_goals = 0
        n_rows = 0
        for goal in qs:
            rewritten = rescore_activity_goal(goal)
            self.stdout.write(f"{goal}: {rewritten} point row(s) rewritten")
            n_goals += 1
            n_rows += rewritten
        self.stdout.write(self.style.SUCCESS(
            f"Rescored {n_goals} goal(s); rewrote {n_rows} point row(s)."
        ))
