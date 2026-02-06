import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  bold,
  bullet,
  bulletDim,
  cmd,
  dim,
  error,
  header,
  hint,
  info,
  jsonOutput,
  nextStep,
  type OutputOptions,
  output,
  success,
  warn,
} from "./output";

describe("output utilities", () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleOutput: string[];

  beforeEach(() => {
    consoleOutput = [];
    consoleSpy = spyOn(console, "log").mockImplementation((...args) => {
      consoleOutput.push(args.join(" "));
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("jsonOutput", () => {
    it("outputs JSON with 2-space indent", () => {
      jsonOutput({ key: "value" });
      expect(consoleOutput[0]).toBe('{\n  "key": "value"\n}');
    });

    it("handles nested objects", () => {
      jsonOutput({ outer: { inner: "value" } });
      expect(consoleOutput[0]).toContain('"outer"');
      expect(consoleOutput[0]).toContain('"inner"');
    });

    it("handles arrays", () => {
      jsonOutput({ items: [1, 2, 3] });
      expect(consoleOutput[0]).toContain("[");
      expect(consoleOutput[0]).toContain("1");
    });
  });

  describe("output", () => {
    it("calls json handler when json option is true", () => {
      const options: OutputOptions = { json: true };
      let jsonCalled = false;
      let humanCalled = false;

      output(options, {
        json: () => {
          jsonCalled = true;
          return { success: true };
        },
        human: () => {
          humanCalled = true;
        },
      });

      expect(jsonCalled).toBe(true);
      expect(humanCalled).toBe(false);
    });

    it("calls quiet handler when quiet option is true", () => {
      const options: OutputOptions = { quiet: true };
      let quietCalled = false;
      let humanCalled = false;

      output(options, {
        quiet: () => {
          quietCalled = true;
        },
        human: () => {
          humanCalled = true;
        },
      });

      expect(quietCalled).toBe(true);
      expect(humanCalled).toBe(false);
    });

    it("calls human handler when no options set", () => {
      const options: OutputOptions = {};
      let humanCalled = false;

      output(options, {
        human: () => {
          humanCalled = true;
        },
      });

      expect(humanCalled).toBe(true);
    });

    it("json takes precedence over quiet", () => {
      const options: OutputOptions = { json: true, quiet: true };
      let jsonCalled = false;
      let quietCalled = false;

      output(options, {
        json: () => {
          jsonCalled = true;
          return { success: true };
        },
        quiet: () => {
          quietCalled = true;
        },
        human: () => {},
      });

      expect(jsonCalled).toBe(true);
      expect(quietCalled).toBe(false);
    });

    it("falls back to human when json handler not provided", () => {
      const options: OutputOptions = { json: true };
      let humanCalled = false;

      output(options, {
        human: () => {
          humanCalled = true;
        },
      });

      expect(humanCalled).toBe(true);
    });

    it("falls back to human when quiet handler not provided", () => {
      const options: OutputOptions = { quiet: true };
      let humanCalled = false;

      output(options, {
        human: () => {
          humanCalled = true;
        },
      });

      expect(humanCalled).toBe(true);
    });

    it("outputs JSON from json handler", () => {
      const options: OutputOptions = { json: true };

      output(options, {
        json: () => ({ status: "ok", count: 42 }),
        human: () => {},
      });

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('"status"');
      expect(consoleOutput[0]).toContain('"ok"');
    });
  });

  describe("header", () => {
    it("outputs title with spacing", () => {
      header("My Section");
      // Header adds empty line, bold title, empty line = 3 calls
      expect(consoleOutput.length).toBe(3);
    });

    it("includes the title text", () => {
      header("Test Title");
      const combined = consoleOutput.join("\n");
      expect(combined).toContain("Test Title");
    });
  });

  describe("styled output functions", () => {
    let consoleErrorSpy: ReturnType<typeof spyOn>;
    let errorOutput: string[];

    beforeEach(() => {
      errorOutput = [];
      consoleErrorSpy = spyOn(console, "error").mockImplementation(
        (...args) => {
          errorOutput.push(args.join(" "));
        },
      );
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("success outputs with checkmark", () => {
      success("Operation complete");
      expect(consoleOutput.some((o) => o.includes("Operation complete"))).toBe(
        true,
      );
    });

    it("info outputs with info symbol", () => {
      info("Some information");
      expect(consoleOutput.some((o) => o.includes("Some information"))).toBe(
        true,
      );
    });

    it("warn outputs with warning symbol", () => {
      warn("Warning message");
      expect(consoleOutput.some((o) => o.includes("Warning message"))).toBe(
        true,
      );
    });

    it("error outputs to stderr", () => {
      error("Error message");
      expect(errorOutput.some((o) => o.includes("Error message"))).toBe(true);
    });

    it("bullet outputs with bullet point", () => {
      bullet("Bullet item");
      expect(consoleOutput.some((o) => o.includes("Bullet item"))).toBe(true);
    });

    it("bulletDim outputs dimmed bullet", () => {
      bulletDim("Dim bullet");
      expect(consoleOutput.some((o) => o.includes("Dim bullet"))).toBe(true);
    });

    it("hint outputs indented text", () => {
      hint("Hint text");
      expect(consoleOutput.some((o) => o.includes("Hint text"))).toBe(true);
    });

    it("nextStep outputs command", () => {
      nextStep("npm install");
      expect(consoleOutput.some((o) => o.includes("npm install"))).toBe(true);
    });
  });

  describe("text formatting", () => {
    it("bold returns string", () => {
      const result = bold("test");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("dim returns string", () => {
      const result = dim("test");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("cmd returns string", () => {
      const result = cmd("test");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
