ALTER TABLE "users" ADD COLUMN "notification_preferences" jsonb DEFAULT '{"inApp":true,"email":true}'::jsonb;
