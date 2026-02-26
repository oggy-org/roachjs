/**
 * @module scripts/roach-manager
 * @description Roach Manager — the CI-powered GitHub bot for RoachJS.
 * Runs as a GitHub Actions job. Smart auto-labeling, personality-driven
 * comments, comment commands for maintainers, and scheduled stale checks.
 *
 * Zero dependencies. Uses native fetch + GitHub REST API.
 *
 * Triggers:
 * - issues.opened → smart label + contextual comment
 * - issue_comment.created → maintainer commands (roach close, roach stale, etc.)
 * - pull_request.opened → smart label + checklist comment
 * - pull_request.synchronize → "re-running checks" comment
 * - schedule (Monday 9am UTC) → stale issue/PR cleanup
 */

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * @description Maintainers who can trigger Roach Manager commands via comments.
 * Update this list as the team grows.
 * @type {string[]}
 */
const MAINTAINERS = [
    'ramkrishna0'
]

/**
 * @description Number of days of inactivity before an issue is marked stale.
 * @type {number}
 */
const STALE_DAYS = 30

/**
 * @description Number of days after stale label before auto-close.
 * @type {number}
 */
const CLOSE_AFTER_STALE_DAYS = 7

// ─── Environment ────────────────────────────────────────────────────────────

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const EVENT_NAME = process.env.EVENT_NAME
const EVENT_ACTION = process.env.EVENT_ACTION
const ISSUE_NUMBER = process.env.ISSUE_NUMBER ? parseInt(process.env.ISSUE_NUMBER, 10) : null
const ISSUE_TITLE = process.env.ISSUE_TITLE || ''
const ISSUE_BODY = process.env.ISSUE_BODY || ''
const IS_PR = process.env.IS_PR === 'true'
const COMMENT_BODY = process.env.COMMENT_BODY || ''
const COMMENT_AUTHOR = process.env.COMMENT_AUTHOR || ''
const REPO = process.env.REPO || 'oggy-org/roachjs'

const [REPO_OWNER, REPO_NAME] = REPO.split('/')

// ─── Keyword → Label Mapping ────────────────────────────────────────────────

/**
 * @description Keyword-to-label mapping for smart auto-labeling.
 * Each entry maps a label to an array of keywords/phrases.
 * Matching is case-insensitive against title + body.
 * @type {Array<{label: string, keywords: string[], also?: string[]}>}
 */
const LABEL_RULES = [
    {
        label: 'critical',
        keywords: ['critical', 'severe', 'production down', 'data loss', 'security', 'vulnerability', 'cve', 'exploit', 'memory leak'],
        also: ['bug']
    },
    {
        label: 'regression',
        keywords: ['regression', 'used to work', 'worked before', 'broke in', 'broke after', 'broke since', 'stopped working after'],
        also: ['bug']
    },
    {
        label: 'bug',
        keywords: ['bug', 'broken', 'crash', 'crashes', 'error', 'exception', 'fails', 'failure', 'not working', "doesn't work", 'stopped working', 'unexpected behavior', 'wrong behavior']
    },
    {
        label: 'feature-request',
        keywords: ['feature', 'feature request', 'would be nice', 'support for', 'add support', 'could you add', 'request', 'suggestion', 'propose', 'proposal']
    },
    {
        label: 'enhancement',
        keywords: ['improve', 'improvement', 'enhance', 'enhancement', 'optimize', 'better', 'update', 'upgrade', 'refactor']
    },
    {
        label: 'performance',
        keywords: ['slow', 'performance', 'speed', 'faster', 'latency', 'throughput', 'memory', 'cpu', 'bottleneck', 'overhead', 'req/sec', 'requests per second']
    },
    {
        label: 'benchmark',
        keywords: ['benchmark', 'benchmarks', 'bench', 'autocannon', 'comparison', 'compare', 'vs fastify', 'vs express']
    },
    {
        label: 'documentation',
        keywords: ['docs', 'documentation', 'readme', 'typo', 'spelling', 'misleading', 'confusing', 'example', 'guide', 'tutorial']
    },
    {
        label: 'breaking-change',
        keywords: ['breaking', 'breaking change', 'breaks', 'incompatible', 'migration', 'major version']
    },
    {
        label: 'needs-discussion',
        keywords: ['discuss', 'discussion', 'thoughts', 'opinion', 'rfc', 'should we', 'what do you think', 'open question']
    },
    {
        label: 'needs-reproduction',
        keywords: ['cannot reproduce', "can't reproduce", 'need reproduction', 'reproduction', 'repro', 'minimal example', 'code sandbox']
    }
]

