/**
 * @module response
 * @description Response wrapper for RoachJS. Wraps the raw uWebSockets.js
 * response with a clean, chainable API. Guards against double-sends, sets
 * sensible defaults, and makes JSON responses effortless.
 *
 * The roaches deliver your response fast — but only once.
 */

import { ResponseAlreadySentError, debug } from './errors.js'

/**
 * @description Create a RoachJS response object wrapping a uWebSockets.js response.
 * Provides a familiar Express-like API with chainable methods and guards against
 * common mistakes like sending a response twice.
 *
 * @param {import('uWebSockets.js').HttpResponse} uRes - The raw uWS response
 * @returns {RoachResponse} The wrapped response object
 *
 * @example
 * const res = createResponse(uRes)
 * res.status(200).json({ hello: 'world' })
 */
export function createResponse(uRes) {
    let statusCode = 200
    let sent = false
    const responseHeaders = {}

    /**
     * @description Guard against writing to an already-finished response.
     * uWS will segfault if you try — the roaches prevent that.
     * @throws {ResponseAlreadySentError}
     */
    function assertNotSent() {
        if (sent) {
            throw new ResponseAlreadySentError()
        }
    }

    /**
     * @description Write all queued headers to the uWS response.
     * @param {import('uWebSockets.js').HttpResponse} uRes
     */
    function writeHeaders(uRes) {
        for (const [key, value] of Object.entries(responseHeaders)) {
            uRes.writeHeader(key, String(value))
        }
    }

    /**
     * @description Convert a numeric HTTP status code to its uWS status string.
     * uWS expects the full status line like "200 OK".
     * @param {number} code - HTTP status code
     * @returns {string} Status string like "200 OK"
     */
    function statusString(code) {
        return `${code} ${STATUS_CODES[code] || 'Unknown'}`
    }

    /** @type {RoachResponse} */
    const res = {
        /**
         * @description Whether the response has already been sent.
         * @type {boolean}
         */
        get sent() {
            return sent
        },

        /**
         * @description Set the HTTP status code. Chainable — returns the response
         * object so you can do res.status(201).json({ created: true }).
         *
         * @param {number} code - HTTP status code (100-599)
         * @returns {RoachResponse} This response object for chaining
         *
         * @example
         * res.status(404).json({ error: 'Not found' })
         */
        status(code) {
            statusCode = code
            return res
        },

        /**
         * @description Set a response header. Chainable.
         *
         * @param {string} name - Header name
         * @param {string} value - Header value
         * @returns {RoachResponse} This response object for chaining
         *
         * @example
         * res.set('X-Request-Id', '12345').json({ ok: true })
         */
        set(name, value) {
            responseHeaders[name.toLowerCase()] = value
            return res
        },

        /**
         * @description Set the Content-Type header. Chainable.
         *
         * @param {string} contentType - MIME type string
         * @returns {RoachResponse} This response object for chaining
         *
         * @example
         * res.type('text/html').send('<h1>Hello</h1>')
         */
        type(contentType) {
            responseHeaders['content-type'] = contentType
            return res
        },

        /**
         * @description Send a string or Buffer response body and end the response.
         * Sets Content-Type to text/plain if not already set.
         *
         * @param {string|Buffer} data - Response body
         * @returns {void}
         * @throws {ResponseAlreadySentError} If response was already sent
         *
         * @example
         * res.send('Hello from RoachJS!')
         * res.send(Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]))
         */
        send(data) {
            assertNotSent()
            sent = true

            if (!responseHeaders['content-type']) {
                responseHeaders['content-type'] = 'text/plain; charset=utf-8'
            }

            uRes.cork(() => {
                uRes.writeStatus(statusString(statusCode))
                writeHeaders(uRes)
                uRes.end(typeof data === 'string' ? data : data)
            })
        },

        /**
         * @description Send a JSON response. Serializes the object, sets the
         * Content-Type to application/json, and ends the response.
         *
         * @param {*} data - Data to serialize as JSON
         * @returns {void}
         * @throws {ResponseAlreadySentError} If response was already sent
         *
         * @example
         * res.json({ users: [{ id: 1, name: 'Joey' }] })
         * res.status(201).json({ created: true })
         */
        json(data) {
            assertNotSent()
            sent = true

            responseHeaders['content-type'] = 'application/json; charset=utf-8'
            const body = JSON.stringify(data)

            uRes.cork(() => {
                uRes.writeStatus(statusString(statusCode))
                writeHeaders(uRes)
                uRes.end(body)
            })
        },

        /**
         * @description Redirect the client to another URL. Defaults to 302 Found
         * unless a status code is explicitly provided.
         *
         * @param {string} url - Target URL to redirect to
         * @param {number} [code=302] - HTTP redirect status code (301, 302, 307, 308)
         * @returns {void}
         * @throws {ResponseAlreadySentError} If response was already sent
         *
         * @example
         * res.redirect('/login')
         * res.redirect('/new-location', 301)
         */
        redirect(url, code = 302) {
            assertNotSent()
            sent = true

            uRes.cork(() => {
                uRes.writeStatus(statusString(code))
                uRes.writeHeader('location', url)
                writeHeaders(uRes)
                uRes.end()
            })
        },

        /**
         * @description End the response with no body. Use this when you've set
         * headers/status but don't need to send any data.
         *
         * @returns {void}
         * @throws {ResponseAlreadySentError} If response was already sent
         *
         * @example
         * res.status(204).end()
         */
        end() {
            assertNotSent()
            sent = true

            uRes.cork(() => {
                uRes.writeStatus(statusString(statusCode))
                writeHeaders(uRes)
                uRes.end()
            })
        }
    }

    return res
}

/**
 * @description Standard HTTP status code to reason phrase mapping.
 * Used to construct the full status line that uWS expects.
 * @type {Object<number, string>}
 */
const STATUS_CODES = {
    100: 'Continue',
    101: 'Switching Protocols',
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    303: 'See Other',
    304: 'Not Modified',
    307: 'Temporary Redirect',
    308: 'Permanent Redirect',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    408: 'Request Timeout',
    409: 'Conflict',
    410: 'Gone',
    413: 'Payload Too Large',
    415: 'Unsupported Media Type',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout'
}

/**
 * @typedef {Object} RoachResponse
 * @property {boolean} sent - Whether the response has been sent
 * @property {function(number): RoachResponse} status - Set HTTP status code
 * @property {function(string, string): RoachResponse} set - Set response header
 * @property {function(string): RoachResponse} type - Set Content-Type
 * @property {function(string|Buffer): void} send - Send string/Buffer response
 * @property {function(*): void} json - Send JSON response
 * @property {function(string, number=): void} redirect - Redirect client
 * @property {function(): void} end - End response with no body
 */
