import type { Metadata } from "next";
import { DemoTour } from "@/components/demo-tour";

export const metadata: Metadata = {
  title: "Neumeric — guided tour",
  description: "A two-minute walk through the Neumeric farm dashboard on a sample Illinois farm.",
};

export default function DemoPage() {
  return <DemoTour />;
}
