/**
 * @module router
 * @description Radix Tree (Patricia Trie) router for RoachJS. Hand-written,
 * zero dependencies, zero compromises. Static routes resolve in O(1),
 * parametric routes in O(log n). Supports static segments, named parameters
 * (:param), and wildcards (*).
 *
 * The tree compresses common prefixes into shared edges, splitting nodes only
 * when a new route diverges from an existing one. This gives us minimal memory
 * usage and maximum lookup speed.
 */

import { RouteConflictError, InvalidRouteError, NotFoundError, debug } from './errors.js'

/**
 * @description A single node in the radix tree. Each node holds an edge label
 * (the compressed path segment), child nodes, parameter/wildcard metadata,
 * and a map of HTTP method → handler for terminal nodes.
 */
class RadixNode {
    /**
     * @param {string} label - The path segment this node represents
     */
    constructor(label = '') {
        /** @type {string} */
        this.label = label

        /** @type {RadixNode[]} */
        this.children = []

        /** @type {Map<string, {handler: Function, middleware: Function[]}>} */
        this.handlers = new Map()

        /** @type {string|null} Parameter name if this is a parametric node */
        this.paramName = null

        /** @type {boolean} Whether this is a wildcard node */
        this.isWildcard = false

        /** @type {RadixNode|null} Parametric child (only one allowed per level) */
        this.paramChild = null

        /** @type {RadixNode|null} Wildcard child (only one allowed per level) */
        this.wildcardChild = null
    }
}

/**
 * @description High-performance radix tree router. Routes are stored in a
 * compressed trie structure where common path prefixes share tree edges.
 *
 * @example
 * const router = new Router()
 * router.add('GET', '/users/:id', [], (req, res) => res.json({ id: req.params.id }))
 * const match = router.find('GET', '/users/42')
 * // match.handler is the function, match.params is { id: '42' }
 */
export class Router {
    constructor() {
        /** @type {RadixNode} The root of the radix tree */
        this.root = new RadixNode()

        /** @type {Map<string, Function>} Fast lookup cache for static routes */
        this.staticRoutes = new Map()
    }

    /**
     * @description Register a route in the radix tree. Parses the path into
     * segments, builds or extends tree nodes as needed, and stores the handler
     * at the terminal node.
     *
     * @param {string} method - HTTP method (GET, POST, etc.)
     * @param {string} path - Route path pattern (e.g., '/users/:id')
     * @param {Function[]} middleware - Array of middleware functions for this route
     * @param {Function} handler - The route handler function
     * @returns {void}
     * @throws {InvalidRouteError} If the path is malformed
     * @throws {RouteConflictError} If the exact method+path already exists
     *
     * @example
     * router.add('GET', '/api/users/:id', [authMiddleware], handler)
     */
    add(method, path, middleware, handler) {
        method = method.toUpperCase()

        if (!path.startsWith('/')) {
            throw new InvalidRouteError(path, 'Route must start with "/"')
        }

        debug('router', `Registering ${method} ${path}`)

        const isStatic = !path.includes(':') && !path.includes('*')
        if (isStatic) {
            const key = `${method}:${path}`
            if (this.staticRoutes.has(key)) {
                throw new RouteConflictError(method, path)
            }
            this.staticRoutes.set(key, { handler, middleware })
        }

        const segments = this._splitPath(path)
        let node = this.root

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i]

