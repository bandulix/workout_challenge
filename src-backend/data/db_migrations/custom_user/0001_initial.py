import decimal

import django.contrib.auth.models
import django.core.validators
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    # initial=True is intentionally OMITTED. The first migration of an
    # app must not declare dependencies, but this one does (auth +
    # competition) to handle the M2M relations into competition. The
    # auto-generated original source set initial=True anyway, which
    # made Django drop 0002_initial (and any later migration) from
    # the graph when running fresh. With initial=True removed, the
    # dependency chain works correctly.

    dependencies = [
        ('auth', '0012_alter_user_first_name_max_length'),
        ('competition', '0001_initial'),
    ]


    operations = [
        migrations.CreateModel(
            name='CustomUser',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('password', models.CharField(max_length=128, verbose_name='password')),
                ('last_login', models.DateTimeField(blank=True, null=True, verbose_name='last login')),
                ('is_superuser', models.BooleanField(default=False,
                    help_text='Designates that this user has all permissions without explicitly assigning them.',
                    verbose_name='superuser status')),
                ('email', models.EmailField(max_length=254, unique=True, verbose_name='email address')),
                ('first_name', models.CharField(max_length=30)),
                ('last_name', models.CharField(blank=True, max_length=40, null=True)),
                ('gender', models.CharField(blank=True, choices=[('M', 'Male'), ('F', 'Female'), ('O', 'Other')], max_length=1, null=True)),
                ('username', models.CharField(blank=True, max_length=40, null=True)),
                ('goal_active_days', models.IntegerField(blank=True, default=3, null=True)),
                ('goal_workout_minutes', models.IntegerField(blank=True, default=150, null=True)),
                ('goal_distance', models.IntegerField(blank=True, default=None, null=True)),
                ('scaling_kcal', models.DecimalField(decimal_places=4, default=1, max_digits=8,
                    validators=[django.core.validators.MinValueValidator(decimal.Decimal('0.6666')),
                                django.core.validators.MaxValueValidator(decimal.Decimal('1.3333'))])),
                ('scaling_distance', models.DecimalField(decimal_places=4, default=1, max_digits=8,
                    validators=[django.core.validators.MinValueValidator(decimal.Decimal('0.6666')),
                                django.core.validators.MaxValueValidator(decimal.Decimal('1.3333'))])),
                ('is_verified', models.BooleanField(default=False)),
                ('email_mid_week', models.BooleanField(default=False)),
                ('strava_athlete_id', models.IntegerField(blank=True, null=True)),
                ('strava_allow_follow', models.BooleanField(default=True)),
                ('strava_refresh_token', models.CharField(blank=True, max_length=40, null=True)),
                ('strava_last_synced_at', models.DateTimeField(blank=True, null=True)),
                ('matrix_user_id', models.CharField(blank=True, max_length=120, null=True)),
                ('is_staff', models.BooleanField(default=False)),
                ('is_active', models.BooleanField(default=True)),
                ('date_joined', models.DateTimeField(default=django.utils.timezone.now)),
                ('groups', models.ManyToManyField(blank=True,
                    help_text='The groups this user belongs to.',
                    related_name='user_set', related_query_name='user', to='auth.group', verbose_name='groups')),
                ('user_permissions', models.ManyToManyField(blank=True,
                    help_text='Specific permissions for this user.',
                    related_name='user_set', related_query_name='user', to='auth.permission', verbose_name='user permissions')),
                ('my_competitions', models.ManyToManyField(blank=True, related_name='user', to='competition.Competition')),
                ('my_teams', models.ManyToManyField(blank=True, related_name='user', to='competition.Team')),
            ],
            options={
                'verbose_name': 'User',
                'verbose_name_plural': 'Users',
            },
            managers=[
                ('objects', django.contrib.auth.models.UserManager()),
            ],
        ),
        # NOTE: RecalcRequest is intentionally not created here. It has a FK to
        # competition.ActivityGoal, which creates a circular dependency
        # (competition depends on custom_user via swappable_dependency).
        # RecalcRequest is non-critical - run ``python manage.py makemigrations
        # custom_user`` after first boot to generate a follow-up migration
        # for it, or ignore if you don't use the point-recalc queue.
    ]

