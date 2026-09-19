import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Progress } from "~/components/ui/progress";

describe("Progress", () => {
  it("exposes its current value to assistive technology", () => {
    const html = renderToStaticMarkup(createElement(Progress, { value: 42 }));

    expect(html).toContain('aria-valuenow="42"');
  });
});
