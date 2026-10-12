import { describe, expect, it } from "vitest";
import { listMatchesEvent } from "../../src/modules/fai-inspection/fai-notification-match.js";

const NO_FILTERS = { matchSiteId: null, matchProductFamily: null, matchTriggerReason: null, matchEventTypes: [] };

describe("listMatchesEvent", () => {
  it("a list with no filters set matches every event", () => {
    expect(listMatchesEvent(NO_FILTERS, { eventType: "passed", siteId: 5, productFamily: "Pumps", triggerReason: "New part" })).toBe(true);
    expect(listMatchesEvent(NO_FILTERS, { eventType: "failed", siteId: null, productFamily: null, triggerReason: null })).toBe(true);
  });

  it("an event-type filter excludes events not in the list", () => {
    const list = { ...NO_FILTERS, matchEventTypes: ["failed"] };
    expect(listMatchesEvent(list, { eventType: "failed", siteId: null, productFamily: null, triggerReason: null })).toBe(true);
    expect(listMatchesEvent(list, { eventType: "passed", siteId: null, productFamily: null, triggerReason: null })).toBe(false);
  });

  it("a plant filter only matches that exact plant", () => {
    const list = { ...NO_FILTERS, matchSiteId: 7 };
    expect(listMatchesEvent(list, { eventType: "passed", siteId: 7, productFamily: null, triggerReason: null })).toBe(true);
    expect(listMatchesEvent(list, { eventType: "passed", siteId: 8, productFamily: null, triggerReason: null })).toBe(false);
    expect(listMatchesEvent(list, { eventType: "passed", siteId: null, productFamily: null, triggerReason: null })).toBe(false);
  });

  it("a product-family filter only matches that exact family", () => {
    const list = { ...NO_FILTERS, matchProductFamily: "Pumps" };
    expect(listMatchesEvent(list, { eventType: "passed", siteId: null, productFamily: "Pumps", triggerReason: null })).toBe(true);
    expect(listMatchesEvent(list, { eventType: "passed", siteId: null, productFamily: "Valves", triggerReason: null })).toBe(false);
  });

  it("a trigger-reason filter only matches that exact reason", () => {
    const list = { ...NO_FILTERS, matchTriggerReason: "Annual random pull" };
    expect(listMatchesEvent(list, { eventType: "passed", siteId: null, productFamily: null, triggerReason: "Annual random pull" })).toBe(true);
    expect(listMatchesEvent(list, { eventType: "passed", siteId: null, productFamily: null, triggerReason: "New part" })).toBe(false);
  });

  it("requires ALL set filters to match at once, not just one", () => {
    const list = { ...NO_FILTERS, matchSiteId: 7, matchProductFamily: "Pumps" };
    expect(listMatchesEvent(list, { eventType: "passed", siteId: 7, productFamily: "Pumps", triggerReason: null })).toBe(true);
    expect(listMatchesEvent(list, { eventType: "passed", siteId: 7, productFamily: "Valves", triggerReason: null })).toBe(false);
  });
});