/**
 * @description Keywords in title that trigger the `good first issue` label.
 * @type {string[]}
 */
const GOOD_FIRST_ISSUE_KEYWORDS = ['typo', 'small', 'minor', 'simple fix']

/**
 * @description Max body length (chars) to consider an issue "simple" for good-first-issue.
 * @type {number}
 */
const SIMPLE_BODY_THRESHOLD = 300

/**
 * @description Files that trigger automatic `performance` label on PRs.
 * @type {string[]}
 */
const PERF_SENSITIVE_FILES = ['src/router.js', 'src/index.js']

/**
 * @description Conventional commit prefixes that PRs should follow.
 * @type {string[]}
 */
const CONVENTIONAL_PREFIXES = ['fix:', 'feat:', 'perf:', 'docs:', 'chore:', 'refactor:', 'test:', 'ci:', 'build:', 'style:']

// ─── Comment Templates ─────────────────────────────────────────────────────

/**
 * @description Generate the comment for a new bug issue.
 * @returns {string} Markdown comment body
 */
function bugComment() {
    return `Hey, thanks for reporting this!

The roaches are on it. Here's what happens next:

- [ ] A maintainer will look at this within 48 hours
- [ ] We'll confirm if this is reproducible
- [ ] If confirmed, a fix will be scoped and assigned

To help us move faster, please make sure you've included:
- [ ] Node.js version
- [ ] RoachJS version
- [ ] Minimal reproduction case
- [ ] What you expected vs what happened

— Roach Manager 🪲`
}

/**
 * @description Generate the comment for a new feature request issue.
 * @returns {string} Markdown comment body
 */
function featureComment() {
    return `Thanks for the suggestion!

Before we build anything, we need to discuss it. Here's the process:

- [ ] Maintainer will review and respond within 48 hours
- [ ] If it's a good fit, it goes to community discussion
- [ ] If approved, it gets scoped and added to the roadmap
- [ ] Then someone builds it (maybe you?)

Feel free to share more context on why this would be useful.

— Roach Manager 🪲`
}

/**
 * @description Generate the comment for a documentation issue.
 * @returns {string} Markdown comment body
 */
function docsComment() {
    return `Documentation fix incoming.

- [ ] A maintainer will review this within 48 hours
- [ ] If it's a small fix, we might just merge a PR directly
- [ ] Feel free to open a PR yourself — docs fixes are always welcome

— Roach Manager 🪲`
}

/**
 * @description Generate the generic comment for issues that don't match specific types.
 * @returns {string} Markdown comment body
 */
function genericComment() {
    return `Thanks for opening this!

- [ ] A maintainer will review within 48 hours
- [ ] We'll label and triage accordingly
- [ ] Check [CONTRIBUTING.md](https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/main/CONTRIBUTING.md) if you want to help move this forward

— Roach Manager 🪲`
}

/**
 * @description Generate the PR checklist comment.
 * @returns {string} Markdown comment body
 */
function prChecklistComment() {
    return `Thanks for the PR! Before we review, please confirm:

- [ ] Tests pass locally (\`npm test\`)
- [ ] New tests added for new behavior
- [ ] No new runtime dependencies added without prior discussion
- [ ] CHANGELOG.md updated under the Unreleased section
- [ ] PR title follows conventional commits (fix:, feat:, perf:, docs:, chore:)
- [ ] If performance-related: benchmark results included

Once all boxes are checked, a maintainer will review.

— Roach Manager 🪲`
}

