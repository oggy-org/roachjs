/**
 * @module index
 * @description Main entry point for RoachJS — the fastest, simplest HTTP framework
 * for Node.js. Creates the application factory, wires together the router, middleware
 * chain, request/response wrappers, and uWebSockets.js server.
 *
 * Named after the cockroaches from Oggy and the Cockroaches — fast, resilient,
 * and impossible to catch.
 *
 * @example
 * import roach from '@oggy-org/roachjs'
 *
 * const app = roach()
 * app.get('/', (req, res) => res.send('Hello from RoachJS!'))
 * app.listen(3000, () => console.log('RoachJS running on port 3000'))
 */

import uWS from 'uWebSockets.js'
import { Router } from './router.js'
import { createRequest } from './request.js'
import { createResponse } from './response.js'
import { MiddlewareChain } from './middleware.js'
import { debug, RoachError } from './errors.js'

/** @type {string[]} Supported HTTP methods */
const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head']

/**
 * @description Create a new RoachJS application instance. This is the main factory
 * function — call it to get a fully configured app with routing, middleware, and
 * server lifecycle management.
 *
 * @returns {RoachApp} A new RoachJS application
 *
 * @example
 * import roach from '@oggy-org/roachjs'
 *
 * const app = roach()
 *
 * app.get('/', (req, res) => {
 *   res.send('Hello from RoachJS!')
 * })
 *
 * app.post('/users', (req, res) => {
 *   res.status(201).json({ created: true, data: req.body })
 * })
 *
 * app.listen(3000, () => {
 *   console.log('RoachJS running on port 3000')
 * })
 */
