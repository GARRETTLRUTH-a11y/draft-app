import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Overrides the root opengraph-image for /season and everything nested
// under it (e.g. /season/room/[seasonId]) — the draft side of the app
// keeps the "CFB Draft" logo from app/opengraph-image.tsx.
export default async function SeasonOpengraphImage() {
  const logo = await readFile(join(process.cwd(), "public/logo-rta.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

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
        <img src={logoSrc} width={640} height={576} style={{ objectFit: "contain" }} />
      </div>
    ),
    { ...size }
  );
}