/**
 * @description PR sync (new commits pushed) comment.
 * @returns {string} Markdown comment body
 */
function prSyncComment() {
    return `New commits detected. Re-running checks.

— Roach Manager 🪲`
}

/**
 * @description Stale issue warning comment.
 * @returns {string} Markdown comment body
 */
function staleWarningComment() {
    return `This issue has been inactive for 30 days.

If it's still relevant, please leave a comment and we'll keep it open.
Otherwise it will be closed in 7 days.

— Roach Manager 🪲`
}

/**
 * @description Stale issue auto-close comment.
 * @returns {string} Markdown comment body
 */
function staleCloseComment() {
    return `Closing due to inactivity. Feel free to reopen if this is still relevant.

— Roach Manager 🪲`
}

// ─── GitHub API Helpers ─────────────────────────────────────────────────────

/**
 * @description Make a GitHub REST API request. All calls are wrapped in
 * error handling with meaningful logging.
 *
 * @param {string} endpoint - API endpoint relative to /repos/owner/name/
 * @param {string} [method='GET'] - HTTP method
 * @param {object|null} [body=null] - Request body (will be JSON-stringified)
 * @returns {Promise<object|null>} Parsed JSON response, or null on error
 *
 * @example
 * await api('issues/1/comments', 'POST', { body: 'Hello!' })
 */
async function api(endpoint, method = 'GET', body = null) {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/${endpoint}`

    const headers = {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RoachManager/2.0',
        'X-GitHub-Api-Version': '2022-11-28'
    }

    if (body) headers['Content-Type'] = 'application/json'

    try {
        const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        })

        if (!response.ok) {
            const errorText = await response.text()
            console.error(`GitHub API ${method} ${endpoint} → ${response.status}: ${errorText}`)
            return null
        }

        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
            return response.json()
        }
        return null
    } catch (err) {
        console.error(`GitHub API request failed: ${method} ${endpoint} → ${err.message}`)
        return null
    }
}

/**
 * @description Post a comment on an issue or PR.
 *
 * @param {number} number - Issue or PR number
 * @param {string} body - Markdown comment body
 * @returns {Promise<void>}
 *
 * @example
 * await postComment(42, 'The roaches approve this PR.')
 */
async function postComment(number, body) {
    await api(`issues/${number}/comments`, 'POST', { body })
    console.log(`  → Commented on #${number}`)
}

/**
 * @description Add labels to an issue or PR. Skips labels that already exist.
 *
 * @param {number} number - Issue or PR number
 * @param {string[]} labels - Array of label names to apply
 * @returns {Promise<void>}
 *
 * @example
 * await addLabels(7, ['bug', 'critical', 'roach-managed'])
 */
async function addLabels(number, labels) {
    if (labels.length === 0) return
    await api(`issues/${number}/labels`, 'POST', { labels })
    console.log(`  → Added labels [${labels.join(', ')}] to #${number}`)
}

/**
 * @description Close an issue or PR.
 *
 * @param {number} number - Issue or PR number
 * @returns {Promise<void>}
 *
 * @example
 * await closeIssue(42)
 */
async function closeIssue(number) {
    await api(`issues/${number}`, 'PATCH', { state: 'closed' })
    console.log(`  → Closed #${number}`)
}

/**
 * @description List files changed in a pull request.
 *
 * @param {number} prNumber - PR number
 * @returns {Promise<string[]>} Array of changed file paths
 *
 * @example
 * const files = await getPRFiles(15)
 * // ['src/router.js', 'test/router.test.js']
 */
async function getPRFiles(prNumber) {
    const data = await api(`pulls/${prNumber}/files`)
    if (!data || !Array.isArray(data)) return []
    return data.map(f => f.filename)
}

