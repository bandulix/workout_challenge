#!/bin/bash
cd '../src-backend'
python manage.py makemigrations
python manage.py migrate
python manage.py add_dummy_data