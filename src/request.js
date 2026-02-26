/**
 * @module request
 * @description Lightweight request wrapper for RoachJS. Wraps the raw uWebSockets.js
 * request object into a friendly, familiar API. Query strings and body are parsed
 * lazily — only when you actually access them. No wasted CPU cycles on data you
 * don't need. The roaches are efficient like that.
 */

import { BodyParseError, debug } from './errors.js'

/**
 * @description Create a RoachJS request object from a uWebSockets.js request.
 * All expensive operations (query parsing, body parsing) are deferred until
 * the property is actually accessed via getters.
 *
 * @param {import('uWebSockets.js').HttpRequest} uReq - The raw uWS request
 * @param {import('uWebSockets.js').HttpResponse} uRes - The raw uWS response (needed for IP)
 * @param {Object<string, string>} params - Route parameters extracted by the router
 * @param {Buffer|null} bodyBuffer - Raw request body buffer, or null if no body
 * @returns {RoachRequest} The wrapped request object
 *
 * @example
 * const req = createRequest(uReq, uRes, { id: '42' }, bodyBuf)
 * req.method  // 'GET'
 * req.params  // { id: '42' }
 * req.query   // { page: '1' } (parsed lazily)
 */
export function createRequest(uReq, uRes, params, bodyBuffer) {
    const method = uReq.getMethod().toUpperCase()
    const fullUrl = uReq.getUrl()
    const queryString = uReq.getQuery() || ''

    const headers = {}
    uReq.forEach((key, value) => {
        headers[key] = value
    })

    let parsedQuery = null
    let parsedBody = undefined
    let bodyParsed = false

    const path = fullUrl.split('?')[0]

    /** @type {RoachRequest} */
    const req = {
        /** @type {string} HTTP method (GET, POST, PUT, etc.) */
        method,

        /** @type {string} URL path without query string */
        path,

        /** @type {string} Full URL including query string */
        url: queryString ? `${fullUrl}?${queryString}` : fullUrl,

        /** @type {Object<string, string>} Route parameters from path matching */
        params: params || {},

        /** @type {Object<string, string>} Request headers */
        headers,

        /** @type {Buffer|null} Raw body buffer */
        rawBody: bodyBuffer,

        /**
         * @description Parsed query string parameters. Lazily parsed on first access.
         * @type {Object<string, string>}
         */
        get query() {
            if (parsedQuery === null) {
                parsedQuery = parseQueryString(queryString)
                debug('request', `Parsed query string: ${JSON.stringify(parsedQuery)}`)
            }
            return parsedQuery
        },

        /**
         * @description Parsed request body. JSON is auto-parsed if Content-Type is
         * application/json. Lazily parsed on first access — no CPU wasted if you
         * don't read the body.
         * @type {*}
         */
        get body() {
            if (!bodyParsed) {
                bodyParsed = true
                if (bodyBuffer && bodyBuffer.length > 0) {
                    const contentType = headers['content-type'] || ''
                    if (contentType.includes('application/json')) {
                        try {
                            parsedBody = JSON.parse(bodyBuffer.toString('utf-8'))
                        } catch (err) {
                            throw new BodyParseError(err.message)
                        }
                    } else {
                        parsedBody = bodyBuffer.toString('utf-8')
                    }
                } else {
                    parsedBody = undefined
                }
            }
            return parsedBody
        },

        /**
         * @description Client IP address, extracted from the uWS response.
         * @type {string}
         */
        get ip() {
            try {
                const ipBuf = uRes.getRemoteAddressAsText()
                return Buffer.from(ipBuf).toString()
            } catch {
                return '0.0.0.0'
            }
        },

        /**
         * @description Get a specific header value by name (case-insensitive).
         *
         * @param {string} name - Header name
         * @returns {string|undefined} Header value, or undefined if not present
         *
         * @example
         * const auth = req.get('authorization')
         */
        get(name) {
            return headers[name.toLowerCase()]
        }
    }

    return req
}

/**
 * @description Parse a URL query string into a key-value object.
 * Handles URL-encoded values and multiple parameters.
 *
 * @param {string} queryString - Raw query string (without leading '?')
 * @returns {Object<string, string>} Parsed key-value pairs
 *
 * @example
 * parseQueryString('page=1&limit=20&q=hello%20world')
 * // => { page: '1', limit: '20', q: 'hello world' }
 */
function parseQueryString(queryString) {
    if (!queryString) return {}

    const result = {}
    const pairs = queryString.split('&')

    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i]
        const eqIdx = pair.indexOf('=')

        if (eqIdx === -1) {
            result[decodeURIComponent(pair)] = ''
        } else {
            const key = decodeURIComponent(pair.slice(0, eqIdx))
            const value = decodeURIComponent(pair.slice(eqIdx + 1))
            result[key] = value
        }
    }

    return result
}

/**
 * @typedef {Object} RoachRequest
 * @property {string} method - HTTP method
 * @property {string} path - URL path without query string
 * @property {string} url - Full URL including query string
 * @property {Object<string, string>} params - Route parameters
 * @property {Object<string, string>} headers - Request headers
 * @property {Object<string, string>} query - Parsed query parameters (lazy)
 * @property {*} body - Parsed request body (lazy)
 * @property {Buffer|null} rawBody - Raw body buffer
 * @property {string} ip - Client IP address
 * @property {function(string): string|undefined} get - Get header by name
 */
