import type { Metadata } from "next";
import { MOTION_KEY } from "@/lib/motion";
import { THEME_KEY } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Boringcontext",
  description: "Your own memory for Claude, ChatGPT and Grok. One place to see and control it.",
};

/**
 * Applied before first paint so a dark-mode reader never sees a white flash,
 * and a reader who picked full or reduced motion gets it from the first frame.
 * Kept tiny and failure-tolerant: in private mode localStorage throws, and the
 * page then simply follows the system settings.
 */
const themeScript = `try{var d=document.documentElement,t=localStorage.getItem(${JSON.stringify(THEME_KEY)}),m=localStorage.getItem(${JSON.stringify(MOTION_KEY)});if(t==="light"||t==="dark")d.setAttribute("data-theme",t);if(m==="full"||m==="reduced")d.setAttribute("data-motion",m)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex h-full min-h-full flex-col overflow-hidden">{children}</body>
    </html>
  );
}
