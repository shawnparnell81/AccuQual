import { describe, expect, it } from "vitest";
import { compareDisplayOrder, initialUserDisplayOrder, movedPerson, orderPeople, INITIAL_LEAD_EMAIL } from "../../src/modules/users/userDisplayOrder.js";

const person = (id: number, name: string, roleRank: number | null) => ({ id, name, roleRank });

describe("user display order", () => {
  it("keeps saved ids first and sorts the rest by role rank, then name, then id", () => {
    const rows = [
      person(4, "Zed", 80),
      person(2, "Amy", 15),
      person(9, "Nora", 80),
      person(3, "Bea", 20),
      person(8, "amy", 80),
      person(1, "Owner", 10),
    ];
    const ordered = orderPeople(rows, [2, 9, 2], (row) => row);
    expect(ordered.map((row) => row.id)).toEqual([2, 9, 1, 3, 8, 4]);
    expect(compareDisplayOrder(person(8, "amy", 80), person(4, "Zed", 80), new Map())).toBeLessThan(0);
    expect(compareDisplayOrder(person(5, "No role", null), person(4, "Zed", 80), new Map())).toBeGreaterThan(0);
  });

  it("places the rollout account first and keeps everyone else's id order", () => {
    const rows = [
      { id: 4, email: "  Later@plant.test " },
      { id: 2, email: INITIAL_LEAD_EMAIL.toUpperCase() },
      { id: 7, email: "early@plant.test" },
    ];
    expect(initialUserDisplayOrder(rows)).toEqual({ userIds: [2, 4, 7], leadPlacedFirst: true });
    expect(initialUserDisplayOrder([{ id: 3, email: "a@plant.test" }, { id: 1, email: "b@plant.test" }])).toEqual({
      userIds: [1, 3],
      leadPlacedFirst: false,
    });
  });

  it("names the person who moved the furthest when the request does not", () => {
    expect(movedPerson([1, 2, 3, 4], [1, 4, 2, 3])).toBe(4);
    expect(movedPerson([1, 2, 3], [1, 2, 3])).toBeNull();
  });
});
