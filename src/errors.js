/**
 * @module errors
 * @description Error handling utilities for RoachJS. Custom error classes for
 * common framework errors, plus a tiny internal debug logger that only speaks
 * when you ask it to (via DEBUG=roachjs environment variable).
 */

/**
 * @description Internal debug logger. Only outputs when DEBUG=roachjs is set.
 * No console.log pollution in production — the roaches are quiet when they need to be.
 * @param {string} namespace - Debug namespace (e.g., 'router', 'middleware')
 * @param {...*} args - Arguments to log
 * @returns {void}
 */
export function debug(namespace, ...args) {
  const debugEnv = process.env.DEBUG || ''
  if (debugEnv === 'roachjs' || debugEnv === 'roachjs:*' || debugEnv === `roachjs:${namespace}`) {
    const timestamp = new Date().toISOString()
    process.stderr.write(`[roachjs:${namespace}] ${timestamp} ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`)
  }
}

/**
 * @description Base error class for all RoachJS errors. Extends native Error
 * with a status code and an error code string for programmatic handling.
 * @extends Error
 */
export class RoachError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} [statusCode=500] - HTTP status code
   * @param {string} [code='ROACH_ERROR'] - Machine-readable error code
   */
  constructor(message, statusCode = 500, code = 'ROACH_ERROR') {
    super(message)
    this.name = 'RoachError'
    this.statusCode = statusCode
    this.code = code
  }
}

/**
 * @description Thrown when two routes conflict — same method, same path pattern.
 * The roaches don't like sharing routes.
 * @extends RoachError
 */
export class RouteConflictError extends RoachError {
  /**
   * @param {string} method - HTTP method of the conflicting route
   * @param {string} path - Path pattern that conflicts
   */
  constructor(method, path) {
    super(
      `Route conflict: ${method.toUpperCase()} ${path} is already registered. ` +
      `Each method+path combination must be unique. Check your route definitions.`,
      500,
      'ROUTE_CONFLICT'
    )
    this.name = 'RouteConflictError'
  }
}

/**
 * @description Thrown when a requested route doesn't exist.
 * The cockroaches checked everywhere — nothing here.
 * @extends RoachError
 */
export class NotFoundError extends RoachError {
  /**
   * @param {string} method - HTTP method that was requested
   * @param {string} path - Path that was requested
   */
  constructor(method, path) {
    super(
      `Route not found: ${method.toUpperCase()} ${path}. The cockroaches checked everywhere.`,
      404,
      'NOT_FOUND'
    )
    this.name = 'NotFoundError'
  }
}

/**
 * @description Thrown when a route parameter is invalid or missing.
 * @extends RoachError
 */
export class InvalidRouteError extends RoachError {
  /**
   * @param {string} path - The invalid route path
   * @param {string} reason - Why the route is invalid
   */
  constructor(path, reason) {
    super(
      `Invalid route "${path}": ${reason}. Fix your route definition and try again.`,
      500,
      'INVALID_ROUTE'
    )
    this.name = 'InvalidRouteError'
  }
}

/**
 * @description Thrown when JSON body parsing fails.
 * @extends RoachError
 */
export class BodyParseError extends RoachError {
  /**
   * @param {string} detail - Details about the parse failure
   */
  constructor(detail) {
    super(
      `Failed to parse request body: ${detail}. Make sure you're sending valid JSON with the correct Content-Type header.`,
      400,
      'BODY_PARSE_ERROR'
    )
    this.name = 'BodyParseError'
  }
}

/**
 * @description Thrown when response has already been sent and something tries
 * to write to it again. You can't send a response twice — the roaches already delivered it.
 * @extends RoachError
 */
export class ResponseAlreadySentError extends RoachError {
  constructor() {
    super(
      `Response already sent. You can't send a response twice — the roaches already delivered it. ` +
      `Make sure you're not calling res.send(), res.json(), or res.end() multiple times.`,
      500,
      'RESPONSE_ALREADY_SENT'
    )
    this.name = 'ResponseAlreadySentError'
  }
}
