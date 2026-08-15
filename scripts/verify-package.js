const { execFileSync } = require('node:child_process')

const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    encoding: 'utf8',
})
const result = JSON.parse(output)[0]
const files = result.files.map(file => file.path)
const required = ['package.json', 'README.md', 'LICENSE', 'dist/index.js']
const forbidden = files.filter(file =>
    file.startsWith('node_modules/') || file.startsWith('src/'),
)

for (const file of required) {
    if (!files.includes(file)) {
        throw new Error(`Missing package file: ${file}`)
    }
}

if (forbidden.length > 0) {
    throw new Error(`Unexpected source/dependency files in package: ${forbidden.join(', ')}`)
}

console.log(`Package ${result.filename} contains ${files.length} files`)
