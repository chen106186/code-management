//! 配置文件 store.json；格式与 Electron 版本相同，升级后原有配置直接可用

use crate::categories::subtree_ids;
use crate::paths::{normalize_path, path_key};
use crate::types::{
    Category, Config, ProjectMetaValues, ProjectPatch, SavedView, AUTO_FETCH_OPTIONS,
    DEFAULT_AUTO_FETCH_MINUTES,
};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// 导出文件里的标记，避免把别的 JSON 当成配置导入
const EXPORT_APP: &str = "code-management";

const MAX_TAGS: usize = 10;
const MAX_TAG_LENGTH: usize = 20;
const MAX_CATEGORY_NAME_LENGTH: usize = 40;
const MAX_REMARK_LENGTH: usize = 60;
const MAX_VIEW_NAME_LENGTH: usize = 30;
const MAX_QUERY_LENGTH: usize = 200;

pub type Meta = Map<String, Value>;

#[derive(Debug, Clone, PartialEq)]
pub struct StoreData {
    pub roots: Vec<String>,
    pub manual: Vec<String>,
    pub hidden: Vec<String>,
    pub excluded: Vec<String>,
    pub categories: Vec<Category>,
    pub theme: String,
    pub auto_fetch_minutes: u32,
    pub close_to_tray: bool,
    pub saved_views: Vec<SavedView>,
    /// 以 path_key 为键；保留未知字段，原样写回
    pub meta: Map<String, Value>,
}

impl Default for StoreData {
    fn default() -> Self {
        Self {
            roots: vec![],
            manual: vec![],
            hidden: vec![],
            excluded: vec![],
            categories: vec![],
            theme: "system".into(),
            auto_fetch_minutes: DEFAULT_AUTO_FETCH_MINUTES,
            close_to_tray: true,
            saved_views: vec![],
            meta: Map::new(),
        }
    }
}

impl StoreData {
    fn to_value(&self) -> Value {
        json!({
            "version": 1,
            "roots": self.roots,
            "manual": self.manual,
            "hidden": self.hidden,
            "excluded": self.excluded,
            "categories": self.categories,
            "theme": self.theme,
            "autoFetchMinutes": self.auto_fetch_minutes,
            "closeToTray": self.close_to_tray,
            "savedViews": self.saved_views,
            "meta": self.meta,
        })
    }
}

fn truncate(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// JS 里的真值判断，配置可能被手动改过
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|n| n != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

pub fn normalize_tags<S: AsRef<str>>(tags: &[S]) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    for raw in tags {
        let tag = truncate(raw.as_ref().trim(), MAX_TAG_LENGTH);
        if tag.is_empty() || result.contains(&tag) {
            continue;
        }
        result.push(tag);
        if result.len() == MAX_TAGS {
            break;
        }
    }
    result
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
        _ => vec![],
    }
}

/// 丢弃不完整的条目，父分类不存在的提到顶层
fn parse_categories(value: Option<&Value>) -> Vec<Category> {
    let Some(Value::Array(items)) = value else { return vec![] };
    let valid: Vec<&Map<String, Value>> = items
        .iter()
        .filter_map(Value::as_object)
        .filter(|c| c.get("id").is_some_and(Value::is_string) && c.get("name").is_some_and(Value::is_string))
        .collect();
    let ids: Vec<&str> = valid.iter().map(|c| c["id"].as_str().unwrap()).collect();
    valid
        .iter()
        .map(|c| {
            let id = c["id"].as_str().unwrap();
            let parent_id = c
                .get("parentId")
                .and_then(Value::as_str)
                .filter(|p| ids.contains(p) && *p != id)
                .map(String::from);
            Category { id: id.into(), name: c["name"].as_str().unwrap().into(), parent_id }
        })
        .collect()
}

/// 校验页面传来或文件里读到的视图；名称为空或字段类型不对时返回 None
pub fn parse_view(value: &Value, id: &str) -> Option<SavedView> {
    let raw = value.as_object()?;
    let name = truncate(raw.get("name")?.as_str()?.trim(), MAX_VIEW_NAME_LENGTH);
    if name.is_empty() {
        return None;
    }
    let text = |key: &str| raw.get(key).and_then(Value::as_str).map(String::from);
    Some(SavedView {
        id: id.into(),
        name,
        filter: text("filter")?,
        scope: text("scope")?,
        active_tag: text("activeTag"),
        query: truncate(&text("query").unwrap_or_default(), MAX_QUERY_LENGTH),
        sort: text("sort")?,
        sort_reverse: raw.get("sortReverse") == Some(&Value::Bool(true)),
    })
}

