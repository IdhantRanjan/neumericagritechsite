import type { MetadataRoute } from "next";

/**
 * PWA manifest — installable on a phone home screen, which is how a farmer
 * in a truck cab actually reaches this. Offline behavior is deliberately
 * minimal for now (financial data must be fresh); install + fast-start is
 * the win.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Neumeric — Farm platform",
    short_name: "Neumeric",
    description:
      "Deadlines, claim evidence, program money, and grain-marketing clarity — for the farmer's side of the table.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff8f1",
    theme_color: "#fff8f1",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
