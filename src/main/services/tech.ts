export interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** 依赖名到展示名，顺序决定卡片上的显示顺序 */
const NODE_TECH: [string, string][] = [
  ['electron', 'Electron'],
  ['next', 'Next.js'],
  ['nuxt', 'Nuxt'],
  ['vue', 'Vue'],
  ['react', 'React'],
  ['svelte', 'Svelte'],
  ['@angular/core', 'Angular'],
  ['typescript', 'TypeScript'],
  ['vite', 'Vite'],
  ['tailwindcss', 'Tailwind']
]

const FILE_TECH: [(name: string) => boolean, string][] = [
  [(n) => n === 'pyproject.toml' || n === 'requirements.txt' || n.endsWith('.py'), 'Python'],
  [(n) => n === 'go.mod', 'Go'],
  [(n) => n === 'Cargo.toml', 'Rust'],
  [(n) => n === 'pom.xml' || n.startsWith('build.gradle'), 'Java'],
  [(n) => n.endsWith('.sln') || n.endsWith('.csproj'), '.NET'],
  [(n) => n === 'CMakeLists.txt', 'C/C++']
]

export function detectTech(fileNames: string[], pkg: PackageJson | null): string[] {
  const tech: string[] = []

  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const [dep, label] of NODE_TECH) {
      if (dep in deps) tech.push(label)
    }
    if (tech.length === 0) tech.push('Node.js')
  }

  for (const [matches, label] of FILE_TECH) {
    if (fileNames.some(matches)) tech.push(label)
  }

  if (tech.length === 0 && fileNames.some((n) => /\.(html?|js|css)$/i.test(n))) {
    tech.push('HTML/JS')
  }
  return tech
}
