/**
 * @module benchmarks/update-readme
 * @description Update README.md with system specs and logs from results.json.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const resultsPath = join(__dirname, 'results.json')
const readmePath = join(rootDir, 'README.md')

function main() {
    if (!existsSync(resultsPath)) {
        console.error('No results.json found. Run benchmarks first.')
        process.exit(1)
    }

    const results = JSON.parse(readFileSync(resultsPath, 'utf-8'))
    const readme = readFileSync(readmePath, 'utf-8')

    const sys = results.system
    if (!sys) {
        console.error('No system info found in results.json.')
        process.exit(1)
    }

    // Update System Specs Table
    const specsTableRegex = /\| Component \| Specification \|\n\| :--- \| :--- \|\n\| \*\*CPU\*\* \| .* \|\n\| \*\*Cores\*\* \| .* \|\n\| \*\*RAM\*\* \| .* \|\n\| \*\*OS\*\* \| .* \|\n\| \*\*Node\.js\*\* \| .* \|/
    const newSpecsTable = `| Component | Specification |
| :--- | :--- |
| **CPU** | ${sys.cpu} |
| **Cores** | ${sys.cores} |
| **RAM** | ${sys.ram} |
| **OS** | ${sys.os} |
| **Node.js** | ${sys.node} (LTS) |`

    // Update Logs
    const logsRegex = /<details>\n<summary><b>View Benchmark Logs<\/b><\/summary>\n<br \/>\n\n```text\n[\s\S]*?```\n\n<\/details>/
    const newLogs = `<details>
<summary><b>View Benchmark Logs</b></summary>
<br />

\`\`\`text
${results.logs ? results.logs.join('\n') : '[No logs found]'}
\`\`\`

</details>`

    let updatedReadme = readme.replace(specsTableRegex, newSpecsTable)
    updatedReadme = updatedReadme.replace(logsRegex, newLogs)

    if (updatedReadme === readme) {
        console.log('README.md is already up to date.')
    } else {
        writeFileSync(readmePath, updatedReadme)
        console.log('README.md updated with latest benchmark info.')
    }
}

main()
