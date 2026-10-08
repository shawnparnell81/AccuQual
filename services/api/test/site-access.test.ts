import { describe, expect, it } from "vitest";
import { AppError } from "../src/utils/appError.js";
import { assertRecordOnAllowedSite, isRetiredPlant, isSiteAdmin, pickCurrentSiteId, plantDeleteDescription, plantDisplayName, slugifyPlantCode } from "../src/modules/sites/siteAccess.js";

const plants = [
  { id: 1, isDefault: true, status: "active" },
  { id: 2, isDefault: false, status: "active" },
  { id: 3, isDefault: false, status: "inactive" },
  { id: 4, isDefault: false, status: "active", deletedAt: new Date("2026-01-01T00:00:00.000Z") },
];

describe("plant access", () => {
  it("builds a short code from a plant name", () => {
    expect(slugifyPlantCode("East Plant")).toBe("east-plant");
    expect(slugifyPlantCode("  ---  ")).toBe("plant");
  });

  it("treats only company admins as able to manage every plant", () => {
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
    expect(pickCurrentSiteId({ allowedIds: [4, 2], headerSiteId: 4, savedSiteId: 4, sites: plants })).toBe(2);
  });

  it("treats a deleted or deactivated plant as retired and keeps the frozen name", () => {
    expect(isRetiredPlant({ status: "inactive", deletedAt: null })).toBe(true);
    expect(isRetiredPlant({ status: "active", deletedAt: new Date() })).toBe(true);
    expect(isRetiredPlant({ status: "active", deletedAt: null })).toBe(false);
    expect(plantDisplayName({ name: "Renamed", nameSnapshot: "Harbor" })).toBe("Harbor");
    expect(plantDisplayName({ name: "Harbor", nameSnapshot: null })).toBe("Harbor");
    expect(plantDeleteDescription("Harbor", "harbor")).toMatch(/Deleted plant "Harbor" \(harbor\)/);
  });

  it("hides a record from a plant the caller is not assigned to", () => {
    expect(() => assertRecordOnAllowedSite(2, [1], "Issue")).toThrow(AppError);
    expect(() => assertRecordOnAllowedSite(1, [1], "Issue")).not.toThrow();
    expect(() => assertRecordOnAllowedSite(9, undefined, "Issue")).not.toThrow();
  });
});