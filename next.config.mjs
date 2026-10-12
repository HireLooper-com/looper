/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // node-postgres and nodemailer only load on self-hosted installs; keep them out of the bundle.
  serverExternalPackages: ["pg", "nodemailer"],
  // The Docker image for on-prem installs builds with NEXT_OUTPUT=standalone (deploy/enterprise).
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
};
export default nextConfig;
