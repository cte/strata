import { describe, expect, test } from "bun:test";
import {
  describeSlackSocketEnvelope,
  isSlackEventCallbackPayload,
  slackThreadTargetFromEvent,
} from "./slackSocketMode.js";

describe("slackSocketMode", () => {
  test("extracts thread targets from message events", () => {
    expect(
      slackThreadTargetFromEvent({
        type: "message",
        channel: "C123",
        ts: "1715102030.000000",
      }),
    ).toEqual({ channel: "C123", threadTs: "1715102030.000000" });
  });

  test("extracts thread targets from message_changed events", () => {
    expect(
      slackThreadTargetFromEvent({
        type: "message",
        subtype: "message_changed",
        channel: "C123",
        message: {
          ts: "1715102040.000000",
          thread_ts: "1715102030.000000",
        },
      }),
    ).toEqual({ channel: "C123", threadTs: "1715102030.000000" });
  });

  test("summarizes socket envelopes without exposing message text", () => {
    expect(
      describeSlackSocketEnvelope({
        type: "events_api",
        payload: {
          type: "events_api",
          event: {
            type: "message",
            subtype: "message_changed",
            text: "do not log this",
          },
        },
      }),
    ).toBe("envelope=events_api payload=events_api event=message subtype=message_changed");
  });

  test("accepts Events API callback payloads delivered through Socket Mode", () => {
    expect(isSlackEventCallbackPayload({ type: "event_callback" })).toBe(true);
    expect(isSlackEventCallbackPayload({ type: "events_api" })).toBe(true);
    expect(isSlackEventCallbackPayload({ type: "hello" })).toBe(false);
    expect(isSlackEventCallbackPayload(null)).toBe(false);
  });
});
