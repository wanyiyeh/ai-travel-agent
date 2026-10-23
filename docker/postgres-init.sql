-- Runs once, when the pgdata volume is first created (docker-compose.yml).
-- travel itself is created by POSTGRES_DB.
CREATE DATABASE travel_mock;
CREATE DATABASE travel_test;
