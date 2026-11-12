use std::process::{Command, Stdio};

/// 走 URL 协议打开，路径不经过 shell，无需担心特殊字符被解释
pub fn vscode_url(path: &str) -> String {
    let encoded: Vec<String> = path
        .replace('\\', "/")
        .split('/')
        .map(|segment| {
            let is_drive = segment.len() == 2 && segment.ends_with(':') && segment.as_bytes()[0].is_ascii_alphabetic();
            if is_drive {
                segment.to_string()
            } else {
                encode_component(segment)
            }
        })
        .collect();
    format!("vscode://file/{}", encoded.join("/").trim_start_matches('/'))
}

/// 与 encodeURIComponent 相同的保留字符
fn encode_component(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// 用 cwd 传路径：wt 会把 -d 参数里的分号当作命令分隔符
pub fn open_in_terminal(path: &str) -> Result<(), String> {
    let spawn = |program: &str, args: &[&str], new_console: bool| {
        let mut command = Command::new(program);
        command.args(args).current_dir(path).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        if new_console {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
            command.creation_flags(CREATE_NEW_CONSOLE);
        }
        #[cfg(not(windows))]
        let _ = new_console;
        command.spawn().map(|_| ())
    };
    spawn("wt.exe", &["-d", "."], false)
        .or_else(|_| spawn("powershell.exe", &["-NoExit"], true))
        .map_err(|e| format!("无法打开终端：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_vscode_urls() {
        assert_eq!(vscode_url("E:\\code\\my app"), "vscode://file/E:/code/my%20app");
        assert_eq!(vscode_url("E:\\代码\\a#b"), "vscode://file/E:/%E4%BB%A3%E7%A0%81/a%23b");
    }
}
