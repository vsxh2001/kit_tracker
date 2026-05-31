import { useState } from "react";
import {
  LayoutDashboard,
  Package,
  Users,
  FileText,
  Cpu,
  Terminal,
  Send,
  UserCog,
  Rocket,
  Box,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { useAuth } from "../context/AuthContext";
import { markOnboardingDone } from "../lib/onboarding";
import type { UserRole } from "../types";

// ---------------------------------------------------------------------------
// Slide definitions
// ---------------------------------------------------------------------------

interface Slide {
  icon: React.ReactNode;
  title: string;
  body: string;
}

function buildSlides(role: UserRole | undefined | ""): Slide[] {
  const isAdmin = role === "admin";
  const isTechnician = role === "technician";
  const canWrite = isAdmin || isTechnician;

  const slides: Slide[] = [
    {
      icon: <Box className="h-10 w-10 text-indigo-400" />,
      title: "Welcome to Kit Tracker",
      body: "Kit Tracker helps your team manage physical kit logistics — tracking who holds each kit, moving kits between locations, and handling requests end-to-end.",
    },
    {
      icon: <LayoutDashboard className="h-10 w-10 text-indigo-400" />,
      title: "Dashboard",
      body: "Your command center: live stats on kits, open requests, and recent transfers. Click any stat card to drill into the relevant list.",
    },
    {
      icon: <Package className="h-10 w-10 text-indigo-400" />,
      title: "Kits",
      body: "Each kit's current holder is always derived from its latest transaction — full move history is one click away on the kit detail page.",
    },
    {
      icon: <Users className="h-10 w-10 text-indigo-400" />,
      title: "Entities",
      body: "Entities are the locations or teams a kit can be held by — storage rooms, field units, or any group that takes custody of equipment.",
    },
    {
      icon: <FileText className="h-10 w-10 text-indigo-400" />,
      title: "Requests",
      body: role === "viewer"
        ? "Users can request kits for a specific entity and delivery date. Admins approve or reject, and fulfillment creates a move automatically."
        : role === "user"
          ? "Need a kit? Submit a request with a target entity and delivery date. An admin will approve it, and fulfillment moves the kit to you."
          : "Manage the full request lifecycle: approve or reject incoming requests, then fulfill approved ones to create a kit move in one action.",
    },
    {
      icon: <Cpu className="h-10 w-10 text-indigo-400" />,
      title: "Components & Products",
      body: 'Products are the catalog of item types; components are the physical items inside kits. Products flagged as "tracked" surface a presence check right in kit status.',
    },
    {
      icon: <Terminal className="h-10 w-10 text-indigo-400" />,
      title: "Command bar",
      body: canWrite
        ? "Press the Commands button (bottom-right) or type /help. Read commands: /kits, /kit <serial>, /find <text>, /me. Write commands: /move, /request, /approve, /reject."
        : role === "user"
          ? "Press the Commands button (bottom-right) or type /help. Try /kits, /kit <serial>, /find <text>, /me — and /request <kit> <entity> to open a request."
          : "Press the Commands button (bottom-right) or type /help. Look up kits with /kits, /kit <serial>, and /find <text>.",
    },
    {
      icon: <Send className="h-10 w-10 text-indigo-400" />,
      title: "Telegram bot",
      body: canWrite
        ? "Link your account in Profile, then use the same slash commands directly from Telegram — including /move, /approve, and /reject — without opening the app."
        : "Link your account in Profile, then use the same lookup commands directly from Telegram — no need to open the app.",
    },
  ];

  if (isAdmin) {
    slides.push({
      icon: <UserCog className="h-10 w-10 text-indigo-400" />,
      title: "Users & Settings",
      body: "Manage user roles under Users, configure Telegram settings under Settings. New OAuth users land with no role — approve them here before they can act.",
    });
  }

  slides.push({
    icon: <Rocket className="h-10 w-10 text-indigo-400" />,
    title: "You're all set!",
    body: "Explore the sidebar to get started. You can replay this tour anytime via the Help button in the sidebar.",
  });

  return slides;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  open: boolean;
  onClose: () => void;
}

export function OnboardingModal({ open, onClose }: Props) {
  const { user } = useAuth();
  const [index, setIndex] = useState(0);

  const slides = buildSlides(user?.role);
  const total = slides.length;
  const slide = slides[index];
  const isLast = index === total - 1;

  function handleClose() {
    markOnboardingDone();
    setIndex(0);
    onClose();
  }

  function handleNext() {
    if (isLast) {
      handleClose();
    } else {
      setIndex((i) => i + 1);
    }
  }

  function handleBack() {
    setIndex((i) => Math.max(0, i - 1));
  }

  // Reset to first slide when modal opens
  function handleOpenChange(v: boolean) {
    if (!v) {
      handleClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[520px] p-0 gap-0 overflow-hidden">
        {/* Hidden accessible title/description for screen readers */}
        <DialogTitle className="sr-only">Kit Tracker onboarding tour</DialogTitle>
        <DialogDescription className="sr-only">
          A {total}-step introduction to Kit Tracker features.
        </DialogDescription>

        {/* Slide body */}
        <div className="flex flex-col items-center text-center px-8 pt-10 pb-6 gap-5 min-h-[280px] justify-center">
          <div className="flex items-center justify-center h-16 w-16 rounded-2xl bg-indigo-950/60 ring-1 ring-indigo-800/40 shrink-0">
            {slide.icon}
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-foreground">{slide.title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
              {slide.body}
            </p>
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 pb-2">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={
                i === index
                  ? "h-2 w-5 rounded-full bg-indigo-500 transition-all duration-200"
                  : "h-2 w-2 rounded-full bg-slate-300 hover:bg-slate-400 transition-all duration-200"
              }
            />
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between px-8 py-5 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="text-muted-foreground"
          >
            Skip
          </Button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button variant="outline" size="sm" onClick={handleBack}>
                Back
              </Button>
            )}
            <Button size="sm" onClick={handleNext}>
              {isLast ? "Get started" : "Next"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
