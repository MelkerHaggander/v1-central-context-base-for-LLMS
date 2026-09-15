"use client";

import { MemoryList } from "@/components/MemoryList";
import { SessionGate } from "@/components/SessionGate";
import { TopBar } from "@/components/TopBar";

export default function DashboardPage() {
  return (
    <SessionGate>
      {(user) => (
        <>
          <TopBar email={user.email} />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
            <h1 className="mb-4 text-xl font-semibold">Dina minnen</h1>
            <MemoryList key={user.id} userId={user.id} />
          </main>
        </>
      )}
    </SessionGate>
  );
}
