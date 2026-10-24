"""Expire unanswered duels, freeze results after the grace window, send pings."""

from django.core.management.base import BaseCommand

from competition.duels import settle_due_duels


class Command(BaseCommand):
    help = "Settle duel invites, grace-period results, and private pings."

    def handle(self, *args, **options):
        result = settle_due_duels()
        self.stdout.write(f"Settled {result.get('settled', 0)} duels.")
