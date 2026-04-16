import type { Metadata } from "next";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

import "./globals.css";

export const metadata: Metadata = {
  title: "Deep Agent Platform",
  description: "TypeScript deep agent with terminal and CopilotKit-ready frontend.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <CopilotKit runtimeUrl="/api/copilotkit" agent="deep-agent">
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
