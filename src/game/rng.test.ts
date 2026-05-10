import { describe, expect, it } from "vitest";
import { createRng } from "./rng";

describe("SeededRng", () => {
  it("replays the same sequence for the same seed", () => {
    const a = createRng("same-seed");
    const b = createRng("same-seed");

    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it("produces different sequences for different seeds", () => {
    const a = createRng("seed-a");
    const b = createRng("seed-b");

    expect([a.next(), a.next(), a.next()]).not.toEqual([b.next(), b.next(), b.next()]);
  });
});
