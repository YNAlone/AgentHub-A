import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // E2E runs beside a developer's live Next server without contending for its build lock.
  ...(process.env.AGENTHUB_E2E === '1' ? { distDir: '.next-e2e' } : {}),
  // Electron 打包用：生成 .next/standalone 自包含 server（详见 Spec 12 §2 / §6）
  output: 'standalone',

  // dev 模式下用公网 IP / 机器名访问时，Next 默认拦截 /_next/* 开发资源（HMR、client chunk），
  // 页面只剩 SSR 壳、点击无响应；这里显式放行本机公网 IP（只写 hostname，不带协议/端口）
  allowedDevOrigins: ['111.231.5.52'],

  // 不让 webpack bundle native / SDK 依赖；运行时走 require/import，保留 native binding 与子进程能力
  serverExternalPackages: [
    'better-sqlite3',
    '@anthropic-ai/claude-agent-sdk',
    '@openai/codex-sdk',
    '@openai/codex',
    '@modelcontextprotocol/sdk',
    'pptxgenjs',
    'pdf-parse',
  ],

  outputFileTracingIncludes: {
    '/*': [
      'scripts/agenthub-codex-mcp.mjs',
      // pdf-parse loads pdf.worker.mjs at runtime; keep worker assets in standalone/Electron.
      'node_modules/pdf-parse/dist/**/*',
      'node_modules/pdfjs-dist/**/*',
      'node_modules/.pnpm/pdf-parse@*/node_modules/pdf-parse/dist/**/*',
      'node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/**/*',
    ],
  },

  outputFileTracingExcludes: {
    '/*': [
      '.agenthub-data/**',
      '.claude/**',
      '.git/**',
      '.understand-anything/**',
      '*.md',
      '*.txt',
      'components.json',
      'drizzle.config.ts',
      'eslint.config.mjs',
      'apps/**',
      'dist-electron/**',
      'electron/**',
      'next.config.ts',
      'openspec/**',
      'packages/**',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'postcss.config.mjs',
      'public/**',
      'release/**',
      'scripts/electron-*.mjs',
      'scripts/run-electron-node.mjs',
      'skills/**',
      'specs/**',
      'src/**',
      'tsconfig*.json',
      'tsconfig.tsbuildinfo',
    ],
  },
}

export default nextConfig
