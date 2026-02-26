/**
 * @description Comprehensive tests for the RoachJS Radix Tree router.
 * Covers static routes, parametric routes, wildcards, route conflicts,
 * edge splitting, multiple methods, and not-found scenarios.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Router } from '../src/router.js'

const noop = () => { }

describe('Router', () => {

    describe('static routes', () => {
        it('should match a simple root route', () => {
            const router = new Router()
            router.add('GET', '/', [], noop)
            const result = router.find('GET', '/')
            assert.ok(result)
            assert.strictEqual(result.handler, noop)
            assert.deepStrictEqual(result.params, {})
        })

        it('should match a simple path', () => {
            const router = new Router()
            const handler = () => 'users'
            router.add('GET', '/users', [], handler)
            const result = router.find('GET', '/users')
            assert.ok(result)
            assert.strictEqual(result.handler, handler)
        })

        it('should match deeply nested static paths', () => {
            const router = new Router()
            const handler = () => 'deep'
            router.add('GET', '/a/b/c/d/e', [], handler)
            const result = router.find('GET', '/a/b/c/d/e')
            assert.ok(result)
            assert.strictEqual(result.handler, handler)
        })

        it('should differentiate between similar static paths', () => {
            const router = new Router()
            const h1 = () => 'users'
            const h2 = () => 'userSettings'
            router.add('GET', '/users', [], h1)
            router.add('GET', '/user-settings', [], h2)

            assert.strictEqual(router.find('GET', '/users').handler, h1)
            assert.strictEqual(router.find('GET', '/user-settings').handler, h2)
        })

        it('should return null for non-existent routes', () => {
            const router = new Router()
            router.add('GET', '/users', [], noop)
            assert.strictEqual(router.find('GET', '/posts'), null)
        })

        it('should be case-insensitive for HTTP methods', () => {
            const router = new Router()
            router.add('get', '/test', [], noop)
            assert.ok(router.find('GET', '/test'))
        })

        it('should handle routes with shared prefixes via edge splitting', () => {
            const router = new Router()
            const h1 = () => 'api'
            const h2 = () => 'app'
            const h3 = () => 'apply'

            router.add('GET', '/api', [], h1)
            router.add('GET', '/app', [], h2)
            router.add('GET', '/apply', [], h3)

            assert.strictEqual(router.find('GET', '/api').handler, h1)
            assert.strictEqual(router.find('GET', '/app').handler, h2)
            assert.strictEqual(router.find('GET', '/apply').handler, h3)
        })
    })

    describe('parametric routes', () => {
        it('should match a single parameter', () => {
            const router = new Router()
            router.add('GET', '/users/:id', [], noop)
            const result = router.find('GET', '/users/42')
            assert.ok(result)
            assert.strictEqual(result.params.id, '42')
        })

        it('should match multiple parameters', () => {
            const router = new Router()
            router.add('GET', '/users/:userId/posts/:postId', [], noop)
            const result = router.find('GET', '/users/7/posts/99')
            assert.ok(result)
            assert.strictEqual(result.params.userId, '7')
            assert.strictEqual(result.params.postId, '99')
        })

        it('should coexist with static routes at the same level', () => {
            const router = new Router()
            const staticHandler = () => 'static'
            const paramHandler = () => 'param'

            router.add('GET', '/users/me', [], staticHandler)
            router.add('GET', '/users/:id', [], paramHandler)

            assert.strictEqual(router.find('GET', '/users/me').handler, staticHandler)
            assert.strictEqual(router.find('GET', '/users/42').handler, paramHandler)
            assert.strictEqual(router.find('GET', '/users/42').params.id, '42')
        })

        it('should prefer static matches over parametric', () => {
            const router = new Router()
            const staticHandler = () => 'static'
            const paramHandler = () => 'param'

            router.add('GET', '/files/readme', [], staticHandler)
            router.add('GET', '/files/:name', [], paramHandler)

            assert.strictEqual(router.find('GET', '/files/readme').handler, staticHandler)
            assert.strictEqual(router.find('GET', '/files/other').handler, paramHandler)
        })
    })

    describe('wildcard routes', () => {
        it('should match a wildcard route', () => {
            const router = new Router()
            router.add('GET', '/files/*', [], noop)
            const result = router.find('GET', '/files/docs/readme.md')
            assert.ok(result)
            assert.strictEqual(result.params['*'], 'docs/readme.md')
        })

        it('should match a wildcard with a single segment', () => {
            const router = new Router()
            router.add('GET', '/static/*', [], noop)
            const result = router.find('GET', '/static/style.css')
            assert.ok(result)
            assert.strictEqual(result.params['*'], 'style.css')
        })

        it('should prefer static and parametric over wildcard', () => {
            const router = new Router()
            const staticH = () => 'static'
            const wildcardH = () => 'wildcard'

            router.add('GET', '/assets/logo.png', [], staticH)
            router.add('GET', '/assets/*', [], wildcardH)

            assert.strictEqual(router.find('GET', '/assets/logo.png').handler, staticH)
            assert.strictEqual(router.find('GET', '/assets/other/thing.js').handler, wildcardH)
        })
    })

    describe('multiple HTTP methods', () => {
        it('should register and match different methods on the same path', () => {
            const router = new Router()
            const getH = () => 'get'
            const postH = () => 'post'
            const putH = () => 'put'

            router.add('GET', '/users', [], getH)
            router.add('POST', '/users', [], postH)
            router.add('PUT', '/users', [], putH)

            assert.strictEqual(router.find('GET', '/users').handler, getH)
            assert.strictEqual(router.find('POST', '/users').handler, postH)
            assert.strictEqual(router.find('PUT', '/users').handler, putH)
        })

        it('should return null for unregistered methods on existing paths', () => {
            const router = new Router()
            router.add('GET', '/users', [], noop)
            assert.strictEqual(router.find('DELETE', '/users'), null)
        })
    })

    describe('route conflicts', () => {
        it('should throw on duplicate static routes', () => {
            const router = new Router()
            router.add('GET', '/users', [], noop)
            assert.throws(() => router.add('GET', '/users', [], noop), {
                name: 'RouteConflictError'
            })
        })

        it('should allow same path with different methods', () => {
            const router = new Router()
            router.add('GET', '/users', [], noop)
            assert.doesNotThrow(() => router.add('POST', '/users', [], noop))
        })
    })

    describe('route validation', () => {
        it('should throw if route does not start with /', () => {
            const router = new Router()
            assert.throws(() => router.add('GET', 'users', [], noop), {
                name: 'InvalidRouteError'
            })
        })

        it('should throw if parameter name is empty', () => {
            const router = new Router()
            assert.throws(() => router.add('GET', '/users/:', [], noop), {
                name: 'InvalidRouteError'
            })
        })

        it('should throw if wildcard is not the last segment', () => {
            const router = new Router()
            assert.throws(() => router.add('GET', '/files/*/other', [], noop), {
                name: 'InvalidRouteError'
            })
        })
    })

    describe('middleware storage', () => {
        it('should store and return route-level middleware', () => {
            const router = new Router()
            const mw1 = () => { }
            const mw2 = () => { }
            router.add('GET', '/protected', [mw1, mw2], noop)

            const result = router.find('GET', '/protected')
            assert.ok(result)
            assert.strictEqual(result.middleware.length, 2)
            assert.strictEqual(result.middleware[0], mw1)
            assert.strictEqual(result.middleware[1], mw2)
        })
    })

    describe('edge cases', () => {
        it('should handle root path with trailing content', () => {
            const router = new Router()
            router.add('GET', '/', [], noop)
            assert.strictEqual(router.find('GET', '/other'), null)
        })

        it('should handle many routes without degradation', () => {
            const router = new Router()
            for (let i = 0; i < 1000; i++) {
                router.add('GET', `/route${i}`, [], noop)
            }
            assert.ok(router.find('GET', '/route500'))
            assert.ok(router.find('GET', '/route999'))
            assert.strictEqual(router.find('GET', '/route1000'), null)
        })

        it('should handle parameter values with special characters', () => {
            const router = new Router()
            router.add('GET', '/users/:id', [], noop)
            const result = router.find('GET', '/users/hello-world_123')
            assert.ok(result)
            assert.strictEqual(result.params.id, 'hello-world_123')
        })
    })
})
