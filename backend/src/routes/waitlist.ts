import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { generateTicketCode, generateQRData } from "../lib/qr.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// POST /api/waitlist/:eventId - Join waitlist
router.post("/:eventId", authenticate, async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({
        where: { id: req.params.eventId as string },
        include: { seatTiers: true },
      });

      if (!event) {
        throw new Error("NOT_FOUND:Event not found");
      }

      if (event.status !== "PUBLISHED") {
        throw new Error("INVALID_EVENT:Event is not available for waitlisting");
      }

      const existingConfirmedBooking = await tx.booking.findFirst({
        where: {
          userId: req.user!.userId,
          eventId: event.id,
          status: "CONFIRMED",
        },
      });

      if (existingConfirmedBooking) {
        throw new Error("HAS_TICKET:You already have a confirmed ticket for this event");
      }

      const existingWaitlistBooking = await tx.booking.findFirst({
        where: {
          userId: req.user!.userId,
          eventId: event.id,
          status: "WAITLISTED",
        },
      });

      if (existingWaitlistBooking) {
        throw new Error("ALREADY_WAITLISTED:You are already on the waitlist for this event");
      }

      let seatTierId: string | null = null;

      if (event.seatTiers.length > 0) {
        const requestedSeatTierId =
          typeof req.body?.seatTierId === "string" ? req.body.seatTierId.trim() : "";

        if (!requestedSeatTierId) {
          throw new Error("VALIDATION:seatTierId is required for tiered events");
        }

        const selectedTier = event.seatTiers.find((tier) => tier.id === requestedSeatTierId);

        if (!selectedTier) {
          throw new Error("NOT_FOUND:Selected tier not found");
        }

        const allTiersSoldOut = event.seatTiers.every((tier) => tier.soldCount >= tier.capacity);

        if (!allTiersSoldOut) {
          throw new Error("NOT_SOLD_OUT:Event is not sold out");
        }

        seatTierId = selectedTier.id;
      } else if (event.soldCount < event.capacity) {
        throw new Error("NOT_SOLD_OUT:Event is not sold out");
      }

      const ticketCode = generateTicketCode();
      const qrCodeData = generateQRData(ticketCode);

      const waitlistBooking = await tx.booking.create({
        data: {
          ticketCode,
          qrCodeData,
          userId: req.user!.userId,
          eventId: event.id,
          seatTierId,
          pricePaid: 0,
          status: "WAITLISTED",
        },
      });

      const position = await tx.booking.count({
        where: {
          eventId: event.id,
          status: "WAITLISTED",
          createdAt: {
            lte: waitlistBooking.createdAt,
          },
        },
      });

      return {
        booking: waitlistBooking,
        position,
      };
    });

    res.status(201).json({
      success: true,
      message: "Joined waitlist successfully",
      data: result,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Error joining waitlist:", err);

    if (err.message?.startsWith("NOT_FOUND:")) {
      return res.status(404).json({
        success: false,
        error: "NOT_FOUND",
        message: err.message.split(":")[1],
      });
    }

    if (err.message?.startsWith("INVALID_EVENT:")) {
      return res.status(400).json({
        success: false,
        error: "INVALID_EVENT",
        message: err.message.split(":")[1],
      });
    }

    if (err.message?.startsWith("HAS_TICKET:")) {
      return res.status(400).json({
        success: false,
        error: "ALREADY_HAS_TICKET",
        message: err.message.split(":")[1],
      });
    }

    if (err.message?.startsWith("ALREADY_WAITLISTED:")) {
      return res.status(400).json({
        success: false,
        error: "ALREADY_WAITLISTED",
        message: err.message.split(":")[1],
      });
    }

    if (err.message?.startsWith("VALIDATION:")) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: err.message.split(":")[1],
      });
    }

    if (err.message?.startsWith("NOT_SOLD_OUT:")) {
      return res.status(400).json({
        success: false,
        error: "NOT_SOLD_OUT",
        message: err.message.split(":")[1],
      });
    }

    res.status(500).json({
      success: false,
      error: "INTERNAL_ERROR",
      message: "Failed to join waitlist",
    });
  }
});

// DELETE /api/waitlist/:eventId - Leave waitlist
router.delete("/:eventId", authenticate, async (req, res) => {
  try {
    const booking = await prisma.booking.findFirst({
      where: {
        userId: req.user!.userId,
        eventId: req.params.eventId as string,
        status: "WAITLISTED",
      },
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: "NOT_FOUND",
        message: "Waitlist booking not found",
      });
    }

    await prisma.booking.delete({
      where: { id: booking.id },
    });

    res.json({
      success: true,
      message: "Left waitlist successfully",
    });
  } catch (error) {
    console.error("Error leaving waitlist:", error);
    res.status(500).json({
      success: false,
      error: "INTERNAL_ERROR",
      message: "Failed to leave waitlist",
    });
  }
});

// GET /api/waitlist/:eventId/position - Get waitlist position
router.get("/:eventId/position", authenticate, async (req, res) => {
  try {
    const booking = await prisma.booking.findFirst({
      where: {
        userId: req.user!.userId,
        eventId: req.params.eventId as string,
        status: "WAITLISTED",
      },
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: "NOT_FOUND",
        message: "Waitlist booking not found",
      });
    }

    const position = await prisma.booking.count({
      where: {
        eventId: booking.eventId,
        status: "WAITLISTED",
        createdAt: {
          lte: booking.createdAt,
        },
      },
    });

    res.json({
      success: true,
      data: {
        position,
        bookingId: booking.id,
      },
    });
  } catch (error) {
    console.error("Error getting waitlist position:", error);
    res.status(500).json({
      success: false,
      error: "INTERNAL_ERROR",
      message: "Failed to get waitlist position",
    });
  }
});

export default router;
