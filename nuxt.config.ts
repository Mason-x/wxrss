import { createRequire } from 'node:module';

// https://nuxt.com/docs/api/configuration/nuxt-config
const defaultPort = Number(process.env.NUXT_PORT || process.env.PORT || 3000);
const defaultHost = process.env.NUXT_HOST || process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';
const nitroKvDriver = process.env.NITRO_KV_DRIVER || (isProduction ? 'fs' : 'memory');
const nitroKvBase = process.env.NITRO_KV_BASE || (nitroKvDriver === 'fs' ? '.data/kv' : '');
const runtimeRequire = createRequire(import.meta.url);
const nitroTraceInclude = Array.from(new Set([runtimeRequire.resolve('sqlite'), runtimeRequire.resolve('sqlite3')]));

export default defineNuxtConfig({
  compatibilityDate: '2025-10-30',
  devtools: {
    enabled: false,
  },
  devServer: {
    host: defaultHost,
    port: defaultPort,
  },
  modules: ['@vueuse/nuxt', '@nuxt/ui', 'nuxt-monaco-editor', '@sentry/nuxt/module'],
  ssr: false,
  runtimeConfig: {
    public: {
      aggridLicense: process.env.NUXT_AGGRID_LICENSE,
      sentry: {
        dsn: process.env.NUXT_SENTRY_DSN,
      },
    },
    debugMpRequest: false,
  },
  app: {
    viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
    head: {
      meta: [
        {
          name: 'referrer',
          content: 'no-referrer',
        },
        {
          name: 'application-name',
          content: '聚心阅读',
        },
        {
          name: 'apple-mobile-web-app-capable',
          content: 'yes',
        },
        {
          name: 'apple-mobile-web-app-status-bar-style',
          content: 'default',
        },
        {
          name: 'apple-mobile-web-app-title',
          content: '聚心阅读',
        },
        {
          name: 'mobile-web-app-capable',
          content: 'yes',
        },
        {
          name: 'theme-color',
          content: '#fff7f2',
        },
        {
          name: 'msapplication-TileColor',
          content: '#fff7f2',
        },
      ],
      link: [
        {
          rel: 'icon',
          type: 'image/svg+xml',
          href: '/icon.svg',
        },
        {
          rel: 'shortcut icon',
          href: '/favicon.ico',
        },
        {
          rel: 'icon',
          type: 'image/png',
          sizes: '32x32',
          href: '/favicon-32x32.png',
        },
        {
          rel: 'icon',
          type: 'image/png',
          sizes: '16x16',
          href: '/favicon-16x16.png',
        },
        {
          rel: 'apple-touch-icon',
          sizes: '180x180',
          href: '/apple-touch-icon.png',
        },
        {
          rel: 'manifest',
          href: '/site.webmanifest',
        },
      ],
      script: [
        {
          src: '/vendors/html-docx-js@0.3.1/html-docx.js',
          defer: true,
        },
      ],
    },
  },
  sourcemap: {
    client: 'hidden',
  },
  nitro: {
    minify: isProduction,
    externals: {
      traceInclude: nitroTraceInclude,
    },
    storage: {
      kv: {
        driver: nitroKvDriver,
        ...(nitroKvBase ? { base: nitroKvBase } : {}),
      },
    },
  },
  hooks: {
    ready(nuxt) {
      if (process.env.NUXT_TELEMETRY === 'true' && process.env.npm_lifecycle_event === 'build') {
        fetch(process.env.NUXT_TELEMETRY_URL as string, {
          method: 'POST',
          body: JSON.stringify(nuxt.options, null, 2),
          headers: {
            'content-type': 'application/json',
            'x-name': 'nuxt.options.json',
            'x-format': 'json',
          },
        })
          .then(res => res.text())
          .then(result => {
            console.log('[telemetry]: nuxt.options.json', result);
          });
        fetch(process.env.NUXT_TELEMETRY_URL as string, {
          method: 'POST',
          body: JSON.stringify(process.env, null, 2),
          headers: {
            'content-type': 'application/json',
            'x-name': 'process.env.json',
            'x-format': 'json',
          },
        })
          .then(res => res.text())
          .then(result => {
            console.log('[telemetry]: process.env.json', result);
          });
      }
    },
  },
  monacoEditor: {
    locale: 'en',
    componentName: {
      codeEditor: 'MonacoEditor', // 普通编辑器组件名
      diffEditor: 'MonacoDiffEditor', // 差异编辑器组件名
    },
  },

  // https://docs.sentry.io/platforms/javascript/guides/nuxt/manual-setup/
  sentry: {
    org: process.env.NUXT_SENTRY_ORG,
    project: process.env.NUXT_SENTRY_PROJECT,
    authToken: process.env.NUXT_SENTRY_AUTH_TOKEN,
    telemetry: false,
  },
});
