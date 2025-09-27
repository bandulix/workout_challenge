#!/bin/bash

# Working dir is "src-frontend"

if [ $DEBUG == "true" ] || [ $DEBUG == "True" ]; then
	echo "Run React Dev-Server";
	npm start;
else
	echo "Run React Prod-Server";
	npm run build;
	serve -s build -l 3000;
fi