import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_GRAPH_POINTS, blankGraph, downsample, graphFromData, graphIsEmpty, parsePoints, pointsToText, sameGraph } from "./graph";

describe("graph points: pasting two columns", () => {
  it("reads tab, comma, semicolon and space separated pairs", () => {
    const result = parsePoints("0\t0\n1.5,20\n2;40.25\n3   60\n");
    assert.deepEqual(result.points, [[0, 0], [1.5, 20], [2, 40.25], [3, 60]]);
    assert.equal(result.skipped, 0);
  });

  it("skips a header row, units and blank lines and counts them", () => {
    const result = parsePoints("Displacement (mm)\tForce (N)\n\n0\t0\nmm\tN\n5\t50\r\n");
    assert.deepEqual(result.points, [[0, 0], [5, 50]]);
    assert.equal(result.skipped, 2);
  });

  it("keeps negative and exponent numbers and drops a line with one value", () => {
    const result = parsePoints("-1.5\t2e2\n7\n");
    assert.deepEqual(result.points, [[-1.5, 200]]);
    assert.equal(result.skipped, 1);
  });

  it("stops at the point limit", () => {
    const text = Array.from({ length: MAX_GRAPH_POINTS + 5 }, (_, i) => `${i}\t${i}`).join("\n");
    const result = parsePoints(text);
    assert.equal(result.points.length, MAX_GRAPH_POINTS);
    assert.equal(result.truncated, true);
  });

  it("round-trips through text", () => {
    const points: [number, number][] = [[0, 1], [2.5, 3]];
    assert.deepEqual(parsePoints(pointsToText(points)).points, points);
  });
});

describe("graph data from a saved report", () => {
  it("is empty when nothing was saved", () => {
    assert.deepEqual(graphFromData({}), blankGraph());
    assert.equal(graphIsEmpty(graphFromData(undefined)), true);
  });

  it("keeps good fields and points and drops malformed ones", () => {
    const graph = graphFromData({ graph: { fields: { File: "run1.csv", Rate: 12.5, Bad: {} }, points: [[1, 2], [3], ["a", 1], [4, 5], [Number.NaN, 1]] } });
    assert.deepEqual(graph.fields, { File: "run1.csv", Rate: "12.5" });
    assert.deepEqual(graph.points, [[1, 2], [4, 5]]);
  });
});

describe("graph drawing and comparison", () => {
  it("thins a long run for drawing and keeps the first and last point", () => {
    const points: [number, number][] = Array.from({ length: 10000 }, (_, i) => [i, i * 2]);
    const thinned = downsample(points, 500);
    assert.equal(thinned.length, 500);
    assert.deepEqual(thinned[0], [0, 0]);
    assert.deepEqual(thinned[thinned.length - 1], [9999, 19998]);
  });

  it("leaves a short run alone", () => {
    const points: [number, number][] = [[0, 0], [1, 1]];
    assert.equal(downsample(points, 500), points);
  });

  it("sameGraph sees a changed point or field", () => {
    const a = { fields: { File: "a" }, points: [[1, 2]] as [number, number][] };
    assert.equal(sameGraph(a, { fields: { File: "a" }, points: [[1, 2]] }), true);
    assert.equal(sameGraph(a, { fields: { File: "a" }, points: [[1, 3]] }), false);
    assert.equal(sameGraph(a, { fields: { File: "b" }, points: [[1, 2]] }), false);
    assert.equal(sameGraph(a, { fields: {}, points: [[1, 2]] }), false);
  });
});
