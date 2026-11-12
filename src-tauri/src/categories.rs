use crate::types::Category;
use std::collections::HashSet;

/// 该分类自身及其所有子孙的 id
pub fn subtree_ids(categories: &[Category], id: &str) -> HashSet<String> {
    let mut ids = HashSet::new();
    let mut stack = vec![id.to_string()];
    while let Some(current) = stack.pop() {
        if !ids.insert(current.clone()) {
            continue;
        }
        stack.extend(
            categories
                .iter()
                .filter(|c| c.parent_id.as_deref() == Some(current.as_str()))
                .map(|c| c.id.clone()),
        );
    }
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cat(id: &str, parent: Option<&str>) -> Category {
        Category { id: id.into(), name: id.into(), parent_id: parent.map(Into::into) }
    }

    #[test]
    fn collects_descendants() {
        let list = vec![cat("a", None), cat("b", Some("a")), cat("c", Some("b")), cat("d", None)];
        let ids = subtree_ids(&list, "a");
        assert_eq!(ids.len(), 3);
        assert!(!ids.contains("d"));
    }
}
