import { describe, expect, it } from "vitest";
import { readJson } from "./helpers.js";

/**
 * `server.json` describes DevFlow for the official MCP Registry (ADR 0029). The registry checks
 * it against the npm package, so it must agree with the root manifest.
 */
interface ServerJson {
  $schema: string;
  name: string;
  description: string;
  version: string;
  repository: { url: string; source: string };
  packages: {
    registryType: string;
    identifier: string;
    version: string;
    transport: { type: string };
    packageArguments: { type: string; value: string }[];
  }[];
}

const server = readJson("server.json") as ServerJson;
const root = readJson("package.json") as {
  version: string;
  devflow: { npmScope: string; mcpName: string };
};

describe("server.json (MCP Registry)", () => {
  it("uses the GitHub namespace of the repository owner and the name staged as mcpName", () => {
    expect(server.$schema).toMatch(/^https:\/\/static\.modelcontextprotocol\.io\/schemas\//);
    expect(server.name).toBe("io.github.mohamedyangui/devflow");
    expect(server.name).toBe(root.devflow.mcpName);
    expect(server.repository).toEqual({
      url: "https://github.com/mohamedyangui/DevFlow",
      source: "github",
    });
  });

  it("keeps the description within the registry limit", () => {
    expect(server.description.length).toBeGreaterThan(0);
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it("points to the npm package at the repository version, started with `devflow mcp`", () => {
    expect(server.version).toBe(root.version);
    expect(server.packages).toEqual([
      expect.objectContaining({
        registryType: "npm",
        identifier: `${root.devflow.npmScope}/cli`,
        version: root.version,
        transport: { type: "stdio" },
        packageArguments: [{ type: "positional", value: "mcp" }],
      }),
    ]);
  });
});
