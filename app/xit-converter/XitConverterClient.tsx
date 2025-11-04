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
    <div
      style={{
        padding: "24px",
        maxWidth: "1200px",
        margin: "0 auto",
        fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "32px", fontWeight: 700, marginBottom: "24px" }}>
        XIT Act Converter
      </h1>

      <div style={{ marginBottom: "24px" }}>
        <label
          htmlFor="input-text"
          style={{
            display: "block",
            fontWeight: 600,
            marginBottom: "8px",
            fontSize: "16px",
          }}
        >
          Input (Paste transfer lines):
        </label>
        <textarea
          id="input-text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="ACTION: Transfer 104 O from Antares Station Warehouse to 3k Alpha Cargo&#10;SUCCESS: Transfer 104 H from Antares Station Warehouse to 3k Alpha Cargo&#10;..."
          style={{
            width: "100%",
            minHeight: "200px",
            padding: "12px",
            fontSize: "14px",
            fontFamily: "monospace",
            border: "1px solid #dee2e6",
            borderRadius: "4px",
            resize: "vertical",
          }}
        />
      </div>

      <div style={{ marginBottom: "24px" }}>
        <button
          onClick={handleConvert}
          style={{
            padding: "10px 20px",
            fontSize: "16px",
            fontWeight: 600,
            color: "white",
            backgroundColor: "#007bff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#0056b3")}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#007bff")}
        >
          Convert
        </button>
      </div>

      {outputJson && (
        <div style={{ marginBottom: "24px" }}>
          <label
            htmlFor="output-json"
            style={{
              display: "block",
              fontWeight: 600,
              marginBottom: "8px",
              fontSize: "16px",
            }}
          >
            Output JSON (Editable):
          </label>
          <textarea
            id="output-json"
            value={outputJson}
            onChange={(e) => setOutputJson(e.target.value)}
            style={{
              width: "100%",
              minHeight: "300px",
              padding: "12px",
              fontSize: "14px",
              fontFamily: "monospace",
              border: "1px solid #dee2e6",
              borderRadius: "4px",
              resize: "vertical",
            }}
          />
          <button
            onClick={handleCopy}
            style={{
              marginTop: "12px",
              padding: "10px 20px",
              fontSize: "16px",
              fontWeight: 600,
              color: "white",
              backgroundColor: copySuccess ? "#28a745" : "#6c757d",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            {copySuccess ? "Copied!" : "Copy to Clipboard"}
          </button>
        </div>
      )}
    </div>
  );
}