fn parse_views(value: Option<&Value>) -> Vec<SavedView> {
    let Some(Value::Array(items)) = value else { return vec![] };
    items
        .iter()
        .filter_map(|item| parse_view(item, item.get("id")?.as_str()?))
        .collect()
}

pub fn is_theme_setting(value: &str) -> bool {
    matches!(value, "system" | "light" | "dark")
}

pub fn is_auto_fetch_minutes(value: u32) -> bool {
    AUTO_FETCH_OPTIONS.contains(&value)
}

fn parse_meta(value: Option<&Value>) -> Map<String, Value> {
    let Some(Value::Object(entries)) = value else { return Map::new() };
    entries
        .iter()
        .filter(|(_, meta)| meta.is_object())
        .map(|(path, meta)| (path_key(path), meta.clone()))
        .collect()
}

fn parse_data(raw: &Map<String, Value>) -> StoreData {
    let theme = raw.get("theme").and_then(Value::as_str).filter(|t| is_theme_setting(t));
    let minutes = raw
        .get("autoFetchMinutes")
        .and_then(Value::as_u64)
        .and_then(|m| u32::try_from(m).ok())
        .filter(|m| is_auto_fetch_minutes(*m));
    StoreData {
        roots: string_array(raw.get("roots")),
        manual: string_array(raw.get("manual")),
        hidden: string_array(raw.get("hidden")),
        excluded: string_array(raw.get("excluded")),
        categories: parse_categories(raw.get("categories")),
        theme: theme.unwrap_or("system").into(),
        auto_fetch_minutes: minutes.unwrap_or(DEFAULT_AUTO_FETCH_MINUTES),
        close_to_tray: raw.get("closeToTray") != Some(&Value::Bool(false)),
        saved_views: parse_views(raw.get("savedViews")),
        meta: parse_meta(raw.get("meta")),
    }
}

/// 解析导出的配置文件；不是本应用导出的文件时报错
pub fn parse_export(text: &str) -> Result<StoreData, String> {
    let raw: Value = serde_json::from_str(text).map_err(|_| "文件不是有效的 JSON".to_string())?;
    match raw.as_object() {
        Some(object) if object.get("app").and_then(Value::as_str) == Some(EXPORT_APP) => Ok(parse_data(object)),
        _ => Err("这不是 Code Management Tool 导出的配置文件".into()),
    }
}

