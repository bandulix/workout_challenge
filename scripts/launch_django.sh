#!/bin/bash

# Working dir is "src-backend"

export DJANGO_SETTINGS_MODULE="workout_challenge.settings"

echo "Run make migrations"
python manage.py makemigrations

echo "Run migrate"
python manage.py migrate

if [ $DEBUG == "true" ] || [ $DEBUG == "True" ]; then
	echo "Run Django Server";
	python ./manage.py runserver 0.0.0.0:8000;
else
	echo "Run Gunicorn Server";
	python manage.py collectstatic --noinput;
	gunicorn -c ./gunicorn.conf.py;
fi