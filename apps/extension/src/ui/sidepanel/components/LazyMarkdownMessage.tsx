import { lazy, Suspense } from "react";
import type { MarkdownMessageProps } from "../MarkdownMessage";

const MarkdownMessage = lazy(() =>
  import("../MarkdownMessage").then((module) => ({ default: module.MarkdownMessage }))
);

export function LazyMarkdownMessage(props: MarkdownMessageProps): JSX.Element {
  return (
    <Suspense fallback={<div className="surf-md" aria-busy="true" />}>
      <MarkdownMessage {...props} />
    </Suspense>
  );
}
