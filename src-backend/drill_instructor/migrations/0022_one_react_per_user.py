# One stamp per person per activity. Keep the newest row when someone
# already left several, then tighten the unique constraint.

from django.db import migrations, models


def collapse_extra_stamps(apps, schema_editor):
    React = apps.get_model("drill_instructor", "DrillInstructorActivityReact")
    seen = set()
    extras = []
    for row in React.objects.order_by("-created_at", "-id").iterator():
        key = (row.message_id, row.user_id)
        if key in seen:
            extras.append(row.pk)
        else:
            seen.add(key)
    if extras:
        React.objects.filter(pk__in=extras).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("drill_instructor", "0021_activity_reacts"),
    ]

    operations = [
        migrations.RunPython(collapse_extra_stamps, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name="drillinstructoractivityreact",
            name="one_react_per_emoji",
        ),
        migrations.AddConstraint(
            model_name="drillinstructoractivityreact",
            constraint=models.UniqueConstraint(fields=("message", "user"), name="one_react_per_user"),
        ),
    ]
