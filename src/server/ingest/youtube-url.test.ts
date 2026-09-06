import { describe, expect, it } from "vitest";

import {
  channelIdFromUrl,
  channelUrl,
  isChannelId,
  isVideoId,
  toVideoId,
  tryVideoId,
  watchUrl,
} from "~/server/ingest/youtube-url";

describe("toVideoId — one identity for URL or ID", () => {
  it("passes a bare 11-char video ID through", () => {
    expect(toVideoId("UF8uR6Z6KLc")).toBe("UF8uR6Z6KLc");
  });

  it("extracts the ID from a watch URL (incl. extra params)", () => {
    expect(toVideoId("https://www.youtube.com/watch?v=UF8uR6Z6KLc")).toBe(
      "UF8uR6Z6KLc",
    );
    expect(
      toVideoId("https://www.youtube.com/watch?v=UF8uR6Z6KLc&t=42s&list=abc"),
    ).toBe("UF8uR6Z6KLc");
  });

  it("extracts the ID from a youtu.be short URL", () => {
    expect(toVideoId("https://youtu.be/UF8uR6Z6KLc")).toBe("UF8uR6Z6KLc");
    expect(toVideoId("https://youtu.be/UF8uR6Z6KLc?t=42")).toBe("UF8uR6Z6KLc");
  });

  it("handles embed / shorts / live URL forms", () => {
    expect(toVideoId("https://www.youtube.com/embed/UF8uR6Z6KLc")).toBe(
      "UF8uR6Z6KLc",
    );
    expect(toVideoId("https://www.youtube.com/shorts/UF8uR6Z6KLc")).toBe(
      "UF8uR6Z6KLc",
    );
  });

  it("rejects a value that is not a YouTube video", () => {
    expect(() => toVideoId("not a video")).toThrow();
    expect(() => toVideoId("https://example.com/watch?v=UF8uR6Z6KLc")).toThrow();
    expect(() => toVideoId("https://www.youtube.com/watch?v=too-short")).toThrow();
  });

  it("tryVideoId answers instead of throwing", () => {
    expect(tryVideoId("https://youtu.be/UF8uR6Z6KLc")).toBe("UF8uR6Z6KLc");
    expect(tryVideoId("@mkbhd")).toBeUndefined();
    expect(tryVideoId("https://www.youtube.com/@mkbhd")).toBeUndefined();
  });
});

describe("isVideoId / watchUrl — video identity helpers", () => {
  it("accepts exactly an 11-char id and rejects anything else", () => {
    expect(isVideoId("UF8uR6Z6KLc")).toBe(true);
    expect(isVideoId("too-short")).toBe(false);
    expect(isVideoId("waytoolongvideoid")).toBe(false);
    expect(isVideoId(null)).toBe(false);
  });

  it("builds the canonical watch URL", () => {
    expect(watchUrl("UF8uR6Z6KLc")).toBe(
      "https://www.youtube.com/watch?v=UF8uR6Z6KLc",
    );
  });
});

describe("channel identity", () => {
  const CHANNEL_ID = "UC_x5XG1OV2P6uZZ5FSM9Ttw";

  it("isChannelId accepts exactly a 24-char UC id", () => {
    expect(isChannelId(CHANNEL_ID)).toBe(true);
    expect(isChannelId("UCLAHealthChannelOfficial")).toBe(false); // a handle, not an id
    expect(isChannelId(undefined)).toBe(false);
  });

  it("channelIdFromUrl reads the id out of a /channel/ URL and nothing else", () => {
    expect(channelIdFromUrl(`https://www.youtube.com/channel/${CHANNEL_ID}/videos`)).toBe(
      CHANNEL_ID,
    );
    expect(channelIdFromUrl("https://www.youtube.com/@mkbhd")).toBeUndefined();
  });

  it("channelUrl builds a /channel/ URL from a UC id", () => {
    expect(channelUrl(CHANNEL_ID)).toBe(
      `https://www.youtube.com/channel/${CHANNEL_ID}`,
    );
  });

  it("channelUrl builds an @handle URL from a handle, with or without the @", () => {
    expect(channelUrl("@mkbhd")).toBe("https://www.youtube.com/@mkbhd");
    expect(channelUrl("mkbhd")).toBe("https://www.youtube.com/@mkbhd");
  });

  it("channelUrl passes a full URL through untouched", () => {
    expect(channelUrl("https://www.youtube.com/c/veritasium")).toBe(
      "https://www.youtube.com/c/veritasium",
    );
  });

  it("channelUrl treats a UC-prefixed handle that isn't a real 24-char id as a handle", () => {
    // Regression: an unanchored channel-id test matched this prefix and built a dead /channel/ URL.
    expect(channelUrl("UCLAHealthChannelOfficial")).toBe(
      "https://www.youtube.com/@UCLAHealthChannelOfficial",
    );
  });
});
