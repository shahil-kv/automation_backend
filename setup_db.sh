#!/bin/bash

# Default values
DB_NAME="silent_observer"
DB_USER="user"
DB_PASS="password"

echo "Setup PostgreSQL Database..."

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo "Error: psql is not installed. Please install PostgreSQL."
    exit 1
fi

# Create User
echo "Creating user '$DB_USER'..."
psql postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" || echo "User might already exist."

# Create Database
echo "Creating database '$DB_NAME'..."
psql postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" || echo "Database might already exist."

# Grant Privileges
echo "Granting privileges..."
psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
psql -d $DB_NAME -c "GRANT ALL ON SCHEMA public TO $DB_USER;"

echo "Done! Update your .env file with: DATABASE_URL=\"postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME?schema=public\""
