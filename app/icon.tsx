import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
          borderRadius: 14,
          border: "2px solid #22d3ee",
        }}
      >
        <div
          style={{
            fontSize: 26,
            fontWeight: 900,
            color: "#22d3ee",
            letterSpacing: -1,
          }}
        >
          CFB
        </div>
      </div>
    ),
    { ...size }
  );
}