/**
 * @description List all open issues (not PRs) with pagination.
 *
 * @param {number} [page=1] - Page number
 * @returns {Promise<object[]>} Array of issue objects
 */
async function listOpenIssues(page = 1) {
    const data = await api(`issues?state=open&per_page=100&page=${page}&sort=updated&direction=asc`)
    return Array.isArray(data) ? data : []
}

// ─── Smart Label Detection ──────────────────────────────────────────────────

/**
 * @description Scan title and body text to detect which labels should be applied.
 * Uses the LABEL_RULES mapping with case-insensitive keyword matching.
 *
 * @param {string} title - Issue or PR title
 * @param {string} body - Issue or PR body
 * @returns {string[]} Deduplicated array of label names to apply
 *
 * @example
 * const labels = detectLabels('Bug: app crashes on startup', 'When I run...')
 * // ['bug', 'roach-managed']
 */
function detectLabels(title, body) {
    const text = `${title} ${body}`.toLowerCase()
    const labels = new Set()

    for (const rule of LABEL_RULES) {
        for (const keyword of rule.keywords) {
            if (text.includes(keyword)) {
                labels.add(rule.label)
                if (rule.also) {
                    for (const extra of rule.also) labels.add(extra)
                }
                break
            }
        }
    }

    const titleLower = title.toLowerCase()
    const isDocRelated = labels.has('documentation')
    const isSimpleBody = (body || '').length < SIMPLE_BODY_THRESHOLD
    const hasSimpleKeyword = GOOD_FIRST_ISSUE_KEYWORDS.some(k => titleLower.includes(k))

    if (isDocRelated || (isSimpleBody && hasSimpleKeyword)) {
        labels.add('good first issue')
    }

    labels.add('roach-managed')

    return [...labels]
}

/**
 * @description Determine the best comment template based on detected labels.
 *
 * @param {string[]} labels - Array of detected label names
 * @returns {string} The comment body to post
 *
 * @example
 * const comment = getIssueComment(['bug', 'critical', 'roach-managed'])
 * // Returns bug comment template
 */
function getIssueComment(labels) {
    if (labels.includes('bug') || labels.includes('critical') || labels.includes('regression')) {
        return bugComment()
    }
    if (labels.includes('feature-request')) {
        return featureComment()
    }
    if (labels.includes('documentation')) {
        return docsComment()
    }
    return genericComment()
}

/**
 * @description Check if a PR title follows conventional commit format.
 *
 * @param {string} title - PR title
 * @returns {boolean} True if title starts with a valid conventional commit prefix
 *
 * @example
 * isConventionalCommit('fix: route matching bug') // true
 * isConventionalCommit('Fixed a bug')              // false
 */