            if (segment.startsWith(':')) {
                const paramName = segment.slice(1)
                if (!paramName) {
                    throw new InvalidRouteError(path, 'Parameter name cannot be empty')
                }

                if (!node.paramChild) {
                    node.paramChild = new RadixNode(segment)
                    node.paramChild.paramName = paramName
                } else if (node.paramChild.paramName !== paramName) {
                    throw new RouteConflictError(method, path)
                }
                node = node.paramChild

            } else if (segment === '*') {
                if (i !== segments.length - 1) {
                    throw new InvalidRouteError(path, 'Wildcard (*) must be the last segment')
                }

                if (!node.wildcardChild) {
                    node.wildcardChild = new RadixNode('*')
                    node.wildcardChild.isWildcard = true
                }
                node = node.wildcardChild

            } else {
                node = this._insertStatic(node, segment)
            }
        }

        if (node.handlers.has(method)) {
            throw new RouteConflictError(method, path)
        }

        node.handlers.set(method, { handler, middleware })
    }

    /**
     * @description Insert a static path segment into the tree, splitting
     * existing nodes when the new segment shares a prefix with an existing edge.
     *
     * @param {RadixNode} parent - Parent node to insert under
     * @param {string} segment - The static path segment to insert
     * @returns {RadixNode} The node representing the end of this segment
     */
    _insertStatic(parent, segment) {
        for (let i = 0; i < parent.children.length; i++) {
            const child = parent.children[i]
            const commonLen = this._commonPrefixLength(child.label, segment)

            if (commonLen === 0) continue

            if (commonLen === child.label.length && commonLen === segment.length) {
                return child
            }

            if (commonLen === child.label.length) {
                return this._insertStatic(child, segment.slice(commonLen))
            }

            if (commonLen < child.label.length) {
                const splitNode = new RadixNode(child.label.slice(0, commonLen))
                child.label = child.label.slice(commonLen)
                splitNode.children.push(child)

                parent.children[i] = splitNode

                if (commonLen === segment.length) {
                    return splitNode
                }

                const newNode = new RadixNode(segment.slice(commonLen))
                splitNode.children.push(newNode)
                return newNode
            }
        }

        const newNode = new RadixNode(segment)
        parent.children.push(newNode)
        return newNode
    }

    /**
     * @description Find a route match for a given method and URL path.
     * Checks the static cache first (O(1)), then traverses the radix tree.
     *
     * @param {string} method - HTTP method
     * @param {string} path - URL path to match
     * @returns {{ handler: Function, params: Object<string, string>, middleware: Function[] }|null}
     *   The matched route with handler, extracted params, and middleware, or null if not found
     *
     * @example
     * const result = router.find('GET', '/users/42')
     * if (result) {
     *   result.handler(req, res)  // result.params = { id: '42' }
     * }
     */
    find(method, path) {
        method = method.toUpperCase()

        const staticKey = `${method}:${path}`
        const staticMatch = this.staticRoutes.get(staticKey)
        if (staticMatch) {
            return { handler: staticMatch.handler, params: {}, middleware: staticMatch.middleware }
        }

        const segments = this._splitPath(path)
        const params = {}
        const result = this._search(this.root, segments, 0, params, method)

        return result
    }

    /**
     * @description Recursive tree search. Tries static children first (fastest),
     * then parametric children, then wildcard children (most permissive).
     *
     * @param {RadixNode} node - Current node in the tree
     * @param {string[]} segments - All URL path segments
     * @param {number} segIdx - Current segment index
     * @param {Object<string, string>} params - Accumulated route parameters
     * @param {string} method - HTTP method to match
     * @returns {{ handler: Function, params: Object<string, string>, middleware: Function[] }|null}
     */
    _search(node, segments, segIdx, params, method) {
        if (segIdx === segments.length) {
            const route = node.handlers.get(method)
            if (route) {
                return { handler: route.handler, params: { ...params }, middleware: route.middleware }
            }
            return null
        }

        const segment = segments[segIdx]

        for (const child of node.children) {
            const match = this._matchStatic(child, segments, segIdx)
            if (match !== null) {
                const result = this._search(child, segments, match, params, method)
                if (result) return result
            }
        }

        if (node.paramChild) {
            params[node.paramChild.paramName] = segment
            const result = this._search(node.paramChild, segments, segIdx + 1, params, method)
            if (result) return result
            delete params[node.paramChild.paramName]
        }

        if (node.wildcardChild) {
            const wildcardValue = segments.slice(segIdx).join('/')
            params['*'] = wildcardValue
            const route = node.wildcardChild.handlers.get(method)
            if (route) {
                return { handler: route.handler, params: { ...params }, middleware: route.middleware }
            }
            delete params['*']
        }

        return null
    }

    /**
     * @description Match a static child node against path segments starting at
     * segIdx. Handles compressed edges that may span multiple characters within
     * a single segment.
     *
     * @param {RadixNode} child - The child node to match against
     * @param {string[]} segments - All URL path segments
     * @param {number} segIdx - Starting segment index
     * @returns {number|null} The next segment index after match, or null if no match
     */
    _matchStatic(child, segments, segIdx) {
        if (segIdx >= segments.length) return null

        const segment = segments[segIdx]
        if (child.label === segment) {
            return segIdx + 1
        }

        return null
    }

    /**
     * @description Split a URL path into segments, removing empty strings
     * from leading/trailing slashes.
     *
     * @param {string} path - URL path to split
     * @returns {string[]} Array of path segments
     *
     * @example
     * _splitPath('/users/42/posts') // => ['users', '42', 'posts']
     * _splitPath('/')               // => []
     */
    _splitPath(path) {
        return path.split('/').filter(Boolean)
    }

    /**
     * @description Calculate the length of the common prefix between two strings.
     *
     * @param {string} a - First string
     * @param {string} b - Second string
     * @returns {number} Number of characters shared at the start
     */
    _commonPrefixLength(a, b) {
        const len = Math.min(a.length, b.length)
        let i = 0
        while (i < len && a[i] === b[i]) i++
        return i
    }

    /**
     * @description Print the tree structure for debugging. Only active when
     * DEBUG=roachjs is set.
     *
     * @param {RadixNode} [node] - Starting node (defaults to root)
     * @param {string} [prefix=''] - Indentation prefix for tree visualization
     * @returns {void}
     */
    debugPrint(node = this.root, prefix = '') {
        const methods = Array.from(node.handlers.keys()).join(',')
        const label = node.label || '(root)'
        const extra = node.paramName ? ` [param:${node.paramName}]` : node.isWildcard ? ' [wildcard]' : ''
        debug('router', `${prefix}${label}${extra}${methods ? ` → [${methods}]` : ''}`)

        for (const child of node.children) {
            this.debugPrint(child, prefix + '  ')
        }
        if (node.paramChild) {
            this.debugPrint(node.paramChild, prefix + '  ')
        }
        if (node.wildcardChild) {
            this.debugPrint(node.wildcardChild, prefix + '  ')
        }
    }
}
