"use client";

import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@/components/ui";
import { useSession } from "@/components/useSession";
import type { SessionUser } from "@/lib/types";

export function SessionGate({ children }: { children: (user: SessionUser) => React.ReactNode }) {
  const { user, error, incoming, continueAsIncoming } = useSession();

  if (incoming) {
    return <AccountSwitched incoming={incoming} onContinue={continueAsIncoming} />;
  }

  if (user === undefined) {
    return <main className="p-6 text-sm text-ink-3">Checking sign-in…</main>;
  }

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-md p-6">
        <ErrorText message={error ?? "That session is not valid. Sign in again."} />
      </main>
    );
  }

  return <>{children(user)}</>;
}

function AccountSwitched({
  incoming,
  onContinue,
}: {
  incoming: SessionUser;
  onContinue: () => void;
}) {
  const router = useRouter();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-xl font-semibold">The account changed in this browser</h1>
      <p className="text-sm text-ink-2">
        Another account signed in in a different tab. Tabs share one sign-in, so this tab was
        cleared. Memories from two accounts are never shown together.
      </p>
      <p className="text-sm">
        This browser is now signed in as <strong>{incoming.email}</strong>.
      </p>
      <div className="flex flex-col gap-2">
        <Button type="button" onClick={onContinue}>
          Show only {incoming.email}
        </Button>
        <Button
          variant="ghost"
          type="button"
          onClick={() => {
            router.replace("/");
          }}
        >
          Go to sign-in
        </Button>
      </div>
    </main>
  );
}
