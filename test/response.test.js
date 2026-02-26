/**
 * @description Tests for the RoachJS response wrapper.
 * Tests send, json, status chaining, set header, redirect, type,
 * and double-send guards. Uses mocked uWS response objects.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createResponse } from '../src/response.js'

/**
 * @description Create a mock uWS response for testing. Captures all
 * writes so we can assert on them.
 */
function mockURes() {
    const captured = {
        status: null,
        headers: {},
        body: null,
        ended: false
    }

    const res = {
        _captured: captured,
        cork: (fn) => fn(),
        writeStatus: (status) => { captured.status = status },
        writeHeader: (key, value) => { captured.headers[key] = value },
        end: (body) => {
            captured.body = body || null
            captured.ended = true
        }
    }

    return res
}

describe('Response', () => {

    describe('res.send()', () => {
        it('should send a string body', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.send('Hello from RoachJS!')

            assert.strictEqual(uRes._captured.body, 'Hello from RoachJS!')
            assert.strictEqual(uRes._captured.status, '200 OK')
            assert.strictEqual(uRes._captured.headers['content-type'], 'text/plain; charset=utf-8')
            assert.strictEqual(uRes._captured.ended, true)
        })

        it('should send a Buffer body', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            const buf = Buffer.from('binary data')
            res.send(buf)

            assert.strictEqual(uRes._captured.body, buf)
            assert.strictEqual(uRes._captured.ended, true)
        })

        it('should not override existing content-type', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.type('text/html').send('<h1>Hello</h1>')

            assert.strictEqual(uRes._captured.headers['content-type'], 'text/html')
        })
    })

    describe('res.json()', () => {
        it('should send a JSON response', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.json({ hello: 'world' })

            assert.strictEqual(uRes._captured.body, '{"hello":"world"}')
            assert.strictEqual(uRes._captured.headers['content-type'], 'application/json; charset=utf-8')
            assert.strictEqual(uRes._captured.status, '200 OK')
        })

        it('should handle arrays', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.json([1, 2, 3])

            assert.strictEqual(uRes._captured.body, '[1,2,3]')
        })

        it('should handle null', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.json(null)

            assert.strictEqual(uRes._captured.body, 'null')
        })
    })

    describe('res.status()', () => {
        it('should set the status code', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.status(201).json({ created: true })

            assert.strictEqual(uRes._captured.status, '201 Created')
        })

        it('should be chainable', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            const result = res.status(404)

            assert.strictEqual(result, res)
        })

        it('should handle various status codes', () => {
            const codes = [
                [200, '200 OK'],
                [201, '201 Created'],
                [204, '204 No Content'],
                [301, '301 Moved Permanently'],
                [400, '400 Bad Request'],
                [401, '401 Unauthorized'],
                [403, '403 Forbidden'],
                [404, '404 Not Found'],
                [500, '500 Internal Server Error']
            ]

            for (const [code, expected] of codes) {
                const uRes = mockURes()
                const res = createResponse(uRes)
                res.status(code).end()
                assert.strictEqual(uRes._captured.status, expected)
            }
        })
    })

    describe('res.set()', () => {
        it('should set a response header', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.set('X-Request-Id', '12345').send('ok')

            assert.strictEqual(uRes._captured.headers['x-request-id'], '12345')
        })

        it('should be chainable', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            const result = res.set('X-Foo', 'bar')
            assert.strictEqual(result, res)
        })

        it('should handle multiple headers', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.set('X-One', '1').set('X-Two', '2').send('ok')

            assert.strictEqual(uRes._captured.headers['x-one'], '1')
            assert.strictEqual(uRes._captured.headers['x-two'], '2')
        })
    })

    describe('res.type()', () => {
        it('should set the content-type header', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.type('text/html').send('<h1>Hello</h1>')

            assert.strictEqual(uRes._captured.headers['content-type'], 'text/html')
        })
    })

    describe('res.redirect()', () => {
        it('should redirect with 302 by default', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.redirect('/login')

            assert.strictEqual(uRes._captured.status, '302 Found')
            assert.strictEqual(uRes._captured.headers['location'], '/login')
            assert.strictEqual(uRes._captured.ended, true)
        })

        it('should redirect with custom status code', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.redirect('/new-location', 301)

            assert.strictEqual(uRes._captured.status, '301 Moved Permanently')
            assert.strictEqual(uRes._captured.headers['location'], '/new-location')
        })
    })

    describe('res.end()', () => {
        it('should end the response with no body', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.status(204).end()

            assert.strictEqual(uRes._captured.status, '204 No Content')
            assert.strictEqual(uRes._captured.body, null)
            assert.strictEqual(uRes._captured.ended, true)
        })
    })

    describe('double-send guard', () => {
        it('should throw ResponseAlreadySentError on double send()', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.send('first')

            assert.throws(() => res.send('second'), {
                name: 'ResponseAlreadySentError'
            })
        })

        it('should throw on send() after json()', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.json({ first: true })

            assert.throws(() => res.send('second'), {
                name: 'ResponseAlreadySentError'
            })
        })

        it('should throw on json() after end()', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.end()

            assert.throws(() => res.json({ nope: true }), {
                name: 'ResponseAlreadySentError'
            })
        })

        it('should throw on redirect() after send()', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)
            res.send('done')

            assert.throws(() => res.redirect('/nope'), {
                name: 'ResponseAlreadySentError'
            })
        })

        it('should report sent status correctly', () => {
            const uRes = mockURes()
            const res = createResponse(uRes)

            assert.strictEqual(res.sent, false)
            res.send('done')
            assert.strictEqual(res.sent, true)
        })
    })
})
