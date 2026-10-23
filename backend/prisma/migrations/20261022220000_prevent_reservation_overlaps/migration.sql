CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Reservation"
ADD CONSTRAINT "Reservation_valid_time_range"
CHECK ("endAt" > "startAt");

ALTER TABLE "Reservation"
ADD CONSTRAINT "Reservation_no_overlapping_active_room_reservations"
EXCLUDE USING GIST (
    "roomId" WITH =,
    tsrange("startAt", "endAt", '[)') WITH &&
)
WHERE ("status" IN ('PENDING', 'CONFIRMED'));
