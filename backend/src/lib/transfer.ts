import { generateTicketCode, generateQRData } from "./qr.js";

/**
 * Transfer Utility — ORGANIZER dashboard reassignment tool.
 *
 * This helper was built for organizer-initiated seat reassignment (see dashboard.ts).
 * It uses a cancel-and-recreate strategy: cancels the original booking, then creates
 * a fresh one for the recipient. This means:
 *   - New booking ID (breaks any external references to the original)
 *   - New ticket code and QR data
 *   - Triggers capacity decrement + increment (side effects if other features listen to capacity changes)
 *
 * For attendee-initiated transfers, consider whether a simpler ownership update
 * (booking.update({ userId })) better preserves booking continuity.
 */
export async function transferBooking(
  tx: any,
  bookingId: string,
  recipientId: string
) {
  // 1. Fetch the original booking with related data
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: {
      event: true,
      seatTier: true,
    },
  });

  if (!booking) {
    throw new Error("NOT_FOUND:Booking not found");
  }

  if (booking.status !== "CONFIRMED") {
    throw new Error("INVALID_STATUS:Only confirmed bookings can be transferred");
  }

  // 2. Cancel the original booking
  // No refund for transfers — this is an ownership change, not a financial reversal
  await tx.booking.update({
    where: { id: booking.id },
    data: {
      status: "CANCELLED",
      refundAmount: 0,
      cancelledAt: new Date(),
    },
  });

  // 3. Adjust capacity counters (decrement for cancel, re-increment for new booking)
  // This two-step approach ensures the capacity logic stays consistent with
  // the rest of the booking system — cancel always decrements, create always increments.
  await tx.event.update({
    where: { id: booking.eventId },
    data: { soldCount: { decrement: 1 } },
  });

  if (booking.seatTierId) {
    await tx.seatTier.update({
      where: { id: booking.seatTierId },
      data: { soldCount: { decrement: 1 } },
    });
  }

  // 4. Create new booking for recipient with fresh ticket credentials
  const ticketCode = generateTicketCode();
  const qrCodeData = generateQRData(ticketCode);

  // Re-increment capacity
  await tx.event.update({
    where: { id: booking.eventId },
    data: { soldCount: { increment: 1 } },
  });

  if (booking.seatTierId) {
    await tx.seatTier.update({
      where: { id: booking.seatTierId },
      data: { soldCount: { increment: 1 } },
    });
  }

  const newBooking = await tx.booking.create({
    data: {
      ticketCode,
      qrCodeData,
      userId: recipientId,
      eventId: booking.eventId,
      seatTierId: booking.seatTierId,
      promoCodeId: booking.promoCodeId,
      pricePaid: booking.pricePaid,
      discountAmount: booking.discountAmount,
      status: "CONFIRMED",
    },
    include: {
      event: {
        select: {
          id: true,
          name: true,
          date: true,
          time: true,
          venue: true,
        },
      },
      seatTier: {
        select: {
          id: true,
          name: true,
          price: true,
        },
      },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return newBooking;
}
