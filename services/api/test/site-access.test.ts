import { describe, expect, it } from "vitest";
import { AppError } from "../src/utils/appError.js";
import { assertRecordOnAllowedSite, isSiteAdmin, pickCurrentSiteId, slugifyPlantCode } from "../src/modules/sites/siteAccess.js";

const plants = [
  { id: 1, isDefault: true, status: "active" },
  { id: 2, isDefault: false, status: "active" },
  { id: 3, isDefault: false, status: "inactive" },
];

describe("plant access", () => {
  it("builds a short code from a plant name", () => {
    expect(slugifyPlantCode("East Plant")).toBe("east-plant");
    expect(slugifyPlantCode("  ---  ")).toBe("plant");
  });

  it("treats only tenant admins as able to manage every plant", () => {
    expect(isSiteAdmin("admin")).toBe(true);
    expect(isSiteAdmin("quality_manager")).toBe(false);
    expect(isSiteAdmin("operator")).toBe(false);
  });

  it("prefers the header plant, then the saved plant, then the default", () => {
    expect(pickCurrentSiteId({ allowedIds: [1, 2], headerSiteId: 2, savedSiteId: 1, sites: plants })).toBe(2);
    expect(pickCurrentSiteId({ allowedIds: [1, 2], headerSiteId: null, savedSiteId: 2, sites: plants })).toBe(2);
    expect(pickCurrentSiteId({ allowedIds: [1, 2], headerSiteId: null, savedSiteId: null, sites: plants })).toBe(1);
    expect(pickCurrentSiteId({ allowedIds: [2], headerSiteId: null, savedSiteId: 1, sites: plants })).toBe(2);
    expect(pickCurrentSiteId({ allowedIds: [], headerSiteId: null, savedSiteId: null, sites: plants })).toBeNull();
  });

  it("hides a record from a plant the caller is not assigned to", () => {
    expect(() => assertRecordOnAllowedSite(2, [1], "Issue")).toThrow(AppError);
    expect(() => assertRecordOnAllowedSite(1, [1], "Issue")).not.toThrow();
    expect(() => assertRecordOnAllowedSite(9, undefined, "Issue")).not.toThrow();
  });
});