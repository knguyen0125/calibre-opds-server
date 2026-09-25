import { describe, expect, test } from "bun:test";
import { deviceFromHeaders, parseDeviceUsername } from "../src/auth.ts";

type HeadersLike = Parameters<typeof deviceFromHeaders>[0];

describe("parseDeviceUsername", () => {
  test("plain username carries no device", () => {
    expect(parseDeviceUsername("kien")).toEqual({
      base: "kien",
      device: null,
    });
  });

  test("parses X4 and X3 tags case-insensitively", () => {
    expect(parseDeviceUsername("kien#X4")).toEqual({ base: "kien", device: "X4" });
    expect(parseDeviceUsername("kien#x4")).toEqual({ base: "kien", device: "X4" });
    expect(parseDeviceUsername("kien#X3")).toEqual({ base: "kien", device: "X3" });
  });

  test("splits on the last hash only", () => {
    expect(parseDeviceUsername("ki#en#X4")).toEqual({
      base: "ki#en",
      device: "X4",
    });
  });

  test("unknown or empty tags are invalid", () => {
    expect(parseDeviceUsername("kien#X5")).toBeNull();
    expect(parseDeviceUsername("kien#")).toBeNull();
    expect(parseDeviceUsername("kien#phone")).toBeNull();
  });
});

describe("deviceFromHeaders", () => {
  const headersFor = (username: string): HeadersLike => {
    const token = Buffer.from(`${username}:secret`).toString("base64");
    return { authorization: `Basic ${token}` } as HeadersLike;
  };

  test("extracts the device tag from basic auth", () => {
    expect(deviceFromHeaders(headersFor("kien#X4"))).toBe("X4");
    expect(deviceFromHeaders(headersFor("kien#x3"))).toBe("X3");
    expect(deviceFromHeaders(headersFor("kien"))).toBeNull();
  });

  test("returns null without credentials or with garbage", () => {
    expect(deviceFromHeaders({} as HeadersLike)).toBeNull();
    expect(
      deviceFromHeaders({ authorization: "Basic !!!" } as HeadersLike),
    ).toBeNull();
    expect(
      deviceFromHeaders({ authorization: "Bearer zzz" } as HeadersLike),
    ).toBeNull();
  });
});