function roach() {
    const router = new Router()
    const middlewareChain = new MiddlewareChain()
    const subRouters = []
    let listenSocket = null

    let errorHandler = defaultErrorHandler
    let notFoundHandler = defaultNotFoundHandler

    /**
     * @description Default error handler. Sends a JSON error response with
     * the error's status code and message.
     * @param {Error} err - The error that occurred
     * @param {import('./request.js').RoachRequest} req - Request object
     * @param {import('./response.js').RoachResponse} res - Response object
     */
    function defaultErrorHandler(err, req, res) {
        debug('error', `${err.name || 'Error'}: ${err.message}`)
        const statusCode = err.statusCode || 500
        if (!res.sent) {
            res.status(statusCode).json({
                error: err.message || 'Something exploded. Check your error handler.'
            })
        }
    }

    /**
     * @description Default not-found handler. Sends a 404 JSON response.
     * The cockroaches checked everywhere — route not found.
     * @param {import('./request.js').RoachRequest} req - Request object
     * @param {import('./response.js').RoachResponse} res - Response object
     */
    function defaultNotFoundHandler(req, res) {
        res.status(404).json({
            error: `Route not found: ${req.method} ${req.path}. The cockroaches checked everywhere.`
        })
    }

    /**
     * @description Read the full request body from a uWS response stream.
     * Collects all chunks into a single buffer.
     *
     * @param {import('uWebSockets.js').HttpResponse} uRes - The uWS response (which is also the readable stream)
     * @returns {Promise<Buffer>} The complete request body as a Buffer
     */
    function readBody(uRes) {
        return new Promise((resolve, reject) => {
            const chunks = []
            uRes.onData((chunk, isLast) => {
                chunks.push(Buffer.from(chunk))
                if (isLast) {
                    resolve(Buffer.concat(chunks))
                }
            })
            uRes.onAborted(() => {
                reject(new RoachError('Request aborted by client', 499, 'REQUEST_ABORTED'))
            })
        })
    }

    /**
     * @description Core request handler. Called for every incoming HTTP request.
     * Reads the body (if present), creates req/res wrappers, resolves matching
     * route, runs middleware chain, and invokes the handler.
     *
     * @param {string} method - HTTP method
     * @param {import('uWebSockets.js').HttpResponse} uRes - Raw uWS response
     * @param {import('uWebSockets.js').HttpRequest} uReq - Raw uWS request
     * @returns {void}
     */
    function handleRequest(method, uRes, uReq) {
        const url = uReq.getUrl()
        const query = uReq.getQuery()

        let aborted = false
        uRes.onAborted(() => {
            aborted = true
        })

        const resolvedPath = url.split('?')[0]
        const upperMethod = method.toUpperCase()

        let route = router.find(upperMethod, resolvedPath)

        if (!route) {
            for (const sub of subRouters) {
                if (resolvedPath === sub.prefix || resolvedPath.startsWith(sub.prefix + '/')) {
                    const subPath = resolvedPath.slice(sub.prefix.length) || '/'
                    route = sub.router.find(upperMethod, subPath)
                    if (route) break
                }
            }
        }

        const processRequest = (bodyBuffer) => {
            if (aborted) return

            const req = createRequest(uReq, uRes, route ? route.params : {}, bodyBuffer)
            const res = createResponse(uRes)

            if (!route) {
                const notFoundMw = middlewareChain.resolve(resolvedPath, [])
                if (notFoundMw.length > 0) {
                    middlewareChain.execute(notFoundMw, req, res, () => notFoundHandler(req, res), errorHandler)
                } else {
                    notFoundHandler(req, res)
                }
                return
            }

            const middlewareFns = middlewareChain.resolve(resolvedPath, route.middleware)
            middlewareChain.execute(middlewareFns, req, res, route.handler, errorHandler)
        }

        if (upperMethod === 'GET' || upperMethod === 'HEAD' || upperMethod === 'OPTIONS') {
            processRequest(null)
        } else {
            readBody(uRes).then(processRequest).catch((err) => {
                if (!aborted) {
                    const res = createResponse(uRes)
                    errorHandler(err, { method: upperMethod, path: resolvedPath, params: {}, query: {}, headers: {}, body: null }, res)
                }
            })
        }
    }

    /** @type {RoachApp} */
    const app = {
        /**
         * @description Register a middleware function. Can be called with just a function
         * (global middleware), with a path prefix and function (scoped middleware), or
         * with a path prefix and a sub-router.
         *
         * @param {string|Function} pathOrFn - Path prefix or middleware function
         * @param {Function|RoachRouter} [fn] - Middleware function or sub-router
         * @returns {RoachApp} This app for chaining
         *
         * @example
         * // Global middleware
         * app.use((req, res, next) => { console.log(req.method); next() })
         *
         * // Scoped middleware
         * app.use('/api', (req, res, next) => { next() })
         *
         * // Sub-router
         * const api = roach.router()
         * api.get('/ping', (req, res) => res.send('pong'))
         * app.use('/api', api)
         */
        use(pathOrFn, fn) {
            if (typeof pathOrFn === 'function') {
                middlewareChain.add(null, pathOrFn)
            } else if (typeof pathOrFn === 'string' && fn) {
                if (fn._isRoachRouter) {
                    let prefix = pathOrFn
                    if (prefix.endsWith('/') && prefix.length > 1) {
                        prefix = prefix.slice(0, -1)
                    }
                    subRouters.push({ prefix, router: fn._router })
                    debug('app', `Mounted sub-router at ${prefix}`)
                } else {
                    middlewareChain.add(pathOrFn, fn)
                }
            }
            return app
        },

        /**
         * @description Register a route that matches all HTTP methods.
         *
         * @param {string} path - Route path pattern
         * @param {...Function} handlers - Middleware and handler functions (last one is the handler)
         * @returns {RoachApp} This app for chaining
         *
         * @example
         * app.all('/health', (req, res) => res.send('OK'))
         */
        all(path, ...handlers) {
            const handler = handlers.pop()
            const middleware = handlers
            for (const method of HTTP_METHODS) {
                router.add(method.toUpperCase(), path, middleware, handler)
            }
            return app
        },

        /**
         * @description Set a custom error handler. Receives (err, req, res).
         *
         * @param {Function} handler - Error handler function
         * @returns {RoachApp} This app for chaining
         *
         * @example
         * app.onError((err, req, res) => {
         *   res.status(500).json({ error: err.message })
         * })
         */
        onError(handler) {
            errorHandler = handler
            return app
        },

        /**
         * @description Set a custom not-found handler. Called when no route matches.
         *
         * @param {Function} handler - Not-found handler function
         * @returns {RoachApp} This app for chaining
         *
         * @example
         * app.onNotFound((req, res) => {
         *   res.status(404).json({ error: 'Route not found' })
         * })
         */
        onNotFound(handler) {
            notFoundHandler = handler
            return app
        },

        /**
         * @description Start the HTTP server on the specified port.
         *
         * @param {number} port - Port number to listen on
         * @param {Function} [callback] - Called once the server is listening
         * @returns {RoachApp} This app for chaining
         *
         * @example
         * app.listen(3000, () => {
         *   console.log('RoachJS running on port 3000')
         * })
         */
        listen(port, callback) {
            const uwsApp = uWS.App()

            uwsApp.any('/*', (uRes, uReq) => {
                const method = uReq.getMethod().toUpperCase()
                handleRequest(method, uRes, uReq)
            })

            uwsApp.listen(port, (token) => {
                if (token) {
                    listenSocket = token
                    debug('app', `Listening on port ${port}`)
                    if (callback) callback()
                } else {
                    throw new RoachError(
                        `Failed to listen on port ${port}. Is the port already in use? ` +
                        `Check if another process is using it: lsof -i :${port}`,
                        500,
                        'LISTEN_FAILED'
                    )
                }
            })

            return app
        },

        /**
         * @description Stop the HTTP server and release the port.
         *
         * @returns {void}
         *
         * @example
         * app.close()
         */
        close() {
            if (listenSocket) {
                uWS.us_listen_socket_close(listenSocket)
                listenSocket = null
                debug('app', 'Server closed')
            }
        }
    }

    for (const method of HTTP_METHODS) {
        /**
         * @description Register a route for a specific HTTP method.
         * Extra arguments before the last one are treated as route-level middleware.
         *
         * @param {string} path - Route path pattern
         * @param {...Function} handlers - Middleware and handler functions
         * @returns {RoachApp} This app for chaining
         *
         * @example
         * app.get('/users/:id', (req, res) => res.json({ id: req.params.id }))
         * app.post('/users', authMiddleware, (req, res) => res.status(201).json(req.body))
         */
        app[method] = (path, ...handlers) => {
            const handler = handlers.pop()
            const middleware = handlers
            router.add(method.toUpperCase(), path, middleware, handler)
            return app
        }
    }

    return app
}

