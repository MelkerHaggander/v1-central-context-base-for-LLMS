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
    return <main className="p-6 text-sm text-muted">Kontrollerar inloggning…</main>;
  }

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-md p-6">
        <ErrorText message={error ?? "Ogiltig session. Logga in igen."} />
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
      <h1 className="text-xl font-semibold">Kontot byttes i webbläsaren</h1>
      <p className="text-sm text-muted">
        Ett annat konto loggade in i en annan flik. Flikar delar samma inloggning, så den här
        fliken har tömts. Minnen från olika konton blandas inte.
      </p>
      <p className="text-sm">
        Webbläsaren är nu inloggad som <strong>{incoming.email}</strong>.
      </p>
      <div className="flex flex-col gap-2">
        <Button type="button" onClick={onContinue}>
          Visa bara minnen för {incoming.email}
        </Button>
        <Button
          variant="ghost"
          type="button"
          onClick={() => {
            router.replace("/");
          }}
        >
          Gå till inloggning
        </Button>
      </div>
    </main>
  );
}
