import { describe, expect, test } from "bun:test";
import { getContentType } from "../src/server/contentType";

describe("getContentType", () => {
  test("returns css content type for stylesheets", () => {
    expect(getContentType("/assets/app.css")).toBe("text/css; charset=utf-8");
  });

  test("returns javascript content type for scripts", () => {
    expect(getContentType("/assets/app.js")).toBe("text/javascript; charset=utf-8");
  });

  test("falls back to html for routes", () => {
    expect(getContentType("/")).toBe("text/html; charset=utf-8");
  });
});
