from django.core.management.base import BaseCommand
from celery import current_app

class Command(BaseCommand):
    help = "Run a Celery task synchronously (default) or asynchronously (--async)."

    def add_arguments(self, parser):
        parser.add_argument("task_name", help="Name of the Celery task")
        parser.add_argument("task_args", nargs="*", help="Task args and kwargs (key=value)")
        parser.add_argument(
            "--async", action="store_true", dest="async_mode",
            help="Run task asynchronously via Celery worker"
        )

    def handle(self, *args, **options):
        task_name = options["task_name"]
        task = current_app.tasks.get(task_name)

        if not task:
            self.stderr.write(self.style.ERROR(f"Task '{task_name}' not found"))
            return

        # Parse args/kwargs
        positional, keyword = [], {}
        for arg in options["task_args"]:
            if "=" in arg:
                k, v = arg.split("=", 1)
                keyword[k] = v
            else:
                positional.append(arg)

        if options["async_mode"]:
            result = task.delay(*positional, **keyword)
            self.stdout.write(self.style.SUCCESS(
                f"Task {task_name} dispatched asynchronously with id {result.id}"
            ))
        else:
            result = task.apply(args=positional, kwargs=keyword)
            self.stdout.write(self.style.SUCCESS(
                f"Task {task_name} finished synchronously with result: {result.get()}"
            ))