/// 备注、标签、分类或收藏，有任意一项才算用户添加过信息
fn has_user_info(meta: &ProjectMetaValues) -> bool {
    meta.favorite || !meta.tags.is_empty() || meta.category_id.is_some() || meta.remark.is_some()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub struct Store {
    file: PathBuf,
    data: StoreData,
}

impl Store {
    pub fn open(file: impl Into<PathBuf>) -> Self {
        let file = file.into();
        let data = Self::load(&file);
        Self { file, data }
    }

    fn load(file: &Path) -> StoreData {
        let Ok(text) = fs::read_to_string(file) else { return StoreData::default() };
        match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(raw)) => parse_data(&raw),
            _ => {
                // 配置损坏时保留原文件以便找回，再从空配置开始
                let mut corrupt = file.as_os_str().to_owned();
                corrupt.push(format!(".corrupt-{}", now_ms()));
                let _ = fs::rename(file, corrupt);
                StoreData::default()
            }
        }
    }

    fn save(&self) -> Result<(), String> {
        let write = || -> std::io::Result<()> {
            if let Some(dir) = self.file.parent() {
                fs::create_dir_all(dir)?;
            }
            let mut tmp = self.file.as_os_str().to_owned();
            tmp.push(".tmp");
            let text = serde_json::to_string_pretty(&self.data.to_value()).map_err(std::io::Error::other)?;
            fs::write(&tmp, text)?;
            fs::rename(&tmp, &self.file)
        };
        write().map_err(|e| format!("保存配置失败：{e}"))
    }

    pub fn directory(&self) -> PathBuf {
        self.file.parent().map(Path::to_path_buf).unwrap_or_default()
    }

    pub fn config(&self) -> Config {
        let d = &self.data;
        Config {
            roots: d.roots.clone(),
            manual: d.manual.clone(),
            hidden: d.hidden.clone(),
            excluded: d.excluded.clone(),
            categories: d.categories.clone(),
            theme: d.theme.clone(),
            auto_fetch_minutes: d.auto_fetch_minutes,
            close_to_tray: d.close_to_tray,
            saved_views: d.saved_views.clone(),
        }
    }

    fn add(list: &mut Vec<String>, path: &str) {
        let key = path_key(path);
        if !list.iter().any(|p| path_key(p) == key) {
            list.push(normalize_path(path));
        }
    }

    fn remove(list: &mut Vec<String>, path: &str) {
        let key = path_key(path);
        if let Some(index) = list.iter().position(|p| path_key(p) == key) {
            list.remove(index);
        }
    }

    pub fn add_root(&mut self, path: &str) -> Result<(), String> {
        Self::add(&mut self.data.roots, path);
        self.save()
    }

    pub fn remove_root(&mut self, path: &str) -> Result<(), String> {
        Self::remove(&mut self.data.roots, path);
        self.save()
    }

    pub fn add_excluded(&mut self, path: &str) -> Result<(), String> {
        Self::add(&mut self.data.excluded, path);
        self.save()
    }

    pub fn remove_excluded(&mut self, path: &str) -> Result<(), String> {
        Self::remove(&mut self.data.excluded, path);
        self.save()
    }

    /// 手动添加同时取消隐藏，否则用户重新添加隐藏过的项目会没有反应
    pub fn add_manual(&mut self, path: &str) -> Result<(), String> {
        Self::add(&mut self.data.manual, path);
        Self::remove(&mut self.data.hidden, path);
        self.save()
    }

    pub fn hide_many(&mut self, paths: &[String]) -> Result<(), String> {
        for path in paths {
            Self::add(&mut self.data.hidden, path);
        }
        self.save()
    }

    pub fn restore(&mut self, path: &str) -> Result<(), String> {
        Self::remove(&mut self.data.hidden, path);
        self.save()
    }

    pub fn theme(&self) -> &str {
        &self.data.theme
    }

    pub fn set_theme(&mut self, theme: &str) -> Result<(), String> {
        self.data.theme = theme.into();
        self.save()
    }

    pub fn auto_fetch_minutes(&self) -> u32 {
        self.data.auto_fetch_minutes
    }

    pub fn set_auto_fetch_minutes(&mut self, minutes: u32) -> Result<(), String> {
        self.data.auto_fetch_minutes = minutes;
        self.save()
    }

    pub fn close_to_tray(&self) -> bool {
        self.data.close_to_tray
    }

    pub fn set_close_to_tray(&mut self, enabled: bool) -> Result<(), String> {
        self.data.close_to_tray = enabled;
        self.save()
    }

    pub fn saved_views(&self) -> Vec<SavedView> {
        self.data.saved_views.clone()
    }

    /// 同名视图保留原来的 id 和位置，内容被覆盖
    pub fn save_view(&mut self, value: &Value) -> Result<(), String> {
        let view = parse_view(value, &uuid::Uuid::new_v4().to_string()).ok_or("视图无效")?;
        let views = &mut self.data.saved_views;
        match views.iter().position(|v| v.name == view.name) {
            Some(index) => views[index] = SavedView { id: views[index].id.clone(), ..view },
            None => views.push(view),
        }
        self.save()
    }

    pub fn delete_view(&mut self, id: &str) -> Result<(), String> {
        self.data.saved_views.retain(|v| v.id != id);
        self.save()
    }

    fn metas_mut(&mut self) -> impl Iterator<Item = &mut Meta> {
        self.data.meta.values_mut().filter_map(Value::as_object_mut)
    }

    /// 使用这个标签的项目数，包括已隐藏和当前不在列表里的项目
    pub fn tag_usage(&self, tag: &str) -> usize {
        self.data
            .meta
            .values()
            .filter(|meta| string_array(meta.get("tags")).iter().any(|t| t == tag))
            .count()
    }

    /// 改名后和已有标签相同就合并成一个；顺序保持在原来的位置
    pub fn rename_tag(&mut self, from: &str, to: &str) -> Result<(), String> {
        let name = normalize_tags(&[to]).into_iter().next().ok_or("标签名称不能为空")?;
        for meta in self.metas_mut() {
            let tags = string_array(meta.get("tags"));
            if tags.iter().any(|t| t == from) {
                let renamed: Vec<&str> = tags.iter().map(|t| if t == from { name.as_str() } else { t }).collect();
                meta.insert("tags".into(), json!(normalize_tags(&renamed)));
            }
        }
        self.save()
    }

    pub fn delete_tag(&mut self, tag: &str) -> Result<(), String> {
        for meta in self.metas_mut() {
            let tags = string_array(meta.get("tags"));
            if tags.iter().any(|t| t == tag) {
                let kept: Vec<&String> = tags.iter().filter(|t| *t != tag).collect();
                meta.insert("tags".into(), json!(kept));
            }
        }
        self.save()
    }

    pub fn categories(&self) -> Vec<Category> {
        self.data.categories.clone()
    }

    fn has_category(&self, id: &str) -> bool {
        self.data.categories.iter().any(|c| c.id == id)
    }

    /// 校验名称：不能为空，同一层不能重名
    fn valid_name(&self, name: &str, parent_id: Option<&str>, self_id: Option<&str>) -> Result<String, String> {
        let trimmed = truncate(name.trim(), MAX_CATEGORY_NAME_LENGTH);
        if trimmed.is_empty() {
            return Err("分类名称不能为空".into());
        }
        let duplicate = self.data.categories.iter().any(|c| {
            c.parent_id.as_deref() == parent_id && c.name == trimmed && Some(c.id.as_str()) != self_id
        });
        if duplicate {
            return Err(format!("同一层已有分类“{trimmed}”"));
        }
        Ok(trimmed)
    }

    pub fn create_category(&mut self, name: &str, parent_id: Option<String>) -> Result<Category, String> {
        if let Some(parent) = &parent_id {
            if !self.has_category(parent) {
                return Err("上级分类不存在".into());
            }
        }
        let category = Category {
            id: uuid::Uuid::new_v4().to_string(),
            name: self.valid_name(name, parent_id.as_deref(), None)?,
            parent_id,
        };
        self.data.categories.push(category.clone());
        self.save()?;
        Ok(category)
    }

    pub fn rename_category(&mut self, id: &str, name: &str) -> Result<(), String> {
        let category = self.data.categories.iter().find(|c| c.id == id).ok_or("分类不存在")?;
        let name = self.valid_name(name, category.parent_id.as_deref(), Some(id))?;
        self.data.categories.iter_mut().find(|c| c.id == id).unwrap().name = name;
        self.save()
    }

    /// 移动到 parent_id 下、before_id 之前（None 排到最后）；同级顺序就是数组里的先后顺序
    pub fn move_category(&mut self, id: &str, parent_id: Option<String>, before_id: Option<String>) -> Result<(), String> {
        let list = &self.data.categories;
        let category = list.iter().find(|c| c.id == id).ok_or("分类不存在")?.clone();
        if let Some(parent) = &parent_id {
            if !self.has_category(parent) {
                return Err("目标分类不存在".into());
            }
            if subtree_ids(list, id).contains(parent) {
                return Err("不能把分类移动到它自己或它的子分类下".into());
            }
        }
        if let Some(before) = &before_id {
            if list.iter().find(|c| &c.id == before).map(|c| &c.parent_id) != Some(&parent_id) {
                return Err("目标位置不存在".into());
            }
        }
        if parent_id != category.parent_id {
            self.valid_name(&category.name, parent_id.as_deref(), Some(id))?;
        }
        // 插到自己前面等于位置不变
        if before_id.as_deref() == Some(id) {
            return Ok(());
        }
        let list = &mut self.data.categories;
        let index = list.iter().position(|c| c.id == id).unwrap();
        let mut moved = list.remove(index);
        moved.parent_id = parent_id;
        let target = match &before_id {
            None => list.len(),
            Some(before) => list.iter().position(|c| &c.id == before).unwrap(),
        };
        list.insert(target, moved);
        self.save()
    }

    /// 删除分类及其子孙；其中的项目变为未分类，项目本身不受影响
    pub fn delete_category(&mut self, id: &str) -> Result<(), String> {
        let removed = subtree_ids(&self.data.categories, id);
        self.data.categories.retain(|c| !removed.contains(&c.id));
        for meta in self.metas_mut() {
            if meta.get("categoryId").and_then(Value::as_str).is_some_and(|c| removed.contains(c)) {
                meta.insert("categoryId".into(), Value::Null);
            }
        }
        self.save()
    }

    pub fn set_category(&mut self, path: &str, category_id: Option<String>) -> Result<(), String> {
        if let Some(id) = &category_id {
            if !self.has_category(id) {
                return Err("分类不存在".into());
            }
        }
        self.patch_meta(path, [("categoryId", json!(category_id))]);
        self.save()
    }

    /// 保留 remote 等内部字段，只改给出的字段
    fn patch_meta<const N: usize>(&mut self, path: &str, patch: [(&str, Value); N]) {
        let values = serde_json::to_value(self.meta_of(path)).unwrap();
        let key = path_key(path);
        let mut meta = self.data.meta.get(&key).and_then(Value::as_object).cloned().unwrap_or_default();
        if let Value::Object(values) = values {
            meta.extend(values);
        }
        for (field, value) in patch {
            meta.insert(field.into(), value);
        }
        self.data.meta.insert(key, Value::Object(meta));
    }

    /// 批量修改只写一次文件
    pub fn update_projects(&mut self, paths: &[String], patch: &ProjectPatch) -> Result<(), String> {
        if let Some(Some(id)) = &patch.category_id {
            if !self.has_category(id) {
                return Err("分类不存在".into());
            }
        }
        for path in paths {
            if let Some(category) = &patch.category_id {
                self.patch_meta(path, [("categoryId", json!(category))]);
            }
            if let Some(favorite) = patch.favorite {
                self.patch_meta(path, [("favorite", json!(favorite))]);
            }
            if let Some(tag) = &patch.add_tag {
                let mut tags = self.meta_of(path).tags;
                tags.push(tag.clone());
                self.patch_meta(path, [("tags", json!(normalize_tags(&tags)))]);
            }
        }
        self.save()
    }

    /// 记下添加过信息的项目的 Git 地址，移动后靠它认出来；它已回到列表，之前的忽略也作废
    pub fn track_projects(&mut self, items: &[(String, Option<String>)]) -> Result<(), String> {
        let mut changed = false;
        for (path, remote) in items {
            let key = path_key(path);
            if !self.data.meta.get(&key).is_some_and(Value::is_object) {
                continue;
            }
            let informative = has_user_info(&self.meta_of(path));
            let meta = self.data.meta.get_mut(&key).and_then(Value::as_object_mut).unwrap();
            if meta.remove("moveIgnored").is_some() {
                changed = true;
            }
            let Some(remote) = remote else { continue };
            if !informative {
                continue;
            }
            if meta.get("remote").and_then(Value::as_str) == Some(remote.as_str())
                && meta.get("path").and_then(Value::as_str) == Some(path.as_str())
            {
                continue;
            }
            meta.insert("remote".into(), json!(remote));
            meta.insert("path".into(), json!(path));
            changed = true;
        }
        if changed {
            self.save()?;
        }
        Ok(())
    }

    /// 记录过 Git 地址且添加过信息的项目：(旧路径, 地址)；路径是否还存在由调用方判断
    pub fn move_sources(&self) -> Vec<(String, String)> {
        self.data
            .meta
            .iter()
            .filter_map(|(key, meta)| {
                let remote = meta.get("remote")?.as_str()?;
                if truthy(meta.get("moveIgnored")) || !has_user_info(&self.meta_of(key)) {
                    return None;
                }
                let from = meta.get("path").and_then(Value::as_str).unwrap_or(key);
                Some((from.to_string(), remote.to_string()))
            })
            .collect()
    }

    /// 把旧路径的信息、手动添加和隐藏状态都转到新路径，一次写入
    pub fn migrate_projects(&mut self, moves: &[(String, String)]) -> Result<(), String> {
        for (from, to) in moves {
            let Some(Value::Object(mut source)) = self.data.meta.remove(&path_key(from)) else { continue };
            source.insert("path".into(), json!(normalize_path(to)));
            self.data.meta.insert(path_key(to), Value::Object(source));
            Self::remove(&mut self.data.manual, from);
            if self.data.hidden.iter().any(|p| path_key(p) == path_key(from)) {
                Self::remove(&mut self.data.hidden, from);
                Self::add(&mut self.data.hidden, to);
            }
        }
        self.save()
    }

    pub fn ignore_moves(&mut self, paths: &[String]) -> Result<(), String> {
        for path in paths {
            if let Some(meta) = self.data.meta.get_mut(&path_key(path)).and_then(Value::as_object_mut) {
                meta.insert("moveIgnored".into(), json!(true));
            }
        }
        self.save()
    }

    pub fn export_data(&self) -> Value {
        let mut object = Map::new();
        object.insert("app".into(), json!(EXPORT_APP));
        object.insert(
            "exportedAt".into(),
            json!(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        );
        if let Value::Object(data) = self.data.to_value() {
            object.extend(data);
        }
        Value::Object(object)
    }

    /// 替换全部配置，先把当前配置备份在同一目录；返回备份文件的位置
    pub fn replace_data(&mut self, data: StoreData) -> Result<Option<PathBuf>, String> {
        let mut backup = None;
        if self.file.exists() {
            let mut name = self.file.as_os_str().to_owned();
            name.push(format!(".backup-{}", now_ms()));
            let path = PathBuf::from(name);
            fs::copy(&self.file, &path).map_err(|e| format!("备份配置失败：{e}"))?;
            backup = Some(path);
        }
        self.data = data;
        self.save()?;
        Ok(backup)
    }

    pub fn meta_of(&self, path: &str) -> ProjectMetaValues {
        let meta = self.data.meta.get(&path_key(path));
        let field = |name: &str| meta.and_then(|m| m.get(name));
        ProjectMetaValues {
            favorite: field("favorite") == Some(&Value::Bool(true)),
            tags: string_array(field("tags")),
            category_id: field("categoryId")
                .and_then(Value::as_str)
                .filter(|id| self.has_category(id))
                .map(String::from),
            remark: field("remark").and_then(Value::as_str).filter(|r| !r.is_empty()).map(String::from),
        }
    }

    /// 去掉首尾空白并限制长度；留空表示清除备注
    pub fn set_remark(&mut self, path: &str, remark: &str) -> Result<Option<String>, String> {
        let normalized = Some(truncate(remark.trim(), MAX_REMARK_LENGTH)).filter(|r| !r.is_empty());
        self.patch_meta(path, [("remark", json!(normalized))]);
        self.save()?;
        Ok(normalized)
    }

    pub fn set_favorite(&mut self, path: &str, favorite: bool) -> Result<(), String> {
        self.patch_meta(path, [("favorite", json!(favorite))]);
        self.save()
    }

    pub fn set_tags(&mut self, path: &str, tags: &[String]) -> Result<Vec<String>, String> {
        let normalized = normalize_tags(tags);
        self.patch_meta(path, [("tags", json!(normalized))]);
        self.save()?;
        Ok(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_store() -> (TempDir, PathBuf, Store) {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("store.json");
        let store = Store::open(&file);
        (dir, file, store)
    }

    fn view(name: &str, query: &str) -> Value {
        json!({ "name": name, "filter": "all", "scope": "all", "activeTag": null, "query": query, "sort": "name", "sortReverse": false })
    }

    #[test]
    fn persists_and_dedupes_case_insensitively() {
        let (_dir, file, mut store) = temp_store();
        store.add_root("E:\\Code").unwrap();
        store.add_root("e:\\code\\").unwrap();
        store.add_manual("E:\\x\\app").unwrap();
        let reopened = Store::open(&file);
        assert_eq!(reopened.config().roots.len(), 1);
        assert_eq!(reopened.config().manual.len(), 1);
    }

    #[test]
    fn corrupt_file_is_kept_aside() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("store.json");
        fs::write(&file, "{ broken").unwrap();
        let store = Store::open(&file);
        assert!(store.config().roots.is_empty());
        let names: Vec<String> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert!(names.iter().any(|n| n.starts_with("store.json.corrupt-")));
    }

    #[test]
    fn manual_add_unhides() {
        let (_dir, _file, mut store) = temp_store();
        store.hide_many(&["E:\\a".into()]).unwrap();
        store.add_manual("E:\\A").unwrap();
        assert!(store.config().hidden.is_empty());
    }

    #[test]
    fn categories_nested_and_named() {
        let (_dir, file, mut store) = temp_store();
        let work = store.create_category(" 工作 ", None).unwrap();
        assert_eq!(work.name, "工作");
        let sub = store.create_category("前端", Some(work.id.clone())).unwrap();
        assert!(store.create_category("工作", None).is_err());
        assert!(store.create_category("工作", Some(work.id.clone())).is_ok());
        assert!(store.create_category("  ", None).is_err());
        assert!(store.create_category("x", Some("missing".into())).is_err());
        store.set_category("E:\\p", Some(sub.id.clone())).unwrap();
        let reopened = Store::open(&file);
        assert_eq!(reopened.categories().len(), 3);
        assert_eq!(reopened.meta_of("e:\\P").category_id, Some(sub.id));
    }

    #[test]
    fn deleting_category_removes_descendants_and_clears_projects() {
        let (_dir, _file, mut store) = temp_store();
        let a = store.create_category("a", None).unwrap();
        let b = store.create_category("b", Some(a.id.clone())).unwrap();
        let c = store.create_category("c", None).unwrap();
        store.set_category("E:\\p1", Some(b.id.clone())).unwrap();
        store.set_category("E:\\p2", Some(c.id.clone())).unwrap();
        store.delete_category(&a.id).unwrap();
        assert_eq!(store.categories().len(), 1);
        assert_eq!(store.meta_of("E:\\p1").category_id, None);
        assert_eq!(store.meta_of("E:\\p2").category_id, Some(c.id));
    }

    #[test]
    fn moving_categories() {
        let (_dir, file, mut store) = temp_store();
        let a = store.create_category("a", None).unwrap();
        let b = store.create_category("b", None).unwrap();
        let c = store.create_category("c", None).unwrap();
        store.move_category(&c.id, None, Some(a.id.clone())).unwrap();
        let names: Vec<String> = Store::open(&file).categories().into_iter().map(|c| c.name).collect();
        assert_eq!(names, ["c", "a", "b"]);
        let child = store.create_category("child", Some(a.id.clone())).unwrap();
        assert!(store.move_category(&a.id, Some(child.id.clone()), None).is_err());
        assert!(store.move_category(&a.id, Some(a.id.clone()), None).is_err());
        assert!(store.move_category(&a.id, Some("missing".into()), None).is_err());
        store.move_category(&a.id, Some(b.id.clone()), None).unwrap();
        let moved = store.categories();
        assert_eq!(moved.iter().find(|x| x.id == a.id).unwrap().parent_id, Some(b.id.clone()));
        assert_eq!(moved.iter().find(|x| x.id == child.id).unwrap().parent_id, Some(a.id.clone()));
        let other = store.create_category("a", None).unwrap();
        assert!(store.move_category(&other.id, Some(b.id.clone()), None).is_err());
    }

    #[test]
    fn dirty_categories_are_repaired() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("store.json");
        fs::write(
            &file,
            r#"{"categories":[{"id":"a","name":"A","parentId":"gone"},{"id":"b","name":"B","parentId":"b"},{"id":1,"name":"x"},null]}"#,
        )
        .unwrap();
        let cats = Store::open(&file).categories();
        assert_eq!(cats.len(), 2);
        assert!(cats.iter().all(|c| c.parent_id.is_none()));
    }

    #[test]
    fn remarks_are_trimmed_and_clearable() {
        let (_dir, file, mut store) = temp_store();
        store.set_favorite("E:\\p", true).unwrap();
        assert_eq!(store.set_remark("E:\\p", "  我的项目  ").unwrap().as_deref(), Some("我的项目"));
        let long = "字".repeat(80);
        assert_eq!(store.set_remark("E:\\p", &long).unwrap().unwrap().chars().count(), 60);
        assert_eq!(store.set_remark("E:\\p", "   ").unwrap(), None);
        let meta = Store::open(&file).meta_of("E:\\p");
        assert!(meta.favorite);
        assert_eq!(meta.remark, None);
    }

    #[test]
    fn batch_update_only_changes_given_fields() {
        let (_dir, _file, mut store) = temp_store();
        let cat = store.create_category("c", None).unwrap();
        store.set_tags("E:\\a", &["x".into()]).unwrap();
        let paths = vec!["E:\\a".to_string(), "E:\\b".to_string()];
        let patch = ProjectPatch { add_tag: Some("x".into()), favorite: Some(true), ..Default::default() };
        store.update_projects(&paths, &patch).unwrap();
        assert_eq!(store.meta_of("E:\\a").tags, ["x"]);
        assert_eq!(store.meta_of("E:\\b").tags, ["x"]);
        assert!(store.meta_of("E:\\b").favorite);
        let bad = ProjectPatch { category_id: Some(Some("missing".into())), ..Default::default() };
        assert!(store.update_projects(&paths, &bad).is_err());
        let set = ProjectPatch { category_id: Some(Some(cat.id.clone())), ..Default::default() };
        store.update_projects(&paths, &set).unwrap();
        assert_eq!(store.meta_of("E:\\b").category_id, Some(cat.id));
        let clear = ProjectPatch { category_id: Some(None), ..Default::default() };
        store.update_projects(&paths, &clear).unwrap();
        assert_eq!(store.meta_of("E:\\b").category_id, None);
        assert!(store.meta_of("E:\\b").favorite);
    }

    #[test]
    fn project_patch_distinguishes_null_from_missing() {
        let patch: ProjectPatch = serde_json::from_value(json!({ "categoryId": null })).unwrap();
        assert_eq!(patch.category_id, Some(None));
        let patch: ProjectPatch = serde_json::from_value(json!({ "favorite": true })).unwrap();
        assert_eq!(patch.category_id, None);
    }

    #[test]
    fn moves_carry_info_manual_and_hidden() {
        let (_dir, _file, mut store) = temp_store();
        store.add_manual("E:\\old").unwrap();
        store.hide_many(&["E:\\old".into()]).unwrap();
        store.set_remark("E:\\old", "备注").unwrap();
        store.set_tags("E:\\plain", &[]).unwrap();
        store
            .track_projects(&[("E:\\old".into(), Some("github.com/a/b".into())), ("E:\\plain".into(), Some("github.com/c/d".into()))])
            .unwrap();
        assert_eq!(store.move_sources(), [("E:\\old".to_string(), "github.com/a/b".to_string())]);
        store.migrate_projects(&[("E:\\old".into(), "E:\\new".into())]).unwrap();
        assert_eq!(store.meta_of("E:\\new").remark.as_deref(), Some("备注"));
        assert_eq!(store.meta_of("E:\\old").remark, None);
        let config = store.config();
        assert!(config.manual.is_empty());
        assert_eq!(config.hidden.len(), 1);
        assert_eq!(path_key(&config.hidden[0]), path_key("E:\\new"));
    }

    #[test]
    fn ignored_moves_reset_when_project_returns() {
        let (_dir, _file, mut store) = temp_store();
        store.set_favorite("E:\\old", true).unwrap();
        store.track_projects(&[("E:\\old".into(), Some("r".into()))]).unwrap();
        store.ignore_moves(&["E:\\old".into()]).unwrap();
        assert!(store.move_sources().is_empty());
        store.track_projects(&[("E:\\old".into(), None)]).unwrap();
        assert_eq!(store.move_sources().len(), 1);
    }

    #[test]
    fn export_and_import_round_trip() {
        let (dir, file, mut store) = temp_store();
        store.add_root("E:\\code").unwrap();
        store.set_tags("E:\\code\\a", &["t".into()]).unwrap();
        let exported = serde_json::to_string(&store.export_data()).unwrap();
        let data = parse_export(&exported).unwrap();
        let mut other = Store::open(dir.path().join("other.json"));
        other.replace_data(data).unwrap();
        assert_eq!(other.config(), store.config());
        assert_eq!(other.meta_of("E:\\code\\a").tags, ["t"]);

        let backup = store.replace_data(StoreData::default()).unwrap().unwrap();
        assert!(backup.exists());
        assert!(Store::open(&file).config().roots.is_empty());
        assert!(parse_export("not json").is_err());
        assert!(parse_export(r#"{"roots":[]}"#).is_err());
    }

    #[test]
    fn theme_and_settings_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("store.json");
        fs::write(&file, r#"{"theme":"blue","autoFetchMinutes":7,"closeToTray":"no"}"#).unwrap();
        let mut store = Store::open(&file);
        assert_eq!(store.theme(), "system");
        assert_eq!(store.auto_fetch_minutes(), DEFAULT_AUTO_FETCH_MINUTES);
        assert!(store.close_to_tray());
        store.set_theme("dark").unwrap();
        store.set_auto_fetch_minutes(0).unwrap();
        store.set_close_to_tray(false).unwrap();
        let reopened = Store::open(&file);
        assert_eq!(reopened.theme(), "dark");
        assert_eq!(reopened.auto_fetch_minutes(), 0);
        assert!(!reopened.close_to_tray());
    }

    #[test]
    fn views_save_overwrite_and_delete() {
        let (_dir, file, mut store) = temp_store();
        store.save_view(&view("我的", "a")).unwrap();
        let id = store.saved_views()[0].id.clone();
        store.save_view(&view(" 我的 ", "b")).unwrap();
        store.save_view(&view("其他", "")).unwrap();
        assert!(store.save_view(&json!({ "name": "" })).is_err());
        let views = Store::open(&file).saved_views();
        assert_eq!(views.len(), 2);
        assert_eq!(views[0].id, id);
        assert_eq!(views[0].query, "b");
        store.delete_view(&id).unwrap();
        assert_eq!(store.saved_views().len(), 1);
    }

    #[test]
    fn tags_rename_merge_and_delete() {
        let (_dir, _file, mut store) = temp_store();
        store.set_tags("E:\\a", &["vue".into(), "web".into()]).unwrap();
        store.set_tags("E:\\b", &["Vue".into()]).unwrap();
        store.hide_many(&["E:\\b".into()]).unwrap();
        assert_eq!(store.tag_usage("vue"), 1);
        store.rename_tag("Vue", "vue").unwrap();
        assert_eq!(store.tag_usage("vue"), 2);
        store.rename_tag("web", "vue").unwrap();
        assert_eq!(store.meta_of("E:\\a").tags, ["vue"]);
        assert!(store.rename_tag("vue", "  ").is_err());
        store.delete_tag("vue").unwrap();
        assert_eq!(store.tag_usage("vue"), 0);
    }

    #[test]
    fn normalizes_tags() {
        let long = "x".repeat(30);
        let many: Vec<String> = (0..15).map(|i| i.to_string()).collect();
        assert_eq!(normalize_tags(&[" a ", "a", "", "b"]), ["a", "b"]);
        assert_eq!(normalize_tags(&[long.as_str()])[0].len(), 20);
        assert_eq!(normalize_tags(&many).len(), 10);
    }

    #[test]
    fn keeps_unknown_meta_fields_and_reads_electron_format() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("store.json");
        fs::write(
            &file,
            r#"{"version":1,"roots":["E:\\code"],"meta":{"E:\\Code\\A":{"favorite":true,"remote":"github.com/a/b","path":"E:\\Code\\A","future":1}}}"#,
        )
        .unwrap();
        let mut store = Store::open(&file);
        assert!(store.meta_of("e:\\code\\a").favorite);
        store.set_remark("E:\\code\\a", "r").unwrap();
        let saved: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        let meta = &saved["meta"]["e:\\code\\a"];
        assert_eq!(meta["future"], 1);
        assert_eq!(meta["remote"], "github.com/a/b");
        assert_eq!(saved["version"], 1);
    }
}
