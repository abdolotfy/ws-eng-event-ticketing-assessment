# Engineering Decisions

## Problem Understanding

Building two features on an event ticketing platform:

1. **Ticket Transfer** — attendee transfers confirmed ticket to another registered user by email
2. **Event Waitlist** — attendees join a waitlist for sold-out events and auto-promote on cancellation
   **Key challenges identified from codebase audit:**

- transfer.ts already exists for organizer reassignment (cancel+create pattern). The NOTE in that file explicitly flags that for attendee transfers, a **direct userId update** may be simpler and preserves booking continuity. I will use direct userId update for attendee transfers — no new ticket code, no capacity churn.
- decrementCapacity in capacity.ts has a **bug**: it only decrements event.soldCount when seatTierId is present. Non-tiered event cancellations never decrement event.soldCount. This affects waitlist promotion correctness — I will fix this bug.
- waitlist.ts is a stub. The Booking model already supports WAITLISTED status and seed data has Carol + organizer2 waitlisted on Chef's Table Dinner. Waitlist position must be inferred from createdAt ordering (no explicit position field).
- No waitlistPosition field on Booking — position is computed dynamically from createdAt ordering of WAITLISTED bookings for the same event.

## Approach

### Story 1: Ticket Transfer

**Decision: Direct userId update (not cancel+create)**

- Alternatives: (A) Use existing transferBooking() from transfer.ts — cancel+create, generates new booking ID and ticket code, churns capacity counters unnecessarily. (B) Direct userId update on the booking record — simpler, preserves booking ID and ticket code, no capacity side effects.
- Chosen: Option B. The transfer.ts NOTE itself recommends this for attendee-initiated transfers. The recipient gets the same ticket with the same QR code, which is correct behavior.
- Implementation: POST /api/bookings/:id/transfer — authenticate, verify ownership, look up recipient by email, update booking.userId to recipient.

### Story 2: Event Waitlist

**Decision: Use existing WAITLISTED booking status, infer position from createdAt**

- Alternatives: (A) Add a waitlistPosition integer field to Booking — explicit but requires reordering on every leave. (B) Compute position dynamically from createdAt ordering — no schema change needed, always consistent.
- Chosen: Option B. No migration needed, position is always accurate, and the seed data already uses this pattern.
- Auto-promotion: Hook into the cancel flow in bookings.ts DELETE handler. After cancellation, check for WAITLISTED bookings for the same event (and same tier if tiered), promote the earliest one by updating status to CONFIRMED and setting pricePaid.
- Waitlist endpoints in waitlist.ts: POST /api/waitlist/:eventId (join), DELETE /api/waitlist/:eventId (leave), GET /api/waitlist/:eventId/position (view position).

### Bug Fix: decrementCapacity

The existing decrementCapacity only decrements event.soldCount when seatTierId is present. Non-tiered cancellations skip the event-level decrement, causing soldCount to drift. Fixed by always decrementing event.soldCount regardless of tier.
Note: fixing this bug is a regression fix, not scope creep — without it, waitlist auto-promotion on non-tiered events (including Chef's Table, the Test 9 vehicle) will never trigger correctly

## Risks & Assumptions

- Waitlist position is 1-based (position 1 = next to be promoted)
- Transfer to self is blocked (error message)
- Transfer to user who already has a confirmed booking for same event is blocked
- Waitlist join is blocked if user already has a confirmed booking or is already waitlisted
- Chef's Table Dinner (capacity 2) is the test vehicle for waitlist auto-promotion
- Race condition on waitlist promotion: wrap promotion inside the same $transaction as the cancellation to prevent two concurrent cancellations promoting the same waitlisted user

## Implementation Sequence

1. Fix decrementCapacity bug
2. Add POST /api/bookings/:id/transfer endpoint + register in index.ts if needed
3. Implement waitlist endpoints in waitlist.ts
4. Hook auto-promotion into cancel flow in bookings.ts
5. Frontend: Transfer UI on ticket detail page
6. Frontend: Waitlist UI on event detail page + bookings list
7. Write tests
8. Screenshots what do you think about this ?
