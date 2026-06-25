import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
        }}
      >
        <div
          style={{
            fontSize: 70,
            fontWeight: 900,
            color: "#22d3ee",
            letterSpacing: -2,
          }}
        >
          CFB
        </div>
      </div>
    ),
    { ...size }
  );
}
