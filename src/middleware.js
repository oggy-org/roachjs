/**
 * @module middleware
 * @description Middleware chain handler for RoachJS. Composes middleware functions
 * into an execution chain that runs sequentially. Supports global, path-scoped,
 * and route-level middleware. Calling next() advances the chain. Calling next(err)
 * skips to the error handler. Lean and mean — minimal overhead per request.
 */

import { debug } from './errors.js'

/**
 * @description A middleware layer — a function with an optional path scope.
 * @typedef {Object} MiddlewareLayer
 * @property {string|null} path - Path prefix this middleware applies to (null = global)
 * @property {Function} fn - The middleware function (req, res, next)
 */

/**
 * @description Middleware manager. Stores middleware layers and provides
 * methods to compose and execute them for a given request.
 *
 * @example
 * const mw = new MiddlewareChain()
 * mw.add(null, (req, res, next) => { console.log('global'); next() })
 * mw.add('/api', (req, res, next) => { console.log('api only'); next() })
 */
export class MiddlewareChain {
    constructor() {
        /** @type {MiddlewareLayer[]} */
        this.layers = []
    }

    /**
     * @description Add a middleware function, optionally scoped to a path prefix.
     *
     * @param {string|null} path - Path prefix to scope this middleware to, or null for global
     * @param {Function} fn - Middleware function with signature (req, res, next)
     * @returns {void}
     *
     * @example
     * // Global middleware
     * chain.add(null, (req, res, next) => { next() })
     *
     * // Scoped to /api
     * chain.add('/api', (req, res, next) => { next() })
     */
    add(path, fn) {
        if (path && !path.startsWith('/')) {
            path = '/' + path
        }
        if (path && path.endsWith('/') && path.length > 1) {
            path = path.slice(0, -1)
        }
        this.layers.push({ path, fn })
        debug('middleware', `Added ${path ? `scoped [${path}]` : 'global'} middleware`)
    }

    /**
     * @description Build a flattened array of middleware functions that apply to
     * a given request path, combining global middleware, scoped middleware, and
     * any route-level middleware.
     *
     * @param {string} requestPath - The URL path of the current request
     * @param {Function[]} routeMiddleware - Route-level middleware from the route definition
     * @returns {Function[]} Ordered array of middleware functions to execute
     *
     * @example
     * const fns = chain.resolve('/api/users', [authMiddleware])
     * // Returns: [globalMw1, apiScopedMw, authMiddleware]
     */
    resolve(requestPath, routeMiddleware = []) {
        const applicable = []

        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i]

            if (layer.path === null) {
                applicable.push(layer.fn)
            } else if (requestPath === layer.path || requestPath.startsWith(layer.path + '/')) {
                applicable.push(layer.fn)
            }
        }

        for (let i = 0; i < routeMiddleware.length; i++) {
            applicable.push(routeMiddleware[i])
        }

        return applicable
    }

    /**
     * @description Execute a chain of middleware functions sequentially, followed
     * by the route handler. If any middleware calls next(err), the chain is
     * short-circuited and the error handler is invoked.
     *
     * @param {Function[]} middlewareFns - Ordered middleware functions to execute
     * @param {import('./request.js').RoachRequest} req - Request object
     * @param {import('./response.js').RoachResponse} res - Response object
     * @param {Function} handler - The final route handler to call after all middleware
     * @param {Function} errorHandler - Error handler to call if next(err) is invoked
     * @returns {void}
     *
     * @example
     * chain.execute(
     *   [logMiddleware, authMiddleware],
     *   req, res,
     *   (req, res) => res.json({ ok: true }),
     *   (err, req, res) => res.status(500).json({ error: err.message })
     * )
     */
    execute(middlewareFns, req, res, handler, errorHandler) {
        let idx = 0

        const next = (err) => {
            if (err) {
                debug('middleware', `Error in middleware chain: ${err.message}`)
                return errorHandler(err, req, res)
            }

            if (res.sent) {
                debug('middleware', 'Response already sent, stopping middleware chain')
                return
            }

            if (idx >= middlewareFns.length) {
                try {
                    const result = handler(req, res)
                    if (result && typeof result.catch === 'function') {
                        result.catch((asyncErr) => errorHandler(asyncErr, req, res))
                    }
                } catch (handlerErr) {
                    errorHandler(handlerErr, req, res)
                }
                return
            }

            const fn = middlewareFns[idx++]

            try {
                const result = fn(req, res, next)
                if (result && typeof result.catch === 'function') {
                    result.catch((asyncErr) => next(asyncErr))
                }
            } catch (mwErr) {
                next(mwErr)
            }
        }

        next()
    }
}
