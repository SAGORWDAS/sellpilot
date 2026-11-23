import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@node-rs/argon2', 'pg-boss', 'imapflow', 'mailparser', 'nodemailer'],
};

export default nextConfig;