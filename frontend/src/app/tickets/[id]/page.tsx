"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Booking } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { bookingsAPI, transferTicket } from "@/lib/api";
import { formatDate, formatTime, formatCurrency } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { Alert } from "@/components/ui/Alert";

export default function TicketPage() {
  const params = useParams();
  const router = useRouter();
  const { user, token, isLoading: authLoading } = useAuth();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [transferError, setTransferError] = useState("");
  const [transferSuccess, setTransferSuccess] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) {
      router.push(`/login?callbackUrl=/tickets/${params.id}`);
      return;
    }

    Promise.all([
      bookingsAPI.get(token, params.id as string),
      bookingsAPI.getQR(token, params.id as string),
    ])
      .then(([bookingRes, qrRes]) => {
        setBooking(bookingRes.data);
        setQrCode(qrRes.data.qrCode);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [user, token, authLoading, router, params.id]);

  const handleTransfer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token || !booking) return;

    if (!recipientEmail.trim()) {
      setTransferError("Please enter a recipient email address");
      return;
    }

    setIsTransferring(true);
    setTransferError("");
    setTransferSuccess("");

    try {
      const response = await transferTicket(token, booking.id, recipientEmail.trim());
      setTransferSuccess(
        `Ticket transferred successfully to ${response.data.recipient.email}. Redirecting to your bookings...`
      );
      setTimeout(() => {
        router.push("/bookings");
      }, 2000);
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Failed to transfer ticket");
    } finally {
      setIsTransferring(false);
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !booking) {
    return <div className="container py-8 text-center text-red-600">{error || "Ticket not found"}</div>;
  }

  if (booking.status !== "CONFIRMED") {
    return (
      <div className="container py-8">
        <Alert variant="warning">This ticket is no longer valid. Status: {booking.status}</Alert>
      </div>
    );
  }

  return (
    <div className="container py-8">
      <div className="max-w-md mx-auto space-y-6">
        <Card>
          <CardContent className="text-center space-y-6 py-8">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{booking.event?.name}</h1>
              {booking.event?.artistInfo && <p className="text-gray-600">{booking.event.artistInfo}</p>}
            </div>

            {qrCode && (
              <div className="flex justify-center">
                <img src={qrCode} alt="Ticket QR Code" className="w-64 h-64" />
              </div>
            )}

            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-500">Date</span>
                <span className="font-medium">{booking.event && formatDate(booking.event.date)}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-500">Time</span>
                <span className="font-medium">{booking.event && formatTime(booking.event.time)}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-500">Venue</span>
                <span className="font-medium">{booking.event?.venue}</span>
              </div>
              {booking.seatTier && (
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-500">Tier</span>
                  <span className="font-medium">{booking.seatTier.name}</span>
                </div>
              )}
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-500">Price Paid</span>
                <span className="font-medium">{formatCurrency(booking.pricePaid)}</span>
              </div>
              {booking.discountAmount > 0 && (
                <div className="flex justify-between py-2 border-b text-green-600">
                  <span>Discount</span>
                  <span>-{formatCurrency(booking.discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between py-2">
                <span className="text-gray-500">Ticket Code</span>
                <span className="font-mono font-medium">{booking.ticketCode.slice(0, 8).toUpperCase()}</span>
              </div>
            </div>

            <div className="pt-4 space-y-3">
              <Button className="w-full" onClick={() => qrCode && window.open(qrCode, "_blank")}>
                Download QR Code
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => router.push("/bookings")}>
                Back to Bookings
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 py-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Transfer Ticket</h2>
              <p className="text-sm text-gray-600 mt-1">
                Send this ticket to another registered attendee by entering their email address.
              </p>
            </div>

            {transferError && <Alert variant="error">{transferError}</Alert>}
            {transferSuccess && <Alert variant="success">{transferSuccess}</Alert>}

            <form onSubmit={handleTransfer} className="space-y-3">
              <Input
                type="email"
                placeholder="Recipient email address"
                value={recipientEmail}
                onChange={(e) => {
                  setRecipientEmail(e.target.value);
                  setTransferError("");
                  setTransferSuccess("");
                }}
                disabled={isTransferring}
              />
              <Button type="submit" className="w-full" isLoading={isTransferring}>
                Transfer
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
