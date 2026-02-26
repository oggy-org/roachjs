/**
 * @module benchmarks/generate-svg
 * @description Generate 4 dark-themed benchmark SVG charts for the RoachJS README.
 * Reads results from benchmarks/results.json and produces themed charts.
 *
 * Usage: node benchmarks/generate-svg.js
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const resultsPath = join(__dirname, 'results.json')
const assetsDir = join(rootDir, 'assets')

/**
 * @description Format a number with commas for display inside SVG.
 */
function formatNumber(num) {
    return Math.round(num).toLocaleString('en-US')
}

/**
 * @description Generate a single benchmark SVG chart.
 */
function generateChart(title, subtitle, data) {
    const width = 820
    const height = 260
    const barHeight = 36
    const barGap = 18
    const labelWidth = 100
    const chartLeft = labelWidth + 30
    const chartRight = width - 160
    const chartWidth = chartRight - chartLeft

    const frameworks = [
        { name: 'RoachJS', value: data.roachjs?.requestsPerSec || 0, color: '#c8a070', glow: true, textColor: '#e8d8c0' },
        { name: 'Fastify', value: data.fastify?.requestsPerSec || 0, color: '#4a3020', glow: false, textColor: '#7a6a5a' },
        { name: 'Express', value: data.express?.requestsPerSec || 0, color: '#1e1208', glow: false, textColor: '#5a4a3a' }
    ]

    const maxValue = Math.max(...frameworks.map(f => f.value), 1)
    const startY = 80

    let bars = ''
    for (let i = 0; i < frameworks.length; i++) {
        const fw = frameworks[i]
        const y = startY + i * (barHeight + barGap)
        const barW = Math.max(6, (fw.value / maxValue) * chartWidth)
        const glowAttr = fw.glow ? 'filter="url(#barGlow)"' : ''

        bars += `
    <text x="${labelWidth + 16}" y="${y + barHeight / 2 + 5}" fill="${fw.textColor}"
          font-family="'Georgia', serif" font-size="15" text-anchor="end"
          font-weight="${fw.glow ? 'bold' : 'normal'}">${fw.name}</text>
    <rect x="${chartLeft}" y="${y}" width="${barW}" height="${barHeight}" rx="3"
          fill="${fw.color}" ${glowAttr} opacity="${fw.glow ? 1 : 0.8}"/>
    <text x="${chartLeft + barW + 14}" y="${y + barHeight / 2 + 5}"
          fill="${fw.textColor}" font-family="'SF Mono', 'Fira Code', monospace"
          font-size="13" font-weight="${fw.glow ? 'bold' : 'normal'}">${formatNumber(fw.value)} req/sec</text>`
    }

    const systemInfo = data.system
        ? `${data.system.cpu} · ${data.system.ram} RAM · ${data.system.node}`
        : 'auto-generated — run npm run benchmark to update'

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0805"/>
      <stop offset="100%" stop-color="#140d08"/>
    </linearGradient>
    <filter id="barGlow" x="-10%" y="-20%" width="120%" height="140%">
      <feGaussianBlur stdDeviation="3" result="glow"/>
      <feMerge>
        <feMergeNode in="glow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" rx="10" fill="url(#bgGrad)"/>
  <rect width="${width}" height="${height}" rx="10" fill="none" stroke="#2a1f15" stroke-width="1"/>

  <text x="${width / 2}" y="34" fill="#ddc8a8" font-family="'Georgia', serif"
        font-size="20" text-anchor="middle" font-weight="bold">${title}</text>
  <text x="${width / 2}" y="54" fill="#5a4a3a" font-family="'SF Mono', 'Fira Code', monospace"
        font-size="11" text-anchor="middle">${subtitle}</text>

  ${bars}

  <text x="${width / 2}" y="${height - 12}" fill="#2a1f15" font-family="'SF Mono', 'Fira Code', monospace"
        font-size="9" text-anchor="middle">${systemInfo}</text>
</svg>`
}

function main() {
    let results

    if (existsSync(resultsPath)) {
        results = JSON.parse(readFileSync(resultsPath, 'utf-8'))
        console.log('Generating SVGs from benchmark results...')
    } else {
        console.log('No results.json found. Please run npm run benchmark first.')
        return
    }

    if (!existsSync(assetsDir)) {
        mkdirSync(assetsDir, { recursive: true })
    }

    const charts = [
        {
            file: 'benchmark-hello-world.svg',
            title: 'Hello World',
            subtitle: `Plain text response · ${results.config?.connections || 10} connections · ${results.config?.duration || 10}s`,
            data: { ...results.helloWorld, system: results.system }
        },
        {
            file: 'benchmark-json.svg',
            title: 'JSON Response',
            subtitle: `JSON serialization · ${results.config?.connections || 10} connections · ${results.config?.duration || 10}s`,
            data: { ...results.json, system: results.system }
        },
        {
            file: 'benchmark-params-body.svg',
            title: 'Route Params + Body Parsing',
            subtitle: `POST with URL param + JSON body · ${results.config?.connections || 10} connections · ${results.config?.duration || 10}s`,
            data: { ...results.paramsBody, system: results.system }
        },
        {
            file: 'benchmark-middleware.svg',
            title: 'Middleware Chain',
            subtitle: `3 middleware functions · ${results.config?.connections || 10} connections · ${results.config?.duration || 10}s`,
            data: { ...results.middleware, system: results.system }
        }
    ]

    for (const chart of charts) {
        const svg = generateChart(chart.title, chart.subtitle, chart.data)
        const outputPath = join(assetsDir, chart.file)
        writeFileSync(outputPath, svg)
        console.log(`  Generated ${chart.file}`)
    }

    console.log('\nAll benchmark SVGs generated.')
}

main()
