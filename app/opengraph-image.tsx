import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
          color: "white",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 160,
            height: 160,
            borderRadius: 32,
            border: "4px solid #22d3ee",
            marginBottom: 40,
          }}
        >
          <div
            style={{
              fontSize: 64,
              fontWeight: 900,
              color: "#22d3ee",
              letterSpacing: -2,
            }}
          >
            CFB
          </div>
        </div>

        <div style={{ fontSize: 72, fontWeight: 900, letterSpacing: -1 }}>
          CFB Draft Tool
        </div>

        <div style={{ marginTop: 16, fontSize: 28, color: "#94a3b8" }}>
          Live college football team drafts
        </div>
      </div>
    ),
    { ...size }
  );
}