function isConventionalCommit(title) {
    const lower = title.toLowerCase().trim()
    return CONVENTIONAL_PREFIXES.some(prefix => lower.startsWith(prefix))
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

/**
 * @description Handle a new issue being opened. Detects labels, posts
 * contextual comment, and pings maintainers if critical.
 *
 * @returns {Promise<void>}
 */
async function handleIssueOpened() {
    console.log(`\nNew issue #${ISSUE_NUMBER}: ${ISSUE_TITLE}`)

    const labels = detectLabels(ISSUE_TITLE, ISSUE_BODY)
    console.log(`  Detected labels: [${labels.join(', ')}]`)

    await addLabels(ISSUE_NUMBER, labels)

    const comment = getIssueComment(labels)

    if (labels.includes('critical')) {
        const mentionLine = `\n\n@maintainers this looks critical, eyes needed asap.`
        await postComment(ISSUE_NUMBER, comment + mentionLine)
    } else {
        await postComment(ISSUE_NUMBER, comment)
    }
}

/**
 * @description Handle a new PR being opened. Detects labels, checks for
 * conventional commit title, checks for perf-sensitive file changes,
 * warns about breaking changes, and posts checklist.
 *
 * @returns {Promise<void>}
 */
async function handlePROpened() {
    console.log(`\nNew PR #${ISSUE_NUMBER}: ${ISSUE_TITLE}`)

    const labels = detectLabels(ISSUE_TITLE, ISSUE_BODY)

    const files = await getPRFiles(ISSUE_NUMBER)
    const touchesPerfFiles = files.some(f => PERF_SENSITIVE_FILES.includes(f))
    if (touchesPerfFiles && !labels.includes('performance')) {
        labels.push('performance')
    }

    console.log(`  Detected labels: [${labels.join(', ')}]`)
    await addLabels(ISSUE_NUMBER, labels)

    let comment = prChecklistComment()

    if (!isConventionalCommit(ISSUE_TITLE)) {
        comment += `\n\n> ⚠️ **PR title doesn't follow conventional commits format.** Please rename it to start with one of: \`fix:\`, \`feat:\`, \`perf:\`, \`docs:\`, \`chore:\`. Example: \`fix: correct wildcard route matching\``
    }

    if (touchesPerfFiles) {
        comment += `\n\n> ⚡ **This PR touches performance-sensitive files** (\`${files.filter(f => PERF_SENSITIVE_FILES.includes(f)).join('`, `')}\`). Benchmark results may be required before merge.`
    }

    if (labels.includes('breaking-change')) {
        comment += `\n\n> 💥 **Breaking change detected.** Maintainers: this PR may affect the public API. Please review carefully.`
    }

    await postComment(ISSUE_NUMBER, comment)
}

/**
 * @description Handle new commits pushed to an existing PR.
 *
 * @returns {Promise<void>}
 */
async function handlePRSync() {
    console.log(`\nPR #${ISSUE_NUMBER} updated with new commits`)
    await postComment(ISSUE_NUMBER, prSyncComment())
}

/**
 * @description Handle a comment on an issue. Checks for Roach Manager commands
 * and executes them if the commenter is a maintainer.
 *
 * Supported commands:
 * - `roach close` — close the issue
 * - `roach stale` — mark as stale
 * - `roach duplicate #N` — mark as duplicate of #N
 * - `roach wont fix` — mark as wont-fix and close
 * - `roach good first issue` — mark as good first issue
 *
 * @returns {Promise<void>}
 */
async function handleIssueComment() {
    if (!ISSUE_NUMBER) return

    const body = COMMENT_BODY.trim().toLowerCase()
    const author = COMMENT_AUTHOR

    if (!body.startsWith('roach ')) return

    if (!MAINTAINERS.includes(author)) {
        console.log(`  Command from non-maintainer "${author}" — ignoring`)
        return
    }

    console.log(`\nRoach command on #${ISSUE_NUMBER} by ${author}: "${body}"`)

    if (body === 'roach close') {
        await postComment(ISSUE_NUMBER, 'Closing this one. If this was a mistake, just reopen it. — Roach Manager 🪲')
        await closeIssue(ISSUE_NUMBER)
        return
    }

    if (body === 'roach stale') {
        await addLabels(ISSUE_NUMBER, ['stale', 'roach-managed'])
        await postComment(ISSUE_NUMBER, 'Marking as stale due to inactivity. Will close in 7 days if no response. — Roach Manager 🪲')
        return
    }

    const dupMatch = body.match(/^roach duplicate #?(\d+)$/)
    if (dupMatch) {
        const dupNumber = dupMatch[1]
        await addLabels(ISSUE_NUMBER, ['duplicate', 'roach-managed'])
        await postComment(ISSUE_NUMBER, `Marked as duplicate of #${dupNumber}. — Roach Manager 🪲`)
        await closeIssue(ISSUE_NUMBER)
        return
    }

    if (body === 'roach wont fix' || body === "roach won't fix") {
        await addLabels(ISSUE_NUMBER, ['wont-fix', 'roach-managed'])
        await postComment(ISSUE_NUMBER, "We've decided not to fix this. See above discussion for context. — Roach Manager 🪲")
        await closeIssue(ISSUE_NUMBER)
        return
    }

    if (body === 'roach good first issue') {
        await addLabels(ISSUE_NUMBER, ['good first issue', 'roach-managed'])
        await postComment(ISSUE_NUMBER, 'Tagged as a good first issue! New contributors welcome. — Roach Manager 🪲')
        return
    }

    console.log(`  Unknown roach command: "${body}"`)
}

/**
 * @description Run the scheduled stale check. Scans all open issues/PRs.
 * - No activity in 30+ days and not `in-progress` → label `stale` + warn
 * - Already `stale` and no activity in 7+ days → close
 *
 * @returns {Promise<void>}
 */
async function handleStaleCheck() {
    console.log('\nRunning scheduled stale check...')

    const now = Date.now()
    const staleThresholdMs = STALE_DAYS * 24 * 60 * 60 * 1000
    const closeThresholdMs = CLOSE_AFTER_STALE_DAYS * 24 * 60 * 60 * 1000

    let page = 1
    let processed = 0

    while (true) {
        const issues = await listOpenIssues(page)
        if (issues.length === 0) break

        for (const issue of issues) {
            const labels = (issue.labels || []).map(l => l.name)
            const updatedAt = new Date(issue.updated_at).getTime()
            const daysSinceUpdate = (now - updatedAt) / (24 * 60 * 60 * 1000)

            if (labels.includes('in-progress')) continue

            const isStale = labels.includes('stale')

            if (isStale && (now - updatedAt) > closeThresholdMs) {
                console.log(`  Closing stale #${issue.number} (${Math.round(daysSinceUpdate)}d inactive)`)
                await postComment(issue.number, staleCloseComment())
                await closeIssue(issue.number)
                processed++
            } else if (!isStale && (now - updatedAt) > staleThresholdMs) {
                console.log(`  Marking #${issue.number} as stale (${Math.round(daysSinceUpdate)}d inactive)`)
                await addLabels(issue.number, ['stale', 'roach-managed'])
                await postComment(issue.number, staleWarningComment())
                processed++
            }
        }

        if (issues.length < 100) break
        page++
    }

    console.log(`  Stale check complete. Processed ${processed} issues.`)
}

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * @description Entry point. Validates environment, detects event type,
 * and routes to the appropriate handler.
 *
 * @returns {Promise<void>}
 */
async function main() {
    console.log('🪲 Roach Manager v2.0')
    console.log(`   Event: ${EVENT_NAME}.${EVENT_ACTION}`)
    console.log(`   Repo: ${REPO_OWNER}/${REPO_NAME}`)

    if (!GITHUB_TOKEN) {
        console.error('GITHUB_TOKEN is not set. The roaches need credentials to operate.')
        process.exit(1)
    }

    if (!EVENT_NAME) {
        console.error('EVENT_NAME is not set. Cannot determine what triggered this run.')
        process.exit(1)
    }

    if (EVENT_NAME === 'issues' && EVENT_ACTION === 'opened') {
        await handleIssueOpened()
    } else if (EVENT_NAME === 'pull_request' && EVENT_ACTION === 'opened') {
        await handlePROpened()
    } else if (EVENT_NAME === 'pull_request' && EVENT_ACTION === 'synchronize') {
        await handlePRSync()
    } else if (EVENT_NAME === 'issue_comment' && EVENT_ACTION === 'created') {
        await handleIssueComment()
    } else if (EVENT_NAME === 'schedule') {
        await handleStaleCheck()
    } else {
        console.log(`  No handler for ${EVENT_NAME}.${EVENT_ACTION} — nothing to do.`)
    }

    console.log('\n🪲 Roach Manager — Done.')
}

main().catch((err) => {
    console.error(`Roach Manager fatal error: ${err.message}`)
    console.error(err.stack)
    process.exit(1)
})
