/**
 * @description Tests for the RoachJS middleware chain handler.
 * Covers global middleware, scoped middleware, route-level middleware,
 * chain execution order, error propagation via next(err), and async support.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MiddlewareChain } from '../src/middleware.js'

/**
 * @description Create a minimal mock response.
 */
function mockRes() {
    return {
        sent: false,
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this },
        json(data) { this.body = data; this.sent = true },
        send(data) { this.body = data; this.sent = true }
    }
}

describe('MiddlewareChain', () => {

    describe('adding middleware', () => {
        it('should add global middleware', () => {
            const chain = new MiddlewareChain()
            chain.add(null, () => { })
            assert.strictEqual(chain.layers.length, 1)
            assert.strictEqual(chain.layers[0].path, null)
        })

        it('should add scoped middleware', () => {
            const chain = new MiddlewareChain()
            chain.add('/api', () => { })
            assert.strictEqual(chain.layers.length, 1)
            assert.strictEqual(chain.layers[0].path, '/api')
        })

        it('should normalize paths by adding leading slash', () => {
            const chain = new MiddlewareChain()
            chain.add('api', () => { })
            assert.strictEqual(chain.layers[0].path, '/api')
        })

        it('should strip trailing slash from path', () => {
            const chain = new MiddlewareChain()
            chain.add('/api/', () => { })
            assert.strictEqual(chain.layers[0].path, '/api')
        })
    })

    describe('resolving middleware', () => {
        it('should resolve global middleware for any path', () => {
            const chain = new MiddlewareChain()
            const mw = () => { }
            chain.add(null, mw)

            const result = chain.resolve('/anything')
            assert.strictEqual(result.length, 1)
            assert.strictEqual(result[0], mw)
        })

        it('should resolve scoped middleware only for matching paths', () => {
            const chain = new MiddlewareChain()
            const apiMw = () => { }
            chain.add('/api', apiMw)

            assert.strictEqual(chain.resolve('/api/users').length, 1)
            assert.strictEqual(chain.resolve('/api').length, 1)
            assert.strictEqual(chain.resolve('/other').length, 0)
        })

        it('should not match partial path prefixes', () => {
            const chain = new MiddlewareChain()
            chain.add('/api', () => { })

            assert.strictEqual(chain.resolve('/api-v2/thing').length, 0)
        })

        it('should append route-level middleware at the end', () => {
            const chain = new MiddlewareChain()
            const globalMw = () => { }
            const routeMw = () => { }
            chain.add(null, globalMw)

            const result = chain.resolve('/test', [routeMw])
            assert.strictEqual(result.length, 2)
            assert.strictEqual(result[0], globalMw)
            assert.strictEqual(result[1], routeMw)
        })

        it('should resolve in registration order', () => {
            const chain = new MiddlewareChain()
            const order = []
            chain.add(null, () => order.push(1))
            chain.add('/api', () => order.push(2))
            chain.add(null, () => order.push(3))

            const fns = chain.resolve('/api/test')
            assert.strictEqual(fns.length, 3)
            fns.forEach(fn => fn())
            assert.deepStrictEqual(order, [1, 2, 3])
        })
    })

    describe('executing middleware', () => {
        it('should execute middleware in order and call handler', () => {
            const chain = new MiddlewareChain()
            const order = []

            const fns = [
                (req, res, next) => { order.push('mw1'); next() },
                (req, res, next) => { order.push('mw2'); next() }
            ]

            const handler = (req, res) => { order.push('handler') }

            chain.execute(fns, {}, mockRes(), handler, () => { })
            assert.deepStrictEqual(order, ['mw1', 'mw2', 'handler'])
        })

        it('should stop chain if middleware does not call next()', () => {
            const chain = new MiddlewareChain()
            const order = []

            const fns = [
                (req, res, next) => { order.push('mw1') },
                (req, res, next) => { order.push('mw2'); next() }
            ]

            const handler = () => { order.push('handler') }
            chain.execute(fns, {}, mockRes(), handler, () => { })
            assert.deepStrictEqual(order, ['mw1'])
        })

        it('should stop chain if response is already sent', () => {
            const chain = new MiddlewareChain()
            const order = []
            const res = mockRes()

            const fns = [
                (req, res, next) => {
                    order.push('mw1')
                    res.send('early response')
                    next()
                },
                (req, res, next) => { order.push('mw2'); next() }
            ]

            chain.execute(fns, {}, res, () => { order.push('handler') }, () => { })
            assert.deepStrictEqual(order, ['mw1'])
        })

        it('should call handler when middleware array is empty', () => {
            const chain = new MiddlewareChain()
            const order = []

            chain.execute([], {}, mockRes(), () => { order.push('handler') }, () => { })
            assert.deepStrictEqual(order, ['handler'])
        })
    })

    describe('error propagation', () => {
        it('should invoke error handler when next(err) is called', () => {
            const chain = new MiddlewareChain()
            let capturedError = null
            const testError = new Error('test error')

            const fns = [
                (req, res, next) => next(testError)
            ]

            const errorHandler = (err) => { capturedError = err }
            chain.execute(fns, {}, mockRes(), () => { }, errorHandler)
            assert.strictEqual(capturedError, testError)
        })

        it('should skip remaining middleware on next(err)', () => {
            const chain = new MiddlewareChain()
            const order = []

            const fns = [
                (req, res, next) => { order.push('mw1'); next(new Error('fail')) },
                (req, res, next) => { order.push('mw2'); next() }
            ]

            chain.execute(fns, {}, mockRes(), () => { order.push('handler') }, () => { order.push('error') })
            assert.deepStrictEqual(order, ['mw1', 'error'])
        })

        it('should catch synchronous exceptions in middleware', () => {
            const chain = new MiddlewareChain()
            let capturedError = null

            const fns = [
                () => { throw new Error('sync boom') }
            ]

            chain.execute(fns, {}, mockRes(), () => { }, (err) => { capturedError = err })
            assert.strictEqual(capturedError.message, 'sync boom')
        })

        it('should catch synchronous exceptions in handler', () => {
            const chain = new MiddlewareChain()
            let capturedError = null

            const handler = () => { throw new Error('handler boom') }
            chain.execute([], {}, mockRes(), handler, (err) => { capturedError = err })
            assert.strictEqual(capturedError.message, 'handler boom')
        })

        it('should catch async errors in middleware', async () => {
            const chain = new MiddlewareChain()
            let capturedError = null

            const fns = [
                async (req, res, next) => {
                    throw new Error('async mw boom')
                }
            ]

            chain.execute(fns, {}, mockRes(), () => { }, (err) => { capturedError = err })

            await new Promise(resolve => setTimeout(resolve, 50))
            assert.strictEqual(capturedError.message, 'async mw boom')
        })

        it('should catch async errors in handler', async () => {
            const chain = new MiddlewareChain()
            let capturedError = null

            const handler = async () => {
                throw new Error('async handler boom')
            }

            chain.execute([], {}, mockRes(), handler, (err) => { capturedError = err })

            await new Promise(resolve => setTimeout(resolve, 50))
            assert.strictEqual(capturedError.message, 'async handler boom')
        })
    })
})
