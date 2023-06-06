#!/bin/bash

set -o errexit  # Exit the script with error if any of the commands fail

source "${PROJECT_DIRECTORY}/.evergreen/init-node-and-npm-env.sh"

echo "$MONGODB_URI"
npm run check:adl
