use serde_json::Value;

/// 依赖名到展示名，顺序决定卡片上的显示顺序
const NODE_TECH: [(&str, &str); 10] = [
    ("electron", "Electron"),
    ("next", "Next.js"),
    ("nuxt", "Nuxt"),
    ("vue", "Vue"),
    ("react", "React"),
    ("svelte", "Svelte"),
    ("@angular/core", "Angular"),
    ("typescript", "TypeScript"),
    ("vite", "Vite"),
    ("tailwindcss", "Tailwind"),
];

type Matcher = fn(&str) -> bool;

const FILE_TECH: [(Matcher, &str); 7] = [
    (|n| n.ends_with(".xcodeproj") || n.ends_with(".xcworkspace") || n.ends_with(".swift"), "Swift"),
    (|n| n == "pyproject.toml" || n == "requirements.txt" || n.ends_with(".py"), "Python"),
    (|n| n == "go.mod", "Go"),
    (|n| n == "Cargo.toml", "Rust"),
    (|n| n == "pom.xml" || n.starts_with("build.gradle"), "Java"),
    (|n| n.ends_with(".sln") || n.ends_with(".csproj"), ".NET"),
    (|n| n == "CMakeLists.txt", "C/C++"),
];

fn has_dependency(pkg: &Value, name: &str) -> bool {
    ["dependencies", "devDependencies"]
        .iter()
        .any(|field| pkg.get(field).and_then(Value::as_object).is_some_and(|deps| deps.contains_key(name)))
}

pub fn detect_tech(file_names: &[String], pkg: Option<&Value>) -> Vec<String> {
    let mut tech: Vec<String> = Vec::new();
    if let Some(pkg) = pkg {
        tech.extend(NODE_TECH.iter().filter(|(dep, _)| has_dependency(pkg, dep)).map(|(_, label)| label.to_string()));
        if tech.is_empty() {
            tech.push("Node.js".into());
        }
    }
    for (matches, label) in FILE_TECH {
        if file_names.iter().any(|n| matches(n)) {
            tech.push(label.into());
        }
    }
    if tech.is_empty() {
        let web = file_names.iter().any(|n| {
            let lower = n.to_lowercase();
            [".html", ".htm", ".js", ".css"].iter().any(|ext| lower.ends_with(ext))
        });
        if web {
            tech.push("HTML/JS".into());
        }
    }
    tech
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn frontend_stack_from_dependencies() {
        let pkg = json!({ "dependencies": { "vue": "3" }, "devDependencies": { "vite": "6", "typescript": "5", "electron": "1" } });
        assert_eq!(detect_tech(&names(&["package.json"]), Some(&pkg)), ["Electron", "Vue", "TypeScript", "Vite"]);
    }

    #[test]
    fn plain_node() {
        assert_eq!(detect_tech(&names(&["package.json"]), Some(&json!({}))), ["Node.js"]);
    }

    #[test]
    fn other_languages_and_static_pages() {
        assert_eq!(detect_tech(&names(&["AIToy.xcodeproj", ".tmp_create_ios_docs.py"]), None), ["Swift", "Python"]);
        assert_eq!(detect_tech(&names(&["Package.swift"]), None), ["Swift"]);
        assert_eq!(detect_tech(&names(&["main.py", "go.mod", "Cargo.toml"]), None), ["Python", "Go", "Rust"]);
        assert_eq!(detect_tech(&names(&["App.sln", "build.gradle.kts"]), None), ["Java", ".NET"]);
        assert_eq!(detect_tech(&names(&["index.HTML"]), None), ["HTML/JS"]);
        assert!(detect_tech(&names(&["notes.txt"]), None).is_empty());
    }
}
