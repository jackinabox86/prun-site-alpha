"use client";

import { useState } from "react";

interface Materials {
  [ticker: string]: number;
}

interface OutputJSON {
  actions: Array<{
    origin: string;
    dest: string;
    group: string;
    name: string;
    type: string;
  }>;
  global: {
    name: string;
  };
  groups: Array<{
    materials: Materials;
    name: string;
    type: string;
  }>;
}

export default function XitConverterClient() {
  const [inputText, setInputText] = useState("");
  const [outputJson, setOutputJson] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);

  const parseActions = (text: string): Materials => {
    const materials: Materials = {};
    const lines = text.split("\n");

    for (const line of lines) {
      // Match pattern: Transfer [number] [ticker] from ... to ...
      // More flexible - works with ACTION:, SUCCESS:, or any prefix
      const match = line.match(/Transfer\s+(\d+)\s+([A-Z0-9]+)\s+from/i);
      if (match) {
        const quantity = parseInt(match[1], 10);
        const ticker = match[2];

        if (materials[ticker]) {
          materials[ticker] += quantity;
        } else {
          materials[ticker] = quantity;
        }
      }
    }

    return materials;
  };

  const handleConvert = () => {
    const materials = parseActions(inputText);

    const output: OutputJSON = {
      actions: [
        {
          origin: "Configure on Execution",
          dest: "Configure on Execution",
          group: "A1",
          name: "A1",
          type: "MTRA",
        },
      ],
      global: {
        name: "custom",
      },
      groups: [
        {
          materials: materials,
          name: "A1",
          type: "Manual",
        },
      ],
    };

    setOutputJson(JSON.stringify(output, null, 2));
    setCopySuccess(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(outputJson);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <>
      {/* Header Section */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <h1 className="terminal-header" style={{ margin: 0, fontSize: "1.2rem" }}>
          XIT ACT CONVERTER // PRUN_CARGO_TRANSFER_PARSER
        </h1>
        <p style={{ marginTop: "1rem", marginBottom: 0, color: "var(--color-text-secondary)", fontSize: "0.875rem", lineHeight: "1.6" }}>
          This utility parses cargo transfer ACTION logs from Prosperous Universe and converts them into XIT-compatible JSON format.
          Paste your ACTION lines below, convert, and copy the JSON output to import into XIT.
          <span className="text-mono" style={{ display: "block", marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            Format: ACTION: Transfer [quantity] [ticker] from [origin] to [destination]
          </span>
        </p>
      </div>

      {/* Input Section */}
      <div className="terminal-box" style={{ marginBottom: "2rem" }}>
        <div className="terminal-header" style={{ marginBottom: "1rem" }}>Input Data Stream</div>
        <label
          htmlFor="input-text"
          style={{
            display: "block",
            fontFamily: "var(--font-mono)",
            fontSize: "0.75rem",
            color: "var(--color-accent-primary)",
            marginBottom: "0.5rem",
            textTransform: "uppercase"
          }}
        >
          Paste ACTION Lines:
        </label>
        <textarea
          id="input-text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="ACTION: Transfer 104 O from Antares Station Warehouse to 3k Alpha Cargo&#10;SUCCESS: Transfer 104 H from Antares Station Warehouse to 3k Alpha Cargo&#10;..."
          className="terminal-input"
          style={{
            width: "100%",
            minHeight: "200px",
            fontFamily: "var(--font-mono)",
            fontSize: "0.875rem",
            resize: "vertical",
            lineHeight: "1.6"
          }}
        />
      </div>

      {/* Convert Button */}
      <div style={{ marginBottom: "2rem" }}>
        <button
          onClick={handleConvert}
          className="terminal-button"
          style={{ padding: "0.75rem 2rem", fontSize: "1rem" }}
        >
          Execute Conversion
        </button>
        {inputText && (
          <span style={{
            marginLeft: "1rem",
            fontFamily: "var(--font-mono)",
            fontSize: "0.875rem",
            color: "var(--color-text-muted)"
          }}>
            {inputText.split('\n').filter(line => line.includes('ACTION')).length} actions detected
          </span>
        )}
      </div>

      {/* Output Section */}
      {outputJson && (
        <div className="terminal-box" style={{ marginBottom: "2rem" }}>
          <div className="terminal-header" style={{ marginBottom: "1rem" }}>Output JSON Stream</div>
          <label
            htmlFor="output-json"
            style={{
              display: "block",
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              color: "var(--color-accent-primary)",
              marginBottom: "0.5rem",
              textTransform: "uppercase"
            }}
          >
            XIT-Compatible JSON (Editable):
          </label>
          <textarea
            id="output-json"
            value={outputJson}
            onChange={(e) => setOutputJson(e.target.value)}
            className="terminal-input"
            style={{
              width: "100%",
              minHeight: "300px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.875rem",
              resize: "vertical",
              lineHeight: "1.6",
              color: "var(--color-success)"
            }}
          />
          <div style={{ marginTop: "1rem" }}>
            <button
              onClick={handleCopy}
              className="terminal-button"
              style={{
                padding: "0.75rem 1.5rem",
                background: copySuccess ? "var(--color-success)" : "var(--color-bg-tertiary)",
                color: copySuccess ? "var(--color-bg-primary)" : "var(--color-accent-primary)",
                borderColor: copySuccess ? "var(--color-success)" : "var(--color-border-primary)"
              }}
            >
              {copySuccess ? "✓ Copied to Clipboard" : "Copy to Clipboard"}
            </button>
            {copySuccess && (
              <span style={{
                marginLeft: "1rem",
                fontFamily: "var(--font-mono)",
                fontSize: "0.875rem",
                color: "var(--color-success)"
              }}>
                [SUCCESS] Data copied to system clipboard
              </span>
            )}
          </div>
        </div>
      )}

      {/* Help Section */}
      {!outputJson && !inputText && (
        <div className="terminal-box" style={{ textAlign: "center", padding: "3rem 1rem" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
            <span className="text-accent" style={{ display: "block", marginBottom: "1rem", fontSize: "1.2rem" }}>
              [AWAITING INPUT]
            </span>
            <div style={{ maxWidth: "600px", margin: "0 auto", textAlign: "left" }}>
              <p style={{ marginBottom: "0.75rem" }}>
                <span className="text-accent">1.</span> Copy ACTION logs from your Prosperous Universe cargo transfer
              </p>
              <p style={{ marginBottom: "0.75rem" }}>
                <span className="text-accent">2.</span> Paste the ACTION lines into the input field above
              </p>
              <p style={{ marginBottom: "0.75rem" }}>
                <span className="text-accent">3.</span> Click "Execute Conversion" to generate XIT JSON
              </p>
              <p>
                <span className="text-accent">4.</span> Copy the output and import into XIT
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
