import { describe, expect, it } from "vitest";

import { EMPTY_FILTERS, filtersToSearch, hasActiveFilters, parseFilters, tagLabel } from "./gallery-filters";

const parse = (query: string) => parseFilters(new URLSearchParams(query));

describe("gallery filters in the URL", () => {
  it("round-trips every filter in a canonical order", () => {
    const query = "q=ikat&tag=craft%3Aikat&tag=indigo&color=red&color=blue&type=fabric&sort=relevance";
    expect(filtersToSearch(parse(query))).toBe(query);
    expect(filtersToSearch(parse("sort=relevance&type=fabric&color=red&q=ikat"))).toBe(
      "q=ikat&color=red&type=fabric&sort=relevance",
    );
  });

  it("drops invalid and duplicate values from hand-edited URLs", () => {
    expect(parse("color=red&color=red&color=chartreuse&type=hat&sort=random&tag=%20&tag=a&tag=a")).toEqual({
      ...EMPTY_FILTERS,
      tags: ["a"],
      colors: ["red"],
    });
  });

  it("caps the search length and tag count like the API", () => {
    const filters = parse(`q=${"x".repeat(150)}&${Array.from({ length: 12 }, (_, i) => `tag=t${i}`).join("&")}`);
    expect(filters.q).toHaveLength(100);
    expect(filters.tags).toHaveLength(10);
  });

  it("omits defaults so an unfiltered gallery has a clean URL", () => {
    expect(filtersToSearch(EMPTY_FILTERS)).toBe("");
    expect(filtersToSearch({ ...EMPTY_FILTERS, q: "   " })).toBe("");
    expect(hasActiveFilters(parse("sort=oldest"))).toBe(false); // sorting is not filtering
    expect(hasActiveFilters(parse("color=red"))).toBe(true);
  });

  it("labels tags readably", () => {
    expect(tagLabel("craft:ikat")).toBe("ikat (craft)");
    expect(tagLabel("ikat")).toBe("ikat");
  });
});
