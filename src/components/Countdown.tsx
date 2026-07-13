"use client";

import { useEffect, useState } from "react";
import {
  formatCountdown,
  formatMoneyAUD,
  msUntilNextHour,
} from "@/lib/engine";
import { useApp } from "@/lib/store";

export function Countdown() {
  const { state } = useApp();
  const [ms, setMs] = useState(0);

  useEffect(() => {
    const tick = () => setMs(msUntilNextHour(new Date(), state.settings.timezone));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [state.settings.timezone]);

  return (
    <div className="countdown text-4xl font-semibold tracking-widest text-[var(--accent)] md:text-5xl">
      {formatCountdown(ms)}
    </div>
  );
}

export function Money({ amount, className = "" }: { amount: number; className?: string }) {
  return <span className={className}>{formatMoneyAUD(amount)}</span>;
}
