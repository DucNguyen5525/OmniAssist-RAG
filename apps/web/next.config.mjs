import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from workspace root if running in monorepo workspace
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../.env");

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let val = trimmed.slice(index + 1).trim();

    // Unquote value if needed
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@helpdesk/shared"]
};

export default nextConfig;