/**
 * @description Create a standalone router for grouping routes under a common prefix.
 * Mount it on an app with app.use('/prefix', router).
 *
 * @returns {RoachRouter} A new router instance
 *
 * @example
 * const api = roach.router()
 * api.get('/ping', (req, res) => res.send('pong'))
 * api.get('/users', (req, res) => res.json([]))
 * app.use('/api', api)
 */
roach.router = function createSubRouter() {
    const subRouter = new Router()

    const routerObj = {
        /** @type {boolean} Internal flag to identify RoachJS routers */
        _isRoachRouter: true,
        /** @type {Router} The underlying radix tree router */
        _router: subRouter
    }

    for (const method of HTTP_METHODS) {
        routerObj[method] = (path, ...handlers) => {
            const handler = handlers.pop()
            const middleware = handlers
            subRouter.add(method.toUpperCase(), path, middleware, handler)
            return routerObj
        }
    }

    routerObj.all = (path, ...handlers) => {
        const handler = handlers.pop()
        const middleware = handlers
        for (const method of HTTP_METHODS) {
            subRouter.add(method.toUpperCase(), path, middleware, handler)
        }
        return routerObj
    }

    return routerObj
}

export default roach

/**
 * @typedef {Object} RoachApp
 * @property {function(string|Function, Function=): RoachApp} use - Add middleware or mount a sub-router
 * @property {function(string, ...Function): RoachApp} get - Register GET route
 * @property {function(string, ...Function): RoachApp} post - Register POST route
 * @property {function(string, ...Function): RoachApp} put - Register PUT route
 * @property {function(string, ...Function): RoachApp} delete - Register DELETE route
 * @property {function(string, ...Function): RoachApp} patch - Register PATCH route
 * @property {function(string, ...Function): RoachApp} options - Register OPTIONS route
 * @property {function(string, ...Function): RoachApp} head - Register HEAD route
 * @property {function(string, ...Function): RoachApp} all - Register route for all methods
 * @property {function(Function): RoachApp} onError - Set custom error handler
 * @property {function(Function): RoachApp} onNotFound - Set custom not-found handler
 * @property {function(number, Function=): RoachApp} listen - Start the server
 * @property {function(): void} close - Stop the server
 */

/**
 * @typedef {Object} RoachRouter
 * @property {boolean} _isRoachRouter - Internal flag
 * @property {function(string, ...Function): RoachRouter} get - Register GET route
 * @property {function(string, ...Function): RoachRouter} post - Register POST route
 * @property {function(string, ...Function): RoachRouter} put - Register PUT route
 * @property {function(string, ...Function): RoachRouter} delete - Register DELETE route
 * @property {function(string, ...Function): RoachRouter} patch - Register PATCH route
 * @property {function(string, ...Function): RoachRouter} options - Register OPTIONS route
 * @property {function(string, ...Function): RoachRouter} head - Register HEAD route
 * @property {function(string, ...Function): RoachRouter} all - Register route for all methods
 */
