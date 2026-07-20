import { describe, expect, it } from "vitest";
import { normalizeOrganizationSlug, organizationSlugPattern } from "@/lib/organizations";

describe("organization slugs", () => {
  it("normalizes mixed case input", () => expect(normalizeOrganizationSlug("Internal")).toBe("internal"));
  it("converts a business name into a stable URL slug", () => expect(normalizeOrganizationSlug("Basin Design Service, LLC")).toBe("basin-design-service-llc"));
  it("removes accents and repeated separators", () => expect(normalizeOrganizationSlug("  Élite---Field Ops  ")).toBe("elite-field-ops"));
  it("produces values accepted by the persisted slug pattern", () => expect(organizationSlugPattern.test(normalizeOrganizationSlug("North America / Internal"))).toBe(true));
});
