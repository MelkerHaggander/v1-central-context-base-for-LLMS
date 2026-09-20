"use client";

import { GlobeView } from "@/components/GlobeView";
import { SessionGate } from "@/components/SessionGate";
import { TopBar } from "@/components/TopBar";

export default function DashboardPage() {
  return (
    <SessionGate>
      {(user) => (
        <>
          <TopBar email={user.email} />
          {/* key on the account: a different user gets a fresh globe, never a
              frame of the previous account's dots. */}
          <GlobeView key={user.id} user={user} />
        </>
      )}
    </SessionGate>
  );
}
