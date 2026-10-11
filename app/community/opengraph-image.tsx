import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function CommunityOpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "radial-gradient(circle at 15% 0%, #164e63 0%, #020617 47%, #020617 100%)",
          color: "white",
          padding: "72px 82px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <div
            style={{
              width: "74px",
              height: "74px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "20px",
              background: "#fcd34d",
              color: "#020617",
              fontSize: "40px",
              fontWeight: 900,
            }}
          >
            L
          </div>
          <div
            style={{
              display: "flex",
              color: "#67e8f9",
              fontSize: "26px",
              fontWeight: 800,
              letterSpacing: "5px",
            }}
          >
            CFB LEAGUE HUB
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: "80px", fontWeight: 900, letterSpacing: "-3px" }}>
            League Hub
          </div>
          <div style={{ display: "flex", marginTop: "24px", color: "#cbd5e1", fontSize: "31px" }}>
            Live Draft · In-Season Commissioner Management
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
