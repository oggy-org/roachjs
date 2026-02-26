/**
 * @description Tests for the RoachJS request wrapper.
 * Tests lazy query parsing, body parsing, header access, and params.
 * Uses mocked uWS objects since we're testing the wrapper in isolation.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequest } from '../src/request.js'

/**
 * @description Create a mock uWS request object for testing.
 */
function mockUReq(opts = {}) {
    const method = (opts.method || 'GET').toLowerCase()
    const url = opts.url || '/'
    const query = opts.query || ''
    const headers = opts.headers || {}

    return {
        getMethod: () => method,
        getUrl: () => url,
        getQuery: () => query,
        forEach: (cb) => {
            for (const [key, value] of Object.entries(headers)) {
                cb(key.toLowerCase(), value)
            }
        }
    }
}

/**
 * @description Create a mock uWS response object for testing.
 */
function mockURes() {
    return {
        getRemoteAddressAsText: () => new TextEncoder().encode('127.0.0.1')
    }
}

describe('Request', () => {

    describe('basic properties', () => {
        it('should expose HTTP method as uppercase', () => {
            const req = createRequest(mockUReq({ method: 'post' }), mockURes(), {}, null)
            assert.strictEqual(req.method, 'POST')
        })

        it('should expose URL path', () => {
            const req = createRequest(mockUReq({ url: '/users/42' }), mockURes(), {}, null)
            assert.strictEqual(req.path, '/users/42')
        })

        it('should expose route params', () => {
            const params = { id: '42', name: 'joey' }
            const req = createRequest(mockUReq(), mockURes(), params, null)
            assert.deepStrictEqual(req.params, params)
        })

        it('should default params to empty object', () => {
            const req = createRequest(mockUReq(), mockURes(), {}, null)
            assert.deepStrictEqual(req.params, {})
        })
    })

    describe('headers', () => {
        it('should expose request headers', () => {
            const req = createRequest(
                mockUReq({ headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer xyz' } }),
                mockURes(), {}, null
            )
            assert.strictEqual(req.headers['content-type'], 'application/json')
            assert.strictEqual(req.headers['authorization'], 'Bearer xyz')
        })

        it('should get individual headers via req.get()', () => {
            const req = createRequest(
                mockUReq({ headers: { 'X-Custom': 'hello' } }),
                mockURes(), {}, null
            )
            assert.strictEqual(req.get('x-custom'), 'hello')
        })

        it('should return undefined for missing headers', () => {
            const req = createRequest(mockUReq(), mockURes(), {}, null)
            assert.strictEqual(req.get('x-nonexistent'), undefined)
        })
    })

    describe('query parsing (lazy)', () => {
        it('should parse query string on first access', () => {
            const req = createRequest(
                mockUReq({ query: 'page=1&limit=20' }),
                mockURes(), {}, null
            )
            assert.deepStrictEqual(req.query, { page: '1', limit: '20' })
        })

        it('should handle URL-encoded values', () => {
            const req = createRequest(
                mockUReq({ query: 'q=hello%20world&tag=foo%26bar' }),
                mockURes(), {}, null
            )
            assert.strictEqual(req.query.q, 'hello world')
            assert.strictEqual(req.query.tag, 'foo&bar')
        })

        it('should return empty object for no query string', () => {
            const req = createRequest(mockUReq({ query: '' }), mockURes(), {}, null)
            assert.deepStrictEqual(req.query, {})
        })

        it('should handle keys without values', () => {
            const req = createRequest(
                mockUReq({ query: 'flag&verbose' }),
                mockURes(), {}, null
            )
            assert.strictEqual(req.query.flag, '')
            assert.strictEqual(req.query.verbose, '')
        })

        it('should cache parsed query across multiple accesses', () => {
            const req = createRequest(
                mockUReq({ query: 'x=1' }),
                mockURes(), {}, null
            )
            const first = req.query
            const second = req.query
            assert.strictEqual(first, second)
        })
    })

    describe('body parsing (lazy)', () => {
        it('should parse JSON body when content-type is application/json', () => {
            const body = JSON.stringify({ name: 'Joey', speed: 'fast' })
            const req = createRequest(
                mockUReq({ method: 'POST', headers: { 'Content-Type': 'application/json' } }),
                mockURes(), {}, Buffer.from(body)
            )
            assert.deepStrictEqual(req.body, { name: 'Joey', speed: 'fast' })
        })

        it('should return raw string for non-JSON content-type', () => {
            const req = createRequest(
                mockUReq({ method: 'POST', headers: { 'Content-Type': 'text/plain' } }),
                mockURes(), {}, Buffer.from('hello world')
            )
            assert.strictEqual(req.body, 'hello world')
        })

        it('should return undefined when no body is present', () => {
            const req = createRequest(mockUReq(), mockURes(), {}, null)
            assert.strictEqual(req.body, undefined)
        })

        it('should return undefined for empty body buffer', () => {
            const req = createRequest(mockUReq(), mockURes(), {}, Buffer.alloc(0))
            assert.strictEqual(req.body, undefined)
        })

        it('should throw BodyParseError for invalid JSON', () => {
            const req = createRequest(
                mockUReq({ headers: { 'Content-Type': 'application/json' } }),
                mockURes(), {}, Buffer.from('not valid json{{{')
            )
            assert.throws(() => req.body, { name: 'BodyParseError' })
        })

        it('should cache parsed body across multiple accesses', () => {
            const body = JSON.stringify({ id: 1 })
            const req = createRequest(
                mockUReq({ headers: { 'Content-Type': 'application/json' } }),
                mockURes(), {}, Buffer.from(body)
            )
            const first = req.body
            const second = req.body
            assert.strictEqual(first, second)
        })
    })

    describe('rawBody', () => {
        it('should expose the raw body buffer', () => {
            const buf = Buffer.from('raw data')
            const req = createRequest(mockUReq(), mockURes(), {}, buf)
            assert.ok(Buffer.isBuffer(req.rawBody))
            assert.strictEqual(req.rawBody.toString(), 'raw data')
        })

        it('should be null when no body is present', () => {
            const req = createRequest(mockUReq(), mockURes(), {}, null)
            assert.strictEqual(req.rawBody, null)
        })
    })
})
