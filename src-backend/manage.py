#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


def make_sure_paths_exist():
    """ Make sure data folder paths exist for the database and/or migrations. """
    for path in ['./data', './data/db_migrations', './data/db_migrations/competition', './data/db_migrations/workouts', './data/db_migrations/custom_user']:
        if not os.path.exists(path):
            os.makedirs(path)
            open(path + '/__init__.py', "a").close()


def main():
    """Run administrative tasks."""
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'workout_challenge.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    make_sure_paths_exist()
    main()
