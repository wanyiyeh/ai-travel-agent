"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

// Cloudflare Turnstile widget for the trip form (plan/access-control.md §3).
// Explicit rendering so React owns the lifecycle: the widget is rendered on
// mount and removed on unmount. Tokens are single-use — the form unmounts
// while a generation runs and remounts afterwards, which yields a fresh one.
// Renders nothing when no site key is configured (local dev without
// Cloudflare; the server skips the check then too, outside production).

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export default function TurnstileWidget({ onToken }: { onToken: (token: string | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Latest callback without re-rendering the widget when the parent re-renders.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  const renderWidget = () => {
    if (!SITE_KEY || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: SITE_KEY,
      callback: (token: string) => onTokenRef.current(token),
      "expired-callback": () => onTokenRef.current(null),
      "error-callback": () => onTokenRef.current(null),
    });
  };

  useEffect(() => {
    // The script may already be loaded from an earlier mount.
    renderWidget();
    return () => {
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, []);

  if (!SITE_KEY) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={renderWidget}
      />
      <div ref={containerRef} className="flex justify-center" />
    </>
  );
}
