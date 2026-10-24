import {describe, expect, test} from "vitest";
import { countdownLabel, gapLabel, pointsLabel, recordLabel } from "./duel";

describe("duel labels", () => {
  test("countdown prefers days, then hours", () => {
    expect(countdownLabel(2 * 86400 + 3 * 3600)).toBe("2d 3h");
    expect(countdownLabel(5 * 3600 + 12 * 60)).toBe("5h 12m");
    expect(countdownLabel(45)).toBe("0m");
    expect(countdownLabel(-4)).toBe("0m");
  });

  test("gap names a lead and a tie", () => {
    expect(gapLabel(12, "you")).toBe("12 ahead");
    expect(gapLabel(0, "tied")).toBe("Level");
    expect(gapLabel(1.5, "them")).toBe("1.5 ahead");
  });

  test("points stay one decimal when they are not whole", () => {
    expect(pointsLabel(12)).toBe("12");
    expect(pointsLabel(10)).toBe("10");
    expect(pointsLabel(100)).toBe("100");
    expect(pointsLabel(12.5)).toBe("12.5");
    expect(pointsLabel(12.25)).toBe("12.25");
    expect(pointsLabel("nope")).toBe("0");
  });

  test("record hides an empty slate", () => {
    expect(recordLabel({ wins: 0, losses: 0, ties: 0 })).toBe("");
    expect(recordLabel({ wins: 2, losses: 1, ties: 1 })).toBe("2-1-1");
  });
});
