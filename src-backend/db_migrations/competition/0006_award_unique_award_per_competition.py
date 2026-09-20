# Bonus awards are get_or_create'd by (competition, name) on the photo /
# order hot path; the unique constraint makes that race-safe. Merge any
# pre-existing duplicates first (possible when two first posts raced).

from django.db import migrations, models


def dedupe_awards(apps, schema_editor):
    Award = apps.get_model("competition", "Award")
    Points = apps.get_model("competition", "Points")
    keep = {}
    for award in Award.objects.order_by("pk"):
        key = (award.competition_id, award.name)
        if key in keep:
            Points.objects.filter(award=award).update(award=keep[key])
            award.delete()
        else:
            keep[key] = award


class Migration(migrations.Migration):

    dependencies = [
        ('competition', '0005_alter_activitygoal_goal_and_more'),
    ]

    operations = [
        migrations.RunPython(dedupe_awards, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='award',
            constraint=models.UniqueConstraint(fields=('competition', 'name'), name='unique_award_per_competition'),
        ),
    ]
