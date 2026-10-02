import { expect, test } from "vitest";
import { beatToSeconds, quantize } from "../src/core/model";

test("beatToSeconds integrates tempo changes", () => {
  const tempo = [{ beat: 0, bpm: 120 }, { beat: 8, bpm: 60 }];
  expect(beatToSeconds(tempo, 4)).toBe(2);
  expect(beatToSeconds(tempo, 10)).toBe(4 + 2);
});

test("quantize snaps to 1/960 and is idempotent", () => {
  expect(quantize(1 / 3)).toBe(320 / 960);
  expect(quantize(quantize(0.1 + 0.2))).toBe(quantize(0.3));
  expect(quantize(0.0004)).toBe(0);
  expect(quantize(-0.0006)).toBe(-1 / 960);
});
