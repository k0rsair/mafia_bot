-- A city choice is a draft until its voter explicitly confirms it.
ALTER TABLE "Vote" ADD COLUMN "confirmedAt" TIMESTAMP(3);
