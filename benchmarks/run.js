/**
 * @module benchmarks/run
 * @description Benchmark runner for RoachJS. Runs 4 distinct benchmark scenarios
 * against RoachJS, Fastify, and Express under identical conditions:
 *
 * 1. Hello World — plain text response, raw HTTP throughput
 * 2. JSON Response — JSON serialization overhead
 * 3. Route Params + Body Parsing — POST with URL param and JSON body
 * 4. Middleware Chain — 3 middleware functions before the handler
 *
 * Results are saved to benchmarks/results.json for SVG generation.
 *
 * Usage: node benchmarks/run.js
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const DURATION = 10
const CONNECTIONS = 10
const PIPELINING = 1

/**
 * @description Run autocannon against a URL and return the results.
 * @param {string} url - Target URL to benchmark
 * @param {object} [opts] - Additional autocannon options
 * @returns {Promise<object>} autocannon result object
 */
async function bench(url, opts = {}) {
    const autocannon = (await import('autocannon')).default
    return new Promise((resolve, reject) => {
        const instance = autocannon({
            url,
            duration: DURATION,
            connections: CONNECTIONS,
            pipelining: PIPELINING,
            ...opts
        }, (err, result) => {
            if (err) reject(err)
            else resolve(result)
        })
        autocannon.track(instance, { renderProgressBar: true })
    })
}

/**
 * @description Extract the numbers we care about from an autocannon result.
 * @param {object} result - Raw autocannon result
 * @returns {{requestsPerSec: number, latencyAvg: number, latencyP99: number, throughput: number}}
 */
function extract(result) {
    return {
        requestsPerSec: result.requests.average,
        latencyAvg: result.latency.average,
        latencyP99: result.latency.p99,
        throughput: result.throughput.average
    }
}

/**
 * @description Format a number with commas for display.
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 */
function fmt(num) {
    return Math.round(num).toLocaleString('en-US')
}

// ─── Server Factories ───────────────────────────────────────────────────────

/**
 * @description Start a RoachJS server with the given route setup function.
 * @param {Function} setup - Function that receives the app and configures routes
 * @param {number} port - Port to listen on
 * @returns {Promise<{port: number, close: Function}>}
 */
async function startRoach(setup, port) {
    const roach = (await import('../src/index.js')).default
    const app = roach()
    setup(app)
    return new Promise((resolve) => {
        app.listen(port, () => resolve({ port, close: () => app.close() }))
    })
}

/**
 * @description Start a Fastify server with the given route setup function.
 * @param {Function} setup - Function that receives the app and configures routes
 * @param {number} port - Port to listen on
 * @returns {Promise<{port: number, close: Function}>}
 */
async function startFastify(setup, port) {
    const Fastify = (await import('fastify')).default
    const app = Fastify({ logger: false })
    setup(app)
    await app.listen({ port, host: '0.0.0.0' })
    return { port, close: () => app.close() }
}

/**
 * @description Start an Express server with the given route setup function.
 * @param {Function} setup - Function that receives the app and configures routes
 * @param {number} port - Port to listen on
 * @returns {Promise<{port: number, close: Function}>}
 */
async function startExpress(setup, port) {
    const express = (await import('express')).default
    const app = express()
    setup(app, express)
    return new Promise((resolve) => {
        const server = app.listen(port, () => resolve({ port, close: () => server.close() }))
    })
}

// ─── Benchmark Scenarios ────────────────────────────────────────────────────

/**
 * @description Run a single benchmark scenario across all 3 frameworks.
 * @param {string} name - Scenario name
 * @param {object} setups - Object with roach, fastify, express setup functions
 * @param {string} path - URL path to benchmark
 * @param {object} [autocannonOpts] - Extra autocannon options (method, body, headers)
 * @returns {Promise<object>} Results for all 3 frameworks
 */
async function runScenario(name, setups, path, autocannonOpts = {}) {
    console.log(`\n${'═'.repeat(50)}`)
    console.log(`  ${name}`)
    console.log(`${'═'.repeat(50)}`)

    const results = {}
    const basePort = 3200

    const frameworks = [
        { name: 'roachjs', label: 'RoachJS', start: startRoach, setup: setups.roach, port: basePort },
        { name: 'fastify', label: 'Fastify', start: startFastify, setup: setups.fastify, port: basePort + 1 },
        { name: 'express', label: 'Express', start: startExpress, setup: setups.express, port: basePort + 2 }
    ]

    for (const fw of frameworks) {
        try {
            console.log(`\n  --- ${fw.label} ---`)
            const server = await fw.start(fw.setup, fw.port)
            const result = await bench(`http://localhost:${server.port}${path}`, autocannonOpts)
            results[fw.name] = extract(result)
            server.close()
        } catch (err) {
            console.log(`  ${fw.label} skipped: ${err.message}`)
            results[fw.name] = { requestsPerSec: 0, latencyAvg: 0, latencyP99: 0, throughput: 0 }
        }
    }

    console.log(`\n  Results:`)
    for (const [key, data] of Object.entries(results)) {
        console.log(`    ${key.padEnd(10)} ${fmt(data.requestsPerSec)} req/sec  (avg ${data.latencyAvg}ms, p99 ${data.latencyP99}ms)`)
    }

    return results
}

async function main() {
    console.log('╔══════════════════════════════════════════════╗')
    console.log('║       RoachJS Benchmark Suite                ║')
    console.log('╚══════════════════════════════════════════════╝')
    console.log(`\nDuration: ${DURATION}s | Connections: ${CONNECTIONS} | Pipelining: ${PIPELINING}`)

    const allResults = { config: { duration: DURATION, connections: CONNECTIONS, pipelining: PIPELINING } }

    // Benchmark 1: Hello World
    allResults.helloWorld = await runScenario('Benchmark 1: Hello World', {
        roach: (app) => {
            app.get('/', (req, res) => res.send('Hello World'))
        },
        fastify: (app) => {
            app.get('/', (req, reply) => reply.send('Hello World'))
        },
        express: (app) => {
            app.get('/', (req, res) => res.send('Hello World'))
        }
    }, '/')

    // Benchmark 2: JSON Response
    allResults.json = await runScenario('Benchmark 2: JSON Response', {
        roach: (app) => {
            app.get('/json', (req, res) => {
                res.json({ message: 'Hello World', timestamp: Date.now() })
            })
        },
        fastify: (app) => {
            app.get('/json', (req, reply) => {
                reply.send({ message: 'Hello World', timestamp: Date.now() })
            })
        },
        express: (app) => {
            app.get('/json', (req, res) => {
                res.json({ message: 'Hello World', timestamp: Date.now() })
            })
        }
    }, '/json')

    // Benchmark 3: Route Params + Body Parsing
    allResults.paramsBody = await runScenario('Benchmark 3: Route Params + Body Parsing', {
        roach: (app) => {
            app.post('/users/:id', (req, res) => {
                const { id } = req.params
                const body = req.body
                res.json({ id, ...body })
            })
        },
        fastify: (app) => {
            app.post('/users/:id', (req, reply) => {
                const { id } = req.params
                const body = req.body
                reply.send({ id, ...body })
            })
        },
        express: (app, express) => {
            app.use(express.json())
            app.post('/users/:id', (req, res) => {
                const { id } = req.params
                const body = req.body
                res.json({ id, ...body })
            })
        }
    }, '/users/42', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Joey', role: 'roach' })
    })

    // Benchmark 4: Middleware Chain
    allResults.middleware = await runScenario('Benchmark 4: Middleware Chain', {
        roach: (app) => {
            const mw = (req, res, next) => { req.headers['x-test'] = 'true'; next() }
            app.use(mw)
            app.use(mw)
            app.use(mw)
            app.get('/middleware', (req, res) => res.send('done'))
        },
        fastify: (app) => {
            app.addHook('onRequest', async (req) => { req.headers['x-test'] = 'true' })
            app.addHook('onRequest', async (req) => { req.headers['x-test'] = 'true' })
            app.addHook('onRequest', async (req) => { req.headers['x-test'] = 'true' })
            app.get('/middleware', (req, reply) => reply.send('done'))
        },
        express: (app) => {
            const mw = (req, res, next) => { req.headers['x-test'] = 'true'; next() }
            app.use(mw)
            app.use(mw)
            app.use(mw)
            app.get('/middleware', (req, res) => res.send('done'))
        }
    }, '/middleware')

    // Summary
    console.log(`\n${'═'.repeat(50)}`)
    console.log('  SUMMARY')
    console.log(`${'═'.repeat(50)}`)

    const scenarios = [
        ['Hello World', allResults.helloWorld],
        ['JSON Response', allResults.json],
        ['Params + Body', allResults.paramsBody],
        ['Middleware', allResults.middleware]
    ]

    for (const [name, data] of scenarios) {
        const r = data.roachjs?.requestsPerSec || 0
        const f = data.fastify?.requestsPerSec || 0
        const e = data.express?.requestsPerSec || 0
        const vsF = f > 0 ? (r / f).toFixed(1) : 'N/A'
        const vsE = e > 0 ? (r / e).toFixed(1) : 'N/A'
        console.log(`  ${name.padEnd(16)} RoachJS: ${fmt(r).padStart(8)} | ${vsF}x Fastify | ${vsE}x Express`)
    }

    allResults.timestamp = new Date().toISOString()

    const resultsPath = join(__dirname, 'results.json')
    writeFileSync(resultsPath, JSON.stringify(allResults, null, 2))
    console.log(`\nResults saved to ${resultsPath}`)
    console.log('Run "npm run benchmark:svg" to generate SVG charts.')
}

main().catch(console.error)
